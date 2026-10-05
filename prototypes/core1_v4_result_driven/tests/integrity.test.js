// integrity.test.js — 内容整合性（極性・核の方向・代替・主観推測・緊張・人物文の反復・P03/P39一元化）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePolarity } = require('../src/polarity');
const { loadContent } = require('../src/content-store');
const { fixtures, built, visibleText, pageText } = require('./helpers');

const K = loadContent();
const AX = K.axes.axes;
const strip = (s) => s.replace(/<[^>]+>/g, '');
// 合成スナップショット（極性だけを検証するための最小形）
function synth(p, s, v) { return { axes: { personality: p, style: s, values: v } }; }
const P0 = { O: 50, C: 50, E: 50, A: 50, N: 50 }, S0 = { AGY: 50, REL: 50, ROL: 50, REF: 50, AUT: 50 };
const V0 = { SD: 50, ST: 50, HE: 50, AC: 50, PO: 50, SE: 50, CO: 50, TR: 50, BE: 50, UN: 50 };

test('1. low-score polarity is never inverted (unit + all fixtures)', () => {
  // 低い値 → 低得点側の読み、高い値 → 高得点側の読み
  const pl = makePolarity(synth({ ...P0, E: 20, O: 85 }, S0, { ...V0, PO: 20, UN: 80 }), K.axes);
  assert.equal(pl.side('E'), 'lo'); assert.equal(pl.pole('E'), '内省・少人数側');
  assert.ok(pl.extremeSentence('valley', ['E']).includes(AX.E.lo_reading));
  assert.ok(!pl.extremeSentence('valley', ['E']).includes(AX.E.hi_reading));
  assert.equal(pl.side('PO'), 'lo'); assert.ok(pl.label('PO').includes('地位を優先しにくい側'));
  assert.ok(pl.extremeSentence('peak', ['O']).includes(AX.O.hi_reading));
  // 相対的な谷でも値が高得点側にある時は、低得点側の意味を当てない
  const allHigh = makePolarity(synth({ O: 80, C: 82, E: 70, A: 85, N: 75 }, S0, V0), K.axes);
  const vs = allHigh.extremeSentence('valley', ['E']);
  assert.ok(!vs.includes(AX.E.lo_reading) && vs.includes(AX.E.hi_reading) && vs.includes('相対的に低い位置'), vs);
  // 全フィクスチャ：谷の文に出る軸は、本人の実際の側の読みだけを使う
  fixtures.forEach((fx) => {
    const { vm, snap } = built(fx.fixture_id);
    const pl2 = makePolarity(snap, K.axes);
    vm.claims.filter((c) => /POLARITY/.test(c.rule_id)).forEach((c) => {
      const t = strip(c.text);
      Object.keys(AX).forEach((ax) => {
        if (!t.includes(AX[ax].lo_reading) && !t.includes(AX[ax].hi_reading)) return;
        const wrong = pl2.side(ax) === 'lo' ? AX[ax].hi_reading : AX[ax].lo_reading;
        assert.ok(!t.includes(wrong), `${fx.fixture_id} ${c.claim_id} ${ax}`);
      });
    });
  });
});

test('2. every axis has separate high/low meanings in natural language', () => {
  Object.values(AX).forEach((a) => {
    assert.ok(a.hi_pole.endsWith('側') && a.lo_pole.endsWith('側') && a.hi_pole !== a.lo_pole, a.code);
    assert.ok(a.lo_reading.includes('頻度が低く'), a.code + ' lo_reading');
    assert.ok(a.hi_reading.includes('頻度が高く'), a.code + ' hi_reading');
    assert.ok(a.hi && a.lo && a.high_desc && a.low_desc, a.code);
    assert.ok(a.lo_noun.includes(a.lo_pole) && a.hi_noun.includes(a.hi_pole), a.code + ' noun carries direction');
    assert.ok(!/弱|控えめさ|出にく/.test(a.lo_reading + a.lo_noun + a.lo_pole), a.code + ' no weakness wording');
  });
  // 谷の文は指定の形式
  fixtures.forEach((fx) => {
    const c = built(fx.fixture_id).vm.claims.find((x) => x.claim_id === 'P03-PEAKS');
    assert.match(strip(c.text), /数値の谷は.+です。.+方向として現れます。$/, fx.fixture_id);
  });
});

test('3. every displayed 核 carries its direction', () => {
  fixtures.forEach((fx) => {
    const { vm, html } = built(fx.fixture_id);
    ['element', 'weapon', 'nation'].forEach((k) => vm.details[k].forEach((d) => {
      if (!d.core.primary) return;
      d.core.records.forEach((r) => {
        ['core_axis_code', 'core_axis_score', 'core_axis_pole', 'core_axis_phrase', 'core_selection_reason'].forEach((f) => assert.ok(r[f] !== undefined && r[f] !== '', f));
        assert.ok(r.core_axis_phrase.includes(r.core_axis_pole) && r.core_axis_pole.endsWith('側'));
      });
    }));
    for (let n = 13; n <= 21; n++) {
      const seg = html.slice(html.indexOf(`id="p${n}"`), html.indexOf('<section class="page', html.indexOf(`id="p${n}"`) + 5));
      [...seg.matchAll(/<span class="core-note">([^<]*)<\/span>/g)].forEach((m) => assert.ok(/核（主要一致軸）：[^（]+（[^）]+側）/.test(m[1]), `${fx.fixture_id} P${n}: ${m[1]}`));
      [...seg.matchAll(/<span class="tc [^"]*core[^"]*">(.*?)<\/span>/g)].forEach((m) => assert.ok(/pole-tag">[^<]+側</.test(m[1]), `${fx.fixture_id} P${n} chip`));
    }
    vm.claims.filter((c) => /BODY-MEANING/.test(c.claim_id) && c.text.includes('形づくっている中心')).forEach((c) => assert.match(strip(c.text), /中心（主要一致軸）は、[^。]+（[^）]+側）です。/, c.claim_id));
  });
});

test('4. lower categories are never claimed to be fully substituted', () => {
  const bad = /近い目的に届|同じ目的に届|代替できます|代わりになります|補えば十分/;
  fixtures.forEach((fx) => {
    const { vm, html } = built(fx.fixture_id);
    vm.claims.forEach((c) => assert.ok(!bad.test(c.text), `${fx.fixture_id} ${c.claim_id}: ${c.text}`));
    ['element', 'weapon', 'nation'].forEach((k) => vm.navigate[k].substitute.forEach((x) => {
      ['required_outcome', 'upper_strength_contribution', 'remaining_gap', 'external_support', 'minimum_practice'].forEach((f) => assert.ok(x[f], f));
      assert.ok(x.text.includes('代替しない') && x.text.includes(x.remaining_gap), x.text);
    }));
    [29, 30, 31, 32].forEach((n) => { const t = pageText(html, n); assert.ok(!bad.test(t) && !t.includes('上位資質で代替する方法') && !t.includes('上位で代替する'), `${fx.fixture_id} P${n}`); });
    [29, 30, 31].forEach((n) => assert.ok(pageText(html, n).includes('上位資質から同じ目的へ近づく方法')));
  });
});

test('5. no guessing of the reader\'s inner states', () => {
  const bad = /自分では弱いと思|弱いと思っていた|気づいていなかった|本当は望んで|本当は|無意識に|過去に傷つ|見落としていた|隠れていた/;
  fixtures.forEach((fx) => {
    const t = visibleText(built(fx.fixture_id).html);
    const m = t.match(bad); assert.ok(!m, `${fx.fixture_id}: ${m && m[0]}`);
  });
  const t8 = pageText(built('F01').html, 27);
  assert.ok(t8.includes('数値の高さだけでは目立ちにくかった') && t8.includes('絶対値ではなく相対配置を見ると'));
});

test('6. a tension is shown only with a concrete conflict scene', () => {
  const rules = K.rules.tensions;
  rules.filter((r) => r.type === 'tension').forEach((r) => assert.ok(r.conflict_scene && r.conflict_scene.length >= 20, r.id));
  rules.filter((r) => r.type === 'coexist').forEach((r) => assert.ok(!/緊張/.test(r.text) && !r.conflict_scene, r.id));
  fixtures.forEach((fx) => {
    const { vm, html } = built(fx.fixture_id);
    vm.tensions.forEach((t) => {
      if (t.type === 'tension') assert.ok(t.conflict_scene, t.id);
      else assert.ok(!/緊張/.test(t.text), t.id);
    });
    const nT = vm.tensions.filter((t) => t.type === 'tension').length;
    if (nT < 2) assert.ok(!pageText(html, 3).includes('二つの内的緊張'), fx.fixture_id);
    vm.pairs.forEach((p) => { if (p.rel === 'tension') { assert.ok(p.conflictScene && p.ratio >= 0.5, p.page); assert.ok(strip(p.prose[2]).includes(p.conflictScene.replace(/。$/, '').slice(0, 10))); } });
    const c25 = vm.claims.find((c) => c.claim_id === 'P25-CONFLICT');
    if (vm.tensions[0].type === 'tension') assert.equal(c25.text, vm.tensions[0].conflict_scene);
    else assert.ok(c25.text.startsWith('同じ場面で別の行動を求めるほどの葛藤は'));
  });
});

test('7. character lines do not repeat the same phrase or sentence pattern', () => {
  fixtures.forEach((fx) => {
    const { vm } = built(fx.fixture_id);
    ['mirror', 'hidden', 'mentor'].forEach((lens) => {
      const page = { mirror: 'P07', hidden: 'P08', mentor: 'P09' }[lens];
      const cs = vm.claims.filter((c) => c.page_id === page && /^P0\d-CHAR-/.test(c.claim_id));
      if (!cs.length) return;
      assert.equal(new Set(cs.map((c) => c.text)).size, cs.length, `${fx.fixture_id} ${lens} identical lines`);
      const tagUse = {}, patUse = {};
      cs.forEach((c) => {
        const [tags, pat] = c.content_id.replace('CHAR_LANGUAGE.', '').split('.pattern');
        tags.split('+').forEach((t) => { tagUse[t] = (tagUse[t] || 0) + 1; });
        patUse[pat] = (patUse[pat] || 0) + 1;
      });
      const maxTag = Math.max(...Object.values(tagUse)), maxPat = Math.max(...Object.values(patUse));
      assert.ok(maxTag <= 3, `${fx.fixture_id} ${lens} same phrase ${maxTag} times`);
      assert.ok(maxPat / cs.length <= 0.5, `${fx.fixture_id} ${lens} same pattern ${maxPat}/${cs.length}`);
    });
  });
});

test('8. P03 and P39 show the same claims (single source)', () => {
  fixtures.forEach((fx) => {
    const { vm, html } = built(fx.fixture_id);
    assert.equal(vm.p39.facts, vm.p03.facts);
    assert.ok(!vm.claims.some((c) => c.page_id === 'P39' && /FACT|TENSION|QUESTION/.test(c.claim_id)), 'no separate P39 facts');
    const p3 = pageText(html, 3).replace(/\s+/g, ''), p39 = pageText(html, 39).replace(/\s+/g, '');
    vm.p39.sharedClaimIds.forEach((id) => {
      const c = vm.claims.find((x) => x.claim_id === id); assert.ok(c, id);
      const t = strip(c.text).replace(/\s+/g, '');
      assert.ok(p3.includes(t), `${fx.fixture_id} P03 ${id}`); assert.ok(p39.includes(t), `${fx.fixture_id} P39 ${id}`);
    });
  });
});

test('P07 note reads as a sentence; P25 type name is on one line', () => {
  fixtures.forEach((fx) => {
    const { html, vm } = built(fx.fixture_id);
    assert.ok(!pageText(html, 7).includes('一文は、人物の説明は'));
    assert.ok(html.includes(`class="tri-c one">${vm.typeName}</text>`), fx.fixture_id);
  });
});
