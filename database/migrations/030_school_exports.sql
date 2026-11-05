-- 030 — School data exports (the "export before delete" feature, also available to each school's admins).
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `school_exports`: one row per export (who asked, when, status, size, what it holds, when it expires).
--     school_id has NO foreign key on purpose: an export must outlive the school it came from, so the owner can
--     still download it after the school is deleted. The school's name and code are kept as a snapshot.
--   * `school-exports` storage bucket: PRIVATE, ZIP files only, 50 MB per file. Nobody can read it from the browser:
--     the server hands out short-lived download links after checking who is asking (and audit-logs it).
--
-- WHO SEES WHAT (enforced here, not just in the UI):
--   * The platform owner sees every export (including those of deleted schools).
--   * A school admin sees the exports of THEIR OWN (active) school only.
--   * Teachers, students and other schools see nothing.
--   * Nobody but the server can create, change or delete an export row.
--
-- Exports are kept 30 days (expires_at); expired ones are cleaned up by the server the next time the lists are opened.

create table school_exports (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null,                       -- no FK: survives the school's deletion
  school_name       text not null,
  school_code       text not null,
  requested_by      uuid,                                -- no FK: never blocks deleting an account
  requested_by_name text,
  requested_by_role text not null check (requested_by_role in ('platform_owner', 'super_admin')),
  status            text not null default 'working' check (status in ('working', 'ready', 'failed')),
  file_path         text,                                -- path inside the school-exports bucket
  size_bytes        bigint,
  row_counts        jsonb,
  files_included    integer not null default 0,
  files_skipped     integer not null default 0,
  error             text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days')
);
create index idx_school_exports_school  on school_exports (school_id, created_at desc);
create index idx_school_exports_expires on school_exports (expires_at);

alter table school_exports enable row level security;

create policy school_exports_owner_read on school_exports
  for select to authenticated using (current_role_is('platform_owner'));

create policy school_exports_admin_read on school_exports
  for select to authenticated using (current_role_is('super_admin') and school_id = active_school_id());

revoke all on school_exports from anon, authenticated;
grant select on school_exports to authenticated;           -- still gated by the policies above

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-exports', 'school-exports', false, 52428800, array['application/zip'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policies on purpose: with none, the browser can neither read nor write this bucket.
