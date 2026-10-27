# OGP（api/og-image）のフォントと事前生成の下地

- `assets/ogp/fonts/noto-serif-jp-700-og.woff`：Noto Serif JP（Bold 700）を、シェアカードで使う文字だけに絞ったもの（WOFF）。
  - ライセンス：SIL Open Font License 1.1（Noto CJK / Google Fonts）。https://openfontlicense.org
  - 収録文字：api/_og-data.mjs の元素・武器・国家・タイプ名・キャラクター名、カードの固定文言、数字、英大文字。
    キャラクターやタイプ名を追加したら、文字を足して作り直すこと（足りない文字は描かれない）。
- `assets/ogp/bases/<タイプコード>.jpg`（35枚）・`mirror-<元素>.png`（7枚）：`node scripts/build-ogp-bases.mjs --quality 95` で作る下地と札。
  背景・デザイン（js/ogp-card.mjs・js/ogp-theme.mjs）・フォント・タイプ名を変えたら作り直してコミットする。
