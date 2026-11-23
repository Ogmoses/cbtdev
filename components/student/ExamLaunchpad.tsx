"use client";

/**
 * Student Exam Launchpad
 *
 * The student's home screen: exams they can enter right now (within their
 * assigned batch window), batches coming up later, and past results.
 * Feed it real data from `exam_batches` / `batch_students` / `results`
 * (see database/schema.sql) — the shapes below mirror those tables closely
 * so the swap is mostly a fetch, not a redesign.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getReliableNowSync } from "@/lib/serverTime";
import {
  Clock,
  ChevronRight,
  CalendarClock,
  CheckCircle2,
  Lock,
  Award,
} from "lucide-react";

export interface AvailableExam {
  examId: string;
  batchId: string;
  title: string;
  subjectName: string;
  durationMinutes: number;
  batchLabel: string;
  batchStartsAt: string; // ISO
  batchEndsAt: string; // ISO
  /** Worked out by the page with the shared window rule (handles sittings that stay open / were closed by the teacher). */
  windowState?: "open" | "ended" | "upcoming";
  alreadyInProgress: boolean;
}

export interface UpcomingBatch {
  id: string;
  examTitle: string;
  subjectName: string;
  batchLabel: string;
  startsAt: string; // ISO
}

export interface PastResult {
  id: string;
  examTitle: string;
  subjectName: string;
  termName: string;
  totalScore: number;
  maxScore: number;
  gradeLetter: string | null;
  takenAt: string; // ISO
}

interface ExamLaunchpadProps {
  studentName: string;
  availableExams: AvailableExam[];
  upcomingBatches: UpcomingBatch[];
  pastResults: PastResult[];
}

export default function ExamLaunchpad({ studentName, availableExams, upcomingBatches, pastResults }: ExamLaunchpadProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => getReliableNowSync());

  // Refresh "now" periodically so batch windows open/close live on screen,
  // without a full countdown-timer tick (that belongs to ExamInterface).
  // Uses the device clock corrected against the server's (see
  // lib/serverTime.ts) rather than a raw `new Date()` here too — the
  // initial page load already resolved the offset, so this just reuses
  // it rather than re-fetching every 30 seconds.
  useEffect(() => {
    const t = setInterval(() => setNow(getReliableNowSync()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Names are entered surname-first per the school's convention (e.g. "OG
  // Moses" — surname "OG", given name "Moses"), so the one to greet with
  // is the last word, not the first.
  const firstName = studentName.trim().split(/\s+/).pop() ?? studentName;

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="font-display text-[19px] font-semibold text-ink dark:text-white sm:text-[22px]">Welcome back, {firstName}</h1>
        <p className="mt-0.5 text-[13px] text-ink/50 dark:text-white/50">Here's what's on your CBT schedule today.</p>
      </div>

      {/* ---------- Available Exams ---------- */}
      <Section title="Available exams" subtitle="Enter when your batch window is open">
        {availableExams.length === 0 ? (
          <EmptyState message="No exams are open for you right now. Check Upcoming Batches below." />
        ) : (
          /* flex-wrap rather than a fixed-column grid: a grid with only
             1–2 cards in a 3-column row leaves two empty equal-width
             tracks beside it, which reads as "the page isn't using the
             screen" on a wide desktop monitor. Flex-wrap lets each card
             take its own natural width and wrap only once there's
             actually enough content to need it. */
          <div className="flex flex-wrap gap-4">
            {availableExams.map((exam) => (
              <ExamCard key={exam.examId} exam={exam} now={now} onEnter={() => router.push(`/student/exam/${exam.examId}?batch=${exam.batchId}`)} />
            ))}
          </div>
        )}
      </Section>

      {/* ---------- Upcoming Batches ---------- */}
      <Section title="Upcoming batches" subtitle="Exams scheduled for you later">
        {upcomingBatches.length === 0 ? (
          <EmptyState message="Nothing scheduled yet — your teacher will assign your next batch." />
        ) : (
          <div className="divide-y divide-black/5 rounded-lg border border-black/5 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-[#1A1C20]">
            {upcomingBatches.map((b) => (
              <div key={b.id} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cream-100 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
                  <CalendarClock size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink dark:text-white">{b.examTitle}</p>
                  <p className="truncate text-[12px] text-ink/50 dark:text-white/50">{b.subjectName} · {b.batchLabel}</p>
                </div>
                <p className="shrink-0 text-[12px] font-medium text-ink/60 dark:text-white/60">{formatWhen(b.startsAt, now)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---------- Past Results ---------- */}
      <Section title="Past results" subtitle="Published scores from exams you've completed">
        {pastResults.length === 0 ? (
          <EmptyState message="Your results will appear here once a teacher publishes them." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-black/5 bg-white dark:border-white/10 dark:bg-[#1A1C20]">
            {/* Mobile: stacked cards */}
            <div className="divide-y divide-black/5 dark:divide-white/10 sm:hidden">
              {pastResults.map((r) => (
                <div key={r.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-ink dark:text-white">{r.examTitle}</p>
                      <p className="text-[12px] text-ink/50 dark:text-white/50">{r.subjectName} · {r.termName}</p>
                    </div>
                    <ScoreBadge score={r.totalScore} max={r.maxScore} grade={r.gradeLetter} />
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: table */}
            <table className="hidden w-full text-left sm:table">
              <thead>
                <tr className="border-b border-black/5 text-[11.5px] uppercase tracking-wide text-ink/40 dark:border-white/10 dark:text-white/40">
                  <th className="px-5 py-3 font-medium">Exam</th>
                  <th className="px-5 py-3 font-medium">Term</th>
                  <th className="px-5 py-3 font-medium">Score</th>
                  <th className="px-5 py-3 font-medium">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/10">
                {pastResults.map((r) => (
                  <tr key={r.id} className="text-[13px] text-ink dark:text-white">
                    <td className="px-5 py-3.5">
                      <p className="font-medium">{r.examTitle}</p>
                      <p className="text-[12px] text-ink/45 dark:text-white/45">{r.subjectName}</p>
                    </td>
                    <td className="px-5 py-3.5 text-ink/60 dark:text-white/60">{r.termName}</td>
                    <td className="px-5 py-3.5 font-medium tabular-nums">
                      {r.totalScore} / {r.maxScore}
                    </td>
                    <td className="px-5 py-3.5">
                      <GradePill grade={r.gradeLetter} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3.5">
        <h2 className="font-display text-[15px] font-semibold text-ink dark:text-white">{title}</h2>
        <p className="text-[12px] text-ink/45 dark:text-white/45">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function ExamCard({ exam, now, onEnter }: { exam: AvailableExam; now: Date; onEnter: () => void }) {
  const startsAt = new Date(exam.batchStartsAt);
  const endsAt = new Date(exam.batchEndsAt);
  const isOpen = exam.windowState ? exam.windowState === "open" : now >= startsAt && now <= endsAt;
  const isPast = exam.windowState ? exam.windowState === "ended" : now > endsAt;

  return (
    <div className="flex w-full flex-col rounded-lg border border-black/5 bg-white p-4.5 shadow-card transition-shadow duration-200 hover:shadow-card-hover dark:border-white/10 dark:bg-[#1A1C20] sm:w-[320px]">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-semibold text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{exam.subjectName}</span>
        <span className="flex items-center gap-1 text-[11.5px] text-ink/45 dark:text-white/45">
          <Clock size={12} /> {exam.durationMinutes} min
        </span>
      </div>

      <p className="text-[14.5px] font-semibold text-ink dark:text-white">{exam.title}</p>
      <p className="mt-0.5 text-[12px] text-ink/50 dark:text-white/50">{exam.batchLabel}</p>

      <div className="mt-4 flex-1" />

      {isPast ? (
        <div className="flex items-center gap-1.5 rounded-md bg-background-muted px-3 py-2 text-[12px] font-medium text-ink/50 dark:bg-white/5 dark:text-white/50">
          <Lock size={13} /> Batch window closed
        </div>
      ) : isOpen ? (
        <button
          onClick={onEnter}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-crimson-600 py-2.5 text-[13px] font-semibold text-on-crimson transition-colors duration-200 hover:bg-crimson-700"
        >
          {exam.alreadyInProgress ? "Resume exam" : "Enter exam"} <ChevronRight size={15} />
        </button>
      ) : (
        <div className="flex items-center gap-1.5 rounded-md bg-background-muted px-3 py-2 text-[12px] font-medium text-ink/50 dark:bg-white/5 dark:text-white/50">
          <Clock size={13} /> Opens {formatWhen(exam.batchStartsAt, now)}
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score, max, grade }: { score: number; max: number; grade: string | null }) {
  return (
    <div className="flex shrink-0 flex-col items-end">
      <p className="text-[13px] font-semibold tabular-nums text-ink dark:text-white">{score}/{max}</p>
      <GradePill grade={grade} />
    </div>
  );
}

function GradePill({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-[11px] text-ink/40 dark:text-white/40">Pending</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-crimson-50 px-2 py-0.5 text-[11px] font-semibold text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
      <Award size={11} /> {grade}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-black/10 bg-white px-4 py-6 text-[13px] text-ink/45 dark:border-white/15 dark:bg-[#1A1C20] dark:text-white/45">
      <CheckCircle2 size={16} className="shrink-0 text-ink/25 dark:text-white/25" />
      {message}
    </div>
  );
}

function formatWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin <= 0) return "now";
  if (diffMin < 60) return `in ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;

  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
    " · " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
