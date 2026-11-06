/**
 * Billing rules shared by the server (proxy, cron, APIs) and the owner screen, so they can never disagree.
 *
 * A school is LOCKED when its subscription_status is 'expired' (the owner's manual lock) OR its term_ends_at has passed.
 * No end date (null) means the term never runs out on its own.
 */
export type SubscriptionStatus = "trial" | "active" | "expired";

export interface SubscriptionRow {
  subscription_status: string | null;
  term_ends_at: string | null;
}

export const REMINDER_DAYS = 7;

export function isLocked(row: SubscriptionRow, now: number = Date.now()): boolean {
  if (row.subscription_status === "expired") return true;
  return !!row.term_ends_at && new Date(row.term_ends_at).getTime() <= now;
}

/** What to show the owner: 'expired' also when only the date has passed (the daily job may not have flipped the stored value yet). */
export function effectiveStatus(row: SubscriptionRow, now: number = Date.now()): SubscriptionStatus {
  if (isLocked(row, now)) return "expired";
  return row.subscription_status === "trial" ? "trial" : "active";
}

/** Whole days from now to the end date (negative once it has passed), or null when there is no end date. */
export function daysUntilEnd(row: SubscriptionRow, now: number = Date.now()): number | null {
  if (!row.term_ends_at) return null;
  return Math.ceil((new Date(row.term_ends_at).getTime() - now) / 86_400_000);
}
