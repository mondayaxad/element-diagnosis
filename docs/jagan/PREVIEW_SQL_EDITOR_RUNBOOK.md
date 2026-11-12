# 邪眼診断 jagan_01：Preview の SQL Editor で適用する手順

対象は **Preview（element-diagnosis-preview）だけ**です。本番では実行しません。
各 SQL は、Supabase の SQL Editor に**ファイルの全文**を貼り付け、1回ずつ実行します。

| 順番 | ファイル | 何をするか | 変更の有無 |
|---|---|---|---|
| 1 | `docs/sql/jagan_00_preflight_READONLY.sql` | 環境・3テーブル・migration 履歴・前提を確認 | なし（`begin read only` … `rollback`） |
| 2 | `docs/sql/20261102120000_jagan_01_results_shares.sql` | 3テーブル・権限・RLS を作り、履歴へ 1 行を記録 | あり（1つのトランザクション） |
| 3 | `docs/sql/jagan_02_postcheck_READONLY.sql` | テーブル・制約・インデックス・RLS・ポリシー・権限・適用記録を確認 | なし |

## 1. 適用前の確認（jagan_00）

- 結果の `v` と `expect` が一致することを確かめます。`expect` が「（参考…）」の行は値の記録だけです。
- 次のどれかに当たったら、**2 に進まず**結果をそのまま共有してください。
  - `01 environment` が `preview` でない。
  - `04`〜`06` のどれかで、テーブルがすでにある。
  - `07` か `08` が 0 でない。
  - `09` が 0 でない（この版がすでに記録されている）。
- 実行前に、画面左上のプロジェクト名が **element-diagnosis-preview** であることも確かめてください。
  - リポジトリの文書では Preview の Ref の書き方が揃っていません（`docs/email-templates/README.md` と `docs/sql/save_dedup_00_preflight_READONLY.sql`）。そのため Ref ではなく、DB 内の `deployment_environment()` = `preview` を正の判定にしています。
  - 2 の SQL も、最初に同じ判定をします。

## 2. 適用（jagan_01）

- 最初に次を確かめ、どれかに当たれば**何も変更せず**エラーで止まります。
  - Preview であること（でなければ `not a preview database`）。
  - `jagan_*` のテーブルが1つも無いこと（あれば `jagan objects already exist`）。
  - 版 `20261102120000` が未記録であること（記録済みなら `migration … is already recorded`）。
- `create table if not exists`・`drop`・`on conflict` は使いません。既存のテーブルを上書き・削除することはありません。
- 全体が `begin` … `commit` の1つのトランザクションです。途中で失敗すれば、途中まで作られた状態は残りません。
- 最後の確認で、権限か RLS が期待どおりでなければ例外になります。その場合も全体が取り消されます。
- 成功すると「Success. No rows returned」と表示されます。

## 3. 適用後の確認（jagan_02）

- すべての行で `ok` = `true` であることを確かめます。false の行があれば、その行の `v` と `expect` を共有してください。
- 確認する内容：
  - 列数
  - 制約：主キー、外部キーと削除時の動き（`c`=cascade、`r`=restrict）、一意、CHECK
  - インデックス
  - RLS の有効化
  - ポリシー 3 件
  - 表 × ロール（anon・authenticated・service_role）× 7 種類の権限。PUBLIC 経由の権限も含みます。
  - 履歴：`20261102120000 jagan_01_results_shares`
  - 行数：直後は 0

## migration 管理との整合

- このリポジトリでは、SQL の正本は `docs/sql/<版>_<名前>.sql` です（`supabase/migrations` は使っていません）。
- 適用の記録は、既存の `docs/sql` の適用と同じく `supabase_migrations.schema_migrations` に `version`・`name` を入れます。
  - これで、SQL Editor で入れても `supabase migration list` で適用済みとして見えます。
  - 同じ版を二度入れることもありません（2 が止まります）。
- 2026-11-05 の確認では、Preview の最新の履歴は `20261021200000` でした。
  - リポジトリには `20261029120000_complete_17_legacy_link_binding.sql` がありますが、この SQL は履歴へ記録しません。そのため履歴に出ないのは想定どおりで、今回の作業の対象外です。
- 戻しの草案は `docs/sql/jagan_99_rollback_01_DRAFT_DO_NOT_RUN.sql` です（実行禁止。保存結果・共有も消えます）。

## 事前の検証（ローカルの使い捨て PostgreSQL）

`tests/pg/jagan_01.pg.test.js` で、上の 1→2→3 の手順を通しています（`E2E_PG=1`）。
- Supabase と同じ既定権限（public の新しいテーブルに、anon・authenticated・service_role へ全権限）を再現しています。そのうえで、権限が取り消されることを確かめています。
- 1 → 2 → 3 で、確認がすべて ok になる。
- 2 を二度実行すると、何も変えずに止まる。
- 既存の `jagan_results`（中身のある行）があると、上書き・削除せずに止まる。行も履歴もそのまま残る。
- Preview 以外では止まる。
- RLS について：
  - 本人は自分の行だけを読める・消せる。
  - 他人の行は読めない・消せない。
  - 共有のテーブルは、authenticated から読めない。
  - anon はどのテーブルも読めない。
  - ブラウザ側のロールからは、購入権限の追加も結果の書き換えもできない。

この環境には PostgreSQL 16 しかないため、検証は 16 で行いました（jagan_01 は 17 固有の機能を使いません）。
