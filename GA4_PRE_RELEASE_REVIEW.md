# GA4 修正の、本番リリース前の追加検証

調査日：2026-10-28
対象：ブランチ `claude/handoff-pjrsoa`(`4074e42`・`GA4_FIX_REPORT.md` の修正)
状態：**調査だけ。コード・Stripe・Supabase・環境変数・本番 GA4 のどれも、変更・送信していません。`main` へのマージと、本番デプロイも、していません。既存の修正は、維持しています。**

## 0. 結論(先に読む)
| 項目 | 判定 |
|---|---|
| `result_origin` と、再診断での `diagnosis_result` の欠落の修正 | **リリース可。** GA4 の仕様に依存せず、試験で確認済みです。 |
| UTM を `page_location` に残す修正 | **リリースしても、害はありません(今より悪くならない)。ただし、「流入元として、使われる」保証は、公式文書では、確認できていません。** 公式に文書化された方法(`campaign_*`)を、足すことを、お勧めします(§5 の案A)。 |
| `source` パラメータの、流入元への影響 | **未確認(仮説)。** 既存の GA4 のデータで、送信なしに、確かめられます(§3)。確認の後に、改名(案B)を決める、順序を、お勧めします。 |
| **本番リリースの可否** | **条件付きで可。** 推奨の順序は、①案A を、同じブランチに足す → ②リリース → ③承認をいただいたうえで、本番 GA4 に、テストを送って確認 → ④案B の要否を決める。案A なしで、先にリリースしても、害はありません。 |

## 1. 重要な前提：公式文書を、直接は、読めませんでした
- この環境のネットワークでは、`developers.google.com` と `support.google.com` が、許可されておらず、**Google の公式ページを、直接、読めませんでした**(名前を解決できない)。
- 代わりに、検索で得た、**公式ページの抜粋と、第三者の解説**を、使っています。次の根拠は、「二次情報」です。公式ページの原文を、確認するには、この2つのドメインを、セッションのネットワーク設定で、許可していただく必要があります。
- このため、各項目に、**【確認済み】**(コード・実ブラウザの実行・Stripe/Vercel の読み取りで、確かめた事実)、**【二次情報】**(検索で得た、公式の抜粋・解説)、**【未確認】**を、付けました。

## 2. 確認事項 1：UTM を残した `page_location` は、流入元の判定に使われるか
### 【二次情報】
- Google の GA4 の設定リファレンス(`gtag` の `config`)は、`campaign_source`・`campaign_medium`・`campaign_name`・`campaign_term`・`campaign_content`・`campaign_id` という、**キャンペーンの設定の項目を、文書化**しています([Configuration | Google Analytics](https://developers.google.com/analytics/devguides/collection/ga4/reference/config))。同じ文書に、`page_location`(既定は `document.location`)と、`page_referrer` も、あります。
- Google のヘルプ「Set custom campaign data」は、gtag.js や GTM で、キャンペーンの値を、設定する方法を、説明しています([Set custom campaign data](https://support.google.com/analytics/answer/11259997?hl=en))。
- 検索結果の要約では、**「明示したキャンペーンの値は、URL の `utm_*` を、上書きする」**とされています(上の公式文書の記述の、要約。原文は、未確認)。
- 解説記事では、`page_location` は、UTM を含む完全な URL でなければならない、とされています([GA4 Tip: The page_location parameter](https://medium.com/sparkline/ga4-tip-the-page-location-parameter-89727ab04b4c))。**カスタムの `page_location` を作る時に、UTM のキーを落とすと、UTM が、タグの段階で、消える**という注意が、あります([Analytics Mania](https://www.analyticsmania.com/post/utm-parameters-not-working-in-google-analytics-4/))。これは、**今回の修正前の状態そのもの**(クエリを全部削っていた)です。
- 流入元は、**セッションの最初のヒットで決まり**、セッションの途中で、UTM 付きのリンクを開いても、変わりません([gtm-gear](https://gtm-gear.com/posts/ga4-sessions-source-medium/)、[Analytics Mania](https://www.analyticsmania.com/post/utm-parameters-not-working-in-google-analytics-4/))。
- `utm_source` と `utm_medium` が、必要で、`utm_campaign` だけでは、判定されない、という説明が、複数あります。

### 【未確認】
- **`gtag('config', …, { page_location })` で、上書きした値の UTM が、流入元の判定に使われる、と明言した公式の文言は、確認できていません。** 実際に、動作する可能性は、高い(`page_location` は、`dl` として、送られ、UTM の解析は、そこから、行われる、と解説されている)と、考えますが、**保証は、ありません。**

### 判断
- 今の修正は、UTM を、正しく通す方向です。**効かない場合でも、今より悪くなることは、ありません**(これまで、UTM は、まったく届いていなかった)。
- **公式に、文書化された、`campaign_*` を、併用すれば、`page_location` の挙動に、依存しなくなります。** これが、案A(§5)です。

## 3. 確認事項 2：イベントの `source` は、セッションの流入元に影響し得るか
### 【確認済み】(コード)
- サイトは、`source` というパラメータを、次の場所で、イベントに付けています：`mypage.html`(`caTrackParams` の `source: 'mypage_header'` など18か所)、`js/guest-purchase.js`(8)、`js/report-purchase.js`(7)、`index.html`(6)、`report-link.html`(3)、`report.html`・`report_sample.html`・`purchase-complete.html`(各2)、`js/sample-buy.js`(1)。
- `medium`・`campaign`・`term`・`gclid` など、**ほかの衝突しそうな名前は、使っていません**(確認済み)。

### 【二次情報】
- BigQuery のエクスポートでは、**GA4 自身が、`event_params` に、`source`・`medium`・`campaign`・`term`・`gclid` というキーを、入れる**ことが、解説されています([Adswerve](https://adswerve.com/technical-insights/four-different-ga4-traffic-flavors-in-the-bigquery-export))。**同じ名前空間に、サイトが `source` を送ると、衝突し得る**、という、状況証拠です。
- セッションの流入元は、**最初のヒット**で決まる、とされています(§2)。**途中のイベントの `source` が、後から、流入元を書き換えるとは、考えにくい**。
- **ただし、「セッションの最初のヒットが、ページの表示ではなく、カスタムのイベント」である場合**は、別です。たとえば、**ページを開いたまま、30分以上、操作がなく、その後、ボタンを押す**と、新しいセッションが、そのイベントから始まります。マイページの完全解析の操作は、`source: 'mypage_header'` を付けます。**依頼資料に出ていた、`mypage_header /`(1セッション)は、この形で、説明できます。** 1セッションだけ、という頻度も、合います。
- 「`source` のカスタムのパラメータが、流入元を上書きする」と、明言した公式の文書は、**見つけられませんでした。**

### 【未確認】と、確かめ方(送信なし)
**既存の GA4 のデータで、確かめられます。本番に、何も送る必要は、ありません。**
1. GA4 の「探索」で、ディメンションに、`セッションの参照元 / メディア`、`セッションの最初のイベント名`(または、`セッション ID` と、イベント名の、並び)を使う。
2. `セッションの参照元` が、`mypage_header`・`mypage`・`result`・`report_link`・`purchase_complete`・`analysis_report`・`sample` など、**サイトの `source` の値**と同じセッションを、抽出する。
3. そのセッションの、**最初のイベントが、`page_view` / `session_start` か、カスタムのイベントか**を、見る。カスタムのイベントなら、仮説が、裏付けられます。
4. 該当が、ほとんど無ければ、`source` の影響は、小さいと、判断できます。

## 4. 確認事項 3：設定値と送信順序。セッション開始時点で、UTM は、有効か
### 【確認済み】(実ブラウザでの実行)
- Playwright(Chromium)で、**本番のドメイン名のまま、ローカルのファイルを配信**し、`gtag.js` だけを、差し替えて、`dataLayer` の中身と順序を、確かめました(本番には、何も送っていません)。

| 場面 | `dataLayer` の順序 |
|---|---|
| UTM 付きの共有リンク(`?utm_source=x&utm_medium=social&utm_campaign=t1&dv=ETI-2.0&code=…`、参照元 `t.co`) | ① `js` → ② `config`(`page_location` = `…/?utm_source=x&utm_medium=social&utm_campaign=t1`、`page_referrer` = `https://t.co/`)→ ③ 以降のイベント(`diagnosis_result`〈`result_origin: "restored"`〉、`section_reached_*`) |
| UTM なし・参照元なし | ① `js` → ② `config`(`page_location` = `…/`、`page_referrer` = 空) |

- **`config` が、すべてのイベントより前に、積まれます。** 最初のヒット(`page_view`、`session_start`、`first_visit`)は、`config` の値(UTM を含む `page_location`)で、送られる順序です。
- **診断コード(`code=`)は、`dataLayer` のどこにも、含まれません。**
- `js/ga.js` は、すべての主要なページ(`index`・`mypage`・`report`・`report-link`・`purchase-complete`・`report_sample`)で、`<head>` の、最初のほうで、読み込まれ、最初の `gtag(` の呼び出しより、前にあります(行番号で確認)。`complete-sample.html` は、本文の末尾で、読み込みますが、`gtag(` の呼び出しは、ありません。
- `gtag('config')`・`gtag('set')`・`send_page_view` の別の呼び出しは、`js/ga.js` のほかに、ありません(`googletagmanager` を直接、読み込むページも、ありません)。

### 【未確認】
- 実際の `gtag.js` が、`config` から、`page_view`・`session_start` を、どう作って送るかは、**この環境では、実行できません**(スタブで、順序だけを確認)。**GA4 の DebugView での、確認が、必要です**(§6)。

## 5. 確認事項 5：追加の変更案(最小・未実装)
### 案A：公式に文書化された `campaign_*` を、`config` に、併用する(推奨・優先度：中〜高)
- 目的：`page_location` の挙動に、依存せず、**文書化された方法で、流入元を、確実に、渡す**。
- 変更箇所：`js/ga.js` だけ(約10行)。許可した `utm_*` と**同じ値**(同じ検証を通ったもの)を、`campaign_source`・`campaign_medium`・`campaign_name`・`campaign_content`・`campaign_term` として、`config` の引数に、足す。
  ```js
  // 概念：campaignQuery と同じ検証の結果から作る（値は同じ。UTM が無ければ、何も足さない）
  push('config', MEASUREMENT_ID, Object.assign(
    { page_location: …, page_referrer: … },
    campaignParams(location.search)   // { campaign_source, campaign_medium, campaign_name, … }
  ));
  ```
- 影響：UTM が付いたページの読み込みだけに、効く。付かないページ・診断・保存・購入の処理には、影響しない。`campaign_*` と `utm_*` が、同じ値のため、**上書きされても、結果は同じ**。
- 試験案(`tests/ga4_fixes.test.js` に、追加)：
  1. UTM 付きの `search` で、`config` に、`campaign_source`・`campaign_medium`・`campaign_name` が、同じ値で、入る。
  2. 不正な値(メール・UUID・URL・日本語・64文字超)は、`campaign_*` にも、入らない。
  3. UTM が無ければ、`campaign_*` は、入らない(`config` の形が、従来どおり)。
  4. `?code=` などが、`campaign_*` の値に、混ざらない。

### 案B：`source` を、GA4 へ送る名前だけ、`entry_source` に付け替える(優先度：中。§3 の確認の後に、判断)
- 目的：GA4 自身が使う `source` という名前との、衝突を、避ける。
- 変更箇所：`js/ga.js` の `window.gtag`(イベントの入口)の、1か所。呼び出しの約50か所と、**サーバーの API の `source`(`lib/link-purchase.js:356-360`)は、書き換えない**(`gtag` に渡る直前だけで、付け替える)。
  ```js
  if (params && 'source' in params) { params = Object.assign({}, params, { entry_source: params.source }); delete params.source; }
  ```
- 影響：GA4 の、カスタム ディメンションの `source`(`docs/GA4_SETUP.md` §1)が、以後、空になる。**`entry_source` を、新しく登録**する必要がある(過去のデータは、遡って、変わらない)。`docs/GA4_SETUP.md` の更新も、必要。
- 試験案：
  1. `gtag('event', 'x', { source: 'mypage' })` が、`dataLayer` に、`entry_source: 'mypage'` として入り、`source` が、含まれない。
  2. `source` が、無いイベントは、変わらない。
  3. `items` の中などの、ほかのパラメータは、変わらない。
  4. 既存の試験(`ga4_privacy`・`guest_purchase_ui`・`report_purchase_ui` など)が、期待値の更新だけで、通る(影響の大きい箇所は、事前に洗い出す)。
  5. API の本文の `source`(`op=buy`)は、変わらない(`link_purchase_api` の試験)。

### 案C：採用しない(参考)
- 約50か所の `source` の呼び出しを、直接、書き換える方法は、API の本文との食い違いや、試験の大量の変更を、招くため、お勧めしません。

## 6. 本番 GA4 への、テスト送信の計画(**承認が、必要。まだ、実行していません**)
本番の GA4 に、テストのイベントを送ることになるため、**実行の前に、ご承認をください。** 次の範囲に、限ります。
- 送り先：本番の GA4(`G-FDN7NYZW9D`)。**本番のドメインの、本番のページ**から、ブラウザで、操作する(Preview では、`js/ga.js` が、送らないため)。
- 前提：**本番に、修正をデプロイした後**。デプロイの前の本番では、UTM の新しい挙動を、確かめられません。
- 手順(運営者のブラウザ。シークレットウィンドウ・デバッグ有効):
  1. GA4 の DebugView を開く。
  2. `https://element-diagnosis-five.vercel.app/?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease` を開く。
  3. DebugView で、`page_view`/`session_start` の、`page_location`・`campaign`・`source`・`medium` を、確認する。**流入元が、`ga4check / test` になること。**
  4. 診断を完了し、`diagnosis_result` の `result_origin` が、`fresh` であることを、確認する。
- 影響：テスト用の、少数のイベントが、本番のデータに、混ざる(`utm_campaign=prerelease` で、後から、除外・識別できる)。**購入・保存・決済は、行いません。**
- 代わりに、承認が、得られない場合：§3 の確認(送信なし)と、Playwright の確認(§4)までに、とどめます。

## 7. 確認事項 4：本番と Preview の、ビルド・配信設定の差
### 【確認済み】(Vercel の読み取り・実取得)
| 項目 | 本番 | Preview(`claude/handoff-pjrsoa`) | 差 |
|---|---|---|---|
| ビルドコマンド・出力 | `vercel.json`：`node scripts/build-public.js`、`dist` | 同じ(同じ `vercel.json`) | なし |
| Node のバージョン | 24.x(プロジェクト設定) | 同じ | なし |
| 配信ヘッダー(CSP・`X-Frame-Options`・`Referrer-Policy` など) | `vercel.json` の設定どおり(実取得で確認) | 同じ設定(実取得で確認)。Preview には、`x-robots-tag: noindex` が、付く | Vercel の既定のみ |
| `js/ga.js` の送信 | 本番のドメイン(`element-diagnosis-five.vercel.app`)でだけ送信 | **送信しない**(設計) | **設計上の差** |
| GA4 関連の環境変数 | `GA4_API_SECRET` は、**登録されていない**(キーの一覧で確認) | 登録されていない | 返金の計測は、本番でも、まだ、動きません |
| 環境変数の対象 | Production の値 | **ブランチ限定の変数(`release-c-preview` だけ)は、今回の作業用ブランチには、効かない**(`SUPABASE_URL`・`SUPABASE_ANON_KEY`・`STRIPE_SECRET_KEY` など)。ブランチ指定のない、Preview の変数(`COMPLETE_SALES_OPEN`・`STRIPE_PRICE_ANALYSIS`・`STRIPE_COMPLETE_WEBHOOK_SECRET`)だけが、効く | **差あり(下記)** |
| 保護 | 公開(カスタムドメイン・`*.vercel.app` の本番) | Vercel のログインが、必要(SSO・`all_except_custom_domains`) | Preview は、ログイン後だけ |

- **この作業用ブランチの Preview は、`SUPABASE_*` と `STRIPE_SECRET_KEY` の、ブランチ限定の変数を、持ちません。** ログイン・保存・購入などの、**API を使う操作は、この Preview では、本番と同じようには、動きません**(`release-c-preview` の Preview とは、異なる)。今回の修正は、**クライアントの計測だけ**で、API に依存しないため、影響はありませんが、**Preview での、購入や保存の、確認は、この Preview では、できません。**(本番の前の、購入の確認が必要な場合は、`release-c-preview` の Preview の環境変数を、この新しいブランチにも、設定する必要があります。これは、運営者の作業です。)
- Preview の `js/ga.js` に、修正が、含まれていることを、実取得で、確認しました(`campaignQuery` を含む)。
- (付記)本番の特商法のページを、取得して、請求書メールの記載が、無い(前のリリースの反映)ことを、確認しました。

### 【未確認】
- 本番と Preview の、`dist` の全ファイルの、バイト単位の比較は、していません(本番は、前回の `main`、Preview は、そこへ、今回の修正を足した、同じ `build-public.js` の出力のため、差は、今回の差分に、限られると、考えます)。

## 8. 修正が必要な箇所(まとめ)
| 優先 | 箇所 | 内容 | 状態 |
|---|---|---|---|
| 中〜高 | `js/ga.js` | 案A：`campaign_*` の併用 | 未実装(ご承認をお待ちします) |
| 中 | `js/ga.js` | 案B：`source` → `entry_source`。§3 の確認の後に判断 | 未実装 |
| 中 | GA4 管理 | `result_origin`(必須)・`entry_source`(案B の場合)の、カスタム ディメンションの、登録 | 運営者の作業 |
| 低 | Vercel | 新しいブランチの Preview に、ブランチ限定の環境変数が、必要な場合のみ、設定 | 運営者の作業 |
| 情報 | Google の公式ページ | `developers.google.com` と `support.google.com` を、ネットワークで、許可すると、原文で、確認できる | ご判断 |

## 9. 本番リリースの可否
- **可(条件付き)。**
  - `result_origin` と、再診断の修正は、リリースして、問題ありません。
  - UTM は、リリースしても、害はなく、効く可能性が高いですが、**保証は、未確認**です。案A を、足せば、公式に、文書化された方法に、なります。
  - `source` の疑いは、リリースを、止める理由では、ありません(既存の問題で、今回の修正が、悪化させない)。
- 推奨の順序：**①案A の実装と試験(承認後)→ ②`main` へのマージと、本番デプロイ(承認後)→ ③本番 GA4 でのテスト送信(§6・承認後)→ ④§3 の確認 → ⑤案B の要否の判断。**

**ここで、停止します。**
