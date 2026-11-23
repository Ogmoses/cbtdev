-- 036 — "Has this student seen it?" for the bell (drives the dot on the notification bell).
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `notification_seen`: one row per (person, bell item) saying when that person last looked at it.
--     A student's bell dot lights up only for things that became relevant AFTER that moment.
--   * You can read only YOUR OWN rows. Nobody can write from the browser: the server records the view
--     when the student opens the bell or the Past Results page.
-- Rows disappear with their person (cascade).
create table if not exists notification_seen (
  user_id  uuid not null references users(id) on delete cascade,
  item_key text not null check (item_key in ('results', 'upcoming')),
  seen_at  timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table notification_seen enable row level security;

create policy notification_seen_own_read on notification_seen
  for select to authenticated using (user_id = auth.uid());

revoke all on notification_seen from anon, authenticated;
grant select on notification_seen to authenticated;      -- still gated by the policy above
