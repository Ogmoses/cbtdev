-- 032 — Changing a school admin's sign-in email, with BOTH addresses agreeing first.
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `email_change_requests`: one row per request to change an account's email. It holds the current ("old") and the
--     proposed ("new") address, two separate single-use secrets (only their SHA-256 hashes are stored, never the
--     secrets), who has approved so far, and when it expires (24 hours).
--   * The change is applied only when the OLD address owner and the NEW address owner have each approved.
--   * Only one pending request per person (a new request replaces the old one).
--   * Server only: no browser role can read or write this table (RLS is on and there are no policies). The people
--     involved reach it only through the app's server routes, which check who is asking.
--
-- Rows go away with their person or school (cascade).

create table email_change_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  school_id       uuid not null references schools(id) on delete cascade,
  old_email       text not null,
  new_email       text not null,
  old_token_hash  text not null unique,
  new_token_hash  text not null unique,
  old_approved_at timestamptz,
  new_approved_at timestamptz,
  status          text not null default 'pending'
                    check (status in ('pending', 'completed', 'declined', 'cancelled', 'expired', 'failed')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours'),
  completed_at    timestamptz
);

create unique index one_pending_email_change_per_user on email_change_requests (user_id) where status = 'pending';
create index idx_email_change_requests_user on email_change_requests (user_id, created_at desc);

alter table email_change_requests enable row level security;      -- no policies on purpose: server only
revoke all on email_change_requests from anon, authenticated;
