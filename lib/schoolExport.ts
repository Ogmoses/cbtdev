import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { ZipBuilder } from "@/lib/zip";
import { CSV_BOM, csvRow } from "@/lib/csv";
import { listAllFiles } from "@/lib/owner/deleteSchool";
import { logAudit } from "@/lib/owner/audit";
import { allow } from "@/lib/rateLimit";

/**
 * School data export (server only): everything a school owns, as a ZIP of spreadsheets (CSV) + its images, saved in a
 * private bucket and handed out through short-lived links. Used by the owner (before deleting a school, or any time) and
 * by each school's admin for their own school. Kept 30 days.
 */
export const EXPORT_BUCKET = "school-exports";
const PAGE = 1000;
const STALE_WORKING_MS = 15 * 60 * 1000;
const FILE_BUCKETS = ["school-assets", "question-images"] as const;
const MAX_FILES_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_ONE_FILE_BYTES = 5 * 1024 * 1024;
const FILES_TIME_BUDGET_MS = 35_000;
const MAX_ZIP_BYTES = 48 * 1024 * 1024; // the bucket stops at 50 MB

type Row = Record<string, unknown>;
interface TableSpec {
  table: string;
  columns: string[];
  order: string[];
  keep?: boolean; // held in memory to build the readable sheets
}

/**
 * ALLOW-LIST of what leaves the building. Columns that don't appear here are never exported — that is how
 * `users.pin_hash` and `student_exam_sessions.device_fingerprint` are kept out, and it means a column added to a
 * table later is NOT exported until someone adds it here on purpose. Sign-in tokens, audit logs, support tickets
 * and other platform-level tables are not part of a school's data and aren't listed.
 */
const TABLES: TableSpec[] = [
  { table: "academic_sessions", columns: ["id", "name", "is_current", "created_at"], order: ["id"], keep: true },
  { table: "terms", columns: ["id", "academic_session_id", "name", "is_current", "starts_on", "ends_on", "created_at"], order: ["id"], keep: true },
  { table: "classes", columns: ["id", "name", "level", "created_at"], order: ["id"], keep: true },
  { table: "subjects", columns: ["id", "name", "code", "created_at"], order: ["id"], keep: true },
  { table: "class_subjects", columns: ["class_id", "subject_id"], order: ["class_id", "subject_id"] },
  { table: "teacher_subjects", columns: ["teacher_id", "subject_id", "class_id"], order: ["teacher_id", "subject_id", "class_id"], keep: true },
  { table: "users", columns: ["id", "role", "full_name", "email", "phone", "photo_url", "admission_number", "staff_id", "class_id", "is_active", "created_at", "updated_at"], order: ["id"], keep: true },
  { table: "grading_scale", columns: ["id", "min_score", "max_score", "grade_letter", "remark"], order: ["id"] },
  { table: "batch_templates", columns: ["id", "label", "start_time", "end_time", "created_at"], order: ["id"] },
  { table: "lab_rooms", columns: ["id", "name", "capacity", "created_at"], order: ["id"] },
  { table: "exams", columns: ["id", "title", "subject_id", "class_id", "term_id", "created_by", "duration_minutes", "pass_mark", "shuffle_questions", "shuffle_options", "show_result_instantly", "status", "weight_percent", "is_terminal", "created_at", "updated_at", "max_score", "allow_review"], order: ["id"], keep: true },
  { table: "exam_batches", columns: ["id", "exam_id", "label", "starts_at", "ends_at", "lab_room", "created_at"], order: ["id"] },
  { table: "batch_students", columns: ["batch_id", "student_id"], order: ["batch_id", "student_id"] },
  { table: "questions", columns: ["id", "subject_id", "topic", "created_by", "type", "prompt", "image_url", "points", "reference_answer", "created_at", "updated_at", "class_id", "import_group_id", "import_group_label"], order: ["id"] },
  { table: "question_options", columns: ["id", "question_id", "option_text", "is_correct", "order_index"], order: ["id"] },
  { table: "exam_questions", columns: ["exam_id", "question_id", "order_index"], order: ["exam_id", "question_id"] },
  { table: "question_import_batches", columns: ["id", "created_by", "subject_id", "class_id", "source_filename", "draft_questions", "created_at", "updated_at"], order: ["id"] },
  { table: "student_exam_sessions", columns: ["id", "exam_id", "batch_id", "student_id", "status", "started_at", "last_heartbeat_at", "submitted_at"], order: ["id"] },
  { table: "student_answers", columns: ["id", "session_id", "question_id", "selected_option_id", "free_text_answer", "is_flagged", "is_auto_graded", "points_awarded", "feedback", "graded_by", "graded_at", "updated_at"], order: ["id"] },
  { table: "results", columns: ["id", "student_id", "exam_id", "session_id", "objective_score", "theory_score", "total_score", "grade_letter", "position_in_class", "published", "created_at"], order: ["id"], keep: true },
  { table: "term_subject_results", columns: ["id", "student_id", "subject_id", "term_id", "ca_score", "terminal_score", "total_score", "grade_letter", "teacher_comment", "published"], order: ["id"], keep: true },
];

const SCHOOL_COLUMNS = ["id", "name", "code", "status", "logo_url", "theme_color", "secondary_color", "motto", "address", "created_at", "approved_at"];

const csvBuffer = (header: string[], rows: unknown[][]) => Buffer.from(CSV_BOM + csvRow(header) + rows.map(csvRow).join(""), "utf8");

async function fetchPage(admin: SupabaseClient, spec: TableSpec, schoolId: string, from: number): Promise<Row[]> {
  let q = admin.from(spec.table).select(spec.columns.join(",")).eq("school_id", schoolId);
  for (const col of spec.order) q = q.order(col);
  const { data, error } = await q.range(from, from + PAGE - 1);
  if (error) throw new Error(`${spec.table}: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

const dateOnly = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");

function readme(opts: { schoolName: string; schoolCode: string; counts: Record<string, number>; filesIncluded: number; filesSkipped: number; generatedAt: string }): string {
  const lines = Object.entries(opts.counts).map(([t, n]) => `  ${t}: ${n}`).join("\n");
  return `DATA EXPORT — ${opts.schoolName} (${opts.schoolCode})
Created: ${opts.generatedAt}

WHAT IS IN THIS ZIP
  students.csv, staff.csv, results.csv, term_results.csv   Readable sheets: names instead of codes. Start here.
  school.csv                                               The school's profile.
  raw/*.csv                                                Every table exactly as stored (ids link the tables together:
                                                           e.g. results.student_id = users.id). Use these to move the data elsewhere.
  files/                                                   The logo and uploaded question images (see files/manifest.csv).

HOW TO OPEN
  The .csv files open in Excel, Google Sheets or Numbers. They are UTF-8 (names with ẹ, ọ, ṣ and other letters are kept).
  Text that began with = + - or @ has a ' in front of it, so a spreadsheet never treats it as a formula.

WHAT IS NOT INCLUDED
  Passwords, PIN codes, sign-in links, device identifiers, and platform-level records (audit log, support tickets).
  Image files that were too large, or that would make the export too big, are listed in files/manifest.csv but not included.

ROW COUNTS
${lines}

FILES: ${opts.filesIncluded} image file(s) included${opts.filesSkipped ? `, ${opts.filesSkipped} not included (see files/manifest.csv)` : ""}.

This file contains personal information about students and staff. Keep it safe and delete it when you no longer need it.
`;
}

async function buildExport(admin: SupabaseClient, schoolId: string) {
  const zip = new ZipBuilder();
  const counts: Record<string, number> = {};
  const kept: Record<string, Row[]> = {};

  const { data: school, error: schoolError } = await admin.from("schools").select(SCHOOL_COLUMNS.join(",")).eq("id", schoolId).maybeSingle();
  if (schoolError || !school) throw new Error("School not found.");
  const schoolRow = school as unknown as Row;
  zip.add("school.csv", csvBuffer(SCHOOL_COLUMNS, [SCHOOL_COLUMNS.map((c) => schoolRow[c])]));

  // ---- raw tables, one page at a time
  for (const spec of TABLES) {
    const chunks: string[] = [CSV_BOM + csvRow(spec.columns)];
    let n = 0;
    for (let from = 0; ; from += PAGE) {
      const rows = await fetchPage(admin, spec, schoolId, from);
      if (rows.length === 0) break;
      chunks.push(rows.map((r) => csvRow(spec.columns.map((c) => r[c]))).join(""));
      n += rows.length;
      if (spec.keep) (kept[spec.table] ??= []).push(...rows);
      if (rows.length < PAGE) break;
    }
    counts[spec.table] = n;
    zip.add(`raw/${spec.table}.csv`, Buffer.from(chunks.join(""), "utf8"));
  }

  // ---- readable sheets (names instead of ids)
  const byId = (table: string) => new Map((kept[table] ?? []).map((r) => [r.id as string, r]));
  const classes = byId("classes");
  const subjects = byId("subjects");
  const terms = byId("terms");
  const exams = byId("exams");
  const users = kept.users ?? [];
  const userById = new Map(users.map((u) => [u.id as string, u]));
  const nameOf = (m: Map<string, Row>, id: unknown, key = "name") => (id ? String(m.get(id as string)?.[key] ?? "") : "");

  zip.add(
    "students.csv",
    csvBuffer(
      ["Admission number", "Name", "Class", "Email", "Phone", "Active", "Created"],
      users.filter((u) => u.role === "student").map((u) => [u.admission_number, u.full_name, nameOf(classes, u.class_id), u.email, u.phone, u.is_active, dateOnly(u.created_at)])
    )
  );

  const teaching = new Map<string, string[]>();
  for (const t of kept.teacher_subjects ?? []) {
    const list = teaching.get(t.teacher_id as string) ?? [];
    list.push(`${nameOf(subjects, t.subject_id)} (${nameOf(classes, t.class_id)})`);
    teaching.set(t.teacher_id as string, list);
  }
  zip.add(
    "staff.csv",
    csvBuffer(
      ["Staff ID", "Name", "Role", "Email", "Phone", "Teaches", "Active", "Created"],
      users.filter((u) => u.role === "teacher" || u.role === "super_admin").map((u) => [u.staff_id, u.full_name, u.role === "super_admin" ? "School admin" : "Teacher", u.email, u.phone, (teaching.get(u.id as string) ?? []).join("; "), u.is_active, dateOnly(u.created_at)])
    )
  );

  zip.add(
    "results.csv",
    csvBuffer(
      ["Exam", "Subject", "Exam class", "Term", "Student", "Admission number", "Student class", "Objective score", "Theory score", "Total score", "Exam max score", "Grade", "Position in class", "Published", "Date"],
      (kept.results ?? []).map((r) => {
        const exam = exams.get(r.exam_id as string);
        const student = userById.get(r.student_id as string);
        return [
          exam?.title,
          exam ? nameOf(subjects, exam.subject_id) : "",
          exam ? nameOf(classes, exam.class_id) : "",
          exam ? nameOf(terms, exam.term_id) : "",
          student?.full_name,
          student?.admission_number,
          student ? nameOf(classes, student.class_id) : "",
          r.objective_score,
          r.theory_score,
          r.total_score,
          exam?.max_score,
          r.grade_letter,
          r.position_in_class,
          r.published,
          dateOnly(r.created_at),
        ];
      })
    )
  );

  zip.add(
    "term_results.csv",
    csvBuffer(
      ["Term", "Subject", "Student", "Admission number", "CA score", "Terminal score", "Total", "Grade", "Teacher comment", "Published"],
      (kept.term_subject_results ?? []).map((r) => {
        const student = userById.get(r.student_id as string);
        return [nameOf(terms, r.term_id), nameOf(subjects, r.subject_id), student?.full_name, student?.admission_number, r.ca_score, r.terminal_score, r.total_score, r.grade_letter, r.teacher_comment, r.published];
      })
    )
  );

  // ---- images (best effort, capped)
  const manifest: unknown[][] = [];
  let filesIncluded = 0;
  let filesSkipped = 0;
  let filesBytes = 0;
  const started = Date.now();
  for (const bucket of FILE_BUCKETS) {
    let paths: string[] = [];
    try {
      paths = await listAllFiles(admin, bucket, schoolId);
    } catch {
      manifest.push([bucket, "(could not list this folder)", "", "no", "listing failed"]);
      continue;
    }
    for (let i = 0; i < paths.length; i += 6) {
      await Promise.all(
        paths.slice(i, i + 6).map(async (path) => {
          const rel = path.startsWith(`${schoolId}/`) ? path.slice(schoolId.length + 1) : path;
          const skip = (reason: string, size: number | "" = "") => {
            filesSkipped += 1;
            manifest.push([bucket, rel, size, "no", reason]);
          };
          if (Date.now() - started > FILES_TIME_BUDGET_MS) return skip("time limit reached");
          try {
            const { data, error } = await admin.storage.from(bucket).download(path);
            if (error || !data) return skip("could not be downloaded");
            const buf = Buffer.from(await data.arrayBuffer());
            if (buf.length > MAX_ONE_FILE_BYTES) return skip("file too large", buf.length);
            if (filesBytes + buf.length > MAX_FILES_TOTAL_BYTES) return skip("export size limit reached", buf.length);
            filesBytes += buf.length;
            filesIncluded += 1;
            zip.add(`files/${bucket}/${rel}`, buf, { store: true });
            manifest.push([bucket, rel, buf.length, "yes", ""]);
          } catch {
            skip("could not be downloaded");
          }
        })
      );
    }
  }
  zip.add("files/manifest.csv", csvBuffer(["Folder", "Path", "Size (bytes)", "Included", "Note"], manifest));

  zip.add("README.txt", Buffer.from(readme({ schoolName: String(schoolRow.name), schoolCode: String(schoolRow.code), counts, filesIncluded, filesSkipped, generatedAt: new Date().toISOString() }), "utf8"));

  const buffer = zip.finish();
  if (buffer.length > MAX_ZIP_BYTES) throw new Error("This school's data is larger than the 50 MB export limit.");
  return { buffer, counts, filesIncluded, filesSkipped };
}

/** Runs one export to completion (called after the request has been answered). Never throws: failure is recorded on the row. */
export async function runSchoolExport(admin: SupabaseClient, exportId: string, schoolId: string) {
  try {
    const { buffer, counts, filesIncluded, filesSkipped } = await buildExport(admin, schoolId);
    const path = `${schoolId}/${exportId}.zip`;
    const { error: uploadError } = await admin.storage.from(EXPORT_BUCKET).upload(path, buffer, { contentType: "application/zip", upsert: false });
    if (uploadError) throw new Error("Couldn't save the export file.");
    await admin
      .from("school_exports")
      .update({ status: "ready", file_path: path, size_bytes: buffer.length, row_counts: counts, files_included: filesIncluded, files_skipped: filesSkipped })
      .eq("id", exportId);
  } catch (err) {
    console.error("[school-export] failed:", err instanceof Error ? err.message : err);
    await admin
      .from("school_exports")
      .update({ status: "failed", error: err instanceof Error ? err.message.slice(0, 200) : "Export failed." })
      .eq("id", exportId);
  }
}

/** Housekeeping, run whenever the lists are opened: delete expired exports (file + row) and mark stuck ones failed. */
export async function tidyExports(admin: SupabaseClient) {
  try {
    const { data: expired } = await admin.from("school_exports").select("id, file_path").lt("expires_at", new Date().toISOString()).limit(50);
    if (expired?.length) {
      const paths = expired.map((e) => e.file_path as string | null).filter((p): p is string => !!p);
      if (paths.length) await admin.storage.from(EXPORT_BUCKET).remove(paths);
      await admin.from("school_exports").delete().in("id", expired.map((e) => e.id as string));
    }
    await admin
      .from("school_exports")
      .update({ status: "failed", error: "Timed out." })
      .eq("status", "working")
      .lt("created_at", new Date(Date.now() - STALE_WORKING_MS).toISOString());
  } catch {
    // housekeeping must never break a page
  }
}

export interface Requester {
  id: string;
  name: string;
  email: string | null;
  role: "platform_owner" | "super_admin";
}

/**
 * Starts an export: records it (audit log first), and returns a `run` function the route schedules with `after()`.
 * If an export of this school is already being made, that one is returned instead (no duplicates).
 */
export async function requestSchoolExport(
  admin: SupabaseClient,
  schoolId: string,
  requester: Requester
): Promise<{ ok: true; id: string; run: (() => Promise<void>) | null } | { ok: false; status: number; error: string }> {
  await tidyExports(admin);

  const { data: school } = await admin.from("schools").select("id, name, code").eq("id", schoolId).maybeSingle();
  if (!school) return { ok: false, status: 404, error: "School not found." };

  const { data: running } = await admin
    .from("school_exports")
    .select("id")
    .eq("school_id", schoolId)
    .eq("status", "working")
    .gte("created_at", new Date(Date.now() - STALE_WORKING_MS).toISOString())
    .limit(1);
  if (running?.length) return { ok: true, id: running[0].id as string, run: null };

  if (!(await allow(admin, `export:${schoolId}`, 3, 3600))) {
    return { ok: false, status: 429, error: "This school has been exported several times in the last hour. Please wait a while, or download one of the existing exports." };
  }

  const id = crypto.randomUUID();
  const audited = await logAudit(admin, {
    actorId: requester.id,
    actorEmail: requester.email,
    action: "school.export_created",
    targetType: "school_export",
    targetId: id,
    schoolId,
    schoolName: school.name as string,
    details: { school_code: school.code, requested_by_role: requester.role },
  });
  if (!audited) return { ok: false, status: 500, error: "Couldn't write the audit record, so nothing was started. Try again." };

  const { error } = await admin.from("school_exports").insert({
    id,
    school_id: schoolId,
    school_name: school.name,
    school_code: school.code,
    requested_by: requester.id,
    requested_by_name: requester.name,
    requested_by_role: requester.role,
  });
  if (error) return { ok: false, status: 500, error: "Couldn't start the export. Please try again." };

  return { ok: true, id, run: () => runSchoolExport(admin, id, schoolId) };
}

/** Shape sent to the browser. */
export function exportForClient(r: Row) {
  return {
    id: r.id as string,
    schoolId: r.school_id as string,
    schoolName: r.school_name as string,
    schoolCode: r.school_code as string,
    requestedByName: (r.requested_by_name as string | null) ?? null,
    requestedByRole: r.requested_by_role as "platform_owner" | "super_admin",
    status: r.status as "working" | "ready" | "failed",
    sizeBytes: (r.size_bytes as number | null) ?? null,
    filesIncluded: (r.files_included as number) ?? 0,
    filesSkipped: (r.files_skipped as number) ?? 0,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
    expiresAt: r.expires_at as string,
  };
}

export const EXPORT_COLUMNS = "id, school_id, school_name, school_code, requested_by_name, requested_by_role, status, size_bytes, files_included, files_skipped, error, created_at, expires_at";
