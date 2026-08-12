#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres and run the assertions.
#
# The entitlement and sync rules live in the database on purpose — a client
# check is a suggestion — so this is the only place they can actually be
# proven. Needs a running Postgres; set PGHOST/PGPORT if it is not the default.
set -euo pipefail

HOST=${PGHOST:-/tmp}
PORT=${PGPORT:-5433}
USER=${PGUSER:-postgres}
DB=${PGDATABASE:-squirreltest}
HERE=$(cd "$(dirname "$0")" && pwd)

psql -h "$HOST" -p "$PORT" -U "$USER" -q -c "drop database if exists $DB" \
                                       -c "create database $DB"

run() { psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -q -v ON_ERROR_STOP=1 "$@"; }

run -c 'create extension if not exists "uuid-ossp";'
run -f "$HERE/00_supabase_shim.sql"
for m in "$HERE"/../migrations/*.sql; do
  echo "── $(basename "$m")"
  run -f "$m"
done

# What Supabase does automatically and this stand-in must not forget.
#
# A hosted project grants anon/authenticated table access by default and lets
# RLS decide the rows; without the same grants here every policy test dies on
# "permission denied" instead of exercising the policy. That is not a passing
# test — it is a test that never ran, which is how a screen of errors once sat
# under "all checks passed" while the privacy rules went unproven.
run -c "grant usage on schema public to anon, authenticated;
        grant all on all tables in schema public to anon, authenticated;
        grant all on all sequences in schema public to anon, authenticated;"

fail=0
for t in "$HERE"/[0-9][0-9]_*.sql; do
  case "$(basename "$t")" in 00_*) continue;; esac
  echo "── $(basename "$t")"
  # The assertions report by printing PASS/FAIL notices rather than raising,
  # so the exit status alone says nothing. The old pipeline took grep's exit
  # status — zero whenever ANY line printed — which meant a screen full of
  # FAIL lines walked out under "all checks passed". A test suite that cannot
  # fail is a costume.
  out=$(run -f "$t" 2>&1) || fail=1
  printf '%s\n' "$out"
  # FAIL is an assertion that ran and disagreed. ERROR is an assertion that
  # never ran — a missing grant, a renamed column, a typo — and it is the more
  # dangerous of the two, because the check silently did not happen. This
  # suite printed a screenful of "permission denied" under "all checks passed"
  # once, and the unproven checks were the ones asserting that an employer
  # cannot read an employee's work. Both count as failure.
  if printf '%s' "$out" | grep -qE 'FAIL|ERROR'; then fail=1; fi
done

echo
[ "$fail" = 0 ] && echo "schema: all checks passed" || { echo "schema: FAILED"; exit 1; }
