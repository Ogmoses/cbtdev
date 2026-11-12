import { NextRequest, NextResponse } from "next/server";
import { requireSchoolAdmin } from "@/lib/schoolAdmin";
import { cancelEmailChange, getPendingEmailChange, startEmailChange } from "@/lib/emailChange";

/** GET — is there a pending email change for the signed-in school admin, and who has approved so far? */
export async function GET() {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  return NextResponse.json({ pending: await getPendingEmailChange(ctx.admin, ctx.user.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** POST { newEmail } — ask to change the email. Sends an approval email to the current address AND a confirmation email to the new one. */
export async function POST(req: NextRequest) {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  const { newEmail } = await req.json().catch(() => ({}));
  const result = await startEmailChange(ctx.admin, { user: ctx.user, schoolName: ctx.schoolName, newEmailRaw: newEmail, origin: req.nextUrl.origin });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
}

/** DELETE — cancel the pending request. */
export async function DELETE() {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  const cancelled = await cancelEmailChange(ctx.admin, ctx.user, ctx.schoolName);
  return NextResponse.json({ ok: true, cancelled });
}
