# 元素診断 Mini — Step 0 依存関係マップ

区分：[事実] コード／[推定] Claude 案（数式・重みは含まない）

## 1. ロード順と依存（[事実] index.html L488–496）

```
① js/ETI_v2_QUESTIONS_100.js   → const ETI_V2_META, ETI_V2_QUESTIONS
② js/eti_v2_prototypes.js      → const ELEMENT/WEAPON/NATION_PROTOTYPES_V2, TRANSLATION_MODEL_VERSION
③ js/eti_v2_engine.js          → var ETIv2            （①を素の識別子で参照：既定引数）
④ js/eti_v2_answer_collection  → var answersV2 …      （①③。Mini 不要）
⑤ js/characters118_v2.js       → const ETI_V2_CHARACTERS        （2.0.1・export なし。2.1.0 だけなら不要*）
⑥ js/characters118_v2_1.js     → const ETI_V2_CHARACTERS_2_1_0  （2.1.0）
⑦ js/eti_mirror_selection_v21  → var ETIMirrorSelectionV21      （依存は引数で受け取る＝純粋）
⑧ js/eti_v2_mirror_resolver.js → window.ETIv2MirrorResolver     （①②③⑤⑥⑦を typeof で遅延参照／configure() で差し込み）
⑨ js/eti_v2_legacy_adapter.js  → window.ETIv2LegacyAdapter      （⑤⑥を displayNation で参照）
   index.html                  → TYPE_NAME / *_CODE / NATION_* 辞書, computeResultsV2ForUI（③⑧⑨）
   (preview) js/eti_type_reading.js → EdTypeReading（②③⑧ を参照）
```
\* resolver の `models()` は両方の版を参照する。ただし 2.1.0 だけを計算するなら ⑤ が undefined でも動く（`normalizedCharacters` はその版の配列しか触らないため）。

```
              ┌────────────── ETI_V2_META(axes) ──────────────┐
 PROTOTYPES ──┤                                               │
              ▼                                               ▼
   ETIv2.rankByDistance / rankNationsByCenteredValues   ETIv2.computeMirrorV2(profile, chars, meta)
              │  (element/weapon/nation top set)              │ rankings(raw順)
              └──────────────► ETIMirrorSelectionV21.selectMirrorV21 ◄──┘
                                          │ mirror
                         ETIv2MirrorResolver.computeMirror(profile, 'ETI-MIRROR-2.1.0')
                                          │
                     buildMirrorSnapshot / LegacyAdapter.buildV2ViewModel → index.html 表示
```

## 2. 純粋関数として再利用できるか（[事実]＋[推定]）

| 関数 | 純粋性 | 備考 |
|---|---|---|
| `ETIv2.rankByDistance`, `rankNationsByCenteredValues`, `prototypeDistance`, `computeMirrorV2` | ◎ 引数のみ（meta の既定値だけ①に依存） | meta を明示して渡せば完全に純粋 |
| `ETIMirrorSelectionV21.*` | ◎ 依存はすべて引数 | — |
| `ETIv2MirrorResolver.computeMirror` | ○ グローバルの遅延参照＋モジュール内 cache | `configure()` で差し込み可能。cache は版ごとで決定的 |
| `ETIv2.computeResultsV2` | ○ ただし100問の検証が必須 | Mini では使わない（20軸プロファイルを直接ランク関数へ渡す） |
| `EdTypeReading.*`（preview） | ○ | 既存の「3選択→代表プロファイル」。採否は ChatGPT 判断 |
| index.html の辞書 | △ HTML 内の const | Mini では JSON 化して版を付けるのが安全[推定] |

## 3. 280固定結果テーブルのスキーマ案（[推定]。数式・重みは決めない）

```jsonc
// mini_result_table.<MINI_MODEL_VERSION>.json
{
  "mini_model_version": "ETI-MINI-x.y.z",       // 本表の版
  "depends_on": { "translation": "ETI-TRANS-2.0.0", "character_profile": "ETI-CHAR-2.1.0",
                  "mirror": "ETI-MIRROR-2.1.0", "prototype_sha256": "35d45e43…", "chars_sha256": "a5b368ff…",
                  "combine_rule_version": "TBD(ChatGPT)", "auto_pick_rule_version": "TBD(ChatGPT)",
                  "auto_candidate_list_version": "TBD（レアリティ検証後）" },
  "inputs": { "q1": ["E01".."E07"], "q2": ["W01".."W05"], "q3": ["N01".."N08"],
              "character": "null | canonicalIndex(0..117)" },   // 回答IDは表示文言から独立した安定ID
  "rows": [ {
      "key": "E03-W01-N07-null",               // 280 × (1 + 118) = 33,320 行（キャラ選択ありを事前計算する場合）
      "q1": "E03", "q2": "W01", "q3": "N07", "character": null,
      "final": { "element": "氷", "weapon": "片手剣", "nation": "スネージナヤ",
                 "type_code4": "CRSW", "type_code": "CRSW-Z", "type_name": "宿縁者" },
      "character_result": { "canonicalIndex": 34, "name": "オデット", "selected_by": "auto|user" },
      "tie_trace": [ /* 同率解消の経路（数値は保存しても表示しない） */ ]
  } ]
}
```
- テーブルを事前計算すれば、ブラウザと API で同じ値を参照できる。テーブル自体の sha256 を版に含める。
- 数値（距離・類似率）を保持するかどうかは任意。保持しても表示には使わない（仕様5）。

## 4. 購入時スナップショット案（[推定]。個人情報は最小化）

```jsonc
{
  "snapshot_version": "ETI-MINI-SNAP-1",
  "purchase_id": "uuid（注文ID。Stripe ID・メールは含めない）",
  "created_at": "2026-11-05T00:00:00Z",
  "answers": { "q1": "E03", "q2": "W01", "q3": "N07" },
  "character_input": null,                       // または { "canonicalIndex": 34, "name": "オデット" }
  "versions": { "mini_model": "ETI-MINI-x.y.z", "mirror": "ETI-MIRROR-2.1.0", "character_profile": "ETI-CHAR-2.1.0",
                "translation": "ETI-TRANS-2.0.0", "result_table_sha256": "…", "report_text_version": "MINI-TEXT-x" },
  "final": { "element": "氷", "weapon": "片手剣", "nation_key": "スネージナヤ", "nation_display": "スネージナヤ",
             "type_code": "CRSW-Z", "type_name": "宿縁者",
             "character": { "canonicalIndex": 34, "name": "オデット", "selected_by": "auto" } },
  "report_body_sha256": "…"                      // 生成文を保存する場合は本文＋ハッシュ
}
```
- 閲覧するときは**再計算せずにスナップショットを表示する**（既存の resolver が持つ「表示時に最新版で再計算する」方針 D1 を避けるため）。
- 決済情報は既存の `complete_orders` / Stripe 側に置き、スナップショットには注文ID以外を持たせない。

## 5. 再閲覧（マイページ連携なし）の既存候補

`data_audit.md` §8 を参照。最も近いのは `lib/link-purchase.js` のレポート固有リンク（`#t=`、ハッシュのみ保存、Cookie、毎回の権利確認）。ただし、診断記録は100問の回答コードが前提なので、Mini 用の記録の種類とサーバー側の再計算処理を追加する必要がある。
