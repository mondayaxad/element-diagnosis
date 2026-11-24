#!/bin/bash
# 全テストを、スキップ0件の条件で1回ずつ実行する（品質保証の CI と手元で同じ手順）。docs/TESTING_FULL.md
#   1) 使い捨ての PostgreSQL 17 を起動（CI ではサービスコンテナ：E2E_PG_EXTERNAL=1・E2E_PG_HOST・E2E_PG_PORT）し、版が 17 であることを確かめる
#   2) npm test と同じ対象（tests/*.test.js）を、DB の試験も実 PG17（Preview 相当・Stripe Test）で動く設定で実行する
#   3) PG だけの試験（tests/pg/*.pg.test.js）と、DB の試験の本番相当（Live・prod_01〜04b・prod_06）を実行する
#      （2 と 3 は対象が重ならない：2 は Test 構成、3 は Live 構成と PG 専用の試験。tests/pg/run_all.sh の Test 構成・同意の組は 2 に含まれる）
#   各段の TAP を tests-out/*.tap に残し、失敗・スキップ・キャンセル・todo が1件でもあれば終了コード 1。
#   必要：Node 22、Playwright（Chromium）、PDF_LIBS_DIR（tests/support/pdf_libs.sh）、npm ci 済みの node_modules（@vercel/og）
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${TESTS_OUT:-tests-out}
mkdir -p "$OUT"
: "${PDF_LIBS_DIR:?PDF_LIBS_DIR is required (tests/support/pdf_libs.sh <dir>)}"
for k in SUPABASE_URL SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY STRIPE_SECRET_KEY REPORT_TOKEN_SECRET; do
  if [ -n "${!k:-}" ]; then echo "$k is set: run the tests in a clean environment (no app secrets)" >&2; exit 1; fi
done
if [ -z "${E2E_PG_EXTERNAL:-}" ]; then
  tests/pg/local_pg.sh start
  trap 'tests/pg/local_pg.sh stop >/dev/null' EXIT
  eval "$(tests/pg/local_pg.sh env)"
fi
export E2E_PG=1
PSQL=${E2E_PG_PSQL:-psql}
PQ="$PSQL -h $E2E_PG_HOST -p ${E2E_PG_PORT:-55440} -U ${E2E_PG_USER:-postgres} -X -q"
VER=$($PQ -At -d postgres -c 'show server_version_num')
echo "PostgreSQL server_version_num=$VER"
if [ "${VER:0:2}" != "17" ]; then echo "PostgreSQL 17 is required (got $VER)" >&2; exit 1; fi
TMPL=$(node -e "process.stdout.write(require('./tests/pg/db_setup').createPreviewLikeDb({upTo:99}))")
cleanup_tmpl() { node -e "require('./tests/pg/db_setup').dropDb('$TMPL')" >/dev/null 2>&1 || true; }
if [ -z "${E2E_PG_EXTERNAL:-}" ]; then trap 'cleanup_tmpl; tests/pg/local_pg.sh stop >/dev/null' EXIT; else trap cleanup_tmpl EXIT; fi

status=0
check() { # <name> <tap file>
  local f=$2
  local line; line=$(grep -E '^# (tests|pass|fail|cancelled|skipped|todo) ' "$f" | tr '\n' ' ')
  echo "== $1: $line"
  for k in fail cancelled skipped todo; do
    local n; n=$(grep -E "^# $k " "$f" | tail -1 | awk '{print $3}')
    if [ "${n:-1}" != "0" ]; then echo "::error::$1: $k=$n" ; status=1; fi
  done
  grep -E '^not ok |# SKIP|# TODO' "$f" | sed "s/^/  [$1] /" || true
}
export COMPLETE_DB_BACKEND="$PWD/tests/pg/backend.js"
echo "== 1/3 全試験（npm test の対象）・DB は実PG17（Preview 相当・Stripe Test）"
PGT_HOST=$E2E_PG_HOST PQ="$PQ" PGT_TEMPLATE=$TMPL node --test --test-reporter=tap tests/*.test.js > "$OUT/1-all.tap" || true
check "1-all" "$OUT/1-all.tap"
echo "== 2/3 PG 専用の試験（旧版購入権の引き継ぎ・構造・邪眼）"
node --test --test-reporter=tap --test-concurrency=1 tests/pg/*.pg.test.js > "$OUT/2-pg.tap" || true
check "2-pg" "$OUT/2-pg.tap"
echo "== 3/3 DB の試験を本番相当（Live）で"
COMPLETE_DB_STRIPE_MODE=live node --test --test-reporter=tap --test-concurrency=1 \
  tests/link_purchase_api.test.js tests/complete_guest_api.test.js tests/complete_report_job.test.js \
  tests/no_upgrade_price_env.test.js tests/purchase_integrity_api.test.js > "$OUT/3-live.tap" || true
check "3-live" "$OUT/3-live.tap"
exit $status
