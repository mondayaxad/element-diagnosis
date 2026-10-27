#!/bin/bash
# 本番相当（akivoob の構造）のローカル PG17 を作る試験台。実データは使わない。
set -e
A=$(cd "$(dirname "$(readlink -f "$0")")/../../baseline_archive_20261006" && pwd)
H=$(dirname "$(readlink -f "$0")")
. "$(dirname "$(readlink -f "$0")")/env.sh"; B=$PG17_SERVER_BIN
W=${W:-/tmp/prodsim}
PSQL="$PG17_BIN/psql -X -q -v ON_ERROR_STOP=1 -h $W/s -p 55440 -U postgres"
start() { rm -rf $W; mkdir -p $W/s; chown -R postgres $W
  runuser -u postgres -- $B/initdb -D $W/d -U postgres -A trust --no-locale -E UTF8 >/dev/null
  runuser -u postgres -- $B/pg_ctl -D $W/d -o "-c listen_addresses='' -c unix_socket_directories=$W/s -c port=55440 -c max_connections=200" -l $W/log -w start >/dev/null; }
stop() { runuser -u postgres -- $B/pg_ctl -D $W/d -m fast stop >/dev/null 2>&1 || true; }
mkprod() { # $1 = db name
  $PSQL -d postgres -c "create database $1"
  $PSQL -d $1 -f $A/restore_tools/00_supabase_stub.sql >/dev/null
  # Supabase 本番に存在する auth.identities を最小で再現（件数比較用）
  $PSQL -d $1 -c "create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text); grant select on auth.identities to supabase_auth_admin" >/dev/null
  # Supabase の storage（本番は bucket 0・object 0）を最小で再現
  $PSQL -d $1 -c "create schema storage; create table storage.buckets(id text primary key, name text); create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text)" >/dev/null
  for f in $A/000[1-7]*.sql; do $PSQL -d $1 --single-transaction -f $f >/dev/null; done
  # 本番（akivoob）の既定権限を再現（2026-10-21 読み取り専用で確認した pg_default_acl の postgres 分）
  $PSQL -d $1 -c "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role" \
               -c "alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role" \
               -c "alter default privileges for role postgres in schema public revoke execute on functions from public" \
               -c "alter default privileges for role postgres in schema public revoke all on sequences from public" >/dev/null
  $PSQL -d $1 -f $H/synthetic_data.sql >/dev/null
  $PSQL -d $1 -c "insert into auth.identities(user_id, provider) select id, 'email' from auth.users" >/dev/null
}
"$@"
