import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueAccessToken } from "@/lib/accessTokens";
import { sendMail } from "@/lib/mailer";
import { resetEmailHtml } from "@/lib/emailTemplates";
import { allow, clientIp } from "@/lib/rateLimit";

/**
 * POST /api/auth/forgot-password — body: { email }
 *
 * Public: a teacher or school admin who has lost their password asks for a reset link.
 *
 * - It ALWAYS answers the same way, instantly, whether or not the address belongs to an account — so
 *   it can't be used to find out who has an account (not by the message, and not by how long it takes:
 *   the lookup and the email happen after the answer has gone out).
 * - Limits stop it being used to flood someone's inbox; over the limit it answers the same, but sends nothing.
 * - Only staff (school admin / teacher) of an ACTIVE school with an active account are sent a link.
 *   Students have no email and use their name + ID. The platform owner resets via the Supabase dashboard.
 * - The link is the existing reset link (lib/accessTokens.ts): valid 2 hours, one use, and the newest
 *   request cancels any older link.
 */
export async function POST(req: NextRequest) {
  const reply = NextResponse.json({ ok: true });
  const body = await req.json().catch(() => ({}));
  const address = String(body.email ?? "").trim().toLowerCase();
  if (!address || address.length > 254 || !address.includes("@")) return reply;

  const origin = req.nextUrl.origin;
  const ip = clientIp(req);
  const admin = createAdminClient();

  if (ip && !(await allow(admin, `forgot:${ip}`, 8, 60 * 60))) return reply;
  if (!(await allow(admin, `forgot-email:${address}`, 3, 60 * 60))) return reply;

  after(async () => {
    try {
      // Exact match, case-insensitive, with the pattern characters in the address (like "_") taken literally.
      const literal = address.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data: rows } = await admin
        .from("users")
        .select("id, full_name, role, is_active, school_id, schools(name, code, status)")
        .ilike("email", literal)
        .limit(1);
      const user = rows?.[0];
      const school = Array.isArray(user?.schools) ? user?.schools[0] : user?.schools;
      if (!user || !school) return;
      if (user.role !== "super_admin" && user.role !== "teacher") return;
      if (user.is_active === false || school.status !== "active") return;

      const { token, expiresInHours } = await issueAccessToken(admin, { userId: user.id as string, purpose: "reset" });
      const fromName = String(school.name).replace(/["\r\n]/g, " ").trim();
      await sendMail({
        to: address,
        subject: `Reset your password — ${school.name}`,
        fromName,
        html: resetEmailHtml({
          schoolName: school.name as string,
          fullName: user.full_name as string,
          link: `${origin}/reset-password?token=${token}&school=${school.code}`,
          expiresInHours,
          requestedBy: "self",
        }),
      });
    } catch (err) {
      console.error("[forgot-password] couldn't send:", err instanceof Error ? err.message : err);
    }
  });

  return reply;
}
