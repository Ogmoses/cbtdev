"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";

const FALLBACK = "We are making some improvements. Please check back shortly.";

/**
 * Public "under maintenance" screen. Everyone except the platform owner (and students
 * finishing an exam) lands here while maintenance mode is on. It re-checks every 20 seconds
 * and takes people back to the app by itself once maintenance is over.
 */
export default function MaintenancePage() {
  const router = useRouter();
  const [message, setMessage] = useState<string>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/platform/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const status = await res.json();
        if (cancelled) return;
        if (status.maintenance === false) {
          router.replace("/login");
          return;
        }
        if (typeof status.message === "string" && status.message) setMessage(status.message);
      } catch {
        // Offline or a blip: keep showing the screen and try again next round.
      }
    };
    check();
    const timer = setInterval(check, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 px-4 font-sans dark:bg-[#101114]">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 text-center shadow-card-hover dark:bg-[#1A1C20]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
          <Wrench size={22} />
        </div>
        <h1 className="font-display text-[18px] font-semibold text-ink dark:text-white">We'll be right back</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink/60 dark:text-white/60">{message}</p>
        <p className="mt-5 text-[12px] text-ink/40 dark:text-white/40">This page refreshes by itself. If you were taking an exam, your answers that were already saved are safe.</p>
      </div>
    </div>
  );
}
