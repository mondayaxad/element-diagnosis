# 元素診断 Mini — Phase A（独立ページ・購入なし）

- 根拠：`docs/eti-mini/handoff_v1/README_Claude_実装指示書.md`（ChatGPT 引き継ぎ v1。同梱データは無改変で保管）
- ブランチ：`release-c-preview`（新しいブランチは作らない。邪眼診断・Mini は同じプレビューの別ページという扱い）
- URL：`/mini`（cleanUrls で `mini.html`）。`noindex`。本家のページ・API・保存・MIRROR・販売導線には触れない

## 追加したファイル

| ファイル | 役割 |
|---|---|
| `mini.html` | 3問（各1択）→ 任意のキャラ選択（登録118名の検索）→ 結果（タイプ名・コード・元素/武器種/国家・短い言葉・近しいキャラ）→ 人物像レポート（準備中）→ 最下部に本家100問への案内 |
| `js/eti_mini_core.js` | 結果を決める層。未選択は固定割当表を引くだけ。手動選択は `setManualCombiner()` で結合式を差し込むまで `MANUAL_SELECTION_NOT_CONFIGURED` を投げる（仮計算しない） |
| `js/eti_mini_auto_map_v1.js` | 固定割当（key → キャラ名）。`scripts/build-eti-mini-data.js` が正本 JSON（sha256 固定）から生成。`internal_rank`・`internal_regret_pp` は含めない |
| `js/eti_mini_choices_provisional.js` | 3問の選択肢。**仮の文言（Claude 案）**。ChatGPT の確定文で差し替える |
| `scripts/build-eti-mini-data.js` | 上記データの生成・`--check` |
| `tests/eti_mini.test.js` | Mini の試験（14件） |
| `scripts/build-public.js` | 許可リストに Mini の4ファイルを追加（既存行は変更なし） |
| `docs/eti-mini/handoff_v1/` | 受け取った引き継ぎ一式（README・data・validation）の写し |

## 確認したこと

- 割当表の再現：本家の `ETIv2.computeMirrorV2`（ETI-MIRROR-2.1.0 の式・ETI-CHAR-2.1.0）に、元素・武器・国家の生の代表値を連結して入れ、候補66名に絞ると、`internal_rank` 280/280・`internal_regret_pp` 280/280（差 ≤ 0.00005）が一致した。
- `validation/validate_mapping.py`：PASS（280通り・66名・50×4＋16×5・除外なし）。
- `tests/eti_mini.test.js`（14件）：280通りの網羅と正本との一致、66名×4〜5回、候補外・除外なし、決定性、未回答・不明値のエラー、割当に無い key のエラー、ナド・クライの表記（内部キーはナドクライ・意味は月光）、35タイプ名・コード・短い言葉が index.html と一致、手動選択は未接続のあいだ計算しない、選択肢が 7・5・8 で属性名を含まない、点数・一致率を出さない、CTA が最下部、配信の許可リスト。
- `npm test`（既存を含む全件）・`node scripts/build-public.js`：結果は報告を参照。
- 画面（Playwright・390×844 / 360×740）：回答前は「結果を見る」が無効、キャラ選択時は「準備中」と「選ばずに結果を見る」、結果表示、横スクロールなし、国家名の折り返しなし。

## 未確定（Claude は決めない）

1. 手動選択の結合式・重み（ChatGPT）。`setManualCombiner(fn)` の形：`fn({ answers, character }) → { element, weapon, nation, version }`
2. 3問の最終文言（ChatGPT）。現在は仮
3. 人物像レポート（¥1,000）の本文・構成、決済・購入スナップショット・再閲覧・共有・OGP（Phase C）
4. 66名のレアリティ・Ver.7.0 の一次資料での裏取り、『ドール』の同定
5. 割当表の `status` は `DESIGN_CANDIDATE_PENDING_FINAL_APPROVAL`（承認済みの本番仕様ではない）
6. GA4 の計測は入れていない（本家の集計を汚さないため。入れるならイベント設計から）
