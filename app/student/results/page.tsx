"use client";

/**
 * Student — Past Results. Same story as Upcoming Batches: linked from the
 * sidebar since the beginning, route never actually existed. Full history
 * here, not just the launchpad's recent summary.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Award } from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import { createClient } from "@/lib/supabase/client";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { fetchExamMaxScores } from "@/lib/reportCard";
import { markSeen } from "@/lib/notificationSeen";

/** Used only if the school's own timezone can't be read. */
const FALLBACK_TIMEZONE = "Africa/Lagos";

/** "21 Nov 2026, 12:25 pm" in the given timezone; "—" when there is no time. */
function formatSubmitted(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
  try {
    return new Date(iso).toLocaleString("en-GB", { ...opts, timeZone });
  } catch {
    return new Date(iso).toLocaleString("en-GB", { ...opts, timeZone: FALLBACK_TIMEZONE });
  }
}

interface ResultRow {
  id: string;
  examTitle: string;
  subjectName: string;
  termName: string;
  totalScore: number;
  maxScore: number;
  gradeLetter: string | null;
  submittedAt: string | null;
}

export default function StudentResultsPage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const supabase = createClient();

  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeZone, setTimeZone] = useState(FALLBACK_TIMEZONE);

  useEffect(() => {
    if (!authUser) return;
    (async () => {
      const { data } = await supabase
        .from("results")
        .select("exam_id, total_score, grade_letter, exams(title, subjects(name), terms(name))")
        .eq("student_id", authUser.id)
        .eq("published", true);

      const examIds = [...new Set((data ?? []).map((r) => r.exam_id))];
      const maxScores = await fetchExamMaxScores(supabase, examIds);

      // When each exam was handed in (one sitting per student per exam), and the school's own timezone to show it in.
      const [{ data: sittings }, { data: schoolId }] = await Promise.all([
        examIds.length > 0 ? supabase.from("student_exam_sessions").select("exam_id, submitted_at").eq("student_id", authUser.id).in("exam_id", examIds) : Promise.resolve({ data: [] as { exam_id: string; submitted_at: string | null }[] }),
        supabase.rpc("get_user_school_id"),
      ]);
      const submittedAt = new Map((sittings ?? []).map((s: { exam_id: string; submitted_at: string | null }) => [s.exam_id, s.submitted_at]));
      if (schoolId) {
        const { data: school } = await supabase.from("schools").select("timezone").eq("id", schoolId as string).maybeSingle();
        if (school?.timezone) setTimeZone(school.timezone as string);
      }

      const rows: ResultRow[] = (data ?? []).map((r: any) => ({
          id: r.exam_id,
          examTitle: r.exams?.title ?? "",
          subjectName: r.exams?.subjects?.name ?? "",
          termName: r.exams?.terms?.name ?? "",
          totalScore: r.total_score,
          maxScore: maxScores.get(r.exam_id) ?? 0,
          gradeLetter: r.grade_letter,
          submittedAt: submittedAt.get(r.exam_id) ?? null,
        }));
      // newest submission first; anything without a time goes last
      rows.sort((a, b) => (b.submittedAt ? new Date(b.submittedAt).getTime() : 0) - (a.submittedAt ? new Date(a.submittedAt).getTime() : 0));
      setResults(rows);
      setLoading(false);
      void markSeen(["results"]); // they're looking at their results now: clear the bell's dot for them
    })();
  }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DashboardLayout role="student" pageTitle="Past Results" userName={authUser?.fullName ?? ""} onLogout={() => signOutAndRedirect(router)}>
      {loading ? (
        <PageLoading />
      ) : (
        <div className="pb-10">
          <h1 className="font-display text-[18px] font-semibold text-ink dark:text-white sm:text-[20px]">Past results</h1>
          <p className="mt-0.5 text-[13px] text-ink/50 dark:text-white/50">Every published score, across every term. Times are in school time ({timeZone.replace(/_/g, " ")}).</p>

          {results.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-black/10 dark:border-white/15 bg-white dark:bg-[#1A1C20] px-4 py-10 text-center text-[13px] text-ink/45 dark:text-white/45">
              Nothing published yet — your results will appear here once a teacher publishes them.
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-[#1A1C20]">
              <div className="divide-y divide-black/5 dark:divide-white/10 sm:hidden">
                {results.map((r) => (
                  <div key={r.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-ink dark:text-white">{r.examTitle}</p>
                        <p className="text-[12px] text-ink/50 dark:text-white/50">{r.subjectName} · {r.termName}</p>
                        <p className="text-[11.5px] text-ink/40 dark:text-white/40">Submitted {formatSubmitted(r.submittedAt, timeZone)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <p className="text-[13px] font-semibold tabular-nums text-ink dark:text-white">{r.totalScore}/{r.maxScore}</p>
                        {r.gradeLetter && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-crimson-50 dark:bg-crimson-600/15 px-2 py-0.5 text-[11px] font-semibold text-crimson-700 dark:text-crimson-500">
                            <Award size={11} /> {r.gradeLetter}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <table className="hidden w-full text-left sm:table">
                <thead>
                  <tr className="border-b border-black/5 dark:border-white/10 text-[11.5px] uppercase tracking-wide text-ink/40 dark:text-white/40">
                    <th className="px-5 py-3 font-medium">Exam</th>
                    <th className="px-5 py-3 font-medium">Term</th>
                    <th className="px-5 py-3 font-medium">Submitted</th>
                    <th className="px-5 py-3 font-medium">Score</th>
                    <th className="px-5 py-3 font-medium">Grade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/10">
                  {results.map((r) => (
                    <tr key={r.id} className="text-[13px] text-ink dark:text-white">
                      <td className="px-5 py-3.5">
                        <p className="font-medium">{r.examTitle}</p>
                        <p className="text-[12px] text-ink/45 dark:text-white/45">{r.subjectName}</p>
                      </td>
                      <td className="px-5 py-3.5 text-ink/60 dark:text-white/60">{r.termName}</td>
                      <td className="px-5 py-3.5 text-ink/60 dark:text-white/60 whitespace-nowrap">{formatSubmitted(r.submittedAt, timeZone)}</td>
                      <td className="px-5 py-3.5 font-medium tabular-nums">{r.totalScore} / {r.maxScore}</td>
                      <td className="px-5 py-3.5">{r.gradeLetter ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
