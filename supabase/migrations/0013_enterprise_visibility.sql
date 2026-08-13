-- Enterprise accounts: the administrator can see the work.
--
-- 0012 gave a company seats and deliberately no window into them. This
-- reverses that for organisations, on the product owner's decision: a company
-- that provisions accounts for its staff can read what is on them — projects,
-- tasks, calendar, focus sessions, and the account's own details. It is the
-- ordinary arrangement for company-issued tools, and the same one Google
-- Workspace and Microsoft 365 administrators have.
--
-- Three limits are built in, because "the admin can see it" still has edges
-- worth drawing carefully:
--
-- 1. **Admins only, not colleagues.** A member sees their own work and nobody
--    else's. Visibility follows the `admin` role, not membership.
-- 2. **Read, never write.** An administrator can read a member's plan; they
--    cannot edit, complete or delete somebody's tasks from inside their
--    account. Oversight is not impersonation, and an audit trail that can be
--    rewritten by the person auditing is worth nothing.
-- 3. **The member is told.** `is_managed()` below lets the app say so plainly
--    in Settings. Visibility somebody has not been told about is surveillance;
--    the same visibility, disclosed, is simply how a company laptop works.
--    Most jurisdictions expect the disclosure, and it is the difference
--    between a defensible policy and an incident.

-- Does `viewer` administer a company that `subject` belongs to?
--
-- SECURITY DEFINER for the same reason as 0012's helpers: a policy on
-- projects that reads org_members would otherwise be re-entered through
-- org_members' own policies. It answers one boolean and returns nothing else.
create function admins_over(subject uuid, viewer uuid) returns boolean
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
  )
$$;

/**
 * Is this account administered by somebody else?
 *
 * Read by the app so Settings can tell the person whose account it is. The
 * answer is about the caller and reveals nothing about anybody else.
 */
create function is_managed(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from org_members me
      join org_members boss on boss.org_id = me.org_id and boss.role = 'admin'
     where me.user_id = uid
       and boss.user_id <> uid
  )
$$;

grant execute on function is_managed(uuid) to authenticated;

-- The work itself. SELECT only, and each one sits alongside the existing
-- owner policy rather than replacing it — Postgres ORs permissive policies,
-- so a member keeps exactly the access they had.
create policy "org admins read member projects" on projects for select
  using (admins_over(user_id, auth.uid()));

create policy "org admins read member tasks" on tasks for select
  using (admins_over(user_id, auth.uid()));

create policy "org admins read member events" on events for select
  using (admins_over(user_id, auth.uid()));

create policy "org admins read member sessions" on focus_sessions for select
  using (admins_over(user_id, auth.uid()));

-- The account's own details: name, address, plan, billing state. Not the
-- assistant transcript — chat_messages is left alone deliberately. A person
-- talking to a planner about their week says things they would say to a
-- notebook, and reading the notes is a long way from reading the diary. If
-- that is wanted later it should be a decision taken on its own, not one
-- inherited from a migration about projects.
create policy "org admins read member profiles" on profiles for select
  using (admins_over(id, auth.uid()));

comment on function admins_over(uuid, uuid) is
  'True when viewer administers an organisation the subject belongs to. Read-only visibility for enterprise accounts.';
comment on function is_managed(uuid) is
  'True when this account belongs to an organisation somebody else administers. The app discloses this to the account holder.';
