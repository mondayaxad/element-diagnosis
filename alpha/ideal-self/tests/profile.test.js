// FutureSelfProfile：必須項目・出所と版・再現性・反転しない・理想で変わる・推論を事実として記録しない
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, F, etiCurrent, quickCurrent, answerAll, QUIET_CHARISMA, WARM_DRIVE, ALL_UNKNOWN } from './helpers.js';
import { buildFutureSelfProfile, setApproval } from '../src/profile.js';
import { RULE_VERSION } from '../src/catalog.js';

const draft = (s) => S.buildDraft(s).profile;

const REQUIRED = ['future_horizon_years', 'observed_traits', 'protected_traits', 'growth_targets', 'aspirational_traits', 'core_values',
  'decision_principles', 'expression_profile', 'source_provenance', 'inference_status', 'persona_version', 'approval_status'];

test('必須項目がそろい、標準5年・未確認で始まる', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  for (const k of REQUIRED) assert.ok(k in p, `必須項目がありません: ${k}`);
  assert.equal(p.future_horizon_years, 5);
  assert.equal(p.approval_status, 'unconfirmed');
  assert.ok(p.persona_version.startsWith(RULE_VERSION));
});

test('出所と版が記録される（ETI 経路）', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const sp = p.source_provenance;
  assert.equal(sp.current_source, 'eti_v2');
  assert.equal(sp.eti.diagnosis_version, 'ETI-2.0');
  assert.equal(sp.eti.item_set_version, 'ETI-ITEM-2.0.0');
  assert.equal(sp.eti.scoring_version, 'ETI-SCORE-2.0.0');
  assert.equal(sp.eti.record_ref, 'syn-sess-0001');
  for (const k of ['ideal_question_set_version', 'rule_version', 'catalog_version', 'consent_version', 'profile_schema_version']) assert.ok(sp[k], k);
});

test('出所と版が記録される（簡易質問経路）・ETI の観測として記録しない', () => {
  const p = draft(answerAll(quickCurrent(), QUIET_CHARISMA));
  assert.equal(p.source_provenance.current_source, 'quick_questions');
  assert.equal(p.source_provenance.eti, null);
  assert.ok(p.source_provenance.quick_question_set_version);
  assert.equal(p.observed_scales, null);
  assert.ok(p.observed_traits.length > 0);
  for (const t of p.observed_traits) assert.equal(t.inference_status, 'user_answer');
  const statuses = [];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (typeof x.inference_status === 'string') statuses.push(x.inference_status); if (Array.isArray(x.statuses)) statuses.push(...x.statuses); Object.entries(x).forEach(([k, v]) => k !== 'legend' && walk(v)); } };
  walk(p);
  assert.ok(statuses.length > 0);
  assert.ok(!statuses.includes('observed'), '簡易質問経路に「尺度の観測値」が混ざっています');
});

test('下書きのすべての要素に出所（根拠）がある', () => {
  for (const cur of [etiCurrent(), quickCurrent()]) {
    const p = draft(answerAll(cur, QUIET_CHARISMA));
    for (const t of p.protected_traits) assert.ok(t.sources.length > 0, t.trait);
    for (const g of p.growth_targets) assert.ok(g.sources.length > 0, g.capability);
    for (const a of p.aspirational_traits) assert.ok(a.sources.length > 0, a.aspiration);
    for (const v of p.core_values) assert.ok(v.sources.length > 0, v.value);
    for (const d of p.decision_principles) { assert.ok(d.basis.length > 0, d.id); assert.equal(d.status, 'draft'); assert.equal(d.inference_status, 'system_inferred'); }
    for (const t of p.observed_traits) assert.ok(t.evidence, t.trait);
  }
});

test('観測・本人回答・推論・不明が区別され、推論は本人回答や ETI 観測として記録しない', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const allowed = ['observed', 'user_answer', 'system_inferred', 'unknown'];
  const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if ('inference_status' in x && typeof x.inference_status === 'string') assert.ok(allowed.includes(x.inference_status), x.inference_status); Object.values(x).forEach(walk); } };
  walk(p);
  // 本人が選んでいない観測特性は「システムの推論（候補）」で、confirmed にならない
  // 本人が選んでいない観測特性は、保護特性ではなく候補（推論）。保護特性には確定したものだけが入る
  const cand = p.protected_trait_candidates.filter((t) => t.basis === 'derived_from_current');
  assert.ok(cand.length > 0);
  for (const t of cand) { assert.equal(t.inference_status, 'system_inferred'); assert.equal(t.confirmed, false); assert.ok(t.sources.every((s) => s.kind === 'observed_trait')); }
  for (const t of p.protected_traits) assert.equal(t.confirmed, true);
  // 振る舞い・統合・要約・判断原則は推論
  for (const g of p.growth_targets) assert.equal(g.behavior.inference_status, 'system_inferred');
  for (const a of p.aspirational_traits) assert.equal(a.integration.inference_status, 'system_inferred');
  assert.equal(p.summary.inference_status, 'system_inferred');
});

test('§3：内向的な現在像＋静かなカリスマ → 内向性を保った人物像になり、社交的に反転しない', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  assert.ok(p.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed));
  assert.ok(!p.protected_traits.some((t) => t.trait === 'sociability'));
  assert.match(p.summary.text, /一人で深く考える/);
  assert.doesNotMatch(p.summary.text, /社交的|誰とでも|中心にいる|明るく/);
  assert.match(p.growth_targets[0].behavior.text, /一人でまとめてから/);
  assert.ok(p.expression_profile.avoid.items.some((x) => /場の中心/.test(x)));
  assert.ok(p.decision_principles.some((d) => d.id === 'DP_CONTINUITY' && /内省/.test(d.text)));
});

test('保護特性と憧れが逆向き：確認なしに反転させない（未確定なら保護したまま）', () => {
  const base = { ...QUIET_CHARISMA, E1: ['radiance'], G1: ['social_ease'], G2: ['crowd'] };
  const s = answerAll(etiCurrent(), base); // 追加質問はすべて「わからない」
  assert.ok(s.followups.some((f) => f.kind === 'inversion' && f.trait === 'inner_focus'));
  const p = draft(s);
  assert.ok(p.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed));
  assert.ok(p.inference_status.unresolved.some((u) => u.field === 'protected_traits'));
  const social = p.growth_targets.find((g) => g.capability === 'social_ease');
  assert.match(social.behavior.text, /社交的に振る舞うのではなく/);
  assert.ok(social.constraints.length > 0);
});

test('本人が「手放す」を選んだときだけ、保護特性から外れる', () => {
  const base = { ...QUIET_CHARISMA, E1: ['radiance'], G1: ['social_ease'], G2: ['crowd'], G4: ['transform'] };
  const p = draft(answerAll(etiCurrent(), base, (q) => (q.kind === 'inversion' ? 'release' : 'unknown')));
  assert.ok(!p.protected_traits.some((t) => t.trait === 'inner_focus'));
  assert.ok(p.released_traits.some((t) => t.trait === 'inner_focus' && t.source.kind === 'answer'));
});

test('同じ現在像でも、理想の回答が違えば下書きが変わる', () => {
  const a = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const b = draft(answerAll(etiCurrent(), WARM_DRIVE));
  assert.notEqual(a.persona_version, b.persona_version);
  assert.notEqual(a.summary.text, b.summary.text);
  assert.notDeepEqual(a.aspirational_traits.map((x) => x.aspiration), b.aspirational_traits.map((x) => x.aspiration));
  assert.notDeepEqual(a.growth_targets.map((x) => x.capability), b.growth_targets.map((x) => x.capability));
  assert.notDeepEqual(a.decision_principles.map((x) => x.text), b.decision_principles.map((x) => x.text));
  assert.deepEqual(a.observed_traits, b.observed_traits);
});

test('同じ合成入力・同じルール版から、同じ構造化下書きが再現される', () => {
  const a = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const b = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  assert.deepEqual(a, b);
  const s = answerAll(etiCurrent(), QUIET_CHARISMA);
  const c = buildFutureSelfProfile({ current: s.current, answers: JSON.parse(JSON.stringify(s.idealAnswers)), followups: s.followups, overflow: s.overflow });
  assert.deepEqual(c, a);
  // 答える順番が違っても同じ
  let t = S.startIdeal(etiCurrent());
  for (const k of Object.keys(QUIET_CHARISMA).reverse()) t = S.answerIdeal(t, k, QUIET_CHARISMA[k]);
  assert.deepEqual(draft(t), a);
});

test('情報が不足すると「不明」とし、恣意的に補わない', () => {
  const s = answerAll(quickCurrent({ C1: ['unknown'], C2: ['unknown'], C3: ['unknown'], C4: ['unknown'], C5: ['unknown'], C6: ['unknown'] }), ALL_UNKNOWN);
  const p = draft(s);
  assert.equal(p.observed_traits.length, 0);
  assert.equal(p.growth_targets.length, 0);
  assert.equal(p.aspirational_traits.length, 0);
  assert.equal(p.core_values.length, 0);
  assert.equal(p.protected_traits.length, 0);
  assert.equal(p.decision_principles.length, 0);
  const fields = p.inference_status.unknowns.map((u) => u.field);
  for (const f of ['protected_traits', 'growth_targets', 'aspirational_traits', 'core_values', 'decision_principles']) assert.ok(fields.includes(f), f);
  assert.equal(p.expression_profile.channel.inference_status, 'unknown');
});

test('予測・検証済み測定として表示しない（注意書きと下書き表示）', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  assert.match(p.disclaimer, /予測でも、検証済みの人格測定でもありません/);
  assert.equal(p.summary.status, 'draft');
  assert.doesNotMatch(JSON.stringify(p), /あなたは5年後.*なります|必ず|科学的に/);
});

test('Phase 2 の評価3軸を紐づけられる構造がある（評価UIは未実装）', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  assert.deepEqual(p.evaluation.axes.map((a) => a.id), ['self_continuity', 'aspiration', 'attainability']);
  assert.deepEqual(p.evaluation.scale, [1, 5]);
  assert.equal(p.evaluation.ratings, null);
  assert.equal(p.expression_profile.phase2_constraints.tone_presets, 'not_used');
  assert.ok(p.expression_profile.phase2_constraints.do_not_infer_from_scales.includes('gender'));
});

test('承認状態の値は 未確認・修正待ち・承認済み だけ（遷移は persona_lifecycle.test.js で確認）', () => {
  const p = draft(answerAll(etiCurrent(), QUIET_CHARISMA));
  assert.equal(p.approval_status, 'unconfirmed');
  assert.throws(() => setApproval(p, 'final'));
  for (const st of ['unconfirmed', 'needs_revision', 'approved']) assert.equal(setApproval(p, st).approval_status, st);
});
