"use client";

import { batchState } from "@/lib/batchWindow";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import ExamLaunchpad, {
  type AvailableExam,
  type UpcomingBatch,
  type PastResult,
} from "@/components/student/ExamLaunchpad";
import { createClient } from "@/lib/supabase/client";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { fetchExamMaxScores } from "@/lib/reportCard";
import { getReliableNow } from "@/lib/serverTime";
import PageLoading from "@/components/layout/PageLoading";
import ErrorState from "@/components/layout/ErrorState";

export default function StudentHomePage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const supabase = createClient();

  const [availableExams, setAvailableExams] = useState<AvailableExam[]>([]);
  const [upcomingBatches, setUpcomingBatches] = useState<UpcomingBatch[]>([]);
  const [pastResults, setPastResults] = useState<PastResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // Uses the server's clock, not this device's — a wrong or
        // deliberately fast-forwarded device clock would otherwise hide
        // a genuinely open exam, or make a not-yet-open one look
        // available (see lib/serverTime.ts and app/api/server-time).
        const now = await getReliableNow();

        const [{ data: batchRows }, { data: sessionRows }, { data: resultRows }] = await Promise.all([
          supabase
            .from("batch_students")
            .select("exam_batches(id, label, starts_at, ends_at, stays_open, closed_at, exams(id, title, duration_minutes, subjects(name)))")
            .eq("student_id", authUser.id),
          supabase.from("student_exam_sessions").select("exam_id, status").eq("student_id", authUser.id),
          supabase
            .from("results")
            .select("exam_id, total_score, grade_letter, exams(id, title, subjects(name), terms(name))")
            .eq("student_id", authUser.id)
            .eq("published", true),
        ]);

        const sessionStatusByExam = new Map((sessionRows ?? []).map((s) => [s.exam_id, s.status]));

        const available: AvailableExam[] = [];
        const upcoming: UpcomingBatch[] = [];

        for (const row of batchRows ?? []) {
          const b = (row as any).exam_batches;
          if (!b || !b.exams) continue;
          const state = batchState(b, now);
          const status = sessionStatusByExam.get(b.exams.id);
          if (status === "submitted") continue; // already done — no longer relevant to the launchpad

          // Open sittings can be entered. Someone already mid-exam can still resume even if the sitting has since
          // closed — they carry on to their own deadline.
          if (state === "open" || (state === "ended" && status === "active")) {
            available.push({
              examId: b.exams.id,
              batchId: b.id,
              title: b.exams.title,
              subjectName: b.exams.subjects?.name ?? "",
              durationMinutes: b.exams.duration_minutes,
              batchLabel: b.label,
              batchStartsAt: b.starts_at,
              batchEndsAt: b.ends_at,
              windowState: "open",
              alreadyInProgress: status === "active",
            });
          } else if (state === "upcoming") {
            upcoming.push({
              id: b.id,
              examTitle: b.exams.title,
              subjectName: b.exams.subjects?.name ?? "",
              batchLabel: b.label,
              startsAt: b.starts_at,
            });
          }
        }

        const examIds = [...new Set((resultRows ?? []).map((r) => r.exam_id))];
        const maxScores = await fetchExamMaxScores(supabase, examIds);

        if (cancelled) return;
        setAvailableExams(available);
        setUpcomingBatches(upcoming);
        setPastResults(
          (resultRows ?? []).map((r: any) => ({
            id: r.exam_id,
            examTitle: r.exams?.title ?? "",
            subjectName: r.exams?.subjects?.name ?? "",
            termName: r.exams?.terms?.name ?? "",
            totalScore: r.total_score,
            maxScore: maxScores.get(r.exam_id) ?? 0,
            gradeLetter: r.grade_letter,
            takenAt: new Date().toISOString(), // `results` doesn't store a submitted-at timestamp of its own
          }))
        );
      } catch (err) {
        // Whatever the cause — a real bug, a dropped connection mid-fetch,
        // anything — this page used to just sit on "Loading…" forever
        // with no feedback at all. A caught error and a retry button beats
        // a spinner that never resolves.
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Couldn't load your exams. Check your connection and try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, retryCount]);

  return (
    <DashboardLayout role="student" pageTitle="Exam Launchpad" userName={authUser?.fullName ?? ""} onLogout={() => signOutAndRedirect(router)}>
      {loading ? (
        <PageLoading />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => setRetryCount((c) => c + 1)} />
      ) : (
        <ExamLaunchpad
          studentName={authUser?.fullName ?? ""}
          availableExams={availableExams}
          upcomingBatches={upcomingBatches}
          pastResults={pastResults}
        />
      )}
    </DashboardLayout>
  );
}
