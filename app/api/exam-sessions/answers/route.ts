import { NextRequest, NextResponse } from "next/server";
import { getCallerContext } from "@/lib/auth/callerContext";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AnswersMap } from "@/components/exam/ExamInterface";
import { SESSION_GRACE_MS } from "@/lib/batchWindow";

/**
 * POST /api/exam-sessions/answers
 * body: { sessionId: string, answers: AnswersMap }
 *
 * Upserts every answer in the map and refreshes the session's heartbeat —
 * this doubles as the "is this session still alive" signal that
 * /api/exam-sessions/start uses to decide whether a stale session on
 * another device can be reclaimed.
 *
 * Uses the admin client after identifying the caller: the ownership check
 * right below stands in for RLS. Notably, the nested `questions(id, type)`
 * read needs it regardless — a student has no RLS SELECT on `questions`
 * at all, so under the regular client `eq.questions` would come back null
 * for every row and this route would crash trying to read `.type` off it.
 */
export async function POST(req: NextRequest) {
  const { sessionId, answers } = (await req.json()) as { sessionId: string; answers: AnswersMap };
  if (!sessionId || !answers) return NextResponse.json({ error: "sessionId and answers are required." }, { status: 400 });

  const guard = await getCallerContext();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const admin = createAdminClient();

  const { data: session } = await admin.from("student_exam_sessions").select("id, exam_id, student_id, status, deadline_at").eq("id", sessionId).eq("school_id", ctx.schoolId).maybeSingle();
  if (!session || session.student_id !== ctx.userId) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (session.status !== "active") {
    return NextResponse.json({ error: "This exam has already been submitted." }, { status: 409 });
  }

  // Past their own deadline (plus a short allowance for the last auto-save to arrive), answers can no longer change.
  if (session.deadline_at && Date.now() > new Date(session.deadline_at).getTime() + SESSION_GRACE_MS) {
    return NextResponse.json({ error: "Your time is up." }, { status: 409 });
  }

  // Need each question's type to know whether the value is an option id
  // (multiple_choice/true_false) or free text (fill_blank/short_theory).
  const { data: examQuestions } = await admin.from("exam_questions").select("questions(id, type)").eq("exam_id", session.exam_id).eq("school_id", ctx.schoolId);
  const typeByQuestion = new Map((examQuestions ?? []).map((eq: any) => [eq.questions.id, eq.questions.type as string]));

  const rows = Object.entries(answers).map(([questionId, a]) => {
    const isObjective = typeByQuestion.get(questionId) === "multiple_choice" || typeByQuestion.get(questionId) === "true_false";
    return {
      school_id: ctx.schoolId,
      session_id: sessionId,
      question_id: questionId,
      selected_option_id: isObjective ? a.value || null : null,
      free_text_answer: !isObjective ? a.value || null : null,
      is_flagged: a.flagged,
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error } = await admin.from("student_answers").upsert(rows, { onConflict: "session_id,question_id" });
    if (error) return NextResponse.json({ error: "Couldn't save your answers — your local copy is still safe, retrying shortly." }, { status: 500 });
  }

  await admin.from("student_exam_sessions").update({ last_heartbeat_at: new Date().toISOString() }).eq("id", sessionId);

  return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
}
