import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/owner/requireOwner";
import { deleteSchoolCompletely } from "@/lib/owner/deleteSchool";
import { logAudit } from "@/lib/owner/audit";

const STALE_DAYS = 7;

/** Pending schools older than a week whose admin never confirmed their email. */
async function findStale(admin: ReturnType<typeof createAdminClient>) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: pending } = await admin.from("schools").select("id, code, name").eq("status", "pending").lt("created_at", cutoff);
  const stale: { id: string; code: string; name: string }[] = [];
  for (const s of pending ?? []) {
    const { data: adminRow } = await admin.from("users").select("id").eq("school_id", s.id).eq("role", "super_admin").limit(1).maybeSingle();
    if (!adminRow) {
      stale.push(s); // no admin at all — an orphaned request
      continue;
    }
    const { data: authUser } = await admin.auth.admin.getUserById(adminRow.id);
    if (!authUser.user?.email_confirmed_at) stale.push(s);
  }
  return stale;
}

/** GET — how many old, never-confirmed sign-ups there are (for the button label). */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const stale = await findStale(createAdminClient());
  return NextResponse.json({ count: stale.length, days: STALE_DAYS });
}

/** POST — permanently removes them. Only never-confirmed, never-approved requests; a school that was approved or whose admin confirmed is never touched here. */
export async function POST() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  const stale = await findStale(admin);
  let removed = 0;
  for (const s of stale) {
    const base = { actorId: guard.userId, actorEmail: guard.email, targetType: "school", targetId: s.id, schoolId: s.id, schoolName: s.name };
    // Record the intent first; if that can't be written, leave this one alone.
    if (!(await logAudit(admin, { ...base, action: "school.purge_stale_started", details: { code: s.code } }))) continue;
    try {
      await deleteSchoolCompletely(admin, s.id, s.code);
      removed += 1;
      await logAudit(admin, { ...base, action: "school.purge_stale_completed", details: { code: s.code } });
    } catch (err) {
      // skip this one; the rest still go
      await logAudit(admin, { ...base, action: "school.purge_stale_failed", details: { code: s.code, error: err instanceof Error ? err.message : "error" } });
    }
  }
  return NextResponse.json({ ok: true, removed, found: stale.length });
}
