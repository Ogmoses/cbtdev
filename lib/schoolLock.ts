import { createAdminClient } from "@/lib/supabase/admin";
import { isLocked } from "@/lib/billing";

/**
 * Server only: is this school locked (see lib/billing.ts)? Answers are remembered for 30 seconds per server instance,
 * so an extension or a manual lock by the owner reaches everyone within about half a minute without a database
 * read on every request. FAILS OPEN: if the lookup breaks, nobody is locked out because of it.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { locked: boolean; at: number }>();

export async function isSchoolLocked(schoolId: string): Promise<boolean> {
  const hit = cache.get(schoolId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.locked;
  try {
    const { data, error } = await createAdminClient().from("schools").select("subscription_status, term_ends_at").eq("id", schoolId).maybeSingle();
    if (error || !data) return hit?.locked ?? false;
    const locked = isLocked(data as { subscription_status: string | null; term_ends_at: string | null });
    cache.set(schoolId, { locked, at: Date.now() });
    return locked;
  } catch {
    return hit?.locked ?? false;
  }
}

/** Forget what this instance remembers about a school (called right after the owner changes its billing). */
export function forgetSchoolLock(schoolId: string) {
  cache.delete(schoolId);
}
