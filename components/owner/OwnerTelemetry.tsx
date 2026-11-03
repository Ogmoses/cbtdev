"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Building2, Check, LogIn, Users } from "lucide-react";

interface RadarRow {
  exam_title: string;
  school: string;
  writing: number;
  submitted: number;
  window_ends_at: string | null;
}
interface FeedItem {
  at: string;
  type: "submission" | "login" | "signup";
  school: string | null;
  role: "super_admin" | "teacher" | "student" | null;
}
interface Telemetry {
  active_schools: number;
  total_students: number;
  submissions_today: number;
  students_writing: number;
  live_exams: number;
  radar: RadarRow[];
  feed: FeedItem[];
  serverTime: string;
}

const POLL_MS = 10_000;
const ROLE_WORD = { super_admin: "A school admin", teacher: "A teacher", student: "A student" } as const;

function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function describe(e: FeedItem): { icon: ReactNode; text: string } {
  const school = e.school ?? "a school";
  if (e.type === "submission") return { icon: <Check size={14} />, text: `An exam was submitted · ${school}` };
  if (e.type === "signup") return { icon: <Building2 size={14} />, text: `New school registered · ${school}` };
  return { icon: <LogIn size={14} />, text: `${e.role ? ROLE_WORD[e.role] : "Someone"} signed in · ${school}` };
}

/**
 * The owner's live view: counters, the exams running right now, and a privacy-safe activity feed.
 * Refreshes every 10 seconds while the tab is visible (and straight away when you come back to it).
 */
export default function OwnerTelemetry() {
  const [data, setData] = useState<Telemetry | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0); // the owner's own midnight
      const res = await fetch(`/api/owner/telemetry?dayStart=${encodeURIComponent(dayStart.toISOString())}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Telemetry);
      setStale(false);
      setNow(Date.now());
    } catch {
      setStale(true); // keep showing the last numbers
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5_000); // keeps "2m ago" honest between polls
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const card = "rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]";
  const num = (n: number | undefined) => (data ? (n ?? 0).toLocaleString() : "–");

  return (
    <section className="mb-8 space-y-4" aria-label="Live platform overview">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink dark:text-white">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${stale ? "bg-amber-500" : "animate-ping bg-success opacity-60"}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${stale ? "bg-amber-500" : "bg-success"}`} />
          </span>
          Live overview
        </p>
        <p className="text-[11.5px] text-ink/45 dark:text-white/45">{stale ? "Reconnecting…" : data ? `Updated ${new Date(data.serverTime).toLocaleTimeString()}` : "Loading…"}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={card}>
          <p className="flex items-center gap-1.5 text-[12px] text-ink/50 dark:text-white/50"><Building2 size={13} /> Active schools</p>
          <p className="mt-1 font-display text-[24px] font-semibold text-ink dark:text-white">{num(data?.active_schools)}</p>
        </div>
        <div className={card}>
          <p className="flex items-center gap-1.5 text-[12px] text-ink/50 dark:text-white/50"><Users size={13} /> Total students</p>
          <p className="mt-1 font-display text-[24px] font-semibold text-ink dark:text-white">{num(data?.total_students)}</p>
        </div>
        <div className={card}>
          <p className="flex items-center gap-1.5 text-[12px] text-ink/50 dark:text-white/50"><Activity size={13} /> Live exams now</p>
          <p className="mt-1 font-display text-[24px] font-semibold text-ink dark:text-white">{num(data?.live_exams)}</p>
          <p className="text-[11.5px] text-ink/45 dark:text-white/45">{data ? `${data.students_writing} writing` : ""}</p>
        </div>
        <div className={card}>
          <p className="flex items-center gap-1.5 text-[12px] text-ink/50 dark:text-white/50"><Check size={13} /> Submitted today</p>
          <p className="mt-1 font-display text-[24px] font-semibold text-ink dark:text-white">{num(data?.submissions_today)}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <p className="mb-2 text-[13.5px] font-semibold text-ink dark:text-white">Exam Radar</p>
          {!data ? (
            <p className="py-6 text-center text-[12.5px] text-ink/40 dark:text-white/40">Loading…</p>
          ) : data.radar.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-ink/45 dark:text-white/45">No exams running right now.</p>
          ) : (
            <div className="space-y-2">
              {data.radar.map((r, i) => (
                <div key={`${r.exam_title}-${r.school}-${i}`} className="rounded-md bg-background-muted p-3 dark:bg-white/5">
                  <p className="truncate text-[13px] font-medium text-ink dark:text-white">{r.exam_title}</p>
                  <p className="truncate text-[11.5px] text-ink/50 dark:text-white/50">{r.school}</p>
                  <p className="mt-1 text-[12px] text-ink/70 dark:text-white/70">
                    <strong>{r.writing}</strong> writing now · {r.submitted} submitted
                    {r.window_ends_at ? ` · window closes ${new Date(r.window_ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={card}>
          <p className="mb-2 text-[13.5px] font-semibold text-ink dark:text-white">Recent activity</p>
          {!data ? (
            <p className="py-6 text-center text-[12.5px] text-ink/40 dark:text-white/40">Loading…</p>
          ) : data.feed.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-ink/45 dark:text-white/45">Nothing yet.</p>
          ) : (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {data.feed.map((e, i) => {
                const d = describe(e);
                return (
                  <li key={`${e.at}-${i}`} className="flex items-start gap-2.5 text-[12.5px] text-ink/80 dark:text-white/80">
                    <span className="mt-0.5 shrink-0 text-ink/40 dark:text-white/40">{d.icon}</span>
                    <span className="min-w-0 flex-1 break-words">{d.text}</span>
                    <span className="shrink-0 text-[11px] text-ink/40 dark:text-white/40">{ago(e.at, now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink/40 dark:text-white/40">Student names and IDs are never shown here.</p>
        </div>
      </div>
    </section>
  );
}
