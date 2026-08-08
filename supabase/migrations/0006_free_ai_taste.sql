-- Give Free a taste of the paid model.
--
-- The built-in assistant is deterministic and runs in the browser, so it is
-- already unlimited on every tier at zero marginal cost. The metered thing is
-- the Haiku fallback in api/interpret.js — the one endpoint that costs money —
-- which only fires on the long tail the rules cannot parse.
--
-- Free was 0, which meant a free user never once saw the AND step in. That is
-- the wrong wall: the smart assist is the single best reason to upgrade, and
-- nobody upgrades for a feature they have never felt. So Free gets 25 assists a
-- month — enough to experience it and hit a wall worth paying past — while the
-- paid tiers stay unlimited, because the fallback fires so rarely that real
-- spend per paying user is a rounding error.
create or replace function plan_limit(p plan_tier, resource text) returns integer
language sql immutable set search_path = public as $$
  select case
    when resource = 'projects' then case when p = 'free' then 2   else null end
    when resource = 'tasks'    then case when p = 'free' then 15  else null end
    when resource = 'chats'    then case when p = 'free' then 25  else null end
    else 0
  end
$$;
