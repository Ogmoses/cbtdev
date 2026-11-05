"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Trash2 } from "lucide-react";

interface ExportItem {
  id: string;
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  requestedByName: string | null;
  requestedByRole: "platform_owner" | "super_admin";
  status: "working" | "ready" | "failed";
  sizeBytes: number | null;
  filesIncluded: number;
  filesSkipped: number;
  error: string | null;
  createdAt: string;
  expiresAt: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function daysLeft(iso: string): string {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return d <= 1 ? "expires today" : `${d} days left`;
}

/**
 * Data exports of a school.
 *  mode "owner" + schoolId : that school (Create button shown)       -> used in the school menu and the delete dialog
 *  mode "owner", no schoolId: every export of every school (also deleted ones)  -> the Data Exports page
 *  mode "admin"            : the signed-in admin's own school
 * Polls every 3 seconds while an export is being built.
 */
export default function SchoolExports({ mode, schoolId, compact = false }: { mode: "owner" | "admin"; schoolId?: string; compact?: boolean }) {
  const base = mode === "admin" ? "/api/admin/exports" : "/api/owner/exports";
  const [items, setItems] = useState<ExportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCreate = mode === "admin" || !!schoolId;

  const load = useCallback(async () => {
    try {
      const res = await fetch(mode === "owner" && schoolId ? `${base}?schoolId=${encodeURIComponent(schoolId)}` : base, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setItems((await res.json()).exports as ExportItem[]);
    } catch {
      setError("Couldn't load the exports. Try again.");
      setItems((cur) => cur ?? []);
    }
  }, [base, mode, schoolId]);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  // keep checking while something is still being built
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (items?.some((i) => i.status === "working")) timer.current = setTimeout(load, 3000);
  }, [items, load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "owner" ? { schoolId } : {}) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't start the export.");
      setNotice("Export started. It usually takes under a minute; this list updates by itself.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the export.");
    } finally {
      setCreating(false);
    }
  };

  const download = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/exports/${id}/download`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error ?? "Couldn't start the download.");
      window.location.href = json.url as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the download.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/owner/exports", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't remove the export.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the export.");
    } finally {
      setBusyId(null);
    }
  };

  const small = "flex items-center justify-center gap-1.5 rounded-md bg-background-muted px-3 py-1.5 text-[12px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/70";

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-[12.5px] leading-relaxed text-ink/55 dark:text-white/55">
          A ZIP of spreadsheets (students, staff, results, every table) plus the logo and question images. Passwords and PIN codes are never included. Exports are kept for 30 days.
        </p>
      )}

      {canCreate && (
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="flex items-center justify-center gap-2 rounded-lg bg-crimson-600 px-4 py-2.5 text-[13px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Create a new export
        </button>
      )}

      {notice && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-2.5 text-[12px] text-ink dark:text-white">
          <Check size={14} className="shrink-0 text-success" /> {notice}
        </p>
      )}
      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      {!items ? (
        <div className="flex justify-center py-6 text-ink/40 dark:text-white/40">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : items.length === 0 ? (
        <p className="py-3 text-center text-[12.5px] text-ink/45 dark:text-white/45">No exports yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((e) => (
            <div key={e.id} className="rounded-lg bg-background-muted p-3 dark:bg-white/5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {mode === "owner" && !schoolId && <p className="truncate text-[13px] font-semibold text-ink dark:text-white">{e.schoolName}</p>}
                  <p className="text-[12.5px] text-ink/70 dark:text-white/70">
                    {new Date(e.createdAt).toLocaleString()}
                    {e.sizeBytes ? ` · ${formatSize(e.sizeBytes)}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink/45 dark:text-white/45">
                    by {e.requestedByName ?? "unknown"} ({e.requestedByRole === "platform_owner" ? "owner" : "school admin"})
                    {e.status === "ready" ? ` · ${daysLeft(e.expiresAt)}` : ""}
                    {e.status === "ready" && e.filesSkipped > 0 ? ` · ${e.filesSkipped} image${e.filesSkipped === 1 ? "" : "s"} not included` : ""}
                  </p>
                  {e.status === "working" && (
                    <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink/60 dark:text-white/60">
                      <Loader2 size={12} className="animate-spin" /> Preparing…
                    </p>
                  )}
                  {e.status === "failed" && (
                    <p className="mt-1 flex items-start gap-1.5 text-[12px] text-crimson-700 dark:text-crimson-500">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Failed{e.error ? `: ${e.error}` : ""}. Try creating it again.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  {e.status === "ready" && (
                    <button type="button" disabled={busyId === e.id} onClick={() => download(e.id)} className={small}>
                      {busyId === e.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Download
                    </button>
                  )}
                  {mode === "owner" && e.status !== "working" && (
                    <button type="button" disabled={busyId === e.id} onClick={() => remove(e.id)} className={small}>
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
