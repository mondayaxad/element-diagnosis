#!/bin/bash
# 実PG17の試験を、まとめて実行する（使い捨てのサーバーを起動 → 試験 → 停止）。docs/TESTING_PG.md
#   使い方:  tests/pg/run_all.sh            （サーバーを起動して、終わったら停止）
#            E2E_PG_EXTERNAL=1 tests/pg/run_all.sh   （すでに起動している使い捨てサーバーを使う：CI の service コンテナなど。E2E_PG_HOST・E2E_PG_PORT を指定）
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -z "${E2E_PG_EXTERNAL:-}" ]; then
  tests/pg/local_pg.sh start
  trap 'tests/pg/local_pg.sh stop >/dev/null' EXIT
  eval "$(tests/pg/local_pg.sh env)"
fi
export E2E_PG=1
PSQL=${E2E_PG_PSQL:-psql}
echo "== 実PG17：旧版購入権の引き継ぎ・構造の確認"
node --test --test-concurrency=1 tests/pg/*.pg.test.js
echo "== 既存のDB依存試験（購入の経路・整合・返金・ロックの順序ほか）を実PG17で：Preview 相当（Stripe Test）と本番相当（Live）"
for mode in test live; do
  if [ "$mode" = live ]; then export COMPLETE_DB_STRIPE_MODE=live; else unset COMPLETE_DB_STRIPE_MODE; fi
  COMPLETE_DB_BACKEND="$PWD/tests/pg/backend.js" node --test --test-concurrency=1 \
    tests/link_purchase_api.test.js tests/complete_guest_api.test.js tests/complete_report_job.test.js \
    tests/no_upgrade_price_env.test.js tests/purchase_integrity_api.test.js
done
unset COMPLETE_DB_STRIPE_MODE
echo "== 既存のDB依存試験のうち、PGの psql で動くもの（complete_16 の同意の組）"
TMPL=$(node -e "process.stdout.write(require('./tests/pg/db_setup').createPreviewLikeDb({upTo:99}))")
trap 'node -e "require(\"./tests/pg/db_setup\").dropDb(\"$TMPL\")" >/dev/null 2>&1; [ -z "${E2E_PG_EXTERNAL:-}" ] && tests/pg/local_pg.sh stop >/dev/null' EXIT
PGT_HOST=$E2E_PG_HOST PQ="$PSQL -h $E2E_PG_HOST -p ${E2E_PG_PORT:-55440} -U ${E2E_PG_USER:-postgres} -X -q" PGT_TEMPLATE=$TMPL node --test tests/consent_pairs_db.test.js
