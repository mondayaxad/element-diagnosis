# 邪眼診断（DTI）解析レポート ¥1,000・完全解析「DIPPER」¥3,000：本番リリースの準備状況

作成：2026-11-10（同日更新：邪眼だけを切り出した `jagan-release` ブランチ・段階 6 の草案・決済を元素診断と同じ仕組みに）。**本番には何も反映していません**（本番 DB の変更・main へのマージ・本番デプロイ・本番の環境変数・Stripe Live の設定・販売開始は、いずれも未実施）。
本番の状態は、読み取りだけで確かめました。

## 1. Preview で完了していること（`release-c-preview`・bbcefd4）

- 完了ページ（¥1,000 の主導線＋「BEYOND THE RESULT」の ¥3,000）・解析レポート（¥1,000）・完全解析「DIPPER」（¥3,000・23ページ・/jagan/dipper）・マイページ（2商品・INSIGHT／COMPLETE）。
- 購入 API（2商品・金額はサーバーが決める）・Preview DB の jagan_01〜03（2026-11-10 に jagan_03 を適用済み）。
- 検査：全体 714 件合格（不合格は以前からの #727 の1件）。同じ回答での無料・¥1,000・¥3,000 の表示一致（300件）。実PG の jagan_01〜03（16件：期限切れ・未払いで権利なし、決済通知の再処理で増えない、両方で2つの権利）。
- Preview の実画面：完了ページから ¥1,000・¥3,000 の決済画面（Stripe Test）が作られ、注文に同じ50問が入ることを確認。
- **未確認**：Preview でのテスト決済の支払い後（この作業環境から Stripe に接続できないため）。手順は §5。

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
- Preview でのテスト決済の支払い後（§5）。
- `jagan-release` の全体の検査（2026-11-11）：640 件合格、不合格は以前からの1件（Google・X の認証から戻ったマイページの検査）。
