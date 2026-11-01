"use client";

/**
 * Student — Upcoming Batches. The sidebar has linked here since it was
 * first built, but the route itself never existed — a real 404, not an
 * edge case. Shows the full schedule, not just the launchpad's summary.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { getReliableNow } from "@/lib/serverTime";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import { createClient } from "@/lib/supabase/client";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";

interface Batch {
  id: string;
  examTitle: string;
  subjectName: string;
  batchLabel: string;
  startsAt: string;
  endsAt: string;
}

export default function StudentBatchesPage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const supabase = createClient();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authUser) return;
    (async () => {
      const { data } = await supabase
        .from("batch_students")
        .select("exam_batches(id, label, starts_at, ends_at, exams(title, subjects(name)))")
        .eq("student_id", authUser.id);

      const now = await getReliableNow();
      const upcoming = (data ?? [])
        .map((row: any) => row.exam_batches)
        .filter((b: any) => b && new Date(b.starts_at) > now)
        .map((b: any) => ({
          id: b.id,
          examTitle: b.exams?.title ?? "",
          subjectName: b.exams?.subjects?.name ?? "",
          batchLabel: b.label,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
        }))
        .sort((a: Batch, b: Batch) => a.startsAt.localeCompare(b.startsAt));

      setBatches(upcoming);
      setLoading(false);
    })();
  }, [authUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DashboardLayout role="student" pageTitle="Upcoming Batches" userName={authUser?.fullName ?? ""} onLogout={() => signOutAndRedirect(router)}>
      {loading ? (
        <PageLoading />
      ) : (
        <div className="pb-10">
          <h1 className="font-display text-[18px] font-semibold text-ink dark:text-white sm:text-[20px]">Upcoming batches</h1>
          <p className="mt-0.5 text-[13px] text-ink/50 dark:text-white/50">Every exam scheduled for you that hasn't opened yet.</p>

          {batches.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-black/10 dark:border-white/15 bg-white dark:bg-[#1A1C20] px-4 py-10 text-center text-[13px] text-ink/45 dark:text-white/45">
              Nothing scheduled yet — your teacher will assign your next batch.
            </div>
          ) : (
            <div className="mt-5 divide-y divide-black/5 dark:divide-white/10 rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-[#1A1C20]">
              {batches.map((b) => (
                <div key={b.id} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cream-100 dark:bg-white/10 text-crimson-700 dark:text-crimson-500">
                    <CalendarClock size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink dark:text-white">{b.examTitle}</p>
                    <p className="truncate text-[12px] text-ink/50 dark:text-white/50">{b.subjectName} · {b.batchLabel}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[12px] font-medium text-ink/70 dark:text-white/70">{new Date(b.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                    <p className="text-[11px] text-ink/45 dark:text-white/45">{new Date(b.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}
