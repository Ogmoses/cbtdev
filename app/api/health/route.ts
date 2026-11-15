import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/health — for uptime monitors. PUBLIC and read-only; it exposes nothing private.
 *
 * It makes one tiny REAL database query, so a monitor sees a failure when the database is unreachable or slow. (The existing
 * /api/platform/status deliberately keeps answering "fine" when the database is down, so it can't be used for this.)
 *   200 {"ok":true,...}   the app answered and the database answered within 4 seconds
 *   503 {"ok":false,...}  the database didn't answer, or errored
 * The answer is remembered for 10 seconds per server instance, so a monitor (or anyone) can't hammer the database through here.
 */
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 4000;
const CACHE_MS = 10_000;
let cached: { at: number; body: Record<string, unknown>; status: number } | null = null;

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (cached && Date.now() - cached.at < CACHE_MS) return NextResponse.json(cached.body, { status: cached.status, headers });

  const started = Date.now();
  let dbOk = false;
  try {
    const query = createAdminClient().from("platform_flags").select("id").limit(1);
    const result = await Promise.race([
      Promise.resolve(query),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    dbOk = !(result as { error?: unknown }).error;
  } catch {
    dbOk = false;
  }

  const body = {
    ok: dbOk,
    db: { ok: dbOk, ms: Date.now() - started },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    time: new Date().toISOString(),
  };
  const status = dbOk ? 200 : 503;
  cached = { at: Date.now(), body, status };
  return NextResponse.json(body, { status, headers });
}
