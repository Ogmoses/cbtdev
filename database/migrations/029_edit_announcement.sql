-- 029 — Edit a broadcast (all-or-nothing).
--
-- WHAT THIS DOES (purely additive — one new function, no table or rule is changed):
--   * `edit_announcement()` changes a broadcast's content, audience, target schools, schedule and end time
--     in ONE step, so a half-finished edit can never leave a broadcast pointing at the wrong schools.
--   * Optionally clears everyone's "I closed this" marks (p_reshow) so people who already dismissed it see it again.
--   * Refuses to edit a broadcast that has already ended (to send it again, use "Reuse", which makes a new one).
--   * Server only (service role): the owner API writes the audit record first, then calls this.
create or replace function edit_announcement(
  p_id          uuid,
  p_title       text,
  p_body        text,
  p_severity    text,
  p_audience    text,
  p_all_schools boolean,
  p_school_ids  uuid[],
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_reshow      boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row announcements%rowtype;
begin
  select * into v_row from announcements where id = p_id for update;
  if not found then
    raise exception 'broadcast_not_found' using errcode = 'P0002';
  end if;
  if v_row.ended_at is not null or (v_row.ends_at is not null and v_row.ends_at <= now()) then
    raise exception 'broadcast_ended' using errcode = 'P0001';
  end if;
  if not p_all_schools and coalesce(array_length(p_school_ids, 1), 0) = 0 then
    raise exception 'broadcast_needs_schools' using errcode = 'P0001';
  end if;

  update announcements
     set title = p_title, body = p_body, severity = p_severity, audience = p_audience,
         all_schools = p_all_schools, starts_at = p_starts_at, ends_at = p_ends_at
   where id = p_id;

  delete from announcement_schools where announcement_id = p_id;
  if not p_all_schools then
    insert into announcement_schools (announcement_id, school_id)
    select p_id, s from unnest(p_school_ids) as s;
  end if;

  if p_reshow then
    delete from announcement_dismissals where announcement_id = p_id;
  end if;
end $$;

revoke execute on function edit_announcement(uuid, text, text, text, text, boolean, uuid[], timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant  execute on function edit_announcement(uuid, text, text, text, text, boolean, uuid[], timestamptz, timestamptz, boolean) to service_role;
