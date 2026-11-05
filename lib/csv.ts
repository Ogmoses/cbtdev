/**
 * CSV for spreadsheets (Excel, Google Sheets, Numbers).
 * - A UTF-8 byte-order mark goes at the start of each file so Excel shows names like "Ṣẹ̀yìndé Ọláwálé" correctly.
 * - Text that begins with = + - @ (or a tab / carriage return) gets a leading apostrophe, so a student can't get a
 *   spreadsheet to run a formula by typing one as their name ("CSV injection"). Numbers are left alone.
 */
export const CSV_BOM = "\uFEFF";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}
