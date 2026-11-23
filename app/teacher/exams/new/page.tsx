"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import ExamBuilder, { type ExamFormData } from "@/components/teacher/ExamBuilder";
import { createClient } from "@/lib/supabase/client";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { useTeacherExamFormData } from "@/lib/useTeacherExamFormData";
import { enrollAssignedStudents } from "@/lib/enrollBatchStudents";
import PageLoading from "@/components/layout/PageLoading";

export default function NewExamPage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const supabase = createClient();
  const { subjects, classes, terms, questionBank, studentsByClass, loading } = useTeacherExamFormData(authUser?.id);

  // "Reuse" on an exam with real activity duplicates it into a fresh one
  // here rather than editing in place — everything about the exam
  // carries over (title, settings, questions) except the schedule, since
  // a duplicate is inherently a new round that needs its own batch(es).
  const [duplicateInitial, setDuplicateInitial] = useState<Partial<ExamFormData> | undefined>(undefined);
  const [loadingDuplicate, setLoadingDuplicate] = useState(false);

  useEffect(() => {
    const duplicateFromId = new URLSearchParams(window.location.search).get("duplicateFrom");
    if (!duplicateFromId) return;
    setLoadingDuplicate(true);
    (async () => {
      const [{ data: exam }, { data: eqRows }] = await Promise.all([
        supabase.from("exams").select("*").eq("id", duplicateFromId).single(),
        supabase.from("exam_questions").select("question_id, order_index").eq("exam_id", duplicateFromId).order("order_index"),
      ]);
      if (exam) {
        setDuplicateInitial({
          title: `${exam.title} (Copy)`,
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
          batches: [],
        });
      }
      setLoadingDuplicate(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persistExam = async (data: ExamFormData, status: "draft" | "published") => {
    if (!authUser) return;

    const { data: exam, error: examError } = await supabase
      .from("exams")
      .insert({
        title: data.title,
        subject_id: data.subjectId,
        class_id: data.classId,
        term_id: data.termId,
        created_by: authUser.id,
        duration_minutes: data.durationMinutes,
        pass_mark: data.passMark,
        weight_percent: data.weightPercent,
        is_terminal: data.isTerminal,
        shuffle_questions: data.shuffleQuestions,
        shuffle_options: data.shuffleOptions,
        show_result_instantly: data.showResultInstantly,
        allow_review: data.allowReview,
        status,
      })
      .select("id")
      .single();
    if (examError || !exam) throw new Error(examError?.message ?? "Couldn't save the exam.");

    if (data.questionIds.length > 0) {
      const { error: eqError } = await supabase
        .from("exam_questions")
        .insert(data.questionIds.map((questionId, i) => ({ exam_id: exam.id, question_id: questionId, order_index: i })));
      if (eqError) throw new Error(eqError.message);
    }

    if (data.batches.length > 0) {
      const { data: insertedBatches, error: batchError } = await supabase
        .from("exam_batches")
        .insert(
          data.batches.map((b) => ({
            exam_id: exam.id,
            label: b.label,
            starts_at: new Date(b.startsAt).toISOString(),
            ends_at: new Date(b.endsAt).toISOString(),
            lab_room: b.labRoom || null,
            stays_open: !!b.staysOpen,
          }))
        )
        .select("id");
      if (batchError) throw new Error(batchError.message);

      const draftToReal = new Map(data.batches.map((b, i) => [b.id, insertedBatches?.[i]?.id]));
      const realAssignments: Record<string, string> = {};
      for (const [studentId, draftBatchId] of Object.entries(data.studentAssignments)) {
        const realBatchId = draftToReal.get(draftBatchId);
        if (realBatchId) realAssignments[studentId] = realBatchId;
      }
      await enrollAssignedStudents(realAssignments);
    }

    // Publishing shows its own toast inside ExamBuilder before this fires;
    // a draft save has no equivalent affirmation, so it goes straight back
    // rather than lingering with no feedback either way.
    if (status === "published") {
      setTimeout(() => router.push("/teacher/exams"), 1400);
    } else {
      router.push("/teacher/exams");
    }
  };

  return (
    <DashboardLayout role="teacher" pageTitle="New exam" userName={authUser?.fullName ?? ""} onLogout={() => signOutAndRedirect(router)}>
      {loading || loadingDuplicate ? <PageLoading /> : (
        <ExamBuilder
          subjects={subjects}
          classes={classes}
          terms={terms}
          questionBank={questionBank}
          studentsByClass={studentsByClass}
          initial={duplicateInitial}
          onSaveDraft={(data) => persistExam(data, "draft")}
          onPublish={(data) => persistExam(data, "published")}
        />
      )}
    </DashboardLayout>
  );
}
