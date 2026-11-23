"use client";

import { useState } from "react";
import { Loader2, Lock, Unlock, Users } from "lucide-react";
import { batchState, type BatchWindowFields } from "@/lib/batchWindow";

export interface SittingRow extends BatchWindowFields {
  id: string;
  label: string;
}

const STATE_LABEL = { upcoming: "Not open yet", open: "Open", ended: "Closed" } as const;
const STATE_TONE = {
  upcoming: "bg-black/5 text-ink/60 dark:bg-white/10 dark:text-white/60",
  open: "bg-success/10 text-success",
  ended: "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500",
} as const;

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Sitting controls that stay available even after students have been assigned or have started (when the exam's
 * schedule itself is locked): close a sitting, reopen it, or add the rest of the class to it.
 */
export default function BatchWindowControls({ sittings: initial }: { sittings: SittingRow[] }) {
  const [sittings, setSittings] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const act = async (id: string, action: "close" | "reopen" | "add_class") => {
    setBusy(`${id}:${action}`);
    setMessage(null);
    try {
      const res = await fetch("/api/teacher/batch-window", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      if (action === "add_class") {
        setMessage({ ok: true, text: data.added > 0 ? `Added ${data.added} student${data.added === 1 ? "" : "s"} from the class to this sitting.` : "Everyone in the class is already in a sitting." });
      } else {
        setSittings((rows) => rows.map((r) => (r.id === id ? { ...r, stays_open: data.stays_open, closed_at: data.closed_at } : r)));
        setMessage({ ok: true, text: action === "close" ? "Sitting closed. Anyone already writing can finish their own time." : "Sitting reopened." });
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };

  if (sittings.length === 0) return null;

  return (
    <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-black/5 bg-white p-4 text-left shadow-card dark:border-white/10 dark:bg-[#1A1C20]">
      <h2 className="font-display text-[14px] font-semibold text-ink dark:text-white">Sittings</h2>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/55 dark:text-white/55">
        Close a sitting when you're done, or reopen it for the next set of students. Closing never cuts off someone who is already writing, and no student can sit the exam twice.
      </p>
      <div className="mt-3 space-y-2">
        {sittings.map((s) => {
          const state = batchState(s);
          const closing = busy === `${s.id}:close`;
          const reopening = busy === `${s.id}:reopen`;
          const adding = busy === `${s.id}:add_class`;
          return (
            <div key={s.id} className="rounded-lg border border-black/5 p-3 dark:border-white/10">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-ink dark:text-white">{s.label}</p>
                  <p className="text-[11.5px] text-ink/50 dark:text-white/50">
                    From {fmt(s.starts_at)} · {s.stays_open ? "open until you close it" : `until ${fmt(s.ends_at)}`}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {state === "ended" ? (
                  <button onClick={() => act(s.id, "reopen")} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg bg-crimson-600 px-3 py-1.5 text-[12.5px] font-semibold text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
                    {reopening ? <Loader2 size={13} className="animate-spin" /> : <Unlock size={13} />} Reopen{!s.stays_open && new Date(s.ends_at).getTime() < Date.now() ? " (stays open until you close it)" : ""}
                  </button>
                ) : (
                  <button onClick={() => act(s.id, "close")} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-[12.5px] font-medium text-ink/70 hover:bg-background-muted disabled:opacity-60 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/5">
                    {closing ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} Close now
                  </button>
                )}
                <button onClick={() => act(s.id, "add_class")} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-[12.5px] font-medium text-ink/70 hover:bg-background-muted disabled:opacity-60 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/5">
                  {adding ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Add whole class
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {message && <p className={`mt-3 text-[12.5px] ${message.ok ? "text-success" : "text-crimson-700 dark:text-crimson-500"}`}>{message.text}</p>}
    </div>
  );
}
