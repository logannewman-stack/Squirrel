# Schema tests

Exercises the entitlement layer against a real Postgres — plan limits and chat
metering live in database triggers, not the client, so this is where they have
to be proven.

`00_supabase_shim.sql` stands in for the pieces Supabase provides (`auth.users`,
`auth.uid()`), so the migration runs on plain Postgres.

```bash
initdb -D /tmp/pgdata -A trust
pg_ctl -D /tmp/pgdata -o '-k /tmp -p 5433' start
psql -h /tmp -p 5433 -U postgres -c 'create database squirreltest'
psql -h /tmp -p 5433 -U postgres -d squirreltest -q \
  -c 'create extension if not exists "uuid-ossp";' \
  -f supabase/tests/00_supabase_shim.sql \
  -f supabase/migrations/0001_init.sql \
  -f supabase/tests/01_plan_limits.sql 2>&1 | grep -E 'PASS|FAIL'
```

Covers: free caps at 1 project / 10 open tasks / 0 chats; completing a task
frees a slot; Plus caps at 5 projects and exactly 200 chats; Pro is uncapped;
an expired subscription falls back to free rather than staying paid.
