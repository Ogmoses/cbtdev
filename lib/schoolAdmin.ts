import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** A signed-in school admin (not teacher, not student) of an ACTIVE school — or an error response to return as-is. */
export async function requireSchoolAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("id, role, school_id, full_name, email, is_active").eq("id", auth.user.id).maybeSingle();
  if (!me || me.role !== "super_admin" || !me.school_id || me.is_active === false || !me.email) {
    return { error: NextResponse.json({ error: "Only a school admin can do this." }, { status: 403 }) };
  }
  const { data: school } = await admin.from("schools").select("name, code, status").eq("id", me.school_id).maybeSingle();
  if (!school || school.status !== "active") return { error: NextResponse.json({ error: "Your school isn't active." }, { status: 403 }) };

  return {
    admin,
    user: { id: me.id as string, fullName: me.full_name as string, email: me.email as string, schoolId: me.school_id as string },
    schoolName: school.name as string,
  };
}
