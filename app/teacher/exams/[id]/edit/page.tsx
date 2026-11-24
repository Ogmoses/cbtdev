"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Users, Archive } from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import ExamBuilder, { type ExamFormData } from "@/components/teacher/ExamBuilder";
import BatchWindowControls, { type SittingRow } from "@/components/teacher/BatchWindowControls";
import { createClient } from "@/lib/supabase/client";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { useTeacherExamFormData } from "@/lib/useTeacherExamFormData";
import { enrollAssignedStudents } from "@/lib/enrollBatchStudents";
import PageLoading from "@/components/layout/PageLoading";

export default function EditExamPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const examId = params.id;
  const authUser = useAuthUser();
  const supabase = createClient();
  const { subjects, classes, terms, questionBank, studentsByClass, loading: refDataLoading } = useTeacherExamFormData(authUser?.id);

  const [initial, setInitial] = useState<Partial<ExamFormData> | null>(null);
  const [locked, setLocked] = useState(false);
  const [sittings, setSittings] = useState<SittingRow[]>([]); // for the open/close controls shown once the exam is locked
  const [resetBatches, setResetBatches] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingExam, setLoadingExam] = useState(true);

  useEffect(() => {
    if (!examId) return;
    (async () => {
      const [{ data: exam, error }, { data: eqRows }, { data: batchRows }] = await Promise.all([
        supabase.from("exams").select("*").eq("id", examId).single(),
        supabase.from("exam_questions").select("question_id, order_index").eq("exam_id", examId).order("order_index"),
        supabase.from("exam_batches").select("id, label, starts_at, ends_at, lab_room, stays_open, closed_at").eq("exam_id", examId),
      ]);
      if (error || !exam) {
        setLoadError("Couldn't find that exam.");
        setLoadingExam(false);
        return;
      }

      setSittings((batchRows ?? []).map((b) => ({ id: b.id, label: b.label, starts_at: b.starts_at, ends_at: b.ends_at, stays_open: b.stays_open, closed_at: b.closed_at })));
      const batchIds = (batchRows ?? []).map((b) => b.id);
      const [sessionRes, resultRes, batchStudentRes] = await Promise.all([
        supabase.from("student_exam_sessions").select("id", { count: "exact", head: true }).eq("exam_id", examId),
        supabase.from("results").select("id", { count: "exact", head: true }).eq("exam_id", examId),
        batchIds.length > 0
          ? supabase.from("batch_students").select("student_id", { count: "exact", head: true }).in("batch_id", batchIds)
          : Promise.resolve({ count: 0, error: null }),
      ]);
      // Once any of these exist, questions/batches/timing are effectively
      // load-bearing for real student data — editing them in place (which
      // means deleting and re-inserting exam_questions/exam_batches rows)
      // would cascade away sessions, results, or batch assignments that
      // already depend on the old rows. Archiving is the safe path instead
      // of allowing a structural edit here.
      //
      // If any of these three checks itself fails to run, that's treated
      // as locked rather than as zero — a broken safety check should
      // fail toward "can't edit this," not silently toward "sure, go
      // ahead," which is exactly how a genuinely broken query here went
      // unnoticed before.
      const checkFailed = !!(sessionRes.error || resultRes.error || batchStudentRes.error);
      const hasActivity = (sessionRes.count ?? 0) > 0 || (resultRes.count ?? 0) > 0 || (batchStudentRes.count ?? 0) > 0;
      const archived = exam.status === "archived";
      // A broken safety check fails toward "can't edit this," not toward
      // "sure, go ahead" — same reasoning as before, just no longer
      // conflated with the archived case below.
      setLocked(checkFailed || (hasActivity && !archived));
      setResetBatches(!checkFailed && hasActivity && archived);
      if (checkFailed) setLoadError("Couldn't confirm whether students have already engaged with this exam, so editing is disabled to be safe. Try reloading.");

      setInitial({
        title: exam.title,
        subjectId: exam.subject_id,
        classId: exam.class_id,
        termId: exam.term_id,
        durationMinutes: exam.duration_minutes,
        passMark: exam.pass_mark,
        weightPercent: exam.weight_percent,
        shuffleQuestions: exam.shuffle_questions,
        shuffleOptions: exam.shuffle_options,
        showResultInstantly: exam.show_result_instantly,
        allowReview: exam.allow_review,
        isTerminal: exam.is_terminal,
        questionIds: (eqRows ?? []).map((r) => r.question_id),
        // Replacing exam_questions is always safe — nothing references it
        // by foreign key — so the question set carries over normally even
        // when the batch schedule can't. Only exam_batches is where
        // sessions/results/batch_students actually cascade from.
        batches:
          !checkFailed && hasActivity && archived
            ? []
            : (batchRows ?? []).map((b) => ({
                id: b.id,
                label: b.label,
                startsAt: b.starts_at,
                endsAt: b.ends_at,
                labRoom: b.lab_room ?? undefined,
                staysOpen: !!b.stays_open,
                windowMinutes: (() => {
                  const mins = Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60000);
                  return mins === exam.duration_minutes ? undefined : mins;
                })(),
              })),
      });
      setLoadingExam(false);
    })();
  }, [examId]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistExam = async (data: ExamFormData, status: "draft" | "published") => {
    const { error: examError } = await supabase
      .from("exams")
      .update({
        title: data.title,
        subject_id: data.subjectId,
        class_id: data.classId,
        term_id: data.termId,
        duration_minutes: data.durationMinutes,
        pass_mark: data.passMark,
        weight_percent: data.weightPercent,
        is_terminal: data.isTerminal,
        shuffle_questions: data.shuffleQuestions,
        shuffle_options: data.shuffleOptions,
        show_result_instantly: data.showResultInstantly,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", examId);
    if (examError) throw new Error(examError.message);

    // Nothing references exam_questions by foreign key, so replacing it
    // wholesale is always safe regardless of student activity.
    await supabase.from("exam_questions").delete().eq("exam_id", examId);
    if (data.questionIds.length > 0) {
      const { error } = await supabase
        .from("exam_questions")
        .insert(data.questionIds.map((questionId, i) => ({ exam_id: examId, question_id: questionId, order_index: i })));
      if (error) throw new Error(error.message);
    }

    // exam_batches is different: sessions and batch_students cascade from
    // it directly, so deleting existing rows is only safe when this page
    // already confirmed nothing depends on them (locked === false and
    // resetBatches === false). When resetBatches is true, the edit page
    // loaded an empty batch list to begin with — everything in data.batches
    // here is new, so there's nothing old to delete and this only inserts.
    if (!resetBatches) {
      await supabase.from("exam_batches").delete().eq("exam_id", examId);
    }
    if (data.batches.length > 0) {
      const { data: insertedBatches, error } = await supabase
        .from("exam_batches")
        .insert(
          data.batches.map((b) => ({
            exam_id: examId,
            label: b.label,
            starts_at: new Date(b.startsAt).toISOString(),
            ends_at: new Date(b.endsAt).toISOString(),
            lab_room: b.labRoom || null,
            stays_open: !!b.staysOpen,
          }))
        )
        .select("id");
      if (error) throw new Error(error.message);

      const draftToReal = new Map(data.batches.map((b, i) => [b.id, insertedBatches?.[i]?.id]));
      const realAssignments: Record<string, string> = {};
      for (const [studentId, draftBatchId] of Object.entries(data.studentAssignments)) {
        const realBatchId = draftToReal.get(draftBatchId);
        if (realBatchId) realAssignments[studentId] = realBatchId;
      }
      await enrollAssignedStudents(realAssignments);
    }

    if (status === "published") {
      setTimeout(() => router.push("/teacher/exams"), 1400);
    } else {
      router.push("/teacher/exams");
    }
  };

  const loading = refDataLoading || loadingExam;

  return (
    <DashboardLayout role="teacher" pageTitle="Edit exam" userName={authUser?.fullName ?? ""} onLogout={() => signOutAndRedirect(router)}>
      {loading ? (
        <PageLoading />
      ) : loadError ? (
        <p className="py-10 text-center text-[13px] text-ink/50 dark:text-white/50">{loadError}</p>
      ) : locked ? (
        <>
        <div className="mx-auto mt-4 max-w-md rounded-lg border border-warning/30 bg-warning/10 p-5 text-center">
          <AlertTriangle size={22} className="mx-auto text-warning" />
          <h1 className="mt-2 font-display text-[15px] font-semibold text-ink dark:text-white">This exam can't be edited directly</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60 dark:text-white/60">
            Students have already been assigned to it, started it, or finished it, so changing its questions or schedule now could disrupt or lose their work. View who's involved, or archive it from My Exams — once archived you can come back here to edit it and set up a new round. You can still close or reopen its sittings below.
          </p>
          <div className="mt-4 flex justify-center gap-2.5">
            <Link
              href="/teacher/exams"
              className="flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2 text-[13px] font-medium text-ink/70 dark:text-white/70 hover:bg-background-muted dark:hover:bg-white/5"
            >
              <Users size={14} /> Back to My Exams
            </Link>
          </div>
        </div>
        <BatchWindowControls sittings={sittings} />
        </>
      ) : (
        <>
          {resetBatches && (
            <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-black/10 dark:border-white/15 bg-background-muted dark:bg-white/5 px-4 py-3 text-[12.5px] leading-relaxed text-ink/65 dark:text-white/65">
              This exam's earlier sittings had real students in them, so that schedule is kept exactly as it happened rather than being editable here — it stays visible in Students on My Exams. The batch list below starts empty: add a new one to set up this round, then Publish when ready.
            </div>
          )}
        <ExamBuilder
          subjects={subjects}
          classes={classes}
          terms={terms}
          questionBank={questionBank}
          studentsByClass={studentsByClass}
          initial={initial ?? undefined}
          onSaveDraft={(data) => persistExam(data, "draft")}
          onPublish={(data) => persistExam(data, "published")}
        />
        </>
      )}
    </DashboardLayout>
  );
}
