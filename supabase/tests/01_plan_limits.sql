\set ON_ERROR_STOP off
\pset tuples_only on
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','a@x.com');
\set u '''11111111-1111-1111-1111-111111111111'''

-- FREE: 1 project allowed
insert into projects (user_id, name) values (:u, 'P1');
select 'PASS  free allows 1st project' where (select count(*) from projects) = 1;

-- FREE: 2nd project blocked
do $$ begin
  insert into projects (user_id, name) values ('11111111-1111-1111-1111-111111111111','P2');
  raise notice 'FAIL  free allowed a 2nd project';
exception when check_violation then raise notice 'PASS  free blocks 2nd project';
end $$;

-- FREE: 10 open tasks allowed, 11th blocked
insert into tasks (user_id, title) select :u, 'T'||g from generate_series(1,10) g;
select 'PASS  free allows 10 tasks' where (select count(*) from tasks) = 10;
do $$ begin
  insert into tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111','T11');
  raise notice 'FAIL  free allowed an 11th task';
exception when check_violation then raise notice 'PASS  free blocks 11th task';
end $$;

-- FREE: completing a task frees a slot (limit counts OPEN tasks)
update tasks set done = true where title = 'T1';
do $$ begin
  insert into tasks (user_id, title) values ('11111111-1111-1111-1111-111111111111','T11');
  raise notice 'PASS  completing a task frees a slot';
exception when check_violation then raise notice 'FAIL  completed task still counted';
end $$;

-- FREE: assistant is gated to zero chats
select case when claim_assistant_chat(:u) then 'FAIL  free got a chat' else 'PASS  free blocked from assistant' end;

-- PLUS: 5 projects, unlimited tasks, 200 chats
update profiles set plan='plus', plan_renews_at = now() + interval '30 days' where id = :u;
insert into projects (user_id, name) select :u, 'P'||g from generate_series(2,5) g;
select 'PASS  plus allows 5 projects' where (select count(*) from projects) = 5;
do $$ begin
  insert into projects (user_id, name) values ('11111111-1111-1111-1111-111111111111','P6');
  raise notice 'FAIL  plus allowed a 6th project';
exception when check_violation then raise notice 'PASS  plus blocks 6th project';
end $$;
insert into tasks (user_id, title) select :u, 'X'||g from generate_series(1,50) g;
select 'PASS  plus tasks unlimited' where (select count(*) from tasks where not done) > 10;

-- PLUS: chat counter stops at exactly 200
select 'PASS  plus 200 chats granted' where (select count(*) from generate_series(1,200) g where claim_assistant_chat(:u)) = 200;
select case when claim_assistant_chat(:u) then 'FAIL  plus exceeded 200' else 'PASS  plus blocked at 201st chat' end;
select 'PASS  counter recorded 200' where (select assistant_chats from usage_counters where user_id=:u) = 200;

-- EXPIRED subscription must fall back to free
update profiles set plan_renews_at = now() - interval '1 day' where id = :u;
select case when current_plan(:u) = 'free' then 'PASS  expired plan falls back to free' else 'FAIL  expired plan still paid' end;

-- PRO: unlimited projects and chats
update profiles set plan='pro', plan_renews_at = now() + interval '30 days' where id = :u;
insert into projects (user_id, name) select :u, 'Q'||g from generate_series(1,20) g;
select 'PASS  pro projects unlimited' where (select count(*) from projects) > 5;
select case when claim_assistant_chat(:u) then 'PASS  pro chats unlimited' else 'FAIL  pro chat blocked' end;

-- Token recording
select record_assistant_tokens(:u, 1000, 500);
select 'PASS  tokens recorded' where (select input_tokens from usage_counters where user_id=:u) = 1000;
