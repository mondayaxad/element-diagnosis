// calculations.test.js — 算出（正本エンジン一致・派生モデル・ゴールデン・拒否条件）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadEngine, EXPECTED_VERSIONS } = require('../src/engine');
const { calculateResult } = require('../src/calculate-result');
const { hiddenShape } = require('../src/models/hidden-shape');

const FX = path.join(__dirname, '..', 'fixtures');
const fixtures = fs.readdirSync(path.join(FX, 'answers')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(FX, 'answers', f), 'utf8')) }));
const eng = loadEngine();
const APPROVED = require('../fixtures/golden/approved_sample_CORE1-V4-AUDITED-SAMPLE-001.json');

test('12 fixtures exist and are deterministic', () => {
  assert.ok(fixtures.length >= 12);
  fixtures.forEach((fx) => {
    const a = calculateResult(fx.input), b = calculateResult(fx.input);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  });
});

test('every fixture matches its frozen expected snapshot', () => {
  const { summary } = require('../tools/freeze-expected.js');
  fixtures.forEach((fx) => {
    const exp = JSON.parse(fs.readFileSync(path.join(FX, 'expected', fx.file), 'utf8'));
    assert.deepEqual(JSON.parse(JSON.stringify(summary(calculateResult(fx.input)))), exp, fx.file);
  });
});

test('all numbers equal the canonical engine output (no re-implementation)', () => {
  fixtures.forEach((fx) => {
    const s = calculateResult(fx.input);
    const r = eng.E.computeResultsV2(fx.input.answers, { questions: eng.Q, meta: eng.META, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
    assert.deepEqual({ ...s.axes.personality }, r.personality);
    assert.deepEqual({ ...s.axes.style }, r.style);
    assert.deepEqual({ ...s.axes.values }, r.values);
    [['element', r.elementRanking], ['weapon', r.weaponRanking], ['nation', r.nationRanking]].forEach(([k, rows]) => {
      assert.deepEqual(s.rankings[k].map((x) => x.key), rows.map((x) => x.name));
      assert.deepEqual(s.rankings[k].map((x) => x.display), rows.map((x) => x.closenessScore));
      assert.deepEqual(s.rankings[k].map((x) => x.distance), rows.map((x) => x.distance));
    });
    const m = eng.resolver.computeMirror(r, 'ETI-MIRROR-2.1.0');
    assert.deepEqual(s.mirror.top10.map((x) => x.name), m.rankings.slice(0, 10).map((x) => x.name));
    assert.equal(s.mirror.selected.name, m.mirror.name);
  });
});

test('ranking uses raw values, display uses rounded values', () => {
  fixtures.forEach((fx) => {
    const s = calculateResult(fx.input);
    ['element', 'weapon', 'nation'].forEach((k) => {
      const rows = s.rankings[k];
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i].distance >= rows[i - 1].distance);
      rows.forEach((x) => assert.ok(Number.isInteger(x.display)));
    });
    for (let i = 1; i < s.mirror.top10.length; i++) assert.ok(s.mirror.top10[i].raw <= s.mirror.top10[i - 1].raw);
    for (let i = 1; i < s.hidden.top10.length; i++) assert.ok(s.hidden.top10[i].raw <= s.hidden.top10[i - 1].raw);
  });
  const tie = calculateResult(fixtures.find((f) => f.fixture_id === 'F10').input);
  const hit = ['element', 'weapon', 'nation'].find((k) => tie.rankings[k][0].display === tie.rankings[k][1].display);
  assert.ok(hit, 'F10 must have a display tie at the top');
  assert.ok(tie.rankings[hit][0].distance < tie.rankings[hit][1].distance, 'raw values differ and order by raw');
});

test('golden: approved sample (F01) equals the frozen approved values', () => {
  const s = calculateResult(fixtures.find((f) => f.fixture_id === 'F01').input);
  assert.deepEqual(JSON.parse(JSON.stringify(s.axes)), { personality: APPROVED.axes.personality, style: APPROVED.axes.style, values: APPROVED.axes.values });
  Object.entries(APPROVED.axes.values_centered).forEach(([k, v]) => assert.ok(Math.abs(s.values_centered[k] - v) < 1e-12, k));
  assert.equal(s.diagnosis_code, APPROVED.diagnosis_code);
  const pick = (rows) => rows.map((r) => [r.name, r.display]);
  assert.deepEqual(pick(s.rankings.element), pick(APPROVED.rankings.elements));
  assert.deepEqual(pick(s.rankings.weapon), pick(APPROVED.rankings.weapons));
  assert.deepEqual(pick(s.rankings.nation), pick(APPROVED.rankings.nations));
  assert.deepEqual(pick(s.mirror.top10), pick(APPROVED.mirror.top10));
  assert.deepEqual(pick(s.hidden.top10), pick(APPROVED.hidden_shape.top10));
  assert.deepEqual(pick(s.mentor.top10), pick(APPROVED.mentor.top10));
  assert.deepEqual(s.domains.items.map((d) => d.display), APPROVED.domain_editorial.means.map((d) => d.display));
});

test('invalid answers are refused (missing / out of range / extra id / non-integer)', () => {
  const base = fixtures[0].input;
  const bad = [
    (a) => { delete a.Q050; },
    (a) => { a.Q001 = 3; },
    (a) => { a.Q101 = 0; },
    (a) => { a.Q002 = 1.5; },
    (a) => { a.Q003 = null; },
  ];
  bad.forEach((mut) => {
    const answers = { ...base.answers }; mut(answers);
    assert.throws(() => calculateResult({ ...base, answers }), /invalid report input/);
  });
  assert.throws(() => calculateResult({ ...base, versions: { ...EXPECTED_VERSIONS, mirror: 'ETI-MIRROR-2.0.2' } }), /versions.mirror/);
});

test('VALUES flat: all nations equal, flagged so no nation is narrated as meaningful', () => {
  const s = calculateResult(fixtures.find((f) => f.fixture_id === 'F09').input);
  assert.equal(s.values_flat, true);
  assert.equal(new Set(s.rankings.nation.map((r) => r.display)).size, 1);
});

test('MIRROR selection uses resolver .mirror, not rankings[0] (exact-tie rule via canonical selector)', () => {
  // 実在の118名には座標が同一の組が無く、100問回答で完全同率は実質起こらない。
  // そこで、正本の選択関数そのものへ「完全同率」の行を与えて、元素→国家→武器→canonical の規則を確認する。
  const s = calculateResult(fixtures[1].input);
  const rows = [
    { name: 'A', mirrorScoreRaw: 80, canonicalIndex: 5, element: '炎', region: 'モンド', weapon: '弓' },
    { name: 'B', mirrorScoreRaw: 80, canonicalIndex: 2, element: '風', region: '璃月', weapon: '弓' },
    { name: 'C', mirrorScoreRaw: 79, canonicalIndex: 1, element: '風', region: 'モンド', weapon: '弓' },
  ];
  const sel = eng.SEL.selectFromRankings(rows, { element: ['風'], nation: ['モンド'], weapon: ['弓'] });
  assert.equal(sel.mirror.name, 'B');
  assert.equal(sel.selectionMeta.selectedBy, 'element_match');
  const sel2 = eng.SEL.selectFromRankings([{ ...rows[0], element: '風' }, rows[1]], { element: ['風'], nation: ['モンド'], weapon: ['弓'] });
  assert.equal(sel2.mirror.name, 'A');
  assert.equal(sel2.selectionMeta.selectedBy, 'nation_match');
  assert.equal(s.mirror.top10.filter((r) => r.selected).length <= 1, true);
});

test('HIDDEN SHAPE: tie-break order P → S → V → canonical', () => {
  const meta = eng.META;
  const u = { personality: { O: 60, C: 50, E: 40, A: 55, N: 45 }, style: { AGY: 50, REL: 60, ROL: 40, REF: 55, AUT: 45 }, values: Object.fromEntries(meta.valueAxes.map((a, i) => [a, 40 + i * 3])) };
  const twin = { name: 'X', ...JSON.parse(JSON.stringify(u)) };
  const rows = hiddenShape(u, [{ ...twin, name: 'late' }, { ...twin, name: 'early' }], meta);
  assert.deepEqual(rows.map((r) => r.name), ['late', 'early']); // 完全同率は canonical index 順
  assert.ok(Math.abs(rows[0].raw - 1) < 1e-12);
});

test('MENTOR: no goal → no ranking; goal → only listed axes move, clamped 0..100', () => {
  const noGoal = calculateResult(fixtures.find((f) => f.fixture_id === 'F03').input);
  assert.equal(noGoal.mentor.status, 'goal_not_selected');
  assert.equal(noGoal.mentor.top10.length, 0);
  const s = calculateResult(fixtures[0].input);
  assert.equal(s.mentor.status, 'ok');
  const changed = new Set(s.mentor.changes.map((c) => c.axis));
  ['personality', 'style', 'values'].forEach((L) => Object.keys(s.axes[L]).forEach((ax) => {
    if (!changed.has(ax)) assert.equal(s.mentor.target[L][ax], s.axes[L][ax]);
    assert.ok(s.mentor.target[L][ax] >= 0 && s.mentor.target[L][ax] <= 100);
  }));
  assert.throws(() => calculateResult({ ...fixtures[0].input, mentor_goal: { ...fixtures[0].input.mentor_goal, deltas: { 'personality.ZZ': 10 } } }), /unknown axis/);
});

test('DOMAIN: simple means of the fixed 4 axes, excluded ST/HE/CO/TR', () => {
  const s = calculateResult(fixtures[0].input);
  const all = { ...s.axes.personality, ...s.axes.style, ...s.axes.values };
  s.domains.items.forEach((d) => assert.equal(d.display, Math.round(d.axes.reduce((a, x) => a + all[x.axis], 0) / 4)));
  assert.deepEqual([...s.domains.excludedAxes], ['ST', 'HE', 'CO', 'TR']);
});

test('coverage: every element / weapon / nation is #1 at least once', () => {
  const tops = { element: new Set(), weapon: new Set(), nation: new Set() };
  fixtures.forEach((fx) => { const s = calculateResult(fx.input); if (!s.values_flat) tops.nation.add(s.rankings.nation[0].key); tops.element.add(s.rankings.element[0].key); tops.weapon.add(s.rankings.weapon[0].key); });
  assert.equal(tops.element.size, 7); assert.equal(tops.weapon.size, 5); assert.equal(tops.nation.size, 8);
});

test('snapshot is immutable and carries all versions', () => {
  const s = calculateResult(fixtures[0].input);
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.axes.personality) && Object.isFrozen(s.mirror.top10[0]));
  ['diagnosis', 'items', 'scoring', 'translation', 'characters', 'mirror', 'hidden', 'mentor', 'domain', 'report_content_version', 'report_template_version'].forEach((k) => assert.ok(s.versions[k], k));
  assert.equal(s.engine_provenance.length, 6);
});
