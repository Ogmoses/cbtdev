import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allow, isBlocked, clientIp } from "@/lib/rateLimit";

/**
 * POST /api/auth/resolve-student-email
 * body: { studentId: string, schoolCode?: string }
 *
 * Student IDs are only unique WITHIN a school, so once more than one school
 * exists the school must be known: pass `schoolCode` (the code in the
 * /s/<code> login URL). Without it, the lookup only succeeds while exactly
 * one school has a matching ID; if several do, the student is asked to use
 * their own school's link.
 *
 * Runs before the student is signed in, so RLS (which keys off auth.uid())
 * can't help here — this uses the service-role client instead, and
 * deliberately returns nothing but the email on success, and a generic
 * error on failure, so it can't be used to enumerate valid student IDs
 * or leak anything else about the account.
 */
// Wrong guesses per visitor in 10 minutes. Only MISSES are counted, never successful
// sign-ins, because a whole class often shares one school Wi-Fi address.
const MAX_MISSES = 100;
const MISS_WINDOW_SECONDS = 10 * 60;

export async function POST(req: NextRequest) {
  const { studentId, schoolCode } = await req.json();
  if (!studentId?.trim()) {
    return NextResponse.json({ error: "Enter your student ID." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const ip = clientIp(req);
  if (ip && (await isBlocked(supabase, `lookup-miss:${ip}`, MAX_MISSES, MISS_WINDOW_SECONDS))) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }
  // A miss is counted, then answered the same generic way every time.
  const miss = async () => {
    if (ip) await allow(supabase, `lookup-miss:${ip}`, MAX_MISSES, MISS_WINDOW_SECONDS);
    return NextResponse.json({ error: "We couldn't find that student ID." }, { status: 404 });
  };

  // Exact match on the ID (ignoring capitals only) — see migration 019. A pattern match here once let
  // someone type a wildcard like "%" and match every student.
  const { data: matches } = await supabase.rpc("resolve_student_login", {
    p_student_id: studentId,
    p_school_code: typeof schoolCode === "string" && schoolCode.trim() ? schoolCode : null,
  });

  // No such ID, or no such school code — the same generic answer either way, so codes can't be probed.
  if (!matches || matches.length === 0 || !matches[0].email) return miss();
  if (matches.length > 1) {
    return NextResponse.json({ error: "Please sign in from your school's own link." }, { status: 409 });
  }

  return NextResponse.json({ email: matches[0].email });
}
