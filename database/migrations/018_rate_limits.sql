-- 018 — Request counters for rate limiting public endpoints.
--
-- The app runs as serverless functions that can't remember anything between
-- requests, so counts live here. One row per "key" (for example
-- 'register:203.0.113.7'); a fixed time window per key. Only the server (service
-- role) can touch it — no school user and no visitor can read or edit it.
create table rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);
alter table rate_limits enable row level security;   -- no policies = service role only
revoke all on rate_limits from anon, authenticated;

-- Count one hit. Returns true while the caller is still within the allowance,
-- false once they've gone over. Atomic, so simultaneous requests can't slip
-- past the limit. Old windows reset themselves; stale rows are swept at random.
create or replace function rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_hits integer;
begin
  insert into rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits         = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;

  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_max;
end $$;

-- Look without counting: is this key already over its allowance in the current window?
create or replace function rate_limit_blocked(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select hits > p_max from rate_limits where key = p_key and window_start >= now() - make_interval(secs => p_window_seconds)),
    false
  );
$$;

revoke execute on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function rate_limit_blocked(text, integer, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;
grant execute on function rate_limit_blocked(text, integer, integer) to service_role;
