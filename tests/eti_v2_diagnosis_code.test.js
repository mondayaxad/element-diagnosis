// ETI v2 の diagnosis_code（= encodeAnswersV2 の出力）を「同一診断の一致キー」として
// DB側の正本に使うための前提を固定するテスト。
//   実行: node --test tests/eti_v2_diagnosis_code.test.js（または引数なしの node --test）
// 外部依存なし。js/ETI_v2_QUESTIONS_100.js と js/eti_v2_engine.js をそのまま読み込む（変更しない）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ctx = { BigInt, console };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'js/ETI_v2_QUESTIONS_100.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(ROOT, 'js/eti_v2_engine.js'), 'utf8') + '\n' +
  ';this.__Q = ETI_V2_QUESTIONS; this.__E = ETIv2;',
  ctx
);
const Q = ctx.__Q;
const { encodeAnswersV2, decodeAnswersV2 } = ctx.__E;
const IDS = Q.map(q => q.id);
const VALUES = [-2, -1, 0, 1, 2];

function randomAnswers() {
  const a = {};
  for (const id of IDS) a[id] = VALUES[crypto.randomInt(0, 5)];
  return a;
}
function filled(v) { const a = {}; for (const id of IDS) a[id] = v; return a; }

test('設問は100問・回答は5段階（前提の固定）', () => {
  assert.equal(IDS.length, 100);
  assert.equal(new Set(IDS).size, 100);
});

test('encode → decode で100問すべてが完全一致する', () => {
  for (let i = 0; i < 500; i++) {
    const a = randomAnswers();
    const back = decodeAnswersV2(encodeAnswersV2(a, Q), Q);
    for (const id of IDS) assert.equal(back[id], a[id], `${id} が一致しない`);
  }
});

test('同じ回答なら、キーの並び順に関係なく同じコードになる（決定論的）', () => {
  const a = randomAnswers();
  const reversed = {};
  [...IDS].reverse().forEach(id => { reversed[id] = a[id]; });
  assert.equal(encodeAnswersV2(a, Q), encodeAnswersV2(reversed, Q));
  assert.equal(encodeAnswersV2(a, Q), encodeAnswersV2(Object.assign({}, a), Q));
});

test('100問のどの1問を変えても、必ず別のコードになる', () => {
  const a = randomAnswers();
  const base = encodeAnswersV2(a, Q);
  for (const id of IDS) {
    for (const v of VALUES) {
      if (v === a[id]) continue;
      const b = Object.assign({}, a, { [id]: v });
      assert.notEqual(encodeAnswersV2(b, Q), base, `${id}=${v} で同じコードになった`);
    }
  }
});

test('境界値（全問-2 / 全問+2）も往復で一致する', () => {
  for (const v of [-2, 2]) {
    const a = filled(v);
    const back = decodeAnswersV2(encodeAnswersV2(a, Q), Q);
    for (const id of IDS) assert.equal(back[id], v);
  }
  assert.equal(encodeAnswersV2(filled(-2), Q), '0');
});

test('ランダム2万件で衝突しない', () => {
  const seen = new Map();
  for (let i = 0; i < 20000; i++) {
    const a = randomAnswers();
    const c = encodeAnswersV2(a, Q);
    const key = IDS.map(id => a[id]).join(',');
    if (seen.has(c)) assert.equal(seen.get(c), key, '異なる回答が同じコードになった');
    seen.set(c, key);
  }
});

test('未回答・範囲外の値は符号化を拒否する（欠損を0扱いにしない）', () => {
  const a = randomAnswers();
  const missing = Object.assign({}, a); delete missing[IDS[37]];
  assert.throws(() => encodeAnswersV2(missing, Q));
  const outOfRange = Object.assign({}, a, { [IDS[5]]: 3 });
  assert.throws(() => encodeAnswersV2(outOfRange, Q));
});
