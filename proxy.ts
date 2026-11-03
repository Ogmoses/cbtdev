import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformFlags } from "@/lib/platformFlags";

/**
 * Refreshes the Supabase auth cookie on every request (required for
 * @supabase/ssr — without this, sessions silently go stale) and redirects
 * signed-out visitors away from the three portals. Role-specific access
 * (e.g. a teacher hitting /admin) is still enforced by RLS + each page's
 * own checks — this only answers "is anyone signed in at all".
 *
 * MAINTENANCE MODE (migration 023): while the owner has it switched on, every page
 * sends visitors to /maintenance (and every API answers 503) EXCEPT:
 *   - the platform owner (always),
 *   - /login, /maintenance and two tiny public endpoints (so the owner can sign in
 *     and the screen can check whether maintenance is over),
 *   - a student who is in the middle of an exam: only the exam page and the exam
 *     APIs stay open for them, until they finish.
 * The switch is read at most every few seconds per server instance, and if it can't be
 * read the app stays open (see lib/platformFlags.ts). When maintenance is off, none of
 * this code runs beyond one cached flag check.
 *
 * Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`
 * (and the exported function from `middleware` to `proxy`) — this is that
 * file under its current name. The runtime is fixed to Node.js here,
 * which @supabase/ssr's cookie handling is fine with.
 */

/** Open to everyone while maintenance is on. */
const ALWAYS_OPEN = ["/maintenance", "/login", "/api/platform/status", "/api/server-time"];
/** Open only to a student who currently has a live exam. */
const LIVE_EXAM_PATHS = ["/student/exam/", "/api/exam-sessions/"];
/** A session counts as "in progress" only if it has been active in the last hour (a walked-away tab shouldn't keep the exemption forever). */
const LIVE_EXAM_MAX_IDLE_MS = 60 * 60 * 1000;
const ROLE_CACHE_MS = 30_000;

const roleCache = new Map<string, { role: string | null; at: number }>();

async function roleOf(userId: string): Promise<string | null> {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_CACHE_MS) return hit.role;
  try {
    const { data } = await createAdminClient().from("users").select("role").eq("id", userId).maybeSingle();
    const role = (data?.role as string | undefined) ?? null;
    roleCache.set(userId, { role, at: Date.now() });
    return role;
  } catch {
    return null;
  }
}

async function hasLiveExam(userId: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - LIVE_EXAM_MAX_IDLE_MS).toISOString();
    const { data } = await createAdminClient()
      .from("student_exam_sessions")
      .select("id")
      .eq("student_id", userId)
      .eq("status", "active")
      .gte("last_heartbeat_at", cutoff)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    // Can't tell: do not cut off a student who might be mid-exam.
    return true;
  }
}

/** May this request go through while maintenance is on? */
async function allowedDuringMaintenance(pathname: string, userId: string | null): Promise<boolean> {
  if (ALWAYS_OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  if (!userId) return false;
  const role = await roleOf(userId);
  if (role === "platform_owner") return true;
  if (role === "student" && LIVE_EXAM_PATHS.some((p) => pathname.startsWith(p))) return hasLiveExam(userId);
  return false;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: auth } = await supabase.auth.getUser();

  const isProtected = ["/admin", "/teacher", "/student", "/profile", "/owner"].some((p) => request.nextUrl.pathname.startsWith(p));
  if (isProtected && !auth.user) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  const flags = await getPlatformFlags();
  if (flags.maintenanceMode) {
    const pathname = request.nextUrl.pathname;
    if (!(await allowedDuringMaintenance(pathname, auth.user?.id ?? null))) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "The platform is under maintenance. Please try again shortly.", maintenance: true },
          { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } }
        );
      }
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
