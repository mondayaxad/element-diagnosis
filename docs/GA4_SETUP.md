# GA4 の設定（運営者の操作）

測定 ID：`G-FDN7NYZW9D`（`js/ga.js`）。本番ドメイン（`element-diagnosis-five.vercel.app`）でだけ送信する。Preview・ローカルでは送らない。

## 1. カスタム ディメンション（管理 → データの表示 → カスタム定義 → カスタム ディメンションを作成）

範囲（スコープ）はすべて「イベント」。登録しないと、レポート・探索で入口別・商品別に分けられない（登録前のデータには遡って付かない）。

| ディメンション名（例） | イベント パラメータ | 中身 |
|---|---|---|
| 入口 | `source` | 申込・ログイン・レポートを開いた場所（`result`・`mypage`・`mypage_record`・`mypage_header`・`analysis_report`・`sample`・`report_link`・`purchase_complete` など） |
| 商品 | `product` | `analysis`（解析レポート ¥1,000）／`complete`（完全解析 ¥3,000） |
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
| 申込 | `checkout_start`＋`begin_checkout` → `checkout_redirect`（Stripe へ）／`checkout_failed` → `checkout_return`（中止して戻った） |
| 購入 | `purchase`（支払いから3時間以内に固有リンクを開いた時・このブラウザで1回） |
| 返金 | `refund`（サーバーから。§3 の設定の後） |
| レポート | `analysis_report_open`・`complete_report_open`・`report_link_copy` |
| マイページ登録 | `report_register_start` → `report_register_done`／`report_register_failed` |

### 計測の限界

- `purchase` はブラウザから送る。支払いの後に固有リンクを開かなかった購入は数えない（実数は Stripe で確かめる）。
- 返金は §3 の設定の後の返金だけ。
- 送る値は `js/ga.js` で消毒する（記録 ID・user ID・メール・トークン・URL・Stripe の ID・診断コードを落とす）。
