import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET, photoPath, signedPhotoUrl } from "@/lib/studentPhotos";

/** What the admin's photo routes do, kept apart from the HTTP layer so it can be tested on its own. */
export const MAX_PHOTO_BYTES = 500_000;

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

type Failure = { ok: false; status: number; error: string };

/** The student, if (and only if) they belong to THIS school: an admin can never touch another school's students. */
async function studentInSchool(admin: SupabaseClient, schoolId: string, studentId: unknown) {
  if (typeof studentId !== "string" || !/^[0-9a-f-]{36}$/i.test(studentId)) return null;
  const { data } = await admin.from("users").select("id, photo_url").eq("id", studentId).eq("school_id", schoolId).eq("role", "student").maybeSingle();
  return data ? { id: data.id as string, photoUrl: (data.photo_url as string | null) ?? null } : null;
}

export async function getStudentPhoto(admin: SupabaseClient, schoolId: string, studentId: unknown): Promise<{ ok: true; url: string | null } | Failure> {
  const s = await studentInSchool(admin, schoolId, studentId);
  if (!s) return { ok: false, status: 404, error: "Student not found." };
  return { ok: true, url: await signedPhotoUrl(admin, s.photoUrl) };
}

export async function saveStudentPhoto(admin: SupabaseClient, schoolId: string, studentId: unknown, bytes: Buffer): Promise<{ ok: true; url: string | null } | Failure> {
  const s = await studentInSchool(admin, schoolId, studentId);
  if (!s) return { ok: false, status: 404, error: "Student not found." };
  if (bytes.length === 0) return { ok: false, status: 400, error: "Choose a photo first." };
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, status: 413, error: "That photo is too large. Crop it and try again." };
  if (!isJpeg(bytes)) return { ok: false, status: 400, error: "The photo must be a JPEG image." }; // the screen always saves JPEG; anything else is refused

  const path = photoPath(schoolId, s.id);
  const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return { ok: false, status: 500, error: "Couldn't save the photo. Please try again." };
  const { error: rowError } = await admin.from("users").update({ photo_url: path }).eq("id", s.id).eq("school_id", schoolId);
  if (rowError) return { ok: false, status: 500, error: "The photo was uploaded but couldn't be linked to the student. Please try again." };
  return { ok: true, url: await signedPhotoUrl(admin, path) };
}

export async function removeStudentPhoto(admin: SupabaseClient, schoolId: string, studentId: unknown): Promise<{ ok: true } | Failure> {
  const s = await studentInSchool(admin, schoolId, studentId);
  if (!s) return { ok: false, status: 404, error: "Student not found." };
  if (s.photoUrl && !/^https?:\/\//i.test(s.photoUrl)) await admin.storage.from(PHOTO_BUCKET).remove([s.photoUrl]);
  const { error } = await admin.from("users").update({ photo_url: null }).eq("id", s.id).eq("school_id", schoolId);
  if (error) return { ok: false, status: 500, error: "Couldn't remove the photo. Please try again." };
  return { ok: true };
}
