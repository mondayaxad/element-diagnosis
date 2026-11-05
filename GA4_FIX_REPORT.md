# GA4 計測精度の最小修正：報告

作業日：2026-10-28
ブランチ：`claude/handoff-pjrsoa`(`main` = `32293ec` から分岐。`main` は変更していません)
状態：**Preview で確認できる状態まで。本番へのデプロイは、していません。**

## 1. 約束の確認
| 約束 | 結果 |
|---|---|
| 本番 `main` を変更しない | 守りました(作業は、作業用ブランチだけ) |
| 本番 DB・Stripe・環境変数を変更しない | 変更していません |
| 診断コード・認証情報などを GA4 へ送らない | 送りません(§3 の試験で、確認) |
| 既存の診断・保存・購入の処理を変更しない | 変更していません(変更は、`js/ga.js`、`index.html` の結果表示の計測部分、試験、文書だけ) |
| `source` の改名は、影響を調べてから別途判断 | **改名していません。** 影響範囲は、§5 |
| 新しい名前・パラメータを、GA4 の仕様に照らして確認 | §4 |
| 本番へはデプロイしない | していません |

## 2. 修正の差分(`4074e42`)
```
 docs/GA4_SETUP.md          | +10   result_origin のディメンション・UTM の運用
 index.html                 | +10 -2
 js/ga.js                   | +22 -2
 tests/ga4_fixes.test.js    | 新規(9件)
```

### 2-1. UTM を、安全に GA4 へ渡す(`js/ga.js`)
- `page_location` に、**許可した5つ(`utm_source`・`utm_medium`・`utm_campaign`・`utm_content`・`utm_term`)だけ**を残します。
- 値は、英数字と `. _ ~ -` の64文字まで。次のものは、捨てます。
  - 日本語・記号・空白・改行・64文字を超える値。
  - メール・UUID・Stripe の ID・URL・長い識別子に見える値(既存の、イベントの値の消毒と同じ規則)。
  - 許可していない名前(`utm_id` など)・大文字の `UTM_SOURCE`。
- `?code=`・`?token=`・`?view=`・`?rec=` などの、ほかの問い合わせ文字列と `#` は、これまでどおり、送りません。UTM と一緒に付いていても、同じです。

```js
page_location: location.origin + location.pathname + campaignQuery(location.search)
```

### 2-2. `diagnosis_result` に `result_origin` を足す(`index.html`)
- `fresh` = いま診断を完了した結果。`restored` = 共有リンク・固有リンク・保存済みの結果を、開き直したもの。
- 判定は、診断の完了の処理(`showResultV2`)が立てる、専用の印(`__freshResultNonce`)で行います。
- **`__resumeFresh` は、判定に使っていません。** 開き直した結果で購入ボタンを押した時にも、`true` になるためです(誤って `fresh` と記録するのを防ぐ)。

### 2-3. 再診断で、結果表示のイベントが欠落する問題の修正(`index.html`)
- 以前は、`window.__resultLogged = true` が、ページを再読み込みするまで戻らず、**同じページで2回目に診断した結果は、`diagnosis_result` が出ませんでした。**
- 今は、結果ごとの鍵(`fresh:<完了の番号>` / `restored`)を、前回の鍵と比べて、違う時だけ、1回記録します。
  - 同じ結果の再描画では、増えません。
  - 診断の完了のたびに、1回ずつ記録されます。

## 3. テスト結果
### 新規の試験(`tests/ga4_fixes.test.js`・9件・すべて合格)
| 試験 | 内容 |
|---|---|
| UTM の保持 | 許可した utm_* が、残る。UTM が無ければ、これまでどおり |
| UTM とほかの値 | 診断コード・トークン・`#` が、UTM と一緒でも、送られない(`dataLayer` 全体で確認) |
| 不正な値の破棄 | 長い値・メール・UUID・Stripe の ID・URL・診断コードに見える値・記号・日本語・許可外の名前は、捨てる |
| 本番以外 | Preview・ローカルでは、何も送らない(既存どおり) |
| 初回表示 | `result_origin=fresh` で、1回だけ。再描画でも、増えない |
| **連続した再診断** | 同じページで、3回続けて診断 → `fresh` が3回。`quiz_complete` と同数 |
| 開き直し | 共有リンク・固有リンク・再読み込みは、`restored` が、ページごとに1回。`quiz_complete` は、出ない。購入を押した状態でも、`fresh` にならず、増えない |
| 開き直し → 再診断 | `restored` の後に、同じページで診断し直すと、`fresh` |
| 秘密の非送信 | `diagnosis_result` に、診断コード・秘密値が、含まれない。キーは、決まったものだけ |

- **修正前のコードでは、この9件のうち8件が失敗する**ことを確認しました(本番以外の試験だけが、通る)。試験は、修正を検出できています。

### 全体
- 全試験：**654件中、575件が合格・失敗0・79件がスキップ**(ローカルの検証用 DB が必要な試験。この環境に DB がないため。修正前と同じ件数)。
- `node scripts/build-public.js`：OK(既知の欠損の警告 35件は、これまでと同じ)。
- 既存の GA4 の試験(`ga4_privacy`・`ga4_measurement`)も、合格しています。

## 4. GA4 の仕様の確認
| 項目 | 確認の結果 |
|---|---|
| UTM は、`page_location` から読まれる | 解説記事では、そのとおりとされています([GA4 Tip: The page_location parameter](https://medium.com/sparkline/ga4-tip-the-page-location-parameter-89727ab04b4c))。Google の設定の仕様では、`page_location` は、ブラウザの `document.location` が既定で、上書きできる、とされています([GA4 config reference](https://developers.google.com/analytics/devguides/collection/ga4/reference/config))。**上書きした値の UTM が、流入元に使われることを、明言した公式の文書は、見つけられませんでした。DebugView での確認が、必要です(§6)。** |
| 流入元は、セッションの最初のヒットで決まる | 解説では、最初のヒットで決まり、後から URL が変わっても、変わらないとされています([Optizent](https://www.optizent.com/blog/why-are-my-utms-in-the-url-but-ga4-still-says-direct-or-not-set/))。 |
| 新しいパラメータ名 `result_origin` | 英字で始まる英数字と `_` で、40文字以内。値は `fresh`・`restored`(100文字以内)。**カスタム ディメンション(イベント範囲)として、GA4 に登録が必要です**(現在の登録は10個で、1つ足すと、11個。上限50個の範囲内です)。 |
| `source` パラメータの扱い | **公式の文書では、確認できませんでした**(§5)。 |

## 5. `source` の改名：影響範囲の調査(実装していません)
### 現状
- 計測のイベントのパラメータ `source` は、9つのファイルで、使われています。

| ファイル | 件数 |
|---|---:|
| `mypage.html` | 18 |
| `js/guest-purchase.js` | 8 |
| `js/report-purchase.js` | 7 |
| `index.html` | 6 |
| `report-link.html` | 3 |
| `report.html`・`report_sample.html`・`purchase-complete.html` | 各 2 |
| `js/sample-buy.js` | 1 |

- **計測だけでなく、サーバーの API にも、同じ名前が渡っています。** `js/report-purchase.js:225` が、`/api/complete-checkout?op=buy` の本文に `source` を入れ、`lib/link-purchase.js:356-360` が、受け取ります(計測用の入口の名前。購入の処理には、使われていません)。**API の名前を、一緒に変えると、クライアントとサーバーの食い違いが起こり得ます。改名の対象は、「GA4 へ送る名前」だけにするべきです。**
- 試験にも、`source` の期待値が、複数あります(`ga4_privacy`・`guest_purchase_ui`・`complete_*_ui`・`link_purchase_api` など)。

### 疑い(未確認)と、公式文書の状況
- `source` が、セッションの流入元を上書きするかは、検索した範囲では、**公式の文書で確認できませんでした**。BigQuery のエクスポートでは、`event_params` に `source`・`medium`・`campaign` というキーが、あることが、解説されています([Adswerve](https://adswerve.com/technical-insights/four-different-ga4-traffic-flavors-in-the-bigquery-export))が、カスタムの `source` が、セッションの流入元を上書きするかは、確かめられていません。
- ただし、実際の GA4 に、サイトが付けていない流入元 `mypage_header /` が出ている事実と、コードの `source: 'mypage_header'`(`mypage.html:3084`)の一致は、強い状況証拠です。

### 改名する場合の、最小の方法(提案・未実装)
- 呼び出しの場所(約50か所)を、書き換えず、**`js/ga.js` の `gtag('event', …)` の入口で、`source` を `entry_source` に、付け替える**(1か所の変更)。API の本文・試験の期待値は、変わりません。
- GA4 側では、カスタム ディメンション `source` を、`entry_source` で、新しく登録する(過去のデータは、遡らない)。
- **先に、DebugView で、疑いを確かめてから、判断することを、お勧めします**(§6 の手順 3)。

## 6. Preview の確認手順
Preview のアドレス：`https://element-diagnosis-g1osgbk9f-nmkw0322-4497s-projects.vercel.app`(ブランチ `claude/handoff-pjrsoa` の `4074e42`・READY)。**Vercel にログインした状態で、開いてください。**

> **重要**：Preview では、**GA4 へは、何も送られません**(`js/ga.js` が、本番のドメインだけで送る設計。本番の計測を汚さないため)。そのため、Preview では、**画面で、イベントの中身だけ**を確認します。GA4 に届くことの確認は、本番の後の、§7 です。

### 手順 1：配信されている修正の確認(済み)
- Preview の `js/ga.js` に、`campaignQuery` と、許可した `utm_*` の処理が、含まれていることを、取得して確認しました。

### 手順 2：`result_origin` を、画面で確認する(約3分)
1. Preview のトップを開く。ブラウザの開発者ツールの、コンソールを開く。
2. 次を、貼り付けて、実行する(イベントを、控えるだけ。外へは、何も送りません)。
   ```js
   window.__ev = []; const g = window.gtag;
   window.gtag = function () { window.__ev.push(Array.from(arguments)); return g.apply(this, arguments); };
   ```
3. 診断を、最後まで、行い、結果を表示する。
4. コンソールで、`__ev.filter(e => e[1] === 'diagnosis_result')` を実行する。**1件で、`result_origin: "fresh"`** になっていること。
5. 結果の画面の「もう一度、診断する」から、続けて、もう一度、診断し、結果を表示する。**もう一度、実行して、2件(どちらも `fresh`)** になっていること。(以前は、2回目が、出ませんでした。)
6. 診断コードの値が、含まれていないことも、見る(`JSON.stringify(__ev)` の中に、`code` の文字列が、無いこと)。

### 手順 3：開き直しの確認
1. 手順 2 で表示した結果の、アドレス(`/result#r=…` または、共有の `?dv=…&code=…`)を、新しいタブで開く。
2. ページを開いた直後のイベントは、手順 2 の貼り付けより前に、出てしまうため、コンソールでは見られません。**この確認は、自動試験(§3 の「開き直し」)で、行っています。**

## 7. 本番の後に、確認すること(本番へ出す場合)
| # | 確認 | 方法 |
|---|---|---|
| 1 | `result_origin` を、カスタム ディメンションに、登録する | GA4 管理 → カスタム定義 → カスタム ディメンションを作成(イベント範囲・`result_origin`) |
| 2 | UTM が、流入元として、読まれる | 本番で、`/?utm_source=test&utm_medium=social&utm_campaign=ga4check` を、新しいシークレットウィンドウで、開く → **GA4 の DebugView(またはリアルタイム)で、`session_start`/`page_view` の、ページの場所に UTM が付き、流入元が `test / social` になる**こと |
| 3 | UTM が、読まれない場合 | `campaign_source` などの設定パラメータで、渡す方法に、切り替える(追加の修正) |
| 4 | `source` の疑い | DebugView で、`source` を付けたイベント(マイページの完全解析の操作など)を、送り、セッションの流入元が、変わるかを見る |

## 8. 残存リスク
| 重要度 | リスク |
|---|---|
| **中** | **UTM が、GA4 で、流入元として使われるかは、本番での確認が、必要です。** `page_location` の上書きの値が、流入元の判定に使われることを、明言した公式の文書を、見つけられませんでした。使われない場合は、手順 3 の切り替えが、必要です。 |
| 中 | `source` パラメータの疑い(§5)は、未確認のままです。流入元・セッション数の歪みは、この修正では、直りません。 |
| 低 | 日本語の UTM の値は、捨てられます(英数字の運用が、前提)。文書(`docs/GA4_SETUP.md`)に、書きました。 |
| 低 | 共有の結果のリンク(`?dv=…&code=…`)に、UTM を付けると、X のカードのキャッシュが、URL ごとのため、別の URL として扱われます。共有リンクへの付与は、今回は、提案しません。 |
| 低 | 79件の DB を使う試験は、この環境では、走りません(修正は、DB に触れません)。 |
| 情報 | `diagnosis_result` の過去のデータには、`result_origin` が、ありません。**登録後の分だけ**、分けて見られます。 |

## 9. 次の判断(お待ちします)
1. 本番へ出してよいか(ご承認の後、`main` へのマージと、本番デプロイを、行います)。
2. `source` の改名を、行うか(先に、本番で、DebugView による確認を、お勧めします)。
3. 完了率の計算のための `run_id` など、監査で挙げた、ほかの改善を、次の段階として、進めるか。

**ここで、停止します。本番へのデプロイは、行いません。**
