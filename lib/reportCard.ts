import type { SupabaseClient } from "@supabase/supabase-js";
import { computeGradeLetter, computeTermSubjectRollup, type WeightedExamScore } from "./grading";
import type { ReportCardData, ReportCardSubjectRow } from "@/components/reports/types";

/**
 * Used only if the school's row is missing or a field is blank — the real
 * values come from the Settings screen (see buildReportCardData). Generic on
 * purpose: it must never show another school's name or motto.
 */
const SCHOOL_PROFILE_FALLBACK = {
  schoolName: "School Report Card",
  schoolMotto: "",
  schoolAddress: "",
  logoUrl: null as string | null,
};

interface ExamMeta {
  id: string;
  subject_id: string;
  weight_percent: number;
  is_terminal: boolean;
}

/**
 * Max score for each exam, read straight off `exams.max_score` — a column
 * the database keeps in sync itself (see migration 004) whenever questions
 * are added, removed, or repointed. Deliberately not computed here by
 * joining into `exam_questions` -> `questions`: a student reading their
 * own score needs this number, but students (correctly) have no RLS
 * access to the `questions` table itself, which also holds each
 * question's answer key. That mismatch used to throw mid-render — the
 * nested `questions` field came back `null` under RLS, and `.points` on
 * `null` crashed with no try/catch around it, which hung the whole page
 * on its loading spinner forever with no error shown. Reading a plain
 * column on `exams` (which students already have row-level access to)
 * sidesteps needing any table permission that couldn't safely be granted.
 */
export async function fetchExamMaxScores(supabase: SupabaseClient, examIds: string[]): Promise<Map<string, number>> {
  if (examIds.length === 0) return new Map();
  const { data } = await supabase.from("exams").select("id, max_score").in("id", examIds);
  return new Map((data ?? []).map((row) => [row.id, row.max_score ?? 0]));
}

/**
 * Builds every subject's CA/Terminal/Total rollup for every student in a
 * class+term in one pass, so ranking (which needs everyone's total) and
 * this one student's report card share the same underlying computation.
 */
async function computeClassRollups(supabase: SupabaseClient, classId: string, termId: string) {
  const { data: rows } = await supabase
    .from("results")
    .select("student_id, total_score, exams!inner(id, subject_id, class_id, term_id, weight_percent, is_terminal, subjects(name))")
    .eq("exams.term_id", termId)
    .eq("exams.class_id", classId)
    .eq("published", true);

  const examIds = [...new Set((rows ?? []).map((r: any) => r.exams.id as string))];
  const maxScores = await fetchExamMaxScores(supabase, examIds);

  // studentId -> subjectId -> weighted exam scores contributing to that subject
  const byStudentSubject = new Map<string, Map<string, { name: string; scores: (WeightedExamScore & { isTerminal: boolean })[] }>>();

  for (const row of rows ?? []) {
    const exam = (row as any).exams as ExamMeta & { subjects: { name: string } };
    const studentMap = byStudentSubject.get(row.student_id) ?? new Map();
    const subjectEntry = studentMap.get(exam.subject_id) ?? { name: exam.subjects.name, scores: [] };
    subjectEntry.scores.push({
      examId: exam.id,
      totalScore: row.total_score,
      maxScore: maxScores.get(exam.id) ?? 1,
      weightPercent: exam.weight_percent,
      isTerminal: exam.is_terminal,
    });
    studentMap.set(exam.subject_id, subjectEntry);
    byStudentSubject.set(row.student_id, studentMap);
  }

  // studentId -> { subjects: ReportCardSubjectRow[], overallPercent }
  const perStudent = new Map<string, { subjects: ReportCardSubjectRow[]; overallPercent: number }>();
  for (const [studentId, subjectMap] of byStudentSubject) {
    const subjectRows: ReportCardSubjectRow[] = [];
    for (const { name, scores } of subjectMap.values()) {
      const { caScore, terminalScore, totalScore } = computeTermSubjectRollup(scores);
      subjectRows.push({ subjectName: name, caScore, terminalScore, totalScore, maxScore: 100, gradeLetter: null, remark: null });
    }
    const overallPercent = subjectRows.length ? subjectRows.reduce((s, r) => s + r.totalScore, 0) / subjectRows.length : 0;
    perStudent.set(studentId, { subjects: subjectRows, overallPercent });
  }

  return perStudent;
}

export async function buildReportCardData(
  supabase: SupabaseClient,
  studentId: string,
  termId: string,
  opts: { teacherComment?: string; principalName?: string; resolvePhoto?: (stored: string | null) => Promise<string | null> } = {}
): Promise<ReportCardData> {
  const { data: student } = await supabase.from("users").select("full_name, admission_number, class_id, photo_url, school_id").eq("id", studentId).single();
  if (!student || !student.class_id) throw new Error("Student not found or has no class assigned.");

  const { data: klass } = await supabase.from("classes").select("id, name").eq("id", student.class_id).single();
  const { data: term } = await supabase.from("terms").select("name, academic_session_id").eq("id", termId).single();
  const { data: session } = term ? await supabase.from("academic_sessions").select("name").eq("id", term.academic_session_id).single() : { data: null };

  // Name, motto, address and logo come from Settings — the STUDENT'S school.
  const { data: profile } = await supabase.from("schools").select("name, motto, address, logo_url").eq("id", student.school_id).maybeSingle();
  const schoolProfile = {
    schoolName: profile?.name?.trim() || SCHOOL_PROFILE_FALLBACK.schoolName,
    schoolMotto: profile?.motto?.trim() || SCHOOL_PROFILE_FALLBACK.schoolMotto,
    schoolAddress: profile?.address?.trim() || SCHOOL_PROFILE_FALLBACK.schoolAddress,
    logoUrl: profile?.logo_url || SCHOOL_PROFILE_FALLBACK.logoUrl,
  };

  const { data: scaleRows } = await supabase.from("grading_scale").select("min_score, max_score, grade_letter, remark").eq("school_id", student.school_id);
  const scale = (scaleRows ?? []).map((r) => ({ minScore: r.min_score, maxScore: r.max_score, gradeLetter: r.grade_letter }));
  const remarkByGrade = new Map((scaleRows ?? []).map((r) => [r.grade_letter, r.remark as string | null]));

  const perStudent = await computeClassRollups(supabase, klass!.id, termId);
  const thisStudent = perStudent.get(studentId) ?? { subjects: [], overallPercent: 0 };

  const subjects = thisStudent.subjects
    .map((s) => ({ ...s, gradeLetter: computeGradeLetter(s.totalScore, scale), remark: remarkByGrade.get(computeGradeLetter(s.totalScore, scale) ?? "") ?? null }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  const ranked = [...perStudent.entries()].sort((a, b) => b[1].overallPercent - a[1].overallPercent);
  const positionInClass = ranked.findIndex(([id]) => id === studentId) + 1;

  return {
    ...schoolProfile,
    studentName: student.full_name,
    admissionNumber: student.admission_number ?? "",
    className: klass?.name ?? "",
    // photo_url is a path in a private bucket: the route that called us turns it into a signed link (screen) or the image itself (PDF)
    studentPhotoUrl: opts.resolvePhoto ? await opts.resolvePhoto(student.photo_url) : student.photo_url,
    termName: term?.name ?? "",
    sessionName: (session as any)?.name ?? "",
    subjects,
    overallTotal: thisStudent.overallPercent,
    overallMaxTotal: 100,
    overallGradeLetter: computeGradeLetter(thisStudent.overallPercent, scale),
    positionInClass: positionInClass || perStudent.size,
    classSize: perStudent.size,
    teacherComment: opts.teacherComment ?? "",
    principalName: opts.principalName,
  };
}
