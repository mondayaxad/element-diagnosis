#!/usr/bin/env node
// build_step0.js — 元素診断 Mini Step 0 の調査データを、既存ファイルを一切変更せずに抽出・検証する。
//   実行: node docs/eti-mini/step0/tools/build_step0.js
//   出力: docs/eti-mini/step0/*.json（上書き）と、標準出力の検証ログ。
// 方針: 既存の js/*.js を index.html と同じ順序で、1つの vm コンテキスト（ブラウザの classic script と同じ
//       トップレベル字句スコープ共有）に読み込み、実際の定数・関数をそのまま使う。値の手書き転記はしない。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const OUT = path.join(__dirname, '..');
const LOAD_ORDER = [ // index.html の <script src> 順（L488-496）
  'js/ETI_v2_QUESTIONS_100.js',
  'js/eti_v2_prototypes.js',
  'js/eti_v2_engine.js',
  'js/eti_v2_answer_collection.js',
  'js/characters118_v2.js',
  'js/characters118_v2_1.js',
  'js/eti_mirror_selection_v21.js',
  'js/eti_v2_mirror_resolver.js',
  'js/eti_v2_legacy_adapter.js',
];
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail }); }

// ---------- 1. 正本ファイルを index.html の順で読み込む ----------
const ctx = { console };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
const src = LOAD_ORDER.map(p => '\n// ---- ' + p + '\n' + fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
// module を未定義にしたまま（ブラウザと同じ）。const を外から取れるよう最後に1回だけ露出させる。
vm.runInContext(src + `
;globalThis.__X = { ETI_V2_META, ETI_V2_QUESTIONS, TRANSLATION_MODEL_VERSION, ELEMENT_PROTOTYPES_V2, WEAPON_PROTOTYPES_V2,
  NATION_PROTOTYPES_V2, ETIv2, ETI_V2_CHARACTERS, ETI_V2_CHARACTERS_2_1_0, ETIMirrorSelectionV21,
  ETIv2MirrorResolver: globalThis.ETIv2MirrorResolver, ETIv2LegacyAdapter: globalThis.ETIv2LegacyAdapter };`, ctx, { filename: 'index-load-order.js' });
const X = ctx.__X;
const META = X.ETI_V2_META;
const R = X.ETIv2MirrorResolver;
const plain = (o) => JSON.parse(JSON.stringify(o));

// ---------- 2. index.html / report.html / mypage.html の辞書を、ソースのまま評価して取り出す ----------
function extractConst(file, name) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*');
  const m = re.exec(text);
  if (!m) return { found: false };
  let i = m.index + m[0].length; const open = text[i]; const close = open === '{' ? '}' : ']';
  let depth = 0, j = i, inStr = null;
  for (; j < text.length; j++) {
    const ch = text[j];
    if (inStr) { if (ch === '\\') { j++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === open) depth++; else if (ch === close) { depth--; if (depth === 0) break; }
  }
  const literal = text.slice(i, j + 1);
  const line = text.slice(0, m.index).split('\n').length;
  const value = vm.runInNewContext('(' + literal + ')');
  return { found: true, file, line, value: plain(value) };
}
const DICT_NAMES = ['ELEMENTS', 'WEAPONS', 'ELEMENT_CODE', 'WEAPON_CODE', 'NATION_CODE', 'TYPE_NAME', 'TYPE_DESC', 'NATIONS',
  'NATION_MEANING', 'NATION_DESC', 'NATION_TRAITS', 'NATION_VALUES', 'ELEMENT_DESC', 'ELEMENT_TRAITS', 'WEAPON_DESC',
  'WEAPON_TRAITS', 'PACK_ELEMENTS', 'PACK_WEAPONS', 'PACK_NATIONS', 'NATION_REGION_ALIAS_V2', 'SCHWARTZ_VALUE', 'TRAIT_WORD'];
const idx = {}; DICT_NAMES.forEach(n => { idx[n] = extractConst('index.html', n); });
const otherFiles = ['report.html', 'mypage.html'];
const other = {};
otherFiles.forEach(f => { other[f] = {}; ['NATION_MEANING', 'NATION_DESC', 'NATION_TRAITS', 'NATION_VALUES', 'TYPE_NAME', 'ELEMENT_CODE', 'WEAPON_CODE', 'NATION_CODE', 'ELEMENT_DESC', 'WEAPON_DESC', 'REPORT_NATION_MEANING'].forEach(n => { const r = extractConst(f, n); if (r.found) other[f][n] = r; }); });

// ---------- 3. 構造の検証 ----------
const ELEMENTS = Object.keys(X.ELEMENT_PROTOTYPES_V2);
const WEAPONS = Object.keys(X.WEAPON_PROTOTYPES_V2);
const NATIONS = Object.keys(X.NATION_PROTOTYPES_V2);
check('element prototypes = 7', ELEMENTS.length === 7, ELEMENTS);
check('weapon prototypes = 5', WEAPONS.length === 5, WEAPONS);
check('nation prototypes = 8', NATIONS.length === 8, NATIONS);
const axisCheck = (tbl, axes) => Object.values(tbl).every(p => JSON.stringify(Object.keys(p)) === JSON.stringify(axes) && Object.values(p).every(v => Number.isInteger(v) && v >= 0 && v <= 100));
check('element prototype keys == META.personalityAxes, int 0..100', axisCheck(X.ELEMENT_PROTOTYPES_V2, META.personalityAxes));
check('weapon prototype keys == META.styleAxes, int 0..100', axisCheck(X.WEAPON_PROTOTYPES_V2, META.styleAxes));
check('nation prototype keys == META.valueAxes, int 0..100', axisCheck(X.NATION_PROTOTYPES_V2, META.valueAxes));
check('7x5x8 = 280', ELEMENTS.length * WEAPONS.length * NATIONS.length === 280);
const TN = idx.TYPE_NAME.value;
const typeList = [];
ELEMENTS.forEach(e => WEAPONS.forEach(w => typeList.push({ element: e, weapon: w, code4: idx.ELEMENT_CODE.value[e] + idx.WEAPON_CODE.value[w], name: TN[e] && TN[e][w] })));
check('TYPE_NAME covers 35 element×weapon', typeList.every(t => typeof t.name === 'string' && t.name.length > 0) && typeList.length === 35);
check('35 type names unique', new Set(typeList.map(t => t.name)).size === 35);
check('35 type codes unique', new Set(typeList.map(t => t.code4)).size === 35);
check('NATION_CODE covers 8 prototype nations (internal keys)', NATIONS.every(n => idx.NATION_CODE.value[n]) && Object.keys(idx.NATION_CODE.value).length === 8);
const typeFiles = fs.readdirSync(path.join(ROOT, 'type')).filter(f => f.endsWith('.html'));
check('type/*.html = 35 and match code4 (lowercase)', typeFiles.length === 35 && typeList.every(t => typeFiles.includes(t.code4.toLowerCase() + '.html')));
const typePageTitleMismatch = typeList.filter(t => { const h = fs.readFileSync(path.join(ROOT, 'type', t.code4.toLowerCase() + '.html'), 'utf8'); return !h.includes('「' + t.name + '」(' + t.code4 + ')'); }).map(t => t.code4);
check('type/*.html <title> contains 「name」(CODE)', typePageTitleMismatch.length === 0, typePageTitleMismatch);
['NATION_MEANING', 'NATION_DESC', 'NATION_TRAITS', 'NATION_VALUES'].forEach(n => check('index.html ' + n + ' keys == 8 prototype nations', JSON.stringify(Object.keys(idx[n].value).sort()) === JSON.stringify(NATIONS.slice().sort()), Object.keys(idx[n].value)));
check('NATION_MEANING[ナドクライ] == 月光', idx.NATION_MEANING.value['ナドクライ'] === '月光');

// ---------- 4. キャラクター ----------
const C21 = X.ETI_V2_CHARACTERS_2_1_0, C201 = X.ETI_V2_CHARACTERS;
const RAR = require('./rarity_release_unverified.js');
const chkChar = (c) => ['personality', 'style', 'values'].every(d => {
  const axes = d === 'personality' ? META.personalityAxes : d === 'style' ? META.styleAxes : META.valueAxes;
  return c[d] && JSON.stringify(Object.keys(c[d])) === JSON.stringify(axes) && axes.every(a => Number.isFinite(c[d][a]) && c[d][a] >= 0 && c[d][a] <= 100);
});
check('ETI-CHAR-2.1.0 count = 118', C21.length === 118, C21.length);
check('ETI-CHAR-2.0.1 count = 118', C201.length === 118, C201.length);
check('2.1.0 all 20 axes present, finite, 0..100, canonical key order', C21.every(chkChar), C21.filter(c => !chkChar(c)).map(c => c.name));
check('2.1.0 names unique', new Set(C21.map(c => c.name)).size === 118);
check('2.1.0 element ∈ 7 prototypes', C21.every(c => ELEMENTS.includes(c.element)));
check('2.1.0 weapon ∈ 5 prototypes', C21.every(c => WEAPONS.includes(c.weapon)));
const regionVals = [...new Set(C21.map(c => c.region))];
check('2.1.0 region ∈ 8 nations (after alias) or null', C21.every(c => c.region === null || NATIONS.includes(({ 'ナド・クライ': 'ナドクライ' })[c.region] || c.region)), regionVals);
check('2.0.1 and 2.1.0 have identical name order (canonicalIndex stable)', C21.every((c, i) => C201[i].name === c.name));
check('2.0.1 and 2.1.0 identical element/weapon/region', C21.every((c, i) => C201[i].element === c.element && C201[i].weapon === c.weapon && C201[i].region === c.region));
check('all 118 have a rarity/release entry in the UNVERIFIED table', C21.every(c => RAR[c.name]), C21.filter(c => !RAR[c.name]).map(c => c.name));
check('UNVERIFIED table has no extra names', Object.keys(RAR).every(n => C21.some(c => c.name === n)), Object.keys(RAR).filter(n => !C21.some(c => c.name === n)));
const notIntegers = C21.filter(c => ['personality', 'style', 'values'].some(d => Object.values(c[d]).some(v => !Number.isInteger(v)))).map(c => c.name);
check('2.1.0 coordinates are integers', notIntegers.length === 0, notIntegers);
const normalized = R.normalizedCharacters(R.CURRENT);
const regionDisplayDiff = C21.map((c, i) => ({ name: c.name, factual: c.region, resolverNormalized: normalized[i].region })).filter(r => r.factual !== r.resolverNormalized);

const verCmp = (v) => v.split('.').map(Number).reduce((a, b, i) => a + b * (i === 0 ? 100 : 1), 0);
const charsFull = C21.map((c, i) => {
  const r = RAR[c.name] || [null, null, null, null];
  return {
    canonicalIndex: i,
    key: c.name, // 現行コードの一意キー（名前）。数値IDフィールドはデータに存在しない
    name: c.name,
    wiki_name: c.wiki_name,
    element: c.element,
    weapon: c.weapon,
    region_factual: c.region,
    region_internal_key: c.region === null ? null : (({ 'ナド・クライ': 'ナドクライ' })[c.region] || c.region),
    region_resolver_normalized: normalized[i].region,
    legacy_old_nation_field: c.legacy && c.legacy.old_nation_field,
    audit: c.audit,
    profile_version: c.profile_version,
    evidence_confidence: c.evidence_confidence,
    source_url: c.source_url,
    basis_tags: c.basis_tags,
    personality: c.personality,
    style: c.style,
    values: c.values,
    coordinates_2_0_1: { personality: C201[i].personality, style: C201[i].style, values: C201[i].values },
    rarity: { value: r[0], status: 'unverified', source: r[2], note: r[3] || null },
    release_version: { value: r[1], status: 'unverified', source: r[2] },
  };
});

// 自動候補（暫定）：rarity=5 かつ release<=7.0、アーロイ除外、主人公は DB に不在、『ドール』は未確定
const DOLL_CANDIDATES = ['ドゥリン', 'ドリー', 'ダリア', 'サンドローネ'];
const autoRows = charsFull.map(c => {
  const reasons = [];
  let decision;
  if (c.name === 'アーロイ') { decision = 'excluded_confirmed'; reasons.push('指示書の明確な除外（アーロイ）'); }
  else if (c.rarity.value === null) { decision = 'undetermined'; reasons.push('レアリティ不明（出典間で食い違い）'); }
  else if (c.rarity.value !== 5) { decision = 'excluded_provisional'; reasons.push('★' + c.rarity.value + '（未検証）'); }
  else if (verCmp(c.release_version.value) > verCmp('7.0')) { decision = 'excluded_provisional'; reasons.push('Ver.7.0 より後（未検証）'); }
  else { decision = 'included_provisional'; reasons.push('★5・Ver.' + c.release_version.value + '（未検証: ' + c.rarity.source + '）'); }
  if (c.name === 'オデット') reasons.push('指示書で「オデットを含む★5」と明記');
  if (DOLL_CANDIDATES.includes(c.name)) { reasons.push('『ドール』指定の同定候補。確定するまで除外有無は未確定'); if (decision === 'included_provisional') decision = 'undetermined_doll_candidate'; }
  if (c.region_factual === null && c.name !== 'アーロイ') reasons.push('region が null（国家一致の同率解消では一致なし扱い）');
  return { canonicalIndex: c.canonicalIndex, key: c.key, name: c.name, element: c.element, weapon: c.weapon, region_internal_key: c.region_internal_key,
    rarity: c.rarity.value, release_version: c.release_version.value, data_source: c.rarity.source, decision, reasons };
});
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});

// ---------- 5. 判定関数の挙動（正本関数を直接呼ぶ。新しい式は作らない） ----------
const E = X.ETIv2;
const selfClass = {
  element: ELEMENTS.map(e => { const r = E.rankByDistance(X.ELEMENT_PROTOTYPES_V2, X.ELEMENT_PROTOTYPES_V2[e], META.personalityAxes); return { input: e, top: r.ranking[0].name, d0: r.ranking[0].distance, second: r.ranking[1].name, d1: +r.ranking[1].distance.toFixed(6) }; }),
  weapon: WEAPONS.map(w => { const r = E.rankByDistance(X.WEAPON_PROTOTYPES_V2, X.WEAPON_PROTOTYPES_V2[w], META.styleAxes); return { input: w, top: r.ranking[0].name, d0: r.ranking[0].distance, second: r.ranking[1].name, d1: +r.ranking[1].distance.toFixed(6) }; }),
  nation: NATIONS.map(n => { const r = E.rankNationsByCenteredValues(X.NATION_PROTOTYPES_V2, X.NATION_PROTOTYPES_V2[n], META.valueAxes); return { input: n, top: r.ranking[0].name, d0: +r.ranking[0].distance.toFixed(12), second: r.ranking[1].name, d1: +r.ranking[1].distance.toFixed(6) }; }),
};
check('each raw element prototype classifies to itself', selfClass.element.every(r => r.top === r.input));
check('each raw weapon prototype classifies to itself', selfClass.weapon.every(r => r.top === r.input));
check('each raw nation prototype classifies to itself', selfClass.nation.every(r => r.top === r.input));
// 同点の順序：rankByDistance は Array.prototype.sort（安定）＝Object.entries の挿入順で同点を並べる
const tieProbeE = E.rankByDistance({ A: { O: 50 }, B: { O: 50 } }, { O: 50 }, ['O']).ranking.map(r => r.name);
const tieProbeEr = E.rankByDistance({ B: { O: 50 }, A: { O: 50 } }, { O: 50 }, ['O']).ranking.map(r => r.name);
check('rankByDistance exact tie keeps table insertion order (stable sort)', tieProbeE.join() === 'A,B' && tieProbeEr.join() === 'B,A');
// 決定性：同じ入力で2回計算して一致するか（正本の computeMirror）
const probe = { personality: X.ELEMENT_PROTOTYPES_V2['炎'], style: X.WEAPON_PROTOTYPES_V2['片手剣'], values: X.NATION_PROTOTYPES_V2['モンド'] };
const m1 = R.computeMirror(probe, R.CURRENT), m2 = R.computeMirror(probe, R.CURRENT);
check('computeMirror deterministic for same input (2 runs)', JSON.stringify(m1) === JSON.stringify(m2));

// 参考測定（判断材料。採用案ではない）：生の代表値を3回答の代表座標にした場合、280通りの MIRROR 1位
const ref280 = [];
ELEMENTS.forEach(e => WEAPONS.forEach(w => NATIONS.forEach(n => {
  const p = { personality: X.ELEMENT_PROTOTYPES_V2[e], style: X.WEAPON_PROTOTYPES_V2[w], values: X.NATION_PROTOTYPES_V2[n] };
  const m = R.computeMirror(p, R.CURRENT);
  ref280.push({ e, w, n, mirror: m.mirror.name, selectedBy: m.selectionMeta.selectedBy, tied: m.selectionMeta.tiedAtTopCount });
})));
const refDist = count(ref280, r => r.mirror);
const refSorted = Object.entries(refDist).sort((a, b) => b[1] - a[1]);
const tiesAtTop = ref280.filter(r => r.tied > 1).length;

// ---------- 6. 出力 ----------
const sources = Object.fromEntries(LOAD_ORDER.concat(['index.html', 'report.html', 'mypage.html', 'js/eti_type_reading.js']).map(p => [p, sha(p)]));
const header = (title) => ({
  _title: title,
  _generated_by: 'docs/eti-mini/step0/tools/build_step0.js',
  _generated_at: new Date().toISOString().slice(0, 10),
  _repo_head: process.env.STEP0_HEAD || null,
  _legend: { fact: 'リポジトリのコード/データから機械的に抽出した値', inference: 'Claude の推定・解釈（fact と区別）', unverified: '外部検証が必要な暫定値' },
});

const prototypeOut = Object.assign(header('ETI v2 プロトタイプ座標（正本: js/eti_v2_prototypes.js）'), {
  fact: {
    translation_model_version: X.TRANSLATION_MODEL_VERSION,
    meta: { diagnosisVersion: META.diagnosisVersion, itemSetVersion: META.itemSetVersion, scoringVersion: META.scoringVersion, translationModelVersion: META.translationModelVersion, characterProfileVersion: META.characterProfileVersion, mirrorModelVersion: META.mirrorModelVersion },
    scale: { range: '0..100（整数）', user_score_formula: 'display = round(((mean(signed answers) + 2) / 4) * 100)。回答 -2..2、direction=-1 は符号反転（eti_v2_engine.js scoreSelfDomain/scoreValues）' },
    ELEMENT_PROTOTYPES_V2: {
      domain: 'PERSONALITY (Big Five)', axes: META.personalityAxes, axis_labels_ja_type_reading: pick(['O', 'C', 'E', 'A', 'N']),
      table_order: ELEMENTS, values: X.ELEMENT_PROTOTYPES_V2,
      ranking_function: 'ETIv2.rankByDistance(ELEMENT_PROTOTYPES_V2, results.personality, META.personalityAxes)',
      distance: 'sqrt(mean(((user[ax] - proto[ax]) / 100)^2))  — 5軸等重み（重み係数なし）。較正なし',
      direction: 'distance 小さいほど近い（昇順で1位）',
      closeness_score: 'clamp(round((1 - distance) * 100), 0, 100)（表示用。判定には不使用）',
      tie_order: 'Array.prototype.sort（安定）→ 完全同点は表の挿入順 ' + ELEMENTS.join('>') + '。MIRROR の同率解消側（topAttributeNames）は |d - best| <= 1e-12 を同率集合として扱う',
      threshold: 'なし（必ず1位を返す）',
    },
    WEAPON_PROTOTYPES_V2: {
      domain: 'STYLE', axes: META.styleAxes, axis_labels_ja_type_reading: pick(['AGY', 'REL', 'ROL', 'REF', 'AUT']),
      table_order: WEAPONS, values: X.WEAPON_PROTOTYPES_V2,
      ranking_function: 'ETIv2.rankByDistance(WEAPON_PROTOTYPES_V2, results.style, META.styleAxes)',
      distance: '元素と同じ（5軸等重みの正規化RMSE）', direction: '小さいほど近い',
      tie_order: '表の挿入順 ' + WEAPONS.join('>'), threshold: 'なし',
    },
    NATION_PROTOTYPES_V2: {
      domain: 'VALUES (Schwartz 10)', axes: META.valueAxes, axis_labels_ja_type_reading: pick(META.valueAxes),
      table_order: NATIONS, values: X.NATION_PROTOTYPES_V2,
      ranking_function: 'ETIv2.rankNationsByCenteredValues(NATION_PROTOTYPES_V2, results.values, META.valueAxes)',
      distance: 'user・proto をそれぞれ10軸平均で center → cosine 類似度 s → distance = (1 - s) / 2。user の centered ベクトルが全0なら全国家 s=0（同点→挿入順でモンド）。cos が null（片方が0ベクトル）も s=0',
      direction: '小さいほど近い', tie_order: '表の挿入順 ' + NATIONS.join('>'), threshold: 'なし',
      note: '国家判定は results.values（display値, 0..100）を使い、results.valuesCentered は使わない',
    },
    self_classification_check: selfClass,
    mirror_formula_ETI_MIRROR_2_1_0: {
      pSim: '1 - sqrt(mean(((userP - charP)/100)^2))', sSim: '1 - sqrt(mean(((userS - charS)/100)^2))',
      vSim: '(cos(center(userV), center(charV)) + 1) / 2、zero-vector なら 0.5',
      mirrorScoreRaw: '(0.40*pSim + 0.30*sSim + 0.30*vSim) * 100', mirrorScore: 'round(mirrorScoreRaw)',
      ranking_sort: 'raw desc → pSim desc → sSim desc → vSim desc → canonicalIndex asc（eti_v2_engine.js computeMirrorV2）',
      mirror_selection: 'ETIMirrorSelectionV21: raw 最大から 1e-10pt 以内を同率集合 → 元素一致(元素1位集合) → 国家一致(事実 region) → 武器一致 → canonicalIndex 最小。rankings[0] と MIRROR が異なり得る',
    },
  },
  inference: {
    direct_reuse_as_representative_coordinate: {
      verdict: '判定の再現という意味では流用可能／MIRROR 代表点としてそのまま使うかは要設計（ChatGPT 判断事項）',
      reasons: [
        '[fact] 生の代表値を入力すると、元素・武器・国家すべてが自分自身に判定される（self_classification_check：distance 0 / cos 1）。',
        '[fact] 3つの表は軸が互いに独立（PERSONALITY 5・STYLE 5・VALUES 10）なので、Q1/Q2/Q3 の代表値をそのまま連結すると 20軸の完全なプロファイルになり、computeMirror に渡せる。',
        '[fact] 代表値は 10/30/50/70/90 のような端寄りの値（例：氷 E=10, N=90）で、実ユーザー分布（js/eti_type_reading.js の POP_MEAN、本番797件）より極端。',
        '[fact] 既存の preview 機能（release-c-preview の js/eti_type_reading.js、本番 main には未マージ）は、同じ課題に対し「母集団平均 + K(0.65) ×（代表値 − 平均）」で縮めた代表プロファイルを使っている。Mini で採用するかは未決定（ChatGPT の判断事項として提示するのみ）。',
        '[inference] 生の代表値のまま MIRROR を計算すると、端の値に近い一部キャラへ排出が偏る可能性がある（参考測定 reference_measurement_raw_prototypes を参照）。',
      ],
    },
  },
  reference_measurement_raw_prototypes: {
    _note: '判断材料の参考測定。採用案・推奨案ではない。重み・結合比率は未決定。生の代表値（Q1/Q2/Q3 の代表値をそのまま連結）を ETI-MIRROR-2.1.0 の computeMirror に渡した結果。',
    combos: 280, distinct_mirror_characters: refSorted.length, combos_with_raw_tie_at_top: tiesAtTop,
    top10: refSorted.slice(0, 10), never_selected_count: 118 - refSorted.length,
  },
});
function pick(keys) {
  const L = { O: '開放性', C: '誠実性', E: '外向性', A: '協調性', N: '感受性の鋭さ', AGY: '主導性', REL: '関係調整', ROL: '役割持続', REF: '媒介思考', AUT: '自律距離', SD: '自分で選ぶこと', ST: '新しい刺激', HE: '楽しみ', AC: '達成', PO: '影響力', SE: '安定', CO: '節度', TR: '伝統', BE: '身近な人への思いやり', UN: '公正さ' };
  return Object.fromEntries(keys.map(k => [k, L[k]]));
}

const charsOut = Object.assign(header('MIRROR キャラクター座標（ETIv2MirrorResolver.CURRENT が参照する最新版）'), {
  fact: {
    resolver_current: R.CURRENT, resolver_legacy: R.LEGACY_V2,
    character_profile_version: 'ETI-CHAR-2.1.0', source_file: 'js/characters118_v2_1.js', global_name: 'ETI_V2_CHARACTERS_2_1_0',
    count: C21.length, unique_key: 'name（数値の安定IDは存在しない。canonicalIndex = 配列位置。2.0.1 と 2.1.0 で同順）',
    fields_present: [...new Set(C21.flatMap(c => Object.keys(c)))],
    fields_absent: ['id', 'rarity', 'release_version', 'en_name'],
    null_or_missing_coordinates: C21.filter(c => !chkChar(c)).map(c => c.name),
    region_null: C21.filter(c => c.region === null).map(c => ({ name: c.name, legacy_old_nation_field: c.legacy.old_nation_field, audit: c.audit })),
    region_null_meaning: '事実データ上「国家なし」とする意図的な null（audit.region_corrected=true）。MIRROR の点数計算は region を見ない。ETI-MIRROR-2.1.0 の同率解消では factualRegion=null →国家一致なし。resolver.normalizedCharacters は表示用に legacy.old_nation_field で埋める（例：ニコ→ナタ）が、ETIv2LegacyAdapter.displayNation と index.html getV2CharacterDisplayRegion はそれを外して国家を出さない。',
    region_values_raw: count(C21, c => String(c.region)),
    region_alias: { display_in_char_data: 'ナド・クライ', internal_key: 'ナドクライ', where: ['js/eti_v2_mirror_resolver.js REGION_ALIAS', 'index.html NATION_REGION_ALIAS_V2 (L1244)'] },
    region_resolver_vs_factual_diff: regionDisplayDiff,
    counts: {
      by_element: count(C21, c => c.element), by_weapon: count(C21, c => c.weapon), by_region_internal: count(charsFull, c => String(c.region_internal_key)),
      by_element_weapon: count(C21, c => c.element + '×' + c.weapon),
      element_weapon_combos_with_zero_chars: ELEMENTS.flatMap(e => WEAPONS.map(w => e + '×' + w)).filter(k => !C21.some(c => c.element + '×' + c.weapon === k)),
      by_element_weapon_nation: count(charsFull, c => c.element + '×' + c.weapon + '×' + String(c.region_internal_key)),
      element_weapon_nation_cells_with_chars: Object.keys(count(charsFull, c => c.element + '×' + c.weapon + '×' + String(c.region_internal_key))).filter(k => !k.endsWith('null')).length,
    },
  },
  unverified_columns: 'rarity / release_version は rarity_release_unverified.js 由来（コード外。status=unverified）',
  characters: charsFull,
});

const autoOut = Object.assign(header('Mini 自動候補（未選択時）— 暫定。レアリティ・実装Verは未検証'), {
  rule_from_spec: 'Ver.7.0 まで・オデットを含む★5、主人公・アーロイ・『ドール』を除外',
  overall_status: 'UNDETERMINED — レアリティ・実装Verがリポジトリに無く、外部一次出典で未検証。下の decision はすべて暫定。',
  explicit_exclusions: {
    '主人公': { status: 'n/a', fact: 'ETI-CHAR-2.1.0 の118名に主人公（旅人/空/蛍）は存在しない（除外操作は不要）' },
    'アーロイ': { status: 'excluded_confirmed', fact: 'DB に存在（canonicalIndex ' + C21.findIndex(c => c.name === 'アーロイ') + '、region=null）' },
    'ドール': { status: 'unresolved', fact: '「ドール」という表記はリポジトリ全体に存在しない。', candidates: DOLL_CANDIDATES.map(n => { const c = charsFull.find(x => x.name === n); return { name: n, element: c.element, weapon: c.weapon, rarity_unverified: c.rarity.value, release_unverified: c.release_version.value, why: c.rarity.note }; }),
      impact: 'ドリー・ダリアは★4（未検証）なので★5候補に元々入らず、除外しても結果に影響しない。ドゥリン・サンドローネは★5（未検証）で、どちらを指すかで候補数が変わる。要オーナー確認。' },
  },
  verification_needed: ['全118名のレアリティ・実装Verを公式（HoYoLAB/公式サイト/ゲーム内）で照合', 'web_search_snippet 由来（6.0〜7.0）の名前同定（ニコ=Nicole?, ローエン=Lohen?, ファルカ=Varka?）', 'リンネアのレアリティ（★4/★5で食い違い）', '『ドール』の指す人物'],
  summary: {
    decision_counts: count(autoRows, r => r.decision),
    provisional_pool_size_if_doll_candidates_kept: autoRows.filter(r => r.decision === 'included_provisional' || r.decision === 'undetermined_doll_candidate').length,
    provisional_pool_size_if_doll_candidates_removed: autoRows.filter(r => r.decision === 'included_provisional').length,
    provisional_pool_by_element: count(autoRows.filter(r => r.decision === 'included_provisional' || r.decision === 'undetermined_doll_candidate'), r => r.element),
    provisional_pool_by_weapon: count(autoRows.filter(r => r.decision === 'included_provisional' || r.decision === 'undetermined_doll_candidate'), r => r.weapon),
    provisional_pool_by_region: count(autoRows.filter(r => r.decision === 'included_provisional' || r.decision === 'undetermined_doll_candidate'), r => String(r.region_internal_key)),
  },
  manual_selection_candidates: { rule: '現行DBの全キャラ（使用可能な座標あり）', count: C21.filter(chkChar).length, keys: C21.map((c, i) => ({ canonicalIndex: i, key: c.name })) },
  auto_candidates: autoRows,
});

const disp = (r) => r && r.found ? { source: r.file + ':' + r.line, value: r.value } : null;
const diffs = [];
otherFiles.forEach(f => Object.entries(other[f]).forEach(([n, r]) => {
  const base = idx[n === 'REPORT_NATION_MEANING' ? 'NATION_MEANING' : n];
  if (!base || !base.found) return;
  const a = base.value, b = r.value;
  const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))];
  const d = keys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => ({ key: k, index_html: a[k] === undefined ? '(なし)' : a[k], [f]: b[k] === undefined ? '(なし)' : b[k] }));
  diffs.push({ dict: n, file: f + ':' + r.line, identical_to_index_html: d.length === 0, differences: d });
}));
const dispOut = Object.assign(header('表示辞書（現行 index.html を基準に抽出。ETI v2 の判定は8国家）'), {
  fact: {
    elements_7: { order_prototypes: ELEMENTS, ELEMENTS: disp(idx.ELEMENTS), ELEMENT_DESC: disp(idx.ELEMENT_DESC), ELEMENT_TRAITS: disp(idx.ELEMENT_TRAITS), ELEMENT_CODE: disp(idx.ELEMENT_CODE) },
    weapons_5: { order_prototypes: WEAPONS, WEAPONS: disp(idx.WEAPONS), WEAPON_DESC: disp(idx.WEAPON_DESC), WEAPON_TRAITS: disp(idx.WEAPON_TRAITS), WEAPON_CODE: disp(idx.WEAPON_CODE) },
    nations_8: {
      order_prototypes: NATIONS, internal_key_vs_display: { 'ナドクライ': { internal_key: 'ナドクライ', char_data_spelling: 'ナド・クライ', current_index_display: 'ナドクライ（NATIONS_V2 / NATION_DESC 等のキーをそのまま表示）', mini_spec_display: 'ナド・クライ（表示名のみ。意味は「月光」のまま）' } },
      NATION_CODE: disp(idx.NATION_CODE), NATION_MEANING: disp(idx.NATION_MEANING), NATION_DESC: disp(idx.NATION_DESC), NATION_TRAITS: disp(idx.NATION_TRAITS), NATION_VALUES: disp(idx.NATION_VALUES),
      legacy_7_nations: disp(idx.NATIONS), NATIONS_V2_expression: 'NATIONS.concat(["ナドクライ"]) (index.html L695)',
      PACK_NATIONS: disp(idx.PACK_NATIONS),
    },
    types_35: {
      code_rule: 'typeCode(el,w,nation) = ELEMENT_CODE[el] + WEAPON_CODE[w] + (nation ? "-" + NATION_CODE[nation] : "")  (index.html L679)',
      list: typeList.map(t => Object.assign({}, t, { type_page: 'type/' + t.code4.toLowerCase() + '.html', with_nation_suffix: Object.fromEntries(NATIONS.map(n => [n, t.code4 + '-' + idx.NATION_CODE.value[n]])) })),
      TYPE_DESC: disp(idx.TYPE_DESC),
    },
    other_pages_diff_vs_index_html: diffs,
  },
  known_discrepancies: [
    { where: 'index.html L692 コメント / NATIONS', fact: 'NATIONS（legacy-v1）は7国家。ETI v2 は NATIONS_V2（8国家）。コメント「シュワルツの基本的価値観をテイワット7国家にマッピング」「10次元を7国家に配分」は旧表記のまま' },
    { where: 'index.html packShareParams', fact: 'コメントは natI 0-6 → 3bit。8国家（0-7）も3bitに収まるため値は壊れないがコメントが旧' },
    { where: 'NATION_MEANING スネージナヤ vs NATION_TRAITS', fact: 'MEANING/DESC は「慈愛」、TRAITS は「逆境での強さ・したたかな忍耐・屈しない意志」（意味の焦点がやや異なる。現行のまま）' },
    { where: 'NATION_VALUES vs NATION_PROTOTYPES_V2', fact: 'NATION_VALUES は表示用の価値ラベル（日本語）で、判定のプロトタイプ値とは独立。例：ナドクライ=[自己志向, 安全]、プロトタイプは SD 90 / SE 60 が高位' },
    { where: 'ELEMENT_PROFILE / WEAPON_ENNEA / CHARACTERS / QUESTIONS (index.html)', fact: 'legacy-v1（エニアグラム・旧Big5）。ETI v2 の判定では使われない。Mini の正本にしない' },
  ],
});

fs.writeFileSync(path.join(OUT, 'prototype_coordinates.json'), JSON.stringify(prototypeOut, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'characters_full.json'), JSON.stringify(charsOut, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'characters_auto_candidates.json'), JSON.stringify(autoOut, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'display_dictionary.json'), JSON.stringify(dispOut, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'validation_log.json'), JSON.stringify({ sources_sha256: sources, checks }, null, 2) + '\n');

const failed = checks.filter(c => !c.ok);
checks.forEach(c => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok || c.detail == null ? '' : '  ' + JSON.stringify(c.detail))));
console.log('\nsummary', JSON.stringify({ checks: checks.length, failed: failed.length, auto: autoOut.summary, ref280: prototypeOut.reference_measurement_raw_prototypes, regionDisplayDiff, diffs: diffs.map(d => [d.dict, d.file, d.identical_to_index_html]) }, null, 1));
process.exitCode = failed.length ? 1 : 0;
