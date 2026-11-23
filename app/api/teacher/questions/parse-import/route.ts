import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { createClient } from "@/lib/supabase/server";
import { parseQuestionText, parseCsvQuestions, DIAGRAM_MARKER } from "@/lib/questionImportParser";
import { mammothHtmlToText } from "@/lib/mammothHtmlToText";

/**
 * POST /api/teacher/questions/parse-import
 * multipart/form-data: { file: File }
 *
 * Read-only — parses an uploaded .docx or .csv into draft questions and
 * returns them for review. Nothing is written to the database here; the
 * teacher reviews and picks each correct answer client-side afterward,
 * then the existing per-question create flow
 * (app/teacher/questions/page.tsx's handleCreate, used in a loop) saves
 * them through the browser's own Supabase client, under the same RLS
 * rules as creating a question by hand — this route's only job is
 * turning a file into that same shape of data.
 *
 * mammoth needs actual Node APIs (Buffer, etc.), so this route runs on
 * the default Node.js runtime, not the Edge runtime — fine for an app
 * route unless explicitly opted into edge elsewhere.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });

  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    if (name.endsWith(".docx")) {
      // The alt text here is what mammothHtmlToText looks for to place
      // DIAGRAM_MARKER at exactly the right spot in the extracted text —
      // src is left empty on purpose, the image itself is never needed.
      const { value: html } = await mammoth.convertToHtml(
        { buffer },
        { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "", alt: DIAGRAM_MARKER })) }
      );
      const text = mammothHtmlToText(html);
      const result = parseQuestionText(text);
      return NextResponse.json(result);
    }

    if (name.endsWith(".csv")) {
      const text = buffer.toString("utf-8");
      const result = parseCsvQuestions(text);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Upload a .docx or .csv file." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read that file." }, { status: 500 });
  }
}
