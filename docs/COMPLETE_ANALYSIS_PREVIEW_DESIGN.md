# 完全解析（46ページ）・メール配信同意 — Preview 実装メモ

状態：Preview 限定の実装と設計案。本番DB・本番Stripe・本番Kit には接続していない。

## 1. 商品と権利（仮ID・正式確定前）

| 商品 | 仮 product_type | 価格 | 同じ記録に成立する権利 |
|---|---|---:|---|
| 完全解析（直接購入） | `core_complete_analysis` | ¥3,000 | `core_analysis_access` + `core_complete_access` |
| 完全解析（解析購入者の追加） | `core_complete_analysis_upgrade` | ¥2,000 | `core_analysis_access` + `core_complete_access` |
| 既存 COMPLETE（CORE1＋CORE2 セット） | `complete` | ¥2,500 | `core_analysis_access` + `journey_report_access`（**変更しない**） |

- 新しい完全解析の権利は、診断記録（`diagnosis_session_id`）単位で持つ。既存の `purchase_entitlements`（診断コードのハッシュ単位）とは別テーブルの案（`docs/sql/complete_consent_01_migration_DRAFT_DO_NOT_RUN.sql`）。
- 既存の `complete` の意味・価格・権限・処理は、`api/verify.js`・`api/report-data.js`・`api/my-entitlements.js`・`api/my-report-link.js` のいずれでも変更していない。

## 2. 表示用状態（`complete-analysis.js`）

```js
{ entitlementStatus: 'ok' | 'unknown', analysisAccess, completeAccess,
  completeStatus: 'none' | 'purchased' | 'generating' | 'ready' | 'failed',
  diagnosisSessionId, completeReportUrl }
```

- `analysisAccess = core_analysis_access || core_complete_access`、`completeAccess = core_complete_access`。
- **完全解析の権利APIはまだ無い**（`CA_COMPLETE_API_READY = false`）。その間、実データの状態は常に `unknown` とし、free と推測しない。`unknown` では購入CTAを出さない。
- `?preview_entitlement=free|analysis|complete-generating|complete-ready|unknown` は Preview でのみ有効。次の3つのガードがすべて通るときだけ有効になる。
  1. `CA_PREVIEW_BUILD === true`（本番ビルドで false にする）
  2. ページの `IS_PREVIEW_BUILD` が false でない
  3. ホスト名が本番（`element-diagnosis-five.vercel.app`）でない
- `?preview_past=<状態>`（Preview 専用の補助）：mypage で新しい順の2件目の記録だけを別状態にする。記録別に権利が分かれることの確認用。
- Preview の状態は表示の確認用であり、購入権を発行しない。mypage の「解析レポートを読む」は従来どおりサーバー（`/api/my-report-link`）が権利を確認する。

## 3. ダミー決済リンク（PREVIEW ONLY）

- 既存の Preview 用 CORE1 テスト Payment Link を使い、`data-preview-dummy="true"` と `PREVIEW ONLY` コメントを付けた。
- `client_reference_id` は付けていない。付けると `/api/verify.js` がテスト決済を CORE1（¥1,000）の権利として記録してしまうため。対象記録は画面の表示と `data-diagnosis-session-id` で示す。
- 本実装では、サーバーが本人所有の記録を確認してから `diagnosis_session_id` を持つ Checkout Session を作る。

## 4. メール配信（Kit）

- 結果画面のチェックは初期OFF。未チェックでも保存・ログイン・マイページは成功する。
- 選択は `pendingNewsletterConsent_v1`（localStorage・24時間）に一時保持し、OAuth の往復後も残る。
- 順序：認証 → 診断保存 → 同意記録 → Kit同期（`processPendingNewsletterConsent()`）。
- 同意記録は `update(...).select(...)` で書き戻した値を確かめる。記録できない・型が違う・列が無い場合は Kit へ送らない（fail-closed）。
- 一時保持は、DB記録と（同意 true の場合は）Kit 同期が成功するまで消さない。Kit が失敗した場合は保持を残し、次回の読み込みで再試行する（DB が既に true で保持も true なら再試行として扱う）。
- 判断済み（true/false）なら上書きせず、Kit も呼ばない。
- `/api/subscribe` はトークンを検証し、本人のメールをサーバーで取得し、DB の `newsletter_opted_in === true` と同意版を確認してから送る。body のメールは使わない。配信停止済み（active 以外）は再登録しない。
- Preview（`VERCEL_ENV !== 'production'`）では `KIT_PREVIEW_ALLOWED_EMAILS` に書いたテスト用メールだけを送る。テストは偽の fetch（`createHandler`）だけで行う。

## 5. 未確定事項（本番接続前に必要）

1. `profiles.newsletter_opted_in` の実際の型・既定値・RLS（`complete_consent_00_preflight_READONLY.sql` の C1〜C5）。
2. `newsletter_consent_source` / `newsletter_consent_version` 列の追加（未適用。適用前は同意を記録できないため、Kit 同期は fail-closed で行われない）。
3. 完全解析の権利テーブル・権利API（`/api/my-entitlements` の記録単位拡張、`/api/my-complete-report-link`）・生成処理・保存先。
4. 新商品の正式な Price ID と、`verify.js` での対応付け（`diagnosis_session_id` を参照値にする方式）。
5. `report-data.js` で完全解析購入者に同じ記録の解析レポート権を返す処理（記録→診断コードの対応）。
6. Kit の配信停止状態の照会（`GET /v4/subscribers?email_address=…&status=all`）の応答形を、Kit 検証用環境で確認すること。
7. 本番化時に `CA_PREVIEW_BUILD = false`、ダミー決済リンクの差し替え、GA4 の復元。
8. Kit障害が24時間以上続いた場合、localStorageの保留が期限切れとなり自動再試行されないため、本番ではDBのnewsletter_sync_statusを使った永続的な再試行が必要（`newsletter_sync_status` / `newsletter_synced_at` / `newsletter_sync_error_code` を記録し、サーバー側で failed の行を再同期する）。
