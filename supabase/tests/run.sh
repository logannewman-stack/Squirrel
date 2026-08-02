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

fail=0
for t in "$HERE"/[0-9][0-9]_*.sql; do
  case "$(basename "$t")" in 00_*) continue;; esac
  echo "── $(basename "$t")"
  if ! run -f "$t" 2>&1 | grep -vE '^\s*$'; then fail=1; fi
done

echo
[ "$fail" = 0 ] && echo "schema: all checks passed" || { echo "schema: FAILED"; exit 1; }
