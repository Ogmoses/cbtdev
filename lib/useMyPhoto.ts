"use client";

import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";

/**
 * The signed-in person's own passport photo (a short-lived link from /api/account/photo), or null.
 * Shared by the top bar and the profile page so it's fetched once. The saved copy is tied to the signed-in person,
 * so on a shared computer the next person to sign in never sees the previous person's picture.
 */
const PHOTO_FRESH_MS = 45 * 60_000; // the link works for an hour
const NO_PHOTO_FRESH_MS = 2 * 60_000; // check again soon, in case one was just added

let cache: { userId: string; url: string | null; at: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function load(userId: string): Promise<string | null> {
  if (cache && cache.userId === userId && Date.now() - cache.at < (cache.url ? PHOTO_FRESH_MS : NO_PHOTO_FRESH_MS)) return cache.url;
  if (!inflight) {
    inflight = fetch("/api/account/photo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((j) => {
        const url = typeof j.url === "string" ? j.url : null;
        cache = { userId, url, at: Date.now() };
        return url;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useMyPhoto(enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const supabase = createClient();
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) {
        if (!cancelled) setUrl(null);
        return;
      }
      const next = await load(userId);
      if (!cancelled) setUrl(next);
    };
    void run();
    const timer = setInterval(() => void run(), 5 * 60_000); // picks up a new link before the old one expires
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return enabled ? url : null;
}
