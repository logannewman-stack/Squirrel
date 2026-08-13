-- Seeing your team's work is the Studio capability, and priced like one.
--
-- 0013 gave every organisation administrator sight of their members' work.
-- That was the right product decision and the wrong commercial one: it handed
-- the single most valuable thing a company buys this for to any org holding
-- any paid seat, including the cheapest. A company with fifty people on Pro
-- got the whole enterprise feature and paid the personal price for it.
--
-- So the line is drawn here, in the schema, rather than in a component that
-- can be worked around with a fetch:
--
--   any paid seat  — the roster, the seat controls, one invoice, one plan
--   Studio         — and reading what the people in those seats are doing
--
-- This is the same shape as the rest of the entitlement model: the client's
-- `can(plan, 'teamVisibility')` draws the lock, and this decides. A browser
-- that lies about its plan gets an empty array from Postgres.
--
-- A lapsed subscription loses it too. `plan_renews_at` in the past means the
-- company stopped paying, and visibility is not something to keep serving on
-- credit — it is the one capability where continuing to serve it after the
-- relationship ended is a privacy problem as well as an unpaid invoice.

/**
 * Does this organisation's subscription include sight of its members' work?
 *
 * Split out rather than inlined so the two callers below cannot drift. They
 * are a matched pair: `admins_over` decides whether an administrator may
 * read, and `is_managed` decides whether the member is told they can. A
 * version of this where one says yes and the other says no is either
 * undisclosed surveillance or a warning about something that is not
 * happening, and both are worse than either honest answer.
 */
create function org_sees_work(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organizations o
     where o.id = oid
       and o.plan = 'studio'
       and (o.plan_renews_at is null or o.plan_renews_at > now())
  )
$$;

-- Same body as 0013 with the subscription added to the where-clause. Kept as
-- a whole replacement rather than a wrapper so the policy's condition can be
-- read in one place.
create or replace function admins_over(subject uuid, viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from org_members boss
      join org_members staff on staff.org_id = boss.org_id
     where boss.user_id  = viewer
       and boss.role     = 'admin'
       and staff.user_id = subject
       -- An administrator does not gain sight of themselves through this
       -- path; their own rows are already theirs by the ordinary policy.
       and staff.user_id <> viewer
       and org_sees_work(boss.org_id)
  )
$$;

-- The disclosure follows the capability exactly. A member of a company on Pro
-- is told nothing, because there is nothing to tell.
create or replace function is_managed(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from org_members me
      join org_members boss on boss.org_id = me.org_id and boss.role = 'admin'
     where me.user_id = uid
       and boss.user_id <> uid
       and org_sees_work(me.org_id)
  )
$$;

-- 0012's table comment still promised a company no window into its people's
-- work; 0013 reversed that and left the comment behind. Anybody reading the
-- schema for the privacy answer — which is the likeliest reason to read it —
-- got the opposite of the truth.
comment on table organizations is
  'A company that buys seats. Confers a plan on its members; on Studio, its administrators can also read their projects, tasks and calendars (never their assistant conversations, and never with permission to write).';

comment on function org_sees_work(uuid) is
  'True when this organisation holds a live Studio subscription — the tier that includes reading members'' work.';
comment on function admins_over(uuid, uuid) is
  'True when viewer administers a Studio organisation the subject belongs to. Read-only visibility for enterprise accounts.';
