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
