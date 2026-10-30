# 実PG17の試験（tests/pg）

サーバー側の処理（`api/*`・`lib/*`）を、**本物の PostgreSQL 17 に本番相当の構造を作って**通す試験の基盤です。
合成データだけを使い、本番・Preview の Supabase には接続しません。

## 1. 試験の種類（混ぜない）

| 種類 | 置き場所 | DB | 実行 | 目的 |
|---|---|---|---|---|
| 模型の試験 | `tests/*.test.js` | メモリ上の模型（`tests/fixtures/fake_supabase.js`・各試験の偽物） | `npm test` | 画面・処理の分岐の確認。PG は不要で速い |
| **実PG17の試験** | `tests/pg/*.pg.test.js` | 使い捨ての PostgreSQL 17（`e2e_*`）。本番相当の構造・制約・トリガー・権限 | `npm run test:pg` | 制約・トリガー・関数・権限を含む、実DBでの確認 |
| 既存のDB依存試験 | `tests/complete_*`・`link_purchase_api`・`purchase_integrity_api` ほか | `COMPLETE_DB_BACKEND=tests/pg/backend.js`（実PG17） | `npm run test:pg` | 約 100 件（§6）。通常の `npm test` ではスキップ |

実PG17の試験は `E2E_PG=1` のときだけ動き、無ければ**スキップ**します（通常の `npm test` はPGに触れません）。

## 2. 安全装置（`tests/pg/pg_env.js`・`tests/pg_env_guard.test.js` が検査）

- 接続先は **unix ソケットか localhost だけ**。リモートのホスト、`supabase.co` / `supabase.com` / `pooler`、`amazonaws`、`neon.tech` は拒否します。
- 環境に `SUPABASE_URL`・`SUPABASE_SECRET_KEY`・`SUPABASE_SERVICE_ROLE_KEY`・`STRIPE_SECRET_KEY`・`REPORT_TOKEN_SECRET` があれば**実行しません**（アプリの秘密情報が見える環境では動かさない）。
- 作るデータベース名は必ず `e2e_` + 英数字（`^e2e_[a-z0-9_]{4,40}$`）。終了時に削除します（失敗時も）。
- 試験が使う鍵・トークンは、すべて試験専用のダミー値（`tests/fixtures/server_env.js`）。リポジトリに接続文字列・鍵・パスワードの実値を置かない（`tests/pg_env_guard.test.js` が検査）。
- 接続のパスワードが要る環境では、`PGPASSWORD` を**実行環境の変数**で渡す（ファイル・ログには残さない）。

## 3. 起動手順（再現できる形）

### A. ローカル（PostgreSQL 17 のバイナリがある場合）
```bash
# PostgreSQL 17 のサーバー（initdb・pg_ctl・postgres）と psql の場所を指定（PATH にあれば不要）
export E2E_PG_SERVER_BIN=/usr/lib/postgresql/17/bin     # 例
export E2E_PG_PSQL=psql
npm run test:pg          # = tests/pg/run_all.sh。使い捨てのサーバーを起動 → 試験 → 停止（データは /tmp/e2e-pg に作って消す）
```
root で実行する場合は、`postgres` ユーザーで initdb／起動します（PostgreSQL は root で動かせないため、`postgres` ユーザーが必要）。
共有ライブラリの場所が要る環境は `E2E_PG_LD_LIBRARY_PATH` を指定します。

### B. コンテナ（PG17 のバイナリが無い場合）
```bash
docker run --rm -d --name e2e-pg -p 127.0.0.1:55440:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
E2E_PG_EXTERNAL=1 E2E_PG_HOST=127.0.0.1 E2E_PG_PORT=55440 E2E_PG_USER=postgres npm run test:pg
docker rm -f e2e-pg
```
（ローカルホストに限定した公開。trust 認証は使い捨てのコンテナだけで使う）

注意：PostgreSQL のロールはクラスター全体で共有されるため、`db_setup.js` は重複エラーを受け流して先にロールを作ります（試験ファイルが並行しても競合しない。8 回連続・並行 5 回で確認済み）。`run_all.sh` は念のため試験ファイルを直列（`--test-concurrency=1`）で実行します。

### C. 個別に実行
```bash
tests/pg/local_pg.sh start && eval "$(tests/pg/local_pg.sh env)"
node --test tests/pg/legacy_handoff.pg.test.js
tests/pg/local_pg.sh stop
```

## 4. 構成

| ファイル | 内容 |
|---|---|
| `tests/pg/pg_env.js` | 接続設定と安全装置、psql の呼び出し |
| `tests/pg/db_setup.js` | 使い捨てDBの作成。`createProdLikeDb()`＝baseline 0001〜0007＋prod_01〜03（本番専用 migration）＋complete_17／`createPreviewLikeDb({upTo})`＝baseline 0001〜0008＋Preview migration を番号順（`upTo` まで）。合成データ `docs/sql/production/local_check/synthetic_data.sql` を入れる。本番の「購入の集計指紋」2行だけ合成データ用の値に差し替える（`mkcopies.sh` と同じ規則） |
| `tests/pg/postgrest_mock.js` | サーバー側が使う Supabase の REST／Auth の最小の模型（実PG17の上）。GET（select・filter・order・limit・埋め込み 2 種）・rpc・POST 挿入（`on_conflict`＋ignore-duplicates）・`/auth/v1/user`。**未対応の呼び出しは例外**（黙って通さない） |
| `tests/pg/fixtures_legacy_handoff.sql` | 旧版購入権の引き継ぎ試験の合成データ |
| `tests/pg/legacy_handoff.pg.test.js` | 旧版購入権の引き継ぎ（24 項目）：引き継ぎ・マイページでの再閲覧・二重／不正の防止・期限切れ／通信失敗・v2 との分離・新しい旧版購入の記録（実DBの制約を通す） |
| `tests/pg/schema_smoke.pg.test.js` | 使い捨てDBの作成手順そのものの確認（本番相当・Preview 相当が最後まで適用できる） |
| `tests/pg/local_pg.sh`・`run_all.sh` | 使い捨てサーバーの起動／停止、まとめて実行 |

模型（`postgrest_mock.js`）と実DBの境界：**ハンドラー（`api/*`）・SQL（関数・制約・トリガー）は本物**。Supabase の PostgREST／Auth／Stripe だけが模型です。
実機でしか確かめられないもの（実際の Supabase Auth の JWT、PostgREST の細かい挙動、ブラウザでの Google／X ログイン、実際の決済）はこの基盤の対象外です。

## 5. CI への組み込み案

`docs/ci/github-actions.example.yml`（**例。有効化していない**）。要点：
- ジョブ1「模型の試験」：`npm ci` → `npx playwright install --with-deps chromium` → `npm test`（PG 不要）。
- ジョブ2「実PG17の試験」：`services: postgres:17`（使い捨て・trust 認証）→ `E2E_PG_EXTERNAL=1 E2E_PG_HOST=localhost …` → `npm run test:pg`。
  - 対象のパスが変わった時だけ実行（`api/**`・`lib/**`・`docs/sql/**`・`tests/pg/**`・`index.html`・`report.html`）にして時間を節約。
  - ジョブの環境に Supabase／Stripe の鍵を**渡さない**（渡すと安全装置が止める）。リポジトリの Secrets は不要。
- 必須チェックにする順序案：まず模型の試験を必須、実PG17の試験は 2 週間の様子見のあとに必須へ。
- 所要時間の目安：実PG17の試験は約 10 秒（DB 作成を含む）。

## 6. 既存の DB 依存試験（以前はスキップ 79 件）

`tests/pg/backend.js` を作り、**既存の DB 依存試験を実PG17で実行できるようにしました**（2026-10-30）。

```bash
E2E_PG=1 COMPLETE_DB_BACKEND=$PWD/tests/pg/backend.js node --test --test-concurrency=1 tests/link_purchase_api.test.js
# 本番の構成（Stripe Live・本番専用 migration の構造）で流す時は COMPLETE_DB_STRIPE_MODE=live を付ける
```
`npm run test:pg` は、これらをまとめて実行します（Preview 相当＝Stripe Test と、本番相当＝Live の両方）。

| 区分 | 件数 | 状況 |
|---|---:|---|
| `link_purchase_api`（購入の経路・固有リンク・マイページへの登録） | 14 | 実PG17で合格 |
| `complete_guest_api` | 11 | 合格 |
| `complete_report_job` | 22 | 合格 |
| `no_upgrade_price_env` | 5 | 合格 |
| `purchase_integrity_api`（購入の整合・返金・異議申し立て・ロックの順序ほか） | 45 | 合格（ロック待ちを含む同時実行の試験は、`db.session()` の非同期接続で実行） |
| `consent_pairs_db`（complete_16 の同意の組） | 1 | 合格（`PGT_HOST`＋`PQ`） |
| `@vercel/og` | 1 | `npm ci` すれば実行される |
| `PDF_LIBS_DIR` | 2 | 別件（PDF ライブラリの配置） |

バックエンドの仕組み：
- 画面の裏のサーバー（`api/*`）の呼び出しは、`service_role`（Supabase のサービスキーが使うロール）として実行します。権限の無い操作（例：運営者用の関数を API から実行する）は、本番と同じく失敗します。
- 試験が直接使う `db.sql()` は、管理者（postgres）として実行します。
- ロック待ちが他の接続の処理を止めないよう、サーバー側の呼び出しは非同期の psql で実行します（`pg_env.sqlAsync`）。

残る課題：
- `@vercel/og`・PDF の 3 件は DB と無関係（依存の導入）。
- 実際の Supabase の PostgREST／Auth との差（細かい構文、JWT の検証）は、この基盤の対象外。

## 7. 本番との関係

- この基盤は本番DBに**一切接続しません**。本番の構造は、リポジトリの migration（`docs/sql/production/*`・`docs/sql/2026*.sql`）を、使い捨てDBに適用して再現します。
- 本番の確認（読み取りだけ）は別の手順です（`docs/sql/complete_17_readonly_check.sql` など）。
