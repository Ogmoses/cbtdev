-- 022 — Platform audit log: a tamper-evident, append-only record of owner-level actions.
--
-- WHAT THIS DOES (purely additive — no existing table, policy or row is touched):
--   1. `audit_logs` table. Rows can be ADDED but never changed or removed:
--        - triggers reject UPDATE, DELETE and TRUNCATE for everyone (even the service role),
--        - UPDATE/DELETE/TRUNCATE are also revoked from every API role.
--   2. A hash chain: each row stores the previous row's hash and its own hash, so any
--      edit made some other way (e.g. directly on the database) is detectable.
--   3. `log_audit()` — the ONLY way rows get written (service role / server only).
--   4. `verify_audit_chain()` — re-checks the whole chain (service role / server only).
--   5. Only the platform owner can READ the log.
--
-- school_id / actor_id deliberately have NO foreign keys: deleting a school or an
-- account must never erase or block its history. school_name is stored as a snapshot.

create sequence audit_logs_id_seq;

create table audit_logs (
  id          bigint primary key default nextval('audit_logs_id_seq'),
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null check (length(trim(action)) > 0),   -- e.g. 'school.approve'
  target_type text,                                              -- e.g. 'school'
  target_id   text,
  school_id   uuid,
  school_name text,
  details     jsonb not null default '{}'::jsonb,
  prev_hash   text,
  row_hash    text not null
);
alter sequence audit_logs_id_seq owned by audit_logs.id;

create index idx_audit_logs_created_at on audit_logs (created_at desc);
create index idx_audit_logs_action     on audit_logs (action);
create index idx_audit_logs_school     on audit_logs (school_id);

-- ------------------------------------------------------------ access
alter table audit_logs enable row level security;

create policy audit_logs_owner_read on audit_logs
  for select to authenticated using (current_role_is('platform_owner'));

revoke all on audit_logs from anon, authenticated;
grant select on audit_logs to authenticated;            -- still gated by the policy above
revoke update, delete, truncate on audit_logs from service_role;
revoke usage, select, update on sequence audit_logs_id_seq from anon, authenticated;

-- ------------------------------------------------------------ append-only
create or replace function audit_logs_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'audit_logs is append-only: % is not allowed', tg_op using errcode = '42501';
end $$;

create trigger audit_logs_no_change before update or delete on audit_logs
  for each row execute function audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function audit_logs_immutable();

revoke execute on function audit_logs_immutable() from public, anon, authenticated;

-- ------------------------------------------------------------ hash chain
create or replace function audit_row_hash(
  p_prev text, p_id bigint, p_created_at timestamptz, p_actor_id uuid, p_actor_email text,
  p_action text, p_target_type text, p_target_id text, p_school_id uuid, p_school_name text, p_details jsonb
) returns text
language sql stable set search_path = public as $$
  select encode(sha256(convert_to(concat_ws('|',
    coalesce(p_prev, ''),
    p_id::text,
    to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(p_actor_id::text, ''),
    coalesce(p_actor_email, ''),
    p_action,
    coalesce(p_target_type, ''),
    coalesce(p_target_id, ''),
    coalesce(p_school_id::text, ''),
    coalesce(p_school_name, ''),
    p_details::text
  ), 'UTF8')), 'hex');
$$;

-- Writes one entry. A lock keeps simultaneous writers from forking the chain.
create or replace function log_audit(
  p_actor_id uuid, p_actor_email text, p_action text, p_target_type text, p_target_id text,
  p_school_id uuid, p_school_name text, p_details jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_prev    text;
  v_id      bigint;
  v_at      timestamptz := clock_timestamp();
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  perform pg_advisory_xact_lock(hashtext('audit_logs_chain'));
  select row_hash into v_prev from audit_logs order by id desc limit 1;
  v_id := nextval('audit_logs_id_seq');
  insert into audit_logs (id, created_at, actor_id, actor_email, action, target_type, target_id, school_id, school_name, details, prev_hash, row_hash)
  values (
    v_id, v_at, p_actor_id, p_actor_email, p_action, p_target_type, p_target_id, p_school_id, p_school_name, v_details, v_prev,
    audit_row_hash(v_prev, v_id, v_at, p_actor_id, p_actor_email, p_action, p_target_type, p_target_id, p_school_id, p_school_name, v_details)
  );
  return v_id;
end $$;

-- Re-checks every link. ok = true when nothing has been altered; otherwise broken_at is the first bad row.
create or replace function verify_audit_chain()
returns table (ok boolean, checked bigint, broken_at bigint)
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_prev text := null;
  n      bigint := 0;
begin
  for r in select * from audit_logs order by id loop
    if r.prev_hash is distinct from v_prev
       or r.row_hash <> audit_row_hash(r.prev_hash, r.id, r.created_at, r.actor_id, r.actor_email, r.action, r.target_type, r.target_id, r.school_id, r.school_name, r.details) then
      return query select false, n, r.id;
      return;
    end if;
    v_prev := r.row_hash;
    n := n + 1;
  end loop;
  return query select true, n, null::bigint;
end $$;

-- Server only: same pattern as 018/021.
revoke execute on function audit_row_hash(text, bigint, timestamptz, uuid, text, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function log_audit(uuid, text, text, text, text, uuid, text, jsonb)  from public, anon, authenticated;
revoke execute on function verify_audit_chain()                                         from public, anon, authenticated;
grant  execute on function audit_row_hash(text, bigint, timestamptz, uuid, text, text, text, text, uuid, text, jsonb) to service_role;
grant  execute on function log_audit(uuid, text, text, text, text, uuid, text, jsonb)  to service_role;
grant  execute on function verify_audit_chain()                                         to service_role;
