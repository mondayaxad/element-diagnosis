# 全テストの名称と結果

実行：`NODE_PATH=$(npm root -g) npm test`（Node v22.22.2、Playwright あり）

合計 55件：合格 55・不合格 0・skipped 0（skipped を除いた実行件数 55件）

| 内訳（ファイル） | 件数 | 合格 | skipped |
|---|---|---|---|
| tests/calculations.test.js（算出・ゴールデン・拒否条件） | 13 | 13 | 0 |
| tests/claims.test.js（claim trace） | 4 | 4 | 0 |
| tests/coverage.test.js（辞書・118名・131組合せ・タイプ名） | 7 | 7 | 0 |
| tests/integrity.test.js（極性・核の方向・代替・主観・緊張・反復・P03/P39） | 9 | 9 | 0 |
| tests/neutral-standalone.test.js（中央域・neutral／ZIP単体） | 5 | 5 | 0 |
| tests/render.test.js（A4・46ページ・PDF・390px・JS無効・画像） | 4 | 4 | 0 |
| tests/wording.test.js（文面の退行検出・本文スナップショット） | 13 | 13 | 0 |

| # | テスト | 結果 |
|---|---|---|
| 1 | 12 fixtures exist and are deterministic | 合格 |
| 2 | every fixture matches its frozen expected snapshot | 合格 |
| 3 | all numbers equal the canonical engine output (no re-implementation) | 合格 |
| 4 | ranking uses raw values, display uses rounded values | 合格 |
| 5 | golden: approved sample (F01) equals the frozen approved values | 合格 |
| 6 | invalid answers are refused (missing / out of range / extra id / non-integer) | 合格 |
| 7 | VALUES flat: all nations equal, flagged so no nation is narrated as meaningful | 合格 |
| 8 | MIRROR selection uses resolver .mirror, not rankings[0] (exact-tie rule via canonical selector) | 合格 |
| 9 | HIDDEN SHAPE: tie-break order P → S → V → canonical | 合格 |
| 10 | MENTOR: no goal → no ranking; goal → only listed axes move, clamped 0..100 | 合格 |
| 11 | DOMAIN: simple means of the fixed 4 axes, excluded ST/HE/CO/TR | 合格 |
| 12 | coverage: every element / weapon / nation is \#1 at least once | 合格 |
| 13 | snapshot is immutable and carries all versions | 合格 |
| 14 | every claim has a complete trace | 合格 |
| 15 | calculated facts carry evidence paths into the snapshot | 合格 |
| 16 | strong assertions are not issued before distribution calibration | 合格 |
| 17 | core-axis claims follow the dictionary rule (P13–P21) | 合格 |
| 18 | 7 elements, 5 weapons, 8 nations are complete and match canonical prototype keys | 合格 |
| 19 | 131 pair entries exist with all required fields | 合格 |
| 20 | all 118 characters can be described with complete sentences (no tag lists) | 合格 |
| 21 | every fixture renders all 46 pages and every category that appears has content | 合格 |
| 22 | unknown content id stops generation instead of continuing | 合格 |
| 23 | mentor goal must come from the reviewed catalog | 合格 |
| 24 | type registry reproduces ANBW-M / 追風者 for the approved fixture | 合格 |
| 25 | 1. low-score polarity is never inverted (unit + all fixtures) | 合格 |
| 26 | 2. every axis has separate high/low meanings in natural language | 合格 |
| 27 | 3. every displayed 核 carries its direction | 合格 |
| 28 | 4. lower categories are never claimed to be fully substituted | 合格 |
| 29 | 5. no guessing of the reader's inner states | 合格 |
| 30 | 6. a tension is shown only with a concrete conflict scene | 合格 |
| 31 | 7. character lines do not repeat the same phrase or sentence pattern | 合格 |
| 32 | 8. P03 and P39 show the same claims (single source) | 合格 |
| 33 | P07 note reads as a sentence; P25 type name is on one line | 合格 |
| 34 | N1. exact 50 / centered 0 is neutral, and mid-band axes get no 「○○側」 label | 合格 |
| 35 | N2. core / supporting are only taken from axes outside the mid band; trace records the decision | 合格 |
| 36 | N3. no mid-band or neutral axis is labelled with a direction anywhere in the report text | 合格 |
| 37 | Z1. golden JSON and canonical engine are bundled and hash-pinned | 合格 |
| 38 | Z2. an extracted copy without the repository or old prototypes runs calculations + golden comparison | 合格 |
| 39 | no external CDN / font / script references | 合格 |
| 40 | images come from the asset registry; cover and P13 use the same element file | 合格 |
| 41 | A4 layout: 46 pages, no overflow, P12 one-line heading, P43–P46 headings once and one line (all 12 fixtures) | 合格 |
| 42 | PDF is exactly 46 A4 pages; print hides the viewer; 390px works; no-JS shows all pages | 合格 |
| 43 | no population / probability / ranking-in-the-world wording in generated claims | 合格 |
| 44 | low rank is never called a defect | 合格 |
| 45 | display name is ナド・クライ everywhere on screen | 合格 |
| 46 | スネージナヤ: no 慈愛 / high benevolence claim (coordinates say otherwise) | 合格 |
| 47 | MENTOR without a goal shows no character ranking (P09, P28) | 合格 |
| 48 | narrative claims do not start with numbers or axis codes, and carry no code+number tokens | 合格 |
| 49 | narrative claims contain no scores (numbers live in evidence) | 合格 |
| 50 | character lines are full sentences, not tag lists | 合格 |
| 51 | P03 three facts read without numbers; P36 shows a reason for each lens | 合格 |
| 52 | pages P04–P06 and P22–P31 have explanatory prose of sufficient length | 合格 |
| 53 | no sentence over 160 characters and no paragraph repeats the same sentence | 合格 |
| 54 | no fixed-sample residue in other results | 合格 |
| 55 | extracted narrative text matches the frozen snapshot for all 12 fixtures | 合格 |
