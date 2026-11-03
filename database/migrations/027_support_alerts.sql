-- 027 — "Has this person seen the update?" for support tickets (drives the bell and the sidebar dot).
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `support_ticket_views`: one row per (ticket, person) saying when that person last looked at the
--     ticket's list. A school admin / teacher is alerted about a ticket when the owner has moved it to
--     "in progress" or "resolved" (or replied) AFTER the last time they viewed it.
--   * You can read only YOUR OWN rows. Nobody can write from the browser: the server records a view
--     when the person opens Help & Support.
--   * The owner needs no such table: the owner is alerted for as long as a ticket is open or in progress.
--
-- Rows disappear with their ticket or their person (cascade).

create table support_ticket_views (
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

alter table support_ticket_views enable row level security;

create policy support_views_own_read on support_ticket_views
  for select to authenticated using (user_id = auth.uid());

revoke all on support_ticket_views from anon, authenticated;
grant select on support_ticket_views to authenticated;      -- still gated by the policy above
