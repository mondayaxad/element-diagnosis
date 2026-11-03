# 邪眼診断 プレビュー実装の報告（v1.0 RC1・2026-11-02）

ブランチ：`jagan-preview`（`release-c-preview` から分岐）。本番・本番DB・Stripe は変更していない。

## 実装したもの

| 範囲 | ファイル |
|---|---|
| 仕様パッケージ（正本をそのまま保存） | `docs/jagan/spec_v1_0_rc1/` |
| 採点（仕様の runtime.mjs・math.mjs をバイト一致で使用。data.mjs は data/*.json からの生成物） | `jagan/engine/`、`scripts/jagan-data.mjs` |
| TOP・教示・50問・回答確認・結果・保存・画像保存・X共有・レポート案内 | `jagan/index.html`、`jagan/app.mjs`、`jagan/view.mjs`、`jagan/card.mjs`、`jagan/jagan.css` |
| 方法説明・レポートのサンプル（架空の回答例） | `jagan/about.html`、`jagan/sample.html`、`jagan/sample.mjs` |
| 保存 API（認証・登録完了・サーバー再計算・冪等・他人の結果は 409） | `api/jagan-save.mjs` → `lib/jagan-api.mjs` |
| 公開共有の作成・取消、共有ページ（/jagan/s/公開ID）、OGP 画像 | `api/jagan-share.mjs`、`api/jagan-share-page.mjs`、`api/jagan-og.mjs`、`lib/jagan-og-params.mjs` |
| レポート閲覧の権限の土台（販売前は常に 403 sales_closed。販売後も jagan 専用の権利が必要） | `api/jagan-report.mjs` |
| マイページの「邪眼診断の記録」（一覧・開く・削除、未ログイン時の保存待ちの保存） | `js/jagan-mypage.js`、`mypage.html`（3か所の呼び出しと script 1行） |
| DB（Preview 専用・未適用）と戻しの草案 | `docs/sql/20261102120000_jagan_01_results_shares.sql`、`docs/sql/jagan_99_rollback_01_DRAFT_DO_NOT_RUN.sql` |
| 配信の許可リスト・共有ページの rewrite・noindex | `scripts/build-public.js`、`vercel.json` |
| テスト | `tests/jagan.test.mjs`（16件）、`tests/public_build.test.js`（rewrite の期待値を更新） |

## 既存機能への影響

- ETI の採点・設問・保存・購入・共有のコードは変更していない。
- `mypage.html`：記録を描いた後に `JaganMypage.render()` を呼ぶ（失敗しても握りつぶし、ETI の表示は続く）。本番ホスト（appEnv=production）では何もしない。
- `scripts/build-public.js`：①`jagan/` を配信対象に追加、②ブラウザとサーバーで共通の採点モジュール（`jagan/engine/*.mjs`・`jagan/view.mjs`）は API が読み込んでも公開してよいとする例外、③CSS の `url()` 検出で JS の `new URL(変数)` を参照と誤認しないよう、パスらしい値だけを数える。
- 邪眼の API は Production では `JAGAN_PRODUCTION_ENABLED=true` が無い限り 503（本番 DB へ書かない）。

## DB（未適用）

`jagan_results`（本人の保存結果。本人は SELECT・DELETE のみ、書き込みはサーバーだけ）、`jagan_shares`（公開要約だけ。resultId は SHA-256 だけ保存。anon・authenticated は権限なし）、`jagan_entitlements`（購入権限の土台。行は作らない）。ETI の表は触らない。

## 確認したこと

- 仕様の参照テスト15件、架空回答8例の結果・公開要約が、サイトの採点と完全一致。
- 保存・共有 API：未認証 401、登録前 403、不正な回答・版 400、別アカウントの結果 409、再送で重複しない、ブラウザが送った所有者・人物は使われない、共有に回答・12スコア・resultId が入らない、公開IDだけでは取り消せない、取消後の共有ページは 404。
- ブラウザ（Chromium・390px幅）：TOP→50問→確認→結果、連打で2問進まない、リロード後に続きから再開、判断できない（null）の扱い、画像保存（PNG）、共有文の確認ダイアログ。
- 既存テスト一式（tests/*.test.js）。

## 未確認・残っていること

- Preview DB への jagan_01 の適用（未適用。適用すると保存・共有・マイページ表示が実際に動く）。
- このブランチのプレビューには Supabase の環境変数が無い（Preview の Supabase 変数は `release-c-preview` ブランチ限定）。保存・共有を実機で試すには、`release-c-preview` への取り込み、またはこのブランチへの環境変数の追加が必要。
- 実機スマートフォンでの操作、OGP 画像（Edge・Google Fonts の取得）の実測、X のカード表示。
- 設問の理解確認（人の回答）、本番 ETI との回帰の実機確認、販売（Stripe 商品・決済・権利付与）は未実装・未実施。
- 匿名の共有作成に回数制限が無い（ETI の固有リンクと同様の制限を、公開前に追加することを推奨）。
- 共有ページでは GA4 を読み込んでいない（公開ID を送らないため）。

## 2026-11-02 追記：ユーザー指定による画面の変更と、仕様からの差分

- TOP・質問・結果を元素診断と同じ構成にした（質問は5問ずつ・1〜5の丸、結果は土台カード＋アコーデオン→最も近しいファトゥス→渇望する邪眼→保存・共有→今見えているもの→なぜ似ているか→土台ごとの解説と鍵→全てのロックを解除）。
- 型の表示名を変更（再解釈型・秘匿型・衝動型・停滞型・困惑型・自責型）。仕様の data は変えず、`docs/jagan/site_overrides.json` を `scripts/jagan-data.mjs` が適用する。係数・ID・基準は仕様のまま。
- 仕様からの差分（ユーザー指定）：
  - 「判断できない・回答しない」の選択肢を画面から外した。50問すべての回答で結果へ進む（採点・API は null を引き続き受け付ける）。
  - 開始時の教示（最近1か月）・ブロックの区切り・教示の確認を外した。設問の時間枠の理解に影響しうるため、人の理解確認で確かめる。
- 結果画面で無料表示するのは、元素・型・1位の人物と一致度・同率／近接候補・三つの土台ごとの類似度・傾向の言葉。12項目の数値・項目別の振り返りは表示しない（ロック）。

## 2026-11-03 追記：判定モデルを「12特性・異相・人物の固定補正（v0.3）」へ置き換え

ユーザーから `JAGAN_balanced_character_v0_3.zip` を受領。READMEの「旧12軸の欲求モデルと混ぜない」に従い、設問・採点・元素・型・人物を次のとおり全面的に置き換えた。前のモデル（自己決定理論・感情調整ベース。`docs/jagan/spec_v1_0_rc1/`）は履歴とパッケージに残している。

- **データ**：`docs/jagan/spec_v0_3_balanced/`（パッケージを保存）→ `scripts/jagan-data.mjs` → `jagan/engine/data.mjs`。商品（¥1,000・買い切り・販売は閉鎖）は `spec_v1_0_rc1/data/product.json` のまま。
- **判定**：`jagan/engine/judge.mjs` は仕様の `runtime.mjs` と同じ計算（ランダムな回答2,000通りと parity-fixtures 128例で、仕様の runtime と完全一致。仕様の `check.mjs` 18項目も合格）。結果の形・公開要約・共有文は `jagan/engine/runtime.mjs`。
- **表示**：結果は「邪眼元素 × 異相」。型の名前（再解釈型など）は廃止し、異相＝12特性のうち最も高いもの（60点未満は未顕、同点は複合）。最高点が並ぶ元素は未分化。人物は、比較に使える7軸の差が10点未満なら判定を保留（人物を出さず、画像保存・共有も不可）。
- **仕様の要求どおりに明示したこと**：人物は固定補正を含む独自選定であること（結果・方法説明・レポート）。表示する一致度は補正を足す前の値。レポートの人物順位は選定順のため、一致度の大小と一致しないことがある旨を注記。未対応の特性は比較に含めず中立値で補わない旨を注記。
- **サーバー**：保存・共有は50問すべて 1〜5 の整数が必要（欠測なし）。`jagan-result-2`／`jagan-public-summary-2`。DBのSQLは未適用のため、同じファイルを版表記だけ更新した。
- **私が書いた文章（要確認）**：12特性の意味・限界・振り返りの問い、7元素と異相の解説、三つの土台（不安と距離／行動のくせ／他者との向き合い）の名前と導入文、方法説明、人物ごとの「測っていないこと」。参考文献は DSM-5 第III部と Krueger et al. (2012) の2件のみ。特性の領域への対応づけなど、確認できない学術的な主張は書いていない。三つの土台の分け方は私の設計で、仕様にはない。
- **人の確認が必要**：敵意・冷淡・操作などの名前をそのまま特性名として結果に出している（仕様どおり）。受検者への見え方・言い回しは、人に読んでもらって確かめる。
