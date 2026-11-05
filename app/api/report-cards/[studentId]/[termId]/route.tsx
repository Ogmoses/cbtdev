import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { buildReportCardData } from "@/lib/reportCard";
import ReportCardDocument from "@/components/reports/ReportCardDocument";
import { registerReportFonts } from "@/lib/reportFonts";

/**
 * GET /api/report-cards/[studentId]/[termId]?comment=...&principal=...
 *
 * Streams back a ready-to-print PDF. `comment` and `principal` are
 * optional query params (a GET request has no body) so a teacher's
 * per-student remark can be typed in the Report Cards screen without a
 * schema change for "where does the comment live".
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ studentId: string; termId: string }> }) {
  const { studentId, termId } = await params;
  const teacherComment = req.nextUrl.searchParams.get("comment") ?? undefined;
  const principalName = req.nextUrl.searchParams.get("principal") ?? undefined;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: caller } = await supabase.from("users").select("role").eq("id", auth.user.id).single();
  const isStaff = caller?.role === "teacher" || caller?.role === "super_admin";
  const isOwnRecord = auth.user.id === studentId;
  if (!isStaff && !isOwnRecord) {
    return NextResponse.json({ error: "You can't view this report card." }, { status: 403 });
  }

  try {
    const data = await buildReportCardData(supabase, studentId, termId, { teacherComment, principalName });
    // Liberation Sans (covers Yoruba / Igbo / Hausa letters); falls back to Helvetica if the font files are missing.
    const fontFamily = registerReportFonts();
    const pdfBuffer = await renderToBuffer(<ReportCardDocument data={data} fontFamily={fontFamily} />);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${data.studentName.replace(/\s+/g, "_")}_${data.termName.replace(/\s+/g, "_")}_report_card.pdf"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't generate the report card." }, { status: 500 });
  }
}
