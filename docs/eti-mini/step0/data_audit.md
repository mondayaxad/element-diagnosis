# 元素診断 Mini — Step 0 データ監査

- 作成日：2026-11-05／作成：Claude Code（調査のみ。実装・コミット・デプロイ・既存ファイルの変更なし）
- 生成：`node docs/eti-mini/step0/tools/build_step0.js`（既存 `js/*.js` を index.html と同じ順で1つの vm に読み込み、正本の定数と関数をそのまま呼び出して抽出・検証する）
- 表記の区別：**[事実]** コードやデータからの抽出／**[推定]** Claude の解釈／**[未確定]** 外部での検証が必要

---

## 0. 正本の特定（ブランチ・コミット・Vercel）

| 項目 | 値 | 区分 |
|---|---|---|
| Vercel プロジェクト | `element-diagnosis`（prj_hPjAy6n0D9LL6yaAtIw2fdMWsNUH） | [事実] Vercel API（読み取りのみ） |
| **本番（production）** | `main` @ `eba2768`（PR #18 paypay-checkout のマージ）。デプロイは dpl_HseA9E4…、状態 READY | [事実] |
| このセッションのチェックアウト | `release-c-preview` @ `9e6b77b`（detached）。main より 6 コミット進んでいる（「以前の結果から読むタイプ別レポート」、returning-travelers） | [事実] |
| Preview | ブランチごとにデプロイ（直近は paypay-checkout、jagan-preview 等）。`release-c-preview` / `type-reading-preview` は同じ `9e6b77b` | [事実] |
| **調査対象の9ファイル** | **main と HEAD で同一**（`git diff origin/main HEAD` の差分なし）。最終変更はどれも `580f270`（2026-10-21） | [事実] |
| HEAD と main の差分 | `index.html`（+118行）、`js/eti_type_reading.js`、`js/type_reading_chars.js`、`js/type_reading_text.js` のみ | [事実] |
| ルート直下の旧 JS | `ETI_v2_QUESTIONS_100.js`、`eti_v2_engine.js`、`characters118_v2.js` などは js/ 版と**内容が異なる旧版**。`scripts/build-public.js` で配信対象から外されている → **正本にしない** | [事実] |

sha256（先頭12桁）：QUESTIONS `6c602439e0bf` / prototypes `35d45e433f56` / engine `a49696b34497` / chars 2.0.1 `8a4db1bf733b` / chars 2.1.0 `a5b368ff8206` / selection `d7fb3bd8f303` / resolver `031c7f9d54ed` / adapter `30f988fcc06f`。全桁は `validation_log.json` に記録。

## 1. ソースと定数・関数

| ファイル | 定数・関数 | 件数・版 |
|---|---|---|
| js/ETI_v2_QUESTIONS_100.js | `ETI_V2_META`、`ETI_V2_QUESTIONS` | 100問。版：ETI-2.0 / ETI-ITEM-2.0.0 / ETI-SCORE-2.0.0 / ETI-TRANS-2.0.0 / ETI-CHAR-2.1.0 / ETI-MIRROR-2.1.0。軸：P 5・S 5・V 10 |
| js/eti_v2_prototypes.js | `ELEMENT_PROTOTYPES_V2`（7）、`WEAPON_PROTOTYPES_V2`（5）、`NATION_PROTOTYPES_V2`（8）、`TRANSLATION_MODEL_VERSION` | 整数 0..100 |
| js/eti_v2_engine.js | `ETIv2.{computeResultsV2, computeMirrorV2, rankByDistance, rankNationsByCenteredValues, prototypeDistance, validate/encode/decodeAnswersV2}` | — |
| js/eti_v2_answer_collection.js | `answersV2`、`selectAnswerV2`、`finalizeAnswersV2` | 100問の UI 状態。**Mini では使わない** |
| js/characters118_v2.js | `ETI_V2_CHARACTERS`（ETI-CHAR-2.0.1） | 118。旧版（ETI-MIRROR-2.0.2 用）。**`module.exports` が無いため Node から `require` できない**（vm での読み込みが必要） |
| js/characters118_v2_1.js | `ETI_V2_CHARACTERS_2_1_0`（ETI-CHAR-2.1.0） | 118。**現行**。`module.exports` あり |
| js/eti_mirror_selection_v21.js | `ETIMirrorSelectionV21.selectMirrorV21` | 同率の判定幅：生スコア 1e-10pt、属性距離 1e-12 |
| js/eti_v2_mirror_resolver.js | `ETIv2MirrorResolver.{CURRENT='ETI-MIRROR-2.1.0', computeMirror, normalizedCharacters, buildMirrorSnapshot, mirrorFromSnapshot}` | — |
| js/eti_v2_legacy_adapter.js | `ETIv2LegacyAdapter.{buildV2ViewModel, displayNation}` | 表示モデル。region=null の3名は国家を出さない |
| index.html | `TYPE_NAME`、`ELEMENT_CODE`、`WEAPON_CODE`、`NATION_CODE`、`NATION_MEANING/DESC/TRAITS/VALUES`、`ELEMENT_DESC`、`WEAPON_DESC`、`TYPE_DESC`、`computeResultsV2ForUI` | 表示辞書（JS ファイルではなく HTML 内） |
| （参考）js/eti_type_reading.js | `EdTypeReading`（K=0.65、POP_MEAN＝本番797件の平均、`profileFor/rankingFor/blendFor/resultsFor`） | **Preview 専用（main には未マージ）**。「3つの選択 → 代表プロファイル」を扱う既存の唯一の実装 |

## 2. 判定式（[事実] engine の実装どおり）

- 利用者のスコア：`display = round(((mean + 2) / 4) * 100)`。direction=-1 の設問は符号を反転。
- **元素・武器**：`distance = sqrt(mean(((u − p)/100)^2))`。軸は等重み、較正なし。小さいほど近い。閾値なし。
- **国家**：u と p をそれぞれ10軸の平均で中心化し、コサイン類似度 s を取って `distance = (1 − s)/2`。u の中心化ベクトルがすべて0、またはコサインが null のときは s=0 として全国家が同点になる。判定には `results.values`（表示値）を使い、`valuesCentered` は使わない。
- **同点の順位**：`Array.prototype.sort` は安定なので、完全な同点は表の挿入順（炎>水>氷>雷>風>岩>草、片手剣>両手剣>長柄>法器>弓、モンド>璃月>稲妻>スメール>フォンテーヌ>ナタ>スネージナヤ>ナドクライ）で並ぶ。テストで確認済み。
- **MIRROR 2.1.0**：`raw = (0.40·pSim + 0.30·sSim + 0.30·vSim)·100`。ランキングは raw → pSim → sSim → vSim の降順、最後に canonicalIndex の昇順。MIRROR の選出は、raw 最大から 1e-10pt 以内を同率とし、元素1位の集合 → 国家1位の集合（事実データの region）→ 武器1位の集合 → canonicalIndex 最小、の順で絞り込む。**`rankings[0]` と MIRROR は一致しないことがある。**
- **生の代表値の自己判定**：7元素・5武器・8国家すべてで、代表値を入力すると自分自身に判定される。→ Q1〜Q3 の代表値を連結すると、そのまま20軸のプロファイルとして使える。

## 3. 件数・欠損

- キャラ 118名（2.0.1・2.1.0 とも）。名前は一意で、両版で並び順と元素・武器・region が同じ。20軸すべて揃っており、整数 0..100。座標の null・欠損は0件。
- **数値の安定IDは無い**。一意キーは `name`、canonicalIndex は配列の位置。
- **region=null が3名**：ニコ・スカーク・アーロイ（audit.region_corrected=true。意図的に「国家なし」としている）。点数計算は region を見ないが、2.1.0 の同率解消では「国家一致なし」として扱われる。
  - [事実] `resolver.normalizedCharacters` は表示用に `legacy.old_nation_field` で穴埋めする（ニコ→ナタ、スカーク→スネージナヤ、アーロイ→モンド）。一方、`legacy_adapter.displayNation` と `index.html getV2CharacterDisplayRegion` はそれを外して国家を表示しない。**同じデータに対して層ごとに扱いが違う**ので、Mini では事実データの値（null）を正本にすることを推奨する[推定]。
- 表記ゆれ：キャラデータは `ナド・クライ`（9名）、判定・辞書の内部キーは `ナドクライ`。対応表は resolver の `REGION_ALIAS` と index.html の `NATION_REGION_ALIAS_V2`。
- 件数（元素）：炎18・水16・氷21・雷19・風18・岩14・草12。（武器）片手剣25・両手剣20・長柄24・法器28・弓21。（国家）モンド24・璃月22・稲妻17・スメール14・フォンテーヌ13・ナタ11・スネージナヤ5・ナドクライ9・null 3。元素×武器×国家の内訳は `characters_full.json` の `counts`。
- **レアリティ・実装Ver・英語名はリポジトリに存在しない**（全文検索で確認）。

## 4. キャラ候補（[未確定]）

- 手動選択の候補：118名すべて（座標が使えるもの 118/118）。
- 自動候補：`rarity_release_unverified.js` の暫定値で機械的に判定した。内訳は included_provisional 63、ドール候補で未確定 2（ドゥリン・サンドローネ）、未確定 1（リンネア：★4/★5 で出典が食い違う）、除外確定 1（アーロイ）、暫定除外 51。
  - 暫定値の出典は **Claude の記憶（Ver.≤5.8 の大半）** と **2026-11-05 の Web 検索の要約（6.0〜7.0）** の2つだけ。どちらも一次出典ではない。このセッションのネットワーク方針では fandom・wikiwiki・公式サイトに直接アクセスできなかった。
  - 公式での照合が必要：全118名のレアリティと実装Ver。名前の同定（ニコ=Nicole、ローエン=Lohen、ファルカ=Varka）。茲白・ファルカの元素は出典間で食い違いがある。
- 主人公：DB に存在しないので除外の作業は不要。
- **[オーナー確認 2026-11-05] イネファの武器は「長柄」が正しい**（現行の ETI-CHAR-2.1.0 と一致）。外部から渡された候補リスト（旧 `index (13).html` の CHARACTERS 由来）にあった「両手剣」は誤り。Mini の元素・武器・国家の正本は ETI-CHAR-2.1.0 とする。
- **『ドール』**：この表記はリポジトリに無い。候補はドゥリン（音が近い・★5）、サンドローネ（「人形」の異名・★5）、ドリー（表記が近い・★4）、ダリア（★4）。★4の2名なら★5候補への影響は無い。★5の2名のどちらかなら候補数が変わる。**オーナーの確認が必要。ドリーとは確定していない。**
- [事実・参考測定] 生の代表値を連結して 280 通りの MIRROR を計算すると、選ばれるキャラは 58 名、一度も選ばれないキャラは 60 名。最多は香菱 15・辛炎 14・煙緋 12・ネフェル 12。**アーロイが 11 通りで1位になる**ので、除外の実装は必須。raw 同率は0件。これは判断材料であり、採用案ではない。

## 5. 決定性（入力が同じなら出力も同じにするために洗い出した項目）

| # | 箇所 | 内容 | Mini での扱い |
|---|---|---|---|
| D1 | `resolver.displayVersionForSaved()` は常に CURRENT、`versionFromUrlParam()` は不明な値を CURRENT として扱う | 保存済みの記録を**表示時に最新版で再計算する**仕組み。版が上がると過去の結果が変わる | Mini の購入結果は版を固定し、スナップショットを正本にする |
| D2 | `normalizedCharacters` の cache と `configure()` | 依存を差し込むと cache が消える。テストでは要注意 | 純粋関数として包む |
| D3 | 同点の扱い | 挿入順・canonicalIndex・ε（1e-10pt / 1e-12）に依存。表の並びを変えると結果が変わる | 版に表の並びも含めて凍結する |
| D4 | 浮動小数点 | sqrt・cos・加算の順序は固定で、IEEE754 の範囲では決定的。丸めの前に並べ替えている | 結果テーブルは事前計算して保存（280×119） |
| D5 | MIRROR の参照が名前キー（`vm.mirror` は name で検索） | 名前の変更・表記ゆれに弱い | 版と canonicalIndex を併記する |
| D6 | region の3つの扱い（事実の null／表示用の穴埋め／adapter で除去） | 同率解消と表示で値が変わる | 事実データの値に統一 |
| D7 | Math.random・Date・storage | 判定経路（9ファイル）には無い。grep で確認 | — |
| D8 | ルート直下の旧 JS | 中身が違う同名ファイルがある | `js/` のみ参照 |

## 6. 既存関数の呼び出し方（Node／ブラウザ共通）

```js
// ブラウザ：index.html と同じ順で <script> を読み込む（dependency_map.md 参照）
var raw = ETIv2.computeResultsV2(answers, { elementPrototypes: ELEMENT_PROTOTYPES_V2, weaponPrototypes: WEAPON_PROTOTYPES_V2, nationPrototypes: NATION_PROTOTYPES_V2 }); // 100問用
// Mini 向け：プロファイル（20軸）を直接渡す
var el = ETIv2.rankByDistance(ELEMENT_PROTOTYPES_V2, profile.personality, ETI_V2_META.personalityAxes).ranking[0].name;
var w  = ETIv2.rankByDistance(WEAPON_PROTOTYPES_V2, profile.style, ETI_V2_META.styleAxes).ranking[0].name;
var n  = ETIv2.rankNationsByCenteredValues(NATION_PROTOTYPES_V2, profile.values, ETI_V2_META.valueAxes).ranking[0].name;
var m  = ETIv2MirrorResolver.computeMirror({ personality, style, values }, 'ETI-MIRROR-2.1.0'); // m.mirror（rankings[0] ではない）
```

Node では `characters118_v2.js` を `require` できない（export が無い）。`build_step0.js` と同じく、vm で連結して読み込むか、`ETIv2MirrorResolver.configure({ETI_V2_CHARACTERS_2_1_0, ETIv2, ETI_V2_META, ETIMirrorSelectionV21, *_PROTOTYPES_V2})` で依存を差し込む。2.1.0 だけを使うなら 2.0.1 は不要。

## 7. 未確定事項（要決定・要検証）

1. キャラのレアリティと実装Ver（118名分）：公式出典での検証が必要。
2. 『ドール』が誰を指すか。
3. Mini の代表座標：生の代表値を使うか、縮めたもの（既存 preview の K=0.65）を使うか、別の方式にするか → ChatGPT が決める。
4. キャラ選択ありのときの結合比率と同率の処理 → ChatGPT が指定。
5. 表示名「ナド・クライ」：現行の index は内部キー「ナドクライ」をそのまま表示している。Mini では表示時だけ変換する必要がある。
6. region=null の3名を国家の表示でどう扱うか（現行の UI は「出さない」）。
7. 自動候補にアーロイ以外の恒常★5（ディルック・ジン・モナ・七七・刻晴・ティナリ・ディシア・夢見月瑞希）を含めるか。仕様の文言の上では含まれる[推定]。
8. report.html の `NATION_DESC`、`ELEMENT_DESC`、`WEAPON_DESC`、`NATION_VALUES` は index.html と文面が違う（`display_dictionary.json` の `other_pages_diff_vs_index_html`）。Mini でどちらを正本にするか。

## 8. 購入後の再閲覧（既存の仕組み・課題。実装はしない）

- 候補 A：`lib/link-purchase.js` の**レポート固有リンク**（`/report-link#t=<256bit>`。DB にはハッシュのみ、Cookie `__Host-ed_rl` で受け渡し、開くたびに権利を確認し、短時間有効の閲覧 URL を発行）。ログイン不要で、マイページへの登録は任意。→ Mini の「マイページ連携なし・再閲覧可」に最も近い。
  - 課題：購入の対象は `diagnosis_sessions`（100問の回答コードから、サーバーが正本エンジンで再計算して作る記録）が前提になっている。Mini には100問の回答が無いので、**新しい記録の種類（Mini 回答3ID＋キャラID）と、サーバー側でそれを再計算する処理**が必要になる。商品・価格の定義（`PRODUCTS` は analysis・direct_complete）の追加、Cookie を失ったときの再発行（`link-regenerate` は秘密値の所持が前提）も検討が要る。
- 候補 B：`result_resume_links`（`#r=`、180日でスライド延長）。対象は無料結果のみで、有料の閲覧は別途権利を確認する。
- 候補 C：メールでの再送（`docs/email-templates`）。個人情報が増えるので最小化の方針と相反する。

## 9. 変更していないことの確認

- 既存ファイルの変更なし（`git status` で増えたのは `docs/eti-mini/` のみ）。コミットなし、プッシュなし。
- Vercel／Supabase／Stripe への書き込みなし（Vercel は一覧の読み取りのみ）。課金 API の呼び出しなし。
