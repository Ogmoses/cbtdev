import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allow } from "@/lib/rateLimit";

/**
 * POST /api/auth/track-login — called by the login screen right after a successful sign-in, so the
 * owner's live feed can show "a teacher signed in at <school>".
 *
 * Who and which school come from the database (never from the request), the person's identity is
 * NOT stored (only school + role), and each person can add at most one entry per 10 minutes.
 * Always answers OK: tracking must never get in the way of signing in.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ ok: true });

    const admin = createAdminClient();
    const { data: me } = await admin.from("users").select("role, school_id").eq("id", auth.user.id).maybeSingle();
    if (!me?.school_id || !["super_admin", "teacher", "student"].includes(me.role as string)) return NextResponse.json({ ok: true });

    if (!(await allow(admin, `login-event:${auth.user.id}`, 1, 600))) return NextResponse.json({ ok: true });
    await admin.rpc("record_login_event", { p_school_id: me.school_id, p_role: me.role });
  } catch {
    // never block a sign-in over bookkeeping
  }
  return NextResponse.json({ ok: true });
}
