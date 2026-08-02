-- Contacts, meeting links, and a record of invites sent.
--
-- "The email on file" needs somewhere to live. Contacts are per-user and RLS'd
-- like everything else; the assistant reads them to resolve a name to an
-- address, and asks the user when it cannot.

create table contacts (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  email      text,
  company    text default '',
  created_at timestamptz not null default now(),
  -- One row per person per user; re-saving updates rather than duplicating.
  unique (user_id, name)
);

create index contacts_user_idx on contacts (user_id);

alter table contacts enable row level security;
create policy "own rows read"   on contacts for select using (auth.uid() = user_id);
create policy "own rows insert" on contacts for insert with check (auth.uid() = user_id);
create policy "own rows update" on contacts for update using (auth.uid() = user_id);
create policy "own rows delete" on contacts for delete using (auth.uid() = user_id);

-- The user's own standing meeting room, pasted once in settings.
-- Generating a *fresh* Google Meet or Zoom link per meeting requires that
-- provider's OAuth and API; a personal room link needs neither and is what most
-- people send anyway.
alter table profiles add column meeting_link text default '';
alter table profiles add column reply_to_email text default '';

-- Audit trail. Sending mail on someone's behalf should be inspectable by them,
-- and it is the first thing to check when a recipient says nothing arrived.
create table invite_log (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users on delete cascade,
  event_id   uuid references events on delete set null,
  recipients jsonb not null default '[]',
  subject    text default '',
  provider_id text,
  status     text not null default 'sent',
  error      text,
  created_at timestamptz not null default now()
);

create index invite_log_user_idx on invite_log (user_id, created_at desc);

alter table invite_log enable row level security;
create policy "own rows read" on invite_log for select using (auth.uid() = user_id);
-- Writes come from the server (service role) only, so the log cannot be forged.
