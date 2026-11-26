#!/bin/bash
# 段階 7（prod_07_type_report）のローカル検証：本番相当 PG17（合成データ）に prod_01〜06 を当てた状態から、
#   適用 → 状態確認 → 二度適用は止まる → 既存の不変項目（prod_80）が変わらない → 注文・支払い（service_role・Live だけ）
#   → データがあると rollback は止まる → 空の複製で rollback → 段階6の状態に戻る → 再適用
# 使い方（root）：PG17_SERVER_BIN=<PG17 の bin> PG17_BIN=<psql のある bin> ./stage7.sh
set -e
H=$(dirname "$(readlink -f "$0")"); . "$H/env.sh"
"$H/harness.sh" stop || true; "$H/harness.sh" start; "$H/harness.sh" mkprod prod0; "$H/mkcopies.sh" >/dev/null
P="$PG17_BIN/psql -X -q -v ON_ERROR_STOP=1 -h /tmp/prodsim/s -p 55440 -U postgres"; A="$PG17_BIN/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres"
Q=/tmp/prodsim/sql; INV=$(cd "$H/.." && pwd)/prod_80_invariants_READONLY.sql; R=$(cd "$H/.." && pwd)
pass=0; fail=0; ok() { echo "PASS $1"; pass=$((pass+1)); }; ng() { echo "FAIL $1"; fail=$((fail+1)); }
fp() { $A -d $1 -c "select md5(string_agg(x, ',' order by x)) from (
  select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x from information_schema.columns where table_schema in ('public','element_release')
  union all select 'f:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace in ('public'::regnamespace) and p.prokind='f'
  union all select 'k:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
  union all select 'p:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='public'
  union all select 'i:'||indexdef from pg_indexes where schemaname='public'
  union all select 'g:'||table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')
  union all select 't:'||tgrelid::regclass::text||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%') q"; }
inv() { $A -d $1 -f $INV | grep -v "^info\." ; }
ST6="prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints prod_04a_onboarding_required_state prod_04b_onboarding_enforcement prod_06_jagan"
$P -d postgres -c "drop database if exists s7" -c "create database s7 template prod0" >/dev/null
for s in $ST6; do
  $P -d s7 -f $Q/$s.sql >/dev/null 2>/tmp/prodsim/s7_$s.err || { ng "apply $s: $(grep -m1 ERROR /tmp/prodsim/s7_$s.err)"; exit 1; }; done
ok "prod_01〜06 を適用（本番と同じ段階6）"
F6=$(fp s7); I6=$(inv s7)
$P -d s7 -f $Q/prod_07_type_report.sql >/tmp/prodsim/s7_07.out 2>&1 && ok "apply prod_07_type_report" || { ng "apply prod_07: $(grep -m1 ERROR /tmp/prodsim/s7_07.out)"; exit 1; }
[ "$($A -d s7 -c "select array_agg(stage order by stage) from element_release.migration_ledger")" = "{1,2,3,4,5,6,7}" ] && ok "台帳に stage 7" || ng "ledger"
$A -d s7 -f $R/prod_87_postcheck_07_READONLY.sql > /tmp/prodsim/s7_post.txt; grep -q "type_report.functions|5 " /tmp/prodsim/s7_post.txt && grep -q "type_report.browser_exec|0 " /tmp/prodsim/s7_post.txt && grep -q "type_report.orders_live_only|1 " /tmp/prodsim/s7_post.txt && grep -q "type_report.table|type_report_orders(RLS)" /tmp/prodsim/s7_post.txt && ok "postcheck（関数5・ブラウザ実行0・Live だけ・RLS）" || { ng "postcheck"; cat /tmp/prodsim/s7_post.txt; }
[ "$(inv s7)" = "$I6" ] && ok "既存の不変項目（prod_80）が適用前と同じ" || ng "invariants changed"
F7=$(fp s7)
$P -d s7 -f $Q/prod_07_type_report.sql >/tmp/prodsim/s7_twice.out 2>&1 && ng "二度適用が止まらない" || { grep -q stage_already_applied /tmp/prodsim/s7_twice.out && ok "二度適用は stage_already_applied で止まる" || ng "twice: $(grep -m1 ERROR /tmp/prodsim/s7_twice.out)"; }
[ "$(fp s7)" = "$F7" ] && ok "二度適用で何も変わらない" || ng "changed after twice"
# 注文 → 決済画面 → 支払い（service_role）。Test の注文は断られる・ブラウザのロールは表を読めない
ord() { $A -d s7 -c "begin; set local role service_role; select order_id from public.type_report_create_order('PYSW', 'v2', 'ABCDEFGH12345678', '$1', 'to_$(printf "%040d" $2)', '$(printf "%064d" $2)'); commit;" 2>&1 | grep -E '^[0-9a-f-]{36}$|ERROR' ; }
o1=$(ord live 1); ot=$(ord test 2)
echo "$o1" | grep -qE '^[0-9a-f-]{36}$' && ok "Live の注文を作れる" || ng "live order: $o1"
echo "$ot" | grep -q ERROR && ok "Test の注文は作れない（Live だけ）" || ng "test order accepted"
r=$($A -d s7 -c "begin; set local role service_role; select public.type_report_mark_checkout_open('$o1', 'cs_live_$(printf "%020d" 1)'); select public.type_report_apply_payment('$o1', 'cs_live_$(printf "%020d" 1)', 'pi_xxxxxxxxxx', 1000, 'jpy', 'paid', true); commit;" | grep -E '^(applied|noop|ignored)')
[ "$r" = "applied" ] && [ "$($A -d s7 -c "select status from public.type_report_orders where id='$o1'")" = "paid" ] && ok "¥1,000 の支払いを反映（paid）" || ng "payment: $r"
$A -d s7 -c "begin; set local role anon; select count(*) from public.type_report_orders; commit;" >/dev/null 2>&1 && ng "anon can read" || ok "anon は表を読めない"
$A -d s7 -c "begin; set local role authenticated; select count(*) from public.type_report_orders; commit;" >/dev/null 2>&1 && ng "authenticated can read" || ok "authenticated は表を読めない"
[ "$(inv s7)" = "$I6" ] && ok "注文・支払いの後も既存の不変項目が同じ" || ng "invariants changed after orders"
# データがあると rollback は止まる
$P -d s7 -f $Q/prod_97_rollback_07_DRAFT_DO_NOT_RUN.sql >/tmp/prodsim/s7_rb1.out 2>&1 && ng "rollback with data should stop" || { grep -q "type_report data exists" /tmp/prodsim/s7_rb1.out && ok "データがあると rollback は止まる" || ng "rollback with data: $(grep -m1 ERROR /tmp/prodsim/s7_rb1.out)"; }
# 空の状態で rollback → 段階6と同じ → 再適用
$P -d postgres -c "drop database if exists s7b" >/dev/null; $P -d postgres -c "create database s7b template prod0" >/dev/null
for s in $ST6 prod_07_type_report; do $P -d s7b -f $Q/$s.sql >/dev/null 2>&1; done
G7=$(fp s7b)
$P -d s7b -f $Q/prod_97_rollback_07_DRAFT_DO_NOT_RUN.sql >/tmp/prodsim/s7_rb2.out 2>&1 && ok "rollback（空）" || ng "rollback: $(grep -m1 ERROR /tmp/prodsim/s7_rb2.out)"
[ "$(fp s7b)" = "$F6" ] && ok "rollback 後の構造が段階6と同じ" || ng "schema after rollback differs from stage 6"
[ "$(inv s7b)" = "$I6" ] && ok "rollback 後の不変項目が同じ" || ng "invariants after rollback"
$P -d s7b -f $Q/prod_07_type_report.sql >/dev/null 2>&1 && ok "再適用" || ng "reapply"
[ "$(fp s7b)" = "$G7" ] && ok "再適用後の構造が最初の適用と同じ" || ng "schema after reapply differs"
# prod_07 を当てずに prod_06 の段階で止まっている DB に、prod_06 の前の段階から prod_07 を当てようとしても止まる
$P -d postgres -c "drop database if exists s7c" -c "create database s7c template prod0" >/dev/null
for s in prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints prod_04a_onboarding_required_state prod_04b_onboarding_enforcement; do $P -d s7c -f $Q/$s.sql >/dev/null 2>&1; done
$P -d s7c -f $Q/prod_07_type_report.sql >/tmp/prodsim/s7_order.out 2>&1 && ng "prod_07 before prod_06 should stop" || { grep -q "previous stages in order" /tmp/prodsim/s7_order.out && ok "prod_06 の前に prod_07 は当たらない" || ng "order: $(grep -m1 ERROR /tmp/prodsim/s7_order.out)"; }
echo "TOTAL pass=$pass fail=$fail"
