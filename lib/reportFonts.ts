import fs from "fs";
import path from "path";
import { Font } from "@react-pdf/renderer";

/**
 * Fonts for the report-card PDF (SERVER ONLY — it reads files from disk).
 *
 * react-pdf's built-in Helvetica only covers Latin-1, so letters like Yoruba "ẹ ọ ṣ", Igbo "ị ụ ṅ" and
 * Hausa "ɓ ɗ ƙ" (and tone marks on top of them) did not print. Liberation Sans does cover them and has
 * the same letter widths as Helvetica/Arial, so the report-card layout does not move. It is bundled in
 * /assets/fonts (SIL Open Font License, see LICENSE-Liberation.txt there) and included in the server
 * function by `outputFileTracingIncludes` in next.config.ts.
 *
 * Returns the font family the document should use. If the font files are somehow missing it logs the
 * problem and falls back to Helvetica, so a report card is still produced (just without those letters)
 * instead of the download failing.
 */
export const REPORT_FONT_FAMILY = "LiberationSans";

let registered = false;

export function registerReportFonts(): string {
  const dir = path.join(process.cwd(), "assets", "fonts");
  const regular = path.join(dir, "LiberationSans-Regular.ttf");
  const bold = path.join(dir, "LiberationSans-Bold.ttf");

  if (!fs.existsSync(regular) || !fs.existsSync(bold)) {
    console.error("[report-card] font files not found in", dir, "- falling back to Helvetica (non-Latin-1 letters won't print)");
    return "Helvetica";
  }

  if (!registered) {
    Font.register({
      family: REPORT_FONT_FAMILY,
      fonts: [
        { src: regular, fontWeight: 400 },
        { src: bold, fontWeight: 600 }, // the document asks for 600 and 700: both are the bold face
        { src: bold, fontWeight: 700 },
      ],
    });
    // Never hyphenate: a hyphen break could land between a letter and its accent mark, and names shouldn't be split anyway.
    Font.registerHyphenationCallback((word) => [word]);
    registered = true;
  }
  return REPORT_FONT_FAMILY;
}
