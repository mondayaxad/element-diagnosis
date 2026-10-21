#!/bin/bash
# 適用 → 二度適用 → rollback → 一致確認 → 再適用 を合成データの本番相当DBで行う
H=$(dirname "$(readlink -f "$0")"); $H/mkcopies.sh >/dev/null || exit 1
. "$(dirname "$(readlink -f "$0")")/env.sh"
P="$B/psql -X -q -v ON_ERROR_STOP=1 -h /tmp/prodsim/s -p 55440 -U postgres"; Q=/tmp/prodsim/sql; INV=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)/prod_80_invariants_READONLY.sql
dump() { $B/pg_dump -h /tmp/prodsim/s -p 55440 -U postgres -d $1 --schema-only -n public -n element_release | grep -v -E "^--|^$|^SET |^SELECT pg_catalog|^\\\\(un)?restrict" > $2; [ -s $2 ] || { echo "FAIL empty schema dump ($1)"; exit 1; }; }
inv() { $B/psql -X -q -At -h /tmp/prodsim/s -p 55440 -U postgres -d $1 -f $INV | grep -v "^info\." > $2; [ -s $2 ] || { echo "FAIL empty invariants ($1)"; exit 1; }; }
run() { $P -d cyc -f $Q/$1.sql > /tmp/prodsim/cyc_$1.out 2>&1; }
$B/psql -X -q -h /tmp/prodsim/s -p 55440 -U postgres -d postgres -c "select 1" >/dev/null 2>&1 || { echo "FAIL server_reachable: ローカルの PG17 が動いていない（harness.sh start）"; exit 1; }
pass=0; fail=0; ok() { echo "PASS $1"; pass=$((pass+1)); }; ng() { echo "FAIL $1"; fail=$((fail+1)); }
$P -d postgres -c "drop database if exists cyc" -c "create database cyc template prod0" >/dev/null
dump cyc /tmp/prodsim/d0.sql; inv cyc /tmp/prodsim/i0.tsv
S="prod_01_registration_compat prod_02_orders_reports_links prod_03_reissue_and_constraints prod_04a_onboarding_required_state prod_04b_onboarding_enforcement"
for s in $S; do run $s && ok "apply $s" || ng "apply $s: $(grep -m1 ERROR /tmp/prodsim/cyc_$s.out)"; inv cyc /tmp/prodsim/ia.tsv; cmp -s /tmp/prodsim/i0.tsv /tmp/prodsim/ia.tsv && ok "invariants after $s" || ng "invariants after $s"; done
dump cyc /tmp/prodsim/d1.sql
# 二度適用：全段階が stage_already_applied で止まり、何も変わらない
for s in $S; do run $s && ng "twice $s (should stop)" || { grep -q stage_already_applied /tmp/prodsim/cyc_$s.out && ok "twice $s stops with stage_already_applied" || ng "twice $s: $(grep -m1 ERROR /tmp/prodsim/cyc_$s.out)"; }; done
dump cyc /tmp/prodsim/d1b.sql; cmp -s /tmp/prodsim/d1.sql /tmp/prodsim/d1b.sql && ok "schema unchanged after twice" || ng "schema changed after twice"
inv cyc /tmp/prodsim/ib.tsv; cmp -s /tmp/prodsim/i0.tsv /tmp/prodsim/ib.tsv && ok "invariants after twice" || ng "invariants after twice"
# 順序違いの rollback は止まる
run prod_91_rollback_01_DRAFT_DO_NOT_RUN && ng "rollback 01 out of order (should stop)" || { grep -q "rollback must be done from the latest stage" /tmp/prodsim/cyc_prod_91_rollback_01_DRAFT_DO_NOT_RUN.out && ok "rollback 01 out of order stops" || ng "rollback 01 out of order: $(grep -m1 ERROR /tmp/prodsim/cyc_prod_91_rollback_01_DRAFT_DO_NOT_RUN.out)"; }
# rollback 04 → 03 → 02 → 01
for r in prod_95_rollback_04b_DRAFT_DO_NOT_RUN prod_94_rollback_04a_DRAFT_DO_NOT_RUN prod_93_rollback_03_DRAFT_DO_NOT_RUN prod_92_rollback_02_DRAFT_DO_NOT_RUN prod_91_rollback_01_DRAFT_DO_NOT_RUN; do
  run $r && ok "rollback $r" || ng "rollback $r: $(grep -m1 ERROR /tmp/prodsim/cyc_$r.out)"; inv cyc /tmp/prodsim/ir.tsv; cmp -s /tmp/prodsim/i0.tsv /tmp/prodsim/ir.tsv && ok "invariants after $r" || ng "invariants after $r"; done
dump cyc /tmp/prodsim/d2.sql; diff /tmp/prodsim/d0.sql /tmp/prodsim/d2.sql > /tmp/prodsim/d0_d2.diff && ok "schema after full rollback == before migration" || ng "schema after full rollback differs ($(wc -l < /tmp/prodsim/d0_d2.diff) lines)"
# 再適用
for s in $S; do run $s && ok "reapply $s" || ng "reapply $s: $(grep -m1 ERROR /tmp/prodsim/cyc_$s.out)"; done
dump cyc /tmp/prodsim/d3.sql; cmp -s /tmp/prodsim/d1.sql /tmp/prodsim/d3.sql && ok "schema after reapply == first apply" || ng "schema after reapply differs"
inv cyc /tmp/prodsim/i3.tsv; cmp -s /tmp/prodsim/i0.tsv /tmp/prodsim/i3.tsv && ok "invariants after reapply" || ng "invariants after reapply"
echo "TOTAL pass=$pass fail=$fail"
