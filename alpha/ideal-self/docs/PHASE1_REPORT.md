# Ideal Self Agent α — Phase 1 提出物

作成日：2026-11-27／ブランチ：`claude/ideal-self-agent-phase1-91er9p`（基準：main `a68df087`）

## 1. 環境の読み取り照合表

すべて読み取りのみ。本番 Vercel・DB・認証設定には何も書き込んでいない。実データ（利用者の行）は1件も取得していない（取得したのは関数・ポリシー・権限などのメタデータだけ）。

| 項目 | 結果 | 確認方法 | 状態 |
|---|---|---|---|
| 基準コミット | origin/main = `a68df0877f66`（PR #48 のマージ） | git | 一致 |
| Production の版 | 最新の Production デプロイ（READY）が main `a68df087` | Vercel API（読み取り） | 一致 |
| 作業ブランチの土台 | 作業ブランチは当初 `release-c-preview`（`a946d13`、main より 50 コミット先の Preview 用）を指していた。α の差分を main 基準にするため、main `a68df087` から作り直した | git | 対応済み |
| Production と Preview の境界 | Production は main。ほかのブランチを push すると Preview が自動で作られる（`release-c-preview`・`seo/*`・`codex/*` の実例あり）。Vercel の保護は SSO（`all_except_custom_domains`）が有効、パスワード保護・IP 制限は無効 | Vercel API | 確認済み |
| α と Preview | α は `build-public.js` の許可リスト外なので、このブランチの Preview にも α は載らない（main と同じ内容の Preview になる）。Preview で α を見る運用は入れていない | テスト `isolation.test.js` | 確認済み |
| Preview の「本人限定」 | SSO 保護はチームのメンバーなら閲覧可。チームのメンバーが本人だけかは未照合 | — | **未確認** |
| DB マイグレーション履歴 | Supabase のマイグレーション履歴は空（SQL ランブックで手動適用する運用のため、履歴からは判断できない） | Supabase（読み取り専用） | 履歴なし |
| `save_diagnosis_session_v2` | 本番 DB に存在。引数 20 個が `js/eti_v2_save.js` の呼び出しと一致。SECURITY INVOKER | `pg_proc` | 確認済み |
| GRANT（関数） | `save_diagnosis_session` / `_v2` の EXECUTE は `postgres` と `authenticated` だけ（`anon`・`PUBLIC` なし） | `pg_proc.proacl` | 確認済み |
| RLS | `diagnosis_sessions`・`diagnosis_results`・`diagnosis_answers` は RLS 有効（FORCE は無効）。ポリシーは各表 `insert_own`・`select_own` のみ（UPDATE・DELETE のポリシーなし） | `pg_class`・`pg_policies` | 確認済み |
| GRANT（表） | `anon`・`authenticated` への表の権限は、読み取り専用ロールの `information_schema` からは見えなかった | `role_table_grants` | **未確認** |
| OAuth 復帰先（コード） | `js/auth-providers.js` の復帰先は `window.location.origin + '/mypage.html'`（97・108・425 行） | コード | 確認済み |
| OAuth 復帰先（Supabase Auth の許可リスト・Site URL） | 認証設定の読み取り手段が無い | — | **未確認** |
| 進行中の案件 | open PR：#46・#44・#42（SEO・draft）、#19（完全解析サンプル）、#17（QUICK REPORT Phase A）。どれも α とファイルが重ならない | GitHub | 確認済み |
| デザイン参照画像「5年後の自分と話すUI.png」 | リポジトリに無い。落ち着いた夜の配色（濃紺・月光色・淡い金）を仮定して作成 | — | **未確認** |

## 2. 対象ファイルと差分

基準 `a68df087` からの差分は `alpha/ideal-self/` の中だけ（既存 ETI・DTI・ビルド・`vercel.json`・`package.json` に変更なし。`tests/isolation.test.js` で自動確認）。

```
alpha/ideal-self/
  README.md  package.json  index.html  styles.css
  src/      catalog.js questions.js adaptive.js consent.js eti_import.js current.js profile.js state.js storage.js app.js
  fixtures/ synthetic_eti.js
  scripts/  serve.js export-questions.js export-samples.js
  tests/    helpers.js eti_import.test.js profile.test.js adaptive_state.test.js isolation.test.js e2e_mobile.test.js
  docs/     PHASE1_REPORT.md QUESTIONS_REVIEW.md samples/*.json screenshots/*.png
```

## 3. 起動手順

```bash
node alpha/ideal-self/scripts/serve.js     # → http://127.0.0.1:4173/
```

外部接続なし。127.0.0.1 のみで待ち受け、`alpha/ideal-self` の `index.html`・`styles.css`・`src/`・`fixtures/` だけを配信する。

## 4. 実装の要点

### 同意（用途ごとに区別）
- **ETI結果の転用**・**記憶の保存**：それぞれ任意のチェック。既存 ETI の規約・配信同意（consent_pairs 等）は使わない。同意版 `ISA-CONSENT-0.1.0`。
- **外部AIへの送信**：Phase 1 は機能が無いため「送信しない（固定）」と表示するだけ。変更する操作も無い。
- **撤回**：`judgeRevocation()` が派生データの扱いを判定する。ETI 撤回 → 取り込んだ値・ETI 由来の現在像を削除、下書きは「削除して作り直し」、現在像の選び直しへ。理想像の回答は ETI の値を含まないので残す。簡易質問経路の下書きは ETI 由来を含まないので残す。記憶の保存の撤回 → localStorage を削除。

### ETI 取込の境界（`src/eti_import.js`）
条件の順：同意（未選択・拒否・撤回は不可）→ 本人確認 → 所有者＝本人 → 元素診断 → 既知の版（`ETI-2.0` / `ETI-ITEM-2.0.0` / `ETI-SCORE-2.0.0` の組のみ）→ 必須値（O,C,E,A,N・5 STYLE は 0–100、VALUES 中心化値 10 軸は −4〜4）。
許可リスト方式でコピーするのは `personality`・`style`・`valuesCentered` と出所・版だけ。生回答・符号化回答・診断コード・購入情報・順位・ミラーは合成データにわざと入れてあり、取り込まれないことをテストしている。拒否されたら理由を表示し、簡易6問へ進める。

### 現在像
- ETI 経路：尺度値から規則で特性候補を出す（例：E ≤ 35 → 「一人で深く考える力」）。35〜65 の中間帯は何も出さない。VALUES は中心化値 > 0.25 の上位3軸。`inference_status: observed`。
- 簡易6問：本人の自己申告（`user_answer`）として記録し、ETI 相当の精度を主張しない。

### 理想像の質問
KEEP 4・GROW 4・EXPRESS 4 の計12問、すべて選択式・「わからない」あり。キャラクター設定式・口調選択の質問は無い（テストで確認）。基本12問が終わってから、未確定・矛盾のときだけ追加質問（最大6、合計18）。理由は画面に表示する。上限を超えた分は下書きで「未確定（質問上限）」と示す。全文と分岐条件は `docs/QUESTIONS_REVIEW.md`。

### FutureSelfProfile（`src/profile.js`）
- 固定比率の平均化ではなく、**保護特性を守ったうえで、成長・憧れを加える**制約付き生成。保護特性と逆向きになりうる成長・憧れ（例：内省 ↔ 場を明るくする力）は、本人が「手放す」を選ばない限り反転させない。未回答なら保護したまま未確定に記録。
- 必須項目：`future_horizon_years`(5)、`observed_traits`、`protected_traits`（CORE）、`growth_targets`（GROWTH：能力・現状との差・保護特性に合わせた具体的振る舞い）、`aspirational_traits`（ASPIRATION：魅力と統合のしかた・緊張）、`core_values`、`decision_principles`（下書き）、`expression_profile`（Phase 2 用の設計情報。口調プリセット不使用・尺度から性別等を推測しない・承認後の同一性固定）、`source_provenance`、`inference_status`（凡例・不明・未確定）、`persona_version`、`approval_status`（unconfirmed / needs_revision / approved）。
- 追加：`released_traits`（本人が手放すと選んだ特性）、`evaluation`（Phase 2 の3軸評価〔自分らしさ・憧れ・到達可能性〕を紐づける枠。評価UIは未実装）、`disclaimer`。
- 各要素に `inference_status` と根拠（質問・選択肢・尺度値・規則）を持たせ、画面の「出所と根拠」で確認できる。本人が選んでいない観測特性は「候補（本人未確認）」で、本人回答や保護特性としては記録しない。
- 時刻・乱数を使わない。`persona_version = ISA-RULE-0.1.0+draft.<入力のハッシュ>`。同じ入力・同じルール版で同一の下書きになる（回答順を変えても同じ）。

### 下書きの例（合成入力、`docs/samples/`）
- ETI 内向的 × 静かな存在感・揺るがない信念：「一人で深く考える力と新しい考えに惹かれる知的好奇心を保ちながら、考えを一人でまとめてから、要点を短く言葉にして伝えることができ、静かな存在感と揺るがない信念を備えた人物。」
- 同じ現在像 × 包容力・頼れる実行力：「相手の立場をまず理解しようとする姿勢と目立たなくても役割を支え続ける責任感を保ちながら、…包容力と頼れる実行力を備えた人物。」
- ETI 内向的 × 場を明るくする力（確認は未回答）：内省を保護したまま「社交的に振る舞うのではなく、関わる場面を選び、短い対話を落ち着いて行う」。

## 5. スマホ画面のキャプチャ（390×844、`docs/screenshots/`）

| ファイル | 画面 |
|---|---|
| 01_consent | 説明・同意（用途別） |
| 02_current_select | 現在像の選択 |
| 03_import_rejected | 取込の拒否（欠損の例） |
| 04_current_eti | 現在像（ETI 観測） |
| 05_ideal_K1 | 理想像 K1（ETI の傾向を先頭に表示） |
| 06_draft_top / 07_draft_evidence / 08_draft_full_eti | 下書き（ETI 経路）・根拠の表示・全体 |
| 11_quick_C1 / 12_current_quick | 簡易質問・現在像（自己申告） |
| 13_draft_full_quick | 下書き（簡易質問経路）全体 |
| 14_followup_reason | 追加質問と理由の表示 |

## 6. テスト実行結果

```
node --test alpha/ideal-self/tests/*.test.js   → pass 52 / fail 0
npm test（既存スイート・変更なしの確認）        → pass 839 / fail 0 / skipped 91
```

§10・追加受入条件との対応：

| 条件 | テスト |
|---|---|
| 同意前・拒否・撤回・別の所有者・欠損・未知版（＋旧版・範囲外・本人確認前・採点版不一致）を取り込めない | `eti_import.test.js` |
| 追加質問は必要なときだけ、上限 18 を超えない | `adaptive_state.test.js` |
| 下書きに出所と版、戻る・再操作で矛盾なし | `profile.test.js`・`adaptive_state.test.js` |
| スマホ幅で両導線を下書きまで操作、外部送信なし（全リクエストを記録して 127.0.0.1 以外 0 件・CSP 違反 0・横はみ出し 0） | `e2e_mobile.test.js` |
| 差分に既存 ETI・DTI の変更なし／本番 dist に α なし／外部 URL・通信 API・分析 SDK なし | `isolation.test.js` |
| 保護特性と憧れが異なるとき単純に反転させない | `profile.test.js`（§3・反転・手放す） |
| 同じ現在像でも理想が違えば下書きが変わる／同じ入力から同じ下書き | `profile.test.js` |
| 重大な矛盾で追加質問または未確定表示／推測を本人回答・ETI 観測として記録しない | `profile.test.js`・`adaptive_state.test.js` |
| 予測・検証済み測定として表示しない | `profile.test.js`・E2E（注意書き） |

## 7. 未確認事項・判断待ち

1. **Preview の本人限定**：Vercel チームのメンバーが本人だけか未照合。Phase 1 は Preview を使わずローカル起動を既定にした。
2. **表の GRANT・Supabase Auth の復帰先許可リスト**：読み取り専用の権限では見えなかった。実データ取込を判断する前に、運営者側で確認が必要。
3. **デザイン参照画像**がリポジトリに無い。配色は仮。画像を共有いただければ合わせる。
4. **規則の閾値（65／35、中心化 0.25・上位3）と語彙**は設計上の仮説。心理測定としての妥当性は未検証。
5. **12＋6問で Big Five・STYLE・VALUES の理想像を十分に推定できるか**は未検証（仕様どおり）。
6. **簡易6問で ETI 相当の測定はできない**（画面・データとも自己申告として扱っている）。
7. 実データ取込方法・LLM 提供先と保持期間・約束の期限と変更待機期間は、指示書 §12 のとおり未確定のまま。
8. 作業ブランチを `release-c-preview` の位置から main 基準に付け替えた（ブランチ上に本作業以外のコミットは無かった。`release-c-preview` 自体は変更していない）。
