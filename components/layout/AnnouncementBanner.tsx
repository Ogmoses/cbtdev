"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Notice {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
}

const MAX_SHOWN = 3;
const REFRESH_MS = 60_000;

const STYLES: Record<Notice["severity"], string> = {
  info: "bg-background-muted text-ink dark:bg-white/5 dark:text-white",
  warning: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  critical: "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500",
};

/**
 * Owner broadcasts for school admins and teachers. Which ones appear is decided by the database
 * (role, school, dates), not here: students and the owner never get any, and we don't even ask for them.
 * Closing one is remembered per person, across devices.
 */
export default function AnnouncementBanner({ role }: { role: string }) {
  const supabase = useMemo(() => createClient(), []);
  const eligible = role === "super_admin" || role === "teacher";
  const [notices, setNotices] = useState<Notice[]>([]);

  const load = useCallback(async () => {
    try {
      const [{ data: live }, { data: closed }] = await Promise.all([
        supabase.from("announcements").select("id, title, body, severity").order("created_at", { ascending: false }).limit(10),
        supabase.from("announcement_dismissals").select("announcement_id"),
      ]);
      const gone = new Set((closed ?? []).map((d) => d.announcement_id as string));
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      const open = ((live ?? []) as Notice[]).filter((n) => !gone.has(n.id));
      open.sort((a, b) => rank[a.severity] - rank[b.severity]); // stable: newest first within a level
      setNotices(open);
    } catch {
      // Banners are a nice-to-have: never get in the way of the page.
    }
  }, [supabase]);

  useEffect(() => {
    if (!eligible) return;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [eligible, load]);

  const dismiss = async (id: string) => {
    const before = notices;
    setNotices((list) => list.filter((n) => n.id !== id));
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("no user");
      const { error } = await supabase.from("announcement_dismissals").insert({ announcement_id: id, user_id: data.user.id });
      if (error && error.code !== "23505") throw error; // 23505 = already closed on another device: fine
    } catch {
      setNotices(before); // couldn't save it, so don't pretend it's gone
    }
  };

  if (!eligible || notices.length === 0) return null;
  const shown = notices.slice(0, MAX_SHOWN);

  return (
    <div className="mb-5 space-y-2" role="region" aria-label="Announcements">
      {shown.map((n) => (
        <div key={n.id} className={`flex items-start gap-3 rounded-lg p-3.5 ${STYLES[n.severity]}`}>
          {n.severity === "info" ? <Info size={17} className="mt-0.5 shrink-0" /> : <AlertTriangle size={17} className="mt-0.5 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">{n.title}</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-[12.5px] opacity-90">{n.body}</p>
          </div>
          <button type="button" onClick={() => dismiss(n.id)} aria-label="Dismiss announcement" className="shrink-0 rounded p-1 opacity-60 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      ))}
      {notices.length > MAX_SHOWN && <p className="px-1 text-[12px] text-ink/50 dark:text-white/50">+{notices.length - MAX_SHOWN} more. Close one to see the next.</p>}
    </div>
  );
}
