import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allow } from "@/lib/rateLimit";
import { validateFullName } from "@/lib/accountName";

/**
 * PATCH { fullName } — a school admin, teacher or the platform owner changes their OWN display name.
 * (Students can't: their sign-in password is built from their name.) Who is changed always comes from the login, never the request.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("id, role").eq("id", auth.user.id).maybeSingle();
  if (!me || !["super_admin", "teacher", "platform_owner"].includes(me.role as string)) {
    return NextResponse.json({ error: "You can't change your name here. Ask your school admin." }, { status: 403 });
  }

  if (!(await allow(admin, `rename:${me.id}`, 10, 3600))) return NextResponse.json({ error: "You've changed your name several times in the last hour. Please wait a while." }, { status: 429 });

  const { fullName } = await req.json().catch(() => ({}));
  const checked = validateFullName(fullName);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const { error } = await admin.from("users").update({ full_name: checked.name }).eq("id", me.id);
  if (error) return NextResponse.json({ error: "Couldn't save your name. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true, fullName: checked.name });
}
