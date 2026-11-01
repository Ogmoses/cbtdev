"use client";

/**
 * ExamBuilder — configure an exam's rules, pick its questions from the
 * bank, and schedule one or more lab batches for it.
 *
 * Maps directly onto `exams`, `exam_questions`, and `exam_batches` in
 * database/schema.sql: saving should upsert an `exams` row, replace its
 * `exam_questions` rows in the chosen order, and upsert `exam_batches`.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Search,
  CalendarClock,
  Loader2,
  Shuffle,
  Eye,
  Trophy,
  CheckCircle2,
  Users,
  Wand2,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { BankQuestion, ClassOption, StudentOption, SubjectOption, TermOption } from "./types";

export interface ExamBatchDraft {
  id: string;
  label: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  labRoom?: string;
}

export interface ExamFormData {
  title: string;
  subjectId: string;
  classId: string;
  termId: string;
  durationMinutes: number;
  passMark: number;
  weightPercent: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResultInstantly: boolean;
  /** Lets a student, once the exam is over, see which of their answers
   *  were right or wrong — not just their total score. Independent of
   *  showResultInstantly: a teacher can show the score immediately but
   *  only unlock the full breakdown later, or the reverse. */
  allowReview: boolean;
  /** True for the term's single Terminal Exam; false for CA/CBT-style contributors. Drives the report card's CA-vs-Terminal split. */
  isTerminal: boolean;
  questionIds: string[];
  batches: ExamBatchDraft[];
  /** studentId -> the ExamBatchDraft.id they're sitting. Auto-distributed
   *  evenly whenever the roster or batch list changes, and freely
   *  overridable per student — this is what actually decides who ends up
   *  in batch_students for which batch, not just "everyone in the class." */
  studentAssignments: Record<string, string>;
}

interface ExamBuilderProps {
  subjects: SubjectOption[];
  classes: ClassOption[];
  terms: TermOption[];
  questionBank: BankQuestion[];
  studentsByClass: Record<string, StudentOption[]>;
  initial?: Partial<ExamFormData>;
  onSaveDraft: (data: ExamFormData) => Promise<void>;
  onPublish: (data: ExamFormData) => Promise<void>;
}

const DEFAULTS: ExamFormData = {
  title: "",
  subjectId: "",
  classId: "",
  termId: "",
  durationMinutes: 45,
  passMark: 50,
  weightPercent: 30,
  shuffleQuestions: true,
  shuffleOptions: true,
  showResultInstantly: false,
  allowReview: false,
  isTerminal: false,
  questionIds: [],
  batches: [],
  studentAssignments: {},
};

export default function ExamBuilder({ subjects, classes, terms, questionBank, studentsByClass, initial, onSaveDraft, onPublish }: ExamBuilderProps) {
  const [form, setForm] = useState<ExamFormData>({
    ...DEFAULTS,
    subjectId: subjects[0]?.id ?? "",
    classId: classes[0]?.id ?? "",
    termId: terms[0]?.id ?? "",
    ...initial,
  });
  const [questionSearch, setQuestionSearch] = useState("");
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPublishedToast, setShowPublishedToast] = useState(false);
  // Import groups the teacher has opened to pick individual questions from.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (groupId: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const update = <K extends keyof ExamFormData>(key: K, value: ExamFormData[K]) => setForm((f) => ({ ...f, [key]: value }));

  const availableQuestions = useMemo(
    () =>
      questionBank.filter(
        (q) =>
          q.subjectId === form.subjectId &&
          q.classId === form.classId &&
          !form.questionIds.includes(q.id) &&
          (questionSearch.trim() === "" || q.prompt.toLowerCase().includes(questionSearch.trim().toLowerCase()))
      ),
    [questionBank, form.subjectId, form.classId, form.questionIds, questionSearch]
  );

  const selectedQuestions = useMemo(
    () => form.questionIds.map((id) => questionBank.find((q) => q.id === id)).filter((q): q is BankQuestion => !!q),
    [form.questionIds, questionBank]
  );

  const totalPoints = selectedQuestions.reduce((sum, q) => sum + q.points, 0);

  /** Same single-unit grouping as QuestionBankManager — a bulk-imported
   *  set of (often dozens of) questions shows as one row here too, so
   *  adding them to an exam is one tap instead of N. Not clear this is
   *  always the right call (an exam might only want a handful out of a
   *  60-question import), but ticking 60 boxes individually is worse —
   *  see availableUngroupedQuestions below for pulling a group apart if
   *  that's what's actually needed. */
  const availableRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: ({ kind: "single"; question: BankQuestion } | { kind: "group"; groupId: string; label: string; questions: BankQuestion[] })[] = [];
    for (const q of availableQuestions) {
      if (q.importGroupId) {
        if (seen.has(q.importGroupId)) continue;
        seen.add(q.importGroupId);
        rows.push({ kind: "group", groupId: q.importGroupId, label: q.importGroupLabel || "Imported questions", questions: availableQuestions.filter((m) => m.importGroupId === q.importGroupId) });
      } else {
        rows.push({ kind: "single", question: q });
      }
    }
    return rows;
  }, [availableQuestions]);

  const addQuestion = (id: string) => update("questionIds", [...form.questionIds, id]);
  const addQuestionGroup = (ids: string[]) => update("questionIds", [...form.questionIds, ...ids.filter((id) => !form.questionIds.includes(id))]);
  const removeQuestion = (id: string) => update("questionIds", form.questionIds.filter((qid) => qid !== id));
  const moveQuestion = (index: number, dir: -1 | 1) => {
    const next = [...form.questionIds];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update("questionIds", next);
  };

  const addBatch = () => {
    update("batches", [
      ...form.batches,
      { id: crypto.randomUUID(), label: `Batch ${String.fromCharCode(65 + form.batches.length)}`, startsAt: "", endsAt: "", labRoom: "" },
    ]);
  };
  const updateBatch = (id: string, patch: Partial<ExamBatchDraft>) =>
    update("batches", form.batches.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const updateBatchStart = (id: string, startsAt: string) =>
    updateBatch(id, { startsAt, endsAt: addMinutes(startsAt, form.durationMinutes) });
  const removeBatch = (id: string) => update("batches", form.batches.filter((b) => b.id !== id));

  const updateDuration = (minutes: number) => {
    // Keep every batch's end time in step with the exam's actual duration
    // instead of letting them silently drift apart — this used to be two
    // independently-typed fields with nothing keeping them consistent.
    update("durationMinutes", minutes);
    update("batches", form.batches.map((b) => (b.startsAt ? { ...b, endsAt: addMinutes(b.startsAt, minutes) } : b)));
  };

  const roster = studentsByClass[form.classId] ?? [];

  const splitEvenly = (): Record<string, string> => {
    const batchIds = form.batches.map((b) => b.id);
    const next: Record<string, string> = {};
    roster.forEach((s, i) => {
      if (batchIds.length > 0) next[s.id] = batchIds[i % batchIds.length];
    });
    return next;
  };

  // Keeps every currently-enrolled student pointed at a real batch: fills
  // in anyone new or whose assigned batch got deleted (round-robin), and
  // drops students who left the roster (e.g. class was changed). Never
  // touches a manual assignment that's still valid, so picking a batch
  // for one student doesn't get overwritten by this running again.
  useEffect(() => {
    const batchIds = form.batches.map((b) => b.id);
    setForm((f) => {
      const next: Record<string, string> = {};
      let changed = false;
      roster.forEach((s, i) => {
        const current = f.studentAssignments[s.id];
        if (current && batchIds.includes(current)) {
          next[s.id] = current;
        } else if (batchIds.length > 0) {
          next[s.id] = batchIds[i % batchIds.length];
          changed = true;
        }
      });
      if (Object.keys(f.studentAssignments).length !== Object.keys(next).length) changed = true;
      return changed ? { ...f, studentAssignments: next } : f;
    });
  }, [form.classId, form.batches.map((b) => b.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): string | null => {
    if (!form.title.trim()) return "Give the exam a title.";
    if (form.questionIds.length === 0) return "Add at least one question.";
    if (form.batches.length === 0) return "Schedule at least one batch.";
    if (form.batches.some((b) => !b.startsAt)) return "Every batch needs a start time.";
    // A pass mark of 0 (or blank, which NumberField's Number("") turns into
    // 0) makes every score "pass" by definition — score% >= 0 is always
    // true — which silently pins Class Analytics' pass rate at 100% no
    // matter what students actually score. Nothing previously caught this.
    if (!form.passMark || form.passMark <= 0 || form.passMark > 100) return "Set a pass mark between 1 and 100.";
    return null;
  };

  const handleSave = async (mode: "draft" | "publish") => {
    if (mode === "publish") {
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setError(null);
    setSaving(mode);
    try {
      await (mode === "draft" ? onSaveDraft(form) : onPublish(form));
      if (mode === "publish") {
        setShowPublishedToast(true);
        setTimeout(() => setShowPublishedToast(false), 2800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the exam. Try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="pb-10">
      <AnimatePresence>
        {showPublishedToast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed left-1/2 top-4 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-white shadow-card-hover"
          >
            <CheckCircle2 size={16} className="text-cream-100" />
            Exam published
          </motion.div>
        )}
      </AnimatePresence>

      <h1 className="font-display text-[18px] font-semibold text-ink dark:text-white sm:text-[20px]">Exam builder</h1>
      <p className="mt-0.5 text-[13px] text-ink/50 dark:text-white/50">Set the rules, pick questions, then schedule lab batches.</p>

      {/* ---------- Details ---------- */}
      <SectionCard title="Details" className="mt-5">
        <label className="mb-3.5 block">
          <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Exam title</span>
          <input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="e.g. Second Term Mid-Term Test"
            className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2.5 text-[13.5px] outline-none focus:border-crimson-500"
          />
        </label>

        <div className="grid gap-3.5 sm:grid-cols-3">
          <Select label="Subject" value={form.subjectId} onChange={(v) => update("subjectId", v)} options={subjects} />
          <Select label="Class" value={form.classId} onChange={(v) => update("classId", v)} options={classes} />
          <Select label="Term" value={form.termId} onChange={(v) => update("termId", v)} options={terms} />
        </div>

        <div className="mt-3.5 grid grid-cols-3 gap-3.5">
          <NumberField label="Duration (min)" value={form.durationMinutes} onChange={updateDuration} />
          <NumberField label="Pass mark" value={form.passMark} onChange={(v) => update("passMark", v)} />
          <NumberField label="Weight (%)" value={form.weightPercent} onChange={(v) => update("weightPercent", v)} hint="of term grade" />
        </div>

        <div className="mt-4 space-y-2.5">
          <Toggle icon={Shuffle} label="Shuffle question order per student" checked={form.shuffleQuestions} onChange={(v) => update("shuffleQuestions", v)} />
          <Toggle icon={Shuffle} label="Shuffle option order per student" checked={form.shuffleOptions} onChange={(v) => update("shuffleOptions", v)} />
          <Toggle icon={Eye} label="Show result instantly after submission" checked={form.showResultInstantly} onChange={(v) => update("showResultInstantly", v)} />
          <Toggle icon={CheckCircle2} label="Let students review which answers were correct" checked={form.allowReview} onChange={(v) => update("allowReview", v)} />
          <Toggle icon={Trophy} label="This is the term's Terminal Exam (not a CA/CBT)" checked={form.isTerminal} onChange={(v) => update("isTerminal", v)} />
        </div>
      </SectionCard>

      {/* ---------- Questions ---------- */}
      <SectionCard title="Questions" subtitle={`${selectedQuestions.length} selected · ${totalPoints} points total`} className="mt-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-medium text-ink/50 dark:text-white/50">Question bank</p>
            <div className="relative mb-2.5">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/35 dark:text-white/35" />
              <input
                value={questionSearch}
                onChange={(e) => setQuestionSearch(e.target.value)}
                placeholder="Search"
                className="w-full rounded-lg border border-black/10 dark:border-white/15 py-2 pl-8 pr-3 text-[12.5px] outline-none focus:border-crimson-500"
              />
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-black/5 dark:border-white/10 bg-background-muted dark:bg-white/5 p-2">
              {availableRows.length === 0 ? (
                <p className="px-2 py-3 text-center text-[12px] text-ink/40 dark:text-white/40">
                  No questions tagged for this class and subject yet — add some from Question Bank, or check whether existing ones still need a class assigned.
                </p>
              ) : (
                availableRows.map((row) =>
                  row.kind === "group" ? (
                    <div key={row.groupId} className="overflow-hidden rounded-md bg-white shadow-card dark:bg-[#1A1C20]">
                      <div className="flex items-stretch">
                        <button
                          type="button"
                          onClick={() => toggleGroup(row.groupId)}
                          aria-expanded={expandedGroups.has(row.groupId)}
                          title="Show the individual questions to pick from"
                          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 text-left text-[12.5px] text-ink dark:text-white"
                        >
                          <ChevronRight size={14} className={`shrink-0 text-ink/40 transition-transform duration-200 dark:text-white/40 ${expandedGroups.has(row.groupId) ? "rotate-90" : ""}`} />
                          <FolderOpen size={14} className="shrink-0 text-crimson-600" />
                          <span className="truncate">{row.label}</span>
                          <span className="shrink-0 text-[11px] text-ink/40 dark:text-white/40">({row.questions.length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => addQuestionGroup(row.questions.map((q) => q.id))}
                          title={`Adds all ${row.questions.length} questions at once`}
                          className="flex shrink-0 items-center gap-1 border-l border-black/5 px-3 text-[11.5px] font-medium text-crimson-600 hover:bg-crimson-50 dark:border-white/10 dark:hover:bg-crimson-600/15"
                        >
                          <Plus size={13} /> Add all
                        </button>
                      </div>
                      {expandedGroups.has(row.groupId) && (
                        <div className="space-y-1 border-t border-black/5 bg-background-muted/60 p-1.5 dark:border-white/10 dark:bg-white/5">
                          {row.questions.map((q, qi) => (
                            <button
                              type="button"
                              key={q.id}
                              onClick={() => addQuestion(q.id)}
                              className="flex w-full items-start justify-between gap-2 rounded-md bg-white px-2.5 py-2 text-left text-[12px] text-ink shadow-card transition-shadow duration-200 hover:shadow-card-hover dark:bg-[#1A1C20] dark:text-white"
                            >
                              <span className="flex min-w-0 gap-1.5">
                                <span className="shrink-0 text-ink/35 dark:text-white/35">{qi + 1}.</span>
                                <span className="line-clamp-2">{q.prompt}</span>
                              </span>
                              <Plus size={14} className="mt-0.5 shrink-0 text-crimson-600" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      key={row.question.id}
                      onClick={() => addQuestion(row.question.id)}
                      className="flex w-full items-start justify-between gap-2 rounded-md bg-white dark:bg-[#1A1C20] px-3 py-2 text-left text-[12.5px] text-ink dark:text-white shadow-card transition-shadow duration-200 hover:shadow-card-hover"
                    >
                      <span className="line-clamp-2">{row.question.prompt}</span>
                      <Plus size={14} className="mt-0.5 shrink-0 text-crimson-600" />
                    </button>
                  )
                )
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium text-ink/50 dark:text-white/50">In this exam, in order</p>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-black/5 dark:border-white/10 p-2">
              {selectedQuestions.length === 0 ? (
                <p className="px-2 py-3 text-center text-[12px] text-ink/40 dark:text-white/40">Add questions from the bank.</p>
              ) : (
                selectedQuestions.map((q, i) => (
                  <div key={q.id} className="flex items-start gap-2 rounded-md bg-white dark:bg-[#1A1C20] px-3 py-2 text-[12.5px] shadow-card">
                    <span className="mt-0.5 shrink-0 text-ink/35 dark:text-white/35">{i + 1}.</span>
                    <span className="flex-1 line-clamp-2 text-ink dark:text-white">{q.prompt}</span>
                    <div className="flex shrink-0 flex-col items-center gap-0.5 text-ink/35 dark:text-white/35">
                      <button onClick={() => moveQuestion(i, -1)} disabled={i === 0} className="hover:text-ink/70 dark:hover:text-white/70 disabled:opacity-30">
                        <ChevronUp size={13} />
                      </button>
                      <button onClick={() => moveQuestion(i, 1)} disabled={i === selectedQuestions.length - 1} className="hover:text-ink/70 dark:hover:text-white/70 disabled:opacity-30">
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    <button onClick={() => removeQuestion(q.id)} className="mt-0.5 shrink-0 text-ink/30 dark:text-white/30 hover:text-crimson-600">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ---------- Batches ---------- */}
      <SectionCard title="Lab batches" subtitle="Time windows students can sit this exam in" className="mt-5">
        <div className="space-y-3">
          {form.batches.map((b) => (
            <div key={b.id} className="grid grid-cols-1 gap-2.5 rounded-lg border border-black/5 dark:border-white/10 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
              <TextField label="Label" value={b.label} onChange={(v) => updateBatch(b.id, { label: v })} />
              <TextField label="Starts" value={b.startsAt} onChange={(v) => updateBatchStart(b.id, v)} type="datetime-local" />
              <div>
                <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Ends</span>
                <p className="rounded-lg border border-black/10 dark:border-white/15 bg-background-muted dark:bg-white/5 px-3 py-2.5 text-[13px] text-ink/60 dark:text-white/60">
                  {b.startsAt ? `${formatEndsAt(b.endsAt)} (${form.durationMinutes} min)` : "Set a start time"}
                </p>
              </div>
              <TextField label="Lab room" value={b.labRoom ?? ""} onChange={(v) => updateBatch(b.id, { labRoom: v })} placeholder="Optional" />
              <button onClick={() => removeBatch(b.id)} className="flex items-center justify-center rounded-lg border border-black/10 dark:border-white/15 p-2.5 text-ink/40 dark:text-white/40 hover:bg-crimson-50 dark:hover:bg-crimson-600/15 hover:text-crimson-700 dark:hover:text-crimson-500">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addBatch}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-black/15 dark:border-white/20 px-3.5 py-2.5 text-[12.5px] font-medium text-ink/60 dark:text-white/60 hover:border-black/25 hover:text-ink/80 dark:hover:text-white/80"
        >
          <CalendarClock size={14} /> Add batch
        </button>

        {form.batches.length > 1 && roster.length > 0 && (
          <div className="mt-5 border-t border-black/5 dark:border-white/10 pt-4">
            <div className="mb-2.5 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink/70 dark:text-white/70">
                <Users size={14} /> Who sits which batch
              </p>
              <button
                onClick={() => update("studentAssignments", splitEvenly())}
                className="flex items-center gap-1 text-[12px] font-medium text-crimson-600 hover:underline"
              >
                <Wand2 size={12} /> Split evenly
              </button>
            </div>
            <div className="space-y-1.5">
              {roster.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/5 dark:border-white/10 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink dark:text-white">{s.fullName}</p>
                    {s.admissionNumber && <p className="text-[11px] text-ink/40 dark:text-white/40">{s.admissionNumber}</p>}
                  </div>
                  <select
                    value={form.studentAssignments[s.id] ?? ""}
                    onChange={(e) => update("studentAssignments", { ...form.studentAssignments, [s.id]: e.target.value })}
                    className="shrink-0 rounded-md border border-black/10 dark:border-white/15 px-2 py-1.5 text-[12.5px] outline-none focus:border-crimson-500"
                  >
                    {form.batches.map((b) => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {error && <p className="mt-4 rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3.5 py-2.5 text-[13px] text-crimson-700 dark:text-crimson-500">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => handleSave("draft")}
          disabled={saving !== null}
          className="flex items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/15 px-4 py-2.5 text-[13.5px] font-medium text-ink/70 dark:text-white/70 hover:bg-background-muted dark:hover:bg-white/5 disabled:opacity-60"
        >
          {saving === "draft" && <Loader2 size={14} className="animate-spin" />}
          Save as draft
        </button>
        <button
          onClick={() => handleSave("publish")}
          disabled={saving !== null}
          className="flex items-center gap-1.5 rounded-lg bg-crimson-600 px-4 py-2.5 text-[13.5px] font-semibold text-on-crimson hover:bg-crimson-700 disabled:opacity-70"
        >
          {saving === "publish" && <Loader2 size={14} className="animate-spin" />}
          Publish exam
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SectionCard({ title, subtitle, className, children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border border-black/5 dark:border-white/10 bg-white dark:bg-[#1A1C20] p-4.5 shadow-card sm:p-5 ${className ?? ""}`}>
      <div className="mb-4">
        <h2 className="font-display text-[14px] font-semibold text-ink dark:text-white">{title}</h2>
        {subtitle && <p className="text-[12px] text-ink/45 dark:text-white/45">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; name: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">
        {label} {hint && <span className="text-ink/35 dark:text-white/35">({hint})</span>}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
      />
    </label>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-ink/55 dark:text-white/55">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500"
      />
    </label>
  );
}

function addMinutes(dateTimeLocal: string, minutes: number): string {
  if (!dateTimeLocal) return "";
  const d = new Date(dateTimeLocal);
  if (isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() + minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEndsAt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Toggle({ icon: Icon, label, checked, onChange }: { icon: React.ElementType; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-background-muted dark:bg-white/5 px-3.5 py-2.5">
      <span className="flex items-center gap-2 text-[13px] text-ink/75 dark:text-white/75">
        <Icon size={14} className="text-ink/40 dark:text-white/40" />
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? "bg-crimson-600" : "bg-black/15"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white dark:bg-[#1A1C20] shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-[16px]" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
