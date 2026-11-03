import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueAccessToken } from "@/lib/accessTokens";
import { sendMail } from "@/lib/mailer";
import { verifySchoolEmailHtml } from "@/lib/emailTemplates";
import { allow, clientIp } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { getPlatformFlags } from "@/lib/platformFlags";

/**
 * POST /api/schools/register — public self-signup for a new school.
 * body: { schoolName, code?, adminName, adminEmail, password }
 *
 * Creates, all at once:
 *   - the school, as PENDING (nobody can use it until the platform owner approves),
 *   - its first admin's account, BANNED from signing in until they confirm their
 *     email (so no one can register with someone else's address and get in),
 *   - a confirmation email link.
 * Nothing here activates a school; approval is a separate owner action.
 */

const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PENDING_PER_HOUR = 30; // last-resort flood guard across everyone; the owner still sees and approves each one
const MAX_SIGNUPS_PER_IP_PER_HOUR = 5;

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}

export async function POST(req: NextRequest) {
  // The owner can pause new school sign-ups (Owner console -> Controls). Checked first, on the server,
  // so closing the form on the page is never the only barrier.
  if (!(await getPlatformFlags()).signupsOpen) {
    return NextResponse.json({ error: "New school sign-ups are paused right now. Please check back later.", code: "signups_closed" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Honeypot: the form has a hidden "website" box that no person ever fills in. A bot that
  // fills in every field gives itself away: it is told it worked, and nothing is created.
  if (String(body.website ?? "").trim()) return NextResponse.json({ ok: true, emailSent: true });

  const ip = clientIp(req);
  const limiter = createAdminClient();
  if (ip && !(await allow(limiter, `register:${ip}`, MAX_SIGNUPS_PER_IP_PER_HOUR, 60 * 60))) {
    return NextResponse.json({ error: "Too many sign-up attempts from your connection. Please try again in about an hour." }, { status: 429 });
  }
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return NextResponse.json({ error: "We couldn't confirm you're a person. Please try again." }, { status: 400 });
  }

  const schoolName = String(body.schoolName ?? "").trim();
  const adminName = String(body.adminName ?? "").trim();
  const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const code = String(body.code ?? "").trim().toLowerCase() || slugify(schoolName);

  if (!schoolName) return NextResponse.json({ error: "Enter your school's name." }, { status: 400 });
  if (!CODE_RE.test(code) || code.length < 3 || code.length > 40) {
    return NextResponse.json({ error: "The school code must be 3–40 characters: lowercase letters, numbers and single dashes (e.g. bright-future)." }, { status: 400 });
  }
  if (!adminName) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  if (!EMAIL_RE.test(adminEmail)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use a password of at least 8 characters." }, { status: 400 });

  const admin = createAdminClient();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await admin.from("schools").select("id", { count: "exact", head: true }).eq("status", "pending").gte("created_at", since);
  if ((recent ?? 0) >= MAX_PENDING_PER_HOUR) {
    return NextResponse.json({ error: "We're getting a lot of sign-ups right now. Please try again in a little while." }, { status: 429 });
  }

  const { data: codeTaken } = await admin.from("schools").select("id").eq("code", code).maybeSingle();
  if (codeTaken) return NextResponse.json({ error: "That school code is already taken. Try a different one." }, { status: 409 });
  const { data: emailTaken } = await admin.from("users").select("id").eq("email", adminEmail).maybeSingle();
  if (emailTaken) return NextResponse.json({ error: "That email already has an account. Use a different email, or sign in." }, { status: 409 });

  const { data: school, error: schoolError } = await admin.from("schools").insert({ name: schoolName, code, status: "pending" }).select("id, name, code").single();
  if (schoolError || !school) return NextResponse.json({ error: schoolError?.message ?? "Couldn't register the school." }, { status: 500 });

  const undo = async (authUserId?: string) => {
    if (authUserId) await admin.auth.admin.deleteUser(authUserId); // cascades to its users row
    await admin.from("schools").delete().eq("id", school.id);
  };

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: false,
    ban_duration: "876000h", // ~100 years: lifted only when the email is confirmed
  });
  if (authError || !created.user) {
    await undo();
    return NextResponse.json({ error: authError?.message ?? "Couldn't create your account." }, { status: 500 });
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

  let emailSent = false;
  try {
    const { token, expiresInHours } = await issueAccessToken(admin, { userId: created.user.id, purpose: "verify" });
    const link = `${req.nextUrl.origin}/verify-school?token=${token}`;
    await sendMail({
      to: adminEmail,
      subject: `Confirm your email for ${school.name}`,
      html: verifySchoolEmailHtml({ schoolName: school.name, fullName: adminName, link, expiresInHours }),
    });
    emailSent = true;
  } catch {
    // The signup stands; the page offers a "resend" button.
  }

  return NextResponse.json({ ok: true, emailSent });
}
