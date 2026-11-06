"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, RefreshCw, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AuditRow {
  id: number;
  created_at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  school_id: string | null;
  school_name: string | null;
  details: Record<string, unknown>;
}

const PAGE_SIZE = 25;

const FILTERS: { label: string; value: string }[] = [
  { label: "All actions", value: "" },
  { label: "School created", value: "school.create" },
  { label: "Approved", value: "school.approve" },
  { label: "Suspended", value: "school.suspend" },
  { label: "Reactivated", value: "school.reactivate" },
  { label: "Deletions", value: "school.delete%" },
  { label: "Stale sign-up clean-ups", value: "school.purge_stale%" },
  { label: "Billing", value: "billing.%" },
  { label: "Data exports", value: "school.export%" },
  { label: "Support tickets", value: "support.%" },
  { label: "Broadcasts", value: "broadcast.%" },
  { label: "Maintenance & sign-up switches", value: "flags.%" },
  { label: "Security (rate limits)", value: "security.%" },
];

const LABELS: Record<string, string> = {
  "school.create": "School created",
  "school.approve": "School approved",
  "school.suspend": "School suspended",
  "school.reactivate": "School reactivated",
  "school.delete_started": "Deletion started",
  "school.delete_completed": "School deleted",
  "school.delete_failed": "Deletion failed",
  "school.purge_stale_started": "Old sign-up removal started",
  "school.purge_stale_completed": "Old sign-up removed",
  "school.purge_stale_failed": "Old sign-up removal failed",
  "billing.update": "Billing updated",
  "billing.auto_expired": "Term ended: school locked",
  "billing.reminder_sent": "Renewal reminder emailed",
  "billing.contact_updated": "Renewal contact updated",
  "school.export_created": "Data export started",
  "school.export_downloaded": "Data export downloaded",
  "school.export_deleted": "Data export removed",
  "support.reply": "Support reply sent",
  "support.status_changed": "Support ticket status changed",
  "broadcast.create": "Broadcast sent",
  "broadcast.create_failed": "Broadcast failed to send",
  "broadcast.edit": "Broadcast edited",
  "broadcast.edit_failed": "Broadcast edit failed",
  "broadcast.end": "Broadcast ended",
  "flags.maintenance_on": "Maintenance mode turned ON",
  "flags.maintenance_off": "Maintenance mode turned off",
  "flags.maintenance_message_changed": "Maintenance message changed",
  "flags.signups_opened": "School sign-ups opened",
  "flags.signups_closed": "School sign-ups paused",
  "security.rate_limit_cleared": "Rate limit cleared",
};

function tone(action: string): string {
  if (action.includes("delete") || action.includes("purge") || action === "billing.auto_expired" || action.endsWith("suspend") || action === "flags.maintenance_on" || action === "flags.signups_closed") return "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500";
  if (action.endsWith("approve") || action.endsWith("reactivate") || action.endsWith("create") || action === "flags.maintenance_off" || action === "flags.signups_opened") return "bg-success/10 text-success";
  return "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70";
}

export default function AuditLogs() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [filter, setFilter] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; checked: number; brokenAt: number | null } | null>(null);

  const fetchPage = useCallback(
    async (from: number) => {
      let q = supabase
        .from("audit_logs")
        .select("id, created_at, actor_email, action, target_type, target_id, school_id, school_name, details")
        .order("id", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (filter) q = filter.includes("%") ? q.like("action", filter) : q.eq("action", filter);
      const { data, error: qError } = await q;
      if (qError) throw qError;
      return (data ?? []) as AuditRow[];
    },
    [supabase, filter]
  );

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      const page = await fetchPage(0);
      setRows(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setError("Couldn't load the audit log. Try again.");
      setRows([]);
    }
  }, [fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!rows) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(rows.length);
      setRows([...rows, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setError("Couldn't load more entries.");
    } finally {
      setLoadingMore(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    setVerdict(null);
    try {
      const res = await fetch("/api/owner/audit-logs/verify");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "failed");
      setVerdict(body);
    } catch {
      setError("Couldn't check the log's integrity. Try again.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink/55 dark:text-white/55">
        A permanent record of owner-level actions. Entries can be added but never edited or removed, and each one is chained to the one before it so tampering is detectable.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by action"
          className="rounded-lg bg-white px-3 py-2 text-[13px] text-ink shadow-card dark:bg-[#1A1C20] dark:text-white"
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={load} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-ink/70 shadow-card dark:bg-[#1A1C20] dark:text-white/70">
          <RefreshCw size={14} /> Refresh
        </button>
        <button
          type="button"
          onClick={verify}
          disabled={verifying}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-crimson-600 px-3.5 py-2 text-[13px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60"
        >
          {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Verify integrity
        </button>
      </div>

      {verdict && (
        <div
          className={`flex items-start gap-2 rounded-lg p-3.5 text-[12.5px] ${
            verdict.ok ? "bg-success/10 text-ink dark:text-white" : "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500"
          }`}
        >
          {verdict.ok ? <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" /> : <ShieldAlert size={16} className="mt-0.5 shrink-0" />}
          <p>
            {verdict.ok
              ? `All ${verdict.checked} entries check out. Nothing has been altered.`
              : `The log was altered outside the app. The first entry that doesn't match is #${verdict.brokenAt} (${verdict.checked} entries before it are intact).`}
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      {!rows ? (
        <div className="flex items-center justify-center py-20 text-ink/40 dark:text-white/40">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-ink/45 dark:text-white/45">No entries yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const open = openId === r.id;
            return (
              <div key={r.id} className="rounded-lg bg-white p-3.5 shadow-card dark:bg-[#1A1C20]">
                <button type="button" onClick={() => setOpenId(open ? null : r.id)} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tone(r.action)}`}>{LABELS[r.action] ?? r.action}</span>
                    <p className="mt-1.5 truncate text-[13px] font-medium text-ink dark:text-white">{r.school_name ?? r.target_id ?? "Platform"}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink/45 dark:text-white/45">
                      {new Date(r.created_at).toLocaleString()} · {r.actor_email ?? "unknown"}
                    </p>
                  </div>
                  <ChevronDown size={16} className={`mt-1 shrink-0 text-ink/35 transition-transform dark:text-white/35 ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <pre className="mt-3 overflow-x-auto rounded-md bg-background-muted p-3 text-[11.5px] text-ink/80 dark:bg-white/5 dark:text-white/80">
                    {JSON.stringify({ entry: r.id, action: r.action, target: `${r.target_type ?? "-"}:${r.target_id ?? "-"}`, ...r.details }, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
          {hasMore && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="w-full rounded-lg bg-white py-2.5 text-[13px] font-medium text-ink/70 shadow-card disabled:opacity-60 dark:bg-[#1A1C20] dark:text-white/70">
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
