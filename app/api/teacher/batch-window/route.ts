import { NextRequest, NextResponse } from "next/server";
import { getCallerContext } from "@/lib/auth/callerContext";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST { batchId, action: "close" | "reopen" | "add_class" } — the teacher's controls for a sitting (batch) of an exam.
 *   close      -> no NEW student can start it. Anyone already mid-exam carries on to their own deadline.
 *   reopen     -> students can start it again. If its fixed end time has already passed, it becomes "open until closed".
 *   add_class  -> puts every active student of the exam's class who isn't in any sitting of this exam yet into this one.
 * Only the teacher who created the exam (or a school admin) may do this, and only within their own school.
 * It never touches sessions, answers or results, and never lets anyone sit an exam a second time: that
 * stays guaranteed by the database (one session per student per exam).
 */
export async function POST(req: NextRequest) {
  const guard = await getCallerContext({ roles: ["teacher", "super_admin"] });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const { ctx } = guard;

  const { batchId, action } = await req.json().catch(() => ({}));
  if (!batchId || typeof batchId !== "string" || !["close", "reopen", "add_class"].includes(action)) {
    return NextResponse.json({ error: "batchId and a valid action are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: batch } = await admin
    .from("exam_batches")
    .select("id, exam_id, starts_at, ends_at, stays_open, closed_at, exams(created_by, class_id)")
    .eq("id", batchId)
    .eq("school_id", ctx.schoolId)
    .maybeSingle();
  if (!batch) return NextResponse.json({ error: "Sitting not found." }, { status: 404 });

  const exam = Array.isArray(batch.exams) ? batch.exams[0] : batch.exams;
  if (ctx.role !== "super_admin" && exam?.created_by !== ctx.userId) {
    return NextResponse.json({ error: "Only the teacher who created this exam can change its sittings." }, { status: 403 });
  }

  if (action === "close") {
    const closedAt = batch.closed_at ?? new Date().toISOString();
    const { error } = await admin.from("exam_batches").update({ closed_at: closedAt }).eq("id", batchId).eq("school_id", ctx.schoolId);
    if (error) return NextResponse.json({ error: "Couldn't close the sitting." }, { status: 500 });
    return NextResponse.json({ stays_open: batch.stays_open, closed_at: closedAt });
  }

  if (action === "reopen") {
    // A fixed window that has already run out can't simply be "un-closed": reopening makes it open until closed again.
    const expired = new Date(batch.ends_at).getTime() < Date.now();
    const staysOpen = batch.stays_open || expired;
    const { error } = await admin.from("exam_batches").update({ closed_at: null, stays_open: staysOpen }).eq("id", batchId).eq("school_id", ctx.schoolId);
    if (error) return NextResponse.json({ error: "Couldn't reopen the sitting." }, { status: 500 });
    return NextResponse.json({ stays_open: staysOpen, closed_at: null });
  }

  // add_class
  if (!exam?.class_id) return NextResponse.json({ error: "This exam isn't tied to a class." }, { status: 400 });
  const [{ data: classStudents }, { data: sittings }] = await Promise.all([
    admin.from("users").select("id").eq("school_id", ctx.schoolId).eq("role", "student").eq("is_active", true).eq("class_id", exam.class_id),
    admin.from("exam_batches").select("id").eq("exam_id", batch.exam_id).eq("school_id", ctx.schoolId),
  ]);
  const sittingIds = (sittings ?? []).map((s) => s.id as string);
  const { data: already } = sittingIds.length
    ? await admin.from("batch_students").select("student_id").eq("school_id", ctx.schoolId).in("batch_id", sittingIds)
    : { data: [] as { student_id: string }[] };
  const assigned = new Set((already ?? []).map((a) => a.student_id as string));
  const toAdd = (classStudents ?? []).map((s) => s.id as string).filter((id) => !assigned.has(id));
  if (toAdd.length > 0) {
    const { error } = await admin
      .from("batch_students")
      .upsert(toAdd.map((student_id) => ({ batch_id: batchId, student_id, school_id: ctx.schoolId })), { onConflict: "batch_id,student_id" });
    if (error) return NextResponse.json({ error: "Couldn't add the class." }, { status: 500 });
  }
  return NextResponse.json({ added: toAdd.length });
}
