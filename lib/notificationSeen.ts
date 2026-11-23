"use client";

/**
 * "The student has looked at this bell item." Records it on the server (per account), then tells the bell to
 * re-check straight away so its dot clears without waiting for the next refresh.
 */
const EVENT = "notifications-refresh";

export type SeenKey = "results" | "upcoming";

export async function markSeen(keys: SeenKey[]) {
  try {
    await fetch("/api/notifications/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
  } catch {
    // the dot is a nicety: failing to record a view must never break a page
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onNotificationsRefresh(handler: () => void) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
