-- Companies: one subscription, many people, and no window into their work.
--
-- ## What an organisation is, and deliberately is not
--
-- It is a way to *pay for* several people at once. A company buys seats, hands
-- them out by email, and every person holding one gets the paid plan. That is
-- the whole of it.
--
-- It is **not** a way to watch them. Every policy on projects, tasks, events
-- and sessions still reads `auth.uid() = user_id` and nothing here changes
-- one of them: an org admin cannot read a member's work, and no migration
-- after this one should make that possible without a very good answer to why.
--
-- That is a product decision as much as a privacy one. A planner an employer
-- can read is a planner whose users keep a second, private list — which makes
-- the tool useless for the exact planning it exists to do. "Your company pays
-- for it; your company cannot see it" is the sentence that makes this sellable
-- to the people who have to use it, and it is only true if it is true in the
-- schema.
--
-- What an admin can see is the seat: who holds one, when they joined, whether
-- they have ever signed in. Presence, not contents.

create type org_role as enum ('member', 'admin');

create table organizations (
  id                     uuid primary key default uuid_generate_v4(),
  name                   text not null,
  -- The plan every seat-holder inherits. Written only by the Stripe webhook,
  -- exactly like profiles.plan.
  plan                   plan_tier not null default 'free',
  -- Seats paid for. Membership is refused past this, so a seat-holder always
  -- has a seat rather than the company quietly over-running its subscription.
  seats                  integer not null default 0 check (seats >= 0),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan_renews_at         timestamptz,
  billing_status         text,
  billing_alert          text,
  billing_event_at       timestamptz,
  created_at             timestamptz not null default now()
);

create table org_members (
  org_id    uuid not null references organizations on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  role      org_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on org_members (user_id);

-- An invitation is addressed to an email, because the person may not have an
-- account yet — which is the ordinary case when a company rolls this out.
create table org_invites (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references organizations on delete cascade,
  email       text not null,
  role        org_role not null default 'member',
  invited_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz
);

-- One live invitation per address per company. Re-inviting someone updates
-- rather than filling their inbox twice.
create unique index org_invites_live_idx on org_invites (org_id, lower(email))
  where accepted_at is null and revoked_at is null;
create index org_invites_email_idx on org_invites (lower(email))
  where accepted_at is null and revoked_at is null;

-- ------------------------------------------------------------- the helpers
--
-- SECURITY DEFINER on purpose. A policy on org_members that asks "is the
-- caller a member of this org" by selecting from org_members re-enters the
-- same policy and Postgres raises infinite recursion. These read the table
-- with the definer's rights, which is safe because they answer one boolean
-- about the caller and return nothing else.

create function is_org_member(org uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = org and user_id = uid)
$$;

create function is_org_admin(org uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
     where org_id = org and user_id = uid and role = 'admin')
$$;

-- ----------------------------------------------------------------- the plan
--
-- The single enforcement point in this schema. plan_limit, the project and
-- task triggers, and claim_assistant_chat all route through current_plan, so
-- teaching it about organisations gives every limit the same answer without
-- touching any of them.
--
-- The best of what the person holds and what any company has bought for them:
-- somebody who pays for Pro personally and sits on a company's Studio seat
-- gets Studio, and cancelling either leaves the other standing. Expiry is
-- applied on both sides — an unpaid company stops conferring anything, the
-- same way a lapsed personal subscription already did.
create or replace function current_plan(uid uuid) returns plan_tier
language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce(
      (select plan from profiles
        where id = uid
          and (plan = 'free' or plan_renews_at is null or plan_renews_at > now())),
      'free'::plan_tier),
    coalesce(
      (select max(o.plan) from org_members m
         join organizations o on o.id = m.org_id
        where m.user_id = uid
          and (o.plan = 'free' or o.plan_renews_at is null or o.plan_renews_at > now())),
      'free'::plan_tier)
  )
$$;

-- ------------------------------------------------------------- seat limits
--
-- Refused rather than reconciled later. A company that adds a tenth person to
-- nine seats should be told at that moment, by the person doing the adding —
-- not have someone silently lose access at the next billing event.
create function enforce_seat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  paid  integer;
  taken integer;
begin
  select seats into paid from organizations where id = new.org_id;
  select count(*) into taken from org_members where org_id = new.org_id;
  if paid is not null and taken >= paid then
    raise exception 'no seats left'
      using hint = 'Buy another seat, or remove someone first.';
  end if;
  return new;
end $$;

create trigger org_members_seat_limit before insert on org_members
  for each row execute function enforce_seat_limit();

-- ---------------------------------------------------------------------- RLS
alter table organizations enable row level security;
alter table org_members   enable row level security;
alter table org_invites   enable row level security;

-- Members see the company they belong to; only admins rename it. Billing
-- columns are the webhook's (service role), never a client's — the same
-- guard profiles carries, for the same reason.
create policy "members read org" on organizations for select
  using (is_org_member(id, auth.uid()));
create policy "admins update org" on organizations for update
  using (is_org_admin(id, auth.uid()))
  with check (is_org_admin(id, auth.uid()));

create or replace function guard_org_billing_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  new.plan                   := old.plan;
  new.seats                  := old.seats;
  new.stripe_customer_id     := old.stripe_customer_id;
  new.stripe_subscription_id := old.stripe_subscription_id;
  new.plan_renews_at         := old.plan_renews_at;
  new.billing_status         := old.billing_status;
  new.billing_alert          := old.billing_alert;
  new.billing_event_at       := old.billing_event_at;
  return new;
end $$;

create trigger organizations_guard_billing before update on organizations
  for each row execute function guard_org_billing_columns();

-- The roster is visible to the people on it. This is presence — who holds a
-- seat — and stops there: no policy anywhere grants a colleague or an admin
-- sight of another member's projects, tasks, events or sessions.
create policy "members read roster" on org_members for select
  using (is_org_member(org_id, auth.uid()));
-- Admins hand out and take back seats; anyone may resign their own.
create policy "admins manage seats" on org_members for insert
  with check (is_org_admin(org_id, auth.uid()));
create policy "admins remove seats" on org_members for delete
  using (is_org_admin(org_id, auth.uid()) or user_id = auth.uid());
create policy "admins change roles" on org_members for update
  using (is_org_admin(org_id, auth.uid()))
  with check (is_org_admin(org_id, auth.uid()));

-- An invitation is readable by the company's admins and by the person it is
-- addressed to — who is, at that moment, very likely not a member yet.
create policy "admins read invites" on org_invites for select
  using (is_org_admin(org_id, auth.uid()) or lower(email) = lower(auth.jwt() ->> 'email'));
create policy "admins write invites" on org_invites for insert
  with check (is_org_admin(org_id, auth.uid()));
create policy "admins revoke invites" on org_invites for update
  using (is_org_admin(org_id, auth.uid()))
  with check (is_org_admin(org_id, auth.uid()));

comment on table organizations is
  'A company that buys seats. Confers a plan on its members and nothing else — no visibility into their work.';
comment on column organizations.seats is
  'Seats paid for. Membership is refused past this rather than over-running the subscription.';
comment on table org_members is
  'Who holds a seat. Presence only: no policy grants sight of another member''s data.';
