-- Command Center isolation test (migrations 022-027). Safe to run on the live database: it creates its
-- own fixtures, checks who can see / do what, and ROLLS EVERYTHING BACK. Run it in the Supabase SQL editor;
-- the result is the "RESULT" message at the end (PASS, or a list of what failed).
--
-- Real data is ignored: it only looks at the test rows it creates itself (titles A1-A6, tickets K1-K3).
--
-- It needs: one school with a teacher AND a school admin, a second school, one student, and the platform owner.
begin;

do $$
declare
  t uuid; a uuid; s uuid; o uuid; sch uuid; other uuid;
  an1 uuid; an2 uuid; an3 uuid; an4 uuid; an5 uuid; an6 uuid; k1 uuid; k2 uuid; k3 uuid;
  p text; who uuid; fails text := ''; checks int := 0; n int;
  got_ann text; got_tix text; got_audit int; got_flags int; got_views int; got_events boolean;
  exp_ann text; exp_tix text; exp_views int; chain_ok boolean;
  got_exp text; exp_exp text; ghost uuid := gen_random_uuid();
begin
  select u.id, u.school_id into t, sch from users u
   where u.role = 'teacher' and exists (select 1 from users x where x.role = 'super_admin' and x.school_id = u.school_id) limit 1;
  select id into a from users where role = 'super_admin' and school_id = sch limit 1;
  select id into s from users where role = 'student' limit 1;
  select id into o from users where role = 'platform_owner' limit 1;
  select id into other from schools where id <> sch limit 1;
  if t is null or a is null or s is null or o is null or other is null then
    raise exception 'SKIPPED: needs a teacher + admin in one school, a second school, a student and the owner';
  end if;

  -- fixtures (made as the database owner, rolled back at the end)
  insert into announcements (title, body) values ('A1', 'b') returning id into an1;
  insert into announcements (title, body, audience) values ('A2', 'b', 'admins') returning id into an2;
  insert into announcements (title, body, all_schools) values ('A3', 'b', false) returning id into an3;
  insert into announcement_schools values (an3, other);
  insert into announcements (title, body, ended_at) values ('A4', 'b', now()) returning id into an4;
  insert into announcements (title, body, starts_at) values ('A5', 'b', now() + interval '1 day') returning id into an5;
  insert into announcements (title, body, audience, all_schools) values ('A6', 'b', 'teachers', false) returning id into an6;
  insert into announcement_schools values (an6, sch);
  insert into support_tickets (school_id, created_by, created_by_name, created_by_role, subject, message) values (sch, t, 'T', 'teacher', 'K1', 'm') returning id into k1;
  insert into support_tickets (school_id, created_by, created_by_name, created_by_role, subject, message) values (sch, a, 'A', 'super_admin', 'K2', 'm') returning id into k2;
  insert into support_tickets (school_id, created_by, created_by_name, created_by_role, subject, message) values (other, null, 'X', 'teacher', 'K3', 'm') returning id into k3;
  insert into support_ticket_views (ticket_id, user_id) values (k1, t), (k1, a);
  insert into school_exports (school_id, school_name, school_code, requested_by_role, status) values (sch, 'X1', 'c1', 'super_admin', 'ready');
  insert into school_exports (school_id, school_name, school_code, requested_by_role, status) values (other, 'X2', 'c2', 'platform_owner', 'ready');
  insert into school_exports (school_id, school_name, school_code, requested_by_role, status) values (ghost, 'X3', 'c3', 'platform_owner', 'ready');  -- a school that no longer exists
  perform log_audit(null, null, 'test.entry', 'test', null, null, null, '{}'::jsonb);

  -- the audit log can never be changed, even by the database owner
  begin update audit_logs set action = action where id = (select min(id) from audit_logs); fails := fails || 'audit UPDATE allowed; '; exception when others then null; end;
  begin delete from audit_logs where id = (select min(id) from audit_logs); fails := fails || 'audit DELETE allowed; '; exception when others then null; end;
  begin truncate audit_logs; fails := fails || 'audit TRUNCATE allowed; '; exception when others then null; end;
  checks := checks + 3;
  select v.ok into chain_ok from verify_audit_chain() v;
  if chain_ok is not true then fails := fails || 'audit hash chain not intact; '; end if;
  checks := checks + 1;

  -- who can call the server-only functions / read the server-only tables
  if has_function_privilege('anon', 'log_audit(uuid,text,text,text,text,uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'log_audit(uuid,text,text,text,text,uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'verify_audit_chain()', 'execute')
     or has_function_privilege('authenticated', 'platform_telemetry(timestamptz,int)', 'execute')
     or has_function_privilege('authenticated', 'record_login_event(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'edit_announcement(uuid,text,text,text,text,boolean,uuid[],timestamptz,timestamptz,boolean)', 'execute')
     or has_function_privilege('authenticated', 'revoke_user_sessions(uuid)', 'execute') then
    fails := fails || 'a server-only function is callable from the browser; ';
  end if;
  checks := checks + 1;

  -- the buckets that hold private files must be private
  if exists (select 1 from storage.buckets where id in ('support-attachments', 'school-exports') and public) then fails := fails || 'a private bucket is public; '; end if;
  checks := checks + 1;

  -- what each kind of person sees
  foreach p in array array['teacher', 'admin', 'student', 'owner'] loop
    who := case p when 'teacher' then t when 'admin' then a when 'student' then s else o end;
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', who::text, true);
    set local role authenticated;
    got_ann    := coalesce((select string_agg(title, ',' order by title) from announcements where title in ('A1','A2','A3','A4','A5','A6')), '');
    got_tix    := coalesce((select string_agg(subject, ',' order by subject) from support_tickets where subject in ('K1','K2','K3')), '');
    select count(*) into got_audit from audit_logs;
    select count(*) into got_flags from platform_flags;
    select count(*) into got_views from support_ticket_views where ticket_id = k1;
    begin perform 1 from platform_events limit 1; got_events := true; exception when others then got_events := false; end;
    got_exp := coalesce((select string_agg(school_name, ',' order by school_name) from school_exports where school_name in ('X1','X2','X3')), '');
    reset role;

    exp_ann := case p when 'teacher' then 'A1,A6' when 'admin' then 'A1,A2' when 'student' then '' else 'A1,A2,A3,A4,A5,A6' end;
    exp_tix := case p when 'teacher' then 'K1' when 'admin' then 'K1,K2' when 'student' then '' else 'K1,K2,K3' end;
    if got_ann <> exp_ann then fails := fails || format('%s sees broadcasts [%s] expected [%s]; ', p, got_ann, exp_ann); end if;
    if got_tix <> exp_tix then fails := fails || format('%s sees tickets [%s] expected [%s]; ', p, got_tix, exp_tix); end if;
    if (p = 'owner') <> (got_audit > 0) then fails := fails || format('%s audit rows visible=%s; ', p, got_audit); end if;
    if (p = 'owner') <> (got_flags = 1) then fails := fails || format('%s platform_flags visible=%s; ', p, got_flags); end if;
    exp_views := case p when 'teacher' then 1 when 'admin' then 1 else 0 end;
    if got_views <> exp_views then fails := fails || format('%s sees %s "seen" rows; ', p, got_views); end if;
    if got_events then fails := fails || format('%s can read platform_events; ', p); end if;
    exp_exp := case p when 'admin' then 'X1' when 'owner' then 'X1,X2,X3' else '' end;
    if got_exp <> exp_exp then fails := fails || format('%s sees data exports [%s] expected [%s]; ', p, got_exp, exp_exp); end if;
    checks := checks + 8;
  end loop;

  -- what a teacher must NOT be able to do
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  begin insert into announcements (title, body) values ('X', 'y'); fails := fails || 'staff can create broadcasts; '; exception when others then null; end;
  begin insert into support_tickets (school_id, created_by_name, created_by_role, subject, message) values (sch, 'Z', 'teacher', 'Z', 'm'); fails := fails || 'staff can create tickets directly; '; exception when others then null; end;
  begin update support_tickets set status = 'resolved'; get diagnostics n = row_count; if n > 0 then fails := fails || 'staff can change tickets; '; end if; exception when others then null; end;
  begin update platform_flags set maintenance_mode = true; get diagnostics n = row_count; if n > 0 then fails := fails || 'staff can flip maintenance mode; '; end if; exception when others then null; end;
  begin insert into audit_logs (action, row_hash) values ('x', 'x'); fails := fails || 'staff can write the audit log; '; exception when others then null; end;
  begin insert into announcement_dismissals (announcement_id, user_id) values (an2, t); fails := fails || 'staff can dismiss a broadcast they cannot see; '; exception when others then null; end;
  begin insert into announcement_dismissals (announcement_id, user_id) values (an1, a); fails := fails || 'staff can dismiss for someone else; '; exception when others then null; end;
  begin insert into announcement_dismissals (announcement_id, user_id) values (an1, t); exception when others then fails := fails || 'staff cannot dismiss their own visible broadcast; '; end;
  begin insert into support_ticket_views (ticket_id, user_id) values (k2, t); fails := fails || 'staff can write "seen" rows; '; exception when others then null; end;
  begin insert into school_exports (school_id, school_name, school_code, requested_by_role) values (sch, 'Z', 'z', 'super_admin'); fails := fails || 'staff can create export records; '; exception when others then null; end;
  begin update school_exports set status = 'failed'; get diagnostics n = row_count; if n > 0 then fails := fails || 'staff can change export records; '; end if; exception when others then null; end;
  begin delete from school_exports; get diagnostics n = row_count; if n > 0 then fails := fails || 'staff can delete export records; '; end if; exception when others then null; end;
  reset role;
  checks := checks + 12;

  if fails = '' then
    raise notice 'RESULT: PASS (% checks)', checks;
  else
    raise notice 'RESULT: FAIL: %', fails;
  end if;
end $$;

rollback;
