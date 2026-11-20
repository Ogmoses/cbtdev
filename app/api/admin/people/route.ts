import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveStudentPassword, studentInternalEmail } from "@/lib/studentCredential";
import { issueAccessToken } from "@/lib/accessTokens";
import { sendMail } from "@/lib/mailer";
import { inviteEmailHtml } from "@/lib/emailTemplates";
import { getSchoolNameServer } from "@/lib/schoolProfileServer";
import { getCallerContext } from "@/lib/auth/callerContext";
import { PHOTO_BUCKET } from "@/lib/studentPhotos";

/**
 * Admin-only account management for students and teachers.
 *   POST   — create an account.
 *            Students: log in with name + student ID alone (see
 *            lib/studentCredential.ts) — there's no separate password to
 *            generate or share, so the email a student account uses is
 *            just internal plumbing for Supabase Auth, synthesized from
 *            their student ID rather than collected from the admin.
 *            Teachers: the auth user is created directly with a random,
 *            never-shared password (locking the account, not handing it
 *            out), then a custom access token (see lib/accessTokens.ts) is
 *            emailed via our own SMTP — not Supabase's invite email — so
 *            the teacher sets their own real password at /set-password.
 *            This sidesteps Supabase Auth's invite links, which get
 *            silently consumed by school mail-scanners before the teacher
 *            ever clicks them.
 *   PATCH  — update profile fields, or toggle is_active.
 *   DELETE — deletes the Supabase Auth user, which cascades to their
 *            `users` row (see `users.id references auth.users(id) on delete
 *            cascade` in database/schema.sql).
 */

// Every action here is scoped to the ADMIN'S OWN school: this route uses the
// service-role client (which ignores RLS), so each query below filters by
// ctx.schoolId and each insert carries it.
const assertIsAdmin = () => getCallerContext({ roles: ["super_admin"], forbiddenMessage: "Only an admin can manage accounts." });

const CREATABLE_ROLES = ["student", "teacher", "super_admin"];

export async function POST(req: NextRequest) {
  const guard = await assertIsAdmin();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const { role, fullName, email, admissionNumber, staffId, classId } = await req.json();
  if (!role || !fullName?.trim()) {
    return NextResponse.json({ error: "role and fullName are required." }, { status: 400 });
  }
  if (!CREATABLE_ROLES.includes(role)) {
    return NextResponse.json({ error: "That role can't be created here." }, { status: 400 });
  }
  if (role !== "student" && !email?.trim()) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }
  if (role === "student" && !admissionNumber?.trim()) {
    return NextResponse.json({ error: "studentId is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  let authUserId: string;
  let studentEmail: string | undefined;

  if (role === "student") {
    studentEmail = studentInternalEmail(admissionNumber, ctx.schoolCode);
    const password = deriveStudentPassword(fullName, admissionNumber);
    const { data: created, error: authError } = await admin.auth.admin.createUser({ email: studentEmail, password, email_confirm: true });
    if (authError || !created.user) {
      return NextResponse.json({ error: authError?.message ?? "Couldn't create the account." }, { status: 500 });
    }
    authUserId = created.user.id;
  } else {
    // Teacher (or another admin): create the auth user directly with a
    // random password nobody is ever shown — it's immediately unusable,
    // just a placeholder Supabase Auth requires. The teacher's real
    // password gets set at /set-password, once we successfully email them
    // a token below.
    const lockedPassword = crypto.randomBytes(24).toString("base64url");
    const { data: created, error: authError } = await admin.auth.admin.createUser({ email, password: lockedPassword, email_confirm: true });
    if (authError || !created.user) {
      return NextResponse.json({ error: authError?.message ?? "Couldn't create the account." }, { status: 500 });
    }
    authUserId = created.user.id;
  }

  const { error: profileError } = await admin.from("users").insert({
    id: authUserId,
    school_id: ctx.schoolId,
    role,
    full_name: fullName,
    email: role === "student" ? studentEmail : email,
    admission_number: role === "student" ? admissionNumber || null : null,
    staff_id: role === "teacher" ? staffId || null : null,
    class_id: role === "student" ? classId || null : null,
    is_active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(authUserId); // roll back the orphaned auth user
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (role === "student") {
    return NextResponse.json({ id: authUserId, invited: false });
  }

  // Teacher: send the invite email now. If this fails, roll back the whole
  // account rather than leaving an admin thinking an invite went out when
  // it didn't — a retry from scratch is simpler than a half-created
  // account with no way in.
  try {
    const { token, expiresInHours } = await issueAccessToken(admin, { userId: authUserId, purpose: "invite" });
    const schoolName = await getSchoolNameServer(admin, ctx.schoolId);
    const link = `${req.nextUrl.origin}/set-password?token=${token}&school=${ctx.schoolCode}`;
    await sendMail({
      to: email,
      subject: `Set up your account at ${schoolName}`,
      html: inviteEmailHtml({ schoolName, fullName, link, expiresInHours }),
    });
  } catch (err) {
    await admin.auth.admin.deleteUser(authUserId);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't send the invite email." }, { status: 500 });
  }

  return NextResponse.json({ id: authUserId, invited: true });
}

export async function PATCH(req: NextRequest) {
  const guard = await assertIsAdmin();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const { id, fullName, email, admissionNumber, staffId, classId, isActive } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  // Must be someone in THIS admin's school — otherwise a guessed id from
  // another school would be editable.
  const { data: existing } = await admin.from("users").select("role, full_name, admission_number").eq("id", id).eq("school_id", ctx.schoolId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (fullName !== undefined) patch.full_name = fullName;
  if (admissionNumber !== undefined) patch.admission_number = admissionNumber || null;
  if (staffId !== undefined) patch.staff_id = staffId || null;
  if (classId !== undefined) patch.class_id = classId || null;
  if (isActive !== undefined) patch.is_active = isActive;

  const { error } = await admin.from("users").update(patch).eq("id", id).eq("school_id", ctx.schoolId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (email) {
    const { error: authError } = await admin.auth.admin.updateUserById(id, { email });
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });
    await admin.from("users").update({ email }).eq("id", id).eq("school_id", ctx.schoolId);
  }

  // A student's password is derived from name + student ID (see
  // lib/studentCredential.ts) — if either just changed, the password they
  // already know stops matching unless it's re-derived here too. Runs off
  // the merged (new-or-existing) values, so it's a harmless no-op when
  // neither field actually changed.
  if (existing?.role === "student" && (fullName !== undefined || admissionNumber !== undefined)) {
    const mergedName = fullName ?? existing.full_name;
    const mergedId = admissionNumber ?? existing.admission_number;
    if (mergedName && mergedId) {
      const { error: pwError } = await admin.auth.admin.updateUserById(id, {
        password: deriveStudentPassword(mergedName, mergedId),
      });
      if (pwError) return NextResponse.json({ error: pwError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = await assertIsAdmin();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: target } = await admin.from("users").select("id, photo_url").eq("id", id).eq("school_id", ctx.schoolId).maybeSingle();
  if (!target) return NextResponse.json({ error: "Person not found." }, { status: 404 });

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // a deleted student's passport photo goes with them (best effort: the account is already gone)
  if (target.photo_url && !/^https?:\/\//i.test(target.photo_url as string)) {
    await admin.storage.from(PHOTO_BUCKET).remove([target.photo_url as string]).then(() => undefined, () => undefined);
  }

  return NextResponse.json({ ok: true });
}
