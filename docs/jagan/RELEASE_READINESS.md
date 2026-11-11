# 邪眼診断（DTI）解析レポート ¥1,000・完全解析「DIPPER」¥3,000：本番リリースの準備状況

作成：2026-11-10（同日更新：邪眼だけを切り出した `jagan-release` ブランチ・段階 6 の草案・決済を元素診断と同じ仕組みに）。**本番には何も反映していません**（本番 DB の変更・main へのマージ・本番デプロイ・本番の環境変数・Stripe Live の設定・販売開始は、いずれも未実施）。
本番の状態は、読み取りだけで確かめました。

## 1. Preview で完了していること（`release-c-preview`・bbcefd4）

- 完了ページ（¥1,000 の主導線＋「BEYOND THE RESULT」の ¥3,000）・解析レポート（¥1,000）・完全解析「DIPPER」（¥3,000・23ページ・/jagan/dipper）・マイページ（2商品・INSIGHT／COMPLETE）。
- 購入 API（2商品・金額はサーバーが決める）・Preview DB の jagan_01〜03（2026-11-10 に jagan_03 を適用済み）。
- 検査：全体 714 件合格（不合格は以前からの #727 の1件）。同じ回答での無料・¥1,000・¥3,000 の表示一致（300件）。実PG の jagan_01〜03（16件：期限切れ・未払いで権利なし、決済通知の再処理で増えない、両方で2つの権利）。
- Preview の実画面：完了ページから ¥1,000・¥3,000 の決済画面（Stripe Test）が作られ、注文に同じ50問が入ることを確認。
- Preview でのテスト決済の支払い後：✅ 2026-11-11 確認済み（§8）。

## 2. 本番の現状（読み取りのみ・2026-11-10）

| 項目 | 状態 |
|---|---|
| 邪眼の表（jagan_results・jagan_orders・jagan_entitlements など） | **無い** |
| 本番の migration 台帳 `element_release.migration_ledger` | 段階 1〜5（prod_01〜prod_04b）まで適用済み |
| `profiles.onboarding_status` | あり（邪眼の登録で使う） |
| `deployment_environment()`・`supabase_migrations` | 無い（本番の仕様。Preview 用 SQL は本番では使えない） |
| 本番の環境変数（Vercel Production） | `JAGAN_PRODUCTION_ENABLED`・`JAGAN_SALES_OPEN` は**未設定**（＝邪眼の API は本番では止まっている）。`COMPLETE_VIEW_TOKEN_SECRET`・`COMPLETE_CHECKOUT_ORIGIN`・`STRIPE_MODE`・`STRIPE_COMPLETE_WEBHOOK_SECRET` はあり |
| コード | `main` は `release-c-preview` より 101 コミット前。差分には邪眼以外（共鳴診断・元素診断 Mini・「以前の結果から読む」など）も含まれる |
| 特定商取引法の表記・利用規約・プライバシーポリシー | 邪眼の商品（¥1,000・¥3,000）の記載は**無い** |

## 3. 本番に出すために必要な作業（未実施）

### 3-1. 本番 DB（段階 6 として追加）
- Preview の jagan_01〜03 を、本番の作法（`docs/sql/production/` の `build_production_sql.py`）に合わせた `prod_06_jagan` にする。
  - 本番の判定（`deployment_environment()` が無いこと・台帳が段階 5 まで）・台帳に段階 6 を記録・Stripe は Live だけ（`stripe_mode='live'`・`cs_live_`）。
  - あわせて preflight（読み取り）・postcheck（読み取り）・rollback 草案（実行しない）を作り、`local_check`（本番相当の PG17）で適用・二度適用・停止条件を確かめる。
- 適用はオーナーが SQL Editor で行う（`docs/PRODUCTION_MIGRATION_APPLY_RUNBOOK.md` の手順に段階 6 を足す）。

### 3-2. コード（main への反映）
- 本番で販売を開くには、次の2か所の変更が必要（今は Preview でしか販売中にならない作り）：
  - `api/public-config.js`：`jaganSalesOpen` が `appEnv === 'preview'` のときだけ true。
  - 邪眼のデータ `product.sales_open`（`jagan/engine/data.mjs` の元データ）が false。
- `main` へ出す範囲の決定（§4-1）。

### 3-3. 本番の環境変数（Vercel Production）
| 変数 | 値 | いつ |
|---|---|---|
| `JAGAN_PRODUCTION_ENABLED` | `true` | 本番 DB（段階 6）の適用後。無料の結果保存・共有・閲覧が本番 DB に書けるようになる |
| `JAGAN_SALES_OPEN` | `true` | 販売開始の時だけ |
| `JAGAN_PRICE_ID`・`JAGAN_COMPLETE_PRICE_ID` | Stripe Live の Price ID（任意） | 無ければ決済画面に金額を直接指定（price_data）。Stripe の商品カタログを使う場合だけ |
| `COMPLETE_VIEW_TOKEN_SECRET` | 既存の値 | 邪眼の固有リンクの鍵も、ここから別の用途の鍵を作る（変えると発行済みのリンクが開けなくなる） |

### 3-4. Stripe（Live）
- 本番の Webhook（`/api/stripe-webhook`）に、次のイベントが届くこと：`checkout.session.completed`・`checkout.session.async_payment_succeeded`・`checkout.session.expired`・`charge.refunded`・`charge.dispute.created`・`charge.dispute.closed`。
- 邪眼の注文は metadata `app=element-diagnosis-jagan` で ETI の注文と分けている（ETI の処理は変えない）。

### 3-5. 表記
- 特定商取引法に基づく表記・利用規約に、邪眼解析レポート（¥1,000）・邪眼完全解析「DIPPER」（¥3,000）を追記（販売価格・提供時期・返品の扱い）。

## 4. 決めていただきたいこと

1. **main へ出す範囲**：`release-c-preview` をそのまま出す（邪眼以外の未公開機能も含む）か、邪眼だけを切り出すか。
2. **本番 DB の段階 6 の草案作成**を進めてよいか（作成と手元の検証まで。本番への適用はしない）。
3. **Stripe Live の Price** を使うか（使う場合は Price の作成が必要。使わなければ金額直接指定で動く）。
4. **販売開始の順序**：「無料の結果保存・共有を先に本番で開く → 販売は後日」か、「同時に開く」か。

## 5. Preview でのテスト決済の手順（未確認の項目）

1. Preview で邪眼診断を受け、完了ページで「全てのロックを解除する（¥1,000）」→ テストカード `4242 4242 4242 4242`（期限は未来・CVC 任意）で支払う → 解析レポートが開く。
2. 同じ結果の完了ページで「その先を見る」→「まだ見えていない深淵を読む ¥3,000」→ 支払う → 完全解析（23ページ）が開く。
3. それぞれの最後の「マイページに登録する」→ マイページで、片方だけなら INSIGHT、両方なら COMPLETE。
4. 再読み込み・ログアウトして再ログインの後も、マイページから両方を開ける。
5. 決済画面で「戻る」（キャンセル）した注文には、閲覧権が付かない。
6. Stripe ダッシュボード（Test）で同じイベントを「再送信」しても、マイページの記録・権利が増えない。


---

## 6. 決定事項（2026-11-10 オーナー）と、その対応

| 決定 | 対応（いずれも本番には未反映） |
|---|---|
| 邪眼だけを切り分けて出す | `jagan-release` ブランチ（`main`＝PayPay 対応済みの上に、邪眼の機能だけ）。共鳴診断・Mini・「以前の結果から読む」は含めない |
| 段階 6 の草案 | `docs/sql/production/prod_06_jagan.sql` ほか。本番相当 PG17 で 17 項目合格（`local_check/stage6.sh`）。手順は `docs/PRODUCTION_MIGRATION_APPLY_RUNBOOK.md` §9 |
| Stripe は元素診断と同じ仕組み | Stripe の Price（Live）を照合して使う・支払い方法はカードと PayPay（拒まれたらカードだけ）。本番は Price が必須（未設定なら申込を止める） |
| 同時リリース | 無料の保存・共有と販売を同時に開ける。開ける操作は環境変数（下の手順 5） |

## 7. リリース当日の手順（案・オーナーの承認ごとに実行）

1. **Stripe（Live）**：✅ 2026-11-11 オーナーが作成済み（JPY・一回払い）。
   - 邪眼解析レポート ¥1,000：`price_1UabZ40IX2Svp0V3xTFn7YZF`
   - 邪眼完全解析レポート「DIPPER」¥3,000：`price_1UabbX0IX2Svp0V3QjmrD2A9`
   - 本番の Webhook の6イベント（completed・async_payment_succeeded・expired・refunded・dispute.created・dispute.closed）：✅ オーナーが確認済み。
2. **本番 DB**：`prod_80` を控える → `prod_06_jagan.sql` → `prod_86` と `prod_80` を確認（RUNBOOK §9）。
3. **Vercel Production の環境変数**：`JAGAN_PRICE_ID=price_1UabZ40IX2Svp0V3xTFn7YZF`・`JAGAN_COMPLETE_PRICE_ID=price_1UabbX0IX2Svp0V3QjmrD2A9`✅ 2026-11-11 設定済み（Production のみ・再 deploy はしていない）。今の本番のコード（main）には邪眼の購入の処理が無く、`JAGAN_PRODUCTION_ENABLED` も未設定のため、利用者への影響は無い。
4. **コード**：`jagan-release` を `main` へ（プルリクエスト → マージ → Production の deploy）。
5. **開ける**：`JAGAN_PRODUCTION_ENABLED=true`・`JAGAN_SALES_OPEN=true` を設定して再 deploy（同時に開く）。
6. **確認**：本番で診断 → 完了ページ → ¥1,000／¥3,000 の決済画面が開くこと（実際の支払いはオーナーの判断）。マイページに記録が残ること。

戻すとき：`JAGAN_SALES_OPEN` だけを外すと販売だけが止まる（購入済みのレポートは読める）。`JAGAN_PRODUCTION_ENABLED` も外すと、邪眼の保存・共有・購入済みレポートの閲覧まで止まる（注意）。DB の戻しは、邪眼の表が空の時だけ（`prod_96`）。

## 8. 残っている確認・判断

- 利用規約の改定日：✅ リリース日 2026年11月12日に決定。利用規約・特定商取引法の表記の改定日を 2026年11月12日に（プライバシーポリシーは変更なしのため据え置き）。検査も更新済み。
- Preview でのテスト決済の支払い後（§5）：✅ 2026-11-11 確認済み。¥1,000・¥3,000 を Stripe Test で支払い、解析レポート・完全解析（23ページ）が開く、中止した注文に権利が付かない、DB に金額どおり記録（Claude が実施）。マイページへの登録と INSIGHT／COMPLETE の表示（オーナーが実施）。
- `jagan-release` の全体の検査（2026-11-11）：640 件合格、不合格は以前からの1件（Google・X の認証から戻ったマイページの検査）。

## 9. 戻すための備え（2026-11-11 記録）

| 層 | リリース前に控えるもの | うまくいかない時の戻し方 | 所要 |
|---|---|---|---|
| コード（Vercel） | 今の本番の deploy：`dpl_HseA9E4gxAHVhR6Gy1n7bXizHDFa`（main `eba2768`・PayPay 追加のマージ） | Vercel の Deployments でこの deploy を「Instant Rollback」。旧コードには邪眼の処理が無いので、邪眼だけが止まり元素診断は今と同じに戻る | 1分 |
| 公開・販売（環境変数） | なし | 販売だけ止める：`JAGAN_SALES_OPEN` を外して再 deploy（購入済みのレポートは読める）。邪眼全体を止める：`JAGAN_PRODUCTION_ENABLED` も外す | 数分 |
| 本番 DB | 適用直前に `prod_80`（読み取りの棚卸し）を控える。Supabase の自動バックアップ（Database → Backups）に直近の日次があることを確認 | 段階 6 は邪眼の新しい5表と関数を足すだけで、元素診断の表・行・関数は変えない。戻す必要は通常無い。邪眼の表が空の時だけ `prod_96`（草案）で戻せる。データがある時は戻さず、前へ直す | — |
| Stripe | Price ID（§7） | 価格の変更・停止は Price のアーカイブ。支払い済みは返金で対応（返金の通知で権利も止まる） | 数分 |
| main の履歴 | マージ前の main：`eba2768` | マージのプルリクエストを Revert（Instant Rollback で足りない時） | 数分 |

注意：Instant Rollback で旧コードに戻した間は、邪眼の購入済みレポートも開けない（データは DB に残り、直したコードを出し直すと再び開ける）。

## 10. Google アナリティクス（GA4・測定 ID G-FDN7NYZW9D）

- 計測：邪眼の全ページ（トップ・結果・理論・サンプル2種・解析レポート・完全解析）とマイページで `js/ga.js` を読む。本番ドメインでだけ送信（Preview は送らない）。
- 購入：決済から戻って初めてレポートが開いた時に `purchase`（`value` 1000／3000・`currency` JPY・`items[].item_id` `jagan_report_v1`／`jagan_complete_v1`・`item_category` 邪眼診断・`diagnosis_type` jagan）。`transaction_id` は固有リンクから作る元に戻せない20桁で、同じ購入は二重に数えない。
- **GA4 の管理画面で手動の設定が必要なもの**（集計の画面に出すため。イベント自体は設定しなくても届く）：
  - カスタム ディメンション（範囲：イベント）：`diagnosis_type`・`source`・`state`・`result`・`product`・`share_mode`・`reason`（元素診断で登録済みのものは不要）。
  - キーイベント：`purchase`（登録済みなら不要）。必要に応じて `jagan_start`（診断開始）・`jagan_complete`（診断完了）・`jagan_report_cta`／`jagan_complete_cta`（申込ボタン）・`jagan_save_success`（マイページ保存）。
- 邪眼の主なイベント：`jagan_start`・`jagan_complete`・`jagan_detail_open`・`jagan_image_save`・`jagan_share_click`／`jagan_share_open_x`・`jagan_save_click`／`jagan_save_success`・`jagan_report_cta`／`jagan_complete_cta`（state・source）・`jagan_report_open`／`jagan_complete_open`（source）・`jagan_report_register_*`／`jagan_complete_register_*`・`purchase`。

## 11. 会員データ（マイページ）への影響（2026-11-11 確認）

- 段階 6（`prod_06_jagan.sql`）が既存の表に書くのは、段階の台帳の1行（`element_release.migration_ledger`）だけ。元素診断の6表（profiles・diagnosis_sessions・diagnosis_answers・diagnosis_results・report_snapshots・purchase_entitlements）の列・行・関数は変更・削除しない（適用前の確認で定義の一致を照合し、違えば何も変えずに止まる）。
- 邪眼のサーバーが書き込むのは邪眼の表（jagan_results・jagan_shares・jagan_orders・jagan_order_registrations・jagan_entitlements）だけ。profiles は読むだけ（登録完了の確認）。
- Stripe の Webhook は、元素診断の注文の処理を変えず、元素診断の注文でない時だけ邪眼の処理へ回す。
- マイページの変更は表示と読み込みだけ（元素診断の記録への書き込みの追加・変更なし）。
