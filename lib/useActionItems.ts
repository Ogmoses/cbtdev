"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSupportAttention, onSupportAttentionRefresh } from "@/lib/supportAttention";
import { onNotificationsRefresh } from "@/lib/notificationSeen";
import { batchState } from "@/lib/batchWindow";

export interface ActionItem {
  key: string;
  label: string;
  count: number;
  href: string;
  /** false once the person has looked at it (students' bell only); the dot shows only for unseen items. */
  unseen: boolean;
}

type Role = "platform_owner" | "super_admin" | "teacher" | "student";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Start / end of "today" in the person's own timezone, as ISO strings. */
function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * What needs this person's attention right now — the bell's content.
 * Worked out live from the same data the pages show (always limited by the
 * database to their own school / their own exams / their own results), so
 * there's nothing extra to store and the numbers can't drift from the pages.
 * Only items with something waiting are returned.
 */
export function useActionItems(role: Role) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0); // only the newest lookup may update the bell, so a slow older one can't bring a cleared dot back

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const found: ActionItem[] = [];

      if (role === "platform_owner") {
        const res = await fetch("/api/owner/schools");
        if (res.ok) {
          const pending = ((await res.json()).pending ?? {}) as Record<string, { verified: boolean }>;
          const ready = Object.values(pending).filter((p) => p.verified).length;
          if (ready > 0) found.push({ key: "approvals", label: `${plural(ready, "school is", "schools are")} waiting for your approval`, count: ready, href: "/owner#schools", unseen: true });
        }
      }

      if (role === "super_admin") {
        const { data: unpublished } = await supabase.from("results").select("exam_id").eq("published", false);
        const exams = new Set((unpublished ?? []).map((r: { exam_id: string }) => r.exam_id)).size;
        if (exams > 0) found.push({ key: "publish", label: `${plural(exams, "exam has", "exams have")} results ready to publish`, count: exams, href: "/admin/results", unseen: true });

        const { start, end } = todayRange();
        const { count: today } = await supabase.from("exam_batches").select("id", { count: "exact", head: true }).gte("starts_at", start).lte("starts_at", end);
        if ((today ?? 0) > 0) found.push({ key: "today", label: `${plural(today ?? 0, "exam batch is", "exam batches are")} scheduled today`, count: today ?? 0, href: "/admin/batches", unseen: true });
      }

      if (role === "teacher") {
        // Same rule as the grading queue: written answers (fill-in / theory) from submitted sittings that have no mark yet.
        const { count: toMark } = await supabase
          .from("student_answers")
          .select("id, questions!inner(type), student_exam_sessions!inner(status)", { count: "exact", head: true })
          .in("questions.type", ["fill_blank", "short_theory"])
          .eq("student_exam_sessions.status", "submitted")
          .is("points_awarded", null);
        if ((toMark ?? 0) > 0) found.push({ key: "mark", label: `${plural(toMark ?? 0, "answer is", "answers are")} waiting to be marked`, count: toMark ?? 0, href: "/teacher/grading", unseen: true });

        const { start, end } = todayRange();
        const { count: today } = await supabase.from("exam_batches").select("id", { count: "exact", head: true }).gte("starts_at", start).lte("starts_at", end);
        if ((today ?? 0) > 0) found.push({ key: "today", label: `${plural(today ?? 0, "of your exam batches is", "of your exam batches are")} today`, count: today ?? 0, href: "/teacher/exams", unseen: true });
      }

      if (role === "student") {
        const now = new Date();
        const DAY = 24 * 60 * 60 * 1000;
        const soon = new Date(now.getTime() + 3 * DAY);

        // When this student last looked at each item (the bell, or the page it leads to). If this can't be read,
        // everything simply counts as unseen — the dot behaves as it did before, never worse.
        const { data: seenRows } = await supabase.from("notification_seen").select("item_key, seen_at");
        const seen = new Map((seenRows ?? []).map((r: { item_key: string; seen_at: string }) => [r.item_key, new Date(r.seen_at).getTime()]));
        const isNewSince = (key: string, at: number) => {
          const last = seen.get(key);
          return last === undefined || at > last;
        };

        const [{ data: batches }, { data: sittings }] = await Promise.all([
          supabase.from("exam_batches").select("id, starts_at, ends_at, stays_open, closed_at, created_at").lte("starts_at", soon.toISOString()),
          supabase.from("student_exam_sessions").select("batch_id, status"),
        ]);
        const done = new Set((sittings ?? []).filter((s: { status: string }) => s.status !== "active").map((s: { batch_id: string }) => s.batch_id));
        const upcomingBatches = (batches ?? []).filter((b: { id: string; starts_at: string; ends_at: string; stays_open: boolean | null; closed_at: string | null }) => !done.has(b.id) && batchState(b, now) !== "ended") as { id: string; starts_at: string; created_at: string }[];
        if (upcomingBatches.length > 0) {
          // An exam becomes bell-worthy once it is scheduled AND within 3 days — whichever happened later.
          const unseen = upcomingBatches.some((b) => isNewSince("upcoming", Math.max(new Date(b.created_at).getTime(), new Date(b.starts_at).getTime() - 3 * DAY)));
          found.push({ key: "upcoming", label: `${plural(upcomingBatches.length, "exam is", "exams are")} coming up`, count: upcomingBatches.length, href: "/student/batches", unseen });
        }

        const since = new Date(now.getTime() - 14 * DAY).toISOString();
        const { data: recent } = await supabase.from("results").select("published_at").eq("published", true).gte("published_at", since);
        if ((recent ?? []).length > 0) {
          const unseen = (recent ?? []).some((r: { published_at: string }) => isNewSince("results", new Date(r.published_at).getTime()));
          found.push({ key: "results", label: `${plural((recent ?? []).length, "recent result", "recent results")} to view`, count: (recent ?? []).length, href: "/student/results", unseen });
        }
      }

      // Support: the owner sees open / in-progress requests; admins and teachers see updates on their own requests.
      if (role !== "student") {
        const support = await getSupportAttention();
        if (support > 0) {
          const href = role === "platform_owner" ? "/owner/support" : role === "super_admin" ? "/admin/support" : "/teacher/support";
          const label =
            role === "platform_owner"
              ? `${plural(support, "support request needs", "support requests need")} your attention`
              : `${plural(support, "support request has", "support requests have")} an update`;
          found.push({ key: "support", label, count: support, href, unseen: true });
        }
      }

      // Billing (owner): schools that are locked now, and schools whose term ends within 7 days.
      if (role === "platform_owner") {
        const res = await fetch("/api/owner/billing/summary", { cache: "no-store" });
        if (res.ok) {
          const { locked = 0, endingSoon = 0 } = await res.json();
          if (locked > 0) found.push({ key: "billing-locked", label: `${plural(locked, "school is", "schools are")} locked (term ended)`, count: locked, href: "/owner#billing", unseen: true });
          if (endingSoon > 0) found.push({ key: "billing-soon", label: `${plural(endingSoon, "school's term ends", "schools' terms end")} within 7 days`, count: endingSoon, href: "/owner#billing", unseen: true });
        }
      }

      if (mine === latest.current) setItems(found);
    } catch {
      // A failed lookup just means an empty bell, never a broken page.
      if (mine === latest.current) setItems([]);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [role, supabase]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2 * 60 * 1000); // keep the dot honest while the page stays open
    const off = onSupportAttentionRefresh(refresh); // a ticket was just saved / read: update right away
    const offSeen = onNotificationsRefresh(refresh); // a student just looked at the bell / Past Results: update right away
    return () => {
      window.clearInterval(timer);
      off();
      offSeen();
    };
  }, [refresh]);

  return { items, loading, refresh, total: items.length, unseenTotal: items.filter((i) => i.unseen).length };
}
