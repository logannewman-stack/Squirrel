-- A third tier, and the free caps that go with the pricing page.
--
-- Studio sits above Pro. It needs no new limit rows — every paid tier is
-- unlimited on projects, tasks, and chats — so the enum value is all the
-- database needs; what Studio *adds* (teammates, shared client projects) is
-- feature access, enforced where those features live, not a number here.
--
-- `add value` cannot be referenced in the same transaction it is created in, so
-- nothing below names 'studio' literally: plan_limit routes every non-free
-- tier through its `else` branch, and current_plan only ever compares against
-- 'free'. That keeps this migration safe to run as a single script.

alter type plan_tier add value if not exists 'studio';

-- Free was 1 project / 10 tasks; the pricing page now offers 2 / 15, so the
-- enforced limit has to match the promise. Plus is folded into the unlimited
-- tiers, matching src/lib/plans.js where it is an alias of Pro.
create or replace function plan_limit(p plan_tier, resource text) returns integer
language sql immutable set search_path = public as $$
  select case
    when resource = 'projects' then case when p = 'free' then 2   else null end
    when resource = 'tasks'    then case when p = 'free' then 15  else null end
    when resource = 'chats'    then case when p = 'free' then 0   else null end
    else 0
  end
$$;
