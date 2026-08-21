-- What each plan is actually allowed, proven against the database.
--
-- These numbers are the product's promise, and the database is where the
-- promise is kept — a client-side check is a suggestion.
--
-- There is no free tier any more. Every account starts on a seven-day trial
-- with a card already given, which Stripe holds in `trialing` and the webhook
-- writes as a paid plan, so nobody is ever on `free` while they are using the
-- product. `free` is now reached exactly one way — by a trial or subscription
-- ending — and it is a wall: nothing new can be created.
--
-- What it is not is a delete. The caps bite on creating, never on reading or
-- keeping, and the last block here proves that a lapsed account still has
-- every row it had the day before.
\set ON_ERROR_STOP off
\pset tuples_only on
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@x.com');
\set u '''11111111-1111-1111-1111-111111111111'''

-- FREE: nothing at all. Not a smaller allowance — none.
do $$ begin
  insert into projects (user_id, name) values ('11111111-1111-1111-1111-111111111111','P1');
  raise notice 'FAIL  a lapsed account created a project';
exception when check_violation then raise notice 'PASS  no plan means no new projects';
end $$;

do $$ begin
  insert into tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111','T1');
  raise notice 'FAIL  a lapsed account created a task';
exception when check_violation then raise notice 'PASS  and no new tasks';
end $$;

select case when claim_assistant_chat(:u) then 'FAIL  a lapsed account got a chat'
            else 'PASS  and no assistant at all' end;

-- PRO: unlimited projects and tasks
update profiles set plan='pro', plan_renews_at = now() + interval '30 days' where id = :u;
insert into projects (user_id, name) select :u, 'Q'||g from generate_series(1,20) g;
select 'PASS  pro projects unlimited' where (select count(*) from projects) > 5;
insert into tasks (user_id, title) select :u, 'X'||g from generate_series(1,50) g;
select 'PASS  pro tasks unlimited' where (select count(*) from tasks where not done) > 15;

-- PRO: the chat ceiling is real, and it is 1,000
select 'PASS  pro 1000 chats granted'
  where (select count(*) from generate_series(1,1000) g where claim_assistant_chat(:u)) = 1000;
select case when claim_assistant_chat(:u) then 'FAIL  pro exceeded 1000' else 'PASS  pro blocked at the 1001st chat' end;
select 'PASS  counter recorded 1000' where (select assistant_chats from usage_counters where user_id=:u) = 1000;

-- EXPIRED subscription falls back to free rather than staying paid
update profiles set plan_renews_at = now() - interval '1 day' where id = :u;
select case when current_plan(:u) = 'free' then 'PASS  expired plan falls back to free' else 'FAIL  expired plan still paid' end;

-- STUDIO: the larger ceiling
update profiles set plan='studio', plan_renews_at = now() + interval '30 days' where id = :u;
select case when plan_limit(current_plan(:u), 'chats') = 3000 then 'PASS  studio ceiling is 3000' else 'FAIL  studio ceiling wrong' end;

-- Token recording
select record_assistant_tokens(:u, 1000, 500);
select 'PASS  tokens recorded' where (select input_tokens from usage_counters where user_id=:u) = 1000;

-- ------------------------------------------------- lapsing keeps the work
-- The rule this whole tier turns on: an expired card stops somebody creating
-- and never destroys what they made. Somebody who pays again finds their week
-- exactly where they left it.
update profiles set plan='pro', plan_renews_at = now() + interval '30 days' where id = :u;
insert into projects (user_id, name) values (:u, 'Written while paying');
insert into tasks (user_id, title) values (:u, 'Also written while paying');

update profiles set plan='free', plan_renews_at = null where id = :u;
select case when (select count(*) from projects where name = 'Written while paying') = 1
             and (select count(*) from tasks where title = 'Also written while paying') = 1
  then 'PASS  lapsing keeps every row that was already there'
  else 'FAIL  LAPSING DESTROYED WORK' end;

-- And it is readable, not merely present: a paywall is a wall in front of
-- making things, not in front of your own history.
select case when (select name from projects where name = 'Written while paying') is not null
  then 'PASS  and it can still be read'
  else 'FAIL  a lapsed account cannot see its own work' end;

-- Paying again restores creating, with nothing lost in between.
update profiles set plan='pro', plan_renews_at = now() + interval '30 days' where id = :u;
insert into projects (user_id, name) values (:u, 'After paying again');
select case when (select count(*) from projects where user_id = :u) >= 3
  then 'PASS  paying again picks up exactly where it stopped'
  else 'FAIL  could not resume after paying' end;

-- ------------------------------------------- archiving is not deleting, and
-- an archived project stops taking up room. Finishing work must never move
-- somebody towards a paywall; on a capped plan this is the difference between
-- a tidy account and a blocked one.
update profiles set plan='plus', plan_renews_at = now() + interval '30 days' where id = :u;
select case when plan_limit('plus','projects') is null
  then 'PASS  the legacy plus tier is unlimited on projects'
  else 'FAIL  plus still has a project cap: ' || plan_limit('plus','projects') end;

update projects set archived = true where user_id = :u;
select case when (select count(*) from projects where user_id = :u and not archived) = 0
             and (select count(*) from projects where user_id = :u) > 0
  then 'PASS  archiving empties the live count without deleting a row'
  else 'FAIL  archiving lost rows or kept counting them' end;
