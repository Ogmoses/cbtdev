"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { refreshSupportAttention } from "@/lib/supportAttention";

type Status = "open" | "in_progress" | "resolved";
type Tab = Status | "all";

interface Ticket {
  id: string;
  school: string;
  sentBy: string;
  sentByEmail: string | null;
  sentByRole: "super_admin" | "teacher";
  subject: string;
  category: string;
  priority: string;
  message: string;
  status: Status;
  ownerReply: string | null;
  repliedAt: string | null;
  createdAt: string;
  screenshots: { id: string; url: string }[];
}

const TABS: { value: Tab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];
const STATUS_LABEL: Record<Status, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
const STATUS_STYLE: Record<Status, string> = {
  open: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  in_progress: "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70",
  resolved: "bg-success/10 text-success",
};
const PRIORITY_STYLE: Record<string, string> = {
  urgent: "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500",
  high: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
};
const CATEGORY_LABEL: Record<string, string> = { question: "Question", bug: "Something's broken", account: "Account / sign-in", billing: "Billing", other: "Other" };

const field =
  "w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white";

export default function SupportInbox() {
  const [tab, setTab] = useState<Tab>("open");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [counts, setCounts] = useState<Record<Status, number>>({ open: 0, in_progress: 0, resolved: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<Status>("open");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/owner/support${tab === "all" ? "" : `?status=${tab}`}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setTickets(json.tickets as Ticket[]);
      setCounts(json.counts);
    } catch {
      setError("Couldn't load the inbox. Try again.");
      setTickets([]);
    }
  }, [tab]);

  useEffect(() => {
    setTickets(null);
    load();
  }, [load]);

  const toggle = (t: Ticket) => {
    if (openId === t.id) {
      setOpenId(null);
      return;
    }
    setOpenId(t.id);
    setReplyDraft(t.ownerReply ?? "");
    setStatusDraft(t.status);
    setNotice(null);
  };

  const save = async (t: Ticket) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { id: t.id };
      if (statusDraft !== t.status) body.status = statusDraft;
      if (replyDraft.trim() !== (t.ownerReply ?? "")) body.reply = replyDraft;
      if (Object.keys(body).length === 1) {
        setNotice("Nothing to save: no reply or status change.");
        return;
      }
      const res = await fetch("/api/owner/support", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't save.");
      setNotice(
        json.emailFailed
          ? `Saved, but ${json.emailed ? "some emails" : "the email"} couldn't be sent. Check your email settings.`
          : `Saved. ${json.emailed} email${json.emailed === 1 ? "" : "s"} sent to the school.`
      );
      setOpenId(null);
      refreshSupportAttention();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const tabCount = (v: Tab) => (v === "all" ? counts.open + counts.in_progress + counts.resolved : counts[v]);

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink/55 dark:text-white/55">
        Requests from school admins and teachers. Your reply and status changes are emailed to the school, and every one is recorded in the audit log.
      </p>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium ${
              tab === t.value ? "bg-crimson-600 text-on-crimson" : "bg-white text-ink/70 shadow-card dark:bg-[#1A1C20] dark:text-white/70"
            }`}
          >
            {t.label} ({tabCount(t.value)})
          </button>
        ))}
      </div>

      {notice && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-[12.5px] text-ink dark:text-white">
          <Check size={15} className="text-success" /> {notice}
        </p>
      )}
      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      {!tickets ? (
        <div className="flex items-center justify-center py-16 text-ink/40 dark:text-white/40">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : tickets.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-ink/45 dark:text-white/45">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => {
            const open = openId === t.id;
            return (
              <div key={t.id} className="rounded-lg bg-white p-3.5 shadow-card dark:bg-[#1A1C20]">
                <button type="button" onClick={() => toggle(t)} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      {PRIORITY_STYLE[t.priority] && (
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
                      )}
                      <span className="text-[11.5px] text-ink/45 dark:text-white/45">{CATEGORY_LABEL[t.category] ?? t.category}</span>
                    </div>
                    <p className="mt-1.5 truncate text-[13.5px] font-semibold text-ink dark:text-white">{t.subject}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink/45 dark:text-white/45">
                      {t.school} · {t.sentBy} ({t.sentByRole === "teacher" ? "teacher" : "admin"}) · {new Date(t.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <ChevronDown size={16} className={`mt-1 shrink-0 text-ink/35 transition-transform dark:text-white/35 ${open ? "rotate-180" : ""}`} />
                </button>

                {open && (
                  <div className="mt-3 space-y-3">
                    <p className="whitespace-pre-line break-words text-[13px] text-ink dark:text-white">{t.message}</p>
                    {t.sentByEmail && <p className="text-[11.5px] text-ink/45 dark:text-white/45">{t.sentByEmail}</p>}
                    {t.screenshots.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {t.screenshots.map((s) => (
                          <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-md bg-background-muted dark:bg-white/5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={s.url} alt="Screenshot" className="h-full w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div>
                      <label className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60" htmlFor={`reply-${t.id}`}>Your reply (the school sees this)</label>
                      <textarea id={`reply-${t.id}`} value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={4} maxLength={4000} className={field} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value as Status)} aria-label="Status" className="rounded-lg bg-background-muted px-3 py-2 text-[13px] text-ink dark:bg-white/5 dark:text-white">
                        <option value="open">Open</option>
                        <option value="in_progress">In progress</option>
                        <option value="resolved">Resolved</option>
                      </select>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => save(t)}
                        className="ml-auto flex items-center gap-1.5 rounded-md bg-crimson-600 px-3.5 py-2 text-[12.5px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60"
                      >
                        {saving && <Loader2 size={13} className="animate-spin" />} Save &amp; notify school
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
