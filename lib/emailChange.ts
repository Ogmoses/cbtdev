import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMail } from "@/lib/mailer";
import { logAudit } from "@/lib/owner/audit";
import { allow } from "@/lib/rateLimit";
import { getBillingContact } from "@/lib/billingServer";
import {
  emailChangeApproveOldHtml,
  emailChangeConfirmNewHtml,
  emailChangedNoticeOldHtml,
  emailChangedNoticeNewHtml,
  emailChangeDeclinedHtml,
} from "@/lib/emailTemplates";

/**
 * Changing a school admin's sign-in email — server only (migration 032).
 *
 * The change happens only when BOTH the current address and the proposed address have approved, each through its own
 * single-use link. Links only OPEN a page; nothing is approved until a button is pressed (a POST), so a school mail
 * scanner that opens every link can't approve anything or use the link up. Only SHA-256 hashes of the secrets are
 * stored. The two places an email lives (the login system and the users table) are changed together and rolled back
 * together; afterwards the person is signed out everywhere.
 */
export const EMAIL_CHANGE_TTL_HOURS = 24;

type Row = Record<string, unknown>;

const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");

export function normalizeEmail(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** "jane.doe@school.edu" -> "j*****@school.edu": enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user[0] ?? ""}${"*".repeat(Math.max(1, Math.min(user.length - 1, 6)))}@${domain}`;
}

const safeName = (s: string) => s.replace(/["\r\n]/g, " ").trim();

/** Is this address already on some account? (case-insensitive, with "_" and "%" taken literally) */
async function emailInUse(admin: SupabaseClient, email: string, exceptUserId?: string): Promise<boolean> {
  const literal = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  let q = admin.from("users").select("id").ilike("email", literal).limit(1);
  if (exceptUserId) q = q.neq("id", exceptUserId);
  const { data } = await q;
  return (data?.length ?? 0) > 0;
}

export interface ChangeUser {
  id: string;
  fullName: string;
  email: string;
  schoolId: string;
}

// ------------------------------------------------------------------------------------------------ request
export async function startEmailChange(
  admin: SupabaseClient,
  p: { user: ChangeUser; schoolName: string; newEmailRaw: unknown; origin: string }
): Promise<{ ok: true; expiresAt: string } | { ok: false; status: number; error: string }> {
  const newEmail = normalizeEmail(p.newEmailRaw);
  if (!newEmail) return { ok: false, status: 400, error: "Enter a valid email address." };
  const oldEmail = p.user.email.trim().toLowerCase();
  if (newEmail === oldEmail) return { ok: false, status: 400, error: "That is already your email address." };

  if (!(await allow(admin, `emailchange:${p.user.id}`, 3, 3600))) return { ok: false, status: 429, error: "You've asked to change your email several times in the last hour. Please wait a while." };
  if (!(await allow(admin, `emailchange-to:${newEmail}`, 2, 86400))) return { ok: false, status: 429, error: "Too many confirmation emails have already been sent to that address today." };

  if (await emailInUse(admin, newEmail, p.user.id)) return { ok: false, status: 409, error: "That email address is already used by another account." };

  const id = crypto.randomUUID();
  const oldToken = newToken();
  const newTokenValue = newToken();
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_HOURS * 3600_000).toISOString();

  const audited = await logAudit(admin, {
    actorId: p.user.id,
    actorEmail: maskEmail(oldEmail),
    action: "account.email_change_requested",
    targetType: "email_change",
    targetId: id,
    schoolId: p.user.schoolId,
    schoolName: p.schoolName,
    details: { from: maskEmail(oldEmail), to: maskEmail(newEmail) },
  });
  if (!audited) return { ok: false, status: 500, error: "Couldn't record the request, so nothing was sent. Please try again." };

  // a new request replaces any earlier pending one
  await admin.from("email_change_requests").update({ status: "cancelled" }).eq("user_id", p.user.id).eq("status", "pending");
  const { error: insertError } = await admin.from("email_change_requests").insert({
    id,
    user_id: p.user.id,
    school_id: p.user.schoolId,
    old_email: oldEmail,
    new_email: newEmail,
    old_token_hash: hashToken(oldToken),
    new_token_hash: hashToken(newTokenValue),
    expires_at: expiresAt,
  });
  if (insertError) return { ok: false, status: 500, error: "Couldn't start the request. Please try again." };

  const fromName = safeName(p.schoolName);
  try {
    await sendMail({
      to: oldEmail,
      subject: `Approve changing your email? — ${p.schoolName}`,
      fromName,
      html: emailChangeApproveOldHtml({ schoolName: p.schoolName, fullName: p.user.fullName, oldEmail, newEmail, link: `${p.origin}/confirm-email-change?token=${oldToken}`, expiresInHours: EMAIL_CHANGE_TTL_HOURS }),
    });
    await sendMail({
      to: newEmail,
      subject: `Confirm your new email address — ${p.schoolName}`,
      fromName,
      html: emailChangeConfirmNewHtml({ schoolName: p.schoolName, fullName: p.user.fullName, newEmail, link: `${p.origin}/confirm-email-change?token=${newTokenValue}`, expiresInHours: EMAIL_CHANGE_TTL_HOURS }),
    });
  } catch {
    await admin.from("email_change_requests").update({ status: "cancelled" }).eq("id", id);
    return { ok: false, status: 502, error: "We couldn't send the emails. Check the new address and try again." };
  }
  return { ok: true, expiresAt };
}

// ------------------------------------------------------------------------------------------------ status / cancel (the admin's own)
export async function getPendingEmailChange(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from("email_change_requests")
    .select("id, new_email, old_approved_at, new_approved_at, expires_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return null;
  return { newEmail: data.new_email as string, oldApproved: !!data.old_approved_at, newApproved: !!data.new_approved_at, expiresAt: data.expires_at as string };
}

export async function cancelEmailChange(admin: SupabaseClient, user: ChangeUser, schoolName: string): Promise<boolean> {
  const { data } = await admin.from("email_change_requests").select("id").eq("user_id", user.id).eq("status", "pending").maybeSingle();
  if (!data) return false;
  await logAudit(admin, { actorId: user.id, actorEmail: maskEmail(user.email), action: "account.email_change_cancelled", targetType: "email_change", targetId: data.id as string, schoolId: user.schoolId, schoolName });
  await admin.from("email_change_requests").update({ status: "cancelled" }).eq("id", data.id).eq("status", "pending");
  return true;
}

// ------------------------------------------------------------------------------------------------ the two links
async function findByToken(admin: SupabaseClient, token: string): Promise<{ row: Row; side: "old" | "new" } | null> {
  if (!token || token.length > 200) return null;
  const h = hashToken(token);
  const { data: old } = await admin.from("email_change_requests").select("*").eq("old_token_hash", h).maybeSingle();
  if (old) return { row: old as Row, side: "old" };
  const { data: neu } = await admin.from("email_change_requests").select("*").eq("new_token_hash", h).maybeSingle();
  if (neu) return { row: neu as Row, side: "new" };
  return null;
}

async function expireIfDue(admin: SupabaseClient, row: Row): Promise<Row> {
  if (row.status === "pending" && new Date(row.expires_at as string).getTime() <= Date.now()) {
    await admin.from("email_change_requests").update({ status: "expired" }).eq("id", row.id).eq("status", "pending");
    return { ...row, status: "expired" };
  }
  return row;
}

async function names(admin: SupabaseClient, row: Row) {
  const [{ data: school }, { data: user }] = await Promise.all([
    admin.from("schools").select("name, code").eq("id", row.school_id).maybeSingle(),
    admin.from("users").select("full_name").eq("id", row.user_id).maybeSingle(),
  ]);
  return { schoolName: (school?.name as string | undefined) ?? "your school", schoolCode: (school?.code as string | undefined) ?? "", fullName: (user?.full_name as string | undefined) ?? "there" };
}

/** What the confirmation page shows. Never changes anything. */
export async function lookupEmailChange(admin: SupabaseClient, token: string) {
  const found = await findByToken(admin, token);
  if (!found) return null;
  const row = await expireIfDue(admin, found.row);
  const { schoolName, fullName } = await names(admin, row);
  const side = found.side;
  return {
    side,
    status: row.status as string,
    schoolName,
    fullName,
    // the new address's owner may be someone else: don't show them the whole current address
    oldEmail: side === "old" ? (row.old_email as string) : maskEmail(row.old_email as string),
    newEmail: row.new_email as string,
    iApproved: !!(side === "old" ? row.old_approved_at : row.new_approved_at),
    otherApproved: !!(side === "old" ? row.new_approved_at : row.old_approved_at),
    expiresAt: row.expires_at as string,
  };
}

export type RespondResult =
  | { ok: true; outcome: "waiting" | "completed" | "declined" }
  | { ok: false; status: number; error: string };

const STATUS_MESSAGE: Record<string, string> = {
  completed: "This change has already been completed.",
  declined: "This request was declined.",
  cancelled: "This request was cancelled.",
  expired: "This request has expired. Please start again from your profile.",
  failed: "This request could not be completed. Please start again from your profile.",
};

export async function respondEmailChange(admin: SupabaseClient, token: string, decision: "approve" | "decline", origin: string): Promise<RespondResult> {
  const found = await findByToken(admin, token);
  if (!found) return { ok: false, status: 404, error: "This link isn't valid." };
  const { side } = found;
  let row = await expireIfDue(admin, found.row);
  if (row.status !== "pending") return { ok: false, status: 409, error: STATUS_MESSAGE[row.status as string] ?? "This request is no longer active." };

  const { schoolName, schoolCode, fullName } = await names(admin, row);
  const userId = row.user_id as string;
  const schoolId = row.school_id as string;
  const oldEmail = row.old_email as string;
  const newEmail = row.new_email as string;
  const auditBase = { actorId: userId, actorEmail: maskEmail(oldEmail), targetType: "email_change", targetId: row.id as string, schoolId, schoolName };
  const fromName = safeName(schoolName);

  // ---- decline
  if (decision === "decline") {
    const { data: done } = await admin.from("email_change_requests").update({ status: "declined" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!done?.length) return { ok: false, status: 409, error: "This request is no longer active." };
    await logAudit(admin, { ...auditBase, action: "account.email_change_declined", details: { by: side, from: maskEmail(oldEmail), to: maskEmail(newEmail) } });
    if (side === "new") {
      try {
        await sendMail({ to: oldEmail, subject: `Email change not completed — ${schoolName}`, fromName, html: emailChangeDeclinedHtml({ schoolName, fullName, newEmail, reason: "was declined by the new address" }) });
      } catch {
        // the request is already closed; a failed courtesy email changes nothing
      }
    }
    return { ok: true, outcome: "declined" };
  }

  // ---- approve (this side only; safe to press twice)
  const col = side === "old" ? "old_approved_at" : "new_approved_at";
  const { data: marked } = await admin.from("email_change_requests").update({ [col]: new Date().toISOString() }).eq("id", row.id).eq("status", "pending").is(col, null).select("id");
  if (marked?.length) {
    await logAudit(admin, { ...auditBase, action: "account.email_change_approved", details: { by: side } });
  }

  const { data: fresh } = await admin.from("email_change_requests").select("*").eq("id", row.id).maybeSingle();
  row = (fresh as Row) ?? row;
  if (!row.old_approved_at || !row.new_approved_at) return { ok: true, outcome: "waiting" };

  // ---- both agreed: one caller claims the job, so it can only ever be applied once
  const { data: claimed } = await admin
    .from("email_change_requests")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .not("old_approved_at", "is", null)
    .not("new_approved_at", "is", null)
    .select("id");
  if (!claimed?.length) return { ok: true, outcome: "waiting" };

  const fail = async (reason: string): Promise<RespondResult> => {
    await admin.from("email_change_requests").update({ status: "failed" }).eq("id", row.id);
    await logAudit(admin, { ...auditBase, action: "account.email_change_failed", details: { reason } });
    try {
      await sendMail({ to: oldEmail, subject: `Email change not completed — ${schoolName}`, fromName, html: emailChangeDeclinedHtml({ schoolName, fullName, newEmail, reason: "could not be completed" }) });
    } catch {
      // nothing more to do
    }
    return { ok: false, status: 409, error: "We couldn't complete the change, so nothing was changed. Please start again from your profile." };
  };

  // nothing may have moved since the request was made
  const { data: current } = await admin.from("users").select("email").eq("id", userId).maybeSingle();
  if (!current || String(current.email).toLowerCase() !== oldEmail) return fail("the account's email changed after the request was made");
  if (await emailInUse(admin, newEmail, userId)) return fail("the new address is now used by another account");

  const authUpdate = await admin.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
  if (authUpdate.error) return fail("the login system refused the change");
  const { error: rowError } = await admin.from("users").update({ email: newEmail }).eq("id", userId);
  if (rowError) {
    await admin.auth.admin.updateUserById(userId, { email: oldEmail, email_confirm: true }); // put it back: the two places must agree
    return fail("the account record could not be updated");
  }

  // end every existing sign-in: whoever was signed in must sign in again with the new address
  await admin.rpc("revoke_user_sessions", { p_user_id: userId }).then(
    () => undefined,
    () => undefined
  );
  await logAudit(admin, { ...auditBase, action: "account.email_changed", details: { from: maskEmail(oldEmail), to: maskEmail(newEmail) } });

  const contact = await getBillingContact(admin).catch(() => null);
  const signIn = `${origin}/s/${schoolCode}`;
  try {
    await sendMail({ to: oldEmail, subject: `Your sign-in email was changed — ${schoolName}`, fromName, html: emailChangedNoticeOldHtml({ schoolName, fullName, newEmail, contactEmail: contact?.email ?? null, contactPhone: contact?.phone ?? null }) });
  } catch {
    /* notice only */
  }
  try {
    await sendMail({ to: newEmail, subject: `Your new email is ready — ${schoolName}`, fromName, html: emailChangedNoticeNewHtml({ schoolName, fullName, link: signIn }) });
  } catch {
    /* notice only */
  }
  return { ok: true, outcome: "completed" };
}
