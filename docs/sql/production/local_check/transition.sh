#!/bin/bash
# 切り替え中の状態の試験（prod_01〜03 → 04a → 新コード → 04b、障害時、04a／04b の rollback）
#   合成データの本番相当 DB（prod0）を複製して使う。出力は PASS／FAIL だけ
H=$(dirname "$(readlink -f "$0")"); . "$H/env.sh"; "$H/mkcopies.sh" >/dev/null || exit 1
P="$B/psql -X -q -v ON_ERROR_STOP=1 -h /tmp/prodsim/s -p 55440 -U postgres"; Q=/tmp/prodsim/sql
INV=$(cd "$H/.." && pwd)/prod_80_invariants_READONLY.sql
$B/psql -X -q -h /tmp/prodsim/s -p 55440 -U postgres -d postgres -c "select 1" >/dev/null 2>&1 || { echo "FAIL server_reachable: ローカルの PG17 が動いていない（harness.sh start）"; exit 1; }
pass=0; fail=0; ok() { echo "PASS $1"; pass=$((pass+1)); }; ng() { echo "FAIL $1"; fail=$((fail+1)); }
dump() { $B/pg_dump -h /tmp/prodsim/s -p 55440 -U postgres -d $1 --schema-only -n public -n element_release | grep -v -E "^--|^$|^SET |^SELECT pg_catalog|^\\\\(un)?restrict" > $2; [ -s $2 ] || { echo "FAIL empty schema dump ($1)"; exit 1; }; }
inv() { $B/psql -X -q -At -h /tmp/prodsim/s -p 55440 -U postgres -d $1 -f $INV | grep -v '^info\.' > $2; [ -s $2 ] || { echo "FAIL empty invariants ($1)"; exit 1; }; }
apply() { $P -d $1 -f $Q/$2.sql > /tmp/prodsim/tr.out 2>&1; }
# SQL を実行して 1 行の結果を返す（$1 db、$2 SQL）
val() { $B/psql -X -q -At -h /tmp/prodsim/s -p 55440 -U postgres -d $1 -c "$2" 2>&1 | tail -1; }
# 利用者として実行（$1 db、$2 uid、$3 SQL）。成功なら OK、失敗ならエラー文
as_user() { $B/psql -X -q -At -h /tmp/prodsim/s -p 55440 -U postgres -d $1 2>&1 <<SQL | tail -1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '$2', true) \g /dev/null
do \$\$ begin $3; raise notice 'RESULT OK'; exception when others then raise notice 'RESULT %', sqlerrm; end \$\$;
commit;
SQL
}
signup() { val $1 "set role supabase_auth_admin; insert into auth.users(id) values ('$2'); reset role; select onboarding_status from public.profiles where id = '$2'"; }
SAVE="perform public.save_diagnosis_session('element', 'v1', 's1', gen_random_uuid(), now(), '{\"q1\":3}', 'enc', '{\"t\":\"x\"}', '{\"a\":1}', '[]', 'TRANSITIONCODE')"
RPC() { echo "perform public.complete_registration_onboarding('$1', '$2', '$3')"; }
LEG=00000000-0000-4000-8000-000000000001
U2=00000000-0000-4000-8000-0000000000c2   # 04a の後・新コードの前に旧画面で登録した人
U3=00000000-0000-4000-8000-0000000000c3   # 新コードの後に登録した人
U4=00000000-0000-4000-8000-0000000000c4   # 04b の後に登録して、まだ同意していない人
U1=00000000-0000-4000-8000-0000000000c1   # 01〜03 の間に登録した人
$P -d postgres -c "drop database if exists tr" -c "create database tr template prod0" >/dev/null
inv tr /tmp/prodsim/tr_i0.tsv
for s in prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints; do apply tr $s || ng "apply $s"; done
# ---- 1. 01〜03 の後 ----
r=$(as_user tr $LEG "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[01〜03] 既存利用者が旧画面で保存できる" || ng "[01〜03] existing save: $r"
r=$(signup tr $U1); [ "$r" = legacy_exempt ] && ok "[01〜03] 新規利用者は legacy_exempt" || ng "[01〜03] new signup: $r"
r=$(as_user tr $U1 "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[01〜03] 新規利用者も旧画面で保存できる" || ng "[01〜03] new save: $r"
# ---- 2. 04a の後・deploy の前 ----
dump tr /tmp/prodsim/tr_d3.sql
apply tr prod_04a_onboarding_required_state && ok "[04a] 適用" || ng "[04a] apply: $(grep -m1 ERROR /tmp/prodsim/tr.out)"
dump tr /tmp/prodsim/tr_d4a.sql
r=$(signup tr $U2); [ "$r" = required ] && ok "[04a・deploy前] 新規利用者は required" || ng "[04a] new signup: $r"
r=$(as_user tr $U2 "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04a・deploy前] required の人も旧画面で診断を保存できる（deploy が遅れても保存できる）" || ng "[04a] required save: $r"
r=$(val tr "select coalesce(terms_version,'null')||'/'||coalesce(privacy_version,'null')||'/'||coalesce(newsletter_consent_version,'null')||'/'||coalesce(onboarding_completed_at::text,'null') from public.profiles where id = '$U2'")
[ "$r" = "null/null/null/null" ] && ok "[04a・deploy前] 同意版は勝手に記録されない" || ng "[04a] consent recorded: $r"
r=$(val tr "select string_agg(onboarding_status, ',' order by id) from public.profiles where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003')")
[ "$r" = "legacy_exempt,legacy_exempt,legacy_exempt" ] && ok "[04a・deploy前] 既存3人は legacy_exempt のまま" || ng "[04a] existing: $r"
r=$(val tr "select onboarding_status from public.profiles where id = '$U1'"); [ "$r" = legacy_exempt ] && ok "[04a] 01〜03 の間の登録者は legacy_exempt のまま（一括で required にしない）" || ng "[04a] U1: $r"
# ---- 3. 04a の後・新コード（登録完了 RPC＝新しい画面の同意） ----
r=$(signup tr $U3); [ "$r" = required ] && ok "[04a・新コード] 新規登録は required（新しい画面は同意画面を出す）" || ng "[04a new] signup: $r"
r=$(as_user tr $U3 "$(RPC 2026-10-21 2026-10-21 2026-10-07-v1)"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04a・新コード] 2026-10-21／2026-10-21／2026-10-07-v1 で登録完了できる" || ng "[04a new] rpc: $r"
r=$(val tr "select onboarding_status||'/'||terms_version||'/'||privacy_version||'/'||newsletter_consent_version||'/'||(onboarding_completed_at is not null) from public.profiles where id = '$U3'")
[ "$r" = "completed/2026-10-21/2026-10-21/2026-10-07-v1/true" ] && ok "[04a・新コード] 同意の組と日時が記録される" || ng "[04a new] recorded: $r"
r=$(as_user tr $U3 "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04a・新コード] 登録完了後に保存できる" || ng "[04a new] save: $r"
r=$(as_user tr $U2 "$(RPC 2026-10-21 2026-10-21 2026-10-07-v1)"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04a・新コード] 旧画面で作られた required の人も、新コードで同意へ進める" || ng "[04a new] U2 rpc: $r"
r=$(as_user tr $LEG "$(RPC 2026-10-21 2026-10-21 2026-10-07-v1)"); [ "$r" = "NOTICE:  RESULT onboarding_not_required" ] && ok "[04a・新コード] 既存利用者（legacy_exempt）の同意・配信設定は変えない（RPC は対象外で断る）" || ng "[04a new] legacy rpc: $r"
# ---- 5-3. 04b の transaction が失敗しても 04a の状態のまま ----
dump tr /tmp/prodsim/tr_d4a2.sql
sed 's/^commit;$/select 1\/0;\ncommit;/' $Q/prod_04b_onboarding_enforcement.sql > /tmp/prodsim/sql/prod_04b_FAILINJECT.sql
if apply tr prod_04b_FAILINJECT; then ng "[障害] 04b の失敗の再現（成功してしまった）"; else
  dump tr /tmp/prodsim/tr_d4a3.sql
  cmp -s /tmp/prodsim/tr_d4a2.sql /tmp/prodsim/tr_d4a3.sql && [ "$(val tr "select array_agg(stage order by stage)::text from element_release.migration_ledger")" = "{1,2,3,4}" ] \
    && ok "[障害] 04b の transaction が途中で失敗 → 04a の状態のまま（構造・台帳とも変化なし）" || ng "[障害] 04b failure changed state"
  U5=00000000-0000-4000-8000-0000000000c5; signup tr $U5 >/dev/null
  r=$(as_user tr $U5 "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[障害] 04b 失敗後も旧画面・新画面とも保存を続けられる" || ng "[障害] save after 04b failure: $r"
fi
# ---- 4. 04b の後 ----
apply tr prod_04b_onboarding_enforcement && ok "[04b] 適用" || ng "[04b] apply: $(grep -m1 ERROR /tmp/prodsim/tr.out)"
dump tr /tmp/prodsim/tr_d4b.sql
r=$(signup tr $U4); [ "$r" = required ] || ng "[04b] signup: $r"
r=$(as_user tr $U4 "$SAVE"); [ "$r" = "NOTICE:  RESULT onboarding_required" ] && ok "[04b] required のままでは保存を拒否（onboarding_required）" || ng "[04b] required save: $r"
r=$(as_user tr $U3 "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04b] 登録完了済みは保存できる" || ng "[04b] completed save: $r"
r=$(as_user tr $LEG "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04b] legacy_exempt（既存利用者）は保存できる" || ng "[04b] legacy save: $r"
r=$(as_user tr $U1 "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04b] 01〜03 の間に登録した legacy_exempt も保存できる" || ng "[04b] U1 save: $r"
for v in "2026-10-07 2026-10-13 2026-10-07-v1" "2026-10-07 2026-10-07 2026-10-07-v1" "2026-10-07 2026-10-21 2026-10-07-v1" "2026-10-21 2026-10-13 2026-10-07-v1" "2026-10-21 2026-10-21 2026-10-21-v1"; do
  set -- $v; r=$(as_user tr $U4 "$(RPC $1 $2 $3)"); [ "$r" = "NOTICE:  RESULT unsupported_consent_version" ] && ok "[04b] 旧版・混在版を拒否：$1／$2／$3" || ng "[04b] version $v: $r"; done
r=$(as_user tr $U4 "$(RPC 2026-10-21 2026-10-21 2026-10-07-v1)"); [ "$r" = "NOTICE:  RESULT OK" ] && r=$(as_user tr $U4 "$SAVE") && [ "$r" = "NOTICE:  RESULT OK" ] && ok "[04b] 新しい組で登録完了した後は保存できる" || ng "[04b] complete then save: $r"
# ---- 6. rollback ----
apply tr prod_95_rollback_04b_DRAFT_DO_NOT_RUN && ok "[rollback] 04b だけを戻せる（データの変更なし）" || ng "[rollback] 95: $(grep -m1 ERROR /tmp/prodsim/tr.out)"
dump tr /tmp/prodsim/tr_d4a4.sql; cmp -s /tmp/prodsim/tr_d4a.sql /tmp/prodsim/tr_d4a4.sql && ok "[rollback] 04b を戻した構造＝04a の構造" || ng "[rollback] structure after 95 differs from 04a"
r=$(as_user tr $(val tr "select id from public.profiles where onboarding_status = 'required' limit 1") "$SAVE"); [ "$r" = "NOTICE:  RESULT OK" ] && ok "[rollback] 04b を戻すと required でも保存できる（04a の状態）" || ng "[rollback] save after 95: $r"
if apply tr prod_94_rollback_04a_DRAFT_DO_NOT_RUN; then ng "[rollback] 04a 後に作られた profile があるのに 04a を戻せてしまった"; else
  grep -q "profiles were created after prod_04a" /tmp/prodsim/tr.out && ok "[rollback] 04a の後に作られた profile があれば 04a の rollback は止まる" || ng "[rollback] 94 stop reason: $(grep -m1 ERROR /tmp/prodsim/tr.out)"; fi
r=$(val tr "select string_agg(onboarding_status, ',' order by id) from public.profiles where id in ('$U2', '$U3', '$U4')"); [ "$r" = "completed,completed,completed" ] && ok "[rollback] 止まった rollback は登録・同意の記録を変えない" || ng "[rollback] states: $r"
# 04a の後に profile が無い時は 04a を戻せる（別の DB）
$P -d postgres -c "drop database if exists tr2" -c "create database tr2 template prod0" >/dev/null
for s in prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints; do apply tr2 $s; done; dump tr2 /tmp/prodsim/tr2_d3.sql
apply tr2 prod_04a_onboarding_required_state && apply tr2 prod_04b_onboarding_enforcement && apply tr2 prod_95_rollback_04b_DRAFT_DO_NOT_RUN && apply tr2 prod_94_rollback_04a_DRAFT_DO_NOT_RUN \
  && dump tr2 /tmp/prodsim/tr2_d3b.sql && cmp -s /tmp/prodsim/tr2_d3.sql /tmp/prodsim/tr2_d3b.sql && ok "[rollback] 04a の後に profile が無ければ 95→94 で 03 の状態へ戻る（構造一致）" || ng "[rollback] 95→94 on clean db"
inv tr2 /tmp/prodsim/tr2_i.tsv; cmp -s /tmp/prodsim/tr_i0.tsv /tmp/prodsim/tr2_i.tsv && ok "[rollback] 既存利用者・診断・購入の不変項目が適用前と一致" || ng "[rollback] invariants differ"
# 既存データ（合成の既存3人・8記録・9購入）の不変：切り替え中に作った記録を除いて比べる
r=$(val tr "select count(*) from public.purchase_entitlements")$(val tr "select '/'||count(*) from public.profiles where id::text like '00000000-0000-4000-8000-00000000000_' and onboarding_status = 'legacy_exempt' and terms_version is null")
[ "$r" = "9/3" ] && ok "[S0] 切り替え中も購入9件・既存3人（legacy_exempt・同意の記録なし）は不変" || ng "[S0] $r"
echo "TOTAL pass=$pass fail=$fail"
