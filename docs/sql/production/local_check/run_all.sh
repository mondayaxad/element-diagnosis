#!/bin/bash
# 本番専用 migration のローカル検証（合成データの本番相当 PG17。実データ・本番には接続しない）
#   1. 本番（akivoob）と同じ構造の DB を baseline_archive 0001〜0007 から作り、合成データを入れる
#   2. 構造の指紋が本番の基準値と一致することを確かめる
#   3. 適用・二度適用・rollback・再適用（cycle.sh）、停止条件（negative.sh）、切り替え中の状態（transition.sh）、
#      旧 main の DB 操作（old_main_compat.sql。stage 0＝適用前、1〜3、4＝04a、5＝04b）
# 必要：env.sh の PostgreSQL 17（クライアント・サーバー）と 16（サーバー）。root で実行（initdb は postgres ユーザーで動かす）
set -e
H=$(dirname "$(readlink -f "$0")"); . "$H/env.sh"
"$H/harness.sh" stop || true
"$H/harness.sh" start
"$H/harness.sh" mkprod prod0
"$H/mkcopies.sh" >/dev/null
P="$PG17_BIN/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres"
# 本番の構造の基準値（2026-10-21 バックアップ時）と一致すること
exp='fp	public_columns	57 4533b18834f8b71b6c00a08e5f62c196
fp	public_functions	3 ca62d2bfb6b82642d1d23d38eccd60a9
fp	public_policies	8 f6ebc1e867656e2dcfb8b2f6a0a897d5
fp	public_constraints	19 e86317025f947fae6e5cbb41786fa0c8
fp	public_indexes	13 10cb608446bd505b5d21f716745fcc76
fp	auth_users_triggers	1 ffa9bd9ac265fa1a7a3d53923f1df8e5
fp	public_table_grants	126 6965208bc08c57e15bb54915ef77c7a9'
got=$($P -d prod0 -c "select 'fp', 'public_columns', count(*) || ' ' || md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, column_name)) from information_schema.columns where table_schema = 'public'
 union all select 'fp', 'public_functions', count(*) || ' ' || md5(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef, ',' order by p.proname, pg_get_function_identity_arguments(p.oid))) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
 union all select 'fp', 'public_policies', count(*) || ' ' || md5(string_agg(tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles, '|')||':'||coalesce(qual,'')||':'||coalesce(with_check,''), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public'
 union all select 'fp', 'public_constraints', count(*) || ' ' || md5(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname)) from pg_constraint where connamespace = 'public'::regnamespace
 union all select 'fp', 'public_indexes', count(*) || ' ' || md5(string_agg(indexdef, ',' order by indexname)) from pg_indexes where schemaname = 'public'
 union all select 'fp', 'auth_users_triggers', count(*) || ' ' || md5(string_agg(t.tgname||':'||pg_get_triggerdef(t.oid), ',' order by t.tgname)) from pg_trigger t where t.tgrelid = to_regclass('auth.users') and not t.tgisinternal
 union all select 'fp', 'public_table_grants', count(*) || ' ' || md5(string_agg(table_name||':'||grantee||':'||privilege_type, ',' order by table_name, grantee, privilege_type)) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','service_role')" | tr '|' '\t')
[ "$got" = "$exp" ] && echo "PASS 本番相当DBの構造の指紋が本番の基準値と一致" || { echo "FAIL 構造の指紋が本番と違う"; echo "$got"; exit 1; }
"$H/cycle.sh"
"$H/negative.sh"
"$H/transition.sh"
# 旧 main の DB 操作（段階ごと）
$P -d postgres -c "drop database if exists c0" -c "create database c0 template prod0" >/dev/null
i=0; for s in "" 01_registration_compat 02_orders_reports_links 03_reissue_and_constraints 04a_onboarding_required_state 04b_onboarding_enforcement; do
  [ -n "$s" ] && $PG17_BIN/psql -X -q -v ON_ERROR_STOP=1 -h /tmp/prodsim/s -p 55440 -U postgres -d c0 -f /tmp/prodsim/sql/prod_$s.sql >/dev/null
  $PG17_BIN/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres -d c0 -v stage=$i -f "$H/old_main_compat.sql" | sed "s/^/[stage $i] /"; i=$((i+1)); done
