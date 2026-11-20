import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/rateLimit";
import { staffIdLogin, type PasswordSignIn } from "@/lib/staffIdLogin";

/**
 * POST { schoolCode, staffId, password } — PUBLIC. A teacher signs in with their Teacher ID on their school's own page.
 * Answers { accessToken, refreshToken } (the page then starts the session itself) or a plain error. Never returns an email.
 */
const signIn: PasswordSignIn = async (email, password) => {
  // A throwaway client that doesn't keep any session of its own: we only want to know whether the password is right.
  const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    const limited = error?.status === 429 || (error as { code?: string } | null)?.code === "over_request_rate_limit" || /rate limit/i.test(error?.message ?? "");
    return { session: null, rateLimited: limited };
  }
  return { session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token }, rateLimited: false };
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const result = await staffIdLogin(createAdminClient(), signIn, { schoolCode: body.schoolCode, staffId: body.staffId, password: body.password, ip: clientIp(req) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ accessToken: result.accessToken, refreshToken: result.refreshToken }, { headers: { "Cache-Control": "no-store" } });
}
