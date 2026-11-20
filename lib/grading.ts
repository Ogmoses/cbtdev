/**
 * Pure grading logic — no Supabase calls in here on purpose, so it's easy
 * to unit-test and to reuse from both the submit route and any admin
 * "re-grade" tooling later. Route handlers fetch the rows and pass plain
 * data in; these functions never touch the network.
 */

export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "short_theory";

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  points: number;
  correctOptionId?: string | null; // multiple_choice / true_false
  referenceAnswer?: string | null; // fill_blank — exact-match target
}

export interface SubmittedAnswer {
  questionId: string;
  selectedOptionId?: string | null;
  freeTextAnswer?: string | null;
}

export interface GradedAnswer {
  questionId: string;
  isAutoGraded: boolean;
  pointsAwarded: number | null; // null = awaiting manual grading (short_theory)
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Grades every objective answer immediately (multiple_choice, true_false,
 * fill_blank — exact match only, no partial credit or synonym handling).
 * short_theory always comes back pending; a teacher grades it in the
 * Grading Queue, which is what eventually completes the picture.
 */
export function gradeObjectiveAnswers(questions: GradableQuestion[], answers: SubmittedAnswer[]): GradedAnswer[] {
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  return questions.map((q) => {
    const answer = answerByQuestion.get(q.id);

    if (q.type === "multiple_choice" || q.type === "true_false") {
      const correct = !!answer?.selectedOptionId && answer.selectedOptionId === q.correctOptionId;
      return { questionId: q.id, isAutoGraded: true, pointsAwarded: correct ? q.points : 0 };
    }

    if (q.type === "fill_blank") {
      const correct = !!answer?.freeTextAnswer && !!q.referenceAnswer && normalize(answer.freeTextAnswer) === normalize(q.referenceAnswer);
      return { questionId: q.id, isAutoGraded: true, pointsAwarded: correct ? q.points : 0 };
    }

    // short_theory
    return { questionId: q.id, isAutoGraded: false, pointsAwarded: null };
  });
}

/** Sum of points across answers that have a score — ignores pending (null) ones. */
export function sumAwardedPoints(graded: { pointsAwarded: number | null }[]): number {
  return graded.reduce((sum, g) => sum + (g.pointsAwarded ?? 0), 0);
}

/** True once every answer in the list has been graded (no more nulls). */
export function isFullyGraded(graded: { pointsAwarded: number | null }[]): boolean {
  return graded.every((g) => g.pointsAwarded !== null);
}

export interface GradeBand {
  minScore: number;
  maxScore: number;
  gradeLetter: string;
}

/** Looks up the letter grade for a percentage (0–100) against the school's grading_scale rows. */
export function computeGradeLetter(percentage: number, scale: GradeBand[]): string | null {
  const band = scale.find((b) => percentage >= b.minScore && percentage <= b.maxScore);
  return band?.gradeLetter ?? null;
}

/**
 * Splits a subject's weighted exams into CA/CBT vs Terminal buckets (using
 * each exam's `is_terminal` flag) and returns all three numbers a report
 * card needs. `total` already accounts for both buckets' weights, so it's
 * not simply ca+terminal — it's rollupWeightedScore() across everything.
 */
export function computeTermSubjectRollup(scores: (WeightedExamScore & { isTerminal: boolean })[]): {
  /** null when this subject has no CA/CBT exam result this term (shown as "N/A", not as a misleading 0). */
  caScore: number | null;
  /** null when this subject has no terminal exam result this term. */
  terminalScore: number | null;
  totalScore: number;
} {
  const ca = scores.filter((s) => !s.isTerminal);
  const terminal = scores.filter((s) => s.isTerminal);
  return {
    caScore: ca.length ? rollupWeightedScore(ca).percentageOf100 : null,
    terminalScore: terminal.length ? rollupWeightedScore(terminal).percentageOf100 : null,
    totalScore: scores.length ? rollupWeightedScore(scores).percentageOf100 : 0,
  };
}

export interface WeightedExamScore {
  examId: string;
  totalScore: number;
  maxScore: number;
  weightPercent: number; // e.g. 30 for a CA/CBT exam, 70 for the terminal exam
}

export interface RollupResult {
  percentageOf100: number;
  weightSumUsed: number;
  /** Set when the exams' weights for this subject/term don't add up to 100 — surface this to the admin rather than silently normalizing away a configuration mistake. */
  warning?: string;
}

/**
 * Combines several weighted exams (e.g. 30% CBT + 70% Terminal) into one
 * percentage out of 100 for a student's term_subject_results row. Weights
 * are read from each exam's `weight_percent` column, not hardcoded here,
 * so the school can use any split (30/70, 40/60, three-CA-plus-terminal…).
 */
export function rollupWeightedScore(scores: WeightedExamScore[]): RollupResult {
  const weightSumUsed = scores.reduce((sum, s) => sum + s.weightPercent, 0);
  if (weightSumUsed === 0) return { percentageOf100: 0, weightSumUsed, warning: "No weighted exams contributed." };

  const weighted = scores.reduce((sum, s) => sum + (s.totalScore / s.maxScore) * s.weightPercent, 0);
  const percentageOf100 = (weighted / weightSumUsed) * 100;

  const warning = Math.abs(weightSumUsed - 100) > 0.5 ? `Weights for this subject/term sum to ${weightSumUsed}%, not 100% — check exam weight_percent values.` : undefined;

  return { percentageOf100, weightSumUsed, warning };
}
