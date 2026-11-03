import { createAdminClient } from "@/lib/supabase/admin";

export interface PlatformFlags {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  signupsOpen: boolean;
  updatedAt: string | null;
}

export const DEFAULT_MAINTENANCE_MESSAGE = "We are making some improvements. Please check back shortly.";

const DEFAULTS: PlatformFlags = { maintenanceMode: false, maintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE, signupsOpen: true, updatedAt: null };

// Serverless instances each keep their own short-lived copy, so a flip reaches every
// instance within a few seconds without a database read on every single request.
const TTL_MS = 5_000;
let cache: { at: number; value: PlatformFlags } | null = null;

/**
 * Server-only. The current switches, read with the service role (the table is owner-only
 * for the browser). FAILS OPEN: if the read breaks, the last known value is used, and with
 * none, the normal position (maintenance off, sign-ups open) — a database hiccup must never
 * lock every school out.
 */
export async function getPlatformFlags(opts: { fresh?: boolean } = {}): Promise<PlatformFlags> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("platform_flags")
      .select("maintenance_mode, maintenance_message, signups_open, updated_at")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return cache?.value ?? DEFAULTS;
    const value: PlatformFlags = {
      maintenanceMode: data.maintenance_mode === true,
      maintenanceMessage: (data.maintenance_message as string) || DEFAULT_MAINTENANCE_MESSAGE,
      signupsOpen: data.signups_open !== false,
      updatedAt: (data.updated_at as string | null) ?? null,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? DEFAULTS;
  }
}

/** Forget this instance's copy (called right after the owner changes a switch). */
export function invalidatePlatformFlags() {
  cache = null;
}
