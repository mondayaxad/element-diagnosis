// claims.test.js — 各表示文に trace があり、根拠・規則・辞書へ逆引きできる
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtures, built } = require('./helpers');

const KINDS = new Set(['calculated_fact', 'model_interpretation', 'editorial_hypothesis']);
test('every claim has a complete trace', () => {
  fixtures.forEach((fx) => {
    const { vm } = built(fx.fixture_id);
    assert.ok(vm.claims.length > 200, fx.fixture_id);
    const ids = new Set();
    vm.claims.forEach((c) => {
      assert.ok(c.claim_id && c.page_id && c.text && c.rule_id && c.rule_version, JSON.stringify(c));
      assert.ok(KINDS.has(c.kind), c.claim_id);
      assert.ok(['strong', 'balanced', 'tentative'].includes(c.assertion_strength), c.claim_id);
      assert.ok(Array.isArray(c.evidence), c.claim_id);
      c.evidence.forEach((e) => assert.ok(typeof e.path === 'string' && e.path.length, c.claim_id));
      assert.ok(!ids.has(c.claim_id), 'duplicate claim id ' + c.claim_id); ids.add(c.claim_id);
    });
  });
});

test('calculated facts carry evidence paths into the snapshot', () => {
  const { vm, snap } = built('F01');
  const facts = vm.claims.filter((c) => c.kind === 'calculated_fact' && c.evidence.length);
  assert.ok(facts.length >= 10);
  facts.forEach((c) => c.evidence.filter((e) => e.path.startsWith('axes.')).forEach((e) => {
    const [, L, ax] = e.path.split('.');
    assert.equal(snap.axes[L][ax], e.value, c.claim_id);
  }));
});

test('strong assertions are not issued before distribution calibration', () => {
  fixtures.forEach((fx) => built(fx.fixture_id).vm.claims.forEach((c) => assert.notEqual(c.assertion_strength, 'strong', c.claim_id)));
});

test('core-axis claims follow the dictionary rule (P13–P21)', () => {
  fixtures.forEach((fx) => {
    const { vm } = built(fx.fixture_id);
    ['element', 'weapon', 'nation'].forEach((k) => vm.details[k].forEach((d) => {
      if (d.flat) return;
      const cands = d.it.core_axes.map((c) => c.axis);
      if (d.core.primary) assert.ok(cands.includes(d.core.primary));
      d.core.supporting.forEach((a) => assert.ok(cands.includes(a)));
    }));
  });
});
