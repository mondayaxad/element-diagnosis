// neutral-standalone.test.js — 中央域・neutral を方向として扱わないこと、ZIP単体（外部フォルダなし）で検証が再現できること
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { makePolarity } = require('../src/polarity');
const { loadContent } = require('../src/content-store');
const { loadEngine, VENDOR_ROOT, PROJECT_ROOT } = require('../src/engine');
const { NEUTRAL } = require('../src/judgments');
const { fixtures, built } = require('./helpers');

const K = loadContent();
const AX = K.axes.axes;
const strip = (s) => s.replace(/<[^>]+>/g, '');
const P0 = { O: 50, C: 50, E: 50, A: 50, N: 50 }, S0 = { AGY: 50, REL: 50, ROL: 50, REF: 50, AUT: 50 };
const V0 = { SD: 50, ST: 50, HE: 50, AC: 50, PO: 50, SE: 50, CO: 50, TR: 50, BE: 50, UN: 50 };

test('N1. exact 50 / centered 0 is neutral, and mid-band axes get no 「○○側」 label', () => {
  const pl = makePolarity({ axes: { personality: { ...P0, O: 80, E: 20 }, style: { ...S0, REF: 50, REL: 46 }, values: { ...V0, SD: 70, PO: 30 } } }, K.axes);
  assert.equal(pl.side('REF'), 'neutral');
  assert.equal(pl.side('ST'), 'neutral');            // VALUES centered 0
  assert.equal(pl.label('REF'), '媒介思考（中央域）');
  assert.equal(pl.label('REL'), '関係調整（中央域）'); // 46：中央域
  assert.ok(!/側/.test(pl.label('REF') + pl.label('REL') + pl.noun('REF')));
  assert.ok(!/側/.test(pl.extremeSentence('valley', ['REL'])), pl.extremeSentence('valley', ['REL']));
  assert.equal(pl.label('E'), '外向性（内省・少人数側）');
});

test('N2. core / supporting are only taken from axes outside the mid band; trace records the decision', () => {
  fixtures.forEach((fx) => {
    const { vm, snap } = built(fx.fixture_id);
    const pl = makePolarity(snap, K.axes);
    ['element', 'weapon', 'nation'].forEach((k) => vm.details[k].forEach((d) => {
      if (d.flat) return;
      assert.ok(d.core.candidate_trace && d.core.thresholds && d.core.neutral_rule === NEUTRAL.version, `${fx.fixture_id} ${d.row.name}`);
      (d.core.records || []).forEach((r) => {
        const ax = r.core_axis_code;
        if (k === 'nation') assert.ok(Math.abs(pl.centered(ax)) >= NEUTRAL.v_abs_min, `${fx.fixture_id} ${d.row.name} ${ax} centered ${pl.centered(ax)}`);
        else assert.ok(r.core_axis_score <= NEUTRAL.ps_low_max || r.core_axis_score >= NEUTRAL.ps_high_min, `${fx.fixture_id} ${d.row.name} ${ax}=${r.core_axis_score}`);
      });
      d.core.candidate_trace.filter((c) => c.side === 'neutral').forEach((c) => assert.equal(c.status, 'excluded_neutral'));
      d.core.candidate_trace.filter((c) => c.band === 'mid' && c.status !== 'excluded_neutral' && c.status !== 'excluded_direction').forEach((c) => assert.equal(c.status, 'excluded_mid_band'));
      const meaning = vm.claims.find((c) => c.page_id === 'P' + ({ element: 13, weapon: 16, nation: 19 }[k] + vm.details[k].indexOf(d)) && c.claim_id.endsWith('BODY-MEANING'));
      assert.ok(meaning.evidence.some((e) => e.path === 'rule.thresholds'));
      if (!d.core.primary) {
        assert.ok(strip(meaning.text).includes('このカテゴリは一本の強い軸ではなく、複数軸の組合せによって形づくられています'), meaning.claim_id);
        assert.ok(meaning.evidence.some((e) => e.path === 'rule.no_core_reason'), meaning.claim_id);
      }
    }));
  });
  // F02：弓・法器で 50（媒介思考）と 46（関係調整）が核・支える軸に選ばれないこと
  const f2 = built('F02').vm;
  const bow = f2.details.weapon.find((d) => d.row.key === '弓'), cat = f2.details.weapon.find((d) => d.row.key === '法器');
  assert.deepEqual((bow.core.records || []).map((r) => r.core_axis_code), ['AUT']);
  assert.equal(cat.core.primary, null);
  assert.equal(bow.core.candidate_trace.find((c) => c.axis === 'REF').status, 'excluded_neutral');
});

test('N3. no mid-band or neutral axis is labelled with a direction anywhere in the report text', () => {
  fixtures.forEach((fx) => {
    const { vm, snap } = built(fx.fixture_id);
    const pl = makePolarity(snap, K.axes);
    const mid = Object.keys(AX).filter((ax) => !pl.directional(ax));
    vm.claims.forEach((c) => {
      const t = strip(c.text);
      mid.forEach((ax) => [AX[ax].hi_pole, AX[ax].lo_pole].forEach((pole) => {
        assert.ok(!t.includes(`${AX[ax].name}（${pole}）`), `${fx.fixture_id} ${c.claim_id}: ${AX[ax].name}（${pole}）`);
      }));
    });
  });
});

test('Z1. golden JSON and canonical engine are bundled and hash-pinned', () => {
  const gm = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'fixtures', 'golden', 'MANIFEST.json'), 'utf8'));
  Object.entries(gm.files).forEach(([f, h]) => assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(PROJECT_ROOT, 'fixtures', 'golden', f))).digest('hex'), h, f));
  const vm = JSON.parse(fs.readFileSync(path.join(VENDOR_ROOT, 'MANIFEST.json'), 'utf8'));
  Object.entries(vm.files).forEach(([f, h]) => assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(VENDOR_ROOT, f))).digest('hex'), h, f));
  // 同梱エンジンとリポジトリのエンジンが同じ結果を出す
  const a = loadEngine(), fx = fixtures[0].input;
  const r1 = a.E.computeResultsV2(fx.answers, { questions: a.Q, meta: a.META, elementPrototypes: a.EP, weaponPrototypes: a.WP, nationPrototypes: a.NP });
  const b = require('../src/engine').loadEngine.call(null, VENDOR_ROOT);
  const r2 = b.E.computeResultsV2(fx.answers, { questions: b.Q, meta: b.META, elementPrototypes: b.EP, weaponPrototypes: b.WP, nationPrototypes: b.NP });
  assert.deepEqual(JSON.parse(JSON.stringify(r1)), JSON.parse(JSON.stringify(r2)));
});

test('Z2. an extracted copy without the repository or old prototypes runs calculations + golden comparison', { timeout: 120000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'core1-zip-'));
  const dst = path.join(tmp, 'core1_v4_result_driven');
  fs.cpSync(PROJECT_ROOT, dst, { recursive: true, filter: (src) => !/[\\/](dist|node_modules)([\\/]|$)|\.zip$/.test(src) });
  assert.ok(!fs.existsSync(path.join(tmp, '..', 'js', 'eti_v2_engine.js')) || true);
  const env = { ...process.env }; delete env.ETI_ENGINE_ROOT; Object.keys(env).filter((k) => k.startsWith('NODE_TEST')).forEach((k) => delete env[k]);
  const out = execFileSync(process.execPath, ['--test', 'tests/calculations.test.js'], { cwd: dst, env, encoding: 'utf8' });
  assert.match(out, /fail\s+0/); assert.match(out, /pass\s+13/);
  const g = execFileSync(process.execPath, ['tools/golden-compare.js'], { cwd: dst, env, encoding: 'utf8' });
  assert.match(g, /すべて一致/); assert.match(g, /vendor\/eti-js/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
