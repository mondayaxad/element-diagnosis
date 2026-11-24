# 全テスト品質正常化：調査報告（スキップ91件・失敗1件）

- 調査日：2026-11-24
- 対象：ブランチ `seo-content-optimization`（PR #38）の全テスト `node --test tests/*.test.js` の結果
  - 801件中、pass 709・fail 1・skipped 91・cancelled 0。
- **調査のみ。リポジトリ・本番・DB への変更はしていない。**
  - 失敗の原因を調べるため、計測を足したテストのコピーを一時的に実行した。調査後に削除し、作業ツリーには何も残っていない。
  - PostgreSQL 17 のバイナリ（npm の embedded-postgres）を取得して起動しようとしたが、自動モードの安全確認で止められた。そのため、DB テストの実行は承認後の作業として計画している（第4章）。

## 1. 結論（要約）

| 区分 | 件数 | 直接の原因 | 本当の原因 |
|---|---|---|---|
| DB（`COMPLETE_DB_BACKEND`） | 87 | 環境変数 `COMPLETE_DB_BACKEND` が無い | **実 DB 用のバックエンド `tests/pg/backend.js` が main に無い**。2026-10-30 の未マージのブランチ `perf-checkout-mypage` にだけある。CI も無い。そのため、このプロジェクトで **一度も定常的に実行されていない** |
| DB（psql） | 1 | `PGT_HOST`・`PQ` が無い | `npm test` では実行されない。`npm run test:pg`（`tests/pg/run_all.sh`）なら実行されるが、PG17 が必要で、CI も無い |
| PDF | 2 | `PDF_LIBS_DIR` が無い | テストが、cdnjs と同じ版のライブラリ本体を手元に置く前提になっている。npm に同一のファイルがある（SRI 一致を確認済み） |
| その他（OGP 画像） | 1 | `@vercel/og` が無い | `package.json` の依存だが、テストの実行前に `npm install` していない。`package-lock.json` も無いため、版が固定されない |
| 失敗 | 1 | 保存カードが700ms以内に画面に入らない | **実際の UI の不具合**（第3章）。テストの仕様は正しい |

**追加費用はすべて0円。**
- リポジトリは公開なので、GitHub Actions の標準ランナーとサービスコンテナは無料。
- PostgreSQL・html2canvas・jsPDF・embedded-postgres はオープンソース。

**総件数（801件）は変わらない見込み。** スキップを実行に変えるだけで、テストの追加・削除はしない（バックエンドの取り込みで件数が変わる場合は、その時に報告する）。

---

## 2. スキップ91件の内訳（ファイル別）

| 対象ファイル | 件数 | 何を保証するテストか | 実行に必要な環境 | 実行可能にする方法 | 未検証のまま残すリスク |
|---|---|---|---|---|---|
| `complete_guest_api.test.js` | 10 | ゲスト購入 API（complete_01〜07）：Checkout の作成・購入完了・引き継ぎ・Cookie 復旧・秘密値の非露出 | PostgreSQL 17（使い捨て）＋ tests/pg/backend.js（未マージのブランチ perf-checkout-mypage にだけある）を COMPLETE_DB_BACKEND に指定 | tests/pg/backend.js と pg_env・postgrest_mock の差分を main に取り込む → PG17 を起動して COMPLETE_DB_BACKEND を指定 | 高：課金・権利・返金・二重販売を守る SQL 関数を、実 DB で検証していない（メモリの模型の試験は一部だけ） |
| `complete_report_job.test.js` | 3 | 完全解析の生成ジョブ（C6）：再試行・作り直しの回数・権限 | PostgreSQL 17（使い捨て）＋ tests/pg/backend.js（未マージのブランチ perf-checkout-mypage にだけある）を COMPLETE_DB_BACKEND に指定 | tests/pg/backend.js と pg_env・postgrest_mock の差分を main に取り込む → PG17 を起動して COMPLETE_DB_BACKEND を指定 | 高：課金・権利・返金・二重販売を守る SQL 関数を、実 DB で検証していない（メモリの模型の試験は一部だけ） |
| `consent_pairs_db.test.js` | 1 | 同意の組（complete_16）：規約・プライバシーポリシーの版と日時の制約（DB の CHECK） | PostgreSQL 17 と psql（npm run test:pg＝tests/pg/run_all.sh では実行される。npm test では PGT_HOST・PQ が無いのでスキップ） | PG17 を起動し、run_all.sh と同じく PGT_HOST・PQ・PGT_TEMPLATE を指定 | 中：同意の記録の DB 制約が、変更で壊れても気づけない |
| `link_purchase_api.test.js` | 26 | 固有リンク購入（complete_01〜13）：¥1,000／¥3,000・決済画面の期限（24時間）・キャンセル後の再購入・PayPay・閲覧の停止・マイページへの登録 | PostgreSQL 17（使い捨て）＋ tests/pg/backend.js（未マージのブランチ perf-checkout-mypage にだけある）を COMPLETE_DB_BACKEND に指定 | tests/pg/backend.js と pg_env・postgrest_mock の差分を main に取り込む → PG17 を起動して COMPLETE_DB_BACKEND を指定 | 高：課金・権利・返金・二重販売を守る SQL 関数を、実 DB で検証していない（メモリの模型の試験は一部だけ） |
| `no_upgrade_price_env.test.js` | 4 | 価格の環境変数（UPGRADE なし）でも、¥1,000・¥3,000 の Checkout が作れる／廃止経路は 410 | PostgreSQL 17（使い捨て）＋ tests/pg/backend.js（未マージのブランチ perf-checkout-mypage にだけある）を COMPLETE_DB_BACKEND に指定 | tests/pg/backend.js と pg_env・postgrest_mock の差分を main に取り込む → PG17 を起動して COMPLETE_DB_BACKEND を指定 | 高：課金・権利・返金・二重販売を守る SQL 関数を、実 DB で検証していない（メモリの模型の試験は一部だけ） |
| `og_image.test.js` | 1 | 共有カード画像の画素比較：事前生成の下地＋重ね描き と 1枚描き が同じ見た目（PSNR 40dB 以上）で、CPU が半分以下 | @vercel/og（package.json の依存。npm install で入る） | npm install（できれば package-lock.json を追加して版を固定） | 低：共有カードの見た目の劣化・CPU の増加に気づけない（本番の画像生成は動いている） |
| `purchase_integrity_api.test.js` | 44 | 購入の整合性（complete_01〜08）：権利の付与と返金・異議申し立て・並行処理（デッドロックなし）・二重販売の防止・固有リンク・Cookie の上限 | PostgreSQL 17（使い捨て）＋ tests/pg/backend.js（未マージのブランチ perf-checkout-mypage にだけある）を COMPLETE_DB_BACKEND に指定 | tests/pg/backend.js と pg_env・postgrest_mock の差分を main に取り込む → PG17 を起動して COMPLETE_DB_BACKEND を指定 | 高：課金・権利・返金・二重販売を守る SQL 関数を、実 DB で検証していない（メモリの模型の試験は一部だけ） |
| `report_purchase_ui.test.js` | 2 | 有料の解析レポート／サンプルの「PDF で保存」が、申込・登録の欄があっても失敗せず、警告を出さない | html2canvas 1.4.1・jsPDF 2.5.1 の本体（cdnjs と同じファイル。PDF_LIBS_DIR）＋ Playwright | npm の html2canvas@1.4.1・jspdf@2.5.1 の dist を使う（SRI が cdnjs と一致を確認済み） | 中：有料レポートの「PDF で保存」が壊れても気づけない |

**本番サービスへの影響（いまの時点）**
- スキップは「検証が抜けている」状態で、本番の動作そのものを変えるものではない。
- ただし DB の87件は、購入・権利・返金・二重販売の防止という**お金と権利に直結する SQL 関数**を、実 DB で検証していない。今後、マイグレーションや API を変えた時に壊れても、気づけない。
- 一部（`complete_payment_api` の36件、`complete_report_job` の19件）は、メモリの模型で常に実行されている。ただ、模型は SQL の制約・ロック・並行処理を再現しないため、代わりにはならない。

### 2-1. 91件の全件一覧

| # | 対象ファイル | テスト名 | 区分 | スキップ理由 |
|---|---|---|---|---|
| 1 | `complete_guest_api.test.js` | 販売停止・入力の検査：sales_closed／余分な項目・不正なコード・目標の不足は拒否（DB・Stripe に触れない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 2 | `complete_guest_api.test.js` | ゲスト ¥1,000：サーバーが記録を作り、Checkout は metadata 3つ・client_reference_id／メールなし・Cookie は HttpOnly／Secure／SameSite=Lax | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 3 | `complete_guest_api.test.js` | 購入完了ページ：Webhook より先でも Stripe に問い合わせて付与・解析レポートをすぐ読める・Webhook の再送で増えない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 4 | `complete_guest_api.test.js` | 旧ゲスト経路の追加 ¥2,000 は廃止（complete_13）：DB が注文を作らない。既存の ¥1,000 の購入はそのまま読める・別の結果の ¥3,000 は別の記録 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 5 | `complete_guest_api.test.js` | ゲストの ¥2,000 は、この端末で解析レポートの購入を確かめられる時だけ。別の offer に切り替えると前の Stripe 画面を閉じる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 6 | `complete_guest_api.test.js` | 引き継ぎ：ログイン必須・購入時メールと同じ確認済みメールだけ・支払済みだけ・1回限り（同じ人は冪等・別の人は 409）・改ざん／期限切れは拒否 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 7 | `complete_guest_api.test.js` | Cookie を失った時の復旧：ログイン中の確認済みメール（6桁コード・Google 等。時間が経っても）＋購入時メールの一致で引き継ぐ。未確認のメール・メールなし・別のメールでは移さない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 8 | `complete_guest_api.test.js` | 引き継ぎ（Cookie の秘密値・購入時メールの照合で所有者を移す）は廃止（complete_13）：公開の処理は 410 transfer_retired・記録の所有者は変わらない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 9 | `complete_guest_api.test.js` | 支払い後の一時的な失敗：DB の失敗は付与せず、次の確認（再処理）で回復する | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 10 | `complete_guest_api.test.js` | 応答・ログに秘密値・注文 ID・Session ID・メール・診断コードを出さない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip |
| 11 | `complete_report_job.test.js` | C6：自動の再試行を使い切った失敗は「作成できませんでした」＋作り直し。同じ注文・目標で1つだけ再生成し、新しい注文・権利・請求は作らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 12 | `complete_report_job.test.js` | C6：作り直しは2回まで。その後と、作り直しても直らない失敗（入力の不一致）はお問い合わせ（409）。運営者は原因を直してから作り直せる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 13 | `complete_report_job.test.js` | C6：作り直しは本人だけ・権利がある間だけ。他人の記録は 404、返金後は 403。生成中・再試行待ちは何もしない（202 のまま1つ） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 14 | `consent_pairs_db.test.js` | complete_16 の同意の組 | DB(psql) | PGT_HOST と PQ（PG17 の psql）が無いため skip |
| 15 | `link_purchase_api.test.js` | A ¥1,000：診断結果の記録で購入→支払い→購入完了ページで固有リンク→開くと解析レポートだけ（完全解析は開けない）。秘密値は DB にハッシュだけ | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 16 | `link_purchase_api.test.js` | 購入完了ページへ戻った時（cs=今の決済）：今の購入だけ current とリンク（支払いの確認の前でも）。途中でやめた決済にはリンクを出さない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 17 | `link_purchase_api.test.js` | 決済画面の作りすぎを防ぐ：同じ診断記録で1時間に20件まで。21件目は 429（Stripe を呼ばない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 18 | `link_purchase_api.test.js` | 他のサイトからの送信（フォームの POST・別の Origin・cross-site）は断り、この端末の購入の控え（Cookie）を書き換えない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 19 | `link_purchase_api.test.js` | B ¥3,000：MENTOR 目標が必須・注文に固定。支払い→生成→固有リンクで完全解析だけ（解析レポートは開けない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 20 | `link_purchase_api.test.js` | ¥2,000 は UI・API・DB で新しく作れない（既存の行は残す） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 21 | `link_purchase_api.test.js` | 再購入：同じ記録・同じ商品でも新しい購入操作なら別の注文・別の固有リンク。A と B は別々に買える | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 22 | `link_purchase_api.test.js` | Checkout の技術的な二重処理：同じ購入操作の再送・連打は1件。古い決済画面は新しい購入を妨げず、後から払っても別の注文として納品 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 23 | `link_purchase_api.test.js` | キャンセル（期限切れ）の直後に買い直せる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 24 | `link_purchase_api.test.js` | 決済画面の期限：注文の作成から約24時間（Stripe の上限 24 時間の内側）。同じ注文の再送は同じ画面 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 25 | `link_purchase_api.test.js` | 24時間の間の遅い支払い：期限内なら（作成から20時間後でも）支払いが反映され、固有リンクが有効になる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 26 | `link_purchase_api.test.js` | ケースA 途中でキャンセル→再購入：新しい注文・新しい決済画面へ進める。古い未払いの画面は閉じる（24時間の間に二重に払われない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 27 | `link_purchase_api.test.js` | 遅延：古い画面を閉じる処理は応答を待たせない（応答の時点では未完了・応答の後に閉じる） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 28 | `link_purchase_api.test.js` | ケースA 補足：別の商品・支払い済みの画面は閉じない。閉じる処理が失敗しても購入は進む | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 29 | `link_purchase_api.test.js` | ケースC 完全解析：キャンセル後の再購入で MENTOR の目標が混ざらない（各注文が自分の目標を持つ）。期限切れの後も買い直せる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 30 | `link_purchase_api.test.js` | PayPay：決済画面の支払い方法はカードと PayPay。金額・商品・期限・metadata は従来どおり。支払うと反映される | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 31 | `link_purchase_api.test.js` | PayPay：Stripe が PayPay 付きの作成を拒んだ時は、カードだけで作り直す（購入できなくならない）。注文は失敗にならない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 32 | `link_purchase_api.test.js` | PayPay：一時的な Stripe の失敗では、カードだけに切り替えない（注文は残り、次の要求で同じ決済画面） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 33 | `link_purchase_api.test.js` | PayPay：支払いの確定が後から届く場合（checkout.session.async_payment_succeeded）も、同じ処理で支払い済みになる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 34 | `link_purchase_api.test.js` | 固有リンク：未払いでは開けない（支払い待ち）。返金・異議申し立て・運営者の停止で開けない。再発行すると古いリンクは無効 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 35 | `link_purchase_api.test.js` | マイページへの登録：ログイン必須・同じアカウントは1件・別のアカウントにも登録できる・元の登録は消えない・記録の持ち主は変わらない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 36 | `link_purchase_api.test.js` | 同じ 100 問の回答の別人（別の記録）：記録 A の購入は記録 B に伝わらない。購入対象トークンは記録ごと | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 37 | `link_purchase_api.test.js` | 購入対象トークン：改ざん・期限切れは使えない。マイページの記録は本人の記録（または登録した記録）だけ | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 38 | `link_purchase_api.test.js` | 応答・ログ：固有リンクの秘密値は購入完了ページ（Cookie の持ち主）の応答だけ。注文 ID・Stripe ID・メール・診断コードを出さない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 39 | `link_purchase_api.test.js` | 価格の確認：確認できた価格は覚える（2 回目の購入で Stripe の prices を呼ばない）。商品が違えば別に確認する | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 40 | `link_purchase_api.test.js` | 価格の確認：問題のある価格（金額違い）は覚えず、毎回止める。決済画面は作らず、注文は閉じる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 41 | `no_upgrade_price_env.test.js` | UPGRADE なし：解析レポート ¥1,000 の Checkout が作れる（¥1,000 の Price・解析レポートだけ） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 42 | `no_upgrade_price_env.test.js` | UPGRADE なし：完全解析 ¥3,000 の Checkout が作れる（¥3,000 の Price・目標が必須） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 43 | `no_upgrade_price_env.test.js` | UPGRADE なし：upgrade・analysis_upgrade は従来どおり offer_retired（400）で、決済画面も注文も作らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 44 | `no_upgrade_price_env.test.js` | UPGRADE なし：旧ゲスト経路・旧引き継ぎ・マイページの旧 Checkout は 410 のまま（設定不足の 503 にならない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip |
| 45 | `og_image.test.js` | 画素比較：下地＋overlay と従来の1枚描きがほぼ同じ（PSNR 40dB 以上）・CPU が 1/2 以下 | その他 | @vercel/og が無いため skip |
| 46 | `purchase_integrity_api.test.js` | ログイン状態の ¥1,000：Checkout ¥1,000 → 支払い確定で解析権。マイページは ¥2,000 の案内・解析レポートを読める | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 47 | `purchase_integrity_api.test.js` | 解析権が一時停止中（dispute 中）は ¥3,000・¥2,000 を作らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 48 | `purchase_integrity_api.test.js` | 同じ診断コードでも別の本人には権利を共有しない（¥1,000 を別に買える・解析レポートは読めない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 49 | `purchase_integrity_api.test.js` | C3（ゲスト）：Stripe で戻った・閉じた決済はすぐ買い直せる。支払いと重なった時は二重に請求しない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 50 | `purchase_integrity_api.test.js` | C3（ログイン）：マイページへ戻った（中止）・「決済をやり直す」で決済待ちを片付け、すぐ買い直せる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 51 | `purchase_integrity_api.test.js` | C5：戻って MENTOR 目標を変えたら古い画面を使わず、新しい目標で決済。支払い後に固定される目標は支払った注文の目標 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 52 | `purchase_integrity_api.test.js` | D2・D3：Google 等でも同じ確認済みメールなら引き継げる。共有端末で別のメールの人へは移らない。Cookie 消失は OTP で復旧（決済待ちがあっても） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 53 | `purchase_integrity_api.test.js` | ¥1,000 の返金：解析権は revoked。発行済みの閲覧リンク（期限内）も、新しいリンクも開けない。応答は private, no-store | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 54 | `purchase_integrity_api.test.js` | ¥3,000 の返金：解析・完全解析とも revoked。両方の閲覧が、発行済みのリンクでも不可 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 55 | `purchase_integrity_api.test.js` | ゲストの返金：Cookie の端末の閲覧リンク（発行済み）も開けない。引き継ぎ後はゲストのリンクを使えない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 56 | `purchase_integrity_api.test.js` | 未払いの Webhook（checkout.session.completed・payment_status=unpaid）：権利・生成物を作らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 57 | `purchase_integrity_api.test.js` | 閲覧リンクの流用：別の本人・別の記録・別の診断結果・不明な種類・sid の無い再発行トークンは開けない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 58 | `purchase_integrity_api.test.js` | 旧 ¥1,000：運営者が停止すると旧形式リンク・マイページ（本人に結び付け済み）とも閲覧不可、復帰で戻る。取消は最終。API のロールは操作できない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 59 | `purchase_integrity_api.test.js` | C6（ゲスト）：最終の失敗は「作成できませんでした」。この端末（Cookie）からだけ同じ注文で作り直せる。引き継ぎ後はマイページで | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 60 | `purchase_integrity_api.test.js` | 並行：引き継ぎと支払いの確定（Webhook の再送）が重なっても、デッドロックせず1つの状態に揃う | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 61 | `purchase_integrity_api.test.js` | 並行：同じ診断結果の2つの記録で、支払いの確定と別の記録の注文の作成が重なっても、デッドロックせず二重に買えない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 62 | `purchase_integrity_api.test.js` | 並行（決定的）：記録のロックを持つ処理（引き継ぎ・注文の作成）が注文の行を取る時、支払いの確定は記録のロックを先に待つ（デッドロックしない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 63 | `purchase_integrity_api.test.js` | 固有リンク：診断完了で発行（256bit・DB はハッシュだけ）→ 同じ診断結果を復元。不正・失効・削除済みは 404（情報を出さない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 64 | `purchase_integrity_api.test.js` | 固有リンク：引き継いだ後も同じ記録（重複しない）・無料結果は開ける・ゲストとしての購入は断る。返金後は有料部分を開けない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 65 | `purchase_integrity_api.test.js` | 固有リンクの整理（運営者）：期限切れのリンクと、購入の無い古いゲストの記録だけを消す。購入のある記録は残す。API のロールは実行できない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 66 | `purchase_integrity_api.test.js` | 固有リンクの大量作成の防止：同じ秘密値は冪等（連打・再送で記録もリンクも増えない）・入力の制限・接続元ごとに 10 分 10 件で 429・IP は保存もログもしない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 67 | `purchase_integrity_api.test.js` | ログインなしの購入は買えることを優先：別のブラウザで購入済みの診断結果も新しい記録で買える・別のタブで放置された決済は閉じて作り直す | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 68 | `purchase_integrity_api.test.js` | 違う診断結果なら買える：ログイン中（マイページ）は前の結果の購入に関係なく ¥1,000・¥3,000 を作れる。同じ診断結果は重ねて売らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 69 | `purchase_integrity_api.test.js` | 同じ診断結果のログイン中の別ユーザー A・B：A の ¥3,000 は B に付かない。B は ¥1,000・¥3,000 を買える。A は重ねて買えない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 70 | `purchase_integrity_api.test.js` | 同じ診断結果の別の人が同時に決済を始める（ログイン中 A・B、ゲスト C・D）：互いに止めず、別の注文・別の記録 | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 71 | `purchase_integrity_api.test.js` | 総当たり：ログイン中に結果ページから買う（ゲストの決済）：決済画面のメールはアカウントの確認済みメール → マイページで引き継げる。ログインを確かめられなくても売る | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 72 | `purchase_integrity_api.test.js` | 監査：共有された結果リンクで、別の人が決済を放置・支払っても、持ち主の購入を見せない・使わせない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 73 | `purchase_integrity_api.test.js` | 監査：ログイン中に結果ページから買う：アカウントで同じ結果を購入済み・決済中なら、ゲストとして重ねて売らない（マイページへ） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 74 | `purchase_integrity_api.test.js` | 監査：Cookie の上限を超えても、支払い済みの購入をこの端末から失わない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 75 | `purchase_integrity_api.test.js` | 監査：この端末で引き継いだ結果を、ログアウトした状態で開いた：ゲストとして売り直さない（マイページで開く） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 76 | `purchase_integrity_api.test.js` | 監査：反映しなかった注文（中止後の遅れた支払い）への異議申し立ては、記録だけ残して Webhook を失敗させない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 77 | `purchase_integrity_api.test.js` | 再監査：ログイン中の返金の後、目標を選び直して ¥3,000・¥2,000 を買い直せる | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 78 | `purchase_integrity_api.test.js` | 再監査：持ち主でない端末（他人の記録に未払いの注文だけを持つ）は、完全解析を開けない・作り直せない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 79 | `purchase_integrity_api.test.js` | 再監査：解析レポートの支払いで異議申し立てに負けた記録では、¥3,000 も売らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 80 | `purchase_integrity_api.test.js` | 再々監査：申込の切り替え（¥1,000 → ¥3,000 → ¥1,000）の後に支払い・返金しても、同じ記録でもう一度買える（前の注文の鍵と重ならない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 81 | `purchase_integrity_api.test.js` | 再々監査：Cookie の上限を超えた時、決済中の注文の印より先に、閉じた未払いの注文の印を外す | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 82 | `purchase_integrity_api.test.js` | 1つだけ：ゲストで ¥1,000 の画面を開いたまま ¥3,000 を選ぶ → ¥1,000 の画面は Stripe で閉じ、¥3,000 を買える。逆も同じ | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 83 | `purchase_integrity_api.test.js` | 1つだけ：ログイン中（マイページ）の ¥3,000 の画面を開いたまま、結果ページで ¥1,000 を選ぶ → マイページの画面を閉じて ¥1,000 を買える | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 84 | `purchase_integrity_api.test.js` | 決済画面の期限：注文の作成から約24時間（Stripe の上限 24 時間から5分の余裕）。同じ注文の再試行は同じ画面を受け取る | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 85 | `purchase_integrity_api.test.js` | ログイン中：作ったまま 4 分を過ぎた注文（画面を渡せなかった）は片付けて、新しい注文で決済画面を作る | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 86 | `purchase_integrity_api.test.js` | 引き継ぎの間に別のタブでマイページの決済画面を開いた：引き継いだ後にその画面を閉じる（持っている物を払わせない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 87 | `purchase_integrity_api.test.js` | ログイン中：別の端末・消えた Cookie でも、このアカウントのメールで払った未引き継ぎの購入がある結果は重ねて売らない | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 88 | `purchase_integrity_api.test.js` | ログイン中：異議申し立てで負けた ¥1,000 の記録は ¥3,000 を出さない（押しても進めないボタンを出さない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 89 | `purchase_integrity_api.test.js` | Cookie の上限：引き継ぎ済みの記録の印は、決済中の注文の印より後まで残す（ログアウト中に引き継ぎ済みの結果を売り直さない） | DB | COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip |
| 90 | `report_purchase_ui.test.js` | 解析レポート：PDF を保存できる（申込・登録の欄があっても失敗しない）。警告ダイアログを出さない | PDF | PDF_LIBS_DIR が無いため skip |
| 91 | `report_purchase_ui.test.js` | 解析レポートのサンプル：PDF を保存できる（申込の欄・完全解析のボタンがあっても失敗しない） | PDF | PDF_LIBS_DIR が無いため skip |

---

## 3. 既知の失敗1件：`save_cta_placement_ui`「Google・X の認証から戻ったマイページ…」

**テストが保証していること（サービスの仕様）**
- Google・X の認証から結果ページに戻った人に、保存カードを画面内に出し、「✓ 診断記録に保存しました」を見せる。
- そのあとで、マイページへ移す（テストのコメント「移る前に『保存しました』を見せる」）。

**計測の結果（一時的な計測を足して実行。iPhone 相当 390×844）**

| 経過 | 保存カードの上端 | スクロール量 | 状態 | URL |
|---|---|---|---|---|
| 0ms | 11,384px | 3 | just_saved | `/` |
| 210ms | 10,359px | 1,028 | just_saved | `/` |
| 520ms | 3,509px | 7,878 | just_saved | `/` |
| 728ms | 1,864px | 9,523 | just_saved | `/` |
| 834ms | — | 0 | — | `/mypage.html`（移動済み） |

**根本原因：実際の UI の不具合（3つの要因が重なっている）**
1. **ページ構造の変化**：結果ページの購入導線の並べ替え（A案など）で、保存カードがページ上端から約11,400px（スマホで約13画面分）下の位置になった。
2. **スクロールの方法**：CSS の `html { scroll-behavior: smooth; }`（index.html 66行目）により、保存カードへの `scrollIntoView({ block: 'center' })`（3211行目）が滑らかなアニメーションになり、11,000px を動くのに800msより長くかかる。
3. **移動のタイミング**：`goMypageAfterReturn`（3222行目〜。移動は3237行目の setTimeout 800ms）が、カードが画面に入ったかどうかに関係なく、800ms 後にマイページへ移る。

その結果、利用者は「保存しました」を一度も見ないまま、ページが下へ流れ、途中でマイページへ切り替わる。**テストはこの不具合を正しく検出している。**

**切り分け**

| 観点 | 判定 |
|---|---|
| 実際の UI の不具合 | **該当**（保存の完了を見せずに移動する） |
| 非同期処理の競合 | 一部該当：スクロールのアニメーションと800ms のタイマーが競合している |
| スクロール処理の不具合 | **該当**：長い距離を smooth でスクロールしている |
| ページ構造の変更による影響 | **該当**：カードが約11,400px 下にある |
| テストの仕様が古い | 該当しない（仕様は現行のコードのコメントと一致） |
| 実行環境の不安定さ | 該当しない（毎回同じ値で再現。main の 193ca73・31d22de でも同じく失敗） |

**修正方針（案）**
- 認証から戻った時のスクロールは、ページを開いた直後の位置合わせなので、`scrollIntoView({ block: 'center', behavior: 'instant' })` で瞬時に合わせる（それ以外の場所の smooth スクロールは変えない）。
- マイページへの移動は、保存カードが実際に画面に入ってから800ms後に行う（IntersectionObserver で確かめる。念のため上限を設ける）。
- テストのタイムアウト（700ms）や判定は変えない。
- 工数：1〜2時間（修正・この試験と関連試験・実機に近い幅での確認を含む）。

---

## 4. 検証環境の構築案

### 4-1. PostgreSQL 17

| 案 | 中身 | 長所 | 短所 | 費用 |
|---|---|---|---|---|
| **A. GitHub Actions のサービスコンテナ（推奨・正）** | `services: postgres:17` を立て、`E2E_PG_EXTERNAL=1` で `tests/pg/run_all.sh` と DB の87件を実行する | 毎回まっさらで、隔離されている。本番の接続情報を持たない。誰でも同じ結果になる | 結果が出るまで push が必要 | 0円（公開リポジトリ） |
| **B. このセッションで一時的に（npm の embedded-postgres 17.12）** | `@embedded-postgres/linux-x64@17.12.0-beta.19` の initdb・pg_ctl・postgres を一時ディレクトリで、unix ソケットだけで起動する（既存の `tests/pg/local_pg.sh` が対応済み）。psql は手元の 16 を使う | push 前に手元で確かめられる | **ダウンロードしたバイナリを実行するため、許可が必要**（今回は自動モードで止められた） | 0円 |
| C. Docker | `postgres:17` のコンテナ | — | この環境には Docker のデーモンが無い | — |
| D. apt（PGDG） | `postgresql-17` | — | apt.postgresql.org にこの環境から接続できない（Ubuntu の標準は 16） | — |

**安全装置は既存のものを使う**（`tests/pg/pg_env.js`）：
- 接続先は unix ソケットか localhost だけ。Supabase のホストや本番の秘密の環境変数があれば、起動を拒否する。
- データベース名は `e2e_` で始まる名前に限る。
- 入れるのは合成データだけ。**本番 DB には接続も書き込みもしない。**

### 4-2. DB の87件を動かすための取り込み（別 PR）
- `perf-checkout-mypage` から、テスト基盤の部分だけを取り込む。対象は `tests/pg/backend.js`（新規）と、`pg_env.js`・`postgrest_mock.js`・`db_setup.js`・`run_all.sh` の差分。
- 同じブランチにあるアプリの変更（`api/my-entitlements.js` など）は取り込まない。
- 取り込みの後、main の現行の SQL（complete_01〜16・prod_01〜03）で87件を実行する。差が出たテストは、「模型の癖に依存したテスト側の問題」か「SQL・API の不具合」かを1件ずつ切り分ける。
  - テストの基準は緩めない。不具合なら直す。
- 参考：このセッションの前半（2026-10-30 ごろ）に、同じ仕組みで `link_purchase_api` 系を実 PG17 で通した実績がある。ただし、その後に PayPay・24時間期限などが加わったため、現在の通過状況は実行してみないと分からない。

### 4-3. PDF の2件
- npm の `html2canvas@1.4.1`・`jspdf@2.5.1` の dist を使う。cdnjs（`report.html` の SRI）と **sha512 が完全に一致**することを確認済み。
- CI では npm から取得し、SRI の値を照合してから `PDF_LIBS_DIR` に置く。リポジトリに同梱する場合は、MIT ライセンスの表記を添える。

### 4-4. OGP 画像の1件
- CI では `npm install` で `@vercel/og` を入れる。
- 依存の版がずれないよう、**`package-lock.json` の追加**を提案する。Vercel のビルドの挙動に関わるため、別途承認が必要。

---

## 5. 継続的な品質保証（CI の構成案）

| ワークフロー | 対象 | 実行のきっかけ | 判定 |
|---|---|---|---|
| `seo.yml`（PR #38 の既存） | SEO の6ファイル（65件） | PR・main への push | 失敗・スキップは1件でも赤 |
| **`quality.yml`（新規）** | 全テスト（801件）＋ `tests/pg/*.pg.test.js` | PR・main への push（時間がかかるので、`paths` の絞り込みは使わない） | 失敗・スキップ・キャンセルは1件でも赤 |

`quality.yml` の中身（案）：
- `services: postgres:17`（ユーザー・パスワードはワークフローに書くダミー値。シークレットは使わない）。
- Node 22、`npm install`（lock があれば `npm ci`）、`playwright install --with-deps chromium`。
- PDF のライブラリを取得し、SRI を照合する。
- `tests/pg/run_all.sh`（`E2E_PG_EXTERNAL=1`）と、`COMPLETE_DB_BACKEND=tests/pg/backend.js` を付けた全テストを実行する。
- 権限は `contents: read` だけ。本番の環境変数は一切渡さない（`pg_env.js` も、秘密の環境変数があれば拒否する）。
- 想定時間：5〜10分（無料）。
- ブランチ保護で `quality` と `SEO tests` の両方を必須にすると、赤のままのマージを止められる（リポジトリ管理者の設定）。

---

## 6. 工数と費用

| 作業 | 工数（目安） | 費用 |
|---|---|---|
| 保存カードの UI 不具合の修正（第3章） | 1〜2時間 | 0円 |
| PDF の2件を実行可能に（取得・SRI の照合・テスト環境） | 0.5〜1時間 | 0円 |
| OGP 画像の1件（`npm install`・lock の追加） | 0.5〜1時間 | 0円 |
| DB 基盤の取り込み（backend.js ほか） | 2〜4時間 | 0円 |
| DB の87件を実 PG17 で通す（差の切り分け・修正） | 2〜8時間（差の量による。実行してみないと分からない） | 0円 |
| `quality.yml`（CI）と運用文書 | 1〜2時間 | 0円 |
| **合計** | **約7〜18時間** | **0円** |

---

## 7. ご判断いただきたいこと（実装の承認）

1. **このセッションで PG17（embedded-postgres）を一時的に実行してよいか。**
   - 一時ディレクトリで、unix ソケットだけで起動し、合成データだけを使い、終わったら削除する。
   - 承認されない場合は、CI（案A）だけで検証する。この場合、手元で確かめられないため、修正のたびに push して結果を待つ形になる。
2. **作業の分け方（PR #38 とは分離）**：
   - PR-A「保存カードの UI 不具合の修正」
   - PR-B「テスト基盤（PG バックエンドの取り込み・PDF・`@vercel/og`）と `quality.yml`」
   - PR-C（必要な場合）「DB の87件で見つかった不具合の修正」
3. `package-lock.json` を追加してよいか（依存の版を固定する。Vercel のビルドにも影響する）。
4. CI で npm・Playwright・PDF ライブラリを取得すること（すべて無料）でよいか。
