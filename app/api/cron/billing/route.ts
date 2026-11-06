import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { sendMail } from "@/lib/mailer";
import { renewalReminderEmailHtml } from "@/lib/emailTemplates";
import { REMINDER_DAYS, daysUntilEnd } from "@/lib/billing";
import { forgetSchoolLock } from "@/lib/schoolLock";
import { formatEndDate, getBillingContact } from "@/lib/billingServer";

export const maxDuration = 60;

/** Same-length constant-time comparison of the caller's secret with ours. */
function secretMatches(header: string | null, secret: string): boolean {
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/cron/billing — run once a day by Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`;
 * with no CRON_SECRET configured the job refuses to run, so nobody else can trigger it.
 *   1. EXPIRE: a school whose end date has passed is marked 'expired' (the app already locks it from the moment the date
 *      passes; this keeps the stored status and the owner's list truthful). Audit-logged first, as "system".
 *   2. REMIND: a school ending within 7 days, not yet reminded for THAT end date, gets an email to each of its admins
 *      (from the school's name, with the owner's contact details). A new end date earns a new reminder.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (!secretMatches(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const admin = createAdminClient();
  const now = Date.now();
  const summary = { expired: 0, reminded: 0, remindersSkipped: 0 };

  // ---- 1. expire
  const { data: due } = await admin
    .from("schools")
    .select("id, name, term_ends_at")
    .eq("status", "active")
    .in("subscription_status", ["trial", "active"])
    .not("term_ends_at", "is", null)
    .lte("term_ends_at", new Date(now).toISOString());
  for (const s of due ?? []) {
    const ok = await logAudit(admin, { actorId: null, actorEmail: "system (daily billing job)", action: "billing.auto_expired", targetType: "school", targetId: s.id as string, schoolId: s.id as string, schoolName: s.name as string, details: { term_ended_at: s.term_ends_at } });
    if (!ok) continue; // try again tomorrow rather than change something without a record
    const { error } = await admin.from("schools").update({ subscription_status: "expired" }).eq("id", s.id).in("subscription_status", ["trial", "active"]);
    if (!error) {
      summary.expired += 1;
      forgetSchoolLock(s.id as string);
    }
  }

  // ---- 2. remind
  const horizon = new Date(now + REMINDER_DAYS * 86_400_000).toISOString();
  const { data: soon } = await admin
    .from("schools")
    .select("id, name, term_ends_at, subscription_status")
    .eq("status", "active")
    .in("subscription_status", ["trial", "active"])
    .gt("term_ends_at", new Date(now).toISOString())
    .lte("term_ends_at", horizon);

  if (soon?.length) {
    const ids = soon.map((s) => s.id as string);
    const { data: billing } = await admin.from("school_billing").select("school_id, reminder_sent_for").in("school_id", ids);
    const alreadyFor = new Map((billing ?? []).map((b) => [b.school_id as string, b.reminder_sent_for ? new Date(b.reminder_sent_for as string).getTime() : null]));
    const contact = await getBillingContact(admin);

    for (const s of soon) {
      const endsMs = new Date(s.term_ends_at as string).getTime();
      if (alreadyFor.get(s.id as string) === endsMs) continue; // already reminded for this end date

      const { data: admins } = await admin.from("users").select("full_name, email").eq("school_id", s.id).eq("role", "super_admin").eq("is_active", true).not("email", "is", null);
      const recipients = (admins ?? []).filter((a) => a.email);
      if (recipients.length === 0) {
        summary.remindersSkipped += 1;
        continue;
      }

      const fromName = String(s.name).replace(/["\r\n]/g, " ").trim();
      const endsOn = formatEndDate(s.term_ends_at as string, contact.timezone);
      const daysLeft = Math.max(1, daysUntilEnd({ subscription_status: s.subscription_status as string, term_ends_at: s.term_ends_at as string }, now) ?? 1);
      let sent = 0;
      for (const a of recipients) {
        try {
          await sendMail({
            to: a.email as string,
            subject: `Your school's access ends on ${endsOn}`,
            fromName,
            html: renewalReminderEmailHtml({ schoolName: s.name as string, fullName: a.full_name as string, endsOn, daysLeft, contactEmail: contact.email, contactPhone: contact.phone, message: contact.message }),
          });
          sent += 1;
        } catch {
          // one bad address must not stop the rest
        }
      }
      if (sent === 0) {
        summary.remindersSkipped += 1; // nothing went out: leave it unmarked so tomorrow's run tries again
        continue;
      }
      await logAudit(admin, { actorId: null, actorEmail: "system (daily billing job)", action: "billing.reminder_sent", targetType: "school", targetId: s.id as string, schoolId: s.id as string, schoolName: s.name as string, details: { term_ends_at: s.term_ends_at, emailed: sent, of: recipients.length } });
      await admin.from("school_billing").upsert({ school_id: s.id, reminder_sent_for: s.term_ends_at, updated_at: new Date().toISOString() }, { onConflict: "school_id" });
      summary.reminded += 1;
    }
  }

  return NextResponse.json({ ok: true, ...summary });
}
