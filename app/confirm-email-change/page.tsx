"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Loader2, MailCheck, TriangleAlert } from "lucide-react";

interface Info {
  side: "old" | "new";
  status: "pending" | "completed" | "declined" | "cancelled" | "expired" | "failed";
  schoolName: string;
  fullName: string;
  oldEmail: string;
  newEmail: string;
  iApproved: boolean;
  otherApproved: boolean;
}

const DEAD: Record<string, string> = {
  completed: "This email change has already been completed.",
  declined: "This request was declined, so nothing changed.",
  cancelled: "This request was cancelled, so nothing changed.",
  expired: "This request has expired. If you still want to change the email, start again from your profile.",
  failed: "This request could not be completed, so nothing changed. Start again from your profile if you still want to change the email.",
};

/**
 * The page behind the link in an email-change email. Opening it only SHOWS the request; nothing is approved until a
 * button is pressed (so a mail scanner that opens the link can't approve or use it up).
 */
function Content() {
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "ready" | "busy" | "approved-waiting" | "completed" | "declined">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    fetch("/api/email-change/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as Info;
        setInfo(data);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const respond = async (decision: "approve" | "decline") => {
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/email-change/respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, decision }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setState(json.outcome === "completed" ? "completed" : json.outcome === "declined" ? "declined" : "approved-waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("ready");
    }
  };

  const card = "w-full max-w-md rounded-lg bg-white p-7 text-center shadow-card-hover dark:bg-[#1A1C20] sm:p-8";
  const icon = (node: React.ReactNode, tone = "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500") => (
    <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${tone}`}>{node}</div>
  );
  const heading = "font-display text-[18px] font-semibold text-ink dark:text-white";
  const body = "mt-3 text-[13.5px] leading-relaxed text-ink/65 dark:text-white/65";

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 px-4 font-sans dark:bg-[#101114]">
      <div className={card}>
        {state === "loading" && <Loader2 className="mx-auto animate-spin text-ink/40 dark:text-white/40" size={22} />}

        {state === "invalid" && (
          <>
            {icon(<TriangleAlert size={22} />)}
            <h1 className={heading}>This link isn't valid</h1>
            <p className={body}>It may have been mistyped or already replaced by a newer request. Nothing has been changed.</p>
          </>
        )}

        {info && info.status !== "pending" && state === "ready" && (
          <>
            {icon(<TriangleAlert size={22} />)}
            <h1 className={heading}>Nothing to do here</h1>
            <p className={body}>{DEAD[info.status]}</p>
          </>
        )}

        {info && info.status === "pending" && (state === "ready" || state === "busy") && (
          <>
            {icon(<MailCheck size={22} />)}
            <h1 className={heading}>{info.side === "old" ? "Approve this email change?" : "Confirm this is your email address"}</h1>
            <p className={body}>
              {info.side === "old"
                ? `A request was made to change the sign-in email for ${info.fullName}'s ${info.schoolName} account.`
                : `${info.fullName} asked to use this address as the sign-in email for their ${info.schoolName} account.`}
            </p>
            <div className="mt-4 space-y-1.5 rounded-md bg-background-muted p-3 text-left text-[13px] dark:bg-white/5">
              <p className="break-all text-ink dark:text-white"><span className="text-ink/50 dark:text-white/50">From: </span>{info.oldEmail}</p>
              <p className="break-all text-ink dark:text-white"><span className="text-ink/50 dark:text-white/50">To: </span>{info.newEmail}</p>
            </div>
            <p className="mt-3 text-[12px] text-ink/50 dark:text-white/50">
              {info.iApproved
                ? "You've already approved this. It will go through once the other address approves too."
                : "The change only happens when both addresses approve. Only approve it if you expected this."}
            </p>
            {error && <p className="mt-3 rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={state === "busy"} onClick={() => respond("decline")} className="flex-1 rounded-lg bg-background-muted py-2.5 text-[13.5px] font-medium text-ink/70 hover:text-crimson-600 disabled:opacity-60 dark:bg-white/5 dark:text-white/70">
                Decline
              </button>
              <button type="button" disabled={state === "busy" || info.iApproved} onClick={() => respond("approve")} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-crimson-600 py-2.5 text-[13.5px] font-medium text-on-crimson hover:bg-crimson-700 disabled:opacity-60">
                {state === "busy" && <Loader2 size={14} className="animate-spin" />} Approve
              </button>
            </div>
          </>
        )}

        {state === "approved-waiting" && (
          <>
            {icon(<Check size={22} />, "bg-success/10 text-success")}
            <h1 className={heading}>Approved</h1>
            <p className={body}>Thank you. The email will change as soon as the other address has approved too. You can close this page.</p>
          </>
        )}
        {state === "completed" && (
          <>
            {icon(<Check size={22} />, "bg-success/10 text-success")}
            <h1 className={heading}>Email changed</h1>
            <p className={body}>Both addresses approved, so the sign-in email has been changed. The account has been signed out everywhere; sign in again with the new address.</p>
          </>
        )}
        {state === "declined" && (
          <>
            {icon(<Check size={22} />, "bg-success/10 text-success")}
            <h1 className={heading}>Declined</h1>
            <p className={body}>The request was cancelled and nothing was changed.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}
