-- Seeing your team is Studio, and the schema is where that is decided.
--
-- 03 proves the shape of enterprise visibility: admins read, colleagues do
-- not, nobody writes, the transcript stays shut. This file proves the price
-- of it. The distinction matters commercially — a company on Pro buys a plan
-- for everybody and nothing more, and a component that merely declines to
-- draw the button is not a gate, because the same rows come back to anybody
-- willing to open a network tab.
--
-- Four states, and the plan must travel through all of them, because the
-- failure worth catching is gating too much: an org that stops conferring Pro
-- because it is not Studio has broken the thing companies actually pay for.
\set ON_ERROR_STOP off
\pset tuples_only on

\set boss '''dddddddd-0000-4000-8000-000000000001'''
\set emp  '''dddddddd-0000-4000-8000-000000000002'''
insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001','chief@modest.co'),
  ('dddddddd-0000-4000-8000-000000000002','worker@modest.co');

-- A company on Pro: seats bought, paid, everybody entitled.
insert into organizations (id, name, plan, seats, plan_renews_at)
values ('eeeeeeee-0000-4000-8000-000000000001','Modest Co','pro',4, now() + interval '30 days');
\set org '''eeeeeeee-0000-4000-8000-000000000001'''
insert into org_members (org_id, user_id, role) values (:org, :boss, 'admin');
insert into org_members (org_id, user_id, role) values (:org, :emp,  'member');

insert into projects (id, user_id, name)
  values ('ffffffff-0000-4000-8000-000000000001', :emp, 'Warehouse move');
insert into tasks (user_id, title) values (:emp, 'Book the van');
insert into events (user_id, title, starts_at, ends_at)
  values (:emp, 'Site visit', now(), now() + interval '1 hour');

-- ------------------------------------------------ Pro: the plan, not the window
select case when current_plan(:emp) = 'pro'
  then 'PASS  a Pro seat still confers Pro'
  else 'FAIL  gating visibility broke the plan: ' || current_plan(:emp) end;

set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';   -- the boss
set request.jwt.claim.email = 'chief@modest.co';

select case when (select count(*) from projects where user_id = :emp) = 0
             and (select count(*) from tasks    where user_id = :emp) = 0
             and (select count(*) from events   where user_id = :emp) = 0
  then 'PASS  a Pro company''s admin reads none of a member''s work'
  else 'FAIL  VISIBILITY LEAKED BELOW STUDIO' end;

select case when (select count(*) from profiles where id = :emp) = 0
  then 'PASS  nor their account details'
  else 'FAIL  PRO ADMIN READ A MEMBER PROFILE' end;

-- The roster is not the gate. Seats, invitations and the company itself come
-- with any paid plan — that is the administration a company buys at Pro.
select case when (select count(*) from org_members where org_id = :org) = 2
             and (select name from organizations where id = :org) = 'Modest Co'
  then 'PASS  but still sees the roster and the company'
  else 'FAIL  gating visibility took the roster away too' end;

reset role;
reset request.jwt.claim.sub;
reset request.jwt.claim.email;

-- The member is told nothing, because there is nothing to tell. A warning
-- about surveillance that is not happening costs the same trust as the
-- surveillance would.
select case when not is_managed(:emp)
  then 'PASS  a Pro company''s member is not told they are watched'
  else 'FAIL  FALSE DISCLOSURE ON A TIER WITH NO VISIBILITY' end;

-- ------------------------------------------------------ Studio: the window opens
update organizations set plan = 'studio' where id = :org;

set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
set request.jwt.claim.email = 'chief@modest.co';

select case when (select count(*) from projects where user_id = :emp) = 1
             and (select count(*) from tasks    where user_id = :emp) = 1
             and (select count(*) from events   where user_id = :emp) = 1
  then 'PASS  upgrading to Studio opens the same window 0013 described'
  else 'FAIL  Studio admin still cannot read member work' end;

reset role;
reset request.jwt.claim.sub;
reset request.jwt.claim.email;

select case when is_managed(:emp)
  then 'PASS  and the member is told, on the tier where it is true'
  else 'FAIL  Studio member was not told their account is managed' end;

-- --------------------------------------------------- lapsed: the window closes
-- Not merely an unpaid invoice. Reading somebody's work after the company
-- stopped paying for the right to is a privacy problem that outlives the
-- billing one, so it ends the moment the subscription does.
update organizations set plan_renews_at = now() - interval '1 day' where id = :org;

set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
set request.jwt.claim.email = 'chief@modest.co';
select case when (select count(*) from projects where user_id = :emp) = 0
             and (select count(*) from tasks    where user_id = :emp) = 0
  then 'PASS  a lapsed subscription closes the window'
  else 'FAIL  LAPSED COMPANY STILL READING MEMBER WORK' end;

reset role;
reset request.jwt.claim.sub;
reset request.jwt.claim.email;

select case when not is_managed(:emp)
  then 'PASS  and the disclosure is withdrawn with it'
  else 'FAIL  is_managed outlived the subscription' end;

-- -------------------------------------------------- an admin still sees themselves
-- The gate is on reading *other people*. An administrator's own work is
-- theirs by the ordinary owner policy and must survive every plan change
-- above — a company downgrading should never lose its own founder's projects.
-- The company above has been lapsed on purpose, and with no free tier that
-- means its administrator cannot create anything either. Give them back a
-- personal plan first: what is under test here is the visibility gate, not
-- the paywall, and a check_violation would prove neither.
update profiles set plan='pro', plan_renews_at = now() + interval '30 days' where id = :boss;
insert into projects (user_id, name) values (:boss, 'The board pack');
set role authenticated;
set request.jwt.claim.sub = 'dddddddd-0000-4000-8000-000000000001';
set request.jwt.claim.email = 'chief@modest.co';
select case when (select count(*) from projects where user_id = :boss) = 1
  then 'PASS  an admin always reads their own work, on any plan'
  else 'FAIL  the visibility gate ate the admin''s own rows' end;

reset role;
reset request.jwt.claim.sub;
reset request.jwt.claim.email;
