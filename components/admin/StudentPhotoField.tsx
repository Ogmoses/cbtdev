"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import ImageCropModal from "@/components/ui/ImageCropModal";

/** Passport photo for one student (used in the report card). Crops to the passport frame, then saves privately. */
export default function StudentPhotoField({ studentId }: { studentId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!studentId);
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    fetch(`/api/admin/people/photo?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setUrl(j?.url ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const upload = async (cropped: File) => {
    setPicked(null);
    if (!studentId) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("studentId", studentId);
      form.set("file", cropped);
      const res = await fetch("/api/admin/people/photo", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't save the photo.");
      setUrl(json.url ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the photo.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!studentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/people/photo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't remove the photo.");
      setUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Passport photo (used on the report card)</span>
      {!studentId ? (
        <p className="rounded-lg bg-background-muted p-3 text-[12px] text-ink/55 dark:bg-white/5 dark:text-white/55">Save the student first, then open them again to add a photo.</p>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-dashed border-black/20 bg-background-muted text-ink/40 dark:border-white/20 dark:bg-white/5 dark:text-white/40">
            {loading || busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Student passport" className="h-full w-full object-cover" />
            ) : (
              <Camera size={18} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-md bg-background-muted px-3 py-1.5 text-[12px] font-medium text-ink/75 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/75">
              {url ? "Change photo" : "Add photo"}
            </button>
            {url && (
              <button type="button" disabled={busy} onClick={remove} className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] text-ink/50 hover:text-crimson-600 disabled:opacity-60 dark:text-white/50">
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPicked(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {error && <p className="mt-2 rounded-md bg-crimson-50 px-3 py-2 text-[12px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}
      {picked && <ImageCropModal file={picked} shape="rect" fixedAspect={4 / 5} maxOutput={600} title="Passport photo" onCancel={() => setPicked(null)} onDone={upload} />}
    </div>
  );
}
