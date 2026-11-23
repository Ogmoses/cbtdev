-- 037 — When a result was published (so the bell can tell a NEWLY published result from an old one).
--
-- WHAT THIS DOES (purely additive — nothing existing is touched):
--   * `results.published_at`: set automatically at the moment `published` becomes true, cleared if it goes back to false.
--   * Results that are already published get their creation time as a best estimate (the true moment wasn't recorded).
--   * No page or route has to change how it publishes: a small trigger does it.
alter table results add column if not exists published_at timestamptz;

update results set published_at = created_at where published and published_at is null;

create or replace function results_set_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.published then
    if tg_op = 'INSERT' then
      new.published_at := coalesce(new.published_at, now());
    elsif old.published is not true then
      new.published_at := now();
    end if;
  else
    new.published_at := null;
  end if;
  return new;
end $$;

drop trigger if exists results_published_at on results;
create trigger results_published_at
  before insert or update of published on results
  for each row execute function results_set_published_at();
