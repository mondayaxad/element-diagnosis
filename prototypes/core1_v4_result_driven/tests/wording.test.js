// wording.test.js — 文面の退行検出（完全な日本語品質を機械判定できるとはしない。最終確認は人間の全文査読）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixtures, built, visibleText, pageText, FX } = require('./helpers');

const CODES = 'O|C|E|A|N|AGY|REL|ROL|REF|AUT|SD|ST|HE|AC|PO|SE|CO|TR|BE|UN';
const NARRATIVE_PAGES = /^P(0[3-9]|1\d|2\d|3[0-9])$/;
const strip = (s) => s.replace(/<[^>]+>/g, '');
// 本文で許す数字（数量の名前であって、得点ではないもの）
const ALLOWED_NUM = /\d+人|\d+名|20軸|10軸|5軸|10の価値|10価値|10名|十人|4軸|三つ|二つ|一つ|7日間|150字|一行|三日|四日目|三か月|二時間|三十分|半年|翌月|2位|P\d{2}/g;

test('no population / probability / ranking-in-the-world wording in generated claims', () => {
  const bad = /人口|パーセンタイル|上位\s*\d+\s*[%％]|世界(で|の)上位|当選|確率が|適職|天職|診断名|障害|疾患|病気/;
  fixtures.forEach((fx) => built(fx.fixture_id).vm.claims.forEach((c) => assert.ok(!bad.test(c.text), `${fx.fixture_id} ${c.claim_id}: ${c.text}`)));
});

test('low rank is never called a defect', () => {
  const bad = /欠陥|未発達|劣って|劣る|能力が低い|苦手な人|弱点です/;
  fixtures.forEach((fx) => built(fx.fixture_id).vm.claims.forEach((c) => assert.ok(!bad.test(c.text), `${fx.fixture_id} ${c.claim_id}`)));
});

test('display name is ナド・クライ everywhere on screen', () => {
  fixtures.forEach((fx) => assert.ok(!visibleText(built(fx.fixture_id).html).includes('ナドクライ'), fx.fixture_id));
});

test('スネージナヤ: no 慈愛 / high benevolence claim (coordinates say otherwise)', () => {
  fixtures.forEach((fx) => {
    const t = visibleText(built(fx.fixture_id).html);
    assert.ok(!/慈愛/.test(t), fx.fixture_id);
    assert.ok(!/スネージナヤ[^。]*博愛[^。]*(高|重)/.test(t), fx.fixture_id);
  });
});

test('MENTOR without a goal shows no character ranking (P09, P28)', () => {
  fixtures.filter((f) => !f.input.mentor_goal).forEach((fx) => {
    const { html } = built(fx.fixture_id);
    [9, 28].forEach((n) => {
      const a = html.indexOf(`id="p${String(n).padStart(2, '0')}"`), b = html.indexOf('<section class="page', a + 10);
      const seg = html.slice(a, b);
      assert.ok(!/class="ch-row me/.test(seg) && !/class="lens-card"/.test(seg), `${fx.fixture_id} P${n}`);
      assert.ok(seg.includes('目標方向を選ぶと生成されます'), `${fx.fixture_id} P${n}`);
    });
  });
});

test('narrative claims do not start with numbers or axis codes, and carry no code+number tokens', () => {
  fixtures.forEach((fx) => built(fx.fixture_id).vm.claims.filter((c) => NARRATIVE_PAGES.test(c.page_id)).forEach((c) => {
    const t = strip(c.text);
    assert.ok(!/^[0-9０-９]/.test(t), `${c.claim_id}: ${t}`);
    assert.ok(!new RegExp(`^(${CODES})\\b`).test(t), `${c.claim_id}: ${t}`);
    assert.ok(!new RegExp(`\\b(${CODES})\\s?\\d{1,3}\\b`).test(t), `${c.claim_id}: ${t}`);
  }));
});

test('narrative claims contain no scores (numbers live in evidence)', () => {
  fixtures.forEach((fx) => built(fx.fixture_id).vm.claims.filter((c) => NARRATIVE_PAGES.test(c.page_id) && !/CHAR-/.test(c.claim_id)).forEach((c) => {
    const t = strip(c.text).replace(ALLOWED_NUM, '');
    assert.ok(!/\d/.test(t), `${fx.fixture_id} ${c.claim_id}: ${t}`);
  }));
});

test('character lines are full sentences, not tag lists', () => {
  fixtures.forEach((fx) => {
    const { vm } = built(fx.fixture_id);
    ['mirror', 'hidden', 'mentor'].forEach((l) => Object.values(vm.lines[l]).forEach((s) => {
      assert.ok(s.endsWith('。') && s.length >= 14, s);
      assert.ok((s.match(/・/g) || []).length < 2, s);
      assert.ok(/(る|う|く|す|つ|ぶ|む|ない|ます)。$/.test(s), 'predicate: ' + s);
    }));
    vm.p26.forEach((x) => { assert.ok(/構造です。$/.test(x.rows[0][1]), x.rows[0][1]); assert.ok(/一方で/.test(x.rows[1][1])); });
  });
});

test('P03 three facts read without numbers; P36 shows a reason for each lens', () => {
  fixtures.forEach((fx) => {
    const { vm, html } = built(fx.fixture_id);
    vm.p03.facts.forEach((f) => assert.ok(!/\d/.test(strip(f.text).replace(ALLOWED_NUM, '')), f.text));
    const p36 = pageText(html, 36);
    assert.equal((p36.match(/今回この三人を選ぶ理由/g) || []).length, 3, fx.fixture_id);
    ['WHY-MIRROR', 'WHY-HIDDEN', 'WHY-MENTOR'].forEach((k) => assert.ok(vm.claims.find((c) => c.claim_id === 'P36-' + k), k));
  });
});

test('pages P04–P06 and P22–P31 have explanatory prose of sufficient length', () => {
  fixtures.forEach((fx) => {
    const { vm } = built(fx.fixture_id);
    const byPage = {};
    vm.claims.forEach((c) => { byPage[c.page_id] = (byPage[c.page_id] || '') + strip(c.text); });
    ['P04', 'P05', 'P06', 'P22', 'P23', 'P24', 'P25', 'P26', 'P27', 'P29', 'P30', 'P31'].forEach((p) => assert.ok((byPage[p] || '').length >= 160, `${fx.fixture_id} ${p} ${(byPage[p] || '').length}`));
    vm.pairs.forEach((p) => p.prose.forEach((x) => assert.ok(strip(x).length >= 40 && /。$/.test(x), x)));
  });
});

test('no sentence over 160 characters and no paragraph repeats the same sentence', () => {
  fixtures.forEach((fx) => built(fx.fixture_id).vm.claims.filter((c) => NARRATIVE_PAGES.test(c.page_id)).forEach((c) => {
    const ss = strip(c.text).split('。').filter(Boolean);
    ss.forEach((s) => assert.ok(s.length <= 160, `${c.claim_id}: ${s}`));
    assert.equal(new Set(ss).size, ss.length, `${c.claim_id} repeats a sentence`);
  }));
});

test('no fixed-sample residue in other results', () => {
  const residue = ['静かな統合者', 'Quiet Integrator', 'CORE1-V4-AUDITED-SAMPLE-001', '博愛・普遍性・思慮', '人・情報・価値のあいだに立ち', 'TODO', 'lorem'];
  fixtures.filter((f) => f.fixture_id !== 'F01').forEach((fx) => {
    const t = visibleText(built(fx.fixture_id).html);
    residue.forEach((r) => assert.ok(!t.includes(r), `${fx.fixture_id}: ${r}`));
  });
  const t1 = visibleText(built('F01').html);
  ['静かな統合者', 'Quiet Integrator'].forEach((r) => assert.ok(!t1.includes(r), 'F01 ' + r));
});

test('extracted narrative text matches the frozen snapshot for all 12 fixtures', () => {
  const dir = path.join(FX, 'expected', 'text');
  fixtures.forEach((fx) => {
    const { vm } = built(fx.fixture_id);
    const pages = ['P03', 'P07', 'P08', 'P09', ...Array.from({ length: 19 }, (_, i) => 'P' + (13 + i)), 'P36'];
    const got = Object.fromEntries(pages.map((p) => [p, vm.claims.filter((c) => c.page_id === p).map((c) => strip(c.text))]));
    const file = path.join(dir, fx.fixture_id + '.json');
    if (process.env.UPDATE_TEXT_SNAPSHOTS) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n'); return; }
    assert.deepEqual(got, JSON.parse(fs.readFileSync(file, 'utf8')), fx.fixture_id);
    Object.entries(got).forEach(([p, arr]) => { if (!['P09', 'P28'].includes(p) || fx.input.mentor_goal) assert.ok(arr.join('').length > 0, `${fx.fixture_id} ${p} empty`); });
  });
});
