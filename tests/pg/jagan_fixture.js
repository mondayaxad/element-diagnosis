// 邪眼診断の SQL（jagan_01・jagan_02）を試すための、Supabase の Preview に必要な部分だけを持つ最小の使い捨てDB（PG16・17 のどちらでも作れる）。
//   ロール・auth.users・auth.uid()・profiles（登録の状態）・migration 履歴・deployment_environment()、
//   そして Supabase と同じ「public の新しい表・関数に anon・authenticated・service_role へ全権限」の既定権限（各 SQL の revoke を確かめるため）。
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('./pg_env');
const { dropDb } = require('./db_setup');

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql');
const SQL = (f) => path.join(SQL_DIR, f);

function createDb(env) {
  const db = pg.newDbName();
  pg.sql('postgres', `create database ${db}`);
  try {
    pg.sqlText(db, `
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
      insert into supabase_migrations.schema_migrations (version, name) values ('20261021200000', 'complete_16_close_old_consent_versions');
      create function public.deployment_environment() returns text language sql immutable as $f$ select '${env}'::text $f$;
      grant usage on schema public to anon, authenticated, service_role;
      create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, onboarding_status text not null default 'required');
      grant select on table public.profiles to service_role; -- 実際の Supabase と同じ（ETI の関数も service_role で読む）
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `);
  } catch (e) { dropDb(db); throw e; }
  return db;
}
const rows = (out) => out.split('\n').filter(Boolean).map((l) => l.split('|'));
const run = (db, file) => pg.sqlText(db, fs.readFileSync(file, 'utf8'));
const fingerprint = (db) => pg.sql(db, "select md5(string_agg(x, E'\\n' order by x)) from (select c.relname||':'||coalesce(array_to_string(c.relacl, ','),'') x from pg_class c where c.relnamespace='public'::regnamespace union all select version||':'||coalesce(name,'') from supabase_migrations.schema_migrations union all select tablename||'.'||policyname from pg_policies where schemaname='public' union all select p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace union all select table_name||'.'||column_name from information_schema.columns where table_schema='public') s");

module.exports = { SQL, createDb, rows, run, fingerprint, dropDb };
