#!/bin/bash
# 段階 6（prod_06_jagan）のローカル検証：本番相当 PG17（合成データ）に prod_01〜04b を当てた状態から、
#   適用 → 状態確認 → 二度適用は止まる → 既存の不変項目（prod_80）が変わらない → 2商品の注文・支払い・権利（service_role）
#   → データがあると rollback は止まる → 空の複製で rollback → 段階5の状態に戻る → 再適用
# 使い方（root）：PG17_SERVER_BIN=<PG17 の bin> PG17_BIN=<psql のある bin> ./stage6.sh
set -e
H=$(dirname "$(readlink -f "$0")"); . "$H/env.sh"
"$H/harness.sh" stop || true; "$H/harness.sh" start; "$H/harness.sh" mkprod prod0; "$H/mkcopies.sh" >/dev/null
P="$PG17_BIN/psql -X -q -v ON_ERROR_STOP=1 -h /tmp/prodsim/s -p 55440 -U postgres"; A="$PG17_BIN/psql -X -At -h /tmp/prodsim/s -p 55440 -U postgres"
Q=/tmp/prodsim/sql; INV=$(cd "$H/.." && pwd)/prod_80_invariants_READONLY.sql; R=$(cd "$H/.." && pwd)
pass=0; fail=0; ok() { echo "PASS $1"; pass=$((pass+1)); }; ng() { echo "FAIL $1"; fail=$((fail+1)); }
cp $R/prod_06_jagan.sql $R/prod_86_postcheck_06_READONLY.sql $R/prod_96_rollback_06_DRAFT_DO_NOT_RUN.sql $Q/ 2>/dev/null; $H/mkcopies.sh >/dev/null
fp() { $A -d $1 -c "select md5(string_agg(x, ',' order by x)) from (
  select 'c:'||table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x from information_schema.columns where table_schema in ('public','element_release')
  union all select 'f:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace in ('public'::regnamespace) and p.prokind='f'
  union all select 'k:'||conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
  union all select 'p:'||tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='public'
  union all select 'i:'||indexdef from pg_indexes where schemaname='public'
  union all select 'g:'||table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')
  union all select 't:'||tgrelid::regclass::text||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%') q"; }
inv() { $A -d $1 -f $INV | grep -v "^info\." ; }
$P -d postgres -c "drop database if exists s6" -c "create database s6 template prod0" >/dev/null
for s in prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints prod_04a_onboarding_required_state prod_04b_onboarding_enforcement; do
  $P -d s6 -f $Q/$s.sql >/dev/null 2>/tmp/prodsim/s6_$s.err || { ng "apply $s: $(grep -m1 ERROR /tmp/prodsim/s6_$s.err)"; exit 1; }; done
ok "prod_01〜04b を適用（本番と同じ段階5）"
F5=$(fp s6); I5=$(inv s6)
$P -d s6 -f $Q/prod_06_jagan.sql >/tmp/prodsim/s6_06.out 2>&1 && ok "apply prod_06_jagan" || { ng "apply prod_06: $(grep -m1 ERROR /tmp/prodsim/s6_06.out)"; exit 1; }
[ "$($A -d s6 -c "select array_agg(stage order by stage) from element_release.migration_ledger")" = "{1,2,3,4,5,6}" ] && ok "台帳に stage 6" || ng "ledger"
$A -d s6 -f $R/prod_86_postcheck_06_READONLY.sql > /tmp/prodsim/s6_post.txt; grep -q "jagan.functions|7 " /tmp/prodsim/s6_post.txt && grep -q "jagan.browser_exec|0 " /tmp/prodsim/s6_post.txt && grep -q "jagan.orders_live_only|1 " /tmp/prodsim/s6_post.txt && ok "postcheck（関数7・ブラウザ実行0・Live だけ）" || { ng "postcheck"; cat /tmp/prodsim/s6_post.txt; }
[ "$(inv s6)" = "$I5" ] && ok "既存の不変項目（prod_80）が適用前と同じ" || ng "invariants changed"
F6=$(fp s6)
$P -d s6 -f $Q/prod_06_jagan.sql >/tmp/prodsim/s6_twice.out 2>&1 && ng "二度適用が止まらない" || { grep -q stage_already_applied /tmp/prodsim/s6_twice.out && ok "二度適用は stage_already_applied で止まる" || ng "twice: $(grep -m1 ERROR /tmp/prodsim/s6_twice.out)"; }
[ "$(fp s6)" = "$F6" ] && ok "二度適用で何も変わらない" || ng "changed after twice"
# 2商品の注文 → 支払い → 権利（service_role）。Test の注文は断られる
U=$($A -d s6 -c "select id from auth.users order by id limit 1")
$A -d s6 -c "insert into public.jagan_results (result_id, user_id, schema_version, engine_version, item_set_version, scoring_version, interpretation_version, character_model_version, dti_code, naming_version, answers, snapshot, headline) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '$U', 'jagan-result-3', 'e', 'i', 's', 'p', 'c', 'HYDP', 'n', '{\"q\":1}', '{}', '{}')" >/dev/null
$A -d s6 -c "update public.profiles set onboarding_status='completed' where id='$U'" >/dev/null 2>&1 || true
ord() { $A -d s6 -c "begin; set local role service_role; select order_id from public.jagan_create_order('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'i', '{\"q\":1}', 'HYDP', '{}', '$U', '$1', 'jo_$(printf "%040d" $2)', '$(printf "%064d" $2)', '$3'); commit;" 2>&1 | grep -E '^[0-9a-f-]{36}$|ERROR' ; }
pay() { $A -d s6 -c "begin; set local role service_role; select public.jagan_mark_checkout_open('$1', 'cs_live_$(printf "%020d" $2)'); select public.jagan_apply_payment('$1', 'cs_live_$(printf "%020d" $2)', 'pi_xxxxxxxxxx', $3, 'jpy', 'paid', true); commit;" | grep -E '^(applied|noop|ignored)'; }
o1=$(ord live 1 jagan_report_v1); o2=$(ord live 2 jagan_complete_v1); ot=$(ord test 3 jagan_report_v1)
echo "$ot" | grep -q ERROR && ok "Test の注文は作れない（Live だけ）" || ng "test order accepted"
[ "$(pay $o1 1 1000)" = "applied" ] && [ "$(pay $o2 2 3000)" = "applied" ] && ok "¥1,000・¥3,000 の支払いを反映" || ng "payment"
[ "$($A -d s6 -c "select string_agg(product_key||'='||status, ',' order by product_key) from public.jagan_entitlements where user_id='$U'")" = "jagan_complete_v1=active,jagan_report_v1=active" ] && ok "両方で2つの権利（COMPLETE）" || ng "entitlements"
[ "$(inv s6)" = "$I5" ] && ok "注文・支払いの後も既存の不変項目が同じ" || ng "invariants changed after orders"
# データがあると rollback は止まる
$P -d s6 -f $Q/prod_96_rollback_06_DRAFT_DO_NOT_RUN.sql >/tmp/prodsim/s6_rb1.out 2>&1 && ng "rollback with data should stop" || { grep -q "jagan data exists" /tmp/prodsim/s6_rb1.out && ok "データがあると rollback は止まる" || ng "rollback with data: $(grep -m1 ERROR /tmp/prodsim/s6_rb1.out)"; }
# 空の状態で rollback → 段階5と同じ → 再適用
$P -d postgres -c "drop database if exists s6b" >/dev/null; $P -d postgres -c "create database s6b template prod0" >/dev/null
for s in prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints prod_04a_onboarding_required_state prod_04b_onboarding_enforcement prod_06_jagan; do $P -d s6b -f $Q/$s.sql >/dev/null 2>&1; done
G6=$(fp s6b)
$P -d s6b -f $Q/prod_96_rollback_06_DRAFT_DO_NOT_RUN.sql >/tmp/prodsim/s6_rb2.out 2>&1 && ok "rollback（空）" || ng "rollback: $(grep -m1 ERROR /tmp/prodsim/s6_rb2.out)"
[ "$(fp s6b)" = "$F5" ] && ok "rollback 後の構造が段階5と同じ" || ng "schema after rollback differs from stage 5"
[ "$(inv s6b)" = "$I5" ] && ok "rollback 後の不変項目が同じ" || ng "invariants after rollback"
$P -d s6b -f $Q/prod_06_jagan.sql >/dev/null 2>&1 && ok "再適用" || ng "reapply"
[ "$(fp s6b)" = "$G6" ] && ok "再適用後の構造が最初の適用と同じ" || ng "schema after reapply differs"
echo "TOTAL pass=$pass fail=$fail"
