"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Power, UserPlus, Check } from "lucide-react";
import ConfirmTypeModal from "./ConfirmTypeModal";

interface Flags {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  signupsOpen: boolean;
  updatedAt: string | null;
}

async function patchFlags(body: Record<string, unknown>): Promise<Flags> {
  const res = await fetch("/api/owner/flags", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Couldn't save. Nothing was changed.");
  return json.flags as Flags;
}

export default function PlatformControls() {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmOn, setConfirmOn] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/flags", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const f = (await res.json()).flags as Flags;
      setFlags(f);
      setMessage(f.maintenanceMessage);
      setError(null);
    } catch {
      setError("Couldn't load the controls. Try again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (name: string, body: Record<string, unknown>, done: string) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const f = await patchFlags(body);
      setFlags(f);
      setMessage(f.maintenanceMessage);
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  };

  if (!flags) {
    return (
      <div className="flex items-center justify-center py-20 text-ink/40 dark:text-white/40">
        {error ? <p className="text-[13px]">{error}</p> : <Loader2 className="animate-spin" size={20} />}
      </div>
    );
  }

  const card = "rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]";
  const pill = (on: boolean, onText: string, offText: string, onBad: boolean) =>
    `shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
      on === onBad ? "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500" : "bg-success/10 text-success"
    }`;

  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink/55 dark:text-white/55">
        Emergency switches for the whole platform. Every change is recorded in the audit log, and takes effect within a few seconds.
      </p>

      {notice && (
        <p className="flex items-center gap-2 rounded-lg bg-success/10 p-3 text-[12.5px] text-ink dark:text-white">
          <Check size={15} className="text-success" /> {notice}
        </p>
      )}
      {error && <p className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}

      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">
              <Power size={16} /> Maintenance mode
            </p>
            <p className="mt-1 text-[12.5px] text-ink/55 dark:text-white/55">
              Shows everyone a friendly “under maintenance” screen. You (the owner) keep full access. Students already taking an exam can finish it; they are only stopped afterwards.
            </p>
          </div>
          <span className={pill(flags.maintenanceMode, "ON", "Off", true)}>{flags.maintenanceMode ? "ON" : "Off"}</span>
        </div>

        <label className="mt-4 block text-[12px] font-medium text-ink/60 dark:text-white/60" htmlFor="maint-msg">
          Message people will see
        </label>
        <textarea
          id="maint-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          rows={3}
          className="mt-1 w-full rounded-lg border border-black/10 px-3.5 py-2.5 text-[13.5px] text-ink outline-none focus:border-crimson-500 dark:border-white/15 dark:bg-white/5 dark:text-white"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || message.trim() === flags.maintenanceMessage || !message.trim()}
            onClick={() => run("msg", { maintenanceMessage: message }, "Message saved.")}
            className="rounded-md bg-background-muted px-3.5 py-2 text-[12.5px] font-medium text-ink/70 disabled:opacity-50 dark:bg-white/5 dark:text-white/70"
          >
            {busy === "msg" ? "Saving…" : "Save message"}
          </button>
          {flags.maintenanceMode ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("maint", { maintenanceMode: false }, "Maintenance mode is off. The platform is open again.")}
              className="flex items-center gap-1.5 rounded-md bg-crimson-600 px-3.5 py-2 text-[12.5px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60"
            >
              {busy === "maint" && <Loader2 size={13} className="animate-spin" />} Turn maintenance off
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmOn(true)}
              className="rounded-md bg-crimson-600 px-3.5 py-2 text-[12.5px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60"
            >
              Turn maintenance on…
            </button>
          )}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">
              <UserPlus size={16} /> New school sign-ups
            </p>
            <p className="mt-1 text-[12.5px] text-ink/55 dark:text-white/55">
              When paused, the “Register your school” page shows a closed message and the sign-up is refused on the server too. Schools you add yourself, and existing schools, are not affected.
            </p>
          </div>
          <span className={pill(flags.signupsOpen, "Open", "Paused", false)}>{flags.signupsOpen ? "Open" : "Paused"}</span>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run("signups", { signupsOpen: !flags.signupsOpen }, flags.signupsOpen ? "New school sign-ups are paused." : "New school sign-ups are open again.")
          }
          className="mt-4 flex items-center gap-1.5 rounded-md bg-background-muted px-3.5 py-2 text-[12.5px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/70"
        >
          {busy === "signups" && <Loader2 size={13} className="animate-spin" />}
          {flags.signupsOpen ? "Pause sign-ups" : "Open sign-ups"}
        </button>
      </div>

      {confirmOn && (
        <ConfirmTypeModal
          title="Turn on maintenance mode?"
          confirmWord="maintenance"
          confirmLabel="Turn on"
          onClose={() => setConfirmOn(false)}
          onConfirm={async () => {
            const f = await patchFlags({ maintenanceMode: true });
            setFlags(f);
            setMessage(f.maintenanceMessage);
            setNotice("Maintenance mode is ON. Only you, and students finishing an exam, can use the platform.");
            setConfirmOn(false);
          }}
        >
          <p>
            Everyone except you will see the maintenance screen within a few seconds, including teachers and school admins. Students who are in the middle of an exam can finish it; their next page after that is the maintenance screen.
          </p>
          <p className="text-[12.5px]">Remember to turn it off when you're done.</p>
        </ConfirmTypeModal>
      )}
    </div>
  );
}
