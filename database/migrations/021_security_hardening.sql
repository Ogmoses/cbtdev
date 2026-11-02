-- 021 — Closing the gaps the Supabase security advisor flagged.
--
-- 1. mt_backup_ddl (the pre-multi-tenant rule backup from 012a) was readable by
--    anyone through the public API. It holds only policy text, no user data, but
--    it should never be exposed: switch RLS on and take away all public access.
--    (The rollback script runs as the database owner, which is unaffected.)
alter table mt_backup_ddl enable row level security;
revoke all on mt_backup_ddl from anon, authenticated;

-- 2. Two of our trigger functions had no fixed search_path.
alter function schools_guard() set search_path = public;
alter function prevent_school_id_change() set search_path = public;

-- 3. Helper functions used INSIDE row-level-security rules: only signed-in users
--    (and the server) have any use for them. Signed-out visitors no longer can
--    call them over the public API.
revoke execute on function current_role_is(user_role) from public, anon;
revoke execute on function current_user_assigned_to_batch(uuid) from public, anon;
revoke execute on function current_user_assigned_to_exam(uuid) from public, anon;
revoke execute on function current_user_created_exam(uuid) from public, anon;
revoke execute on function current_user_owns_batch(uuid) from public, anon;
grant execute on function current_role_is(user_role) to authenticated, service_role;
grant execute on function current_user_assigned_to_batch(uuid) to authenticated, service_role;
grant execute on function current_user_assigned_to_exam(uuid) to authenticated, service_role;
grant execute on function current_user_created_exam(uuid) to authenticated, service_role;
grant execute on function current_user_owns_batch(uuid) to authenticated, service_role;

-- 4. Functions that only ever run as triggers (or internally): nobody should be able
--    to call them over the public API. Triggers keep working — Postgres checks the
--    right to run a trigger function when the trigger is created, not each time it fires.
--    recompute_exam_max_score(uuid) in particular let any caller recompute ANY school's exam.
revoke execute on function set_school_id_default() from public, anon, authenticated;
revoke execute on function seed_school_defaults() from public, anon, authenticated;
revoke execute on function trg_exam_questions_recompute_max_score() from public, anon, authenticated;
revoke execute on function trg_questions_points_recompute_max_score() from public, anon, authenticated;
revoke execute on function recompute_exam_max_score(uuid) from public, anon, authenticated;
grant execute on function recompute_exam_max_score(uuid) to service_role;
