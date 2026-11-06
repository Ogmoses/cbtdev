"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Lock, Unlock, Wallet } from "lucide-react";
import { refreshBilling } from "@/lib/billingEvents";

type Sub = "trial" | "active" | "expired";

interface SchoolBilling {
  id: string;
  name: string;
  code: string;
  schoolStatus: string;
  subscriptionStatus: Sub;
  effectiveStatus: Sub;
  locked: boolean;
  termEndsAt: string | null;
  daysLeft: number | null;
  agreedFee: number | null;
  paymentNotes: string | null;
}
interface Contact {
  email: string | null;
  phone: string | null;
  message: string | null;
  currency: string | null;
  timezone: string | null;
}

const PILL: Record<Sub, string> = {
  trial: "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70",
  active: "bg-success/10 text-success",
  expired: "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500",
};
const LABEL: Record<Sub, string> = { trial: "Trial", active: "Active", expired: "Expired" };

const field =
  "w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white";
const small = "rounded-md bg-background-muted px-3 py-1.5 text-[12px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-50 dark:bg-white/5 dark:text-white/70";

const timezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** The last moment of a calendar day in the owner's own time zone: "access until 15 Dec" means through the end of 15 Dec. */
function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 0);
  return e;
}
function dateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromDateInput(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  return endOfDay(new Date(y, m - 1, d));
}
/** New end date for "+1 month" / "+1 term": counted from the current end date, or from today if it has passed or there is none. */
function extended(s: SchoolBilling, plus: { months?: number; days?: number }): Date {
  const now = new Date();
  const current = s.termEndsAt ? new Date(s.termEndsAt) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  const next = new Date(base);
  if (plus.months) next.setMonth(next.getMonth() + plus.months);
  if (plus.days) next.setDate(next.getDate() + plus.days);
  return endOfDay(next);
}

function describeEnd(s: SchoolBilling): string {
  if (!s.termEndsAt) return "No end date";
  const when = new Date(s.termEndsAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (s.daysLeft === null) return `Access until ${when}`;
  if (s.daysLeft <= 0) return `Ended ${when}`;
  return `Access until ${when} (${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left)`;
}

export default function OwnerBilling() {
  const [schools, setSchools] = useState<SchoolBilling[] | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showContact, setShowContact] = useState(false);

  // the open school's editing fields
  const [status, setStatus] = useState<Sub>("active");
  const [endDate, setEndDate] = useState("");
  const [fee, setFee] = useState("");
  const [notes, setNotes] = useState("");

  // contact card fields
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cMessage, setCMessage] = useState("");
  const [cCurrency, setCCurrency] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/billing", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setSchools(json.schools as SchoolBilling[]);
      setContact(json.contact as Contact);
      setError(null);
    } catch {
      setError("Couldn't load billing. Try again.");
      setSchools((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const currencyOf = (c: Contact | null) => c?.currency ?? "";
  const money = (n: number | null) => (n === null ? "No fee set" : `${currencyOf(contact)}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const open = (s: SchoolBilling) => {
    if (openId === s.id) {
      setOpenId(null);
      return;
    }
    setOpenId(s.id);
    setStatus(s.subscriptionStatus);
    setEndDate(dateInputValue(s.termEndsAt));
    setFee(s.agreedFee === null ? "" : String(s.agreedFee));
    setNotes(s.paymentNotes ?? "");
    setNotice(null);
    setError(null);
  };

  const send = async (schoolId: string, body: Record<string, unknown>, done: string, key: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/owner/billing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schoolId, timezone: timezone(), ...body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't save. Nothing was changed.");
      setNotice(json.changed === false ? "Nothing was different, so nothing changed." : done);
      await load();
      refreshBilling();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Nothing was changed.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const extend = async (s: SchoolBilling, plus: { months?: number; days?: number }, label: string) => {
    const end = extended(s, plus);
    const ok = await send(
      s.id,
      { termEndsAt: end.toISOString(), subscriptionStatus: s.subscriptionStatus === "expired" ? "active" : s.subscriptionStatus },
      `${s.name}: access extended ${label}, until ${end.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`,
      `${s.id}:ext`
    );
    if (ok) setOpenId(null);
  };

  const save = async (s: SchoolBilling) => {
    const body: Record<string, unknown> = {};
    if (status !== s.subscriptionStatus) body.subscriptionStatus = status;
    if (endDate !== dateInputValue(s.termEndsAt)) body.termEndsAt = endDate ? fromDateInput(endDate).toISOString() : null;
    if (fee.trim() !== (s.agreedFee === null ? "" : String(s.agreedFee))) body.agreedFee = fee.trim() === "" ? null : fee.trim();
    if (notes.trim() !== (s.paymentNotes ?? "")) body.paymentNotes = notes.trim();
    if (Object.keys(body).length === 0) {
      setNotice("Nothing to save: no changes.");
      return;
    }
    const ok = await send(s.id, body, `${s.name}: saved.`, `${s.id}:save`);
    if (ok) setOpenId(null);
  };

  const openContact = () => {
    setShowContact((v) => !v);
    setCEmail(contact?.email ?? "");
    setCPhone(contact?.phone ?? "");
    setCMessage(contact?.message ?? "");
    setCCurrency(contact?.currency ?? "");
  };

  const saveContact = async () => {
    setBusy("contact");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/owner/billing/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactEmail: cEmail, contactPhone: cPhone, message: cMessage, currency: cCurrency, timezone: timezone() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't save. Nothing was changed.");
      setNotice("Renewal contact saved.");
      setShowContact(false);
      await load();
      refreshBilling();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  };

  const card = "rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]";
  const lbl = "mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60";

  return (
    <section className="mb-8 space-y-3" aria-label="Billing and access">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink dark:text-white">
          <Wallet size={16} /> Billing &amp; access
        </p>
        <button type="button" onClick={openContact} className={small}>
          Renewal contact
        </button>
      </div>

      {showContact && (
        <div className={`${card} space-y-3`}>
          <p className="text-[12.5px] text-ink/55 dark:text-white/55">Shown to a locked school's staff and in the 7-day reminder emails. Leave anything blank to hide it.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={lbl} htmlFor="bc-email">Contact email</label>
              <input id="bc-email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} className={field} placeholder="billing@example.com" />
            </div>
            <div>
              <label className={lbl} htmlFor="bc-phone">Contact phone</label>
              <input id="bc-phone" value={cPhone} onChange={(e) => setCPhone(e.target.value)} className={field} />
            </div>
          </div>
          <div>
            <label className={lbl} htmlFor="bc-msg">Short message (optional)</label>
            <textarea id="bc-msg" value={cMessage} onChange={(e) => setCMessage(e.target.value)} rows={2} maxLength={500} className={field} placeholder="e.g. Payments are by bank transfer. Send your proof of payment to the email above." />
          </div>
          <div className="max-w-[160px]">
            <label className={lbl} htmlFor="bc-cur">Currency symbol for fees</label>
            <input id="bc-cur" value={cCurrency} onChange={(e) => setCCurrency(e.target.value)} maxLength={8} className={field} placeholder="e.g. ₦ or $" />
          </div>
          <button type="button" disabled={busy === "contact"} onClick={saveContact} className="flex items-center gap-2 rounded-lg bg-crimson-600 px-4 py-2 text-[13px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
            {busy === "contact" && <Loader2 size={13} className="animate-spin" />} Save contact
          </button>
        </div>
      )}

      {notice && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-[12.5px] text-ink dark:text-white">
          <Check size={15} className="shrink-0 text-success" /> {notice}
        </p>
      )}
      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      {!schools ? (
        <div className="flex justify-center py-8 text-ink/40 dark:text-white/40">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : schools.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ink/45 dark:text-white/45">No approved schools yet.</p>
      ) : (
        <div className="space-y-2">
          {schools.map((s) => {
            const isOpen = openId === s.id;
            const manualLock = s.subscriptionStatus === "expired";
            const dateLocked = s.locked && !manualLock;
            const canUnlock = manualLock && (s.daysLeft === null || s.daysLeft > 0);
            return (
              <div key={s.id} className={`${card} ${isOpen ? "ring-2 ring-crimson-500/60" : ""}`}>
                <button type="button" onClick={() => open(s)} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${PILL[s.effectiveStatus]}`}>{LABEL[s.effectiveStatus]}</span>
                      {manualLock && <span className="text-[11px] text-ink/45 dark:text-white/45">locked by you</span>}
                      {dateLocked && <span className="text-[11px] text-ink/45 dark:text-white/45">term ended</span>}
                      {s.schoolStatus === "suspended" && <span className="rounded-full bg-background-muted px-2 py-0.5 text-[11px] text-ink/60 dark:bg-white/5 dark:text-white/60">suspended</span>}
                    </div>
                    <p className="mt-1.5 truncate text-[13.5px] font-semibold text-ink dark:text-white">{s.name}</p>
                    <p className="mt-0.5 text-[12px] text-ink/55 dark:text-white/55">{describeEnd(s)}</p>
                    <p className="text-[12px] text-ink/45 dark:text-white/45">{money(s.agreedFee)}</p>
                  </div>
                  <ChevronDown size={16} className={`mt-1 shrink-0 text-ink/35 transition-transform dark:text-white/35 ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div className="mt-3 space-y-3.5 border-t border-black/5 pt-3 dark:border-white/10">
                    <div>
                      <span className={lbl}>Extend access</span>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy !== null} onClick={() => extend(s, { months: 1 }, "by 1 month")} className={small}>
                          +1 month
                        </button>
                        <button type="button" disabled={busy !== null} onClick={() => extend(s, { days: 90 }, "by 1 term (90 days)")} className={small}>
                          +1 term (90 days)
                        </button>
                        {manualLock ? (
                          <button
                            type="button"
                            disabled={busy !== null || !canUnlock}
                            title={canUnlock ? "" : "The term has ended: set a new end date first"}
                            onClick={() => send(s.id, { subscriptionStatus: "active" }, `${s.name}: unlocked.`, `${s.id}:lock`)}
                            className={`${small} flex items-center gap-1.5`}
                          >
                            <Unlock size={12} /> Unlock
                          </button>
                        ) : (
                          <button type="button" disabled={busy !== null || s.locked} onClick={() => send(s.id, { subscriptionStatus: "expired" }, `${s.name}: locked.`, `${s.id}:lock`)} className={`${small} flex items-center gap-1.5`}>
                            <Lock size={12} /> Lock now
                          </button>
                        )}
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-ink/45 dark:text-white/45">
                        Extending counts from the current end date (or from today if it has passed). Access runs to the end of the chosen day.
                        {!canUnlock && manualLock && s.daysLeft !== null ? " This school's term has ended: extend it to unlock." : ""}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={lbl} htmlFor={`st-${s.id}`}>Status</label>
                        <select id={`st-${s.id}`} value={status} onChange={(e) => setStatus(e.target.value as Sub)} className={field}>
                          <option value="trial">Trial</option>
                          <option value="active">Active</option>
                          <option value="expired">Expired (locked)</option>
                        </select>
                      </div>
                      <div>
                        <label className={lbl} htmlFor={`end-${s.id}`}>Access until (end of day)</label>
                        <div className="flex gap-2">
                          <input id={`end-${s.id}`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
                          {endDate && (
                            <button type="button" onClick={() => setEndDate("")} className={small}>
                              No end
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className={lbl} htmlFor={`fee-${s.id}`}>Agreed fee per term {currencyOf(contact) ? `(${currencyOf(contact)})` : ""}</label>
                        <input id={`fee-${s.id}`} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={field} placeholder="e.g. 150000" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={lbl} htmlFor={`notes-${s.id}`}>Payment notes (bank transfer reference, etc.)</label>
                        <textarea id={`notes-${s.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} className={field} />
                        <p className="mt-1 text-[11.5px] text-ink/45 dark:text-white/45">Private to you: schools can never see the fee or these notes.</p>
                      </div>
                    </div>

                    <button type="button" disabled={busy !== null} onClick={() => save(s)} className="flex items-center gap-2 rounded-lg bg-crimson-600 px-4 py-2 text-[13px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
                      {busy === `${s.id}:save` && <Loader2 size={13} className="animate-spin" />} Save changes
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
