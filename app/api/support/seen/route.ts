import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/support/seen — the person has opened Help & Support: mark the updates they can see as read.
 * Only tickets the database lets THEM see are touched, and only for themselves.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: true });

  const { data: tickets } = await supabase.from("support_tickets").select("id").in("status", ["in_progress", "resolved"]).limit(200);
  const ids = (tickets ?? []).map((t) => t.id as string);
  if (ids.length === 0) return NextResponse.json({ ok: true });

  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("support_ticket_views")
    .upsert(ids.map((ticket_id) => ({ ticket_id, user_id: auth.user.id, seen_at: now })), { onConflict: "ticket_id,user_id" });
  if (error) return NextResponse.json({ error: "Couldn't mark them as read." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
