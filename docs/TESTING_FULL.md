# 全テストの実行（スキップ0件）と、検証環境の再現手順

## 3つの入口と対象の範囲
| コマンド | 対象 | DB | スキップ |
|---|---|---|---|
| `npm test` | `tests/*.test.js`（全ファイル） | 使わない（DB の試験はメモリの模型で動くものだけ。実 DB が要るものはスキップ） | DB の試験・PDF・`@vercel/og` が無い時にスキップが出る（開発中の素早い確認用） |
| `npm run test:pg` | `tests/pg/*.pg.test.js`、DB の試験5ファイル（Test と Live の2構成）、同意の組（complete_16） | 実 PostgreSQL 17 | なし |
| **`npm run test:full`** | **すべてを1回ずつ**（下の3段） | 実 PostgreSQL 17 | **0件でなければ失敗**（失敗・キャンセル・todo も同じ） |

`npm run test:full`（`tests/support/run_full.sh`）の3段は、対象が重ならない（二重に数えない）：
1. **全試験**：`npm test` と同じ対象（`tests/*.test.js`）。DB の試験は実 PG17 の Preview 相当（Stripe Test）で動き、同意の組（complete_16）もここに含まれる。
2. **PG 専用の試験**：`tests/pg/*.pg.test.js`（旧版購入権の引き継ぎ・本番相当の構造・邪眼）。
3. **本番相当（Live）**：DB の試験6ファイル（`link_purchase_api`・`complete_guest_api`・`complete_report_job`・`no_upgrade_price_env`・`purchase_integrity_api`・`complete_payment_api`）を、本番の migration（prod_01〜04b・prod_06）を当てた DB で実行する。

件数について（2026-11-24 時点）：
- `npm test` で「同意の組」は1件として数えられる（DB が無くてスキップ）。DB がある時は、その中の10件の小テストとして数えられる。
- このため、1段目の件数は `npm test` より9件多くなる。テストを追加したのではない。

各段の TAP は `tests-out/1-all.tap`・`2-pg.tap`・`3-live.tap` に残る（CI では成果物「test-reports」）。

## 必要なもの
- Node 22、`npm ci`（`package-lock.json` の版。`@vercel/og` もここで入る）
- Playwright 1.63.0 と Chromium（`npm i --prefix <dir> playwright@1.63.0` → `<dir>/node_modules/.bin/playwright install chromium`、`NODE_PATH=<dir>/node_modules`）
- PDF の試験用のライブラリ：`tests/support/pdf_libs.sh <dir>`
  - npm の html2canvas 1.4.1・jsPDF 2.5.1 を取り、`report.html` の SRI（sha512）と一致した時だけ置く。
  - 置いたディレクトリを `PDF_LIBS_DIR` に指定する。
- PostgreSQL 17：下の「CI」か「手元」

## CI（`.github/workflows/quality.yml`）
- PR と main への push で実行し、手動でも起動できる（workflow_dispatch）。
- `services: postgres:17`（使い捨て・合成データだけ）。`E2E_PG_EXTERNAL=1`・`E2E_PG_HOST=localhost`。パスワードはワークフローに書いたダミー値で、秘密ではない。
- 権限は `contents: read` だけで、シークレットは使わない。公開リポジトリなので無料。
- SEO の試験（`.github/workflows/seo.yml`）は別のワークフローとして維持する。

**マージ前の運用**：PR の Checks で **Quality (all tests) / All tests (PostgreSQL 17)** と **SEO regression tests / SEO tests** の両方が緑であることを確認する。
- ブランチ保護で両方を必須にすると、赤のままのマージを GitHub 側でも止められる（リポジトリ管理者の設定）。

## 手元（Docker が無い環境も含む）
`tests/pg/local_pg.sh` は、PostgreSQL 17 のサーバーを一時ディレクトリで、unix ソケットだけ（`listen_addresses=''`）で起動する。外部からは接続できない。

1. サーバーのバイナリを用意する（OS のパッケージ、または npm の `@embedded-postgres/linux-x64@17.12.0-beta.19`）。
   - npm の場合は、取得したファイルの sha512 が `npm view @embedded-postgres/linux-x64@17.12.0-beta.19 dist.integrity` と一致することを確かめる。
   - 展開した `package/native` の `pg-symlinks.json` に従って、共有ライブラリのリンクを作る。
2. 実行する：
   ```sh
   E2E_PG_SERVER_BIN=<native>/bin E2E_PG_LD_LIBRARY_PATH=<native>/lib \
   PDF_LIBS_DIR=<dir> NODE_PATH=<playwright の node_modules> npm run test:full
   ```
   - root で実行する場合、サーバーは postgres ユーザーで起動する。
   - 終わると、サーバーを止めてデータのディレクトリ（`/tmp/e2e-pg`）を消す。
   - psql は 16 でも動く。サーバーが 17 であることは、スクリプトが `server_version_num` で確かめる。

## 安全装置（`tests/pg/pg_env.js`・`tests/support/run_full.sh`）
- **最初の DB 接続（psql によるバージョン確認を含む）より前に**、接続先を検証する（`assertSafeTarget`）。ローカル起動では接続設定の読み込みの直後、外部 PG（`E2E_PG_EXTERNAL=1`）では渡された `E2E_PG_HOST` の確定の直後（未指定なら止まる）。拒否された時は psql を一度も起動しない（`tests/run_full_guard.test.js` が偽の psql で確かめる。`tests/pg/run_all.sh` も同じ）。
- psql の接続先を差し替える環境変数（`PGHOSTADDR`・`PGSERVICE`・`PGSERVICEFILE`・`PGDATABASE`）があれば拒否する。
- 接続先は unix ソケットか localhost だけ。Supabase・プール・クラウドのホストは拒否する。
- `SUPABASE_URL`・`SUPABASE_SECRET_KEY`・`SUPABASE_SERVICE_ROLE_KEY`・`STRIPE_SECRET_KEY`・`REPORT_TOKEN_SECRET` が環境にあれば、起動しない。
- 作るデータベースは `e2e_` で始まる名前だけ。入れるのは合成データだけ。
- 本番の DB（akivoob）・Preview の DB（qelqeh）には接続しない。実際の決済・返金もしない（Stripe は偽物）。

## テスト用 DB の作り方（`tests/pg/db_setup.js`）
- **Preview 相当**：baseline 0001〜0008、`docs/sql/2026*_{onboarding,complete}_*.sql` を番号順に適用する（`createPreviewLikeDb`）。
- **本番相当**：baseline 0001〜0007、合成データ、`prod_01〜03`、complete_17、`prod_04a・04b・06` の順に適用し、合成の既存データを空にする（`createProdLikeDb({ stages: PROD_STAGES_ALL, clearData: true })`。`docs/sql/production/README.md` の手順）。
  - 本番の migration は冒頭で既存の旧購入（9行）などを確かめるため、合成データを入れてから適用する。
  - 空にする時だけ、監査の表の削除禁止トリガーを、この接続の中で止める（`session_replication_role = replica`）。
- 旧版購入権の試験（`tests/pg/legacy_handoff.pg.test.js` など）は、従来どおり `prod_01〜03` までの DB を使う（既定値）。
