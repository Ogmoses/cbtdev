import { NextRequest, NextResponse } from "next/server";
import { requireSchoolAdmin } from "@/lib/schoolAdmin";
import { allow } from "@/lib/rateLimit";
import { getStudentPhoto, removeStudentPhoto, saveStudentPhoto, MAX_PHOTO_BYTES } from "@/lib/studentPhotoAdmin";

/**
 * A school admin's student passport photos. Only for students of the admin's OWN school (the school comes from their
 * login, never from the request). GET ?studentId= -> { url } (a link that works for an hour, for the preview);
 * POST multipart (studentId, file) saves a JPEG; DELETE { studentId } removes it.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  const r = await getStudentPhoto(ctx.admin, ctx.user.schoolId, req.nextUrl.searchParams.get("studentId"));
  return r.ok ? NextResponse.json({ url: r.url }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function POST(req: NextRequest) {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  if (!(await allow(ctx.admin, `photo:${ctx.user.id}`, 400, 3600))) return NextResponse.json({ error: "Too many photo uploads in the last hour. Please wait a while." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !file || typeof file === "string") return NextResponse.json({ error: "Choose a photo first." }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "That photo is too large. Crop it and try again." }, { status: 413 });

  const r = await saveStudentPhoto(ctx.admin, ctx.user.schoolId, form.get("studentId"), Buffer.from(await file.arrayBuffer()));
  return r.ok ? NextResponse.json({ ok: true, url: r.url }) : NextResponse.json({ error: r.error }, { status: r.status });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireSchoolAdmin();
  if ("error" in ctx) return ctx.error;
  const { studentId } = await req.json().catch(() => ({}));
  const r = await removeStudentPhoto(ctx.admin, ctx.user.schoolId, studentId);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
}
