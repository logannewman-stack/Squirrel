-- Companies: the plan travels, the privacy holds.
--
-- Two questions, and the second one is the product. First: does a seat
-- actually confer the plan a company paid for, and stop conferring it when
-- they stop paying? Second, and the one worth the most: can an admin — the
-- person who bought the seats, who invited everybody, who holds the billing
-- relationship — read a single row of an employee's actual work?
--
-- The answer has to be no, in the database, provably, or the sentence "your
-- company pays for it, your company cannot see it" is marketing rather than
-- architecture. Everything below the seat tests exists to prove that sentence.
\set ON_ERROR_STOP off
\pset tuples_only on

\set boss '''aaaaaaaa-0000-4000-8000-000000000001'''
\set emp  '''aaaaaaaa-0000-4000-8000-000000000002'''
\set rando '''aaaaaaaa-0000-4000-8000-000000000003'''
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001','boss@acme.com'),
  ('aaaaaaaa-0000-4000-8000-000000000002','emp@acme.com'),
  ('aaaaaaaa-0000-4000-8000-000000000003','nobody@else.com');

-- A company on Studio with three seats, bought and paid until next month.
insert into organizations (id, name, plan, seats, plan_renews_at)
values ('bbbbbbbb-0000-4000-8000-000000000001','Acme','studio',3, now() + interval '30 days');
\set org '''bbbbbbbb-0000-4000-8000-000000000001'''

insert into org_members (org_id, user_id, role) values (:org, :boss, 'admin');
insert into org_members (org_id, user_id, role) values (:org, :emp,  'member');

-- ------------------------------------------------------- the plan travels
select case when current_plan(:emp) = 'studio'
  then 'PASS  a seat confers the company plan'
  else 'FAIL  seat-holder did not get the plan: ' || current_plan(:emp) end;

select case when current_plan(:rando) = 'free'
  then 'PASS  somebody outside the company gets nothing'
  else 'FAIL  outsider inherited a plan' end;

-- A personal subscription and a company seat: the better of the two, and
-- neither cancels the other.
update profiles set plan='pro', plan_renews_at = now() + interval '30 days' where id = :emp;
select case when current_plan(:emp) = 'studio'
  then 'PASS  the better of personal and company wins'
  else 'FAIL  got ' || current_plan(:emp) end;

-- The company stops paying: the seat stops conferring, the personal plan stands.
update organizations set plan_renews_at = now() - interval '1 day' where id = :org;
select case when current_plan(:emp) = 'pro'
  then 'PASS  an unpaid company confers nothing, and personal survives'
  else 'FAIL  got ' || current_plan(:emp) end;

-- And with no personal plan either, they are free again — not stranded on a
-- tier nobody is paying for.
update profiles set plan='free', plan_renews_at = null where id = :emp;
select case when current_plan(:emp) = 'free'
  then 'PASS  no payer, no plan'
  else 'FAIL  got ' || current_plan(:emp) end;
update organizations set plan_renews_at = now() + interval '30 days' where id = :org;

-- ------------------------------------------------------------- the seats
-- Three seats, two taken. The third is fine; the fourth is refused at the
-- moment of adding rather than silently over-running the subscription.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000004','third@acme.com'),
  ('aaaaaaaa-0000-4000-8000-000000000005','fourth@acme.com');
insert into org_members (org_id, user_id) values (:org,'aaaaaaaa-0000-4000-8000-000000000004');
select 'PASS  the third seat is available' where (select count(*) from org_members where org_id = :org) = 3;

do $$ begin
  insert into org_members (org_id, user_id)
  values ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000005');
  raise notice 'FAIL  a fourth person took a third seat';
exception when others then raise notice 'PASS  no seats left is refused, not absorbed';
end $$;

-- ------------------------------------------------- the privacy, under RLS
-- Everything above ran as the table owner, which bypasses RLS. From here the
-- session is a real signed-in user, because that is the only way these
-- policies mean anything.
insert into projects (id, user_id, name)
  values ('cccccccc-0000-4000-8000-000000000001', :emp, 'Employee salary review');
insert into tasks (user_id, title) values (:emp, 'Ask for a raise');
insert into events (user_id, title, starts_at, ends_at)
  values (:emp, 'Interview elsewhere', now(), now() + interval '1 hour');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';   -- the boss
set request.jwt.claim.email = 'boss@acme.com';

select case when (select count(*) from projects) = 0
  then 'PASS  an admin cannot read a member''s projects'
  else 'FAIL  ADMIN READ A MEMBER PROJECT' end;
select case when (select count(*) from tasks) = 0
  then 'PASS  nor their tasks'
  else 'FAIL  ADMIN READ A MEMBER TASK' end;
select case when (select count(*) from events) = 0
  then 'PASS  nor their calendar'
  else 'FAIL  ADMIN READ A MEMBER EVENT' end;

-- What an admin *can* see: the seat. Presence, not contents.
select case when (select count(*) from org_members where org_id = :org) = 3
  then 'PASS  an admin sees who holds a seat'
  else 'FAIL  admin cannot see the roster' end;
select case when (select name from organizations where id = :org) = 'Acme'
  then 'PASS  and the company itself'
  else 'FAIL  admin cannot read the org' end;

-- Billing is the webhook's, even for the person who pays it. Buying more
-- seats goes through Stripe, not through an UPDATE.
update organizations set seats = 99, plan = 'studio' where id = :org;
reset role;
reset request.jwt.claim.sub;
select case when (select seats from organizations where id = :org) = 3
  then 'PASS  an admin cannot grant themselves seats'
  else 'FAIL  SEATS WRITABLE BY A CLIENT' end;

-- A member is not an admin: they see the roster they are on, and change
-- nothing. The company is given a spare seat first, deliberately — with the
-- seats full, the seat trigger refuses the insert before RLS is ever
-- consulted, and the test would pass while proving nothing about the policy.
update organizations set seats = 4 where id = :org;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002';   -- the employee
set request.jwt.claim.email = 'emp@acme.com';
select case when (select count(*) from org_members where org_id = :org) = 3
  then 'PASS  a member sees their colleagues'' seats'
  else 'FAIL  member cannot see the roster' end;
-- A refused INSERT raises rather than returning zero rows, so the expectation
-- is written as a caught exception. Letting it escape would abort the script
-- and look identical to a broken test.
do $$ begin
  insert into org_members (org_id, user_id)
    values ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000005');
  raise notice 'FAIL  MEMBER ADDED A SEAT';
exception
  when insufficient_privilege then raise notice 'PASS  a member cannot hand out a seat even when one is free';
  when others then raise notice 'PASS  a member cannot hand out a seat even when one is free';
end $$;

-- And an outsider sees no company at all.
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000003';
set request.jwt.claim.email = 'nobody@else.com';
select case when (select count(*) from organizations) = 0 and (select count(*) from org_members) = 0
  then 'PASS  an outsider sees no company and no roster'
  else 'FAIL  OUTSIDER READ THE ORG' end;

-- --------------------------------------------------------- the invitation
reset role;
reset request.jwt.claim.sub;
insert into org_invites (org_id, email, invited_by) values (:org, 'Fourth@Acme.com', :boss);

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000005';
set request.jwt.claim.email = 'fourth@acme.com';
select case when (select count(*) from org_invites) = 1
  then 'PASS  an invited person can see their own invitation, whatever the case'
  else 'FAIL  invitee cannot see their invitation' end;

set request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000003';
set request.jwt.claim.email = 'nobody@else.com';
select case when (select count(*) from org_invites) = 0
  then 'PASS  and nobody else can'
  else 'FAIL  A STRANGER READ AN INVITATION' end;

reset role;
reset request.jwt.claim.sub;
reset request.jwt.claim.email;
