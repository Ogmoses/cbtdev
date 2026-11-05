import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { EXPORT_BUCKET } from "@/lib/schoolExport";

/**
 * GET /api/exports/<id>/download -> { url }: a link that works for 5 minutes and downloads the ZIP.
 * The owner may download any export; a school admin only exports of their own (active) school. Anyone else
 * is told it doesn't exist. Every download is written to the audit log BEFORE the link is made.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("id, role, school_id, email").eq("id", auth.user.id).maybeSingle();
  const { data: row } = await admin.from("school_exports").select("id, school_id, school_name, school_code, status, file_path, expires_at, created_at").eq("id", id).maybeSingle();
  const notFound = NextResponse.json({ error: "Export not found." }, { status: 404 });
  if (!me || !row) return notFound;

  if (me.role === "super_admin") {
    if (!me.school_id || me.school_id !== row.school_id) return notFound;
    const { data: school } = await admin.from("schools").select("status").eq("id", me.school_id).maybeSingle();
    if (school?.status !== "active") return notFound;
  } else if (me.role !== "platform_owner") {
    return notFound;
  }

  if (row.status !== "ready" || !row.file_path) return NextResponse.json({ error: "This export isn't ready." }, { status: 409 });
  if (new Date(row.expires_at as string).getTime() <= Date.now()) return NextResponse.json({ error: "This export has expired." }, { status: 410 });

  const audited = await logAudit(admin, {
    actorId: me.id as string,
    actorEmail: (me.email as string | null) ?? null,
    action: "school.export_downloaded",
    targetType: "school_export",
    targetId: id,
    schoolId: row.school_id as string,
    schoolName: row.school_name as string,
    details: { school_code: row.school_code, downloaded_by_role: me.role },
  });
  if (!audited) return NextResponse.json({ error: "Couldn't write the audit record, so the download was not started. Try again." }, { status: 500 });

  const day = String(row.created_at).slice(0, 10);
  const { data, error } = await admin.storage.from(EXPORT_BUCKET).createSignedUrl(row.file_path as string, 300, { download: `${row.school_code}-export-${day}.zip` });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Couldn't prepare the download." }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
