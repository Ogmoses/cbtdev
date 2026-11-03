import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformFlags, invalidatePlatformFlags } from "@/lib/platformFlags";
import { logAudit } from "@/lib/owner/audit";

/** GET — the current switches (owner only). */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  return NextResponse.json({ flags: await getPlatformFlags({ fresh: true }) });
}

/**
 * PATCH — { maintenanceMode?, maintenanceMessage?, signupsOpen? }. Owner only.
 * Every real change is written to the audit log; the change is applied only if the
 * audit record could be written first.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const current = await getPlatformFlags({ fresh: true });
  const patch: Record<string, unknown> = {};
  const events: { action: string; details: Record<string, unknown> }[] = [];

  if (body.maintenanceMode !== undefined) {
    if (typeof body.maintenanceMode !== "boolean") return NextResponse.json({ error: "maintenanceMode must be true or false." }, { status: 400 });
    if (body.maintenanceMode !== current.maintenanceMode) {
      patch.maintenance_mode = body.maintenanceMode;
      events.push({ action: body.maintenanceMode ? "flags.maintenance_on" : "flags.maintenance_off", details: { from: current.maintenanceMode, to: body.maintenanceMode } });
    }
  }

  if (body.maintenanceMessage !== undefined) {
    const message = String(body.maintenanceMessage).trim();
    if (!message || message.length > 500) return NextResponse.json({ error: "The maintenance message must be 1–500 characters." }, { status: 400 });
    if (message !== current.maintenanceMessage) {
      patch.maintenance_message = message;
      events.push({ action: "flags.maintenance_message_changed", details: { message } });
    }
  }

  if (body.signupsOpen !== undefined) {
    if (typeof body.signupsOpen !== "boolean") return NextResponse.json({ error: "signupsOpen must be true or false." }, { status: 400 });
    if (body.signupsOpen !== current.signupsOpen) {
      patch.signups_open = body.signupsOpen;
      events.push({ action: body.signupsOpen ? "flags.signups_opened" : "flags.signups_closed", details: { from: current.signupsOpen, to: body.signupsOpen } });
    }
  }

  if (events.length === 0) return NextResponse.json({ flags: current, changed: false });

  const admin = createAdminClient();
  for (const e of events) {
    const ok = await logAudit(admin, { actorId: guard.userId, actorEmail: guard.email, action: e.action, targetType: "platform", targetId: "flags", details: e.details });
    if (!ok) return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });
  }

  const { error } = await admin
    .from("platform_flags")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: guard.userId })
    .eq("id", true);
  if (error) return NextResponse.json({ error: "Couldn't save the change. Nothing was changed." }, { status: 500 });

  invalidatePlatformFlags();
  return NextResponse.json({ flags: await getPlatformFlags({ fresh: true }), changed: true });
}
