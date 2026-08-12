-- Every tier has a ceiling, because every chat is a model call billed to the
-- app's owner.
--
-- Pro and Studio were `null` — unlimited — which turned one enthusiastic
-- subscriber (or one scripted abuser) into an unbounded API bill. The app's
-- promise is that it never costs the owner per use: the deterministic parser
-- answers most messages for free on-device, and these ceilings only meter the
-- model-backed boost path. At current assistant pricing they cost at most a
-- few dollars of a much larger subscription, and an honest ceiling beats a
-- silent one: the client reads the same numbers from plans.js and warns as it
-- approaches.
create or replace function plan_limit(p plan_tier, resource text) returns integer
language sql immutable set search_path = public as $$
  select case
    when resource = 'projects' then case when p = 'free' then 2    else null end
    when resource = 'tasks'    then case when p = 'free' then 15   else null end
    when resource = 'chats'    then case p
                                      when 'free'   then 0
                                      when 'plus'   then 200
                                      when 'pro'    then 1000
                                      when 'studio' then 3000
                                    end
  end
$$;
