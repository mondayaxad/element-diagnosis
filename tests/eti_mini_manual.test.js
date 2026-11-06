// 元素診断 Mini Phase B：キャラクター手動選択時の再判定（ETI-MINI-MANUAL-1.0.0）の試験。
// 正本：docs/eti-mini/phase_b_v1/CLAUDE_PHASE_B_実装指示書.md §3・§5
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const P = require('../js/eti_v2_prototypes.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAN = require('../js/eti_mini_manual_v1.js');
const REF = require('../docs/eti-mini/phase_b_v1/eti_mini_manual_engine_reference.js');
const GOLDEN = JSON.parse(read('docs/eti-mini/phase_b_v1/phase_b_manual_golden_cases.json'));
const PROTOS = { element: P.ELEMENT_PROTOTYPES_V2, weapon: P.WEAPON_PROTOTYPES_V2, nation: P.NATION_PROTOTYPES_V2 };
const DIMS = ['element', 'weapon', 'nation'];
const DOMAIN = { element: 'personality', weapon: 'style', nation: 'values' };
const EPS = 1e-12;

function loadMini() {
  const ctx = {};
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  const files = ['js/characters118_v2_1.js', 'js/eti_mini_auto_map_v1.js', 'js/eti_v2_prototypes.js', 'js/eti_mini_choices_v1.js', 'js/eti_mini_core.js', 'js/eti_mini_manual_v1.js'];
  vm.runInContext(files.map(read).join('\n;\n'), ctx, { filename: 'mini-scripts.js' });
  return ctx;
}
// 本家 ETI v2 の関数（rankByDistance・rankNationsByCenteredValues）
function loadEngine() {
  const ctx = {};
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js'].map(read).join('\n;\n') + ';globalThis.__E = { ETIv2, ETI_V2_META };', ctx);
  return ctx.__E;
}
const ENG = loadEngine();

function* allPairs() {
  for (const element of Object.keys(PROTOS.element)) for (const weapon of Object.keys(PROTOS.weapon)) for (const nation of Object.keys(PROTOS.nation)) {
    for (const ch of CHARS) yield [{ element, weapon, nation }, ch];
  }
}
const merged = (a, ch, dim) => {
  const axes = MAN.AXES[dim];
  return Object.fromEntries(axes.map((ax) => [ax, 0.5 * PROTOS[dim][a[dim]][ax] + 0.5 * ch[DOMAIN[dim]][ax]]));
};
// 浮動小数点で各代表への「近さ」を出す（小さいほど近い）。元素・武器は RMSE、国家は 1 − 中心化コサイン
function floatDistances(a, ch, dim) {
  const axes = MAN.AXES[dim];
  const m = merged(a, ch, dim);
  if (dim !== 'nation') {
    return Object.keys(PROTOS[dim]).map((k) => [k, Math.sqrt(axes.reduce((s, ax) => s + ((m[ax] - PROTOS[dim][k][ax]) / 100) ** 2, 0) / axes.length)]);
  }
  const c = (v) => { const avg = v.reduce((s, x) => s + x, 0) / v.length; return v.map((x) => x - avg); };
  const A = c(axes.map((ax) => m[ax]));
  return Object.keys(PROTOS[dim]).map((k) => {
    const B = c(axes.map((ax) => PROTOS[dim][k][ax]));
    const cos = A.reduce((s, x, i) => s + x * B[i], 0) / (Math.hypot(...A) * Math.hypot(...B));
    return [k, 1 - cos];
  });
}
// 規則：最小距離から EPS 以内を同点とみなし、そのうち表の挿入順で先のもの
function expectedByRule(a, ch, dim) {
  const d = floatDistances(a, ch, dim);
  const min = Math.min(...d.map((x) => x[1]));
  return d.find((x) => x[1] - min <= EPS)[0];
}
function isTopTie(a, ch, dim) {
  const d = floatDistances(a, ch, dim);
  const min = Math.min(...d.map((x) => x[1]));
  return d.filter((x) => x[1] - min <= EPS).length > 1;
}

test('golden：同梱の全ケースで元素・武器・国家が一致する', () => {
  const M = loadMini().ETIMini;
  assert.equal(GOLDEN.model, MAN.MANUAL_VERSION);
  assert.equal(GOLDEN.weight, MAN.WEIGHT);
  for (const g of GOLDEN.cases) {
    const ch = CHARS.find((c) => c.name === g.character);
    const r = MAN.computeManual(g.answers, ch, PROTOS);
    assert.deepEqual({ element: r.element, weapon: r.weapon, nation: r.nation }, g.expected, `${JSON.stringify(g.answers)} × ${g.character}`);
    const viaCore = M.manualResult(g.answers, ch);
    assert.deepEqual([viaCore.element, viaCore.weapon, viaCore.nation], [g.expected.element, g.expected.weapon, g.expected.nation]);
  }
});

test('33,040 通り：すべて「最小距離（同点は表の挿入順で先）」の規則どおり（浮動小数点で独立に計算して照合）', () => {
  let n = 0;
  for (const [a, ch] of allPairs()) {
    const r = MAN.computeManual(a, ch, PROTOS);
    for (const dim of DIMS) assert.equal(r[dim], expectedByRule(a, ch, dim), `${JSON.stringify(a)} × ${ch.name} / ${dim}`);
    n++;
  }
  assert.equal(n, 33040);
});

test('33,040 通り：同梱の参照実装・本家 ETI v2 の関数と違うのは、1位が完全な同点の箇所だけ', () => {
  const diff = { reference: 0, engine: 0 };
  const M = ENG.ETI_V2_META;
  for (const [a, ch] of allPairs()) {
    const r = MAN.computeManual(a, ch, PROTOS);
    const ref = REF.computeMiniManual({ ...a, characterName: ch.name }, PROTOS, CHARS, 0.5);
    const eng = {
      element: ENG.ETIv2.rankByDistance(PROTOS.element, merged(a, ch, 'element'), M.personalityAxes).ranking[0].name,
      weapon: ENG.ETIv2.rankByDistance(PROTOS.weapon, merged(a, ch, 'weapon'), M.styleAxes).ranking[0].name,
      nation: ENG.ETIv2.rankNationsByCenteredValues(PROTOS.nation, merged(a, ch, 'nation'), M.valueAxes).ranking[0].name,
    };
    for (const [name, other] of [['reference', ref], ['engine', eng]]) {
      let differs = false;
      for (const dim of DIMS) {
        if (other[dim] === r[dim]) continue;
        differs = true;
        assert.ok(isTopTie(a, ch, dim), `${name}: 同点でないのに結果が違う ${JSON.stringify(a)} × ${ch.name} / ${dim}`);
      }
      if (differs) diff[name]++;
    }
  }
  // 記録（2026-11-06 時点の実測）：参照実装と 136 通り、本家の関数と 496 通りで、同点の勝ち負けだけが異なる
  assert.deepEqual(diff, { reference: 136, engine: 496 });
});

test('分布（回帰の基準）：33,040 通りの変化の内訳', () => {
  const byN = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const attr = { element: 0, weapon: 0, nation: 0 };
  let combosThatVary = 0;
  const ties = { element: 0, weapon: 0, nation: 0 };
  let last = null, seen = new Set();
  for (const [a, ch] of allPairs()) {
    const key = `${a.element}|${a.weapon}|${a.nation}`;
    if (key !== last) { if (seen.size > 1) combosThatVary++; seen = new Set(); last = key; }
    const r = MAN.computeManual(a, ch, PROTOS);
    let k = 0;
    for (const dim of DIMS) { if (r[dim] !== a[dim]) { k++; attr[dim]++; } if (isTopTie(a, ch, dim)) ties[dim]++; }
    byN[k]++;
    seen.add(`${r.element}|${r.weapon}|${r.nation}`);
  }
  if (seen.size > 1) combosThatVary++;
  assert.deepEqual(byN, { 0: 18938, 1: 11722, 2: 2245, 3: 135 });
  assert.deepEqual(attr, { element: 8840, weapon: 5712, nation: 2065 });
  assert.equal(((33040 - byN[0]) / 33040 * 100).toFixed(3), '42.682');
  assert.equal(combosThatVary, 280);
  assert.deepEqual(ties, { element: 1840, weapon: 336, nation: 0 });
});

test('決定性：同じ入力なら常に同じ結果。入力を書き換えない', () => {
  const snap = JSON.stringify([PROTOS, CHARS]);
  for (const [a, ch] of allPairs()) {
    if (ch.name !== 'ナヒーダ' && ch.name !== 'ディルック') continue;
    assert.deepEqual(MAN.computeManual(a, ch, PROTOS), MAN.computeManual({ ...a }, JSON.parse(JSON.stringify(ch)), PROTOS));
  }
  assert.equal(JSON.stringify([PROTOS, CHARS]), snap);
});

test('結果画面の形：選んだキャラ自身を表示し、タイプ名・コードは再判定後の元素・武器・国家から取る', () => {
  const M = loadMini().ETIMini;
  assert.equal(M.isManualSelectionReady(), true);
  const g = GOLDEN.cases.find((x) => x.character === 'アイノ'); // 氷 → 水 に変わる例
  const ch = CHARS.find((c) => c.name === g.character);
  const r = M.manualResult(g.answers, ch);
  assert.equal(r.character.name, 'アイノ');
  assert.equal(r.character.selectedBy, 'user');
  assert.deepEqual(plain(r.answers), g.answers);
  assert.equal(r.element, '水');
  assert.equal(r.typeName, M.TYPE_NAME['水']['法器']);
  assert.equal(r.typeCode, 'HYCT-S');
  assert.equal(r.versions.manualCombiner, 'ETI-MINI-MANUAL-1.0.0');
  assert.equal(r.versions.manualWeight, 0.5);
  // 点数・距離・類似度を返さない
  assert.doesNotMatch(JSON.stringify(r), /score|distance|similar|rank/i);
  // ナド・クライの表記は再判定後も同じ
  const nd = M.manualResult({ element: '炎', weapon: '法器', nation: 'ナドクライ' }, CHARS.find((c) => c.name === '辛炎'));
  assert.equal(nd.nation, 'ナドクライ');
  assert.equal(nd.nationDisplay, 'ナド・クライ');
});

test('各回答でキャラを変えると結果が変わり得る（280/280）、キャラ自身の属性へは寄せない', () => {
  let forced = 0;
  for (const [a, ch] of allPairs()) {
    const r = MAN.computeManual(a, ch, PROTOS);
    if (r.element === ch.element && r.weapon === ch.weapon && r.nation === ch.region) forced++;
  }
  assert.ok(forced < 33040 / 10, `キャラ自身の属性と一致した件数が多すぎる: ${forced}`);
});

test('不正な入力：結果を出さずに止める', () => {
  const ch = CHARS.find((c) => c.name === 'ナヒーダ');
  const ok = { element: '炎', weapon: '弓', nation: 'モンド' };
  for (const a of [{}, { ...ok, element: '光' }, { ...ok, nation: 'ナド・クライ' }, { ...ok, weapon: undefined }]) {
    assert.throws(() => MAN.computeManual(a, ch, PROTOS), (e) => e.code === 'INVALID_ANSWERS');
  }
  assert.throws(() => MAN.computeManual(ok, null, PROTOS), (e) => e.code === 'INVALID_CHARACTER');
  const missing = JSON.parse(JSON.stringify(ch)); delete missing.values.SD;
  assert.throws(() => MAN.computeManual(ok, missing, PROTOS), (e) => e.code === 'INVALID_CHARACTER_COORDINATES');
  const fractional = JSON.parse(JSON.stringify(ch)); fractional.personality.O = 50.5;
  assert.throws(() => MAN.computeManual(ok, fractional, PROTOS), (e) => e.code === 'INVALID_CHARACTER_COORDINATES');
  const legacyShape = { name: 'ディルック', big5: { O: 45, C: 75, E: 35, A: 40, N: 60 } }; // index.html の旧 CHARACTERS の形は使えない
  assert.throws(() => MAN.computeManual(ok, legacyShape, PROTOS), (e) => e.code === 'INVALID_CHARACTER_COORDINATES');
  assert.throws(() => MAN.computeManual(ok, ch, null), (e) => e.code === 'PROTOTYPES_MISSING');
});

test('手動選択の対象：登録118名、表示名・正規化名とも重複なし、全員で判定できる', () => {
  assert.equal(CHARS.length, 118);
  assert.equal(new Set(CHARS.map((c) => c.name)).size, 118);
  const norm = (s) => String(s).normalize('NFKC').replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60)).replace(/[\s・･]/g, '');
  assert.equal(new Set(CHARS.map((c) => norm(c.name))).size, 118);
  for (const c of CHARS) assert.equal(c.profile_version, 'ETI-CHAR-2.1.0');
  // 手動選択の判定は 118 名のどれでも計算できる（画面では、3つの答えのタイプで現れるキャラクターに絞って並べる）
  for (const c of CHARS) assert.ok(MAN.computeManual({ element: '炎', weapon: '弓', nation: 'モンド' }, c, PROTOS).element);
});
