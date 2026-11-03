import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";

/** GET — re-checks the audit log's hash chain. ok=false means a row was altered outside the app. */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("verify_audit_chain");
  if (error) return NextResponse.json({ error: "Couldn't check the audit log." }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: row?.ok === true, checked: Number(row?.checked ?? 0), brokenAt: row?.broken_at ?? null });
}
