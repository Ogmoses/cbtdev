"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Waves, Eye, EyeOff, Loader2, AlertCircle, MailCheck } from "lucide-react";

/** "Bright Future Academy" -> "bright-future-academy" */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}

/** Public: a school asks to join. It stays pending until the platform owner approves it. */
export default function RegisterSchoolPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const widgetRef = useRef<HTMLDivElement>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [website, setWebsite] = useState(""); // honeypot: real people never see or fill this
  const [schoolName, setSchoolName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ emailSent: boolean } | null>(null);
  const [resent, setResent] = useState(false);

  // Cloudflare Turnstile — only shown if the site key is configured; otherwise the page is exactly as before.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const render = () => {
      if (w.turnstile && widgetRef.current && !widgetRef.current.hasChildNodes()) {
        w.turnstile.render(widgetRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(null),
          "error-callback": () => setTurnstileToken(null),
        });
      }
    };
    if (w.turnstile) {
      render();
      return;
    }
    const existing = document.querySelector("script[data-turnstile]");
    if (existing) {
      existing.addEventListener("load", render);
      return () => existing.removeEventListener("load", render);
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    script.onload = render;
    document.head.appendChild(script);
  }, [turnstileSiteKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/schools/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolName, code, adminName, adminEmail, password, website, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't register your school. Try again.");
      setDone({ emailSent: data.emailSent });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't register your school. Try again.");
      // A check can only be used once — ask for a fresh one before the next try.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (turnstileSiteKey && w.turnstile) {
        w.turnstile.reset();
        setTurnstileToken(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    await fetch("/api/schools/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail }),
    });
    setResent(true);
  };

  const input = "w-full rounded-lg border border-black/10 dark:border-white/15 dark:bg-white/5 dark:text-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-crimson-500";
  const label = "mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60";

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
        <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 text-center shadow-card-hover sm:p-8">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
            <MailCheck size={20} />
          </div>
          <h1 className="font-display text-[16px] font-semibold text-ink dark:text-white">Check your email</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink/60 dark:text-white/60">
            {done.emailSent ? (
              <>We sent a confirmation link to <strong className="text-ink dark:text-white">{adminEmail}</strong>. Confirm it, and we'll review your school. You'll get an email with your school's link once it's approved.</>
            ) : (
              <>Your request was received, but we couldn't send the confirmation email just now. Tap below to try again.</>
            )}
          </p>
          <button
            type="button"
            onClick={resend}
            disabled={resent}
            className="mt-4 w-full rounded-lg bg-background-muted py-2.5 text-[13px] font-medium text-ink disabled:opacity-60 dark:bg-white/5 dark:text-white"
          >
            {resent ? "If that address is waiting, a new email is on its way" : "Resend the email"}
          </button>
          <Link href="/login" className="mt-3 block text-[12.5px] text-ink/50 hover:text-crimson-600 dark:text-white/50">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 py-8 font-sans">
      <div className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 shadow-card-hover sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
            <Waves size={22} strokeWidth={2.25} />
          </div>
          <h1 className="font-display text-[17px] font-semibold text-ink dark:text-white">Register your school</h1>
          <p className="mt-1 text-[12.5px] text-ink/50 dark:text-white/50">Takes a minute. We review every request before it goes live.</p>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          <label className="block">
            <span className={label}>School name</span>
            <input
              className={input}
              value={schoolName}
              onChange={(e) => {
                setSchoolName(e.target.value);
                if (!codeEdited) setCode(slugify(e.target.value));
              }}
              placeholder="Bright Future Academy"
              autoFocus
            />
          </label>
          <label className="block">
            <span className={label}>Your school's link name</span>
            <input
              className={input}
              value={code}
              onChange={(e) => {
                setCodeEdited(true);
                setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              placeholder="bright-future-academy"
            />
            <span className="mt-1 block text-[11.5px] text-ink/45 dark:text-white/45">Your link will be …/s/{code || "your-school"}</span>
          </label>
          <label className="block">
            <span className={label}>Your name</span>
            <input className={input} value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Mrs. Ada Okafor" />
          </label>
          <label className="block">
            <span className={label}>Your email</span>
            <input className={input} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="you@yourschool.com" />
          </label>
          <label className="block">
            <span className={label}>Password</span>
            <div className="relative">
              <input className={`${input} pr-10`} type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink/60 dark:text-white/40">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {/* Bot trap: invisible and unreachable for people, tempting for bots that fill in every field. */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
            <label>
              Website
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>

          {turnstileSiteKey && <div ref={widgetRef} className="flex justify-center" />}

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-crimson-50 px-3 py-2.5 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !schoolName.trim() || !adminName.trim() || !adminEmail.trim() || password.length < 8 || (Boolean(turnstileSiteKey) && !turnstileToken)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-3 text-[13.5px] font-semibold text-on-crimson transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-60"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? "Sending…" : "Register school"}
          </button>
        </form>

        <Link href="/login" className="mt-4 block text-center text-[12.5px] text-ink/50 hover:text-crimson-600 dark:text-white/50">
          Already registered? Sign in
        </Link>
      </div>
    </div>
  );
}
