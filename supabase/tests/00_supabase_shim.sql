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
