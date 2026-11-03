"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";

interface Row {
  key: string;
  hits: number;
  windowStart: string;
  rule: { max: number; windowSeconds: number; label: string } | null;
  windowActive: boolean | null;
  blocked: boolean;
  resetsAt: string | null;
}

/** "register:203.0.113.7" -> "203.0.113.7" */
function target(key: string) {
  const i = key.indexOf(":");
  return i === -1 ? key : key.slice(i + 1);
}

export default function SecurityRateLimits() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [prefixes, setPrefixes] = useState<{ prefix: string; label: string }[]>([]);
  const [prefix, setPrefix] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/owner/security/rate-limits${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setRows(json.rows as Row[]);
      setPrefixes(json.prefixes ?? []);
    } catch {
      setError("Couldn't load the rate limits. Try again.");
      setRows([]);
    }
  }, [prefix]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  const clear = async (key: string) => {
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/owner/security/rate-limits", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't clear that entry.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clear that entry.");
    } finally {
      setBusyKey(null);
    }
  };

  const shown = (rows ?? []).filter((r) => (blockedOnly ? r.blocked : true));
  const blockedCount = (rows ?? []).filter((r) => r.blocked).length;

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink/55 dark:text-white/55">
        The app counts requests to public endpoints (school sign-up, verification emails, student ID lookups). A connection or email that goes over its allowance is blocked until its time window ends. Clearing an entry unblocks it right away.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]">
          <p className="text-[12px] text-ink/50 dark:text-white/50">Blocked right now</p>
          <p className="mt-1 font-display text-[22px] font-semibold text-ink dark:text-white">{rows ? blockedCount : "–"}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]">
          <p className="text-[12px] text-ink/50 dark:text-white/50">Entries tracked</p>
          <p className="mt-1 font-display text-[22px] font-semibold text-ink dark:text-white">{rows ? rows.length : "–"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          aria-label="Filter by kind"
          className="rounded-lg bg-white px-3 py-2 text-[13px] text-ink shadow-card dark:bg-[#1A1C20] dark:text-white"
        >
          <option value="">All kinds</option>
          {prefixes.map((p) => (
            <option key={p.prefix} value={p.prefix}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[12.5px] text-ink/70 dark:text-white/70">
          <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} /> Blocked only
        </label>
        <button type="button" onClick={load} className="ml-auto flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-medium text-ink/70 shadow-card dark:bg-[#1A1C20] dark:text-white/70">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      {!rows ? (
        <div className="flex items-center justify-center py-20 text-ink/40 dark:text-white/40">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-ink/45 dark:text-white/45">{blockedOnly ? "Nothing is blocked right now." : "No entries."}</p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <div key={r.key} className="rounded-lg bg-white p-3.5 shadow-card dark:bg-[#1A1C20]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.blocked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-crimson-50 px-2.5 py-0.5 text-[11px] font-medium text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
                        <ShieldAlert size={12} /> Blocked
                      </span>
                    )}
                    <span className="text-[12px] text-ink/50 dark:text-white/50">{r.rule?.label ?? r.key.split(":")[0]}</span>
                  </div>
                  <p className="mt-1.5 break-all font-mono text-[12.5px] text-ink dark:text-white">{target(r.key)}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink/45 dark:text-white/45">
                    {r.hits}
                    {r.rule ? ` of ${r.rule.max} allowed` : " hits"} · since {new Date(r.windowStart).toLocaleString()}
                    {r.resetsAt ? ` · resets ${new Date(r.resetsAt).toLocaleTimeString()}` : r.windowActive === false ? " · window ended" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyKey === r.key}
                  onClick={() => clear(r.key)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-background-muted px-3 py-1.5 text-[12px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/70"
                >
                  {busyKey === r.key ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Clear
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
