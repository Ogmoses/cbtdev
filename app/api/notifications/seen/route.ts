import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const KEYS = ["results", "upcoming"] as const;

/**
 * POST { keys: ["results" | "upcoming", ...] } — the student has looked at these bell items (opened the bell, or the
 * Past Results page): remember "seen just now" so the dot only comes back for something newer. Only the signed-in
 * student's own rows are written, and only for the known items.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: true });

  const body = await req.json().catch(() => ({}));
  const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).filter((k: unknown): k is (typeof KEYS)[number] => KEYS.includes(k as (typeof KEYS)[number])))];
  if (keys.length === 0) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "student") return NextResponse.json({ ok: true });

  const now = new Date().toISOString();
  const { error } = await admin
    .from("notification_seen")
    .upsert(keys.map((item_key) => ({ user_id: auth.user.id, item_key, seen_at: now })), { onConflict: "user_id,item_key" });
  if (error) return NextResponse.json({ error: "Couldn't mark them as read." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
