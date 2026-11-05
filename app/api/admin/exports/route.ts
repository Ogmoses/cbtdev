import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EXPORT_COLUMNS, exportForClient, requestSchoolExport, tidyExports } from "@/lib/schoolExport";

export const maxDuration = 60;

/** A signed-in school admin of an ACTIVE school, or an error response. Teachers and students can't export. */
async function requireSchoolAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("id, role, school_id, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!me || me.role !== "super_admin" || !me.school_id) return { error: NextResponse.json({ error: "Only a school admin can export the school's data." }, { status: 403 }) };
  const { data: school } = await admin.from("schools").select("status").eq("id", me.school_id).maybeSingle();
  if (school?.status !== "active") return { error: NextResponse.json({ error: "Your school isn't active." }, { status: 403 }) };
  return { admin, me };
}

/** GET — this school's exports (newest first). */
export async function GET() {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  const { admin, me } = ctx;

  await tidyExports(admin);
  const { data, error } = await admin.from("school_exports").select(EXPORT_COLUMNS).eq("school_id", me.school_id).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Couldn't load your exports." }, { status: 500 });
  return NextResponse.json({ exports: (data ?? []).map(exportForClient) });
}

/** POST — start an export of THIS admin's own school (the school is never taken from the request). */
export async function POST() {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  const { admin, me } = ctx;

  const started = await requestSchoolExport(admin, me.school_id as string, { id: me.id as string, name: me.full_name as string, email: (me.email as string | null) ?? null, role: "super_admin" });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
  if (started.run) after(started.run);
  return NextResponse.json({ ok: true, id: started.id });
}
