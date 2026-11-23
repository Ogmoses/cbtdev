/**
 * Is a sitting (batch) open? One rule, used by the server and the pages so they can't disagree.
 *  - closed_at set      -> ended (the teacher closed it; he can reopen it)
 *  - before starts_at   -> upcoming
 *  - stays_open         -> open until the teacher closes it
 *  - otherwise          -> open until ends_at
 */
export interface BatchWindowFields {
  starts_at: string;
  ends_at: string;
  stays_open?: boolean | null;
  closed_at?: string | null;
}

export type BatchState = "upcoming" | "open" | "ended";

export function batchState(b: BatchWindowFields, now: Date | number = Date.now()): BatchState {
  const t = typeof now === "number" ? now : now.getTime();
  if (b.closed_at) return "ended";
  if (t < new Date(b.starts_at).getTime()) return "upcoming";
  if (b.stays_open) return "open";
  return t <= new Date(b.ends_at).getTime() ? "open" : "ended";
}

/** A little slack past a student's own deadline for the final auto-save / auto-submit to arrive over a slow connection. */
export const SESSION_GRACE_MS = 60_000;
