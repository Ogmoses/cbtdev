import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReportCardData } from "@/lib/reportCard";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedPhotoUrl } from "@/lib/studentPhotos";

/**
 * GET /api/report-cards/[studentId]/[termId]/data?comment=...&principal=...
 * Same data as the PDF route, as JSON — used by the print-preview page so
 * it can render ReportCardPrintView without asking the browser to parse a
 * PDF response.
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
  if (!isStaff && auth.user.id !== studentId) {
    return NextResponse.json({ error: "You can't view this report card." }, { status: 403 });
  }

  try {
    // The report card was already authorised above and its student row read under the caller's own permissions, so the photo may now be signed.
    const admin = createAdminClient();
    const data = await buildReportCardData(supabase, studentId, termId, { teacherComment, principalName, resolvePhoto: (stored) => signedPhotoUrl(admin, stored) });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't load this report card." }, { status: 500 });
  }
}
