# GA4 の設定（運営者の操作）

測定 ID：`G-FDN7NYZW9D`（`js/ga.js`）。本番ドメイン（`element-diagnosis-five.vercel.app`）でだけ送信する。Preview・ローカルでは送らない。

## 1. カスタム ディメンション（管理 → データの表示 → カスタム定義 → カスタム ディメンションを作成）

範囲（スコープ）はすべて「イベント」。登録しないと、レポート・探索で入口別・商品別に分けられない（登録前のデータには遡って付かない）。

| ディメンション名（例） | イベント パラメータ | 中身 |
|---|---|---|
| 入口 | `source` | 申込・ログイン・レポートを開いた場所（`result`・`mypage`・`mypage_record`・`mypage_header`・`analysis_report`・`sample`・`report_link`・`purchase_complete` など） |
| 診断の種類 | `diagnosis_type` | 元素診断 `eti`／邪眼診断 `jagan`。既存の `jagan` は変更しない |
| 統一商品ID | `product_id` | 下表の4商品と旧商品。新規登録が必要（既存の `product` は残す） |
| 商品（従来値） | `product` | ETI は `analysis`／`complete`、DTI は `jagan_report`／`jagan_complete`。既存の集計との互換用 |
| 失敗の理由 | `reason` | 申込・ログインの失敗の理由コード（`sales_closed`・`context_expired` など） |
| 状態 | `state` | 購入・レポートの状態 |
| 結果 | `result` | 操作の結果 |
| ログイン方法 | `method` | `google`・`x`・`email` |
| マイページへの入口 | `entry_point` | `top_header`・`top`・`result` |
| 申込の種類 | `offer` | 申込の内部の種類 |
| 診断の版 | `diagnosis_version` | 診断の版 |
| 共有の形 | `share_mode` | 結果の共有の形 |
| 結果の出どころ | `result_origin` | `diagnosis_result` が、いま診断を完了した結果（`fresh`）か、共有リンク・固有リンク・保存済みを開き直した結果（`restored`）か |

`value`・`currency`・`transaction_id`・`items` は GA4 の標準のため登録しない。

### 流入元（UTM）の扱い

`js/ga.js` は、`page_location` に、許可した `utm_source`・`utm_medium`・`utm_campaign`・`utm_content`・`utm_term` だけを残して送る（GA4 は、流入元を `page_location` の UTM から読む）。診断コード・トークンなど、ほかの問い合わせ文字列と `#` は、これまでどおり送らない。

- 同じ値を、`config` の `campaign_source`・`campaign_medium`・`campaign_name`・`campaign_content`・`campaign_term`(GA4 の設定として、文書化された項目)にも、入れる(`utm_source`→`campaign_source`、`utm_medium`→`campaign_medium`、`utm_campaign`→`campaign_name`、`utm_content`→`campaign_content`、`utm_term`→`campaign_term`)。URL に無い・不正な値は、入れない。
- 値は、英数字と `.` `_` `~` `-` の64文字まで。日本語・記号・空白・メール・URL・長い識別子は、捨てる（捨てた UTM は、流入元が参照元だけで判定される）。
- 投稿・記事の URL の例：`https://element-diagnosis-five.vercel.app/?utm_source=x&utm_medium=social&utm_campaign=<名前>`。note は、`utm_source=note&utm_medium=referral`。
- 流入元は、セッションの最初のヒットで決まる。UTM の反映は、GA4 の DebugView・リアルタイムで、確認する。
- 診断の結果の共有リンク（`?dv=…&code=…`）に UTM を付ける場合は、X のカードのキャッシュが、URL ごとである点に、注意する（`?v=` と同じ扱い）。

### 両診断の商品対応（2026-11-15 修正案・本番反映後から有効）

| 診断 | 商品 | `product_id` | 従来の `items.item_id` |
|---|---|---|---|
| 元素診断 | 解析レポート ¥1,000 | `eti_analysis_v1` | `analysis` |
| 元素診断 | 完全解析 ¥3,000 | `eti_complete_v1` | `complete` |
| 邪眼診断 | 解析レポート ¥1,000 | `jagan_report_v1` | `jagan_report_v1` |
| 邪眼診断 | 完全解析 ¥3,000 | `jagan_complete_v1` | `jagan_complete_v1` |

旧商品 `core1` は `eti_core1_legacy` として別扱い。金額のみから商品を推測しない。従来の item_id と transaction_id は変更しない。

`product_id` はイベント単位の商品比較用。標準のeコマース購入レポートでは、従来どおり商品ID・商品名・商品カテゴリを使う。登録・デプロイ前のイベントには遡及しない。

## 2. キーイベント（管理 → データの表示 → イベント → 「キーイベントとしてマーク」）

| イベント | 意味 |
|---|---|
| `purchase` | 購入（固有リンクを開いた時。取引 ID・金額・JPY・items） |
| `registration_onboarding_complete` | 新規登録の完了（同意まで） |
| `begin_checkout` | 申込の開始（Stripe の決済画面へ進む前） |
| `quiz_complete` | 診断の完了 |

## 3. 返金の計測（Measurement Protocol の API シークレット）

返金は Stripe の Webhook（`charge.refunded`）の処理の後に、サーバーから `refund` を送る（`lib/ga4-mp.js`）。秘密値が無い間は何も送らない。

1. GA4：管理 → データの収集と修正 → データストリーム → ウェブのストリーム → **Measurement Protocol API secrets** → 作成。
2. Vercel：プロジェクト element-diagnosis → Settings → Environment Variables → `GA4_API_SECRET`（Type：Secret・Environments：**Production のみ**）。値はチャット・ログ・commit に出さない。
3. Production を再デプロイ（環境変数は新しいデプロイから有効）。

送る内容：`refund`・`transaction_id`（purchase と同じ参照。注文 ID・Stripe の ID・メールは送らない）・`currency=JPY`・`value`（返金額）。Stripe Live の返金だけ。

## 4. 主な計測イベント（流れ順）

| 段階 | イベント |
|---|---|
| 診断 | `quiz_start` → `quiz_complete` → `diagnosis_result` |
| 結果の保存・共有 | `result_save_click`・`result_url_copy`・`result_tweet_click`・`result_image_save_click` |
| ログイン・登録 | `login_start` → `login_success`／`login_failed` → `registration_onboarding_view` → `registration_onboarding_complete`／`_decline` |
| マイページ | `mypage_entry_click`・`mypage_view`・`mypage_view_result_click`・`mypage_report_open` など |
| 申込 | `checkout_start`＋`begin_checkout` → `checkout_session_created`（画面作成成功）→ `checkout_redirect`（Stripe へ移動を要求）／`checkout_failed` → `checkout_return`（中止して戻った） |
| 購入 | `purchase`（支払いから3時間以内に固有リンクを開いた時・このブラウザで1回） |
| 返金 | `refund`（サーバーから。§3 の設定の後） |
| レポート | `analysis_report_open`・`complete_report_open`・`report_link_copy` |
| マイページ登録 | `report_register_start` → `report_register_done`／`report_register_failed` |

### 計測の限界

- `purchase` はブラウザから送る。支払いの後に固有リンクを開かなかった購入は数えない（実数は Stripe で確かめる）。
- 返金は §3 の設定の後の返金だけ。
- 送る値は `js/ga.js` で消毒する（記録 ID・user ID・メール・トークン・URL・Stripe の ID・診断コードを落とす）。


## 5. ETI・DTI比較の運用（2026-11-15 修正案）

本節は `fix/ga4-diagnosis-funnel` のコード修正に対応する。本番反映・GA4設定完了を意味しない。

- 修正後、両診断の現行導線は `begin_checkout` を申込APIの呼び出し前に送る。ETIの完全解析は目標選択完了後。キャンセルした選択は申込に数えない。
- 修正前のDTIは成功応答後に `begin_checkout` を送っていた。前後を同じ定義の指標として比較しない。リリース時刻を記録する。
- `checkout_session_created` はAPIが有効なStripe URLを返した時。Stripe側の新規Session件数ではなく、再試行で既存Sessionが返る場合も含む。
- `checkout_redirect` は移動要求まで。Stripe画面の表示や支払い成功を保証しない。
- 同じ申込内の通信再送では開始イベントを増やさない。別の再申込は別イベントとして数える。
- `source` は操作した画面。広告や検索などの流入元は標準のセッション参照元・メディアを使う。

### 日次の比較

1. 診断開始・完了：ETIは `quiz_start`／`quiz_complete`、DTIは `jagan_start`／`jagan_complete` をそれぞれ集計する。
2. 結果の傾向：ETIは `diagnosis_profile`、DTIは `jagan_profile`。診断完了イベントから特性値を取得しない。
3. 申込：`checkout_start`／`begin_checkout`／`checkout_session_created`／`checkout_redirect`／`checkout_failed` を `diagnosis_type` と `product_id`、必要に応じて `source` 別に集計する。
4. 購入：`purchase` を診断・商品別に集計。実売上の正はStripeと注文DB。GA4の購入欠落を「売上ゼロ」と扱わない。
5. 完了率はユーザー基準かイベント回数基準かを明記する。購入・申込は別日に発生し得るため、単純な日次イベント比率を厳密なファネル到達率と呼ばない。

### 本修正で解消しない点

- 申込元の注文DBへの永続保存は未実装。ETIのpurchaseはsourceを返さず、DTIも同じタブの一時保存に依存する。申込元別の売上を完全に照合できるとは説明しない。
- DTIのtransaction_idは従来の固有リンク由来のまま。DBから照合できる注文参照への移行は未実装。過去購入を再送しない。
- サーバー側purchase・送信状態管理・DTIのWebhook監査ログ追加・注文統合ビューは未実装。
- GA4管理画面の `product_id` 登録と、本番デプロイ後の受信確認は別途必要。

### 検証

`node --test tests/ga4_commerce_contract.test.js tests/ga4_measurement.test.js tests/ga4_privacy.test.js tests/jagan_purchase.test.mjs tests/jagan.test.mjs`

共通イベント分類、商品ID互換、DTIの結果・サンプル・レポート下部・マイページ、API失敗、通信再送、二重押し、計測例外、既存の個人情報除去を検証する。実ブラウザ試験と実DB試験は、対応環境で別途実行する。
