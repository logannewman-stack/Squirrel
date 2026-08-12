-- Minimal stand-ins for what Supabase provides, so the migration can be
-- exercised on plain Postgres.
create schema if not exists auth;
create table auth.users (
  id uuid primary key default uuid_generate_v4(),
  email text,
  raw_user_meta_data jsonb default '{}'
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- The verified token itself. Supabase exposes it so a policy can read a claim
-- the row does not carry: an invitation is addressed to an email belonging to
-- somebody who may have no account anywhere yet, and `auth.jwt() ->> 'email'`
-- is how that policy asks who is knocking.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'sub',   nullif(current_setting('request.jwt.claim.sub', true), ''),
      'email', nullif(current_setting('request.jwt.claim.email', true), ''))),
    '{}'::jsonb)
$$;

-- Which role PostgREST is acting as. The billing guards let the service role
-- through and revert everybody else, so a test that cannot answer this cannot
-- exercise the guard that protects every paid plan in the product.
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), ''),
    'authenticated')
$$;

-- The roles PostgREST connects as. Column-level grants are a real part of the
-- security model here, so the migration has to be able to name them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
