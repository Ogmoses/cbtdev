"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Loader2, Mail } from "lucide-react";

interface Pending {
  newEmail: string;
  oldApproved: boolean;
  newApproved: boolean;
  expiresAt: string;
}

/** School admins only: ask to change the sign-in email. Both the current and the new address must approve. */
export default function ChangeEmail({ currentEmail }: { currentEmail: string | null }) {
  const [pending, setPending] = useState<Pending | null | undefined>(undefined); // undefined = still loading
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hadPending, setHadPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/email-change", { cache: "no-store" });
      if (res.status === 401) {
        // the change went through: every sign-in was ended, so sign in again with the new address
        if (hadPending) window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPending(json.pending as Pending | null);
      if (json.pending) setHadPending(true);
    } catch {
      setPending((cur) => (cur === undefined ? null : cur));
    }
  }, [hadPending]);

  useEffect(() => {
    load();
  }, [load]);

  // while a request is waiting, check every 10 seconds (the other address may approve at any time)
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 10_000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const send = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/account/email-change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newEmail }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't send the request.");
      setOpen(false);
      setNewEmail("");
      setNotice("We've emailed both addresses. The change happens when both approve.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/account/email-change", { method: "DELETE" });
      setNotice("The request was cancelled. Nothing was changed.");
      setHadPending(false);
      await load();
    } catch {
      setError("Couldn't cancel. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const step = (done: boolean, label: string) => (
    <li className="flex items-start gap-2 text-[12.5px] text-ink/75 dark:text-white/75">
      {done ? <Check size={14} className="mt-0.5 shrink-0 text-success" /> : <Clock size={14} className="mt-0.5 shrink-0 text-ink/35 dark:text-white/35" />}
      <span className="break-all">{label}</span>
    </li>
  );

  return (
    <div className="mt-5 rounded-lg border border-black/5 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#1A1C20]">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink dark:text-white">
        <Mail size={15} /> Change sign-in email
      </p>

      {pending === undefined ? (
        <div className="flex justify-center py-4 text-ink/40 dark:text-white/40">
          <Loader2 className="animate-spin" size={16} />
        </div>
      ) : pending ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12.5px] text-ink/60 dark:text-white/60">
            Waiting to change your email to <strong className="break-all text-ink dark:text-white">{pending.newEmail}</strong>. Both addresses must approve.
          </p>
          <ul className="space-y-1.5">
            {step(pending.oldApproved, `Current address${currentEmail ? ` (${currentEmail})` : ""}: ${pending.oldApproved ? "approved" : "waiting for approval"}`)}
            {step(pending.newApproved, `New address: ${pending.newApproved ? "confirmed" : "waiting for confirmation"}`)}
          </ul>
          <p className="text-[11.5px] text-ink/45 dark:text-white/45">
            Check both inboxes (and spam). The links expire {new Date(pending.expiresAt).toLocaleString()}. When both have approved you'll be signed out everywhere and can sign in with the new address.
          </p>
          <button type="button" disabled={busy} onClick={cancel} className="rounded-md bg-background-muted px-3 py-1.5 text-[12px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/70">
            {busy ? "Cancelling…" : "Cancel request"}
          </button>
        </div>
      ) : open ? (
        <div className="mt-3 space-y-3">
          <p className="text-[12.5px] leading-relaxed text-ink/60 dark:text-white/60">
            We'll email <strong>both</strong> your current address and the new one. The email only changes after each of them approves.
          </p>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new-address@example.com"
            autoFocus
            className="w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white"
          />
          {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setError(null); }} className="rounded-lg bg-background-muted px-4 py-2 text-[13px] font-medium text-ink/70 dark:bg-white/5 dark:text-white/70">
              Cancel
            </button>
            <button type="button" disabled={busy || !newEmail.trim()} onClick={send} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-crimson-600 px-4 py-2 text-[13px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
              {busy && <Loader2 size={13} className="animate-spin" />} Send approval emails
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {notice && (
            <p className="flex items-center gap-2 rounded-lg bg-success/10 p-2.5 text-[12.5px] text-ink dark:text-white">
              <Check size={14} className="shrink-0 text-success" /> {notice}
            </p>
          )}
          <button type="button" onClick={() => { setOpen(true); setNotice(null); }} className="rounded-lg bg-crimson-600 px-4 py-2 text-[13px] font-medium text-on-crimson hover:bg-crimson-700">
            Change email
          </button>
        </div>
      )}
    </div>
  );
}
