import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/support/attention -> { count } for the bell and the sidebar dot.
 *   owner:         tickets still open or in progress
 *   admin/teacher: tickets the owner moved to in progress / resolved (or replied to) since this person last looked
 * Anyone else, or anything that goes wrong, is simply 0: an alert must never break a page.
 */
export async function GET() {
  const none = NextResponse.json({ count: 0 }, { headers: { "Cache-Control": "no-store" } });
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return none;

    const admin = createAdminClient();
    const { data: me } = await admin.from("users").select("role").eq("id", auth.user.id).maybeSingle();

    if (me?.role === "platform_owner") {
      const { count } = await admin.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]);
      return NextResponse.json({ count: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
    }

    if (me?.role === "super_admin" || me?.role === "teacher") {
      // Read with the person's own session so the database rules decide which tickets are theirs to see.
      const { data: tickets } = await supabase.from("support_tickets").select("id, updated_at").in("status", ["in_progress", "resolved"]).limit(200);
      const ids = (tickets ?? []).map((t) => t.id as string);
      if (ids.length === 0) return none;
      const { data: views } = await supabase.from("support_ticket_views").select("ticket_id, seen_at").in("ticket_id", ids);
      const seen = new Map((views ?? []).map((v) => [v.ticket_id as string, new Date(v.seen_at as string).getTime()]));
      const unseen = (tickets ?? []).filter((t) => {
        const at = seen.get(t.id as string);
        return at === undefined || at < new Date(t.updated_at as string).getTime();
      }).length;
      return NextResponse.json({ count: unseen }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch {
    // fall through to 0
  }
  return none;
}
