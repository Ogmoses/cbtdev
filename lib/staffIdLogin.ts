import type { SupabaseClient } from "@supabase/supabase-js";
import { allow } from "@/lib/rateLimit";

/**
 * Teacher ID sign-in (server only): a teacher types their Teacher ID + password on THEIR school's own sign-in page.
 *
 * The server finds the teacher by ID inside that school, checks the password with the login system, and hands back only
 * the session tokens. The teacher's EMAIL is never sent to the browser, so a stranger who guesses IDs can't harvest
 * email addresses; every failure (unknown school, unknown ID, inactive teacher, wrong password) gives the SAME message and
 * takes about as long. Attempts are limited per connection and per account.
 */
export const GENERIC_ERROR = "Incorrect Teacher ID or password.";

export type PasswordSignIn = (email: string, password: string) => Promise<{ session: { access_token: string; refresh_token: string } | null; rateLimited: boolean }>;
export type StaffIdLoginResult = { ok: true; accessToken: string; refreshToken: string } | { ok: false; status: number; error: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function staffIdLogin(
  admin: SupabaseClient,
  signIn: PasswordSignIn,
  input: { schoolCode: unknown; staffId: unknown; password: unknown; ip: string | null },
  delay: (ms: number) => Promise<void> = sleep
): Promise<StaffIdLoginResult> {
  const schoolCode = typeof input.schoolCode === "string" ? input.schoolCode.trim().toLowerCase() : "";
  const staffId = typeof input.staffId === "string" ? input.staffId.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!schoolCode || !staffId || !password || schoolCode.length > 100 || staffId.length > 64 || password.length > 200) {
    return { ok: false, status: 400, error: "Enter your Teacher ID and password." };
  }

  if (input.ip && !(await allow(admin, `staffid:${input.ip}`, 30, 600))) return { ok: false, status: 429, error: "Too many attempts. Please wait a few minutes and try again." };
  if (!(await allow(admin, `staffid-acct:${schoolCode}:${staffId.toLowerCase()}`, 8, 600))) return { ok: false, status: 429, error: "Too many attempts for this Teacher ID. Please wait a few minutes and try again." };

  const failLikeABadPassword = async (): Promise<StaffIdLoginResult> => {
    await delay(200 + Math.floor(Math.random() * 150)); // roughly the time a real password check takes
    return { ok: false, status: 401, error: GENERIC_ERROR };
  };

  const { data: school } = await admin.from("schools").select("id, status").eq("code", schoolCode).maybeSingle();
  if (!school || school.status !== "active") return failLikeABadPassword();

  // Exact match, case-insensitive, with "_" and "%" in the ID taken literally.
  const literal = staffId.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: rows } = await admin
    .from("users")
    .select("email, is_active")
    .eq("school_id", school.id)
    .eq("role", "teacher")
    .ilike("staff_id", literal)
    .limit(1);
  const teacher = rows?.[0];
  if (!teacher || teacher.is_active === false || !teacher.email) return failLikeABadPassword();

  const result = await signIn(teacher.email as string, password);
  if (result.rateLimited) return { ok: false, status: 429, error: "Sign-in is busy right now. Please try again in a few minutes, or sign in with your email." };
  if (!result.session) return { ok: false, status: 401, error: GENERIC_ERROR };
  return { ok: true, accessToken: result.session.access_token, refreshToken: result.session.refresh_token };
}
