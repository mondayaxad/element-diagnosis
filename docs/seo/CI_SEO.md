# SEO 回帰テストの CI と、マージ前の運用

## 何が自動で走るか
- ワークフロー：`.github/workflows/seo.yml`（GitHub Actions・ジョブ名「SEO tests」）
- いつ走るか：main 向けの Pull Request（作成時と push のたび）、main への push。
- 何を走らせるか（6ファイル）：
  - `tests/seo_indexing.test.js`：robots.txt・sitemap・canonical・noindex・内部リンクの UTM
  - `tests/seo_index_guard.test.js`：インデックス方針の一覧（`scripts/seo-policy.js`）との突き合わせ。方針が未定義のページ・rewrite・API を検出する。末尾スラッシュも検査する。共有ページの noindex も検査する
  - `tests/public_build.test.js`：公開ファイルの許可リスト・参照の欠損
  - `tests/ga4_fixes.test.js`：GA4 の送信値の消毒・UTM
  - `tests/seo_type_meta.test.js`：タイプ解説35ページの title・description・OGP 画像（寸法・容量・参照先・フォントの収録文字）・導線
  - `tests/seo_jsonld.test.js`：構造化データの構文と、ページとの整合
- 判定：1件でも失敗すれば赤。除外・`continue-on-error`・リトライは使わない（テストの基準は緩めない）。
- 権限・秘密情報：`contents: read` だけで、シークレットは使わない。依存パッケージのインストールもしない。
- 費用：リポジトリは公開（public）なので、GitHub Actions の標準ランナーは無料。1回1分未満。
- Vercel のデプロイ設定は変更しない。CI の結果は Vercel のデプロイを止めない。

## マージ前の運用（必須）
CI を足しただけでは、赤のままでもマージできる。そこで、次の手順を必須とする。

1. PR の「Checks」で **SEO regression tests / SEO tests が緑**であることを確認してからマージする。赤なら原因を直して push し、緑になるまでマージしない。
2. SEO に関わる変更（ページの追加・削除、`vercel.json`、`sitemap.xml`、`type/*.html`、`jagan/*.html` の head、`scripts/build-public.js`、`scripts/seo-policy.js`）を含む PR は、手元でも `npm test` を実行する。結果（件数と、既知の失敗以外に失敗がないこと）を PR に書く。
3. （推奨・リポジトリ管理者の作業）GitHub の Settings → Branches → main のブランチ保護ルールで、「Require status checks to pass before merging」の対象に `SEO tests` を加える。これで、赤のままのマージを GitHub 側でも止められる。

## 新しいページを足す時
1. `scripts/build-public.js` の公開リストに足す。
2. `scripts/seo-policy.js` に方針（index／allow／noindex）を書く。書き忘れると CI が赤になる。
3. index の場合：canonical・title・description・H1 を1つ、`sitemap.xml` に追加。
4. noindex の場合：`vercel.json` の X-Robots-Tag（source は `/path{/}?` で末尾スラッシュも含める）と、ページ内の meta robots。
5. OGP 画像は、dist に実体があるか `/api/og-image` を指すこと（実体のない画像は `public_build` が検出する）。
