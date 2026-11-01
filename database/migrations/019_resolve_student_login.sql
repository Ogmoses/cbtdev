-- 019 — Exact student-ID lookup for sign-in.
--
-- The sign-in screen has to turn a student ID into the account's email. Doing
-- that with a pattern match let a visitor type a wildcard ("%" or "*") and
-- match every student. This matches the ID EXACTLY (ignoring capitals only),
-- within the school if a school code is given. Returns at most 2 rows so the
-- caller can tell "unique" from "ambiguous across schools". Service role only.
create or replace function resolve_student_login(p_student_id text, p_school_code text default null)
returns table (email text)
language sql stable security definer set search_path = public as $$
  select u.email
  from users u
  where u.role = 'student'
    and lower(u.admission_number) = lower(trim(p_student_id))
    and (p_school_code is null or u.school_id = (select s.id from schools s where s.code = lower(trim(p_school_code))))
  limit 2;
$$;

revoke execute on function resolve_student_login(text, text) from public, anon, authenticated;
grant execute on function resolve_student_login(text, text) to service_role;
