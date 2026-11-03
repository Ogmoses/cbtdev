-- 023 — Global feature flags & emergency controls (maintenance mode, school sign-ups).
--
-- WHAT THIS DOES (purely additive — nothing existing is touched; both switches start in
-- their normal position: maintenance OFF, sign-ups OPEN, so applying this changes nothing
-- for anyone until the owner flips a switch):
--   * `platform_flags`: exactly one row, like platform_settings (017).
--   * Readable by the platform owner only. It is deliberately NOT writable from the browser:
--     every change goes through the owner API, which writes the audit log (022) first-class.
--   * The row can never be deleted or truncated, so the app always has a value to read.
create table platform_flags (
  id                  boolean primary key default true check (id),   -- exactly one row
  maintenance_mode    boolean     not null default false,
  maintenance_message text        not null default 'We are making some improvements. Please check back shortly.'
                        check (length(trim(maintenance_message)) > 0 and length(maintenance_message) <= 500),
  signups_open        boolean     not null default true,
  updated_at          timestamptz not null default now(),
  updated_by          uuid                                            -- no FK: never blocks deleting an account
);
insert into platform_flags default values;

alter table platform_flags enable row level security;

create policy platform_flags_owner_read on platform_flags
  for select to authenticated using (current_role_is('platform_owner'));

revoke all on platform_flags from anon, authenticated;
grant select on platform_flags to authenticated;                 -- still gated by the policy above
revoke delete, truncate on platform_flags from service_role;     -- the single row must always exist
