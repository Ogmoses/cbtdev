import { NextRequest, NextResponse } from "next/server";
import { getCallerContext } from "@/lib/auth/callerContext";
import { createAdminClient } from "@/lib/supabase/admin";
import { batchState } from "@/lib/batchWindow";

/**
 * GET /api/exam-sessions/review?examId=...
 *
 * Lets a student see their own completed exam question-by-question —
 * their answer, the correct one, and points awarded — gated behind three
 * checks, in order:
 *   1. The teacher turned on `exams.allow_review` for this exam at all.
 *   2. This student's own session is actually finished (not still active
 *      — no peeking at answers mid-exam).
 *   3. Every batch of this exam has ended, not just this student's own
 *      sitting. An exam can run across multiple time slots (see
 *      exam_batches); without this check, a student who finishes early
 *      could see (and share) correct answers with classmates who haven't
 *      sat the exam yet in a later batch.
 *
 * Uses the admin client for the same reason submit/route.ts does: a
 * student has no RLS access to `questions`/`question_options` at all
 * (they hold answer keys), so building this view requires bypassing RLS
 * deliberately, behind the ownership + timing checks above rather than
 * relying on row-level security to gate it.
 */
export async function GET(req: NextRequest) {
  const examId = req.nextUrl.searchParams.get("examId");
  if (!examId) return NextResponse.json({ error: "examId is required." }, { status: 400 });

  const guard = await getCallerContext();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const admin = createAdminClient();

  const { data: session } = await admin
    .from("student_exam_sessions")
    .select("id, status")
    .eq("exam_id", examId)
    .eq("student_id", ctx.userId)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "No attempt found for this exam." }, { status: 404 });
  if (session.status === "active") {
    return NextResponse.json({ error: "Finish the exam before reviewing it." }, { status: 409 });
  }

  const { data: exam } = await admin.from("exams").select("title, allow_review, max_score").eq("id", examId).eq("school_id", ctx.schoolId).maybeSingle();
  if (!exam) return NextResponse.json({ error: "Exam not found." }, { status: 404 });
  if (!exam.allow_review) {
    return NextResponse.json({ error: "Your teacher hasn't turned on review for this exam." }, { status: 403 });
  }

  const { data: batches } = await admin.from("exam_batches").select("starts_at, ends_at, stays_open, closed_at").eq("exam_id", examId).eq("school_id", ctx.schoolId);
  const allBatchesEnded = (batches ?? []).every((b) => batchState(b) === "ended");
  if (!allBatchesEnded) {
    return NextResponse.json({ error: "Review unlocks once every sitting of this exam has finished or been closed by your teacher." }, { status: 403 });
  }

  const { data: result } = await admin.from("results").select("total_score").eq("exam_id", examId).eq("student_id", ctx.userId).eq("school_id", ctx.schoolId).maybeSingle();

  const { data: examQuestions } = await admin
    .from("exam_questions")
    .select("order_index, questions(id, type, prompt, points, reference_answer, question_options(id, option_text, is_correct, order_index))")
    .eq("exam_id", examId)
    .eq("school_id", ctx.schoolId)
    .order("order_index");

  const { data: answerRows } = await admin
    .from("student_answers")
    .select("question_id, selected_option_id, free_text_answer, points_awarded")
    .eq("session_id", session.id)
    .eq("school_id", ctx.schoolId);

  const answerByQuestion = new Map((answerRows ?? []).map((a) => [a.question_id, a]));

  const questions = (examQuestions ?? []).map((eq: any) => {
    const q = eq.questions;
    const answer = answerByQuestion.get(q.id);
    return {
      questionId: q.id,
      type: q.type,
      prompt: q.prompt,
      maxPoints: q.points,
      pointsAwarded: answer?.points_awarded ?? null,
      options: (q.question_options ?? [])
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .map((o: any) => ({ id: o.id, text: o.option_text, isCorrect: o.is_correct })),
      selectedOptionId: answer?.selected_option_id ?? null,
      referenceAnswer: q.reference_answer,
      freeTextAnswer: answer?.free_text_answer ?? null,
    };
  });

  return NextResponse.json({
    examTitle: exam.title,
    totalScore: Number(result?.total_score ?? 0),
    maxScore: exam.max_score,
    questions,
  });
}
