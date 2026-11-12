import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allow, clientIp } from "@/lib/rateLimit";
import { lookupEmailChange } from "@/lib/emailChange";

/**
 * POST { token } — PUBLIC. What the confirmation page shows for a link from an email. A POST that changes nothing:
 * opening the link itself (by a person or a mail scanner) never approves or uses up anything.
 */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const ip = clientIp(req);
  if (ip && !(await allow(admin, `emailchange-link:${ip}`, 60, 3600))) return NextResponse.json({ error: "Too many attempts. Please wait a while." }, { status: 429 });

  const { token } = await req.json().catch(() => ({}));
  const info = typeof token === "string" ? await lookupEmailChange(admin, token) : null;
  if (!info) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
