"use client";

/**
 * QuestionEditor — create/edit form for a single question.
 *
 * Mount with a `key` tied to the question id (or "new") so internal state
 * initializes fresh per question:
 *   <QuestionEditor key={editing?.id ?? "new"} initial={editing} ... />
 */

import { useRef, useState } from "react";
import { Plus, Trash2, ImagePlus, X, Loader2, Check } from "lucide-react";
import MathText from "@/components/common/MathText";
import { splitMathSegments } from "@/lib/mathDetect";
import { uploadImage } from "@/lib/uploadImage";
import ImageCropModal from "@/components/ui/ImageCropModal";

/** Whether any part of the text actually contains a detected formula — used to decide whether a live preview is worth showing at all. */
function hasMath(text: string): boolean {
  return splitMathSegments(text).some((s) => s.type === "math");
}
import {
  QUESTION_TYPE_LABEL,
  type BankQuestion,
  type ClassOption,
  type QuestionOption,
  type QuestionType,
  type SubjectOption,
} from "./types";

interface QuestionEditorProps {
  initial?: BankQuestion | null;
  subjects: SubjectOption[];
  classes: ClassOption[];
  defaultSubjectId?: string;
  defaultClassId?: string;
  onSave: (question: Omit<BankQuestion, "id" | "updatedAt" | "subjectName" | "className"> & { id?: string }) => Promise<void>;
  onCancel: () => void;
}

function newOption(text = ""): QuestionOption {
  return { id: crypto.randomUUID(), text, isCorrect: false };
}

function blankOptionsFor(t: QuestionType): QuestionOption[] {
  return t === "true_false"
    ? [{ id: "true", text: "True", isCorrect: false }, { id: "false", text: "False", isCorrect: false }]
    : [newOption(), newOption()];
}

export default function QuestionEditor({ initial, subjects, classes, defaultSubjectId, defaultClassId, onSave, onCancel }: QuestionEditorProps) {
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? defaultSubjectId ?? subjects[0]?.id ?? "");
  const [classId, setClassId] = useState(initial?.classId ?? defaultClassId ?? "");
  const [topic, setTopic] = useState(initial?.topic ?? "");
  const [type, setType] = useState<QuestionType>(initial?.type ?? "multiple_choice");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [options, setOptions] = useState<QuestionOption[]>(initial?.options ?? blankOptionsFor(type));
  const [referenceAnswer, setReferenceAnswer] = useState(initial?.referenceAnswer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const handleTypeChange = (next: QuestionType) => {
    setType(next);
    if (next === "true_false") {
      setOptions(blankOptionsFor("true_false"));
    } else if (next === "multiple_choice" && options.length < 2) {
      setOptions(blankOptionsFor("multiple_choice"));
    }
  };

  const handleImageChange = async (file: File | null) => {
    if (!file) return;
    setImageError(null);
    setUploadingImage(true);
    try {
      // Stored in Supabase Storage; only the public URL goes in the database.
      setImageUrl(await uploadImage("question-images", file));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Couldn't upload that image.");
    } finally {
      setUploadingImage(false);
    }
  };

  const MAX_AUTO_OPTIONS = 8; // sane ceiling so this can't run away indefinitely

  const updateOption = (id: string, patch: Partial<QuestionOption>) => {
    setOptions((prev) => {
      const next = prev.map((o) => (o.id === id ? { ...o, ...patch } : o));
      // Once the teacher starts typing into what's currently the last
      // option, a fresh empty one appears automatically — no need to tap
      // "Add option" after every single choice. This only fires once per
      // option (the moment it goes from empty to non-empty while still
      // being last), not on every keystroke: as soon as the new empty
      // option exists, it — not the one just filled in — becomes "last",
      // so typing further into the original field no longer matches.
      // Empty options are filtered out on save regardless (see
      // handleSubmit below), so one left untouched at the end is simply
      // discarded, never submitted.
      const last = next[next.length - 1];
      if (type === "multiple_choice" && next.length < MAX_AUTO_OPTIONS && last?.id === id && last.text.trim().length > 0) {
        return [...next, newOption()];
      }
      return next;
    });
  };

  const markCorrect = (id: string) => {
    setOptions((prev) => prev.map((o) => ({ ...o, isCorrect: o.id === id })));
  };

  const addOption = () => setOptions((prev) => [...prev, newOption()]);
  const removeOption = (id: string) => setOptions((prev) => prev.filter((o) => o.id !== id));

  const validate = (): string | null => {
    if (!subjectId) return "Choose a subject.";
    if (!classId) return "Choose a class.";
    if (!prompt.trim()) return "Write the question prompt.";
    if (type === "multiple_choice" || type === "true_false") {
      const filled = options.filter((o) => o.text.trim());
      if (filled.length < 2) return "Add at least two options.";
      if (!options.some((o) => o.isCorrect)) return "Mark which option is correct.";
    }
    if ((type === "fill_blank" || type === "short_theory") && !referenceAnswer.trim()) {
      return type === "fill_blank" ? "Add the expected answer." : "Add a marking guide for graders.";
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        subjectId,
        classId,
        topic: topic.trim(),
        type,
        prompt: prompt.trim(),
        imageUrl,
        points,
        options: type === "multiple_choice" || type === "true_false" ? options.filter((o) => o.text.trim()) : undefined,
        referenceAnswer: type === "fill_blank" || type === "short_theory" ? referenceAnswer.trim() : null,
      });
      // Editing an existing question: the parent closes the panel, nothing
      // more to do here. Creating a new one: keep the panel open and reset
      // just the content fields (prompt, options, image, marking guide) —
      // subject, topic, question type, and points carry over, since those
      // are usually the same for the next question in a batch too.
      if (!initial) {
        setSavedCount((n) => n + 1);
        setPrompt("");
        setOptions(blankOptionsFor(type));
        setImageUrl(null);
        setReferenceAnswer("");
        promptRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the question. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg bg-white dark:bg-[#1A1C20] shadow-card-hover">
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 px-5 py-4">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink dark:text-white">{initial ? "Edit question" : "New question"}</h2>
            {!initial && savedCount > 0 && (
              <p className="mt-0.5 text-[12px] font-medium text-crimson-600">
                {savedCount} saved this session — keep going or tap Done
              </p>
            )}
          </div>
          <button onClick={onCancel} className="rounded-md p-1.5 text-ink/40 dark:text-white/40 hover:bg-background-muted dark:hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Subject</span>
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Class</span>
              <select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
              >
                <option value="" disabled>Select a class</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Topic</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Quadratic equations"
                className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
              />
            </label>
          </div>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-ink/60 dark:text-white/60">Question type</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`rounded-md px-2.5 py-2 text-[12px] font-medium transition-colors duration-200 ${
                    type === t ? "bg-crimson-600 text-on-crimson" : "bg-background-muted dark:bg-white/5 text-ink/60 dark:text-white/60 hover:bg-black/5"
                  }`}
                >
                  {QUESTION_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Prompt</span>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="Type the question text"
              className="w-full resize-none rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
            />
            {/* Live formula preview — any math-looking part of the prompt
                (x^2, sqrt(16), H_2O, etc.) is detected automatically, no
                special markup needed. Only shown once there's actually
                something to preview, so it doesn't clutter plain-text
                questions. */}
            {hasMath(prompt) && (
              <div className="mt-1.5 rounded-md border border-dashed border-black/10 bg-background-muted px-3 py-2 dark:border-white/15 dark:bg-white/5">
                <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-ink/35 dark:text-white/35">Preview</p>
                <MathText text={prompt} className="text-[13.5px] text-ink dark:text-white" />
              </div>
            )}
          </label>

          <div>
            <span className="mb-1.5 block text-[12px] font-medium text-ink/60 dark:text-white/60">Diagram (optional)</span>
            {imageUrl ? (
              <div className="relative w-fit">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Question diagram" className="max-h-32 rounded-md border border-black/10 dark:border-white/15" />
                <button
                  onClick={() => setImageUrl(null)}
                  className="absolute -right-2 -top-2 rounded-full bg-white dark:bg-[#1A1C20] p-1 text-ink/60 dark:text-white/60 shadow-card hover:text-crimson-700 dark:hover:text-crimson-500"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed border-black/15 dark:border-white/20 px-3.5 py-2.5 text-[12.5px] font-medium text-ink/50 dark:text-white/50 hover:border-black/25 hover:text-ink/70 dark:hover:text-white/70">
                {uploadingImage ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                {uploadingImage ? "Uploading…" : "Upload image"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={uploadingImage}
                  className="hidden"
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    // Animated GIFs go up untouched (the editor would flatten them); everything else opens the editor first.
                    if (picked) {
                      if (picked.type === "image/gif") handleImageChange(picked);
                      else setCropFile(picked);
                    }
                    e.target.value = ""; // allows re-picking the same file after an error
                  }}
                />
              </label>
            )}
            {cropFile && (
              <ImageCropModal
                file={cropFile}
                shape="rect"
                title="Edit diagram"
                onCancel={() => setCropFile(null)}
                onDone={(edited) => {
                  setCropFile(null);
                  handleImageChange(edited);
                }}
              />
            )}
            {imageError && <p className="mt-1.5 text-[12px] text-crimson-600">{imageError}</p>}
          </div>

          {(type === "multiple_choice" || type === "true_false") && (
            <div>
              <span className="mb-1.5 block text-[12px] font-medium text-ink/60 dark:text-white/60">Options — select the correct one</span>
              <div className="space-y-2">
                {options.map((opt) => (
                  <div key={opt.id}>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => markCorrect(opt.id)}
                        aria-label="Mark correct"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          opt.isCorrect ? "border-crimson-600 bg-crimson-600" : "border-black/25 dark:border-white/30 hover:border-crimson-400"
                        }`}
                      >
                        {opt.isCorrect && <Check size={16} strokeWidth={3.5} className="text-on-crimson" />}
                      </button>
                      <input
                        value={opt.text}
                        onChange={(e) => updateOption(opt.id, { text: e.target.value })}
                        disabled={type === "true_false"}
                        className="flex-1 rounded-lg border border-black/10 dark:border-white/15 px-3 py-2 text-[13px] outline-none focus:border-crimson-500 disabled:bg-background-muted dark:bg-white/5 disabled:text-ink/60 dark:text-white/60"
                      />
                      {type === "multiple_choice" && options.length > 2 && (
                        <button onClick={() => removeOption(opt.id)} className="text-ink/30 dark:text-white/30 hover:text-crimson-600">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    {hasMath(opt.text) && (
                      <MathText text={opt.text} className="ml-7 mt-1 block text-[12.5px] text-ink/60 dark:text-white/60" />
                    )}
                  </div>
                ))}
              </div>
              {type === "multiple_choice" && (
                <button
                  type="button"
                  onClick={addOption}
                  className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-crimson-700 dark:text-crimson-500 hover:text-crimson-800"
                >
                  <Plus size={14} /> Add option
                </button>
              )}
            </div>
          )}

          {type === "fill_blank" && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Expected answer (auto-graded, exact match)</span>
              <input
                value={referenceAnswer}
                onChange={(e) => setReferenceAnswer(e.target.value)}
                className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
              />
            </label>
          )}

          {type === "short_theory" && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Marking guide (shown to the grader, not the student)</span>
              <textarea
                value={referenceAnswer}
                onChange={(e) => setReferenceAnswer(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
              />
              {hasMath(referenceAnswer) && (
                <div className="mt-1.5 rounded-md border border-dashed border-black/10 bg-background-muted px-3 py-2 dark:border-white/15 dark:bg-white/5">
                  <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-ink/35 dark:text-white/35">Preview</p>
                  <MathText text={referenceAnswer} className="text-[13.5px] text-ink dark:text-white" />
                </div>
              )}
            </label>
          )}

          <label className="block w-32">
            <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Points</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
              className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
            />
          </label>

          {error && <p className="rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2 text-[12.5px] text-crimson-700 dark:text-crimson-500">{error}</p>}
        </div>

        <div className="flex gap-2.5 border-t border-black/5 dark:border-white/10 px-5 py-4">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-lg border border-black/10 dark:border-white/15 py-2.5 text-[13px] font-medium text-ink/70 dark:text-white/70 hover:bg-background-muted dark:hover:bg-white/5 disabled:opacity-50"
          >
            {!initial && savedCount > 0 ? "Done" : "Cancel"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-crimson-600 py-2.5 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700 disabled:opacity-70"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Save question"}
          </button>
        </div>
      </div>
    </div>
  );
}
