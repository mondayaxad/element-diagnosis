# タイプ解説ページの OGP 画像（assets/ogp/types/）の作り方

## 何か
- タイプ解説ページ `/type/<code>` 35件の og:image と twitter:image：`assets/ogp/types/<CODE>.jpg`（1200×630・JPEG・約115〜127KB）。
- 診断結果の共有カード（`api/og-image`・`js/ogp-card.mjs`・`assets/ogp/bases/`）とは別物。共有カードには手を入れない。
- 描くもの：
  - 見出し「元素診断 — TYPE PROFILE」
  - タイプコード（元素色のグラデーション）
  - タイプ名
  - 元素と武器種のタグ
  - タイプの軸（`type/<code>.html` の `.axis` の文言）
  - 下帯「原神 元素診断 ｜ 35タイプの性格・特徴」
- 描かないもの：「MY RESULT」・国家・キャラクター・一致度など、個人の結果を示す表現。

## 部品
| ファイル | 役割 |
|---|---|
| `js/ogp-type-card.mjs` | カードの組み立て（Satori 用の要素ツリー）。配色・配置は `js/ogp-theme.mjs` の値を共有する |
| `scripts/build-ogp-type-cards.mjs` | 35枚を作る |
| `assets/ogp/backgrounds/<元素>.jpg` | 元素別の正式背景（既存） |
| `assets/ogp/fonts/noto-serif-jp-700-type.woff` | Noto Serif JP 700 のサブセット（カードに出る文字だけ。158字） |
| `assets/ogp/fonts/OFL.txt` | フォントのライセンス（SIL Open Font License 1.1）。このフォルダの2つのフォント（`-og`・`-type`）に適用 |
| `scripts/woff-cmap.js` | フォントの収録文字を読む（依存パッケージなし） |

## 作り直し方（デザイン・タイプ名・軸の文言を変えた時だけ）
```sh
npm i --no-save @vercel/og@0.6.3      # まだ無い場合（生成時だけ使う）
node scripts/build-ogp-type-cards.mjs  # 35枚を assets/ogp/types/ に上書き
#   一部だけ：--only ELCM,PYCM,HYPL ／ 別の場所へ：--out <dir> ／ 画質：--quality 88（既定）
node --test tests/seo_type_meta.test.js
```
- 必要なもの：Node 22、ImageMagick（`convert`）。
- **外部への通信はしない**：生成中は `fetch` を禁止している。カードの文字が同梱フォントに無いと、生成は通信せずにエラーで止まる。欠けた文字を外部の代替フォントで描くと、環境によって結果が変わるため。
- 作り直したら、35枚の一覧を目で確認する（文字化け・見切れ）。例：`montage assets/ogp/types/*.jpg -tile 5x7 -geometry 480x252+4+4 contact.jpg`

## 文字を増やした時（フォントの取り直し）
カードに新しい文字（新しいタイプ名・軸の文言・見出し）が増え、生成が「同梱フォントに無い文字」で止まった場合：
1. カードに出る文字をすべて集める：見出し・下帯・35のタイプ名・35の軸・元素・武器種・英数字。
2. Google Fonts から、その文字だけのサブセットを WOFF で取る：
   - `https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@700&text=<集めた文字を URL エンコード>`
   - 古いブラウザの User-Agent で取得すると、CSS の `src` が WOFF になる。
3. 取得したファイルを `assets/ogp/fonts/noto-serif-jp-700-type.woff` に置き換えて、作り直す。
   - `tests/seo_type_meta.test.js` が、全35枚の文字がフォントにあることを確かめる。

ライセンス：Noto Serif JP は SIL Open Font License 1.1（Reserved Font Name なし）。サブセット化と同梱は許可されている。`OFL.txt` を一緒に置くこと。
フォントは生成時だけ使う。dist（公開ファイル）には含めない。
