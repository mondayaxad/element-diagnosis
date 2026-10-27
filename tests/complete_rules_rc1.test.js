// 完全解析 RC1 の判定規則4種（TEXT-BANDS・GAP-LABELS・PAIR-RELATION・DOMAIN-EDITORIAL）の承認内容を固定する試験。
// 2026-10-08 承認：閾値は変えず、TEXT-BANDS の定義を content/axes.json の text_bands だけにし、版を 1.0.0 にした。
// DOMAIN は同じ平均なら DOMAIN_MODEL.domains の定義順。購入者向けの「検証が必要」の表現は出さない。
//   実行: node --test tests/complete_rules_rc1.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RC = path.join(__dirname, '..', 'api', '_complete', 'rc1', 'src');
const FX = path.join(__dirname, '..', 'prototypes', 'core1_v4_result_driven', 'fixtures', 'answers');
const { makeJudge, NEUTRAL, RULES, GAP, textBandsOf } = require(path.join(RC, 'judgments'));
const { makePolarity } = require(path.join(RC, 'polarity'));
const { DOMAIN_MODEL, sortDomains } = require(path.join(RC, 'models', 'domains'));
const { loadContent } = require(path.join(RC, 'content-store'));
const { calculateResult } = require(path.join(RC, 'calculate-result'));
const { buildClaims } = require(path.join(RC, 'build-claims'));
const { render } = require(path.join(RC, 'templates', 'report-46p'));
const K = loadContent();
const FIXTURES = fs.readdirSync(FX).filter((f) => /^F\d+\.json$/.test(f)).sort();
const built = Object.fromEntries(FIXTURES.map((f) => {
  const vm = buildClaims(calculateResult(JSON.parse(fs.readFileSync(path.join(FX, f))).input));
  return [f.replace('.json', ''), vm];
}));

const P = ['O', 'C', 'E', 'A', 'N'], S = ['AGY', 'REL', 'ROL', 'REF', 'AUT'], V = ['SD', 'ST', 'HE', 'AC', 'PO', 'SE', 'CO', 'TR', 'BE', 'UN'];
function snap(o, sdCentered) {
  const personality = Object.fromEntries(P.map((a) => [a, 50])); personality.O = o;
  const values = Object.fromEntries(V.map((a) => [a, 50])); values.SD = 50 + sdCentered; values.ST = 50 - sdCentered;
  return { axes: { personality, style: Object.fromEntries(S.map((a) => [a, 50])), values }, values_centered: {} };
}

test('版：4規則は 1.0.0（CANDIDATE・0.1.0 を残さない）', () => {
  assert.equal(RULES.textBands, 'CORE1-TEXT-BANDS-1.0.0');
  assert.equal(RULES.gapLabels, 'CORE1-GAP-LABELS-1.0.0');
  assert.equal(RULES.pairRelation, 'CORE1-PAIR-RELATION-1.0.0');
  assert.equal(DOMAIN_MODEL.version, 'CORE1-DOMAIN-EDITORIAL-1.0.0');
  assert.equal(K.axes.text_bands.version, 'CORE1-TEXT-BANDS-1.0.0');
  for (const k of ['pairEW', 'pairEN', 'pairWN']) assert.match(K[k].relation_rule, /CORE1-PAIR-RELATION-1\.0\.0/);
  for (const f of fs.readdirSync(RC, { recursive: true }).filter((x) => /\.(js|json)$/.test(x))) {
    const s = fs.readFileSync(path.join(RC, f), 'utf8');
    assert.doesNotMatch(s, /(TEXT-BANDS|GAP-LABELS|PAIR-RELATION|DOMAIN-EDITORIAL)(-CANDIDATE)?-0\.1\.0|GAP-LABELS-CANDIDATE/, f);
  }
});

test('TEXT-BANDS の定義は axes.json の text_bands の1か所だけ（閾値の数値は 65／35／±8 のまま）', () => {
  const B = K.axes.text_bands;
  assert.deepEqual([B.high_min, B.low_max, B.v_centered_high, B.v_centered_low], [65, 35, 8, -8]);
  assert.deepEqual([NEUTRAL.ps_high_min, NEUTRAL.ps_low_max, NEUTRAL.v_abs_min], [B.high_min, B.low_max, B.v_centered_high]);
  // judgments.js・polarity.js は帯の数値を持たない（text_bands から読む）
  for (const f of ['judgments.js', 'polarity.js']) {
    const s = fs.readFileSync(path.join(RC, f), 'utf8');
    assert.doesNotMatch(s, /ps_low_max:\s*\d|ps_high_min:\s*\d|v_abs_min:\s*\d|>=\s*65|<=\s*35/, f);
  }
  // 版の違い・非対称・数値でない定義では止まる
  assert.throws(() => textBandsOf({ axes: { text_bands: { ...B, version: 'CORE1-TEXT-BANDS-0.1.0' } } }), /version/);
  assert.throws(() => textBandsOf({ axes: { text_bands: { ...B, v_centered_low: -7 } } }), /invalid/);
  assert.throws(() => textBandsOf({ axes: { text_bands: { ...B, high_min: '65' } } }), /invalid/);
});

test('TEXT-BANDS の境界：64・65・66／34・35・36、VALUES centered 7.9・8・8.1（judgments と polarity が一致）', () => {
  const cases = [[34, 'low'], [35, 'low'], [36, 'mid'], [50, 'mid'], [64, 'mid'], [65, 'high'], [66, 'high']];
  for (const [o, want] of cases) {
    const s = snap(o, 0);
    assert.equal(makeJudge(s).band('O'), want, `O=${o}`);
    assert.equal(makePolarity(s, K.axes).band('O'), want, `O=${o} polarity`);
  }
  for (const [c, want] of [[7.9, 'mid'], [8, 'high'], [8.1, 'high'], [-7.9, 'mid'], [-8, 'low']]) {
    const s = snap(50, c);
    assert.equal(makeJudge(s).band('SD'), want, `SD centered ${c}`);
    assert.equal(makePolarity(s, K.axes).band('SD'), want, `SD centered ${c} polarity`);
  }
  assert.equal(makePolarity(snap(64, 0), K.axes).label('O'), '開放性（中央域）');
  assert.equal(makePolarity(snap(65, 0), K.axes).label('O'), '開放性（探究・抽象側）');
});

test('GAP-LABELS の境界：差1・2＝近接、3・7＝中間、8・9＝開き（区切りは 2／8 のまま）', () => {
  assert.deepEqual({ ...GAP }, { close: 2, clear: 8 });
  const J = makeJudge(snap(50, 0));
  const st = (d) => J.gapState({ gapToNext: { display: d, raw: 0 } }, 'next');
  assert.deepEqual([1, 2, 3, 7, 8, 9].map((d) => st(d).state), ['close', 'close', 'moderate', 'moderate', 'clear', 'clear']);
  assert.equal(st(2).rule_id, 'CORE1-GAP-LABELS-1.0.0');
});

test('12 fixture：GAP・PAIR・DOMAIN の結果と、規則が付く文のページ（承認時の集計どおり）', () => {
  const gapTop = Object.fromEntries(Object.entries(built).map(([k, vm]) => [k, ['element', 'weapon', 'nation'].map((kind) => makeJudge(vm.snap).gapState(vm.snap.rankings[kind][0], 'next').state).join('/')]));
  assert.deepEqual(gapTop, {
    F01: 'moderate/close/clear', F02: 'clear/clear/clear', F03: 'clear/clear/clear', F04: 'clear/clear/clear', F05: 'clear/clear/moderate', F06: 'clear/clear/clear',
    F07: 'clear/clear/clear', F08: 'clear/clear/moderate', F09: 'clear/clear/close', F10: 'clear/close/clear', F11: 'close/moderate/clear', F12: 'clear/clear/clear',
  });
  const rel = Object.fromEntries(Object.entries(built).map(([k, vm]) => [k, vm.pairs.map((p) => p.rel).join('/')]));
  assert.deepEqual(rel, {
    F01: 'complement/alignment/conditional', F02: 'complement/alignment/alignment', F03: 'alignment/alignment/alignment', F04: 'alignment/conditional/conditional',
    F05: 'complement/tension/alignment', F06: 'alignment/alignment/alignment', F07: 'alignment/alignment/alignment', F08: 'alignment/conditional/tension',
    F09: 'complement/conditional/conditional', F10: 'alignment/complement/conditional', F11: 'complement/conditional/tension', F12: 'complement/complement/alignment',
  });
  const pages = {};
  Object.values(built).forEach((vm) => vm.claims.forEach((c) => { if (/^CORE1-(GAP-LABELS|PAIR-RELATION|DOMAIN-EDITORIAL)/.test(c.rule_id)) (pages[c.rule_id] = pages[c.rule_id] || new Set()).add(c.page_id); }));
  assert.deepEqual(Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, [...v].sort()])), {
    'CORE1-GAP-LABELS-1.0.0': ['P03', 'P04', 'P05', 'P06', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21'],
    'CORE1-PAIR-RELATION-1.0.0': ['P22', 'P23', 'P24'],
    'CORE1-DOMAIN-EDITORIAL-1.0.0': ['P34'],
  });
});

test('DOMAIN：同じ平均なら DOMAIN_MODEL.domains の定義順（英字順ではない）。F04 は 実行・持続 > 理解・戦略 > 関係・統合 > 発信・拡張', () => {
  const order = DOMAIN_MODEL.domains.map((d) => d.key);
  assert.deepEqual(order, ['understanding', 'integration', 'sustain', 'expression']);
  const tie = [{ key: 'expression', mean: 52.5 }, { key: 'integration', mean: 52.5 }, { key: 'understanding', mean: 52.5 }, { key: 'sustain', mean: 60 }];
  assert.deepEqual(sortDomains(tie).map((d) => d.key), ['sustain', 'understanding', 'integration', 'expression']);
  assert.deepEqual(built.F04.domains.sorted.map((d) => d.key), ['sustain', 'understanding', 'integration', 'expression']);
  const f04 = built.F04.domains.items;
  assert.equal(f04.find((d) => d.key === 'integration').mean, f04.find((d) => d.key === 'expression').mean, 'F04 は同点');
  assert.match(built.F04.domains.lead35, /理解・戦略、関係・統合へつながる/);
});

test('購入者向けの本文：ドメインに「検証が必要」の表現を出さず、P33 と同じ恒久的な注意書き。版は紙面に出さない（TEMPLATE-46P-WEB-1.0.1）', () => {
  for (const [k, vm] of Object.entries(built)) {
    const html = render(vm, K);
    assert.doesNotMatch(html, /0\.1\.0|CANDIDATE|検証が必要|本番公開前/, k);
    assert.match(html, /<b>ETI編集用派生指標<\/b>/, k);
    assert.match(html, /<span>確立された心理尺度ではありません<\/span>/, k);
    assert.match(html, /÷4＝\d+。確立された心理尺度ではなく、能力値・才能量・人口比を示すものではありません。/, k);
    // 版（DOMAIN-EDITORIAL・CONTENT など）は DB・ハッシュ・manifest に残し、紙面には出さない
    assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/g, ''), /DOMAIN-EDITORIAL-\d|CONTENT-\d|版：/, k); // CSS の注記は対象外
    assert.equal(vm.snap.domains.model, 'CORE1-DOMAIN-EDITORIAL-1.0.0', k);
  }
});

test('同じ入力から常に同じ結果（12 fixture）', () => {
  for (const f of FIXTURES) {
    const input = JSON.parse(fs.readFileSync(path.join(FX, f))).input;
    const a = render(buildClaims(calculateResult(input)), K), b = render(buildClaims(calculateResult(input)), K);
    assert.equal(a, b, f);
  }
});
