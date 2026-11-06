-- 031 — Manual term-based billing & negotiated pricing.
--
-- WHAT THIS DOES:
--   * `schools.subscription_status` ('trial' | 'active' | 'expired') and `schools.term_ends_at`: the school's access state.
--     These two are not secret (the school's own people see them to get the renewal notice), so they live on `schools`.
--     School admins can't change them: they can only update the six branding columns (012), and new columns
--     are not part of that grant.
--   * EXISTING schools become 'active' with no end date, so nobody is locked on day one (the column is added with
--     default 'active', which fills the existing rows, and the default for NEW schools is then switched to 'trial').
--   * `school_billing`: the negotiated fee, payment notes and the "reminder already sent" mark, in a PRIVATE table that
--     only the platform owner can read and only the server can write. They are NOT on `schools` on purpose:
--     every student and teacher can read their own school's row, and a fee or bank-transfer note must not be
--     readable by them.
--   * Five owner-set fields on `platform_settings` (already owner-only): the contact shown on the renewal notice
--     and in reminder emails, a short message, the currency symbol shown next to fees, and the owner's time zone
--     (so "access until 15 December" is the same day in emails, on the notice and on the owner's screen).
--   * `apply_school_billing()`: changes status / term end / fee / notes in ONE all-or-nothing step (server only).
--
-- A school is LOCKED when subscription_status = 'expired' (the manual lock), or when term_ends_at has passed.
-- Locking is enforced by the app (like maintenance mode), not by the database rules: no security rule is changed here.

alter table schools add column subscription_status text not null default 'active'
  check (subscription_status in ('trial', 'active', 'expired'));          -- fills existing rows with 'active'
alter table schools alter column subscription_status set default 'trial'; -- new schools start on a trial
alter table schools add column term_ends_at timestamptz;                  -- null = no end date (never auto-locks)

create table school_billing (
  school_id         uuid primary key references schools(id) on delete cascade,
  agreed_fee        numeric(14,2) check (agreed_fee is null or agreed_fee >= 0),
  payment_notes     text check (payment_notes is null or length(payment_notes) <= 1000),
  reminder_sent_for timestamptz,        -- the term_ends_at value a 7-day reminder was already sent for
  updated_at        timestamptz not null default now()
);

alter table school_billing enable row level security;
create policy school_billing_owner_read on school_billing
  for select to authenticated using (current_role_is('platform_owner'));
revoke all on school_billing from anon, authenticated;
grant select on school_billing to authenticated;          -- still gated by the policy above: owner only

alter table platform_settings
  add column billing_contact_email text check (billing_contact_email is null or length(billing_contact_email) <= 254),
  add column billing_contact_phone text check (billing_contact_phone is null or length(billing_contact_phone) <= 40),
  add column billing_message       text check (billing_message is null or length(billing_message) <= 500),
  add column billing_currency      text check (billing_currency is null or length(billing_currency) <= 8),
  add column billing_timezone      text check (billing_timezone is null or length(billing_timezone) <= 64);   -- e.g. Africa/Lagos: how dates are written in emails and notices

create or replace function apply_school_billing(p_school_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from schools where id = p_school_id) then
    raise exception 'school_not_found' using errcode = 'P0002';
  end if;

  if p_patch ? 'subscription_status' or p_patch ? 'term_ends_at' then
    update schools
       set subscription_status = coalesce(p_patch->>'subscription_status', subscription_status),
           term_ends_at = case when p_patch ? 'term_ends_at' then nullif(p_patch->>'term_ends_at', '')::timestamptz else term_ends_at end
     where id = p_school_id;
  end if;

  insert into school_billing (school_id) values (p_school_id) on conflict (school_id) do nothing;
  update school_billing
     set agreed_fee        = case when p_patch ? 'agreed_fee'     then nullif(p_patch->>'agreed_fee', '')::numeric else agreed_fee end,
         payment_notes     = case when p_patch ? 'payment_notes'  then nullif(p_patch->>'payment_notes', '')       else payment_notes end,
         reminder_sent_for = case when p_patch ? 'term_ends_at'   then null                                        else reminder_sent_for end,  -- a new end date earns a new reminder
         updated_at        = now()
   where school_id = p_school_id;
end $$;

revoke execute on function apply_school_billing(uuid, jsonb) from public, anon, authenticated;
grant  execute on function apply_school_billing(uuid, jsonb) to service_role;
