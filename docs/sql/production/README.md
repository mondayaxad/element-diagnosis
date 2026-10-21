# 本番（akivoob）専用 migration

Preview 用の migration（`docs/sql/2026*.sql`）は本番では使わない。本番は既存の public 6表・旧購入9行を正本として、このフォルダの段階的な migration で「追加」する。

- 手順：`docs/PRODUCTION_MIGRATION_APPLY_RUNBOOK.md`（適用）・`docs/PRODUCTION_MIGRATION_ROLLBACK_RUNBOOK.md`（戻し）
- 生成：`python3 build_production_sql.py`（Preview migration から機械的に組み立て。置き換えは件数を数えて確認）。
  `python3 build_production_sql.py --check` で、コミット済みのファイルが生成結果と一致することを確かめる。手で編集しない。
- 改ざん・取り違えの確認：`sha256sum -c SHA256SUMS`

## 段階

| 段階 | ファイル | 内容 |
|---|---|---|
| 確認 | `prod_00_preflight_READONLY.sql` | 本番であること・既存構造・旧購入の基準値（読み取りのみ） |
| 1 | `prod_01_registration_compat.sql` | 登録・同意・既存利用者の互換層。既存3人は legacy_exempt。台帳 `element_release.migration_ledger` |
| 2 | `prod_02_orders_reports_links.sql` | Preview complete_01〜13 の本体（Live 限定へ置き換え）。注文・権利・レポート・固有リンク・登録・管理 |
| 3 | `prod_03_reissue_and_constraints.sql` | Preview complete_14（再発行）＋本番制約の総点検 |
| 4 | `prod_04_onboarding_required.sql` | 登録完了の必須化（Production deploy の直前） |
| 不変 | `prod_80_invariants_READONLY.sql` | S0 の不変項目（適用前と完全一致すること） |
| 状態 | `prod_81_postcheck_READONLY.sql` | 段階ごとの状態 |
| 戻し | `prod_91〜94_rollback_*_DRAFT_DO_NOT_RUN.sql` | 草案。本番では実行しない |

## 設計の要点

- **本番の判定**：PostgreSQL 17 以上・`deployment_environment()` が無い・Preview 専用制約が無い・既存6表と主要3関数／auth トリガー／既存の列・policy・制約・索引・権限がバックアップ時の指紋と一致・旧購入が 9件（live 1件 ¥1,000・test 8件 ¥8,000・全て active・集計指紋一致）。違えば全体を止める。
- **migration 台帳**：Supabase CLI の `supabase_migrations` は作らない（本番には無い。名前だけ似た不完全な表を作ると、将来 CLI が作る正式な台帳と衝突する）。
  本番専用の `element_release.migration_ledger`（anon・authenticated・service_role から見えない別スキーマ）に段階の番号だけを記録し、
  加えて各段階の冒頭でオブジェクトの有無も検査する（台帳と実体の両方で冪等性を担保）。二度目の実行は `stage_already_applied` で止まる。
- **Stripe**：新しい `complete_orders`・`stripe_webhook_events` は Live だけ（`stripe_mode = 'live'`・`livemode = true`・Session ID は `cs_live_`）。
  Preview 専用の制約（`*_preview_test_*`）は作らない。Test の Price ID・Webhook 値は SQL に含まない。
  `purchase_entitlements` には制約を足さない（`cs_test_` の8行があるため）。
- **既存表への変更**：`profiles` に列（登録完了・同意・お知らせメール同期）と制約・同意列の保護トリガー。既存行は列の既定値で legacy_exempt（UPDATE 文は使わない）。
  `diagnosis_sessions` は user_id の NOT NULL を外す（ゲスト記録用。既存8行は値を持つまま）・`guest_created_at`・所有者かゲストかの制約・所有者固定トリガー、prod_04 で登録完了前の保存を拒否するトリガー。
  他の4表（`diagnosis_answers`・`diagnosis_results`・`report_snapshots`・`purchase_entitlements`）には何もしない。
- **段階の間の購入**：旧 Payment Link で正規の Live 購入が入っても、2段階目以降は prod_01 の時刻より前の9件を基準に照合し、後から入った行は「Live・active・core1 ¥1,000」であることだけを確かめる。

## ローカル検証

`local_check/run_all.sh`（root で実行。PostgreSQL 17 と 16 の場所は `local_check/env.sh`）：本番相当の PG17（合成データ）で、構造の指紋の一致・適用・二度適用・rollback・再適用・停止条件・旧 main の DB 操作を確かめる。
試験は本番の購入の指紋2行だけを合成データ用の値へ差し替えたコピー（`/tmp/prodsim/sql`）で行う（`local_check/mkcopies.sh`）。

アプリ試験（本番の構成）：

```bash
# prod_01〜04 を当てた DB をテンプレートにし（合成の既存データは空にする）、DB を使う試験を Live で実行
COMPLETE_DB_STRIPE_MODE=live PGT_TEMPLATE=<テンプレート> COMPLETE_DB_BACKEND=<pg バックエンド> node --test tests/link_purchase_api.test.js tests/purchase_integrity_api.test.js tests/complete_guest_api.test.js
```
