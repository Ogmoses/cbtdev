"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImagePlus, LifeBuoy, Loader2, X } from "lucide-react";
import { refreshSupportAttention } from "@/lib/supportAttention";

type Status = "open" | "in_progress" | "resolved";

interface Ticket {
  id: string;
  subject: string;
  category: string;
  priority: string;
  message: string;
  status: Status;
  ownerReply: string | null;
  repliedAt: string | null;
  createdAt: string;
  sentBy: string;
  screenshots: { id: string; url: string }[];
}

const CATEGORIES = [
  { value: "question", label: "Question" },
  { value: "bug", label: "Something's broken" },
  { value: "account", label: "Account / sign-in" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];
const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
const STATUS_LABEL: Record<Status, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
const STATUS_STYLE: Record<Status, string> = {
  open: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  in_progress: "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70",
  resolved: "bg-success/10 text-success",
};

const MAX_FILES = 3;
const MAX_BYTES = 1_300_000;

/** Shrinks a screenshot in the browser (phone photos and full-screen captures are huge) so it uploads fast and fits. */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Screenshots must be PNG, JPEG or WebP images.");
  const bitmap = await createImageBitmap(file);
  let maxSide = 1600;
  let quality = 0.82;
  for (let attempt = 0; attempt < 3; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't prepare the screenshot.");
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_BYTES) {
      bitmap.close?.();
      return new File([blob], `screenshot-${Date.now()}.jpg`, { type: "image/jpeg" });
    }
    maxSide = Math.round(maxSide * 0.75);
    quality = Math.max(0.5, quality - 0.15);
  }
  bitmap.close?.();
  throw new Error("That screenshot is too large to send. Try a smaller one.");
}

const field =
  "w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white";
const label = "mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60";

/** "Help & Support": send a request to the platform owner, and see the answers. Used by school admins and teachers. */
export default function SupportDesk({ role }: { role: "super_admin" | "teacher" }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("question");
  const [priority, setPriority] = useState("normal");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<{ file: File; preview: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const list = (await res.json()).tickets as Ticket[];
      setTickets(list);
      // Opening this page counts as reading the updates: clear the bell and the sidebar dot.
      if (list.some((t) => t.status !== "open")) {
        fetch("/api/support/seen", { method: "POST" })
          .then(() => refreshSupportAttention())
          .catch(() => {});
      }
    } catch {
      setError("Couldn't load your requests. Try again.");
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.preview)), [files]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const room = MAX_FILES - files.length;
    if (list.length > room) setError(`You can attach up to ${MAX_FILES} screenshots.`);
    const next: { file: File; preview: string }[] = [];
    for (const f of Array.from(list).slice(0, Math.max(room, 0))) {
      try {
        const small = await shrinkImage(f);
        next.push({ file: small, preview: URL.createObjectURL(small) });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't use that screenshot.");
      }
    }
    setFiles((cur) => [...cur, ...next]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeFile = (i: number) =>
    setFiles((cur) => {
      URL.revokeObjectURL(cur[i].preview);
      return cur.filter((_, idx) => idx !== i);
    });

  const send = async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("subject", subject);
      form.set("category", category);
      form.set("priority", priority);
      form.set("message", message);
      files.forEach((f) => form.append("files", f.file));
      const res = await fetch("/api/support/tickets", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't send your request.");
      setNotice("Request sent. You'll get an email when the platform owner replies.");
      setSubject("");
      setMessage("");
      setCategory("question");
      setPriority("normal");
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your request.");
    } finally {
      setSending(false);
    }
  };

  const card = "rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]";

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink/55 dark:text-white/55">
        Stuck, or something not working? Send a request to the platform owner. Add a screenshot if it helps.
        {role === "super_admin" ? " As an admin you also see the requests your teachers send." : " Your school admins can see your requests too."}
      </p>

      {notice && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-[12.5px] text-ink dark:text-white">
          <Check size={15} className="text-success" /> {notice}
        </p>
      )}
      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      <div className={card}>
        <p className="mb-3 flex items-center gap-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">
          <LifeBuoy size={16} /> Need help? Contact the platform owner
        </p>
        <div className="space-y-3.5">
          <div>
            <label className={label} htmlFor="sup-subject">Subject</label>
            <input id="sup-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} className={field} placeholder="e.g. Students can't open the exam" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="sup-cat">What is it about?</label>
              <select id="sup-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="sup-pri">How urgent?</label>
              <select id="sup-pri" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="sup-msg">Tell us what happened</label>
            <textarea id="sup-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={5} className={field} />
            <p className="mt-1 text-right text-[11px] text-ink/40 dark:text-white/40">{message.length}/4000</p>
          </div>

          <div>
            <span className={label}>Screenshots (optional, up to {MAX_FILES})</span>
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={f.preview} className="relative h-20 w-20 overflow-hidden rounded-md bg-background-muted dark:bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.preview} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removeFile(i)} aria-label="Remove screenshot" className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white">
                    <X size={12} />
                  </button>
                </div>
              ))}
              {files.length < MAX_FILES && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-black/20 text-[11px] text-ink/50 hover:text-crimson-600 dark:border-white/20 dark:text-white/50"
                >
                  <ImagePlus size={18} /> Add
                </button>
              )}
            </div>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          </div>

          <button
            type="button"
            onClick={send}
            disabled={sending || !subject.trim() || !message.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-2.5 text-[13.5px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-50"
          >
            {sending && <Loader2 size={14} className="animate-spin" />} Send request
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">{role === "super_admin" ? "Your school's requests" : "Your requests"}</p>
        {!tickets ? (
          <div className="flex items-center justify-center py-12 text-ink/40 dark:text-white/40">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : tickets.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink/45 dark:text-white/45">No requests yet.</p>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => (
              <div key={t.id} className={card}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  <span className="text-[11.5px] text-ink/45 dark:text-white/45">
                    {CATEGORIES.find((c) => c.value === t.category)?.label} · {new Date(t.createdAt).toLocaleDateString()}
                    {role === "super_admin" ? ` · from ${t.sentBy}` : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-[13.5px] font-semibold text-ink dark:text-white">{t.subject}</p>
                <p className="mt-0.5 whitespace-pre-line break-words text-[12.5px] text-ink/65 dark:text-white/65">{t.message}</p>
                {t.screenshots.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {t.screenshots.map((s) => (
                      <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-md bg-background-muted dark:bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt="Screenshot" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {t.ownerReply && (
                  <div className="mt-3 rounded-md bg-background-muted p-3 dark:bg-white/5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-ink/45 dark:text-white/45">
                      Reply from platform support{t.repliedAt ? ` · ${new Date(t.repliedAt).toLocaleDateString()}` : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-line break-words text-[13px] text-ink dark:text-white">{t.ownerReply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
