# 実PG17の試験（tests/pg）

サーバー側の処理（`api/*`・`lib/*`）を、**本物の PostgreSQL 17 に本番相当の構造を作って**通す試験の基盤です。
合成データだけを使い、本番・Preview の Supabase には接続しません。

## 1. 試験の種類（混ぜない）

| 種類 | 置き場所 | DB | 実行 | 目的 |
|---|---|---|---|---|
| 模型の試験 | `tests/*.test.js` | メモリ上の模型（`tests/fixtures/fake_supabase.js`・各試験の偽物） | `npm test` | 画面・処理の分岐の確認。PG は不要で速い |
| **実PG17の試験** | `tests/pg/*.pg.test.js` | 使い捨ての PostgreSQL 17（`e2e_*`）。本番相当の構造・制約・トリガー・権限 | `npm run test:pg` | 制約・トリガー・関数・権限を含む、実DBでの確認 |
| 既存のDB依存試験（現在スキップ） | `tests/complete_*`・`link_purchase_api`・`purchase_integrity_api` ほか | `COMPLETE_DB_BACKEND` が必要 | 未整備（§6の計画） | 75 件（§6） |

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

## 6. 既存の DB 依存試験（スキップ 79 件）を実行可能にする計画

内訳（2026-10-29 時点）：

| 区分 | 件数 | 前提 | 状況 |
|---|---:|---|---|
| `COMPLETE_DB_BACKEND`（complete_01〜07） | 10 | `complete_guest_api.test.js` | 未 |
| 〃（complete_01〜08） | 47 | `purchase_integrity_api`（44）・`link_purchase_api` の一部ほか | 未 |
| 〃（complete_01〜13） | 18 | `link_purchase_api`・`purchase_integrity_api` の一部ほか | 未 |
| `PGT_HOST`＋`PQ`（complete_16 の同意の組） | 1 | `consent_pairs_db.test.js` | **実行可能になった**（`npm run test:pg` に含む。10 項目合格） |
| `@vercel/og` | 1 | npm の依存の導入 | CI で `npm ci` すれば実行される |
| `PDF_LIBS_DIR` | 2 | PDF 生成ライブラリの場所 | 別件（PDF ライブラリの配置） |

`COMPLETE_DB_BACKEND` の 75 件を動かす段階：

1. **構造（完了）**：`createPreviewLikeDb({upTo: 7 | 8 | 13 | 99})` で、試験が前提にする構造を再現できることを確認済み（`schema_smoke.pg.test.js`）。
2. **バックエンド本体 `tests/pg/backend.js`（未）**：メモリの模型（`fake_supabase.js`）と同じ口 `{ kind, fetchImpl, calls, failNext(key), user({id,email,confirmed,onboarding,token,provider}), record({…}), legacy({code,stripeSessionId}), rows(table), patch(table,id,values), sql(query,params), close() }` を、実PG17の上で提供する。
   - `user()`＝`auth.users`＋プロフィール＋`auth.identities`、`record()`＝診断記録の挿入、`legacy()`＝旧購入の挿入、`rows()`・`patch()`・`sql()` は直接 SQL。
3. **模型の拡張（未）**：`postgrest_mock.js` に、PATCH、`merge-duplicates` の upsert、`Prefer: return=representation`、`/auth/v1/user` の拡張項目（`email`・`email_confirmed_at`・`identities`）、`or=`・範囲指定の filter、`failNext`／`calls` の記録を足す。サーバー側の呼び出しは `rpc` が中心（44 件）で、select は `lib/purchase-state.js` ほかの少数の形に限られる。
4. **段階的に有効化**：`COMPLETE_DB_BACKEND=tests/pg/backend.js` で、complete_01〜07（10 件）→ 01〜08（47 件）→ 01〜13（18 件）の順に 1 ファイルずつ有効化し、模型の挙動と実DBの挙動の差（試験側が模型の癖に依存している箇所）を直す。
5. **完了の条件**：75 件がすべて「スキップなし」で合格し、CI のジョブ2に含める。

リスク：試験の一部がメモリ模型の癖（採番・時刻・並び順）を前提にしている可能性。差が出た箇所は、実DBの挙動が正であれば試験側を直す（模型を実DBに合わせる）。

## 7. 本番との関係

- この基盤は本番DBに**一切接続しません**。本番の構造は、リポジトリの migration（`docs/sql/production/*`・`docs/sql/2026*.sql`）を、使い捨てDBに適用して再現します。
- 本番の確認（読み取りだけ）は別の手順です（`docs/sql/complete_17_readonly_check.sql` など）。
