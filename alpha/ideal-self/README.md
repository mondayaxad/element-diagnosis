# Ideal Self Agent α — Phase 1・2

本人1名向け・非公開・合成データ・外部送信なし。
Phase 1：説明・同意 → 現在像 → 理想像の質問 → 5年後の自分の下書き。
Phase 2：初対面（固定の仮アバター）→ 3軸評価 → 見直しまたは承認（版の固定）→ 短い模擬対話（ルールベース）。

- 本番ビルド（`scripts/build-public.js`）の許可リストに入っていないため、Vercel の dist には含まれない（`tests/isolation.test.js` で確認）。
- LLM・画像生成・実アカウント接続・チャット・決済は無い。画面の CSP で外部への通信を禁止している。

## 起動（ローカル・外部接続なし）

```bash
node alpha/ideal-self/scripts/serve.js        # http://127.0.0.1:4173/ （127.0.0.1 のみで待ち受け）
```

スマホ実機で見る場合は、同じ PC の Chrome DevTools のデバイス表示（390×844 など）を使う。LAN に公開する設定は入れていない。

## テスト

```bash
node --test alpha/ideal-self/tests/*.test.js   # 単体・状態遷移・隔離・スマホ E2E（Playwright があれば）
ISA_SAVE_SHOTS=1 node --test alpha/ideal-self/tests/e2e_mobile.test.js   # 提出用キャプチャを docs/screenshots に更新
node alpha/ideal-self/scripts/export-questions.js > alpha/ideal-self/docs/QUESTIONS_REVIEW.md   # 質問レビュー資料
node alpha/ideal-self/scripts/export-samples.js # 合成入力からの下書き例（docs/samples/）
```

## 構成

| ファイル | 役割 |
|---|---|
| `src/catalog.js` | 特性・能力・魅力・価値観の語彙、ETI→特性候補の規則、反転リスクの組（ルール版） |
| `src/questions.js` | 簡易6問・理想12問（KEEP/GROW/EXPRESS）と設問意図 |
| `src/adaptive.js` | 追加質問（最大6問）の判定と理由 |
| `src/consent.js` | 用途別の同意（ETI転用・記憶の保存・外部AI＝Phase 1 は送信しない固定）、撤回時の派生データ判定 |
| `src/eti_import.js` | ETI v2 取込の境界（本人確認・同意・所有者・版・欠損） |
| `src/current.js` | 現在像（ETI 観測／簡易質問の自己申告） |
| `src/profile.js` | `FutureSelfProfile` のルール生成（決定的） |
| `src/state.js` | 画面の状態遷移（純粋関数。戻る・再操作・撤回・Phase 2 の初対面〜対話） |
| `src/persona.js` | 固定の仮アバター、初対面の台詞、3軸評価と見直しの理由、承認した版の固定と検証 |
| `src/dialogue.js` | 模擬対話（承認した版だけを読む・書き換えの依頼を断る） |
| `assets/avatar-placeholder.svg` | 固定の仮アバター（オリジナル） |
| `src/app.js` `index.html` `styles.css` | スマホ画面 |
| `src/storage.js` | 「記憶の保存」に同意したときだけ localStorage |
| `fixtures/synthetic_eti.js` | 合成 ETI 記録（本人・他者・欠損・旧版・未知版） |
| `docs/PHASE1_REPORT.md`・`docs/PHASE2_REPORT.md` | 提出物（環境照合・差分・テスト結果・未確認事項） |
