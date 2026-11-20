/** How a score is written on a report card: one decimal place, or "N/A" when the score doesn't exist. */
export function formatScore(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "N/A" : value.toFixed(digits);
}
