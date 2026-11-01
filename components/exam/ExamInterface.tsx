"use client";

/**
 * Live CBT Exam Interface — Student Portal
 *
 * Distraction-free full-screen exam runner. Handles:
 *  - Countdown timer with 5-minute / 1-minute warning states
 *  - Question palette (answered / unanswered / flagged)
 *  - Local auto-save every 5s + backend sync, with recovery on reload
 *  - Confirmation modal before final submission
 *
 * Drop into e.g. app/student/exam/[sessionId]/page.tsx and supply the
 * exam + session data server-side; this component owns all client state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MathText from "@/components/common/MathText";
import {
  Clock,
  Flag,
  Check,
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  X,
  AlertTriangle,
  CloudUpload,
  CloudCheck,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "short_theory";

export interface ExamOption {
  id: string;
  text: string;
}

export interface ExamQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  imageUrl?: string | null;
  options?: ExamOption[]; // multiple_choice / true_false
  points: number;
}

export interface ExamData {
  id: string;
  title: string;
  subjectName: string;
  durationMinutes: number;
  questions: ExamQuestion[];
}

/** answerValue: option id for MCQ/true-false, free text for fill-blank/theory */
export type AnswersMap = Record<string, { value: string; flagged: boolean }>;

interface ExamInterfaceProps {
  exam: ExamData;
  sessionId: string;
  studentName: string;
  /** Answers already saved server-side for this session (e.g. from a previous device) — used as the base state before checking this browser's local cache. */
  initialAnswers?: AnswersMap;
  /** Called on the 5s autosave tick and again on manual save. Should resolve/reject. */
  onAutoSave: (answers: AnswersMap) => Promise<void>;
  /** Called on final, confirmed submission. */
  onSubmit: (answers: AnswersMap) => Promise<void>;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_INTERVAL_MS = 5000;
const WARNING_5MIN_SECONDS = 5 * 60;
const WARNING_1MIN_SECONDS = 60;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExamInterface({ exam, sessionId, studentName, initialAnswers, onAutoSave, onSubmit }: ExamInterfaceProps) {
  const storageKey = `cbt-answers-${exam.id}-${sessionId}`;

  const [answers, setAnswers] = useState<AnswersMap>(initialAnswers ?? {});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(exam.durationMinutes * 60);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);

  const answersRef = useRef(answers);
  answersRef.current = answers;

  // ---- Restore any locally-saved progress on mount (crash / power-outage recovery).
  // This browser's own cache wins over the server-seeded initialAnswers, since it's
  // the more recent copy for whoever is sitting at this specific computer. ----
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setAnswers(JSON.parse(raw));
    } catch {
      // corrupted local cache — start clean rather than block the exam
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Countdown ----
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const handleSubmitRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (secondsLeft === 0) handleSubmitRef.current();
  }, [secondsLeft]);

  // ---- Auto-save: local every 5s, plus backend sync ----
  const persist = useCallback(async () => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(answersRef.current));
    } catch {
      // localStorage full/unavailable — backend sync below is the fallback
    }
    setSaveState("saving");
    try {
      await onAutoSave(answersRef.current);
      setSaveState("saved");
    } catch {
      setSaveState("error"); // local copy is still safe; retry on next tick
    }
  }, [onAutoSave, storageKey]);

  useEffect(() => {
    const interval = setInterval(persist, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [persist]);

  // ---- Derived state ----
  const question = exam.questions[currentIndex];
  const total = exam.questions.length;

  const stats = useMemo(() => {
    let answered = 0;
    let flagged = 0;
    for (const q of exam.questions) {
      const a = answers[q.id];
      if (a?.value?.trim()) answered++;
      if (a?.flagged) flagged++;
    }
    return { answered, unanswered: total - answered, flagged };
  }, [answers, exam.questions, total]);

  const timeLabel = formatTime(secondsLeft);
  const isWarn1 = secondsLeft <= WARNING_1MIN_SECONDS;
  const isWarn5 = secondsLeft <= WARNING_5MIN_SECONDS && !isWarn1;

  // ---- Handlers ----
  const setAnswerValue = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { value, flagged: prev[questionId]?.flagged ?? false } }));
  };

  const toggleFlag = (questionId: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { value: prev[questionId]?.value ?? "", flagged: !prev[questionId]?.flagged },
    }));
  };

  const goTo = (index: number) => {
    setCurrentIndex(Math.min(Math.max(index, 0), total - 1));
    setPaletteOpen(false);
  };

  const doSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await persist();
      await onSubmit(answersRef.current);
      window.localStorage.removeItem(storageKey);
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }, [onSubmit, persist, storageKey]);

  handleSubmitRef.current = () => setConfirmOpen(true);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cream-50 dark:bg-[#101114] font-sans text-ink dark:text-white">
      {/* ---------- Header ---------- */}
      <header className="flex items-center justify-between border-b border-black/5 dark:border-white/10 bg-white dark:bg-[#1A1C20] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate font-display text-[14px] font-semibold text-ink dark:text-white sm:text-[16px]">{exam.title}</p>
          <p className="truncate text-[11.5px] text-ink/50 dark:text-white/50">{exam.subjectName} · {studentName}</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <SaveIndicator state={saveState} />

          <div
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold tabular-nums transition-colors duration-200 ${
              isWarn1
                ? "animate-pulse-warn bg-crimson-600 text-on-crimson"
                : isWarn5
                ? "bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500"
                : "bg-background-muted dark:bg-white/5 text-ink dark:text-white"
            }`}
          >
            <Clock size={15} />
            {timeLabel}
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="rounded-lg bg-background-muted dark:bg-white/5 p-2 text-ink/70 dark:text-white/70 transition-colors duration-200 hover:bg-crimson-50 dark:hover:bg-crimson-600/15 hover:text-crimson-700 dark:hover:text-crimson-500 lg:hidden"
            aria-label="Question palette"
          >
            <Grid3x3 size={18} />
          </button>
        </div>
      </header>

      {(isWarn5 || isWarn1) && (
        <div
          className={`flex items-center justify-center gap-2 px-4 py-1.5 text-[12.5px] font-medium ${
            isWarn1 ? "bg-crimson-600 text-on-crimson" : "bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500"
          }`}
        >
          <AlertTriangle size={13} />
          {isWarn1 ? "Less than 1 minute remaining — submitting automatically at 0:00" : "5 minutes remaining"}
        </div>
      )}

      {/* ---------- Body ---------- */}
      <div className="flex flex-1 overflow-hidden">
        {/* Question area */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-2xl lg:max-w-3xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[12px] font-medium uppercase tracking-wide text-ink/40 dark:text-white/40">
                Question {currentIndex + 1} of {total}
              </span>
              <button
                onClick={() => toggleFlag(question.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors duration-200 ${
                  answers[question.id]?.flagged
                    ? "bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500"
                    : "text-ink/50 dark:text-white/50 hover:bg-background-muted dark:hover:bg-white/5"
                }`}
              >
                <Flag size={13} fill={answers[question.id]?.flagged ? "currentColor" : "none"} />
                {answers[question.id]?.flagged ? "Flagged" : "Flag for review"}
              </button>
            </div>

            <motion.div
              key={question.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="rounded-lg bg-white dark:bg-[#1A1C20] p-5 shadow-card sm:p-7"
            >
              <p className="mb-1 text-[11px] font-medium text-ink/40 dark:text-white/40">{question.points} point{question.points === 1 ? "" : "s"}</p>
              <MathText text={question.prompt} className="block text-[15px] font-medium leading-relaxed text-ink dark:text-white sm:text-[16px]" />

              {question.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={question.imageUrl}
                  alt="Question diagram"
                  className="mt-4 max-h-72 w-full rounded-md border border-black/5 dark:border-white/10 object-contain"
                />
              )}

              <div className="mt-6">
                <QuestionInput question={question} value={answers[question.id]?.value ?? ""} onChange={(v) => setAnswerValue(question.id, v)} />
              </div>
            </motion.div>

            {/* Prev / Next */}
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => goTo(currentIndex - 1)}
                disabled={currentIndex === 0}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13.5px] font-medium text-ink/70 dark:text-white/70 transition-colors duration-200 hover:bg-background-muted dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Previous
              </button>

              {currentIndex === total - 1 ? (
                <button
                  onClick={() => setConfirmOpen(true)}
                  className="rounded-lg bg-crimson-600 px-5 py-2.5 text-[13.5px] font-semibold text-on-crimson shadow-card transition-colors duration-200 hover:bg-crimson-700"
                >
                  Review &amp; submit
                </button>
              ) : (
                <button
                  onClick={() => goTo(currentIndex + 1)}
                  className="flex items-center gap-1.5 rounded-lg bg-crimson-600 px-4 py-2.5 text-[13.5px] font-medium text-on-crimson transition-colors duration-200 hover:bg-crimson-700"
                >
                  Next <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        </main>

        {/* Desktop palette */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-black/5 dark:border-white/10 bg-white dark:bg-[#1A1C20] p-5 lg:block">
          <PaletteContent exam={exam} answers={answers} currentIndex={currentIndex} onSelect={goTo} stats={stats} />
        </aside>
      </div>

      {/* Mobile palette drawer */}
      <AnimatePresence>
        {paletteOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPaletteOpen(false)}
              className="fixed inset-0 z-50 bg-ink/40 lg:hidden"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-lg bg-white dark:bg-[#1A1C20] p-5 shadow-card-hover lg:hidden"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-display text-[14px] font-semibold">Question palette</p>
                <button onClick={() => setPaletteOpen(false)} className="rounded-md p-1.5 text-ink/50 dark:text-white/50 hover:bg-background-muted dark:hover:bg-white/5">
                  <X size={18} />
                </button>
              </div>
              <PaletteContent exam={exam} answers={answers} currentIndex={currentIndex} onSelect={goTo} stats={stats} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Submission confirmation modal */}
      <AnimatePresence>
        {confirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-6 shadow-card-hover"
            >
              <h2 className="font-display text-[16px] font-semibold text-ink dark:text-white">Submit exam?</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60 dark:text-white/60">
                Once submitted, you cannot change your answers. Review the summary below before confirming.
              </p>

              <dl className="mt-4 space-y-1.5 rounded-md bg-background-muted dark:bg-white/5 p-3.5 text-[13px]">
                <Row label="Answered" value={stats.answered} tone="success" />
                <Row label="Unanswered" value={stats.unanswered} tone={stats.unanswered > 0 ? "warn" : "default"} />
                <Row label="Flagged for review" value={stats.flagged} tone="default" />
              </dl>

              <div className="mt-5 flex gap-2.5">
                <button
                  onClick={() => setConfirmOpen(false)}
                  disabled={submitting}
                  className="flex-1 rounded-lg border border-black/10 dark:border-white/15 py-2.5 text-[13.5px] font-medium text-ink/70 dark:text-white/70 transition-colors duration-200 hover:bg-background-muted dark:hover:bg-white/5 disabled:opacity-50"
                >
                  Keep reviewing
                </button>
                <button
                  onClick={doSubmit}
                  disabled={submitting}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-crimson-600 py-2.5 text-[13.5px] font-semibold text-on-crimson transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-70"
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {submitting ? "Submitting…" : "Submit final answers"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: ExamQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  if (question.type === "multiple_choice" || question.type === "true_false") {
    return (
      <div className="space-y-2.5">
        {question.options?.map((opt) => {
          const selected = value === opt.id;
          return (
            <label
              key={opt.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-[13.5px] transition-colors duration-200 ${
                selected
                  ? "border-crimson-600 bg-crimson-50 dark:bg-crimson-600/15 text-crimson-800"
                  : "border-black/10 dark:border-white/15 text-ink/80 dark:text-white/80 hover:border-black/20 hover:bg-background-muted dark:hover:bg-white/5"
              }`}
            >
              <span
                className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-crimson-600 bg-crimson-600" : "border-black/20"
                }`}
              >
                {selected && <Check size={11} className="text-white" strokeWidth={3} />}
              </span>
              <input
                type="radio"
                name={question.id}
                className="sr-only"
                checked={selected}
                onChange={() => onChange(opt.id)}
              />
              <MathText text={opt.text} />
            </label>
          );
        })}
      </div>
    );
  }

  if (question.type === "fill_blank") {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer"
        className="w-full rounded-lg border border-black/10 dark:border-white/15 px-4 py-3 text-[13.5px] outline-none transition-shadow duration-200 focus:border-crimson-500 focus:shadow-focus"
      />
    );
  }

  // short_theory
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={7}
      placeholder="Write your answer"
      className="w-full resize-none rounded-lg border border-black/10 dark:border-white/15 px-4 py-3 text-[13.5px] leading-relaxed outline-none transition-shadow duration-200 focus:border-crimson-500 focus:shadow-focus"
    />
  );
}

function PaletteContent({
  exam,
  answers,
  currentIndex,
  onSelect,
  stats,
}: {
  exam: ExamData;
  answers: AnswersMap;
  currentIndex: number;
  onSelect: (i: number) => void;
  stats: { answered: number; unanswered: number; flagged: number };
}) {
  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <StatChip label="Answered" value={stats.answered} tone="success" />
        <StatChip label="Left" value={stats.unanswered} tone="warn" />
        <StatChip label="Flagged" value={stats.flagged} tone="default" />
      </div>

      <div className="grid grid-cols-5 gap-2">
        {exam.questions.map((q, i) => {
          const a = answers[q.id];
          const isAnswered = !!a?.value?.trim();
          const isFlagged = !!a?.flagged;
          const isCurrent = i === currentIndex;

          return (
            <button
              key={q.id}
              onClick={() => onSelect(i)}
              className={`relative flex h-9 w-9 items-center justify-center rounded-md text-[12px] font-semibold transition-colors duration-200 ${
                isCurrent
                  ? "bg-crimson-600 text-on-crimson"
                  : isAnswered
                  ? "bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500"
                  : "bg-background-muted dark:bg-white/5 text-ink/50 dark:text-white/50 hover:bg-black/5"
              }`}
            >
              {i + 1}
              {isFlagged && <Flag size={9} className="absolute -right-1 -top-1 text-amber-500" fill="currentColor" />}
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-1.5 text-[11.5px] text-ink/50 dark:text-white/50">
        <LegendRow swatchClass="bg-crimson-600" label="Current question" />
        <LegendRow swatchClass="bg-crimson-50 dark:bg-crimson-600/15 border border-crimson-200" label="Answered" />
        <LegendRow swatchClass="bg-background-muted dark:bg-white/5" label="Unanswered" />
      </div>
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "success" | "warn" | "default" }) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "warn" ? "text-crimson-600" : "text-ink/70 dark:text-white/70";
  return (
    <div className="rounded-md bg-background-muted dark:bg-white/5 py-2">
      <p className={`text-[15px] font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-[10px] text-ink/45 dark:text-white/45">{label}</p>
    </div>
  );
}

function LegendRow({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded ${swatchClass}`} />
      {label}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone: "success" | "warn" | "default" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "warn" ? "text-crimson-600" : "text-ink dark:text-white";
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink/60 dark:text-white/60">{label}</dt>
      <dd className={`font-semibold tabular-nums ${toneClass}`}>{value}</dd>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const config: Record<SaveState, { icon: React.ElementType; label: string; className: string }> = {
    idle: { icon: CloudCheck, label: "", className: "hidden" },
    saving: { icon: CloudUpload, label: "Saving…", className: "text-ink/40 dark:text-white/40" },
    saved: { icon: CloudCheck, label: "Saved", className: "text-success" },
    error: { icon: AlertTriangle, label: "Saved locally", className: "text-crimson-600" },
  };
  const { icon: Icon, label, className } = config[state];
  if (!label) return null;
  return (
    <span className={`hidden items-center gap-1 text-[11.5px] font-medium sm:flex ${className}`}>
      <Icon size={13} />
      {label}
    </span>
  );
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
