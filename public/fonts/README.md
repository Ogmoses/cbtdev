# Fonts

Nothing is needed in this folder. The report-card PDF is built on the server, so its fonts live in
`/assets/fonts` (not here) — a `/fonts/...` URL from `public/` can't be used for server-side PDF rendering.

- `assets/fonts/LiberationSans-Regular.ttf`, `LiberationSans-Bold.ttf`: Liberation Sans 2.1.5 (SIL Open Font
  License; see `assets/fonts/LICENSE-Liberation.txt`). It covers Yoruba (ẹ ọ ṣ), Igbo (ị ụ ṅ) and Hausa (ɓ ɗ ƙ)
  letters and the tone marks that go on top of them, and has the same letter widths as Helvetica so the
  layout is unchanged.
- `lib/reportFonts.ts` registers them; `next.config.ts` (`outputFileTracingIncludes`) makes sure Vercel ships them
  with the report-card route. If the files are ever missing, the PDF still downloads using Helvetica (and the
  server log says so), it just can't draw those letters.
