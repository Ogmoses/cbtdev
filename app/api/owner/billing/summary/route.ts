import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { REMINDER_DAYS, daysUntilEnd, isLocked } from "@/lib/billing";

/** GET -> { locked, endingSoon } for the owner's bell: schools locked now, and schools whose term ends within 7 days. */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ locked: 0, endingSoon: 0 });
  const { data } = await createAdminClient().from("schools").select("subscription_status, term_ends_at").eq("status", "active");
  const now = Date.now();
  let locked = 0;
  let endingSoon = 0;
  for (const s of data ?? []) {
    const row = { subscription_status: s.subscription_status as string, term_ends_at: (s.term_ends_at as string | null) ?? null };
    if (isLocked(row, now)) locked += 1;
    else {
      const d = daysUntilEnd(row, now);
      if (d !== null && d <= REMINDER_DAYS) endingSoon += 1;
    }
  }
  return NextResponse.json({ locked, endingSoon }, { headers: { "Cache-Control": "no-store" } });
}
