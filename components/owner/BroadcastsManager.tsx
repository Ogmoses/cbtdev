"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Info, Loader2, Megaphone, Pencil } from "lucide-react";

type Severity = "info" | "warning" | "critical";
type Audience = "all_staff" | "admins" | "teachers";

interface School {
  id: string;
  name: string;
  status: string;
}
interface Broadcast {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  audience: Audience;
  allSchools: boolean;
  schoolNames: string[];
  schoolIds: string[];
  startsAt: string;
  endsAt: string | null;
  status: "scheduled" | "live" | "ended";
  dismissed: number;
}

const AUDIENCE_LABEL: Record<Audience, string> = { all_staff: "Admins & teachers", admins: "School admins only", teachers: "Teachers only" };
const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", warning: "Important", critical: "Urgent" };
const PREVIEW: Record<Severity, string> = {
  info: "bg-background-muted text-ink dark:bg-white/5 dark:text-white",
  warning: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  critical: "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500",
};

const field =
  "w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white";

/** An ISO time as the "YYYY-MM-DDTHH:mm" text a datetime-local box wants, in the owner's own time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BroadcastsManager() {
  const [items, setItems] = useState<Broadcast[] | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [endingId, setEndingId] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<Severity>("info");
  const [audience, setAudience] = useState<Audience>("all_staff");
  const [allSchools, setAllSchools] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [startLater, setStartLater] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  // What the composer is doing: sending a new one, editing one (editingId), or sending a copy of an old one (reusedFrom).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStarted, setEditingStarted] = useState(false); // already live: its start time can't change
  const [reshow, setReshow] = useState(false);
  const [reusedFrom, setReusedFrom] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/broadcasts", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setItems(json.broadcasts as Broadcast[]);
      setSchools(json.schools as School[]);
    } catch {
      setError("Couldn't load broadcasts. Try again.");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePicked = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const clearComposer = () => {
    setTitle("");
    setBody("");
    setSeverity("info");
    setAudience("all_staff");
    setAllSchools(true);
    setPicked([]);
    setStartLater(false);
    setStartsAt("");
    setEndsAt("");
    setEditingId(null);
    setEditingStarted(false);
    setReshow(false);
    setReusedFrom(null);
  };

  const fill = (b: Broadcast) => {
    setTitle(b.title);
    setBody(b.body);
    setSeverity(b.severity);
    setAudience(b.audience);
    setAllSchools(b.allSchools);
    setPicked(b.allSchools ? [] : b.schoolIds.filter((id) => schools.some((s) => s.id === id)));
  };

  const scrollToComposer = () => setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);

  const startEdit = (b: Broadcast) => {
    clearComposer();
    fill(b);
    setEditingId(b.id);
    const started = new Date(b.startsAt).getTime() <= Date.now();
    setEditingStarted(started);
    setStartLater(!started);
    setStartsAt(started ? "" : toLocalInput(b.startsAt));
    setEndsAt(toLocalInput(b.endsAt));
    setError(null);
    setNotice(null);
    scrollToComposer();
  };

  const startReuse = (b: Broadcast) => {
    clearComposer();
    fill(b); // the schedule is NOT copied: a reused broadcast starts fresh (now, no end) unless you set one
    setReusedFrom(b.id);
    setError(null);
    setNotice(null);
    scrollToComposer();
  };

  const send = async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        title,
        body,
        severity,
        audience,
        allSchools,
        schoolIds: allSchools ? [] : picked,
        startsAt: (!editingStarted && startLater && startsAt) ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      };
      const res = editingId
        ? await fetch("/api/owner/broadcasts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, id: editingId, action: "edit", reshow }) })
        : await fetch("/api/owner/broadcasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, reusedFrom: reusedFrom ?? undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't send the broadcast.");
      setNotice(
        editingId
          ? json.changed === false
            ? "Nothing was different, so nothing changed."
            : "Changes saved. They appear for staff within a minute."
          : startLater && startsAt
            ? "Broadcast scheduled."
            : "Broadcast sent. It will appear within a minute."
      );
      clearComposer();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the broadcast.");
    } finally {
      setSending(false);
    }
  };

  const end = async (id: string) => {
    setEndingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/owner/broadcasts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "end" }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't end the broadcast.");
      if (editingId === id) clearComposer();
      setNotice("Broadcast ended.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't end the broadcast.");
    } finally {
      setEndingId(null);
    }
  };

  const canSend = title.trim() && body.trim() && (allSchools || picked.length > 0) && (editingStarted || !startLater || startsAt) && !sending;
  const card = "rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]";
  const label = "mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60";
  const smallBtn = "flex items-center justify-center gap-1.5 rounded-md bg-background-muted px-3 py-1.5 text-[12px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/70";

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink/55 dark:text-white/55">
        Send a notice to school admins and teachers. It shows as a banner at the top of their pages until they close it. Students never see broadcasts.
      </p>

      {notice && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-[12.5px] text-ink dark:text-white">
          <Check size={15} className="text-success" /> {notice}
        </p>
      )}
      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      <div ref={composerRef} className={card}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">
            {editingId ? <Pencil size={16} /> : reusedFrom ? <Copy size={16} /> : <Megaphone size={16} />}
            {editingId ? "Edit broadcast" : reusedFrom ? "Send again (copy of an earlier broadcast)" : "New broadcast"}
          </p>
          {(editingId || reusedFrom) && (
            <button type="button" onClick={clearComposer} className="text-[12px] font-medium text-ink/50 hover:text-crimson-600 dark:text-white/50">
              {editingId ? "Cancel editing" : "Start blank"}
            </button>
          )}
        </div>

        {reusedFrom && <p className="mb-3 rounded-md bg-background-muted p-2.5 text-[12px] text-ink/65 dark:bg-white/5 dark:text-white/65">Loaded from an earlier broadcast. Change anything you like, then send. It starts now unless you schedule it.</p>}

        <div className="space-y-3.5">
          <div>
            <label className={label} htmlFor="bc-title">Title</label>
            <input id="bc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} placeholder="e.g. Scheduled downtime on Saturday" />
          </div>
          <div>
            <label className={label} htmlFor="bc-body">Message</label>
            <textarea id="bc-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4} className={field} />
            <p className="mt-1 text-right text-[11px] text-ink/40 dark:text-white/40">{body.length}/1000</p>
          </div>

          <div>
            <span className={label}>Importance</span>
            <div className="flex gap-2">
              {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex-1 rounded-md px-3 py-2 text-[12.5px] font-medium ${
                    severity === s ? "bg-crimson-600 text-on-crimson" : "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70"
                  }`}
                >
                  {SEVERITY_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="bc-audience">Who it's for</label>
            <select id="bc-audience" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={field}>
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
                <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>
              ))}
            </select>
          </div>

          <div>
            <span className={label}>Which schools</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAllSchools(true)} className={`flex-1 rounded-md px-3 py-2 text-[12.5px] font-medium ${allSchools ? "bg-crimson-600 text-on-crimson" : "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70"}`}>
                All schools
              </button>
              <button type="button" onClick={() => setAllSchools(false)} className={`flex-1 rounded-md px-3 py-2 text-[12.5px] font-medium ${!allSchools ? "bg-crimson-600 text-on-crimson" : "bg-background-muted text-ink/70 dark:bg-white/5 dark:text-white/70"}`}>
                Specific schools
              </button>
            </div>
            {!allSchools && (
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-black/10 p-2 dark:border-white/15">
                {schools.length === 0 && <p className="p-2 text-[12.5px] text-ink/45 dark:text-white/45">No schools yet.</p>}
                {schools.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] text-ink dark:text-white">
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={() => togglePicked(s.id)} />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {s.status !== "active" && <span className="text-[11px] text-ink/40 dark:text-white/40">{s.status}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              {editingStarted ? (
                <p className="rounded-md bg-background-muted p-2.5 text-[12px] text-ink/60 dark:bg-white/5 dark:text-white/60">This broadcast is already live, so its start time can't change.</p>
              ) : (
                <>
                  <label className="mb-1 flex items-center gap-2 text-[12px] font-medium text-ink/60 dark:text-white/60">
                    <input type="checkbox" checked={startLater} onChange={(e) => setStartLater(e.target.checked)} /> Schedule for later
                  </label>
                  <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={!startLater} className={`${field} disabled:opacity-40`} aria-label="Start time" />
                </>
              )}
            </div>
            <div>
              <label className={label} htmlFor="bc-end">Stop showing automatically (optional)</label>
              <input id="bc-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={field} />
            </div>
          </div>

          {editingId && (
            <label className="flex items-start gap-2 rounded-md bg-background-muted p-2.5 text-[12.5px] text-ink/70 dark:bg-white/5 dark:text-white/70">
              <input type="checkbox" checked={reshow} onChange={(e) => setReshow(e.target.checked)} className="mt-0.5" />
              <span>Show again to people who already closed it (use this for an important change, not a typo fix)</span>
            </label>
          )}

          {(title.trim() || body.trim()) && (
            <div>
              <span className={label}>Preview</span>
              <div className={`flex items-start gap-3 rounded-lg p-3.5 ${PREVIEW[severity]}`}>
                {severity === "info" ? <Info size={17} className="mt-0.5 shrink-0" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold">{title || "Title"}</p>
                  <p className="mt-0.5 whitespace-pre-line break-words text-[12.5px] opacity-90">{body || "Message"}</p>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-2.5 text-[13.5px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-50"
          >
            {sending && <Loader2 size={14} className="animate-spin" />} {editingId ? "Save changes" : startLater && !editingStarted ? "Schedule broadcast" : "Send broadcast"}
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">Past &amp; current broadcasts</p>
        {!items ? (
          <div className="flex items-center justify-center py-12 text-ink/40 dark:text-white/40">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink/45 dark:text-white/45">No broadcasts yet.</p>
        ) : (
          <div className="space-y-2">
            {items.map((b) => (
              <div key={b.id} className={`${card} ${editingId === b.id ? "ring-2 ring-crimson-500" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          b.status === "live" ? "bg-success/10 text-success" : b.status === "scheduled" ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "bg-background-muted text-ink/60 dark:bg-white/5 dark:text-white/60"
                        }`}
                      >
                        {b.status === "live" ? "Live" : b.status === "scheduled" ? "Scheduled" : "Ended"}
                      </span>
                      <span className="text-[11.5px] text-ink/45 dark:text-white/45">{SEVERITY_LABEL[b.severity]} · {AUDIENCE_LABEL[b.audience]}</span>
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-semibold text-ink dark:text-white">{b.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink/60 dark:text-white/60">{b.body}</p>
                    <p className="mt-1.5 text-[11.5px] text-ink/45 dark:text-white/45">
                      {b.allSchools ? "All schools" : b.schoolNames.join(", ") || "No schools"} · from {new Date(b.startsAt).toLocaleString()}
                      {b.endsAt ? ` · until ${new Date(b.endsAt).toLocaleString()}` : ""} · closed by {b.dismissed}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    {b.status !== "ended" && (
                      <button type="button" onClick={() => startEdit(b)} className={smallBtn}>
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                    <button type="button" onClick={() => startReuse(b)} className={smallBtn}>
                      <Copy size={12} /> Reuse
                    </button>
                    {b.status !== "ended" && (
                      <button type="button" disabled={endingId === b.id} onClick={() => end(b.id)} className={smallBtn}>
                        {endingId === b.id ? "Ending…" : b.status === "scheduled" ? "Cancel" : "End now"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
