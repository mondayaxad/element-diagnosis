#!/bin/bash
# 本番の条件を満たさないDBで止まること、途中失敗で全体が戻ることの確認
H=$(dirname "$(readlink -f "$0")"); $H/mkcopies.sh >/dev/null || exit 1
. "$(dirname "$(readlink -f "$0")")/env.sh"
A=$(cd "$(dirname "$(readlink -f "$0")")/../../baseline_archive_20261006" && pwd)
P="$B/psql -X -q -v ON_ERROR_STOP=1 -h /tmp/prodsim/s -p 55440 -U postgres"; Q=/tmp/prodsim/sql
$B/psql -X -q -h /tmp/prodsim/s -p 55440 -U postgres -d postgres -c "select 1" >/dev/null 2>&1 || { echo "FAIL server_reachable: ローカルの PG17 が動いていない（harness.sh start）"; exit 1; }
pass=0; fail=0
dump() { $B/pg_dump -h /tmp/prodsim/s -p ${3:-55440} -U postgres -d $1 --schema-only | grep -v -E "^--|^$|^SET |^SELECT pg_catalog|^\\\\(un)?restrict" > $2; [ -s $2 ] || { echo "FAIL empty schema dump ($1)"; exit 1; }; }
expect_stop() { # $1 label, $2 db, $3 file, $4 expected message
  dump $2 /tmp/prodsim/neg_before.sql
  if $P -d $2 -f $Q/$3.sql > /tmp/prodsim/neg.out 2>&1; then echo "FAIL $1 (applied)"; fail=$((fail+1)); return; fi
  dump $2 /tmp/prodsim/neg_after.sql
  if grep -q -- "$4" /tmp/prodsim/neg.out && cmp -s /tmp/prodsim/neg_before.sql /tmp/prodsim/neg_after.sql; then echo "PASS $1 → stopped, no change"; pass=$((pass+1));
  else echo "FAIL $1: $(grep -m1 ERROR /tmp/prodsim/neg.out)"; fail=$((fail+1)); fi; }
fresh() { $P -d postgres -c "drop database if exists $1" -c "create database $1 template ${2:-prod0}" >/dev/null; }
S1=prod_01_registration_compat
fresh n1; $P -d n1 -f $A/0008_preview_only_settings.sql >/dev/null
expect_stop "Preview DB (deployment_environment あり)" n1 $S1 "deployment_environment() exists"
fresh n2; $P -d n2 -c "insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, product_type, amount, created_at, purchased_at) values (repeat('a',64), 'cs_live_NEWSYNTH', 'core1', 1000, '2026-09-02', '2026-09-02')" >/dev/null
expect_stop "基準の締め切りより前に購入が10件（基準の件数と違う）" n2 $S1 "purchase_entitlements baseline is not 9 rows"
fresh n2b; $P -d n2b -c "insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, product_type, amount, created_at, purchased_at) values (repeat('a',64), 'cs_live_LATEOK', 'core1', 1000, '2026-10-26 12:24+00', '2026-10-26 12:24+00')" >/dev/null
if $P -d n2b -f $Q/$S1.sql >/tmp/prodsim/neg.out 2>&1; then echo "PASS 締め切り後の正規 live 購入（10行目）があっても prod_01 は進む（基準の9件は照合済み）"; pass=$((pass+1)); else echo "FAIL late live purchase: $(grep -m1 ERROR /tmp/prodsim/neg.out)"; fail=$((fail+1)); fi
fresh n2c; $P -d n2c -c "insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, product_type, amount, created_at, purchased_at) values (repeat('a',64), 'cs_live_LATEBAD', 'core1', 2000, '2026-10-26 12:24+00', '2026-10-26 12:24+00')" >/dev/null
expect_stop "締め切り後の行が ¥1,000 でない" n2c $S1 "unexpected purchase_entitlements rows after prod_01"
fresh n3; $P -d n3 -c "update public.purchase_entitlements set amount = 1500 where stripe_checkout_session_id like 'cs\_live\_%'" >/dev/null
expect_stop "live の金額が違う" n3 $S1 "counts, amounts or status differ"
fresh n4; $P -d n4 -c "update public.purchase_entitlements set diagnosis_code_hash = repeat('b',64) where stripe_checkout_session_id like 'cs\_test\_%' and amount = 1000 and id = (select id from public.purchase_entitlements where stripe_checkout_session_id like 'cs\_test\_%' order by id limit 1)" >/dev/null
expect_stop "購入の集計指紋が違う" n4 $S1 "fingerprint differs"
fresh n5; $P -d n5 -c "create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path to 'public' as \$f\$ begin return new; end \$f\$" >/dev/null
expect_stop "主要関数 handle_new_user が違う" n5 $S1 "handle_new_user() differs"
fresh n6; $P -d n6 -c "alter table public.diagnosis_results alter column diagnosis_code type varchar(64)" >/dev/null
expect_stop "既存列の型が違う" n6 $S1 "baseline columns differ"
fresh n7; $P -d n7 -c "drop policy profiles_update_own on public.profiles" >/dev/null
expect_stop "既存 policy が違う" n7 $S1 "baseline policies differ"
fresh n8; $P -d n8 -c "grant execute on function public.handle_new_user() to anon; revoke select on public.report_snapshots from anon" >/dev/null
expect_stop "既存表の権限が違う" n8 $S1 "baseline table grants differ"
fresh n9; $P -d n9 -c "create table public.complete_orders(id int)" >/dev/null
expect_stop "complete 系の表が既にある（部分適用・別系統）" n9 $S1 "registration/complete objects already exist"
# 段階の順序：prod_01 を飛ばして prod_02
fresh n10; expect_stop "prod_01 未適用で prod_02" n10 prod_02_orders_reports_links "prod_01 is not applied"
# 途中失敗：prod_02 の途中で失敗させ、何も残らない（台帳・表・関数）
fresh n11; $P -d n11 -f $Q/$S1.sql >/dev/null
$P -d n11 -c "create function public.complete_result_key(p uuid) returns integer language sql as 'select 1'" >/dev/null
dump n11 /tmp/prodsim/m_before.sql
if $P -d n11 -f $Q/prod_02_orders_reports_links.sql > /tmp/prodsim/neg.out 2>&1; then echo "FAIL mid-failure (applied)"; fail=$((fail+1)); else
  dump n11 /tmp/prodsim/m_after.sql
  ln=$(grep -m1 -o "prod_02_orders_reports_links.sql:[0-9]*" /tmp/prodsim/neg.out)
  if cmp -s /tmp/prodsim/m_before.sql /tmp/prodsim/m_after.sql && [ "$($B/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres -d n11 -c "select count(*) from element_release.migration_ledger")" = 1 ] \
     && [ "$($B/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres -d n11 -c "select (to_regclass('public.complete_orders') is null)::text")" = true ]; then
    echo "PASS 途中失敗（$ln で失敗）→ 全体が戻り、prod_02 の物は何も残らない"; pass=$((pass+1)); else echo "FAIL mid-failure left changes"; fail=$((fail+1)); fi; fi
# 段階の間に旧 main（/api/verify）で正規の Live 購入が入っても、次の段階は進める（基準の9件だけを照合）
fresh n12; $P -d n12 -f $Q/$S1.sql >/dev/null
$P -d n12 -c "insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, product_type, amount) values (repeat('c',64), 'cs_live_AFTERPROD01', 'core1', 1000)" >/dev/null
if $P -d n12 -f $Q/prod_02_orders_reports_links.sql >/tmp/prodsim/neg.out 2>&1 && $P -d n12 -f $Q/prod_03_reissue_and_constraints.sql >>/tmp/prodsim/neg.out 2>&1 && $P -d n12 -f $Q/prod_04a_onboarding_required_state.sql >>/tmp/prodsim/neg.out 2>&1 && $P -d n12 -f $Q/prod_04b_onboarding_enforcement.sql >>/tmp/prodsim/neg.out 2>&1; then echo "PASS 段階の間に正規の Live 購入 → prod_02〜04b は進む"; pass=$((pass+1)); else echo "FAIL live purchase between stages: $(grep -m1 ERROR /tmp/prodsim/neg.out)"; fail=$((fail+1)); fi
# その状態から全段階を戻せる（旧購入・後から入った購入には触れない）
ok=1; for r in prod_95_rollback_04b_DRAFT_DO_NOT_RUN prod_94_rollback_04a_DRAFT_DO_NOT_RUN prod_93_rollback_03_DRAFT_DO_NOT_RUN prod_92_rollback_02_DRAFT_DO_NOT_RUN prod_91_rollback_01_DRAFT_DO_NOT_RUN; do $P -d n12 -f $Q/$r.sql >/tmp/prodsim/neg.out 2>&1 || { ok=0; echo "  $r: $(grep -m1 ERROR /tmp/prodsim/neg.out)"; }; done
[ $ok = 1 ] && [ "$($B/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres -d n12 -c "select count(*) from public.purchase_entitlements")" = 10 ] && { echo "PASS その状態から全段階を戻せ、購入10件は残る"; pass=$((pass+1)); } || { echo "FAIL rollback with later live purchase"; fail=$((fail+1)); }
# 段階の間に Live 以外の行が入ったら止まる
fresh n13; $P -d n13 -f $Q/$S1.sql >/dev/null
$P -d n13 -c "insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, product_type, amount) values (repeat('d',64), 'cs_test_AFTERPROD01', 'core1', 1000)" >/dev/null
expect_stop "段階の間に Live 以外の購入行" n13 prod_02_orders_reports_links "unexpected purchase_entitlements rows after prod_01"
# PostgreSQL 16
W16=/tmp/prodsim16; rm -rf $W16; mkdir -p $W16/s; chown -R postgres $W16
runuser -u postgres -- $PG16_SERVER_BIN/initdb -D $W16/d -U postgres -A trust --no-locale -E UTF8 >/dev/null
runuser -u postgres -- $PG16_SERVER_BIN/pg_ctl -D $W16/d -o "-c listen_addresses='' -c unix_socket_directories=$W16/s -c port=55441" -l $W16/log -w start >/dev/null
P16="$B/psql -X -q -v ON_ERROR_STOP=1 -h $W16/s -p 55441 -U postgres"; A=$(cd "$(dirname "$(readlink -f "$0")")/../../baseline_archive_20261006" && pwd)
$P16 -d postgres -c "create database p16" >/dev/null; $P16 -d p16 -f $A/restore_tools/00_supabase_stub.sql >/dev/null
$P16 -d p16 -c "create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid, provider text)" >/dev/null
for f in $A/000[1-7]*.sql; do $P16 -d p16 --single-transaction -f $f >/dev/null 2>&1; done
$P16 -d p16 -f $H/synthetic_data.sql >/dev/null 2>&1
if $P16 -d p16 -f $Q/$S1.sql > /tmp/prodsim/neg.out 2>&1; then echo "FAIL PG16 (applied)"; fail=$((fail+1)); else
  grep -q "postgresql 17 or later is required" /tmp/prodsim/neg.out && { echo "PASS PostgreSQL 16 → stopped"; pass=$((pass+1)); } || { echo "FAIL PG16: $(grep -m1 ERROR /tmp/prodsim/neg.out)"; fail=$((fail+1)); }; fi
runuser -u postgres -- $PG16_SERVER_BIN/pg_ctl -D $W16/d -m fast stop >/dev/null; rm -rf $W16
echo "TOTAL pass=$pass fail=$fail"
