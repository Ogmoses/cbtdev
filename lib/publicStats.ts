import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The few totals shown on the public landing page (/welcome): schools, students, exams, exams taken.
 * Only counts — no names, no school or student details — read with the service role (visitors aren't signed in)
 * and remembered for ten minutes per server instance so a busy landing page never hammers the database.
 * If anything fails, `null` is returned and the page simply leaves the numbers out.
 */
export interface PublicStats {
  schools: number;
  students: number;
  exams: number;
  examsTaken: number;
}

const FRESH_MS = 10 * 60_000;
let cache: { at: number; stats: PublicStats | null } | null = null;

export async function getPublicStats(): Promise<PublicStats | null> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache.stats;
  let stats: PublicStats | null = null;
  try {
    const admin = createAdminClient();
    const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count: n, error } = await query;
      if (error) throw new Error("count failed");
      return n ?? 0;
    };
    const [schools, students, exams, examsTaken] = await Promise.all([
      count(admin.from("schools").select("id", { count: "exact", head: true }).eq("status", "active")),
      count(admin.from("users").select("id", { count: "exact", head: true }).eq("role", "student")),
      count(admin.from("exams").select("id", { count: "exact", head: true })),
      count(admin.from("student_exam_sessions").select("id", { count: "exact", head: true }).not("submitted_at", "is", null)),
    ]);
    stats = { schools, students, exams, examsTaken };
  } catch {
    stats = null;
  }
  cache = { at: Date.now(), stats };
  return stats;
}
