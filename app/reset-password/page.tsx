"use client";

/**
 * /reset-password — where an existing teacher lands after an admin uses
 * "Resend access" (see app/api/admin/people/resend-access/route.ts).
 *
 * Kept as its own page rather than merged with /set-password: same
 * mechanics, but a deliberately different message (this account already
 * exists) so someone doesn't wonder whether they're re-registering.
 *
 * Same token-not-consumed-until-submit design as /set-password — see the
 * comment there, and lib/accessTokens.ts, for why that's what actually
 * fixes the mail-scanner "invalid or expired" problem.
 */

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { School, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useSchoolProfile } from "@/lib/useSchoolProfile";

// Same reason as /set-password: useSearchParams() on a statically-rendered
// page needs a Suspense boundary or `npm run build` fails.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114]">
      <Loader2 size={20} className="animate-spin text-crimson-600" />
    </div>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const schoolCode = searchParams.get("school");
  const school = useSchoolProfile(schoolCode);
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't reset your password. Try again.");
      setDone(true);
      setTimeout(() => router.push(schoolCode ? `/s/${schoolCode}` : "/login"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset your password. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
        <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 shadow-card-hover text-center sm:p-8">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500 mx-auto">
            <AlertCircle size={20} />
          </div>
          <h1 className="font-display text-[15px] font-semibold text-ink dark:text-white">No reset link found</h1>
          <p className="mt-1 text-[12.5px] text-ink/50 dark:text-white/50">
            Open this page using the link from your password reset email, or ask your admin to resend it from Students &amp; Teachers.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
        <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 shadow-card-hover text-center sm:p-8">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500 mx-auto">
            <CheckCircle2 size={20} />
          </div>
          <h1 className="font-display text-[15px] font-semibold text-ink dark:text-white">Password reset</h1>
          <p className="mt-1 text-[12.5px] text-ink/50 dark:text-white/50">Taking you to the login page…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
      <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 shadow-card-hover sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          {school.logoUrl ? (
            <img src={school.logoUrl} alt="" className="mb-3 h-11 w-11 rounded-lg object-cover" />
          ) : (
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
              <School size={22} strokeWidth={2.25} />
            </div>
          )}
          <h1 className="font-display text-[17px] font-semibold text-ink dark:text-white">Reset your password</h1>
          <p className="mt-1 text-[12.5px] text-ink/50 dark:text-white/50">for your {school.name} account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">New password</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoFocus
                className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2.5 pr-10 text-[13.5px] outline-none focus:border-crimson-500"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 dark:text-white/40 hover:text-ink/60 dark:hover:text-white/60">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Confirm new password</span>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Type it again"
              className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2.5 text-[13.5px] outline-none focus:border-crimson-500"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2.5 text-[12.5px] text-crimson-700 dark:text-crimson-500">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-3 text-[13.5px] font-semibold text-on-crimson transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-70"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? "Resetting…" : "Reset password & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
