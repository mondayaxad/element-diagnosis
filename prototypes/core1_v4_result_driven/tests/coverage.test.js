// coverage.test.js — 内容辞書の完全性、118名・131組合せ・20カテゴリの処理、欠損時に生成を止めること
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContent } = require('../src/content-store');
const { loadEngine } = require('../src/engine');
const { buildClaims } = require('../src/build-claims');
const { calculateResult } = require('../src/calculate-result');
const { fixtures, built } = require('./helpers');

const K = loadContent();
const eng = loadEngine();

test('7 elements, 5 weapons, 8 nations are complete and match canonical prototype keys', () => {
  assert.deepEqual(Object.keys(K.elements.items).sort(), Object.keys(eng.EP).sort());
  assert.deepEqual(Object.keys(K.weapons.items).sort(), Object.keys(eng.WP).sort());
  assert.deepEqual(Object.keys(K.nations.items).sort(), Object.keys(eng.NP).sort());
  [K.elements, K.weapons, K.nations].forEach((d) => Object.values(d.items).forEach((it) => {
    ['intro', 'natural_strength', 'optimal_use', 'underuse_signs', 'overuse_signs', 'not_explained', 'as_next', 'lend', 'scene_label'].forEach((f) => assert.ok(it[f] && it[f].length >= 4, `${it.key}.${f}`));
    assert.ok(it.core_axes.length >= 2 && it.core_axes.length <= 3, it.key);
    assert.ok(it.scene_templates.length >= 2, it.key);
  }));
});

test('131 pair entries exist with all required fields', () => {
  let n = 0;
  [[K.pairEW, eng.EP, eng.WP], [K.pairEN, eng.EP, eng.NP], [K.pairWN, eng.WP, eng.NP]].forEach(([d, A, B]) => {
    Object.keys(A).forEach((a) => Object.keys(B).forEach((b) => {
      const p = d.items[`${a}×${b}`];
      assert.ok(p, `${a}×${b}`); n++;
      ['summary', 'together', 'tension', 'works_when', 'friction_when', 'observation_question'].forEach((f) => assert.ok(p[f] && p[f].length >= 6, `${a}×${b}.${f}`));
      assert.ok(['alignment', 'complement', 'tension', 'conditional'].includes(p.default_relation));
      assert.ok(p.scene_templates.length >= 2);
    }));
  });
  assert.equal(n, 131);
});

test('all 118 characters can be described with complete sentences (no tag lists)', () => {
  assert.equal(eng.CHARS.length, 118);
  const tags = K.chars.tags;
  eng.CHARS.forEach((c) => {
    assert.ok(c.basis_tags.length >= 2, c.name);
    c.basis_tags.forEach((t) => { assert.ok(tags[t], `${c.name}:${t}`); assert.ok(tags[t].end.length >= 4 && tags[t].te.length >= 3); });
  });
});

test('every fixture renders all 46 pages and every category that appears has content', () => {
  fixtures.forEach((fx) => {
    const { html, vm } = built(fx.fixture_id);
    assert.equal((html.match(/<section class="page /g) || []).length, 46, fx.fixture_id);
    assert.equal(vm.details.element.length + vm.details.weapon.length + vm.details.nation.length, 9);
  });
});

test('unknown content id stops generation instead of continuing', () => {
  const snap = calculateResult(fixtures[0].input);
  const broken = JSON.parse(JSON.stringify(snap));
  broken.rankings.element[0].key = '未知';
  assert.throws(() => buildClaims(broken), /missing content/);
});

test('mentor goal must come from the reviewed catalog', () => {
  const input = { ...fixtures[0].input, mentor_goal: { ...fixtures[0].input.mentor_goal, goal_id: 'UNREVIEWED' } };
  assert.throws(() => buildClaims(calculateResult(input)), /mentor goal not in reviewed catalog/);
});

test('type registry reproduces ANBW-M / 追風者 for the approved fixture', () => {
  const { vm, html } = built('F02');
  assert.equal(vm.typeCode, 'ANBW-M');
  assert.equal(vm.typeName, '追風者');
  ['元素診断', '完全解析｜CORE1', 'ANBW-M', '追風者'].forEach((s) => assert.ok(html.includes(s), s));
  assert.ok(/<span class="c-el">風<\/span><b>×<\/b><span class="c-st">弓<\/span><b>×<\/b><span class="c-va">モンド<\/span>/.test(html));
  assert.equal(built('F01').vm.typeCode, 'HYPL-S');
  assert.equal(built('F01').vm.typeName, '静衛者');
});
