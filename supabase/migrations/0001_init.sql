-- Squirrel — initial schema.
--
-- Every table is row-level-secured to the owning user. The client talks to
-- Postgres directly with the anon key, so RLS is the only thing standing
-- between one customer's data and another's — there is no server in that path
-- to check on its behalf.
--
-- Plan limits are enforced by database triggers rather than in the client, for
-- the same reason: anything the client enforces is a suggestion.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- profiles
create type plan_tier as enum ('free', 'plus', 'pro');

create table profiles (
  id                     uuid primary key references auth.users on delete cascade,
  email                  text,
  phone                  text,
  full_name              text,
  plan                   plan_tier not null default 'free',
  -- Billing state is written only by the Stripe webhook (service role).
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  plan_renews_at         timestamptz,
  -- Set when an Apple IAP receipt grants the plan instead of Stripe.
  apple_transaction_id   text unique,
  created_at             timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id)
  -- Plan and billing columns are deliberately not writable here; the webhook
  -- uses the service role, which bypasses RLS.
  with check (auth.uid() = id);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- projects
create table projects (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  client     text default '',
  value      numeric,
  status     text not null default 'active',
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create index projects_user_idx on projects (user_id) where not archived;

-- ------------------------------------------------------------------- tasks
create table tasks (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users on delete cascade,
  project_id    uuid references projects on delete cascade,
  title         text not null,
  notes         text default '',
  estimate_mins integer not null default 30,
  due           date,
  priority      text not null default 'normal'
                check (priority in ('critical', 'high', 'normal', 'low')),
  delegated_to  text default '',
  done          boolean not null default false,
  done_at       timestamptz,
  scheduled_for date,
  sort_order    integer,
  created_at    timestamptz not null default now()
);

create index tasks_user_open_idx on tasks (user_id, due) where not done;
create index tasks_project_idx on tasks (project_id);

-- ------------------------------------------------------------------ events
create table events (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users on delete cascade,
  project_id uuid references projects on delete set null,
  title      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  location   text default '',
  attendees  jsonb not null default '[]',
  notes      text default '',
  created_at timestamptz not null default now(),
  constraint events_time_order check (ends_at > starts_at)
);

create index events_user_time_idx on events (user_id, starts_at);

-- ---------------------------------------------------------- focus sessions
create table focus_sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  task_id     uuid references tasks on delete set null,
  project_id  uuid references projects on delete set null,
  label       text default '',
  planned_ms  bigint not null,
  focused_ms  bigint not null,
  ended_at    timestamptz not null default now()
);

create index focus_sessions_user_idx on focus_sessions (user_id, ended_at desc);

-- ------------------------------------------------------------------- chat
create table chat_messages (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'error')),
  text       text not null default '',
  actions    jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index chat_messages_user_idx on chat_messages (user_id, created_at);

-- ------------------------------------------------------------------ usage
-- One row per user per calendar month. Written only by the service role from
-- the assistant endpoint, so a client cannot reset its own counter.
create table usage_counters (
  user_id         uuid not null references auth.users on delete cascade,
  period          date not null,               -- first day of the month
  assistant_chats integer not null default 0,
  input_tokens    bigint  not null default 0,
  output_tokens   bigint  not null default 0,
  primary key (user_id, period)
);

-- ------------------------------------------------------- RLS for user data
do $$
declare t text;
begin
  foreach t in array array['projects','tasks','events','focus_sessions','chat_messages','usage_counters']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "own rows read" on %I for select using (auth.uid() = user_id)', t);
    execute format(
      'create policy "own rows insert" on %I for insert with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "own rows update" on %I for update using (auth.uid() = user_id)', t);
    execute format(
      'create policy "own rows delete" on %I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- usage_counters is readable by its owner but must never be writable by them.
drop policy "own rows insert" on usage_counters;
drop policy "own rows update" on usage_counters;
drop policy "own rows delete" on usage_counters;

-- ------------------------------------------------------------ plan limits
-- Kept in the database so the client cannot argue with them. Mirror any change
-- here in src/lib/plans.js, which exists only to render the paywall copy.
create function plan_limit(p plan_tier, resource text) returns integer
language sql immutable as $$
  select case
    when resource = 'projects' then case p when 'free' then 1 when 'plus' then 5 else null end
    when resource = 'tasks'    then case p when 'free' then 10 else null end
    when resource = 'chats'    then case p when 'free' then 0 when 'plus' then 200 else null end
  end
$$;

create function current_plan(uid uuid) returns plan_tier
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select plan from profiles
      where id = uid
        -- An expired subscription silently falls back to free rather than
        -- staying paid until someone notices.
        and (plan = 'free' or plan_renews_at is null or plan_renews_at > now())),
    'free')
$$;

create function enforce_project_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim integer;
begin
  lim := plan_limit(current_plan(new.user_id), 'projects');
  if lim is not null and
     (select count(*) from projects where user_id = new.user_id and not archived) >= lim then
    raise exception 'plan_limit_projects' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create function enforce_task_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim integer;
begin
  lim := plan_limit(current_plan(new.user_id), 'tasks');
  if lim is not null and
     (select count(*) from tasks where user_id = new.user_id and not done) >= lim then
    raise exception 'plan_limit_tasks' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger project_limit before insert on projects
  for each row execute function enforce_project_limit();

create trigger task_limit before insert on tasks
  for each row execute function enforce_task_limit();

-- Atomically claim one assistant chat. Returns false when the plan is spent,
-- so the caller never has to read-then-write and race itself.
create function claim_assistant_chat(uid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  lim  integer;
  used integer;
  p    date := date_trunc('month', now())::date;
begin
  lim := plan_limit(current_plan(uid), 'chats');

  insert into usage_counters (user_id, period) values (uid, p)
    on conflict (user_id, period) do nothing;

  -- Lock this user's row so two concurrent requests cannot both pass the check.
  select assistant_chats into used from usage_counters
    where user_id = uid and period = p for update;

  if lim is not null and used >= lim then
    return false;
  end if;

  update usage_counters set assistant_chats = assistant_chats + 1
    where user_id = uid and period = p;
  return true;
end $$;

create function record_assistant_tokens(uid uuid, tin bigint, tout bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p date := date_trunc('month', now())::date;
begin
  update usage_counters
     set input_tokens = input_tokens + tin, output_tokens = output_tokens + tout
   where user_id = uid and period = p;
end $$;
