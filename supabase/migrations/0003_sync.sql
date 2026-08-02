-- Squirrel — cross-device sync, and the hooks for external calendars.
--
-- The client stays local-first: it writes to its own storage immediately and
-- reconciles with Postgres in the background. That keeps the app instant and
-- usable on a plane, and it means the network is never in the way of typing.
-- The cost is that two devices can edit the same row while offline, so the
-- schema has to make conflicts decidable:
--
--   updated_at  every write stamps it, by trigger, so no client can forget.
--   deleted_at  deletes are tombstones. A row that simply vanished is
--               indistinguishable from a row this device has not pulled yet,
--               and the second reading resurrects it on the next sync.
--
-- Resolution is last-write-wins on updated_at. That is the right trade here:
-- the alternative is merge UI for a calendar entry, which nobody wants, and
-- the loser is recoverable because the row is still in the audit of its own
-- history. Deletes win ties — undeleting something a user deleted is worse
-- than losing an edit they can redo.

-- --------------------------------------------------------------- stamping
-- clock_timestamp(), not now(). now() is the transaction's start time and is
-- frozen for its whole life, so a batch of writes would all carry the same
-- stamp and two edits inside one transaction could not be ordered at all.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects', 'tasks', 'events', 'focus_sessions'] loop
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table %I add column if not exists deleted_at timestamptz', t);
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format(
      'create trigger %I before update on %I for each row execute function touch_updated_at()',
      t || '_touch', t);
    -- The whole sync query is "everything of mine changed since X", so that
    -- is the index. Partial on deleted_at would exclude tombstones, which are
    -- exactly what the other device needs to hear about.
    execute format('create index if not exists %I on %I (user_id, updated_at)', t || '_sync_idx', t);
  end loop;
end $$;

-- ------------------------------------------------------------ device clocks
-- One row per device per user, holding the high-water mark of what that device
-- has already pulled. Kept server-side rather than in the client so a browser
-- that clears its storage re-pulls everything instead of silently missing the
-- window it was away for.
create table sync_state (
  user_id     uuid not null references auth.users on delete cascade,
  device_id   text not null,
  pulled_at   timestamptz not null default 'epoch',
  device_name text default '',
  seen_at     timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table sync_state enable row level security;
create policy "own sync state" on sync_state for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------- external calendars
-- One row per connected calendar account.
--
-- Google is reachable from a server: an OAuth refresh token is enough to write
-- to it forever, so that sync runs whether or not the app is open.
--
-- Apple is not. There is no server-side Apple Calendar API. The only supported
-- way into someone's Apple Calendar is EventKit, on their own device, from the
-- native app — so an 'apple' row here records a device that has been granted
-- calendar permission, and carries no token at all. Its sync happens on that
-- device while the app runs. See DEPLOY.md.
create type calendar_provider as enum ('google', 'apple');

create table calendar_links (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users on delete cascade,
  provider      calendar_provider not null,
  -- Google: the account's email. Apple: the device identifier.
  account       text not null,
  -- Google: the target calendar. Apple: the EventKit calendar identifier.
  calendar_id   text default '',
  calendar_name text default '',
  -- Google only, and never readable by the client — see the policies below.
  refresh_token text,
  -- Google's incremental cursor. Null forces a full resync.
  sync_token    text,
  -- Push channel, so incoming changes arrive instead of being polled for.
  channel_id      text,
  channel_expires timestamptz,
  write_back    boolean not null default true,
  last_synced_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (user_id, provider, account, calendar_id)
);

create index calendar_links_user_idx on calendar_links (user_id);
-- The webhook receives a channel id and nothing else, and has to find the row.
create index calendar_links_channel_idx on calendar_links (channel_id)
  where channel_id is not null;

alter table calendar_links enable row level security;

-- Deliberately split. The client may see that a calendar is connected and may
-- disconnect it, but must never be able to read a refresh token or write one —
-- a token that leaks into a browser is a permanent grant on someone's whole
-- calendar. Reads go through the view below; the server uses the service role.
create policy "own links delete" on calendar_links for delete
  using (auth.uid() = user_id);
create policy "own links toggle" on calendar_links for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own links read" on calendar_links for select
  using (auth.uid() = user_id);

-- The policy decides which rows; these grants decide which columns, and they
-- are what actually keeps refresh_token and sync_token out of the browser. A
-- policy can be loosened by a later migration without anyone noticing; a
-- missing column grant fails loudly.
revoke all on calendar_links from anon, authenticated;
grant select (id, user_id, provider, account, calendar_id, calendar_name,
              write_back, last_synced_at, last_error, created_at)
  on calendar_links to authenticated;
grant update (write_back) on calendar_links to authenticated;
grant delete on calendar_links to authenticated;

-- --------------------------------------------------------------- event map
-- Which of our events corresponds to which event in an external calendar.
--
-- Needed in both directions and needed to stop loops: without it, an event we
-- push to Google comes back on the next pull as a new event, which we push
-- again. `etag` lets a pull decide whether the remote copy actually changed or
-- is just our own write echoing back.
create table event_links (
  event_id    uuid not null references events on delete cascade,
  link_id     uuid not null references calendar_links on delete cascade,
  remote_id   text not null,
  etag        text,
  -- Which side last wrote, so an echo is recognisable.
  pushed_at   timestamptz,
  pulled_at   timestamptz,
  primary key (event_id, link_id),
  unique (link_id, remote_id)
);

alter table event_links enable row level security;
create policy "own event links" on event_links for all
  using (exists (select 1 from events e where e.id = event_id and e.user_id = auth.uid()))
  with check (exists (select 1 from events e where e.id = event_id and e.user_id = auth.uid()));

-- ---------------------------------------------------------------- the pull
-- Everything of mine that changed since a cursor, tombstones included.
--
-- Returned as one payload rather than four round trips, and stamped with the
-- server's clock: the cursor must come from the same clock that wrote the
-- rows, or a device whose system time runs fast skips its own changes.
--
-- The cursor is deliberately rewound. A write that started before this pull
-- but commits after it carries an updated_at earlier than the pull, yet was
-- invisible while the pull ran — take the pull's own timestamp as the next
-- cursor and that row is skipped forever. Overlapping by a window longer than
-- any sane transaction closes the hole, and re-pulling a few rows costs
-- nothing because the merge is idempotent: same row, same updated_at, no
-- change. Correctness over elegance.
create or replace function pull_changes(since timestamptz)
returns jsonb
language sql security invoker stable as $$
  select jsonb_build_object(
    'cursor', clock_timestamp() - interval '30 seconds',
    'projects', coalesce((select jsonb_agg(to_jsonb(p)) from projects p
       where p.user_id = auth.uid() and p.updated_at > since), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t)) from tasks t
       where t.user_id = auth.uid() and t.updated_at > since), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from events e
       where e.user_id = auth.uid() and e.updated_at > since), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s)) from focus_sessions s
       where s.user_id = auth.uid() and s.updated_at > since), '[]'::jsonb)
  );
$$;

grant execute on function pull_changes(timestamptz) to authenticated;

-- Tombstones are not kept forever. Ninety days is far longer than any device
-- is plausibly offline, and a device that has been away longer than that must
-- resync from scratch rather than be trusted with a stale cursor.
create or replace function purge_tombstones() returns void
language sql security definer set search_path = public as $$
  delete from projects       where deleted_at < now() - interval '90 days';
  delete from tasks          where deleted_at < now() - interval '90 days';
  delete from events         where deleted_at < now() - interval '90 days';
  delete from focus_sessions where deleted_at < now() - interval '90 days';
$$;
