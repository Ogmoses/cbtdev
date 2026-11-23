-- 035 — Each school's own timezone (used to show exam dates and times the way that school's clocks read).
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `schools.timezone`: an IANA name such as 'Africa/Lagos'. Existing and new schools default to Africa/Lagos.
--   * It is deliberately NOT added to the columns a school admin may update (see 012), so only the platform owner
--     (through the service role, from the owner console) can change it. Everyone in the school can read it.
alter table schools
  add column if not exists timezone text not null default 'Africa/Lagos'
  check (length(trim(timezone)) > 0 and length(timezone) <= 64);
