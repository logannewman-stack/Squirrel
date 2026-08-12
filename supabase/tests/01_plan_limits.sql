-- What each plan is actually allowed, proven against the database.
--
-- These numbers are the product's promise, and the database is where the
-- promise is kept — a client-side check is a suggestion. The expectations
-- below were written against the original tiers (free: 1 project / 10 tasks,
-- plus: 5 projects / 200 chats) and drifted when 0005 and 0009 moved them,
-- because this suite needs a local Postgres and quietly stopped being run.
-- They now match the shipping limits: free 2 / 15 / 0 chats, every paid tier
-- unlimited on projects and tasks, Pro and Plus 1,000 chats, Studio 3,000.
\set ON_ERROR_STOP off
\pset tuples_only on
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@x.com');
\set u '''11111111-1111-1111-1111-111111111111'''

-- FREE: two projects allowed
insert into projects (user_id, name) select :u, 'P'||g from generate_series(1,2) g;
select 'PASS  free allows 2 projects' where (select count(*) from projects) = 2;

-- FREE: third project blocked
do $$ begin
  insert into projects (user_id, name) values ('11111111-1111-1111-1111-111111111111','P3');
  raise notice 'FAIL  free allowed a 3rd project';
exception when check_violation then raise notice 'PASS  free blocks 3rd project';
end $$;

-- FREE: 15 open tasks allowed, 16th blocked
insert into tasks (user_id, title) select :u, 'T'||g from generate_series(1,15) g;
select 'PASS  free allows 15 tasks' where (select count(*) from tasks) = 15;
do $$ begin
  insert into tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111','T16');
  raise notice 'FAIL  free allowed a 16th task';
exception when check_violation then raise notice 'PASS  free blocks 16th task';
end $$;

-- FREE: completing a task frees a slot (the limit counts OPEN tasks)
update tasks set done = true where title = 'T1';
do $$ begin
  insert into tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111','T16');
  raise notice 'PASS  completing a task frees a slot';
exception when check_violation then raise notice 'FAIL  completed task still counted';
end $$;

-- FREE: no model-backed chats at all. The deterministic assistant is free and
-- unlimited; this meters only the paid boost.
select case when claim_assistant_chat(:u) then 'FAIL  free got a chat' else 'PASS  free blocked from assistant' end;

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
