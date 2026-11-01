"use client";

/**
 * /register — where an invited teacher (or admin) lands after clicking
 * the link in their invite/reset email, OR manually entering the code
 * from that same email if the link didn't work.
 *
 * Two real bugs, both fixed here:
 *
 * 1. RACE CONDITION (fixed previously): the invite/recovery token lives
 *    in the URL's hash fragment, which Supabase's browser client parses
 *    *asynchronously*. An immediate getUser() call can race that and
 *    resolve using whatever session already existed in cookies instead —
 *    e.g. an admin still logged in on the same device. Fixed by never
 *    trusting an ambient session: no token in the URL → never show
 *    whoever's already logged in; token present → wait specifically for
 *    the SIGNED_IN/PASSWORD_RECOVERY event that fires once *that* token
 *    is processed, not a raw getUser() race.
 *
 * 2. LINK PREFETCHING (fixed here): mail security scanners (Microsoft
 *    Safe Links and similar, common in schools/enterprises, but this can
 *    also happen with Gmail) "click" links in emails automatically to
 *    scan them for safety — which consumes Supabase's one-time token
 *    before the real user ever gets to it, so the link shows "invalid or
 *    expired" on the very first genuine click. This is a known category
 *    of issue; Supabase's own docs recommend not relying solely on the
 *    clickable link. Fixed by adding a manual fallback: if the link
 *    didn't work, enter the email + the code from the same email and
 *    verify that directly via verifyOtp — a scanner can't "click" a code
 *    sitting in email body text.
 *
 *    REQUIRES a one-time dashboard change this code can't make itself:
 *    Supabase → Authentication → Email Templates → both "Invite user"
 *    and "Reset Password" need `{{ .Token }}` added to the email body
 *    (not just the default {{ .ConfirmationURL }} button), or there's no
 *    code for someone to type here.
 *
 * 3. STALE LISTENER (fixed here): the onAuthStateChange listener below
 *    stayed subscribed for the rest of this page's life, even after we'd
 *    already given up on it and shown the fallback screen. If a
 *    DIFFERENT, already-logged-in session on the same device (e.g. an
 *    admin who'd been testing from this browser earlier) later fired a
 *    SIGNED_IN event — reliably reproduced by backgrounding the tab and
 *    returning, which re-triggers Supabase's own session check — this
 *    page would silently accept it as if it were the original token
 *    resolving, and jump straight to "set a password" for THAT
 *    unrelated account. Fixed by unsubscribing the instant we either
 *    resolve or give up, so nothing can flip the stage after that.
 *
 * 4. WRONG DEFAULT ON THE FALLBACK FORM (fixed here): the New account /
 *    Password reset toggle always defaulted to "New account" regardless
 *    of which email actually got sent, with nothing on the page hinting
 *    that it needed checking. verifyOtp() validates a code against
 *    whichever type you pass it — an invite-issued code doesn't verify
 *    as a recovery code or vice versa — so a prefetched *recovery* link
 *    would land here still needing a manual switch before its own code
 *    would work. Fixed by reading the type off the same URL hash this
 *    page already inspects, and pre-selecting the matching tab.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Waves, Eye, EyeOff, Loader2, AlertCircle, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { roleHome } from "@/lib/roleHome";
import { useSchoolProfile, schoolSlug } from "@/lib/useSchoolProfile";

type Stage = "checking" | "needs-fallback" | "ready";

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();
  const school = useSchoolProfile();

  const [stage, setStage] = useState<Stage>("checking");
  const [email, setEmail] = useState<string | null>(null);

  // Fallback: manual code entry
  const [fallbackType, setFallbackType] = useState<"invite" | "recovery">("invite");
  const [fallbackEmail, setFallbackEmail] = useState("");
  const [fallbackCode, setFallbackCode] = useState("");
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackSubmitting, setFallbackSubmitting] = useState(false);

  // Password form
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hasToken = /access_token|type=recovery|type=invite/.test(hash);

    if (!hasToken) {
      // No token in this URL at all — offer the code-entry fallback
      // straight away rather than a dead-end error.
      setStage("needs-fallback");
      return;
    }

    // Whichever flow this link was actually for, default the fallback
    // form to match it, so someone whose link got prefetched doesn't
    // also have to notice and flip a toggle nothing on the page calls
    // out.
    if (hash.includes("type=recovery")) setFallbackType("recovery");

    let resolved = false;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") && !resolved) {
        resolved = true;
        listener.subscription.unsubscribe();
        setEmail(session?.user?.email ?? null);
        setStage("ready");
      }
    });

    // Token was present but never resolved to a session (expired, or —
    // most likely — already consumed by a mail scanner before this
    // click). Give up and offer the fallback — but critically, stop
    // listening once we do. Leaving the subscription alive after this
    // point is what let a later, unrelated auth event hijack the page.
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        listener.subscription.unsubscribe();
        setStage("needs-fallback");
      }
    }, 6000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFallbackVerify = async (e: FormEvent) => {
    e.preventDefault();
    setFallbackError(null);
    if (!fallbackEmail.trim() || !fallbackCode.trim()) {
      setFallbackError("Enter both your email and the code from the email.");
      return;
    }
    setFallbackSubmitting(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: fallbackEmail.trim(),
        token: fallbackCode.trim(),
        type: fallbackType,
      });
      if (verifyError || !data.session) throw new Error(verifyError?.message ?? "That code didn't work.");
      setEmail(data.session.user.email ?? fallbackEmail.trim());
      setStage("ready");
    } catch (err) {
      setFallbackError(err instanceof Error ? err.message : "That code didn't work. Check it and try again.");
    } finally {
      setFallbackSubmitting(false);
    }
  };

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
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      const { data: auth } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("users").select("role").eq("id", auth.user!.id).single();
      router.push(roleHome(profile?.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't set your password. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (stage === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114]">
        <Loader2 size={20} className="animate-spin text-crimson-600" />
      </div>
    );
  }

  if (stage === "needs-fallback") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
        <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 shadow-card-hover sm:p-8">
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-50 text-crimson-700">
              <AlertCircle size={20} />
            </div>
            <h1 className="font-display text-[15px] font-semibold text-ink dark:text-white">That link didn't work</h1>
            <p className="mt-1 text-[12.5px] text-ink/50 dark:text-white/50">
              Often just means your email provider scanned it first. Enter the code from the same email instead.
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 rounded-lg bg-background-muted dark:bg-white/5 p-1">
            {(["invite", "recovery"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFallbackType(t)}
                className={`rounded-md py-2 text-[12px] font-semibold transition-colors duration-200 ${
                  fallbackType === t ? "bg-white text-crimson-700 shadow-card" : "text-ink/50"
                }`}
              >
                {t === "invite" ? "New account" : "Password reset"}
              </button>
            ))}
          </div>

          <form onSubmit={handleFallbackVerify} className="space-y-3.5">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Email</span>
              <input
                type="email"
                value={fallbackEmail}
                onChange={(e) => setFallbackEmail(e.target.value)}
                placeholder={`you@${schoolSlug(school.name)}.edu`}
                autoFocus
                className="w-full rounded-lg border border-black/10 dark:border-white/20 px-3.5 py-2.5 text-[13.5px] outline-none focus:border-crimson-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Code from the email</span>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/35 dark:text-white/35" />
                <input
                  value={fallbackCode}
                  onChange={(e) => setFallbackCode(e.target.value)}
                  placeholder="e.g. 123456"
                  className="w-full rounded-lg border border-black/10 dark:border-white/20 py-2.5 pl-9 pr-3 text-[13.5px] outline-none focus:border-crimson-500"
                />
              </div>
            </label>

            {fallbackError && (
              <div className="flex items-start gap-2 rounded-md bg-crimson-50 px-3 py-2.5 text-[12.5px] text-crimson-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {fallbackError}
              </div>
            )}

            <button
              type="submit"
              disabled={fallbackSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-3 text-[13.5px] font-semibold text-white transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-70"
            >
              {fallbackSubmitting && <Loader2 size={15} className="animate-spin" />}
              {fallbackSubmitting ? "Checking…" : "Continue"}
            </button>
          </form>

          <p className="mt-4 text-center text-[11.5px] text-ink/45 dark:text-white/45">
            No code in that email either? Ask your admin to resend it from Students &amp; Teachers.
          </p>
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
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-600 text-white">
              <Waves size={22} strokeWidth={2.25} />
            </div>
          )}
          <h1 className="font-display text-[17px] font-semibold text-ink dark:text-white">Welcome to {school.name}</h1>
          <p className="mt-1 text-[12.5px] text-ink/50 dark:text-white/50">Set a password for {email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Password</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoFocus
                className="w-full rounded-lg border border-black/10 dark:border-white/20 px-3.5 py-2.5 pr-10 text-[13.5px] outline-none focus:border-crimson-500"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 dark:text-white/40 hover:text-ink/60 dark:hover:text-white/60">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Confirm password</span>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Type it again"
              className="w-full rounded-lg border border-black/10 dark:border-white/20 px-3.5 py-2.5 text-[13.5px] outline-none focus:border-crimson-500"
            />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-crimson-50 px-3 py-2.5 text-[12.5px] text-crimson-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-3 text-[13.5px] font-semibold text-white transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-70"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? "Setting password…" : "Set password & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
