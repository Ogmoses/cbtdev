import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeAccessToken, reasonMessage } from "@/lib/accessTokens";

/**
 * POST /api/auth/reset-password
 * body: { token: string, password: string }
 *
 * Public route — no session exists yet at this point. See
 * lib/accessTokens.ts for token validation and why it's only consumed on
 * submit, not on page load.
 */
export async function POST(req: NextRequest) {
  const { token, password } = await req.json();
  if (!token || !password) {
    return NextResponse.json({ error: "token and password are required." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Use at least 8 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await consumeAccessToken(admin, { token, purpose: "reset" });
  if (!result.ok) {
    return NextResponse.json({ error: reasonMessage(result.reason) }, { status: 400 });
  }

  const { error } = await admin.auth.admin.updateUserById(result.userId, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A reset should also end any sign-in that already exists on this account (migration 028).
  // Best effort: the password is already changed, so a hiccup here must not turn the reset into an error.
  await admin.rpc("revoke_user_sessions", { p_user_id: result.userId }).then(
    () => undefined,
    () => undefined
  );

  return NextResponse.json({ ok: true, email: result.email });
}
