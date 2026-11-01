-- 020 — Sign everyone at a school out, immediately.
--
-- Used when the platform owner suspends a school. Deleting a person's auth
-- session invalidates their sign-in on the server: their next request (or
-- their next token refresh) is treated as signed out, whatever page they have
-- open. Only the people of THIS school are affected — the platform owner and
-- every other school keep their sessions. Service role only. Returns how many
-- sign-ins were ended.
create or replace function revoke_school_sessions(p_school_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from auth.sessions
  where user_id in (select id from users where school_id = p_school_id);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function revoke_school_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_school_sessions(uuid) to service_role;
