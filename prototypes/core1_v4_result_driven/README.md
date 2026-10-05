# ETI CORE1 完全版 v4：診断結果連動・46ページ自動生成（本番未接続プロトタイプ）

100問の有効回答から本人の結果を算出し、承認済み46ページデザイン（`../core1_v4_revised/core1_complete_report_v4_revised_46p.html`）の紙面に流し込みます。数値・順位・画像・本文・人物像・組合せ解説は、すべて結果に応じて決定論的に変わります。

**本番には接続していません。** `index.html`、`mypage.html`、`report.html`、API、DB、決済、Vercel、main ブランチは変更していません。

## 使い方

```bash
cd prototypes/core1_v4_result_driven
node tools/make-fixtures.js         # seed 固定の12フィクスチャを作る（何度実行しても同じ）
node tools/freeze-expected.js       # 算出値を fixtures/expected/ へ凍結
node src/build-report.js --all      # dist/F01.html … F12.html（＋snapshot・claims JSON）
NODE_PATH=$(npm root -g) npm test   # 55件（render.test は Playwright が無ければ skip）
NODE_PATH=$(npm root -g) node tools/make-pdf.js F01 F02   # A4 PDF
node tools/coverage-report.js       # docs/coverage.md, docs/claim-trace-example.json, docs/core-records-example.json
node tools/golden-compare.js        # docs/golden-comparison.md（Phase 1 ゴールデン比較）
```

内容辞書の編集元は `tools/src_*.py` です。編集後に `python3 tools/src_*.py` を実行すると `src/content/*.json` が再生成されます。文面を変えたら `UPDATE_TEXT_SNAPSHOTS=1 node --test tests/wording.test.js` で本文スナップショットを更新し、差分を人が確認します。

## 処理の一本道

```
100 answers → validateAnswersV2 → computeResultsV2 → ETIv2MirrorResolver.computeMirror
  → CORE1 HIDDEN SHAPE → CORE1 MENTOR（目標入力がある時だけ）→ DOMAIN
  → 不変スナップショット → judgments → claims＋trace → 46ページ view model → HTML
```

HTML の側では再計算しません。

| ファイル | 役割 |
|---|---|
| `src/engine.js` | 正本6ファイル（`js/`）をそのまま評価して読み込む。版と118名を検証する（停止条件1・3） |
| `src/normalize-report-input.js` | 入力契約の検証。欠損・範囲外・余分なID・非整数・版違いを拒否し、0で補わない |
| `src/calculate-result.js` | 不変スナップショット（deepFreeze）を作る |
| `src/models/hidden-shape.js` `mentor.js` `domains.js` | 派生モデル（下記） |
| `src/polarity.js` | 高得点側・低得点側を本文へ変換する唯一の場所（CORE1-POLARITY-1.0.0）。詳しくは `docs/low-score-path.md` |
| `src/judgments.js` | 文章選択用の判定：核の軸、型との差、gap 状態、人物との差、山谷 |
| `src/build-claims.js` | claims＋trace、view model、タイプ名の対応表 |
| `src/content/*.json` | 査読済みの内容辞書（軸20・カテゴリ20・組合せ131・人物タグ90・規則・MENTOR方向） |
| `src/templates/report-46p.js` / `*.css` / `viewer.js` | 承認済み46ページのテンプレート。本文（narrative）と根拠（evidence）を別の要素に置く |
| `assets/{elements,weapons,nations}/*.jpg` | 承認済み画像20点の registry。表紙と詳細ページは同じファイルを使う |

## 式と版

| 区分 | 版 | 内容 |
|---|---|---|
| 算出事実（正本） | ETI-2.0 / ITEM・SCORE・TRANS-2.0.0 / CHAR-2.1.0 / MIRROR-2.1.0 | `js/` の関数をそのまま呼ぶ。式を写し直していない |
| 派生モデル | CORE1-HIDDEN-1.0.0 | 層ごとに centered cosine を 0..1 へ（平坦なら0.5）。0.40P＋0.30S＋0.30V。順位は丸め前の値で、同率は P→S→V→canonical の順 |
| 派生モデル | CORE1-MENTOR-1.0.0 | 本人が選んだ deltas だけを動かし、0..100 に収める。正本の MIRROR 式（40/30/30）と同率規則で順位を付ける。方向が未入力なら順位を作らない |
| 派生モデル | CORE1-DOMAIN-EDITORIAL-0.1.0 | 採用4軸の単純平均。ST・HE・CO・TR は除く。100%へ正規化しない |
| 順位帯 | CORE1-RANKBAND-1.1.0 | 元素 3/2/2、武器種 3/0/2、国家 3/3/2 |
| 文章選択（暫定） | CORE1-TEXT-BANDS-0.1.0 | 65以上／36〜64／35以下。人口規準ではなく、画面で「上位○%」へ変換しない |
| gap 状態（候補） | CORE1-GAP-LABELS-CANDIDATE-0.1.0 | 表示差2以下＝近接、8以上＝開き。文型の選択にだけ使い、状態語は画面に出さない。strong 断定は出さない |
| 極性 | CORE1-POLARITY-1.0.0 | 上記1。`src/polarity.js` |
| 下位への対処 | CORE1-LOWER-COPING-1.0.0 | 上記3。完全代替を書かない |
| 核の軸 | CORE1-CORE-AXIS-1.0.0 | 辞書の core_axes のうち、向きが一致し型との差が最小の軸を「核」とする。向きの合う軸が無ければ「組み合わせで形づくられる」と書く。統計的因果ではなく編集規則 |
| 組合せ関係 | CORE1-PAIR-RELATION-0.1.0 | 辞書の既定関係を、根拠4軸の一致率が0.5未満なら「条件付き」へ。VALUES が平坦なら国家側は「条件付き」 |

## 内容整合性の規則（2026-10-05 修正）

1. **極性**：全20軸に、高得点側と低得点側の方向（`hi_pole` / `lo_pole`。例：内省・少人数側）と現れ方（`hi_reading` / `lo_reading`）を分けて持たせました。
   - 低得点は「弱い」「出にくい」と書きません。
   - 谷の文は「数値の谷は○○です。これは、〜方向として現れます。」の形に統一しました。
   - 側は P/S が 50 との比較、VALUES が centered で決まります。中央域は「強い偏りではない」と明記します。
   - 相対的な谷でも値が高得点側にある軸には、低得点側の意味を当てません。
2. **核**：本文・バッジ・注記のすべてで、軸名に方向を添えます（例：核（主要一致軸）：誠実性（即興・可変側））。内部には `core_axis_code / core_axis_score / core_axis_pole / core_axis_phrase / core_selection_reason` を保存します（例：`docs/core-records-example.json`）。
3. **下位への対処**：見出しを「上位資質から同じ目的へ近づく方法」に改めました。
   - 対処辞書は `lower-coping.json` の20件で、131組合せ辞書とは別です。各提案は `required_outcome / upper_strength_contribution / remaining_gap / external_support / minimum_practice` を持ちます。
   - 必ず「〜までは代替しないため」と書き、完全代替とは書きません。上位資質は、下位ごとの `preferred_uppers` の順で選びます。
4. **主観の推測をしない**：「自分では弱いと思っていた」「見落としていた」「隠れていた」などを廃止しました。HIDDEN SHAPE は「数値の高さだけでは目立ちにくかった」「絶対値ではなく相対配置を見ると意味を持つ」に統一しています。
5. **緊張**：規則を2種類に分けました。
   - 「緊張」（type=tension）：同じ場面で異なる行動を要求し、一方を優先すると他方が損なわれるもの。必ず `conflict_scene` を持ちます。
   - 「並存」（type=coexist）：それ以外。画面では「並存」「場面によって比重が変わる二つの基準」と書きます。
   - 組合せの「緊張」ラベルは、根拠軸の一致率が0.5以上で、辞書に競合場面がある時だけ出し、それ以外は「条件付き」にします。
6. **一元化と反復**：P39 の事実・緊張・問いは、P03 と同じ claim を使います。人物の一文は三つの文型を順に使い、同じ言い回しの反復（同一リスト3回まで）と同じ文の重複を防ぎます。

再提出物：
- `docs/golden-comparison.md`
- `docs/test-results.md`
- `docs/claim-diff.md`
- `docs/low-score-path.md`
- `docs/claim-trace-example.json`
- `docs/core-records-example.json`
- `dist/F01.pdf`、`dist/F02.html`、`dist/F04.pdf`

## 中央域・neutral と ZIP 単体での検証（2026-10-05 追加修正）

1. **中央域を方向として扱わない**（CORE1-NEUTRAL-1.0.0、`src/judgments.js` / `src/polarity.js`）
   - neutral：P/S はちょうど50、VALUES は centered 0。どちらの側にも数えず、方向ラベルを付けません。
   - 中央域：P/S 36〜64、VALUES |centered| < 8。「○○側」を付けず「中央域」と書きます。相対順位（山・谷）の計算には残します。
   - 核・支える軸の候補は、型と同じ向きで、P/S が35以下か65以上、VALUES が |centered| ≥ 8 の軸だけです。
   - 条件を満たす軸が無いカテゴリは核を選ばず、「このカテゴリは一本の強い軸ではなく、複数軸の組合せによって形づくられています」と表示します。
   - trace（BODY-MEANING の evidence）に残すもの：
     - 候補ごとの判定（adopted_primary / adopted_supporting / excluded_neutral / excluded_mid_band / excluded_direction）
     - 使用した閾値
     - 核を選ばなかった理由
2. **ZIP 単体で検証を再現**
   - `fixtures/golden/approved_sample_CORE1-V4-AUDITED-SAMPLE-001.json`：承認サンプルの算出値を複製したもの。変更しない前提で、`MANIFEST.json` の SHA-256 で固定しています。テスト・ゴールデン比較・フィクスチャ生成はこれだけを参照します。
   - `vendor/eti-js/js/`：正本エンジン6ファイルの読み取り専用スナップショットです（SHA-256 固定）。
     - リポジトリ内で実行した時は `js/` を使い、同梱スナップショットと同一であることを確かめます。違えば停止します。
     - リポジトリの外（展開した ZIP）では同梱スナップショットを使います。
   - テスト `Z2` は、プロジェクトを一時フォルダへ単独でコピーし、`calculations.test.js` とゴールデン比較が外部フォルダなしで通ることを確かめます。

ZIP を展開した後の手順：

```bash
cd core1_v4_result_driven
NODE_PATH=$(npm root -g) npm test     # Playwright が無い環境では render.test の2件を skip
node tools/golden-compare.js          # docs/golden-comparison.md（同梱 golden と照合）
```

## 何が本人の結果に連動するか

P01〜P46 のすべてです。主なものは次のとおりです。

- 表紙：元素診断／完全解析｜CORE1／タイプコード／タイプ名／元素×武器種×国家／主元素の画像。タイプ名は `index.html` の TYPE_NAME と同じ35件の対応表から引きます。
- 全順位、gap、20軸、山と谷、内的緊張、問い。
- 人物像：MIRROR（resolver の `.mirror` に印を付ける）、HIDDEN、MENTOR の TOP10。人物の一文、共通点、違い、借りる一つの振る舞い。
- 上位3×3の詳細（画像、核、支える軸、本文、場面、「〜だけでは説明できない部分」）。
- 二層の交わり3つ（131件の辞書から）、三層統合、中位・下位、弱み候補、ドメイン、観察実験、コンパス、辞典の並び順と数値。

## 固定のまま残るもの

- P02 の読み方。
- カテゴリと軸の定義文。
- 紙面のレイアウト。
- 辞典の定義。

## 停止条件の扱い

- 版の不一致、118名以外の混在：生成を止めます（`engine.js`）。
- タイプの対応表で再現できない場合：止めます（stop 11）。
- 承認済み画像が欠けている場合：止めます（stop 12）。
- 辞書の欠損・空文・TODO・未知ID：止めます。
- 査読済みでない MENTOR の方向：止めます。
- MENTOR の方向が未入力の場合：P09・P28 はランキングを捏造せず「目標方向を選ぶと生成されます」と表示します。

## 未確定事項・本番接続前の課題

1. **MIRROR の完全同率（19.1）**：118名に座標が同一の組は無く、100問の回答で完全同率は実質起こりません。そのため完全同率の例は、正本の選択関数 `selectFromRankings` に同率の行を与える単体テストで確認しています（元素→国家→武器→canonical の順）。
2. **閾値**：TEXT-BANDS、GAP-LABELS、緊張と弱みの規則の閾値は暫定です。実際の回答分布で校正する必要があります。
3. **DOMAIN と HIDDEN**：編集用・内部用の派生指標です。回答分布と順位の安定性の検証が必要です。
4. **MENTOR の方向**：選択肢は `mentor-goals.json` の5件です。本番では、本人が選ぶ UI と保存先が別に必要です。
5. **人物文**：資料タグ（basis_tags）の言い回しの範囲で書いています。原作の設定は追加していません。人物ごとに書き込んだ説明が必要なら、確認済みの資料を別に用意してから追加します。
6. **最終の全文査読**：代表3件（F01・F02・F04）は、人が「数値を見なくても意味が伝わるか」を全文で確かめる必要があります。自動テストだけでは合格にしません。
7. **本番接続**：購入時のスナップショット保存、report version の運用、画像の配信方法は、別工程として承認が必要です。
