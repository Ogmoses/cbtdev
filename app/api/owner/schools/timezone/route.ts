import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { isValidTimezone } from "@/lib/billingServer";

/**
 * Platform owner only. A school's timezone decides how exam dates and times read for that school's students.
 *   GET   -> { timezones: { [schoolId]: "Africa/Lagos", ... } }
 *   PATCH { id, timezone } -> sets it (a valid IANA name, e.g. "Africa/Lagos"); recorded in the audit log.
 * School admins cannot change it: the column isn't among the ones they may edit (migration 035).
 */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { data } = await createAdminClient().from("schools").select("id, timezone");
  const timezones: Record<string, string> = {};
  for (const s of data ?? []) timezones[s.id as string] = s.timezone as string;
  return NextResponse.json({ timezones }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id, timezone } = await req.json().catch(() => ({}));
  if (!id || typeof id !== "string") return NextResponse.json({ error: "Choose a school." }, { status: 400 });
  if (!isValidTimezone(timezone)) return NextResponse.json({ error: "That isn't a valid timezone." }, { status: 400 });

  const admin = createAdminClient();
  const { data: school } = await admin.from("schools").select("id, name, timezone").eq("id", id).maybeSingle();
  if (!school) return NextResponse.json({ error: "School not found." }, { status: 404 });
  if (school.timezone === timezone) return NextResponse.json({ timezone });

  const { error } = await admin.from("schools").update({ timezone }).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't save the timezone." }, { status: 500 });

  await logAudit(admin, {
    actorId: guard.userId,
    actorEmail: guard.email,
    action: "school.set_timezone",
    targetType: "school",
    targetId: id,
    schoolId: id,
    schoolName: school.name as string,
    details: { from: school.timezone, to: timezone },
  });
  return NextResponse.json({ timezone });
}
