# GA4 最終修正の報告(本番反映の最終承認のための報告書)

作業日：2026-10-28
ブランチ：`claude/handoff-pjrsoa`
修正コミット：**`07ed5fa`**(Preview の配信内容と一致を確認済み)
状態：**修正・試験・Preview の確認まで完了。`main` へのマージと、本番デプロイは、行っていません。ここで停止します。**

## 1. 約束の確認
| 約束 | 結果 |
|---|---|
| `main` へのマージ・本番デプロイをしない | していません(`main` は `32293ec` のまま) |
| Stripe・Supabase・本番 DB・環境変数を変更しない | 変更していません |
| 診断・保存・購入の既存ロジックを変更しない | 変更していません(変更は、`js/ga.js`、`index.html` の結果表示の計測部分、試験、文書だけ) |
| 既存の修正(`result_origin`・再診断の修正)を維持する | 維持しています。試験も、そのまま通っています |
| 診断コード・認証情報を GA4 へ送らない | 送りません(試験で確認。§3) |
| 案B(`source` → `entry_source`)は、保留 | 実装していません |
| 本番 GA4 へ、テストを送らない(本番反映後に、承認の範囲で実施) | 送っていません |

## 2. 今回の実装(案A)：`js/ga.js`
URL の UTM と同じ値を、GA4 の設定として文書化された `campaign_*` にも、渡します。

| URL の UTM | `config` の項目 |
|---|---|
| `utm_source` | `campaign_source` |
| `utm_medium` | `campaign_medium` |
| `utm_campaign` | `campaign_name` |
| `utm_content` | `campaign_content` |
| `utm_term` | `campaign_term` |

- **URL に存在し、検証を通った値だけ**を反映します。UTM が無い場合は、`campaign_*` を設定しません(`config` は、従来どおり `page_location` と `page_referrer` だけ)。
- 検証の規則は、`page_location` に残す UTM と、同じです。値は、英数字と `. _ ~ -` の64文字まで。メール・UUID・Stripe の ID・URL・診断コードに見える値・日本語・記号・空白は、`page_location` にも `campaign_*` にも入れません。
- 同じ名前が複数ある場合は、最初の値を使います。値の前後の空白は、取り除いてから検証します。
- `?code=`・`?token=`・`?view=` などのほかの問い合わせ文字列と、`#` は、これまでどおり送りません。

実際の `config` の例(UTM 付き・参照元 `t.co`):
```js
{ page_location: 'https://element-diagnosis-five.vercel.app/?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease',
  page_referrer: 'https://t.co/',
  campaign_source: 'ga4check', campaign_medium: 'test', campaign_name: 'prerelease' }
```

### 修正の全体の差分(`main` との比較)
```
 docs/GA4_SETUP.md       |  11 +
 index.html              |  12 +-    (result_origin・再診断。前回の修正)
 js/ga.js                |  46 +++-  (UTM の保持・campaign_*)
 tests/ga4_fixes.test.js | 395 +    (新規・15件)
```

## 3. 検証結果
### 3-1. 新規の試験(`tests/ga4_fixes.test.js`・15件・すべて合格)
| 区分 | 内容 |
|---|---|
| UTM の保持(`page_location`) | 許可した utm_* だけが残る。UTM が無ければ、従来どおり |
| UTM と `campaign_*` の対応 | `utm_source→campaign_source`、`utm_medium→campaign_medium`、`utm_campaign→campaign_name`、`utm_content→campaign_content`、`utm_term→campaign_term`。一部だけでも、あるものだけを反映。`config` のキーは、`page_location`・`page_referrer`・`campaign_*` だけ |
| **UTM なし** | `?` なし・`?foo=1`・`?dv=…&code=…`・空の値・`utm_id`・`utm_source_platform` では、`campaign_*` を設定しない |
| **UTM あり・不正な値** | 65文字・メール・UUID・Stripe の ID・URL・診断コード・`<script>`・空白と改行・日本語・空の値は、捨てる(ほかの正しい UTM は、反映)。`code=`・`token=` は、`dataLayer` のどこにも、入らない |
| 重複・空白 | 同じ名前が複数なら、最初の値。前後の空白は、取り除く |
| 本番以外 | Preview・ローカルでは、何も送らない(既存どおり) |
| **実ブラウザ・本番のドメイン名(UTM あり)** | `dataLayer` の順序が、`js` → `config`(UTM と `campaign_*`)→ イベント。診断コードは、含まれない。参照元 `t.co` が、`page_referrer` に入る。`diagnosis_result` の `result_origin` は、`restored` |
| **実ブラウザ・本番のドメイン名(UTM なし)** | `config` は、`page_location` と、空の `page_referrer` だけ |
| 維持する試験(前回の修正) | `result_origin` の `fresh`/`restored`、同じページでの連続した3回の再診断、開き直し、開き直しの後の再診断、診断コード・秘密値を送らないこと |

- 実ブラウザの試験は、**本番のドメイン名のまま、ローカルのファイルを配信**し、`gtag.js` を空に差し替えています。外部へは、何も送っていません。

### 3-2. 全体の自動試験
- **660件中、581件が合格、失敗は0件、79件がスキップ**(ローカルの検証用 DB が必要な試験。この環境に DB が無いため。前回までと、同じ理由・同じ件数)。
- 前回(654件・575合格)より、新規の6件が、増えています。既存の試験は、すべて、そのまま通っています(`ga4_privacy`・`ga4_measurement` を含む)。
- `node scripts/build-public.js`：OK(前回までと同じ、既知の欠損の警告のみ)。

### 3-3. UTM あり・なしの、計測の確認(まとめ)
| 条件 | `page_location` | `config` の `campaign_*` | 結果 |
|---|---|---|---|
| `?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease` | UTM 付き | `campaign_source`・`campaign_medium`・`campaign_name` | 期待どおり |
| UTM + `?dv=ETI-2.0&code=…` | UTM だけ(`code` は、含まれない) | UTM の分だけ | 期待どおり |
| UTM なし | `origin＋path` だけ | なし | 期待どおり(従来と同じ) |
| 不正な UTM の値 | その値だけ、捨てる | その値だけ、入れない | 期待どおり |

## 4. Preview の確認
| 項目 | 結果 |
|---|---|
| Preview のデプロイ | `dpl_EDM7ehw8T6UQYJASXgP1qHhRNagB`(READY・`target: null` = Preview) |
| デプロイの元のコミット | **`07ed5faed36a830856fad1fb3473da012ac1b65b`**。作業用ブランチの先頭と、**完全に一致** |
| 配信されている `js/ga.js` | 実取得して、**リポジトリの `js/ga.js` と、内容が一致**(`utmValues`・`campaignQuery`・`campaignParams`・`config` への `campaign_*` の追加を、すべて含む) |
| Preview のアドレス | `https://element-diagnosis-g1g4yf0od-nmkw0322-4497s-projects.vercel.app`(固定のブランチのアドレス:`element-diagnosis-git-claude-han-17a004-nmkw0322-4497s-projects.vercel.app`)。Vercel のログインが必要 |
| 画面での確認 | Preview では、`js/ga.js` が、本番のドメインでだけ送る設計のため、**GA4 へは、何も送られません**。送信の中身と順序は、§3 の実ブラウザの試験で確認しています |

## 5. 本番との差異
| 項目 | 本番(現在) | この修正(Preview) |
|---|---|---|
| コミット | `main` = `32293ec`(請求書の停止まで) | `07ed5fa`(`main` + GA4 の修正) |
| UTM | **届かない**(`page_location` から、クエリを全削除) | `page_location` と `campaign_*` の両方で届く |
| `diagnosis_result` | 完了数と、再表示が、区別できない。同じページでの2回目の診断は、欠落 | `result_origin` が付き、完了のたびに記録 |
| ビルドコマンド・Node・配信ヘッダー | `node scripts/build-public.js`・24.x・同じ | 同じ |
| 環境変数 | Production の値。**GA4 関連の変数は、なし**(`GA4_API_SECRET` も、未設定) | 変更なし |
| Preview の環境変数 | — | **ブランチ限定の変数(`release-c-preview` だけ)は、この作業用ブランチには、効かない**。API を使う操作(ログイン・保存・購入)は、この Preview では、本番と同じようには、動かない(今回の修正は、画面側の計測だけで、影響しない) |
| 本番のロールバック先 | `dpl_5sngLmqLbo3T4fDWEa8h9NLKh3HJ`(`main` の `32293ec`) | — |

## 6. 残存リスク
| 重要度 | リスク | 対処 |
|---|---|---|
| **中** | **GA4 が、`campaign_*` と `page_location` の UTM を、実際に流入元として使うかは、本番での確認が、まだ、できていません。** 文書化された項目を使う案A で、不確かさは、小さくなりましたが、実測は、本番反映後です | 本番反映後の、承認済みの確認(§7)。流入元が `ga4check / test` に、ならなければ、追加の調査を、行う |
| 中 | **Google の公式ドメインは、この環境から、まだ、読めません**(`developers.google.com`・`support.google.com`)。承認をいただきましたが、ネットワークの設定の変更は、私にはできず、公式ページの原文での確認は、できていません。公式の文言は、検索結果の抜粋と、第三者の解説の範囲です | 環境のネットワークの設定(クラウド環境のメニュー → 編集 → ネットワークアクセス)で、この2つを「許可するドメイン」に加えていただければ、原文で、再確認します。手順：https://code.claude.com/docs/en/cloud-environments#network-access |
| 中 | `source` パラメータの影響(§3 の確認)は、未確認です。案B は、保留のままです | 既存の GA4 のデータで、送信なしに、確認できます(`GA4_PRE_RELEASE_REVIEW.md` §3) |
| 低 | **DebugView は、デバッグのモードが、有効な時だけ、表示されます。** `js/ga.js` は、`debug_mode` を設定していません。シークレットウィンドウだけでは、DebugView に出ない場合があります | Chrome の「Google Analytics Debugger」拡張機能を有効にする、または、**リアルタイムのレポート**で確認する(§7) |
| 低 | **集客のレポートの反映は、通常、数時間〜24時間以上、遅れます。** 本番反映の直後に、集客レポートで、`ga4check` が、見えない場合があります | まず、リアルタイムのレポートで、確認する。集客レポートは、翌日以降に、再確認する |
| 低 | GA4 の UTM は、**大文字と小文字を、区別します**。運用では、小文字に、統一してください(この修正は、値を、変換しません) | 運用の約束事として、周知 |
| 低 | 日本語の UTM の値は、捨てられます(英数字の運用が前提)。`docs/GA4_SETUP.md` に、書きました | — |
| 低 | `result_origin` は、GA4 の管理で、カスタム ディメンション(イベント範囲)を、登録するまでは、レポートで、分けて見られません | 運営者の作業(`docs/GA4_SETUP.md` §1) |
| 情報 | 共有された結果のリンク(`?dv=…&code=…`)を、他の人が開くと、`diagnosis_result` は、`restored` として出ます。完了数は、`quiz_complete` を使ってください | — |
| 情報 | 79件の DB を使う試験は、この環境では、走りません(今回の修正は、DB に触れません) | — |

## 7. 本番反映の後の確認(ご予定の検証)
ご指定の、シークレットウィンドウでの確認です。購入・保存・決済は、行いません。

1. 本番に反映された後に、新しいシークレットウィンドウで、次を、開く。
   `https://element-diagnosis-five.vercel.app/?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease`
2. **リアルタイムのレポート**(推奨・すぐ反映)で、「トラフィック ソース」の、`ga4check / test`、キャンペーン `prerelease` を確認する。
3. **DebugView** を使う場合は、デバッグのモードを、有効にする(上記のリスクの表)。`page_view` / `session_start` の、`page_location`(UTM 付き)と、`campaign_source` などを確認する。
4. 診断を、最後まで行い(購入・保存は、しない)、`diagnosis_result` の `result_origin` が、`fresh` であることを、確認する。
5. 翌日以降に、**集客のレポート**で、`ga4check / test` を確認する。
6. 確認の後に、テストのデータは、`utm_campaign=prerelease` で、識別できます。

## 8. ご判断をお願いします(本番反映の最終承認)
- **推奨：本番反映に、進んでよい状態です。** 理由：試験は、すべて通り(660件中581合格・失敗0・スキップ79)、Preview の配信内容は、修正コミットと、一致しています。UTM の効果は、本番の実測で、確認する計画です。
- 反映の手順(ご承認の後):①作業用ブランチを、`main` へマージ → ②本番へデプロイ(前回と同じ手順) → ③本番の `js/ga.js` の内容の確認 → ④§7 の確認。
- 問題が出た場合のロールバック先：`dpl_5sngLmqLbo3T4fDWEa8h9NLKh3HJ`(現在の本番)。

**ここで、停止します。本番反映の最終承認を、お待ちします。**
