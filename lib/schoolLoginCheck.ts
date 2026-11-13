/**
 * Decides whether a person who has just signed in may stay signed in on THIS sign-in page.
 *
 * - On a school's own link (/s/<code>) the account must belong to that school: a teacher or admin of another
 *   school who types their (correct) email and password there is turned away. (Students are already tied to the
 *   link: their ID is only looked up inside that school.)
 * - The platform owner has no school, so is let through (and is often sent to a remembered school link from /login).
 * - The plain /login page (no school code) stays the general entry: no school is required there.
 * - A pending or suspended school can't be used.
 *
 * Returns the message to show (the caller then signs the person out), or null when it's fine.
 * This keeps each school's link meaning "this school's people only". It is not what protects the data: that is the
 * database's own per-school rules, which stay in force no matter which page someone signed in on.
 */
export interface OwnSchool {
  code: string;
  status: string;
}

export const WRONG_SCHOOL_MESSAGE = "This account belongs to a different school. Please sign in from your own school's link.";

export function schoolLoginProblem(own: OwnSchool | null, linkSchoolCode?: string): string | null {
  if (!own) return null; // platform owner (no school)
  if (linkSchoolCode && own.code.toLowerCase() !== linkSchoolCode.trim().toLowerCase()) return WRONG_SCHOOL_MESSAGE;
  if (own.status === "pending") return "Your school is still waiting for approval. We'll email you when it's ready.";
  if (own.status !== "active") return "This school's access is currently paused. Please contact your administrator.";
  return null;
}
