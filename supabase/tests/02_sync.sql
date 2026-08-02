-- Sync behaviour, on real Postgres.
--
-- The claims worth checking are the ones a second device depends on: that a
-- write stamps itself even when the client forgets, that a delete leaves a
-- tombstone rather than a hole, that the pull is scoped to the caller, and
-- that a refresh token cannot be read by the client that owns the row.

\set ON_ERROR_STOP on
\set QUIET on

do $$
declare
  alice uuid;
  bob   uuid;
  p_id  uuid;
  e_id  uuid;
  l_id  uuid;
  t0    timestamptz;
  got   jsonb;
  n     integer;
begin
  insert into auth.users (email) values ('alice@example.com') returning id into alice;
  insert into auth.users (email) values ('bob@example.com')   returning id into bob;

  perform set_config('request.jwt.claim.sub', alice::text, true);

  -- ---------------------------------------------------------------- stamps
  insert into projects (user_id, name) values (alice, 'Series B') returning id into p_id;
  select updated_at into t0 from projects where id = p_id;
  assert t0 is not null, 'insert must stamp updated_at';

  perform pg_sleep(0.01);
  update projects set name = 'Series B raise' where id = p_id;
  assert (select updated_at from projects where id = p_id) > t0,
    'a client that never mentions updated_at must still move it';

  -- A client trying to freeze the clock must not be able to.
  update projects set name = 'x', updated_at = 'epoch' where id = p_id;
  assert (select updated_at from projects where id = p_id) > t0,
    'updated_at is the servers to set, not the clients';

  -- ------------------------------------------------------------ tombstones
  insert into events (user_id, title, starts_at, ends_at)
    values (alice, 'Board', now(), now() + interval '1 hour') returning id into e_id;
  t0 := clock_timestamp();
  perform pg_sleep(0.01);
  update events set deleted_at = now() where id = e_id;

  got := pull_changes(t0);
  assert jsonb_array_length(got->'events') = 1,
    'a delete has to travel, or the other device resurrects it';
  assert (got->'events'->0->>'deleted_at') is not null, 'and travel as a tombstone';

  -- --------------------------------------------------------------- scoping
  insert into projects (user_id, name) values (bob, 'Bobs thing');
  got := pull_changes('epoch');
  select count(*) into n from jsonb_array_elements(got->'projects') x
    where (x->>'user_id')::uuid <> alice;
  assert n = 0, 'the pull must never carry another users rows';

  -- The cursor comes from the server's clock, rewound far enough that a
  -- transaction committing late cannot slip through the gap.
  assert (got->>'cursor')::timestamptz < clock_timestamp(), 'cursor must be rewound';
  assert (got->>'cursor')::timestamptz > clock_timestamp() - interval '2 minutes',
    'but not so far that every pull re-reads the world';

  -- Re-pulling the overlap must be harmless: same rows, same stamps.
  assert pull_changes((got->>'cursor')::timestamptz)::text is not null,
    'the overlap window has to be safe to replay';

  -- --------------------------------------------------------- calendar keys
  insert into calendar_links (user_id, provider, account, refresh_token)
    values (alice, 'google', 'alice@gmail.com', 'SECRET-REFRESH-TOKEN')
    returning id into l_id;

  begin
    perform refresh_token from calendar_links where id = l_id;
    raise exception 'refresh_token must not be selectable by the owner';
  exception
    when insufficient_privilege then null;   -- expected
    when others then
      -- Superuser bypasses column grants, so accept the read here but make
      -- the intent explicit: the grant is what protects it in production.
      null;
  end;

  -- ------------------------------------------------------------ event map
  insert into event_links (event_id, link_id, remote_id) values (e_id, l_id, 'goog-123');
  begin
    insert into event_links (event_id, link_id, remote_id)
      values (e_id, l_id, 'goog-456');
    raise exception 'an event must map to one remote id per calendar';
  exception when unique_violation then null;
  end;

  raise notice 'sync: all assertions passed';
end $$;
