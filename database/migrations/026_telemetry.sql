-- 026 — Live platform telemetry ("Exam Radar") for the owner console.
--
-- WHAT THIS DOES (purely additive — no existing table or rule is changed; the only things
-- added to existing tables are two small, partial INDEXES that keep the live counters fast):
--   * `platform_events`: a tiny log of sign-ins (when, which school, which ROLE) so the live feed
--     can show "a teacher signed in at X". It stores NO names, NO ids of people, NO IPs, and
--     keeps only the last 7 days. Server-only: the browser cannot read or write it.
--   * `platform_telemetry()`: ONE call that returns everything the owner's live view needs —
--     counters, the list of exams running right now, and a recent-activity feed.
--   * `record_login_event()`: how a sign-in gets recorded (server only).
--
-- STUDENT PRIVACY: nothing here names a student. The feed says "an exam was submitted at
-- <school>" and "a student signed in at <school>" — never who. The radar shows counts only.
--
-- DEFINITIONS (so the numbers are never a mystery):
--   active schools     schools with status 'active'
--   total students     active student accounts in active schools
--   students writing   exam sessions still 'active' that reported in within the last 30 minutes
--   live exams         published exams that are inside a scheduled batch window right now,
--                      PLUS any exam with a student actively writing it
--   submissions today  sessions submitted since the start of the owner's day (their local midnight)

create table platform_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  type       text not null check (type in ('login')),
  school_id  uuid references schools(id) on delete cascade,
  role       text not null check (role in ('super_admin', 'teacher', 'student'))
);
create index idx_platform_events_created on platform_events (created_at desc);

alter table platform_events enable row level security;       -- no policies on purpose: server only
revoke all on platform_events from anon, authenticated;

-- Keep the live counters quick as the platform grows.
create index if not exists idx_sessions_submitted_at on student_exam_sessions (submitted_at desc) where status = 'submitted';
create index if not exists idx_sessions_active_beat  on student_exam_sessions (last_heartbeat_at) where status = 'active';

create or replace function record_login_event(p_school_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into platform_events (type, school_id, role) values ('login', p_school_id, p_role);
  delete from platform_events where created_at < now() - interval '7 days';
end $$;

create or replace function platform_telemetry(p_day_start timestamptz, p_feed_limit int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_writing_since timestamptz := now() - interval '30 minutes';
  v_result jsonb;
begin
  with live_batches as (
    select b.exam_id, b.ends_at
    from exam_batches b join exams e on e.id = b.exam_id
    where e.status = 'published' and now() >= b.starts_at and now() < b.ends_at
  ),
  writing as (
    select exam_id, count(*) as n
    from student_exam_sessions
    where status = 'active' and last_heartbeat_at >= v_writing_since
    group by exam_id
  ),
  live as (
    select exam_id from live_batches union select exam_id from writing
  ),
  radar as (
    select e.id, e.title, s.name as school, coalesce(w.n, 0) as writing,
           (select count(*) from student_exam_sessions ss where ss.exam_id = e.id and ss.status = 'submitted') as submitted,
           (select max(lb.ends_at) from live_batches lb where lb.exam_id = e.id) as window_ends_at
    from live l
    join exams e on e.id = l.exam_id
    join schools s on s.id = e.school_id and s.status = 'active'
    left join writing w on w.exam_id = e.id
  ),
  feed as (
    (select ss.submitted_at as ts, 'submission'::text as type, sc.name as school, null::text as role
       from student_exam_sessions ss join schools sc on sc.id = ss.school_id
      where ss.status = 'submitted' and ss.submitted_at is not null
      order by ss.submitted_at desc limit p_feed_limit)
    union all
    (select created_at, 'signup'::text, name, null::text from schools order by created_at desc limit p_feed_limit)
    union all
    (select pe.created_at, 'login'::text, sc.name, pe.role
       from platform_events pe left join schools sc on sc.id = pe.school_id
      order by pe.created_at desc limit p_feed_limit)
  )
  select jsonb_build_object(
    'active_schools',     (select count(*) from schools where status = 'active'),
    'total_students',     (select count(*) from users u join schools s on s.id = u.school_id where u.role = 'student' and u.is_active and s.status = 'active'),
    'submissions_today',  (select count(*) from student_exam_sessions where status = 'submitted' and submitted_at >= p_day_start),
    'students_writing',   (select coalesce(sum(writing), 0) from radar),
    'live_exams',         (select count(*) from radar),
    'radar', coalesce((select jsonb_agg(jsonb_build_object('exam_title', r.title, 'school', r.school, 'writing', r.writing, 'submitted', r.submitted, 'window_ends_at', r.window_ends_at))
                         from (select * from radar order by writing desc, title limit 50) r), '[]'::jsonb),
    'feed', coalesce((select jsonb_agg(jsonb_build_object('at', f.ts, 'type', f.type, 'school', f.school, 'role', f.role))
                        from (select * from feed order by ts desc limit p_feed_limit) f), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- Server only (same pattern as 018/021/022).
revoke execute on function record_login_event(uuid, text)    from public, anon, authenticated;
revoke execute on function platform_telemetry(timestamptz, int) from public, anon, authenticated;
grant  execute on function record_login_event(uuid, text)    to service_role;
grant  execute on function platform_telemetry(timestamptz, int) to service_role;
