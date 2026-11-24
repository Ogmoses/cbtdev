"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { School, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Where a new school admin lands from the confirmation email. Opening the
 * page does nothing; only tapping the button confirms (so a mail scanner
 * that opens the link can't use it up).
 */
export default function VerifySchoolPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  const token = useSearchParams().get("token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ schoolName: string | null } | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/schools/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't confirm your email.");
      setDone({ schoolName: data.schoolName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't confirm your email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
      <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 text-center shadow-card-hover sm:p-8">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
          {done ? <CheckCircle2 size={22} /> : <School size={22} strokeWidth={2.25} />}
        </div>

        {!token ? (
          <>
            <h1 className="font-display text-[16px] font-semibold text-ink dark:text-white">Link incomplete</h1>
            <p className="mt-2 text-[13px] text-ink/60 dark:text-white/60">Open the link from your confirmation email again.</p>
          </>
        ) : done ? (
          <>
            <h1 className="font-display text-[16px] font-semibold text-ink dark:text-white">Email confirmed</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink/60 dark:text-white/60">
              {done.schoolName ? <strong className="text-ink dark:text-white">{done.schoolName}</strong> : "Your school"} is now waiting for approval. We'll email you your school's link as soon as it's approved.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-[16px] font-semibold text-ink dark:text-white">Confirm your email</h1>
            <p className="mt-2 text-[13px] text-ink/60 dark:text-white/60">One tap and your school request goes in for review.</p>
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-crimson-50 px-3 py-2.5 text-left text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-3 text-[13.5px] font-semibold text-on-crimson hover:bg-crimson-700 disabled:opacity-60"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? "Confirming…" : "Confirm my email"}
            </button>
          </>
        )}

        <Link href="/login" className="mt-4 block text-[12.5px] text-ink/50 hover:text-crimson-600 dark:text-white/50">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
