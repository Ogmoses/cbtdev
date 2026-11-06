import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { getBillingContact, isValidTimezone } from "@/lib/billingServer";

/** PATCH { contactEmail, contactPhone, message, currency, timezone? } — what the renewal notice and reminder emails say. */
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const b = await req.json().catch(() => ({}));
  const clean = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
  const email = clean(b.contactEmail);
  const phone = clean(b.contactPhone);
  const message = clean(b.message);
  const currency = clean(b.currency);

  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  if (phone && phone.length > 40) return NextResponse.json({ error: "The phone number is too long." }, { status: 400 });
  if (message && message.length > 500) return NextResponse.json({ error: "The message can be up to 500 characters." }, { status: 400 });
  if (currency && currency.length > 8) return NextResponse.json({ error: "The currency symbol can be up to 8 characters." }, { status: 400 });

  const admin = createAdminClient();
  const before = await getBillingContact(admin);
  const update: Record<string, unknown> = { billing_contact_email: email, billing_contact_phone: phone, billing_message: message, billing_currency: currency };
  if (isValidTimezone(b.timezone)) update.billing_timezone = b.timezone;

  const changed = [
    before.email !== email && "email",
    before.phone !== phone && "phone",
    before.message !== message && "message",
    before.currency !== currency && "currency",
  ].filter(Boolean) as string[];
  if (changed.length === 0 && !update.billing_timezone) return NextResponse.json({ ok: true, changed: false });

  const audited = await logAudit(admin, { actorId: guard.userId, actorEmail: guard.email, action: "billing.contact_updated", targetType: "platform", targetId: "billing-contact", details: { changed } });
  if (!audited) return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });

  const { error } = await admin.from("platform_settings").update(update).eq("id", true);
  if (error) return NextResponse.json({ error: "Couldn't save. Nothing was changed." }, { status: 500 });
  return NextResponse.json({ ok: true, changed: true });
}
