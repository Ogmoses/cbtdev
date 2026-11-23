import { NextRequest, NextResponse } from "next/server";
import { getCallerContext } from "@/lib/auth/callerContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { gradeObjectiveAnswers, sumAwardedPoints, type GradableQuestion, type SubmittedAnswer } from "@/lib/grading";
import type { AnswersMap } from "@/components/exam/ExamInterface";
import { SESSION_GRACE_MS } from "@/lib/batchWindow";

/**
 * POST /api/exam-sessions/submit
 * body: { sessionId: string, answers: AnswersMap }
 *
 * Persists the final answer set, closes the session, and immediately
 * auto-marks every objective question (multiple_choice / true_false /
 * fill_blank). short_theory answers are left pending for the Grading
 * Queue — /api/student-answers/grade finishes the score once they're in.
 *
 * Uses the admin client after identifying the caller and confirming they
 * own this session. Two separate RLS gaps make the regular client a
 * non-starter here: a student has no SELECT on `questions`/
 * `question_options` (so grading data comes back null), and `results`
 * only has a SELECT policy for students, scoped to `published = true` —
 * there's no INSERT policy at all, so the upsert below would be rejected
 * outright on a brand-new, unpublished result.
 */
export async function POST(req: NextRequest) {
  const { sessionId, answers } = (await req.json()) as { sessionId: string; answers: AnswersMap };
  if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

  const guard = await getCallerContext();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const admin = createAdminClient();

  const { data: session } = await admin.from("student_exam_sessions").select("id, exam_id, student_id, status, deadline_at").eq("id", sessionId).eq("school_id", ctx.schoolId).maybeSingle();
  if (!session || session.student_id !== ctx.userId) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  if (session.status !== "active") return NextResponse.json({ error: "This exam has already been submitted." }, { status: 409 });

  const { data: exam } = await admin.from("exams").select("show_result_instantly, allow_review").eq("id", session.exam_id).eq("school_id", ctx.schoolId).single();

  // ---- Fetch grading data: each question's type/points/correct answer ----
  const { data: examQuestions } = await admin
    .from("exam_questions")
    .select("questions(id, type, points, reference_answer, question_options(id, is_correct))")
    .eq("exam_id", session.exam_id)
    .eq("school_id", ctx.schoolId);

  const gradableQuestions: GradableQuestion[] = (examQuestions ?? []).map((eq: any) => ({
    id: eq.questions.id,
    type: eq.questions.type,
    points: eq.questions.points,
    referenceAnswer: eq.questions.reference_answer,
    correctOptionId: eq.questions.question_options?.find((o: any) => o.is_correct)?.id ?? null,
  }));
  const typeById = new Map(gradableQuestions.map((q) => [q.id, q.type]));

  // ---- Persist the final answer set (covers anything since the last autosave tick) ----
  // Handed in long after their own deadline? Grade only what was saved in time — late edits aren't accepted.
  const late = !!session.deadline_at && Date.now() > new Date(session.deadline_at).getTime() + SESSION_GRACE_MS;
  if (!late && answers && Object.keys(answers).length > 0) {
    const rows = Object.entries(answers).map(([questionId, a]) => {
      const isObjective = typeById.get(questionId) === "multiple_choice" || typeById.get(questionId) === "true_false";
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
    await admin.from("student_answers").upsert(rows, { onConflict: "session_id,question_id" });
  }

  // ---- Auto-grade ----
  const { data: savedAnswers } = await admin.from("student_answers").select("question_id, selected_option_id, free_text_answer").eq("session_id", sessionId).eq("school_id", ctx.schoolId);
  const submitted: SubmittedAnswer[] = (savedAnswers ?? []).map((a) => ({
    questionId: a.question_id,
    selectedOptionId: a.selected_option_id,
    freeTextAnswer: a.free_text_answer,
  }));
  const graded = gradeObjectiveAnswers(gradableQuestions, submitted);

  await Promise.all(
    graded
      .filter((g) => g.isAutoGraded)
      .map((g) =>
        admin
          .from("student_answers")
          .update({ is_auto_graded: true, points_awarded: g.pointsAwarded, graded_at: new Date().toISOString() })
          .eq("session_id", sessionId)
          .eq("question_id", g.questionId)
      )
  );

  const objectiveScore = sumAwardedPoints(graded);
  const maxScore = gradableQuestions.reduce((sum, q) => sum + q.points, 0);
  const hasPendingTheory = graded.some((g) => !g.isAutoGraded);

  // ---- Close the session and write the (possibly provisional) result ----
  await admin.from("student_exam_sessions").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", sessionId);

  await admin.from("results").upsert(
    {
      school_id: ctx.schoolId,
      student_id: session.student_id,
      exam_id: session.exam_id,
      session_id: sessionId,
      objective_score: objectiveScore,
      theory_score: 0, // filled in by /api/student-answers/grade once theory answers are marked
      total_score: objectiveScore,
      published: false,
    },
    { onConflict: "student_id,exam_id" }
  );

  return NextResponse.json({
    ok: true,
    objectiveScore,
    maxScore,
    hasPendingTheory,
    showResultInstantly: !!exam?.show_result_instantly && !hasPendingTheory,
    // Independent of showResultInstantly — a teacher can hide the score
    // until later but still let a student eventually review answers, or
    // show the score immediately without revealing which were correct.
    // The review page itself (app/api/exam-sessions/review) additionally
    // gates on every batch of the exam having ended, so this flag alone
    // doesn't leak whether review is *actually* available yet — just
    // whether the teacher intends to allow it at all.
    allowReview: !!exam?.allow_review,
  });
}
