-- 024 — Global broadcasts: owner announcements shown as dismissible banners to school staff.
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `announcements`: one row per broadcast (title, message, severity, who it's for, when it runs).
--   * `announcement_schools`: which schools a broadcast targets, when it isn't "all schools".
--   * `announcement_dismissals`: who has closed which banner (remembered across devices).
--
-- WHO SEES WHAT (enforced here, in the database — not just in the UI):
--   * Only the platform owner can create, end or list every broadcast: there is no write access
--     for anyone else, so every broadcast goes through the owner API and the audit log (022).
--   * A school admin / teacher sees a broadcast only while it is live (started, not ended, not
--     expired), addressed to their role, and aimed at their school (or at all schools) — and only
--     if their school is active.
--   * STUDENTS never see broadcasts. There is no student path through these rules.
--   * A person can read and add only their OWN dismissals.

create table announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) between 1 and 120),
  body        text not null check (length(trim(body)) between 1 and 1000),
  severity    text not null default 'info'      check (severity in ('info', 'warning', 'critical')),
  audience    text not null default 'all_staff' check (audience in ('all_staff', 'admins', 'teachers')),
  all_schools boolean     not null default true,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,                       -- optional automatic end
  ended_at    timestamptz,                       -- set when the owner ends it early
  created_by  uuid,                              -- no FK: never blocks deleting an account
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index idx_announcements_live on announcements (starts_at, ends_at) where ended_at is null;

create table announcement_schools (
  announcement_id uuid not null references announcements(id) on delete cascade,
  school_id       uuid not null references schools(id) on delete cascade,   -- deleting a school just drops its link
  primary key (announcement_id, school_id)
);
create index idx_announcement_schools_school on announcement_schools (school_id);

create table announcement_dismissals (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- Does this broadcast target the caller's (active) school? SECURITY DEFINER so the policy below
-- can look at announcement_schools without that table's own rules getting in the way
-- (same pattern as the other helpers used inside rules).
create or replace function announcement_reaches_my_school(p_announcement_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from announcement_schools s
    where s.announcement_id = p_announcement_id and s.school_id = active_school_id()
  );
$$;
revoke execute on function announcement_reaches_my_school(uuid) from public, anon;
grant execute on function announcement_reaches_my_school(uuid) to authenticated, service_role;

-- ------------------------------------------------------------ access
alter table announcements          enable row level security;
alter table announcement_schools   enable row level security;
alter table announcement_dismissals enable row level security;

create policy announcements_owner_read on announcements
  for select to authenticated using (current_role_is('platform_owner'));

create policy announcements_staff_read on announcements
  for select to authenticated using (
    ended_at is null
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
    and active_school_id() is not null
    and (
         (audience in ('all_staff', 'admins')   and current_role_is('super_admin'))
      or (audience in ('all_staff', 'teachers') and current_role_is('teacher'))
    )
    and (all_schools or announcement_reaches_my_school(id))
  );

create policy announcement_schools_owner_read on announcement_schools
  for select to authenticated using (current_role_is('platform_owner'));

create policy dismissals_own_read on announcement_dismissals
  for select to authenticated using (user_id = auth.uid());

-- You can close a banner only for yourself, and only one you are actually allowed to see.
create policy dismissals_own_insert on announcement_dismissals
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from announcements a where a.id = announcement_id)
  );

revoke all on announcements, announcement_schools, announcement_dismissals from anon, authenticated;
grant select on announcements, announcement_schools to authenticated;      -- still gated by the policies above
grant select, insert on announcement_dismissals to authenticated;
