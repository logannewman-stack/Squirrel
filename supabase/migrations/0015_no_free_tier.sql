-- No free tier: `free` becomes the wall, not an offer.
--
-- Squirrel had a real free plan — one project, ten tasks, the whole planner on
-- one device. It does not any more. Every account now starts on a seven-day
-- trial with a card already given, and `free` is what an account becomes when
-- that trial ends without payment or a subscription lapses.
--
-- The enum value stays. A rename would be a migration touching every policy,
-- every function and every row for no behavioural gain, and `plan_tier` is
-- read in a dozen places that do not care what the state is called. What
-- changes is what it permits: nothing.
--
-- ## What this does not do
--
-- It does not delete anything. Somebody whose card expires keeps every
-- project, task, meeting and focus session exactly where they left it — the
-- caps below bite on *creating*, never on reading or keeping. An expired card
-- is a reason to stop serving somebody and has never been a reason to destroy
-- their week; they pay again and it is all still there.
--
-- ## The trial is not this state
--
-- Stripe holds a trialling subscription in `trialing`, which `api/_lib/billing`
-- already counts as entitled, so the webhook writes `pro` on day one and the
-- account is a paid account throughout. Nobody sits on `free` during a trial.
-- This tier is only ever reached by ending one.

create or replace function plan_limit(p plan_tier, resource text) returns integer
language sql immutable as $$
  select case
    -- Zero, not one. A lapsed account that can still create a project is a
    -- lapsed account that can keep working, and the old free tier's caps
    -- (1 project, 10 tasks) were generous enough to be a product.
    when resource = 'projects' then case p when 'free' then 0 when 'plus' then null else null end
    when resource = 'tasks'    then case p when 'free' then 0 else null end
    when resource = 'chats'    then case p when 'free' then 0 when 'plus' then 1000
                                           when 'pro' then 1000 when 'studio' then 3000 end
  end
$$;

comment on function plan_limit(plan_tier, text) is
  'How much of a resource a plan allows; null is unlimited. `free` means no live subscription and allows nothing new — existing work is untouched and still readable.';
