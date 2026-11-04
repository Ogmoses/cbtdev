-- 028 — Sign ONE person out everywhere, immediately.
--
-- Used right after a password reset (the "forgot password" flow): if someone else had got into the
-- account, resetting the password should also end their sign-in, not just change the password.
-- Same idea as revoke_school_sessions (020), but for a single account. Server only (service role).
-- Returns how many sign-ins were ended.
create or replace function revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_user_sessions(uuid) to service_role;
