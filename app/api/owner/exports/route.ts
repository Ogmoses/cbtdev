import { NextRequest, NextResponse, after } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { EXPORT_BUCKET, EXPORT_COLUMNS, exportForClient, requestSchoolExport, tidyExports } from "@/lib/schoolExport";

// Building a big school's export can take a while; it runs after the request is answered, within this limit.
export const maxDuration = 60;

/** GET — every export (newest first), including those of schools that have since been deleted. Optional ?schoolId=. */
export async function GET(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  await tidyExports(admin);
  const schoolId = req.nextUrl.searchParams.get("schoolId");
  let q = admin.from("school_exports").select(EXPORT_COLUMNS).order("created_at", { ascending: false }).limit(100);
  if (schoolId) q = q.eq("school_id", schoolId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't load the exports." }, { status: 500 });
  return NextResponse.json({ exports: (data ?? []).map(exportForClient) });
}

/** POST { schoolId } — start an export of any school. Answers straight away; the file is built in the background. */
export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { schoolId } = await req.json().catch(() => ({}));
  if (typeof schoolId !== "string" || !schoolId) return NextResponse.json({ error: "schoolId is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("full_name").eq("id", guard.userId).maybeSingle();
  const started = await requestSchoolExport(admin, schoolId, { id: guard.userId, name: (me?.full_name as string | undefined) ?? "Platform owner", email: guard.email, role: "platform_owner" });
  if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
  if (started.run) after(started.run);
  return NextResponse.json({ ok: true, id: started.id });
}

/** DELETE { id } — remove an export (file and record) before its 30 days are up. */
export async function DELETE(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("school_exports").select("id, school_id, school_name, school_code, file_path").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "That export no longer exists." }, { status: 404 });

  const audited = await logAudit(admin, {
    actorId: guard.userId,
    actorEmail: guard.email,
    action: "school.export_deleted",
    targetType: "school_export",
    targetId: id,
    schoolId: row.school_id as string,
    schoolName: row.school_name as string,
    details: { school_code: row.school_code },
  });
  if (!audited) return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });

  if (row.file_path) await admin.storage.from(EXPORT_BUCKET).remove([row.file_path as string]);
  const { error } = await admin.from("school_exports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't remove the export." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
