"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, Mail, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { roleHome } from "@/lib/roleHome";

interface Notice {
  locked: boolean;
  role: "super_admin" | "teacher" | "student" | "platform_owner" | null;
  schoolName?: string;
  endedOn?: string | null;
  contact?: { email: string | null; phone: string | null; message: string | null } | null;
}

/**
 * Shown to everyone at a school whose term has ended (or that the owner locked). Clean and calm: what happened, who to
 * contact, a way to sign out. Checks every minute and takes people back to their dashboard the moment access is restored.
 */
export default function RenewalPage() {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/billing/notice", { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error();
        const n = (await res.json()) as Notice;
        if (cancelled) return;
        if (!n.locked) {
          router.replace(n.role ? roleHome(n.role) : "/login");
          return;
        }
        setNotice(n);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [router]);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/login");
  };

  const staff = notice?.role === "super_admin" || notice?.role === "teacher";
  const contact = notice?.contact;

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 px-4 font-sans dark:bg-[#101114]">
      <div className="w-full max-w-md rounded-lg bg-white p-7 text-center shadow-card-hover dark:bg-[#1A1C20] sm:p-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
          <LockKeyhole size={22} />
        </div>
        <h1 className="font-display text-[18px] font-semibold text-ink dark:text-white">Access needs to be renewed</h1>

        {!notice ? (
          <p className="mt-3 text-[13px] text-ink/50 dark:text-white/50">{failed ? "Couldn't load this page. Please refresh." : "Loading…"}</p>
        ) : (
          <>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink/65 dark:text-white/65">
              {notice.endedOn ? `Access for ${notice.schoolName} ended on ${notice.endedOn}.` : `Access for ${notice.schoolName} is currently paused.`}{" "}
              {staff ? "To restore it, please contact the platform administrator." : "Please let your school administration know so it can be renewed."}
            </p>

            {staff && contact?.message && <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-ink/65 dark:text-white/65">{contact.message}</p>}

            {staff && (contact?.email || contact?.phone) && (
              <div className="mt-4 space-y-2 rounded-md bg-background-muted p-3 text-left text-[13px] dark:bg-white/5">
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-ink dark:text-white">
                    <Mail size={15} className="shrink-0 text-ink/50 dark:text-white/50" /> <span className="break-all">{contact.email}</span>
                  </a>
                )}
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-ink dark:text-white">
                    <Phone size={15} className="shrink-0 text-ink/50 dark:text-white/50" /> {contact.phone}
                  </a>
                )}
              </div>
            )}

            <p className="mt-4 text-[12px] text-ink/40 dark:text-white/40">Your data is safe and nothing has been deleted. This page updates by itself once access is restored.</p>
          </>
        )}

        <button type="button" onClick={signOut} className="mt-5 text-[12.5px] font-medium text-crimson-600 hover:underline">
          Sign out
        </button>
      </div>
    </div>
  );
}
