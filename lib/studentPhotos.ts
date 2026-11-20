import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Student passport photos (server only). They are photos of children, so they live in a PRIVATE bucket: there is no public
 * link. `users.photo_url` holds the file's PATH inside the bucket (<school_id>/<student_id>.jpg); anything that starts with
 * http is treated as an ordinary link (left over from before) and used as is. A short-lived signed link, or the image
 * itself, is made only when a report card is being produced, after the report-card route has checked who is asking.
 */
export const PHOTO_BUCKET = "student-photos";
export const photoPath = (schoolId: string, studentId: string) => `${schoolId}/${studentId}.jpg`;

const isLink = (v: string) => /^https?:\/\//i.test(v);

/** A link that works for an hour (for the on-screen report card and the admin's preview). Null if there's no photo. */
export async function signedPhotoUrl(admin: SupabaseClient, stored: string | null, seconds = 3600): Promise<string | null> {
  if (!stored) return null;
  if (isLink(stored)) return stored;
  const { data, error } = await admin.storage.from(PHOTO_BUCKET).createSignedUrl(stored, seconds);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

/** The photo as a data: address, so the PDF can embed it without fetching anything over the network. Null if unavailable. */
export async function photoDataUri(admin: SupabaseClient, stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (isLink(stored)) return stored;
  const { data, error } = await admin.storage.from(PHOTO_BUCKET).download(stored);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
