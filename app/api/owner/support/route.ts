import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";
import { sendMail } from "@/lib/mailer";
import { supportUpdateEmailHtml } from "@/lib/emailTemplates";

const BUCKET = "support-attachments";
const STATUSES = ["open", "in_progress", "resolved"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_LABEL: Record<Status, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };

/** GET — the inbox. Optional ?status=open|in_progress|resolved. Always returns the count per status. */
export async function GET(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  const status = req.nextUrl.searchParams.get("status");

  let q = admin
    .from("support_tickets")
    .select("id, school_id, created_by_name, created_by_email, created_by_role, subject, category, priority, message, status, owner_reply, replied_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && (STATUSES as readonly string[]).includes(status)) q = q.eq("status", status);
  const { data: tickets, error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't load the inbox." }, { status: 500 });

  const counts = await Promise.all(STATUSES.map((s) => admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", s)));

  const ids = (tickets ?? []).map((t) => t.id as string);
  const schoolIds = Array.from(new Set((tickets ?? []).map((t) => t.school_id as string)));
  const [{ data: files }, { data: schools }] = await Promise.all([
    ids.length ? admin.from("support_ticket_attachments").select("id, ticket_id, path").in("ticket_id", ids) : Promise.resolve({ data: [] as { id: string; ticket_id: string; path: string }[] }),
    schoolIds.length ? admin.from("schools").select("id, name").in("id", schoolIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const urls = new Map<string, string>();
  if ((files ?? []).length) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls((files ?? []).map((f) => f.path), 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const schoolName = new Map((schools ?? []).map((s) => [s.id as string, s.name as string]));

  return NextResponse.json({
    counts: { open: counts[0].count ?? 0, in_progress: counts[1].count ?? 0, resolved: counts[2].count ?? 0 },
    tickets: (tickets ?? []).map((t) => ({
      id: t.id,
      school: schoolName.get(t.school_id as string) ?? "(deleted school)",
      sentBy: t.created_by_name,
      sentByEmail: t.created_by_email,
      sentByRole: t.created_by_role,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      message: t.message,
      status: t.status,
      ownerReply: t.owner_reply,
      repliedAt: t.replied_at,
      createdAt: t.created_at,
      screenshots: (files ?? []).filter((f) => f.ticket_id === t.id).map((f) => ({ id: f.id, url: urls.get(f.path) ?? null })).filter((f) => f.url),
    })),
  });
}

/**
 * PATCH — { id, status?, reply? }. Saves the reply and/or new status, writes the audit record FIRST
 * (nothing changes if it can't be written), then emails the school.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const newStatus = body.status === undefined ? undefined : String(body.status);
  if (newStatus !== undefined && !(STATUSES as readonly string[]).includes(newStatus)) return NextResponse.json({ error: "That status isn't valid." }, { status: 400 });
  const newReply = body.reply === undefined ? undefined : String(body.reply).trim();
  if (newReply !== undefined && (!newReply || newReply.length > 4000)) return NextResponse.json({ error: "The reply must be 1–4000 characters." }, { status: 400 });

  const admin = createAdminClient();
  const { data: t } = await admin
    .from("support_tickets")
    .select("id, school_id, created_by_name, created_by_email, created_by_role, subject, status, owner_reply")
    .eq("id", id)
    .maybeSingle();
  if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });

  const statusChanged = newStatus !== undefined && newStatus !== t.status;
  const replyChanged = newReply !== undefined && newReply !== (t.owner_reply ?? "");
  if (!statusChanged && !replyChanged) return NextResponse.json({ ok: true, changed: false });

  const { data: school } = await admin.from("schools").select("name").eq("id", t.school_id).maybeSingle();
  const base = { actorId: guard.userId, actorEmail: guard.email, targetType: "support_ticket", targetId: id, schoolId: t.school_id as string, schoolName: (school?.name as string | undefined) ?? null };

  if (replyChanged && !(await logAudit(admin, { ...base, action: "support.reply", details: { subject: t.subject } }))) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });
  }
  if (statusChanged && !(await logAudit(admin, { ...base, action: "support.status_changed", details: { subject: t.subject, from: t.status, to: newStatus } }))) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (replyChanged) {
    patch.owner_reply = newReply;
    patch.replied_at = now;
  }
  if (statusChanged) {
    patch.status = newStatus;
    patch.resolved_at = newStatus === "resolved" ? now : null;
  }
  const { error } = await admin.from("support_tickets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't save the change. Nothing was changed." }, { status: 500 });

  // Tell the school. Whoever sent it gets the email; if a teacher sent it, their school admins (who can also see it) do too.
  const finalStatus = (newStatus ?? t.status) as Status;
  const finalReply = replyChanged ? newReply! : ((t.owner_reply as string | null) ?? null);
  const recipients = new Map<string, { name: string; path: string }>();
  if (t.created_by_email) recipients.set(String(t.created_by_email).toLowerCase(), { name: t.created_by_name as string, path: t.created_by_role === "teacher" ? "/teacher/support" : "/admin/support" });
  if (t.created_by_role === "teacher") {
    const { data: admins } = await admin.from("users").select("full_name, email").eq("school_id", t.school_id).eq("role", "super_admin");
    for (const a of admins ?? []) if (a.email && !recipients.has(String(a.email).toLowerCase())) recipients.set(String(a.email).toLowerCase(), { name: a.full_name as string, path: "/admin/support" });
  }

  // The email is from the SCHOOL's point of view: its name in the header, the footer and the sender line.
  // (Quotes and line breaks are stripped so a school name can never break the "From" header.)
  const schoolName = ((school?.name as string | undefined) ?? "").replace(/["\r\n]/g, " ").trim() || process.env.SMTP_FROM_NAME || "School CBT Platform";
  let emailed = 0;
  let emailFailed = false;
  for (const [email, r] of recipients) {
    try {
      await sendMail({
        to: email,
        subject: `Update on your support request: ${t.subject}`,
        fromName: schoolName,
        html: supportUpdateEmailHtml({ schoolName, recipientName: r.name, subject: t.subject as string, statusLabel: STATUS_LABEL[finalStatus], reply: finalReply, link: `${req.nextUrl.origin}${r.path}` }),
      });
      emailed += 1;
    } catch {
      emailFailed = true;
    }
  }

  return NextResponse.json({ ok: true, changed: true, emailed, emailFailed });
}
