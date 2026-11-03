import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKETS = ["question-images", "school-assets", "support-attachments"] as const;

/** Every file path under `prefix` in a bucket (storage lists one level at a time; folders have no id). */
async function listAllFiles(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) files.push(path);
    else files.push(...(await listAllFiles(admin, bucket, path)));
  }
  return files;
}

/**
 * Permanently deletes a school: all its database records and sign-in accounts
 * in one all-or-nothing database transaction (migration 016), then its
 * uploaded image files. The school's own code must be passed as confirmation.
 *
 * Files are removed AFTER the database succeeds, and only best-effort: if the
 * file cleanup fails the school is still gone and the leftovers are harmless
 * orphans (reported back so the owner knows).
 */
export async function deleteSchoolCompletely(
  admin: SupabaseClient,
  schoolId: string,
  confirmCode: string
): Promise<{ counts: Record<string, number>; filesRemoved: number; filesFailed: boolean }> {
  const { data, error } = await admin.rpc("delete_school_permanently", { p_school_id: schoolId, p_confirm_code: confirmCode });
  if (error) throw new Error(error.message);

  let filesRemoved = 0;
  let filesFailed = false;
  for (const bucket of BUCKETS) {
    try {
      const paths = await listAllFiles(admin, bucket, schoolId);
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error: removeError } = await admin.storage.from(bucket).remove(chunk);
        if (removeError) filesFailed = true;
        else filesRemoved += chunk.length;
      }
    } catch {
      filesFailed = true;
    }
  }

  return { counts: (data ?? {}) as Record<string, number>, filesRemoved, filesFailed };
}
