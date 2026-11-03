import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/owner/telemetry?dayStart=<ISO time> — the owner's live view in one call.
 * `dayStart` is the owner's own local midnight (so "submissions today" matches their day);
 * anything missing, invalid or more than 36 hours old falls back to the start of today (UTC).
 * Contains counts and school names only — never a student's name or id.
 */
export async function GET(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const now = Date.now();
  let dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const asked = req.nextUrl.searchParams.get("dayStart");
  if (asked) {
    const d = new Date(asked);
    if (!Number.isNaN(d.getTime()) && d.getTime() <= now && now - d.getTime() <= 36 * 3600 * 1000) dayStart = d;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("platform_telemetry", { p_day_start: dayStart.toISOString(), p_feed_limit: 30 });
  if (error || !data) return NextResponse.json({ error: "Couldn't load live data." }, { status: 500 });

  return NextResponse.json({ ...data, serverTime: new Date(now).toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
