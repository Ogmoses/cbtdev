"use client";

/**
 * PageLoading — replaces the `if (loading) return null;` that was
 * scattered across every dashboard page, which just showed a blank white
 * flash between navigation and content. Same crimson/cream branding as
 * the rest of the app, so a loading moment still looks intentional.
 */

import { School } from "lucide-react";

export default function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
        <School size={18} strokeWidth={2.25} className="animate-pulse" />
      </div>
      <p className="text-[13px] text-ink/40 dark:text-white/40">{label}</p>
    </div>
  );
}
