# 本番DB migration 適用手順書（akivoob・prod_01〜03・04a・04b）

> **この手順書だけでは実行しない。** 各段階は、運営者の承認を得てから実行する。
> 本番への適用・Production deploy・main への merge・環境変数／Auth／Stripe の変更は、それぞれ別に承認を得る。

## 0. 前提と守ること（S0：旧購入者の保護）

- 対象：本番 Supabase（element-diagnosis-test）。PostgreSQL 17.6。既存の public 6表・旧購入9行が正本。
- 変えないもの：
  - `purchase_entitlements` の既存9行（`cs_live_` 1行・`cs_test_` 8行）と、その列・制約・状態・`diagnosis_code_hash`
  - 既存6表の既存列の意味・既存行
  - 主要3関数（`handle_new_user`・`save_diagnosis_session`・`save_diagnosis_session_v2`）、既存 RLS・policy・権限
  - `REPORT_TOKEN_SECRET`、旧トークンの検証・復号、`legacy_floor`、`/api/report-data`、`/api/verify`、v1 レポートの描画
- 旧購入を新しい表（`report_deliveries` など）へ移さない・一括登録しない。`complete_legacy_bindings` も空のまま。
- anon 権限の縮小・`handle_new_user` の権限変更は含めない（別工程）。
- 法務ページの【公開日】は、Production deploy の日が決まってから別に変える。同意版 `2026-10-21` は確定版のまま。

## 1. ファイル

`docs/sql/production/`（生成元：`build_production_sql.py`。手で編集しない。`python3 build_production_sql.py --check` で生成結果と一致すること）

| ファイル | 種類 | 内容 |
|---|---|---|
| `prod_00_preflight_READONLY.sql` | 読み取り | 適用前の確認（本番であること・既存構造・旧購入の基準値）。最後に `preflight: OK（NG 0 件）` |
| `prod_01_registration_compat.sql` | 適用 | 登録・同意・既存利用者の互換層（既存3人は legacy_exempt）。本番専用の台帳 `element_release.migration_ledger` |
| `prod_02_orders_reports_links.sql` | 適用 | 注文・権利・レポート・固有リンク・登録・管理の表と関数（Live 限定） |
| `prod_03_reissue_and_constraints.sql` | 適用 | 再発行の修正・本番制約の総点検 |
| `prod_04a_onboarding_required_state.sql` | 適用 | 新規登録の初期状態を `required` にするだけ（保存の拒否はまだしない）。旧画面からの保存は続く |
| `prod_04b_onboarding_enforcement.sql` | 適用 | 登録完了前（required）の診断保存を DB で拒否（**新コードの deploy と同意の記録を確認した後**） |
| `prod_80_invariants_READONLY.sql` | 読み取り | S0 の不変項目（件数・ハッシュ）。適用前と各段階の後で**完全に一致**すること（`info.` の行は比較しない） |
| `prod_81_postcheck_READONLY.sql` | 読み取り | 段階ごとの状態（台帳・Live 限定・同意版・登録の既定値・新しい表の件数・API ロールの権限） |
| `prod_9[1-5]_rollback_*_DRAFT_DO_NOT_RUN.sql` | 戻し草案（95＝04b・94＝04a・93〜91＝03〜01） | `docs/PRODUCTION_MIGRATION_ROLLBACK_RUNBOOK.md` を参照 |

SHA-256 は `docs/sql/production/SHA256SUMS`。SQL Editor へ貼る前に、手元のファイルと一致することを確かめる。

## 2. 適用の順序（旧画面と新画面の切り替え中も保存を止めない）

| 順 | 作業 | 確認 | 承認 |
|---|---|---|---|
| 1 | `prod_00_preflight_READONLY` | `preflight: OK（NG 0 件）` | 適用の承認 |
| 2 | `prod_01_registration_compat` | §4 の確認 | |
| 3 | `prod_02_orders_reports_links` | §4 の確認 | |
| 4 | `prod_03_reissue_and_constraints` | §4 の確認 | |
| 5 | 各確認 SQL | `prod_80`（適用前と完全一致）・`prod_81` | |
| 6 | `prod_04a_onboarding_required_state` | `prod_81`：`onboarding.default = 'required'`・`onboarding.require_trigger = 0` | |
| 7 | 旧 Production（現在のコード）で、新規登録→診断の保存ができること | 新規登録は required・保存できる・同意は記録されない | |
| 8 | 新コードを**販売停止のまま** Production へ deploy／Promote | — | deploy の承認 |
| 9 | 新規登録で同意画面が出て、2026-10-21／2026-10-21／2026-10-07-v1 が記録されること | `prod_81`：`profiles.by_status` に completed | |
| 10 | `prod_04b_onboarding_enforcement` | `prod_81`：`onboarding.require_trigger = 1` | 04b の承認 |
| 11 | 登録未完了では保存できず、登録完了後は保存できること | 既存利用者（legacy_exempt）も保存できる | |

- 1〜6 の後も、旧 main（現在の Production）はそのまま動く（保存・旧購入・旧レポート閲覧・新規登録。§7）。
- 6〜10 の間（04a の後・04b の前）は、保存を拒否しない。deploy が遅れても旧画面で保存でき、新画面は同意を記録できる。
  - 旧画面で 04a の後に登録した人は required のまま保存できる。新コードへ切り替わった後、次の表示で同意画面へ進む。
  - 04a の前に登録した人（既存3人・01〜03 の間の登録）は legacy_exempt のまま。一括で required にしない。既存の同意・お知らせメールの値は変えない。
- 04b が失敗しても（1つの transaction）、04a までの状態のままサービスを続けられる。原因を直してから 04b をやり直す。
- 段階の間に旧 Payment Link で正規の Live 購入が入っても、2段階目以降は止まらない（固定の締め切り（2026-10-06 00:00Z）より前の基準9件だけを照合し、後から入った行は「Live・active・core1 ¥1,000」であることだけを確かめる）。

## 3. 事前：バックアップと、そのバックアップでの試験（運営者の手元 PC）

1. `operator_backup_kit/01_backup.sh`（読み取り専用・暗号化バックアップ）→ `02_restore_check.sh`（復元と比較）が合格すること。
2. `operator_backup_kit/03_migration_check.sh <バックアップのフォルダ> <リポジトリ>/docs/sql/production` を実行し、
   `TOTAL pass=35 fail=0` であること。最初の `PASS preflight（実データで基準値と一致）` は、SQL に入っている基準値（購入の集計指紋など）が**実データと一致する**ことの確認でもある。
   - 表示される migration ファイルの SHA-256 が `SHA256SUMS` と一致すること。
3. 旧レポート URL（2026-10-06 以前に発行したもの）が開けることを確認しておく（適用後の比較用）。

## 4. 適用（SQL Editor・本番）

各ファイルは **ファイル全体を1回** 貼って実行する（途中だけを選んで実行しない）。各ファイルは1つのトランザクションで、冒頭の確認で違えば何も変えずに止まる。

1. `prod_00_preflight_READONLY.sql` → 結果の最後が `preflight: OK（NG 0 件）`。NG があれば中止。
2. `prod_80_invariants_READONLY.sql` → 結果（k・v の表）を「適用前」として控える（件数・ハッシュだけ。個人情報なし）。
3. `prod_01_registration_compat.sql` → 成功（エラーなし）。
   - `prod_81_postcheck_READONLY.sql`：`ledger.stages = {1}`、`onboarding.default = 'legacy_exempt'`、`profiles.by_status = legacy_exempt=3`、`consent.accepts_2026_10_21_only = true`
   - `prod_80`：適用前と**完全一致**（`info.` の行を除く）
4. `prod_02_orders_reports_links.sql` → 成功。
   - `prod_81`：`ledger.stages = {1,2}`、`live.* = 1`、`live.functions_assume_test = 0`、`preview.* = 0／true`、`new_tables.rows` が全て 0、`api.* = 0`
   - `prod_80`：適用前と完全一致
5. `prod_03_reissue_and_constraints.sql` → 成功。`prod_81`：`ledger.stages = {1,2,3}`。`prod_80`：完全一致。

止まった時（`ERROR` が出た時）：
- 何も変わっていない（トランザクション全体が戻る）。エラー文（英語の1行。個人情報なし）を控え、次へ進まない。
- `stage_already_applied`：その段階は適用済み。二度目は何もしない。
- `purchase_entitlements baseline is not 9 rows` など基準の不一致：DB が想定と違う。適用せず、棚卸しからやり直す。

## 5. 04a → deploy → 04b

1. `prod_04a_onboarding_required_state.sql` → 成功。`prod_81`：`ledger.stages = {1,2,3,4}`、`onboarding.default = 'required'`、`onboarding.require_trigger = 0（prod_04b 以降 1）`。`prod_80`：完全一致。
2. 旧 Production で新規登録→保存ができることを確かめる（試験用のアカウント。個人情報を報告に載せない）。
3. 新コードを販売停止（`COMPLETE_SALES_OPEN` は閉じたまま）で Production へ deploy／Promote（別承認）。
4. 新規登録で同意画面が出て、登録完了後に保存できることを確かめる（`prod_81` の `profiles.by_status` に completed が増える）。
5. `prod_04b_onboarding_enforcement.sql` → 成功。`prod_81`：`ledger.stages = {1,2,3,4,5}`、`onboarding.require_trigger = 1`。`prod_80`：完全一致。
6. 登録未完了（required）のアカウントでは保存できず、登録完了後は保存できることを確かめる。

## 6. 適用後の確認

- 旧レポート URL（2026-10-06 以前の発行分）が開ける（運営者が確認。URL・トークンは共有しない）。
- `prod_80` が適用前と一致（`info.pe.after_cut` は後から入った購入の件数。比較しない）。
- 新規登録（Google・X・メール OTP）で登録完了の画面が出て、同意 2026-10-21 で登録できる。
- 新しい購入（A ¥1,000・B ¥3,000）・固有リンク・マイページ登録（販売開始の判断は別）。

## 7. 旧コード（現在の Production）との両立（ローカルで確認済み）

| 段階の後 | 旧 main の保存 | 新規登録→保存（旧画面） | 旧 /api/verify の記録 | 旧 /api/report-data | 同意列の直接書き換え |
|---|---|---|---|---|---|
| prod_01〜03 | 可 | 可（legacy_exempt） | 可 | 可 | 拒否（旧 main は使っていない） |
| prod_04a | 可 | 可（required。同意は新コードで） | 可 | 可 | 拒否 |
| prod_04b | 可（既存利用者） | 不可（新コードの同意画面で登録完了してから） | 可 | 可 | 拒否 |

## 8. 検証の記録（2026-10-21・ローカル）

- 本番相当の PG17（baseline_archive 0001〜0007＋本番の既定権限＋合成データ）。構造の指紋（列57・関数3・policy 8・制約19・索引13・権限126・主要3関数・auth トリガー）が本番の基準値と一致。
- `docs/sql/production/local_check/run_all.sh`：適用・二度適用・rollback・再適用（36項目）、停止条件（15項目：Preview・PG16・件数・金額・指紋・関数・列・policy・権限・部分適用・順序・途中失敗・段階の間の購入）、
  切り替え中の状態（36項目：01〜03 後・04a 後 deploy 前・04a 後の新コード・04b 後・障害時・04a／04b の rollback）、旧 main の DB 操作（全段階）が合格。
- アプリ試験：DB を使う試験を本番の構成（Production・Stripe Live・prod_01〜04b の DB）でも実行し全件合格（`COMPLETE_DB_STRIPE_MODE=live`）。
- Preview の最終状態との構造の差は、意図したもの（Live 限定の制約・注文の記録・Webhook の照合・Preview 専用の関数と制約が無いこと）だけ。
