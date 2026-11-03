import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireOwner } from "@/lib/owner/requireOwner";
import { deleteSchoolCompletely } from "@/lib/owner/deleteSchool";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueAccessToken } from "@/lib/accessTokens";
import { sendMail } from "@/lib/mailer";
import { logAudit } from "@/lib/owner/audit";
import { inviteEmailHtml, schoolApprovedEmailHtml } from "@/lib/emailTemplates";

/**
 * Platform-owner console actions. Only the platform owner may call this; it
 * uses the service role (the status column of `schools` is deliberately not
 * writable from the browser), so the role check below is the gate.
 *
 *   POST  — add a school by hand: creates it already ACTIVE (which also gives
 *           it the default grading scale, see migration 014) and invites its
 *           first admin by email. If the email can't be sent (provider quota,
 *           outage), the school and admin are STILL created and the invite
 *           link is returned so the owner can send it another way.
 *   PATCH — { id, action }: "approve" (pending -> active, optionally fixing
 *           the code first), "suspend" (active -> suspended),
 *           "reactivate" (suspended -> active).
 */

const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validCode(code: unknown): code is string {
  return typeof code === "string" && CODE_RE.test(code) && code.length >= 3 && code.length <= 40;
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const code = String(body.code ?? "").trim().toLowerCase();
  const adminName = String(body.adminName ?? "").trim();
  const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();

  if (!name) return NextResponse.json({ error: "Enter the school's name." }, { status: 400 });
  if (!validCode(code)) {
    return NextResponse.json({ error: "The school code must be 3–40 characters: lowercase letters, numbers and single dashes (e.g. bright-future)." }, { status: 400 });
  }
  if (!adminName) return NextResponse.json({ error: "Enter the first admin's name." }, { status: 400 });
  if (!EMAIL_RE.test(adminEmail)) return NextResponse.json({ error: "Enter a valid email for the first admin." }, { status: 400 });

  const admin = createAdminClient();

  const { data: codeTaken } = await admin.from("schools").select("id").eq("code", code).maybeSingle();
  if (codeTaken) return NextResponse.json({ error: "That school code is already used. Pick another." }, { status: 409 });
  const { data: emailTaken } = await admin.from("users").select("id").eq("email", adminEmail).maybeSingle();
  if (emailTaken) return NextResponse.json({ error: "That email already belongs to an account. One email can only belong to one school." }, { status: 409 });

  // Active straight away: the owner is the one adding it. (The insert also
  // seeds the default grading scale via a trigger.)
  const { data: school, error: schoolError } = await admin
    .from("schools")
    .insert({ name, code, status: "active", approved_at: new Date().toISOString() })
    .select("id, name, code, status")
    .single();
  if (schoolError || !school) {
    return NextResponse.json({ error: schoolError?.message ?? "Couldn't create the school." }, { status: 500 });
  }

  // Undo everything if a later step fails, so a half-made school never lingers.
  const undo = async (authUserId?: string) => {
    if (authUserId) await admin.auth.admin.deleteUser(authUserId); // cascades to its users row
    await admin.from("grading_scale").delete().eq("school_id", school.id);
    await admin.from("schools").delete().eq("id", school.id);
  };

  const lockedPassword = crypto.randomBytes(24).toString("base64url");
  const { data: created, error: authError } = await admin.auth.admin.createUser({ email: adminEmail, password: lockedPassword, email_confirm: true });
  if (authError || !created.user) {
    await undo();
    return NextResponse.json({ error: authError?.message ?? "Couldn't create the admin account." }, { status: 500 });
  }

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    school_id: school.id,
    role: "super_admin",
    full_name: adminName,
    email: adminEmail,
    is_active: true,
  });
  if (profileError) {
    await undo(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Without an invite token there's no way for the admin to get in, so that failure still undoes everything.
  let inviteLink: string;
  let expiresInHours: number;
  try {
    const issued = await issueAccessToken(admin, { userId: created.user.id, purpose: "invite" });
    inviteLink = `${req.nextUrl.origin}/set-password?token=${issued.token}&school=${school.code}`;
    expiresInHours = issued.expiresInHours;
  } catch (err) {
    await undo(created.user.id);
    return NextResponse.json({ error: `Couldn't create the admin's invite. (${err instanceof Error ? err.message : "error"})` }, { status: 500 });
  }

  // A failed email does NOT undo the school: the owner gets the link to send by hand.
  let emailSent = false;
  let emailError: string | null = null;
  try {
    await sendMail({
      to: adminEmail,
      subject: `Set up your account at ${school.name}`,
      html: inviteEmailHtml({ schoolName: school.name, fullName: adminName, link: inviteLink, expiresInHours }),
    });
    emailSent = true;
  } catch (err) {
    emailError = err instanceof Error ? err.message : "mail error";
  }

  await logAudit(admin, {
    actorId: guard.userId,
    actorEmail: guard.email,
    action: "school.create",
    targetType: "school",
    targetId: school.id,
    schoolId: school.id,
    schoolName: school.name,
    details: { code: school.code, first_admin_email: adminEmail, invite_email_sent: emailSent },
  });

  return NextResponse.json({
    school,
    link: `${req.nextUrl.origin}/s/${school.code}`,
    emailSent,
    emailError,
    adminEmail,
    expiresInHours,
    // Only handed back when the email didn't go out; the response goes to the platform owner alone.
    inviteLink: emailSent ? null : inviteLink,
  });
}

/** The admin behind a pending school: who they are and whether they confirmed their email. */
async function pendingAdminInfo(admin: ReturnType<typeof createAdminClient>, schoolId: string) {
  const { data: adminRow } = await admin
    .from("users")
    .select("id, full_name, email")
    .eq("school_id", schoolId)
    .eq("role", "super_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!adminRow) return null;
  const { data: authUser } = await admin.auth.admin.getUserById(adminRow.id);
  return { id: adminRow.id, fullName: adminRow.full_name as string, email: adminRow.email as string | null, verified: Boolean(authUser.user?.email_confirmed_at) };
}

/** GET — who is behind each pending school, and have they confirmed their email? (Owner console uses this.) */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  const { data: pending } = await admin.from("schools").select("id").eq("status", "pending");
  const result: Record<string, { fullName: string; email: string | null; verified: boolean }> = {};
  for (const s of pending ?? []) {
    const info = await pendingAdminInfo(admin, s.id);
    if (info) result[s.id] = { fullName: info.fullName, email: info.email, verified: info.verified };
  }
  return NextResponse.json({ pending: result });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id, action, code } = await req.json();
  if (!id || !["approve", "suspend", "reactivate"].includes(action)) {
    return NextResponse.json({ error: "id and a valid action are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: school } = await admin.from("schools").select("id, name, status, code").eq("id", id).maybeSingle();
  if (!school) return NextResponse.json({ error: "School not found." }, { status: 404 });

  let approvingAdmin: Awaited<ReturnType<typeof pendingAdminInfo>> = null;

  let patch: Record<string, unknown>;
  if (action === "approve") {
    if (school.status !== "pending") return NextResponse.json({ error: "Only a pending school can be approved." }, { status: 409 });
    // Never approve a school whose admin hasn't proven they own the email address.
    approvingAdmin = await pendingAdminInfo(admin, id);
    if (!approvingAdmin) return NextResponse.json({ error: "This school has no admin account." }, { status: 409 });
    if (!approvingAdmin.verified) return NextResponse.json({ error: "The admin hasn't confirmed their email yet, so this school can't be approved." }, { status: 409 });
    patch = { status: "active", approved_at: new Date().toISOString() };
    // The code can still be corrected while pending (it's locked after approval).
    if (typeof code === "string" && code.trim() && code.trim().toLowerCase() !== school.code) {
      const next = code.trim().toLowerCase();
      if (!validCode(next)) return NextResponse.json({ error: "That school code isn't valid." }, { status: 400 });
      const { data: taken } = await admin.from("schools").select("id").eq("code", next).maybeSingle();
      if (taken) return NextResponse.json({ error: "That school code is already used." }, { status: 409 });
      patch.code = next;
    }
  } else if (action === "suspend") {
    if (school.status !== "active") return NextResponse.json({ error: "Only an active school can be suspended." }, { status: 409 });
    patch = { status: "suspended" };
  } else {
    if (school.status !== "suspended") return NextResponse.json({ error: "Only a suspended school can be reactivated." }, { status: 409 });
    patch = { status: "active" };
  }

  const { data: updated, error } = await admin.from("schools").update(patch).eq("id", id).select("id, status, code").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Couldn't update the school." }, { status: 500 });

  await logAudit(admin, {
    actorId: guard.userId,
    actorEmail: guard.email,
    action: `school.${action}`,
    targetType: "school",
    targetId: id,
    schoolId: id,
    schoolName: school.name,
    details: {
      from_status: school.status,
      to_status: updated.status,
      code: updated.code,
      ...(updated.code !== school.code ? { code_changed_from: school.code } : {}),
    },
  });

  // Approval: tell the admin their school is live, with their own link.
  // Best effort — the owner is also handed the link to send by hand.
  let emailSent: boolean | null = null;
  let emailError: string | null = null;
  const link = `${req.nextUrl.origin}/s/${updated.code}`;
  if (action === "approve" && approvingAdmin?.email) {
    try {
      await sendMail({
        to: approvingAdmin.email,
        subject: `${school.name} is approved`,
        html: schoolApprovedEmailHtml({ schoolName: school.name, fullName: approvingAdmin.fullName, link }),
      });
      emailSent = true;
    } catch (err) {
      emailSent = false;
      emailError = err instanceof Error ? err.message : "mail error";
    }
  }

  // Suspending also ends everyone's sign-in at that school right now (teachers, students, the
  // principal). Without this their open pages would stay signed in until the sign-in expired.
  let signedOut: number | null = null;
  if (action === "suspend") {
    const { data: ended } = await admin.rpc("revoke_school_sessions", { p_school_id: id });
    signedOut = typeof ended === "number" ? ended : null;
  }

  return NextResponse.json({ school: updated, link, emailSent, emailError, adminEmail: approvingAdmin?.email ?? null, signedOut });
}

/**
 * DELETE — { id, confirmCode }: permanently erases a whole school and all of
 * its data. IRREVERSIBLE. The caller must type the school's own code (checked
 * again here and once more inside the database function), and it refuses while
 * an exam is in progress at that school — suspend it and wait, or let it finish.
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id, confirmCode } = await req.json().catch(() => ({}));
  if (!id || typeof confirmCode !== "string") return NextResponse.json({ error: "id and confirmCode are required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: school } = await admin.from("schools").select("id, name, code").eq("id", id).maybeSingle();
  if (!school) return NextResponse.json({ error: "School not found." }, { status: 404 });
  if (confirmCode.trim().toLowerCase() !== school.code) {
    return NextResponse.json({ error: "The code you typed doesn't match this school." }, { status: 400 });
  }

  const { count: live } = await admin.from("student_exam_sessions").select("id", { count: "exact", head: true }).eq("school_id", id).eq("status", "active");
  if ((live ?? 0) > 0) {
    return NextResponse.json({ error: "An exam is in progress at this school right now. Wait until it finishes, then try again." }, { status: 409 });
  }

  // The intent is recorded BEFORE anything is erased: if the record can't be written, nothing is deleted.
  const auditBase = { actorId: guard.userId, actorEmail: guard.email, targetType: "school", targetId: id, schoolId: id, schoolName: school.name };
  const started = await logAudit(admin, { ...auditBase, action: "school.delete_started", details: { code: school.code } });
  if (!started) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was deleted. Try again." }, { status: 500 });
  }

  try {
    const result = await deleteSchoolCompletely(admin, id, school.code);
    await logAudit(admin, { ...auditBase, action: "school.delete_completed", details: { code: school.code, counts: result.counts, files_removed: result.filesRemoved, files_cleanup_failed: result.filesFailed } });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    await logAudit(admin, { ...auditBase, action: "school.delete_failed", details: { code: school.code, error: message } });
    return NextResponse.json({ error: `Couldn't delete the school. Nothing was changed. (${message})` }, { status: 500 });
  }
}
