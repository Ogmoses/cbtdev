import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allow, clientIp } from "@/lib/rateLimit";
import { respondEmailChange } from "@/lib/emailChange";

/** POST { token, decision: "approve" | "decline" } — PUBLIC (the secret link is the credential). Approves or declines this side of the change. */
export async function POST(req: NextRequest) {
  const admin = createAdminClient();
  const ip = clientIp(req);
  if (ip && !(await allow(admin, `emailchange-link:${ip}`, 60, 3600))) return NextResponse.json({ error: "Too many attempts. Please wait a while." }, { status: 429 });

  const { token, decision } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || (decision !== "approve" && decision !== "decline")) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const result = await respondEmailChange(admin, token, decision, req.nextUrl.origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
