"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";

/** The person's name with a pencil beside it: tap, type, save. (Students don't get the pencil.) */
export default function EditableName({ name, canEdit, onSaved }: { name: string; canEdit: boolean; onSaved: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setValue(name);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (value.trim() === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/name", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: value }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't save your name.");
      onSaved(json.fullName as string);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your name.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="mt-3 flex items-center justify-center gap-2">
        <h1 className="font-display text-[19px] font-semibold text-ink dark:text-white">{name}</h1>
        {canEdit && (
          <button type="button" onClick={start} aria-label="Edit name" className="rounded-md p-1.5 text-ink/45 hover:bg-background-muted hover:text-crimson-600 dark:text-white/45 dark:hover:bg-white/10">
            <Pencil size={15} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 w-full max-w-xs">
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={100}
          autoFocus
          aria-label="Your name"
          className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-center text-[15px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white"
        />
        <button type="button" onClick={save} disabled={busy} aria-label="Save name" className="rounded-md bg-crimson-600 p-2 text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} aria-label="Cancel" className="rounded-md bg-background-muted p-2 text-ink/60 hover:text-crimson-600 dark:bg-white/5 dark:text-white/60">
          <X size={15} />
        </button>
      </div>
      {error && <p className="mt-2 rounded-md bg-crimson-50 px-3 py-2 text-[12px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}
    </div>
  );
}
