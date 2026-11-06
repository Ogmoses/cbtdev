import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { forgetSchoolLock } from "@/lib/schoolLock";
import { daysUntilEnd, effectiveStatus, isLocked, type SubscriptionStatus } from "@/lib/billing";
import { getBillingContact, isValidTimezone } from "@/lib/billingServer";

const STATUSES: SubscriptionStatus[] = ["trial", "active", "expired"];
const MAX_YEARS_AHEAD = 5;

/** GET — every approved school's billing state (status, term end, fee, notes), plus the owner's contact settings. */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  const [{ data: schools, error }, { data: billing }, contact] = await Promise.all([
    admin.from("schools").select("id, name, code, status, subscription_status, term_ends_at").in("status", ["active", "suspended"]).order("name"),
    admin.from("school_billing").select("school_id, agreed_fee, payment_notes"),
    getBillingContact(admin),
  ]);
  if (error) return NextResponse.json({ error: "Couldn't load billing." }, { status: 500 });

  const byId = new Map((billing ?? []).map((b) => [b.school_id as string, b]));
  const now = Date.now();
  return NextResponse.json({
    serverNow: new Date(now).toISOString(),
    contact,
    schools: (schools ?? []).map((s) => {
      const row = { subscription_status: s.subscription_status as string, term_ends_at: (s.term_ends_at as string | null) ?? null };
      const b = byId.get(s.id as string);
      return {
        id: s.id as string,
        name: s.name as string,
        code: s.code as string,
        schoolStatus: s.status as string,
        subscriptionStatus: row.subscription_status,
        effectiveStatus: effectiveStatus(row, now),
        locked: isLocked(row, now),
        termEndsAt: row.term_ends_at,
        daysLeft: daysUntilEnd(row, now),
        agreedFee: b?.agreed_fee === null || b?.agreed_fee === undefined ? null : Number(b.agreed_fee),
        paymentNotes: (b?.payment_notes as string | null) ?? null,
      };
    }),
  });
}

/**
 * PATCH { schoolId, subscriptionStatus?, termEndsAt?, agreedFee?, paymentNotes?, timezone? }
 * One all-or-nothing change (migration 031's apply_school_billing). The audit record is written FIRST; if it can't be,
 * nothing changes. Locking, unlocking, extending and editing the fee are all this one call.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const b = await req.json().catch(() => ({}));
  const schoolId = typeof b.schoolId === "string" ? b.schoolId : "";
  if (!schoolId) return NextResponse.json({ error: "schoolId is required." }, { status: 400 });

  const patch: Record<string, unknown> = {};

  if (b.subscriptionStatus !== undefined) {
    if (!STATUSES.includes(b.subscriptionStatus)) return NextResponse.json({ error: "That status isn't valid." }, { status: 400 });
    patch.subscription_status = b.subscriptionStatus;
  }
  if (b.termEndsAt !== undefined) {
    if (b.termEndsAt === null) patch.term_ends_at = null;
    else {
      const d = new Date(String(b.termEndsAt));
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "The end date isn't valid." }, { status: 400 });
      if (d.getTime() > Date.now() + MAX_YEARS_AHEAD * 366 * 86_400_000) return NextResponse.json({ error: `The end date can't be more than ${MAX_YEARS_AHEAD} years away.` }, { status: 400 });
      patch.term_ends_at = d.toISOString();
    }
  }
  if (b.agreedFee !== undefined) {
    if (b.agreedFee === null || b.agreedFee === "") patch.agreed_fee = null;
    else {
      const n = Number(b.agreedFee);
      if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) return NextResponse.json({ error: "The fee must be a number, 0 or more." }, { status: 400 });
      patch.agreed_fee = Math.round(n * 100) / 100;
    }
  }
  if (b.paymentNotes !== undefined) {
    const notes = b.paymentNotes === null ? "" : String(b.paymentNotes).trim();
    if (notes.length > 1000) return NextResponse.json({ error: "Payment notes can be up to 1000 characters." }, { status: 400 });
    patch.payment_notes = notes || null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, changed: false });

  const admin = createAdminClient();
  const { data: school } = await admin.from("schools").select("id, name, code, subscription_status, term_ends_at").eq("id", schoolId).maybeSingle();
  if (!school) return NextResponse.json({ error: "School not found." }, { status: 404 });
  const { data: current } = await admin.from("school_billing").select("agreed_fee, payment_notes").eq("school_id", schoolId).maybeSingle();

  // what really changes (so the log and the "nothing to do" answer are honest)
  const details: Record<string, unknown> = { school_code: school.code };
  const changed: string[] = [];
  if ("subscription_status" in patch && patch.subscription_status !== school.subscription_status) {
    changed.push("status");
    details.status = { from: school.subscription_status, to: patch.subscription_status };
  }
  if ("term_ends_at" in patch) {
    const before = school.term_ends_at ? new Date(school.term_ends_at as string).getTime() : null;
    const after = patch.term_ends_at ? new Date(patch.term_ends_at as string).getTime() : null;
    if (before !== after) {
      changed.push("term end");
      details.term_ends_at = { from: school.term_ends_at ?? null, to: patch.term_ends_at ?? null };
    }
  }
  if ("agreed_fee" in patch) {
    const before = current?.agreed_fee === null || current?.agreed_fee === undefined ? null : Number(current.agreed_fee);
    if (before !== patch.agreed_fee) {
      changed.push("fee");
      details.agreed_fee = { from: before, to: patch.agreed_fee };
    }
  }
  if ("payment_notes" in patch && (current?.payment_notes ?? null) !== patch.payment_notes) {
    changed.push("payment notes"); // the text itself is never copied into the log
  }
  if (changed.length === 0) return NextResponse.json({ ok: true, changed: false });
  details.changed = changed;

  const audited = await logAudit(admin, { actorId: guard.userId, actorEmail: guard.email, action: "billing.update", targetType: "school", targetId: schoolId, schoolId, schoolName: school.name as string, details });
  if (!audited) return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });

  const { error } = await admin.rpc("apply_school_billing", { p_school_id: schoolId, p_patch: patch });
  if (error) return NextResponse.json({ error: "Couldn't save the change. Nothing was changed." }, { status: 500 });
  forgetSchoolLock(schoolId);

  // remember the owner's time zone so dates read the same everywhere (best effort)
  if (isValidTimezone(b.timezone)) await admin.from("platform_settings").update({ billing_timezone: b.timezone }).eq("id", true);

  return NextResponse.json({ ok: true, changed: true });
}
