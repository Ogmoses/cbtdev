-- 025 — Internal support desk: school admins and teachers send help requests to the platform owner.
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `support_tickets`: one row per request (subject, category, priority, message, status, the
--     owner's reply). One-way by design: the school writes the request, the owner answers with a
--     single reply + a status (open / in_progress / resolved) — no back-and-forth thread.
--   * `support_ticket_attachments`: screenshots (up to 3 per ticket), stored in a PRIVATE bucket.
--   * `support-attachments` storage bucket: private, images only, small. Nobody can read it from
--     the browser; the server hands out short-lived links after checking who is asking.
--
-- WHO SEES WHAT (enforced here, in the database — not just in the UI):
--   * The platform owner sees every ticket.
--   * A school admin sees every ticket from THEIR school (their own and their teachers').
--   * A teacher sees only the tickets THEY sent.
--   * Students and other schools see nothing.
--   * Nobody but the server can create or change a ticket (rate limiting, uploads, audit log and
--     emails all happen there).
--
-- school_id cascades (deleting a school removes its tickets); created_by has NO cascade (a deleted
-- teacher's ticket stays, with their name/email kept as a snapshot).

create table support_tickets (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references schools(id) on delete cascade,
  created_by       uuid references users(id) on delete set null,
  created_by_name  text not null,
  created_by_email text,
  created_by_role  text not null check (created_by_role in ('super_admin', 'teacher')),
  subject          text not null check (length(trim(subject)) between 1 and 120),
  category         text not null default 'question' check (category in ('bug', 'billing', 'account', 'question', 'other')),
  priority         text not null default 'normal'   check (priority in ('low', 'normal', 'high', 'urgent')),
  message          text not null check (length(trim(message)) between 1 and 4000),
  status           text not null default 'open'     check (status in ('open', 'in_progress', 'resolved')),
  owner_reply      text check (owner_reply is null or length(owner_reply) <= 4000),
  replied_at       timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_support_tickets_status  on support_tickets (status, created_at desc);
create index idx_support_tickets_school  on support_tickets (school_id, created_at desc);
create index idx_support_tickets_creator on support_tickets (created_by);

create table support_ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references support_tickets(id) on delete cascade,
  path         text not null,                 -- <school_id>/<ticket_id>/<file> inside the bucket
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes   integer not null check (size_bytes > 0),
  created_at   timestamptz not null default now()
);
create index idx_support_attachments_ticket on support_ticket_attachments (ticket_id);

-- ------------------------------------------------------------ access
alter table support_tickets            enable row level security;
alter table support_ticket_attachments enable row level security;

create policy support_tickets_owner_read on support_tickets
  for select to authenticated using (current_role_is('platform_owner'));

create policy support_tickets_admin_read on support_tickets
  for select to authenticated using (current_role_is('super_admin') and school_id = active_school_id());

create policy support_tickets_teacher_read on support_tickets
  for select to authenticated using (current_role_is('teacher') and created_by = auth.uid() and school_id = active_school_id());

-- An attachment is visible exactly when its ticket is (the subquery runs under the ticket rules above).
create policy support_attachments_read on support_ticket_attachments
  for select to authenticated using (exists (select 1 from support_tickets t where t.id = ticket_id));

revoke all on support_tickets, support_ticket_attachments from anon, authenticated;
grant select on support_tickets, support_ticket_attachments to authenticated;   -- still gated by the policies above

-- ------------------------------------------------------------ screenshots bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 1572864, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policies on purpose: with none, the browser can neither read nor write this bucket.
