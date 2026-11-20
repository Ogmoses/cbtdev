-- 034 — Private storage for student passport photos.
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * The `student-photos` bucket: PRIVATE (no public link exists), JPEG only, 500 KB per file.
--   * Nobody can read or write it from the browser (there are deliberately no storage rules for it). The server saves a photo
--     after checking the person is that school's admin, and hands out short-lived links / embeds the image only while a
--     report card is being made for someone allowed to see it.
--   * `users.photo_url` already exists; it will hold the file's path in this bucket (<school_id>/<student_id>.jpg).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 512000, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
