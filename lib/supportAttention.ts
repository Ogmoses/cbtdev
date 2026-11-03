"use client";

import { useEffect, useState } from "react";

/**
 * "How many support things need me?" — shared by the bell and the sidebar dot so the page asks only once.
 *   platform owner:        tickets that are open or in progress (they stay until resolved)
 *   school admin/teacher:  tickets the owner has updated since this person last opened Help & Support
 */
const EVENT = "support-attention-refresh";
const FRESH_MS = 15_000;

let cache: { at: number; count: number } | null = null;
let inflight: Promise<number> | null = null;

export function getSupportAttention(force = false): Promise<number> {
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.count);
  if (inflight) return inflight;
  inflight = fetch("/api/support/attention", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { count: 0 }))
    .then((j) => {
      const count = Number(j.count) || 0;
      cache = { at: Date.now(), count };
      return count;
    })
    .catch(() => cache?.count ?? 0)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Call after anything that changes the answer (saved a ticket, opened Help & Support). */
export function refreshSupportAttention() {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onSupportAttentionRefresh(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function useSupportAttention(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = (force: boolean) =>
      getSupportAttention(force).then((n) => {
        if (!cancelled) setCount(n);
      });
    run(false);
    const timer = setInterval(() => {
      if (!document.hidden) run(false);
    }, 60_000);
    const off = onSupportAttentionRefresh(() => run(true));
    return () => {
      cancelled = true;
      clearInterval(timer);
      off();
    };
  }, [enabled]);
  return count;
}
