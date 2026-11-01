import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The visitor's IP address, for rate limiting. On Vercel the platform sets
 * these headers itself, so a visitor can't make one up. Null if unknown —
 * callers then skip per-IP limits rather than lumping everyone together.
 */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || null;
}

/**
 * Counts one request against `key` and says whether it's still allowed
 * (`max` requests per `windowSeconds`). Counts live in the database (see
 * migration 018) because serverless functions can't remember anything.
 *
 * Fails OPEN: if the limiter itself is broken, real people are let through
 * rather than locked out — the other protections (email confirmation,
 * approval by the owner) still apply.
 */
export async function allow(admin: SupabaseClient, key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/** Is this key already over its allowance? Looks without counting. Fails open. */
export async function isBlocked(admin: SupabaseClient, key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("rate_limit_blocked", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
    return !error && data === true;
  } catch {
    return false;
  }
}
