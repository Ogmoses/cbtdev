import { NextRequest, NextResponse } from "next/server";
import { getCallerContext } from "@/lib/auth/callerContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { seededShuffle } from "@/lib/shuffle";
import { batchState } from "@/lib/batchWindow";
import type { AnswersMap, ExamData, ExamQuestion } from "@/components/exam/ExamInterface";

/**
 * POST /api/exam-sessions/start
 * body: { examId: string, batchId: string, deviceFingerprint: string }
 *
 * Verifies the student is allowed into this batch right now, then either
 * creates a fresh session or resumes/reclaims an existing one — this is
 * where "Single Active Session Enforcement" and the batch time-lock both
 * live. Returns the exam payload (shuffled per its settings) plus any
 * previously auto-saved answers, so the client can restore state even if
 * it's a different device than last time, plus `secondsLeft` — what is left of
 * THIS student's own timer (enforced here, so refreshing never restarts it).
 *
 * Uses the admin client throughout (after identifying the caller): a
 * student has no RLS read access to `questions`/`question_options` at
 * all (by design — that's what keeps `is_correct` from being queryable
 * directly), so building this payload with the regular client would
 * silently come back with every question's content stripped out. This
 * route's own checks above (batch window, roster, single-session) are
 * the real authorization boundary, not RLS.
 */

// A session on another device is only reclaimable once its autosave
// heartbeat has clearly gone quiet — comfortably more than the 5s
// autosave interval, so a slow network blip doesn't look like a crash.
const STALE_HEARTBEAT_MS = 20_000;

export async function POST(req: NextRequest) {
  const { examId, batchId, deviceFingerprint } = await req.json();
  if (!examId || !batchId || !deviceFingerprint) {
    return NextResponse.json({ error: "examId, batchId, and deviceFingerprint are required." }, { status: 400 });
  }

  const guard = await getCallerContext();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;
  const studentId = ctx.userId;

  // Service-role client: it ignores RLS, so EVERY query below is filtered by
  // ctx.schoolId — an exam/batch id from another school simply isn't found.
  const admin = createAdminClient();

  // ---- Exam + batch + roster checks ----
  const { data: exam } = await admin.from("exams").select("id, title, duration_minutes, status, subjects(name)").eq("id", examId).eq("school_id", ctx.schoolId).maybeSingle();
  if (!exam || exam.status !== "published") {
    return NextResponse.json({ error: "This exam isn't available." }, { status: 403 });
  }

  const { data: batch } = await admin.from("exam_batches").select("id, starts_at, ends_at, stays_open, closed_at").eq("id", batchId).eq("exam_id", examId).eq("school_id", ctx.schoolId).maybeSingle();
  if (!batch) return NextResponse.json({ error: "Batch not found for this exam." }, { status: 404 });

  const now = new Date();

  const { data: assignment } = await admin.from("batch_students").select("student_id").eq("batch_id", batchId).eq("student_id", studentId).eq("school_id", ctx.schoolId).maybeSingle();
  if (!assignment) return NextResponse.json({ error: "You aren't assigned to this batch." }, { status: 403 });

  // ---- Single active-session enforcement ----
  const { data: existing } = await admin
    .from("student_exam_sessions")
    .select("id, status, device_fingerprint, last_heartbeat_at, started_at, deadline_at")
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();

  let sessionId: string;
  const durationMs = exam.duration_minutes * 60_000;
  // This student's OWN finishing time. Kept by the server so a refresh or a switch of computer can't restart the clock.
  let deadlineMs = now.getTime() + durationMs;

  if (!existing) {
    // The sitting must be open to START an exam. (Someone already mid-exam is not cut off by the window closing:
    // they carry on to their own deadline — see the branches below.)
    const state = batchState(batch, now);
    if (state === "upcoming") return NextResponse.json({ error: "This sitting hasn't opened yet." }, { status: 403 });
    if (state === "ended") return NextResponse.json({ error: "This sitting is closed. Ask your teacher to reopen it." }, { status: 403 });

    const { data: created, error } = await admin
      .from("student_exam_sessions")
      .insert({ school_id: ctx.schoolId, exam_id: examId, batch_id: batchId, student_id: studentId, status: "active", device_fingerprint: deviceFingerprint, deadline_at: new Date(deadlineMs).toISOString() })
      .select("id")
      .single();
    if (error || !created) return NextResponse.json({ error: "Couldn't start the exam session." }, { status: 500 });
    sessionId = created.id;
  } else if (existing.status === "submitted") {
    return NextResponse.json({ error: "You've already submitted this exam." }, { status: 409 });
  } else if (existing.status === "terminated" || existing.status === "expired") {
    return NextResponse.json({ error: "This attempt was closed. Ask your teacher to reset it if you need another attempt." }, { status: 409 });
  } else if (existing.device_fingerprint === deviceFingerprint) {
    // same browser continuing/refreshing — just bump the heartbeat
    await admin.from("student_exam_sessions").update({ last_heartbeat_at: now.toISOString() }).eq("id", existing.id);
    sessionId = existing.id;
  } else {
    const staleMs = now.getTime() - new Date(existing.last_heartbeat_at).getTime();
    if (staleMs < STALE_HEARTBEAT_MS) {
      return NextResponse.json({ error: "This exam is already in progress on another computer." }, { status: 409 });
    }
    // previous device went quiet (crash/power outage) — reclaim the session
    await admin
      .from("student_exam_sessions")
      .update({ device_fingerprint: deviceFingerprint, batch_id: batchId, last_heartbeat_at: now.toISOString() })
      .eq("id", existing.id);
    sessionId = existing.id;
  }

  // Someone resuming keeps the clock they already had (a legacy session without a stored deadline works it out from its start).
  if (existing) deadlineMs = existing.deadline_at ? new Date(existing.deadline_at).getTime() : new Date(existing.started_at).getTime() + durationMs;
  const secondsLeft = Math.max(0, Math.floor((deadlineMs - now.getTime()) / 1000));

  // ---- Build the exam payload ----
  const { data: examQuestions } = await admin
    .from("exam_questions")
    .select("order_index, questions(id, type, prompt, image_url, points, question_options(id, option_text, order_index))")
    .eq("exam_id", examId)
    .eq("school_id", ctx.schoolId)
    .order("order_index");

  const { data: examSettings } = await admin.from("exams").select("shuffle_questions, shuffle_options").eq("id", examId).eq("school_id", ctx.schoolId).single();

  let questions: ExamQuestion[] = (examQuestions ?? []).map((eq: any) => ({
    id: eq.questions.id,
    type: eq.questions.type,
    prompt: eq.questions.prompt,
    imageUrl: eq.questions.image_url,
    points: eq.questions.points,
    options: eq.questions.question_options
      ?.sort((a: any, b: any) => a.order_index - b.order_index)
      .map((o: any) => ({ id: o.id, text: o.option_text })), // is_correct deliberately not sent to the client
  }));

  if (examSettings?.shuffle_questions) questions = seededShuffle(questions, sessionId);
  if (examSettings?.shuffle_options) {
    questions = questions.map((q) => (q.options ? { ...q, options: seededShuffle(q.options, sessionId + q.id) } : q));
  }

  const examData: ExamData = {
    id: exam.id,
    title: exam.title,
    subjectName: (exam as any).subjects?.name ?? "",
    durationMinutes: exam.duration_minutes,
    questions,
  };

  // ---- Restore any answers already saved for this session ----
  const { data: savedAnswers } = await admin.from("student_answers").select("question_id, selected_option_id, free_text_answer, is_flagged").eq("session_id", sessionId).eq("school_id", ctx.schoolId);
  const existingAnswers: AnswersMap = {};
  for (const a of savedAnswers ?? []) {
    existingAnswers[a.question_id] = { value: a.selected_option_id ?? a.free_text_answer ?? "", flagged: a.is_flagged };
  }

  return NextResponse.json({ sessionId, exam: examData, existingAnswers, secondsLeft });
}
