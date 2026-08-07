-- Recurring billing: the state a subscription needs, and a lock on it.
--
-- ## The lock, first, because it is a hole rather than a feature
--
-- `own profile update` in 0001 carries the comment "Plan and billing columns
-- are deliberately not writable here" — and does not implement it. Its check is
-- `with check (auth.uid() = id)`, which permits a signed-in user to update any
-- column on their own row, including `plan` and `plan_renews_at`. One call:
--
--     supabase.from('profiles').update({ plan: 'pro' }).eq('id', myId)
--
-- ...and the customer has Pro for nothing. Charging monthly is not worth much
-- while the thing being charged for can be granted by the person avoiding the
-- charge, so the guard goes in before any of the billing plumbing below.
--
-- Enforced with a trigger rather than a stricter policy on purpose: RLS checks
-- are per-statement conditions, easy to bypass by adding a new column later and
-- forgetting to list it. A trigger that restores the old values covers every
-- column named here regardless of what the statement asked for, and it fires
-- for every writer, including ones added after this migration.

alter table profiles
  add column if not exists billing_status   text,
  add column if not exists billing_alert    text,
  add column if not exists billing_event_at timestamptz;

comment on column profiles.billing_status is
  'Raw Stripe subscription status. The UI needs to tell "cancelled" from "card declined".';
comment on column profiles.billing_alert is
  'Set only when the customer must act. One thing for the UI to test, rather than a list of statuses to remember.';
comment on column profiles.billing_event_at is
  'event.created of the last applied billing event. Stripe does not guarantee delivery order.';

create or replace function guard_billing_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The webhook writes with the service role, which bypasses RLS but still
  -- fires triggers, so it has to be let through deliberately. Everything else
  -- — every end-user session — gets the billing columns put back as they were.
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  new.plan                   := old.plan;
  new.stripe_customer_id     := old.stripe_customer_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.apple_transaction_id   := old.apple_transaction_id;
  new.plan_renews_at         := old.plan_renews_at;
  new.billing_status         := old.billing_status;
  new.billing_alert          := old.billing_alert;
  new.billing_event_at       := old.billing_event_at;
  return new;
end $$;

drop trigger if exists profiles_guard_billing on profiles;
create trigger profiles_guard_billing
  before update on profiles
  for each row execute function guard_billing_columns();

-- The comment in 0001 described this intent; now something implements it.
comment on function guard_billing_columns() is
  'Reverts billing columns on any update not made by the service role. The RLS policy alone permits them.';
