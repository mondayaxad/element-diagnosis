# RELEASE_BACKUP_AND_ROLLBACK_RUNBOOK（Production 移行前のバックアップと切り戻し手順）

- 版：1.0.0（2026-10-09 作成）
- 状態：手順書は承認済み（2026-10-09）。バックアップは、§2 の受け渡し（bundle・公開物 ZIP・SHA-256 一覧）が済むまで完了扱いにしない。
  承認前は、Production への書き込みと main への merge を行わない。
- 対象：元素診断（Vercel プロジェクト element-diagnosis、Supabase の Production／Preview、Stripe）

## 0. 原則

1. **秘密値は、この文書・Git・チャット・ログ・試験結果に書かない。**
   - 対象：API キー、service_role／secret key、Webhook の署名秘密、閲覧トークン秘密値、DB パスワード、利用者のメールアドレス・パスワードハッシュ。
   - 環境変数は「名前・対象環境・最終更新日」だけを記録する。値は Vercel／Supabase／Stripe の管理画面に残す。
2. **Production の Supabase Ref は、この文書では `<PROD_REF>` と書く。**
   - 実際の値は Vercel の Production 環境変数 `SUPABASE_URL` と、Supabase の管理画面で確かめる。
   - Preview は `qelqehkigydgrwedbgtr`（PG17）。
3. **Production への書き込みは、次の6つがすべて済むまで行わない。**
   - (a) この手順書の承認
   - (b) §2 のバックアップ取得
   - (c) §3 の復元試験の合格
   - (d) §4 の「適用前」の記録
   - (e) §7 の OGP 停止条件の解除
   - (f) 運営者の最終承認
4. **販売フラグは、Stripe テストモードの E2E が完全に通るまで未登録のままにする。**
   - Production の `COMPLETE_SALES_OPEN` は未登録。
   - Preview は Stripe Test のみ。
5. 削除を伴う SQL は、対象 ID を指定したものだけを、運営者が SQL Editor で実行する。
   - 全件削除と、表・関数の削除は行わない。
   - 削除の代わりに、隔離（quarantine）・失効（revoked）を優先する。

## 1. 現在の状態（2026-10-09 時点）

| 項目 | 値 |
|---|---|
| Production の Vercel deployment | `dpl_CpDyP24t8u4xRE7eCSkb1JvphV8Z`（READY、main `5f06246`「hotfix: remove unsupported narrative payment link (#3)」） |
| Production の配信方式 | main の `vercel.json` は `cleanUrls` のみ。ビルド無しで、リポジトリ直下と `api/` を配信 |
| RC（Preview）の Vercel deployment | `dpl_53MC1PADenYQZoSBSqMoHbneCPDf`（release-c-preview `38c9391`） |
| RC の配信方式 | `node scripts/build-public.js` で `dist/` を作り、`dist/` だけを配信（許可リスト方式） |
| Vercel プロジェクト／チーム | `prj_hPjAy6n0D9LL6yaAtIw2fdMWsNUH` ／ `team_XZStlth5K8QlkLE5ZRaOGESw` |
| Preview の Supabase migration 履歴 | 15件（0001〜0008、onboarding_01、complete_01〜06。最終は `20261008101348_complete_06_report_storage`） |
| Production に complete 系 migration | 未適用（適用は本手順の承認後） |

### 1-1. 環境変数（名前と対象環境だけ。値は記録しない）

| 名前 | Production | Preview（release-c-preview のみ） | 備考 |
|---|---|---|---|
| SUPABASE_URL | ○ | ○ | |
| SUPABASE_SERVICE_ROLE_KEY | ○ | － | Production は旧名 |
| SUPABASE_SECRET_KEY | － | ○ | Preview は新しい secret key |
| SUPABASE_ANON_KEY | － | ○ | publishable key |
| SUPABASE_EXPECTED_PROJECT_REF ／ SUPABASE_PREVIEW_PROJECT_REF ／ SUPABASE_PRODUCTION_PROJECT_REF | － | ○ | 環境ガード |
| STRIPE_SECRET_KEY | ○ | ○ | Preview は Test キー |
| STRIPE_MODE | － | ○ | Preview は test |
| REPORT_TOKEN_SECRET | ○ | ○ | 環境ごとに別の値 |
| COMPLETE_VIEW_TOKEN_SECRET | － | ○ | Production には**別の新しい値**を32バイト以上で登録する（Preview の値を流用しない） |
| KIT_API_KEY | ○ | － | |
| COMPLETE_SALES_OPEN | 未登録 | 未登録 | 販売開始の最終承認まで登録しない |

Production 移行時に追加・変更が要るものは §5 の手順に書く（Webhook の署名秘密、環境ガード、閲覧トークン秘密値など）。

## 2. バックアップの対象と取り方

保管先：運営者の端末の暗号化領域（またはアクセス制限付きの非公開ストレージ）。

- Git リポジトリ・Vercel・チャットには置かない。
- 利用者データ（auth・diagnosis・orders）を含むファイルは、取得から**90日**で消去する。
- 保管期間を延ばす場合は、プライバシーポリシーと整合させる。

| # | 対象 | 取り方 | 取る人 | 2026-10-09 の取得状況 |
|---|---|---|---|---|
| G1 | Git tag | `backup/prod-20261009` → `5f06246`、`backup/rc1-20261009` → `38c9391`（注釈付きタグ） | Claude | 作成済み（ローカル）。**origin への push は承認待ち** |
| G2 | 保全ブランチ | `backup/prod-main-20261009` → `5f06246` | Claude | 作成済み（ローカル）。**push は承認待ち**。push すると Vercel がこのブランチの Preview を1つ作る |
| G3 | git bundle | `git bundle create element-diagnosis-20261009-full.bundle --all`（浅い clone のときは先に `git fetch --unshallow`） | Claude | 作成済み。4.3MB。SHA-256 `0d683b0b15b191573b4e65d0e133c10503cd279b7147225f1a15602a2146b0cf` |
| P1 | Production の公開物 ZIP | `git archive --format=zip 5f06246`（Production はビルド無しのため、配信物＝このツリー）＋全ファイルの SHA-256 一覧 | Claude | 作成済み。51ファイル。ZIP の SHA-256 `c0fa9566cb1ede81349fce5b3b0a758951630f5b31339c427d2c5d23f7136127`。Vercel は Git 由来の deployment のファイル一覧を返さないため、配信中の実体との照合は §3-2 で行う |
| P2 | RC の公開物 ZIP | `38c9391` を展開 → `node scripts/build-public.js` → `dist/` を ZIP＋SHA-256 一覧 | Claude | 作成済み。85ファイル。SHA-256 `78a05ec75a9d6d46b4c3bbc9d1cf917cb39cee797934844769ad771fc7bb5214` |
| V1 | Vercel の deployment ID・alias | §1 の表。切り戻し先は `dpl_CpDyP24t8u4xRE7eCSkb1JvphV8Z` | Claude | 記録済み |
| V2 | 環境変数（名前・対象・更新日） | Vercel API の一覧（値は復号しない）。§1-1 | Claude | 記録済み |
| S1 | Supabase の schema | `supabase db dump --db-url "$PROD_DB_URL" -f schema.sql`。public・auth のトリガー・関数・RLS・grants を含む。`--schema public,storage` も別に取る | 運営者 | Production は未取得（Claude は Production に接続しない） |
| S2 | Supabase のデータ | `supabase db dump --db-url "$PROD_DB_URL" --data-only -f data.sql`（public） | 運営者 | 同上 |
| S3 | auth の利用者 | `supabase db dump --db-url "$PROD_DB_URL" --data-only --schema auth -f auth_data.sql`。パスワードハッシュ・トークンを含むため、S2 と同じ厳重さで保管 | 運営者 | 同上 |
| S4 | RLS・関数・トリガー・grants・migration 履歴の指紋 | `docs/sql/release_fingerprint_READONLY.sql` を SQL Editor で実行し、結果（件数と md5 だけ）を保存 | 運営者（Production）／Claude（Preview） | Preview は取得済み（§3-3） |
| S5 | Storage の bucket 設定 | `select id, public, file_size_limit, allowed_mime_types from storage.buckets` と、`pg_policies where schemaname='storage'` の件数 | 運営者／Claude | Preview：`complete-reports` が public=false・2MiB・text/html、policy 0件 |
| S6 | Storage のオブジェクト本体 | `supabase storage cp -r ss:///<bucket> ./storage_backup --experimental`（または S3 互換キー）。全オブジェクトの SHA-256 一覧を作る | 運営者 | Production は complete 系が未適用で、対象 bucket は無い見込み（取得時に bucket 一覧で確認） |
| S7 | Auth の設定 | 管理画面の Authentication → Providers・URL Configuration・Email Templates・Rate Limits を記録する。プロバイダの client secret は記録しない。Management API `GET /v1/projects/{ref}/config/auth` を使う場合も、秘密項目は保存前に伏せる | 運営者 | 未取得 |
| T1 | Stripe の設定 | 管理画面で記録する。対象は、Products・Prices（ID・金額・通貨）、Payment Links、Webhook endpoints（URL・受け取るイベント・API version）、Checkout の設定、アカウントの API version。署名秘密・API キーは記録しない。Live と Test を分けて記録 | 運営者 | 未取得 |

注：

- S1〜S3 の `$PROD_DB_URL` は、運営者の端末のシェル環境変数にだけ置く。コマンド履歴に残る形で直接書かない。
- S1〜S3・S6 は、取得後すぐに §3 の復元試験に使う。

## 3. 復元試験

### 3-1. Git（2026-10-09 実施・合格）
1. bundle を `git clone --mirror` で別の場所へ展開した。
2. 次の参照が元と同じコミットを指すことを確かめた。
   - tag 2本・保全ブランチ・origin/main・origin/release-c-preview・release-c-preview
3. `5f06246`・`38c9391` のツリー ID が一致した。コミット数は 317 対 317。
4. `git fsck --full` が成功した。

> 補足：最初に浅い clone のまま作った bundle（`element-diagnosis-20261009.bundle`）は、履歴が欠けていて復元できなかった。これは使わない（2026-10-09 に削除済み）。

### 3-2. 公開物 ZIP（2026-10-09 実施・合格）
- P1：ZIP を展開した51ファイルの git blob ID が、`5f06246` のツリーとすべて一致した。
- P2：ZIP を展開した85ファイルの SHA-256 が、ビルド直後の `dist/` の一覧と一致した。
- **承認後に追加で行う（Production の読み取り）**
  - P1 の一覧のうち静的ファイル（HTML・JS・画像）を、Production の URL から取得する。
  - SHA-256 が一致することで、「配信中の実体＝P1」を確かめる。
  - 一致しないファイルがあれば、移行を止めて原因を調べる。

### 3-3. Supabase（2026-10-09 に Preview で予行・合格）

**手順**
1. Preview の指紋を S4 で取った（25項目）。
2. Preview のデータを JSON で取り出した。
   - 対象：public の全表、auth.users の id、bucket 設定、migration 履歴。
3. ローカルの PostgreSQL 17 に、Git の migration（基本セット 0001〜0008、onboarding_01、complete_01〜06）で schema を再構築した。
4. 取り出したデータを入れた。
   - トリガーと外部キーの確認を止めて投入した。
   - 生成列は除いて入れた。
   - 投入後、外部キーの孤児が0件であることを確認した。
5. 同じ指紋 SQL を実行した。

**結果：25項目すべて一致**

| 項目 | 件数 | 一致 |
|---|---|---|
| schema.columns ／ constraints ／ indexes | 169 ／ 87 ／ 35 | ○ |
| functions（定義の md5・SECURITY DEFINER・search_path）／ functions.grants | 35 ／ 35 | ○ |
| triggers（public と auth.users） | 13 | ○ |
| rls.enabled ／ rls.policies | 13 ／ 8 | ○ |
| table.grants（anon・authenticated・service_role・supabase_auth_admin） | 145 | ○ |
| migration_history | 15 | ○ |
| storage.buckets | 1 | ○ |
| auth.users の id | 4 | ○ |
| public 全13表のデータ（行の JSON の md5） | 各表 | ○ |

**予行で分かったこと**
- 並び順はデータベースの照合順序（Preview は en_US、ローカルは C）で変わり、md5 がずれた。
  - 指紋 SQL はすべて `collate "C"` に固定した。
  - 中身の差は無いことを、関数ごとに確認済み。
- 基本セット 0001〜0008 の SQL は、作業用の ZIP にしか無かった。
  - 2026-10-09 に `docs/sql/baseline_archive_20261006/` へ、**実行用 migration ではない復元用 baseline archive** として追加した（取得時の内容のまま。README・SHA256SUMS 付き）。
- Storage のオブジェクト本体は、予行では次の方法で確かめた。
  - 本体の SHA-256 が、DB の `output_sha256` と一致すること（アプリの閲覧経路で取得）。
- **本体を別の場所へ書き戻す復元試験**は、Storage の秘密キーが要るため運営者の端末で行う（S6）。

**Production で行う復元試験（承認後・運営者）**
1. S1〜S3 を、ローカルの PG17、または新しい使い捨ての Supabase プロジェクトへ復元する。
   - Production には復元しない。
2. S4 の指紋を、Production と復元先の両方で取る。
3. 全項目一致で合格とする。
4. Storage は、S6 の全オブジェクトの SHA-256 一覧と、復元先の一覧が一致することで合格とする。

## 4. Production 適用前後の比較

| 時点 | 取るもの |
|---|---|
| 適用直前 | S4 の指紋 |
| 適用直前 | 表ごとの件数 |
| 適用直前 | storage.objects の件数 |
| 適用直前 | auth.users の件数 |
| 適用直後 | 同じもの |

判定：

- **既存の表のデータ・既存の関数・既存の RLS・既存の grants の md5 が、前後で一致すること。**
- 一致しない既存項目があれば、即座に §6 の切り戻しへ進む。
- 増えてよいもの（complete 系の migration で追加される分）は、あらかじめ次の数を書き出し、その差だけであることを確かめる。
  - 表・関数・トリガー・policy・grants・migration 履歴の数
  - 書き出し方：Preview の指紋と、complete 適用前の Preview の指紋の差を、承認資料に添付する。
- 販売前のため、`complete_orders`・`record_entitlements`・`complete_reports`・`stripe_webhook_events`・`storage.objects` は、適用後も **0件** であること。

## 5. 移行の順番（各段階で承認を取る）

1. この手順書・§2 の取得結果・§3 の復元試験結果の承認。
2. G1・G2 の tag／保全ブランチを origin へ push する（承認後）。
3. Production の §4「適用前」の記録。
4. Production の Supabase へ migration を適用する（complete_01〜06。onboarding_01 は適用済みか確認のうえ）。
   - 適用前と同じ指紋で比較する。
   - **0008_preview_only_settings は Production に適用しない。**
5. Production の環境変数を登録する（値は管理画面で入力する）。
   - 環境ガード、Supabase の secret key、閲覧トークン秘密値（Preview と別の新しい値）、Stripe Live の設定（Live 設定の段で）。
6. Preview 専用の切り替えを本番用に戻す（§8）。
7. main への merge（承認後）。
8. Production の deployment が READY になり、次を確認する。
   - 販売が閉じている（`/api/complete-checkout` が 503 `sales_closed`）。
   - §7 の OGP 確認。
9. 販売開始の最終承認後に、`COMPLETE_SALES_OPEN` を登録する（別段）。

## 6. 切り戻し（Rollback）

| 何が壊れたか | 手順 | 戻す先 |
|---|---|---|
| 配信（Vercel） | Vercel の Instant Rollback で、Production を `dpl_CpDyP24t8u4xRE7eCSkb1JvphV8Z` に戻す。再ビルドは不要 | main `5f06246` の配信物（P1） |
| コード（Git） | main の merge コミットを `git revert -m 1 <merge>` で打ち消す。履歴の書き換え・force push はしない。必要なら `backup/prod-main-20261009` から比較する | `5f06246` |
| 販売 | `COMPLETE_SALES_OPEN` を削除する（未登録＝閉じる）。Stripe の Webhook endpoint を無効にする | 販売停止 |
| DB（migration 適用中・直後で利用者の書き込みが無い） | `docs/sql/complete_99_rollback_DRAFT_DO_NOT_RUN.sql` を、その時点の内容で見直し、承認を得てから運営者が実行する。**注文・権利・生成物が1件でもあれば、表は残して機能だけ止める**（販売停止＋閲覧停止） | §4 の「適用前」の指紋と一致すること |
| DB（データの破損） | 使い捨て環境へ S1〜S3 を復元し、壊れた行だけを ID 指定で戻す。Production 全体の上書き復元は、運営者の最終判断がある場合だけ（それ以降の利用者の書き込みが失われるため） | S2 のデータ |
| Storage | S6 から、対象オブジェクトだけを同じパスへ戻す。bucket の公開設定は public=false のまま | S6 の SHA-256 一覧 |
| 環境変数 | §1-1 の名前・対象に戻す。値は管理画面の履歴、または運営者の保管先から入れ直す | §1-1 |
| Stripe | §2 T1 の記録どおりに、Webhook のイベント・URL・API version を戻す | T1 |

切り戻した後は、§4 の指紋が「適用前」と一致することを確かめる。

## 7. OGP の停止条件（解除されるまでリリースしない）

### 7-1. 全ページ監査（2026-10-09、RC の公開ビルド 41 ページ）と現状

| 結果 | ページ |
|---|---|
| OK | index.html（og:image＝ogp.jpeg 1200×675 JPEG）、mypage.html（noindex） |
| **未解消（停止理由）** | type/*.html 35件。og:image が、リポジトリにも main にも無い `/thumbs/x_card_XXXX.png` を指している。方針（下記）の承認待ちのため、HTML は変えていない |
| OGP 無し（方針の承認待ち） | privacy.html、terms.html、report.html（購入者本人のトークン付きページ）、report_sample.html |
| X シェアの OGP（承認対象） | `/api/share` → og:image＝`/api/og-image?p=…`（1200×630・image/png・`Cache-Control: public, immutable, max-age=31536000`）。7元素の正式背景（`assets/ogp/backgrounds/*.jpg`）の上に、`js/ogp-card.mjs` の組み立てで文字を描く |

- Preview での確認（2026-10-09）
  - `/api/og-image` は7元素とも 200・image/png・1200×630。
  - `/api/share` の og:title・description・image・type・url と、twitter:card（summary_large_image）・image がそろい、画像の URL は絶対 URL。
- **Preview では、カードが背景なしの予備表示（円環だけ）になる。**
  - Preview の保護により、Edge 関数から自サイトの背景画像を取得すると 302 で弾かれるため。
  - 背景つきの見え方は、同じ組み立て（`ogp-card-demo.html`）をローカルで描いて確認した。
  - 本番で背景つきのカードが返ること、X のクローラーが取得できることは、§7-2 で Production 反映後に確かめる。
- 一時的に作った静的画像の案（サイト共通カード・タイプ別カード）は取り消した。OGP はこの動的カードを正とする。
- `scripts/build-public.js` は、本番ドメインの絶対 URL の欠損として `thumbs/x_card_XXXX.png` だけを既知として許している。type の方針が決まり HTML を直す時に、この例外も外す。

### 7-2. 解除の条件（Production の deployment が READY になった後に確かめる）

1. 全公開ページの `og:url`・`og:image`・`canonical`・`twitter:image` が、`https://element-diagnosis-five.vercel.app/` で始まる絶対 URL であること。
2. そのすべての URL が、Production で **200** を返すこと。
3. 画像の **Content-Type** が `image/jpeg` または `image/png` であること。
4. 画像の**寸法**が 1200×600 以上（X シェアの動的カードは 1200×630、トップの ogp.jpeg は 1200×675）、容量が 5MB 未満であること。
5. **SNS のキャッシュを更新する。**
   - Facebook Sharing Debugger で、トップ・type 35件（少なくとも代表数件と、以前共有されたもの）・`/api/share` の例を「再取得」する。
   - LINE は PagePoker でキャッシュを消す。
   - X は投稿画面のプレビューで、カード画像が出ることを確かめる。
6. 1〜5 のいずれかが満たせない間は、販売開始・告知を止める。

## 8. Preview 専用の切り替え（本番へ戻すもの）

| ファイル | 内容 |
|---|---|
| index.html、mypage.html、report.html | GA4 の読み込みを止めている（`gtag()` が何もしない）。本番では元の GA4 の読み込みへ戻す |
| index.html、report.html | Stripe の Payment Link の分岐フラグ（Preview では true、本番では false） |
| index.html（2643行付近） | CORE1 のリンクの切り替えは `IS_PREVIEW_BUILD` に従う |
| Supabase | 0008_preview_only_settings は Production に適用しない |
| 環境変数 | §1-1。Preview の値を Production に流用しない |

## 9. 未解決・持ち越し

- [x] 基本セット 0001〜0008 を復元用 baseline archive として Git に入れる（§3-3）。
- [ ] G1・G2 の origin への push（承認待ち）。
- [ ] S1〜S3・S6・S7・T1 の Production での取得と復元試験（運営者）。
- [ ] P1 と、配信中の Production の実体との照合（承認後）。
- [ ] type 35件・privacy／terms／report／report_sample の OGP・noindex の方針決定と反映（§7-1）。
- [ ] Preview に残っている Safari 実機確認用の合成データの削除（確認結果を受けてから、対象 ID だけで消す）。
