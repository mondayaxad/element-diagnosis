// 追加質問（必要なときだけ・最大18問）、戻る・再操作で状態に矛盾が出ないこと、同意撤回の派生データの扱い
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, F, etiCurrent, quickCurrent, answerAll, QUIET_CHARISMA, ALL_UNKNOWN } from './helpers.js';
import { IDEAL_QUESTIONS, QUICK_QUESTIONS, MAX_QUESTIONS, BASE_QUESTION_COUNT, MAX_FOLLOWUPS } from '../src/questions.js';
import { computeFollowups } from '../src/adaptive.js';
import { judgeRevocation } from '../src/consent.js';

test('質問セットの形：KEEP・GROW・EXPRESS 各4問、計12問、上限18問、すべて選択式', () => {
  const by = (p) => IDEAL_QUESTIONS.filter((q) => q.purpose === p).length;
  assert.equal(by('KEEP'), 4); assert.equal(by('GROW'), 4); assert.equal(by('EXPRESS'), 4);
  assert.equal(IDEAL_QUESTIONS.length, BASE_QUESTION_COUNT);
  assert.equal(MAX_QUESTIONS, 18); assert.equal(MAX_FOLLOWUPS, 6);
  assert.equal(QUICK_QUESTIONS.length, 6);
  for (const q of [...IDEAL_QUESTIONS, ...QUICK_QUESTIONS]) {
    assert.ok(q.options.length >= 2, q.id);
    assert.ok(q.options.some((o) => o.id === 'unknown'), `${q.id} に「わからない」がない`);
    assert.ok(q.why, `${q.id} に設問意図がない`);
    assert.doesNotMatch(q.text, /キャラクター|口調/, `${q.id} がキャラクター設定式`);
  }
});

test('一貫した回答では追加質問を出さない（12問で終わる）', () => {
  const s = answerAll(etiCurrent(), QUIET_CHARISMA);
  assert.equal(s.followups.length, 0);
  assert.equal(S.idealQueue(s).length, 12);
  assert.ok(S.idealDone(s));
});

test('追加質問は基本12問が終わるまで出さない', () => {
  let s = S.startIdeal(etiCurrent());
  for (const k of Object.keys(ALL_UNKNOWN).slice(0, 11)) s = S.answerIdeal(s, k, ['unknown']);
  assert.equal(S.idealQueue(s).length, 12);
  assert.equal(s.followups.length, 0);
});

test('未確定・矛盾のときだけ追加質問が出て、理由がつき、上限を超えない', () => {
  const s = answerAll(etiCurrent(), ALL_UNKNOWN);
  assert.ok(s.followups.length > 0);
  assert.ok(s.followups.length <= MAX_FOLLOWUPS);
  assert.ok(S.idealQueue(s).length <= MAX_QUESTIONS);
  for (const f of s.followups) assert.ok(f.reason && f.reason.length > 5, f.id);
  const kinds = s.followups.map((f) => f.kind);
  for (const k of ['keep_unclear', 'values_unclear', 'growth_unclear', 'aspiration_unclear']) assert.ok(kinds.includes(k), k);
});

test('矛盾が多くても18問を超えず、出せなかった分は未確定として下書きに残る', () => {
  // 外向的な観測＋内省・深化を残したい＋社交・明るさを望む＋性格を変えたい＋G1/G2 の食い違い＋価値観不明
  const base = { K1: ['inner_focus', 'depth_mastery'], K2: ['think'], K3: ['unknown'], K4: ['impulsive'],
    G1: ['social_ease'], G2: ['stop'], G3: ['leap'], G4: ['transform'],
    E1: ['radiance', 'quiet_presence'], E2: ['large_group'], E3: ['passion'], E4: ['move'] };
  const ext = etiCurrent({ ...F.OWN_EXTRAVERT, personality: { ...F.OWN_EXTRAVERT.personality, O: 80 } }); // 好奇心も観測され、深化との食い違いが増える
  // 基本回答だけでは成長目標の優先度が未定。優先度に答えると、確定した目標への確認（2段目）が加わって上限を超える
  assert.equal(computeFollowups(ext.current, base).followups.length, MAX_FOLLOWUPS);
  const { followups, overflow } = computeFollowups(ext.current, { ...base, F_GROW_PRIORITY: ['unknown'] });
  assert.equal(followups.length, MAX_FOLLOWUPS);
  assert.ok(overflow.length > 0, '上限を超える候補があるはず');
  const s = answerAll(ext, base);
  assert.equal(S.idealQueue(s).length, MAX_QUESTIONS);
  const p = S.buildDraft(s).profile;
  // 上限で出せなかった確認は、保護特性を維持したまま未確定として記録される
  const limitEntries = p.inference_status.unresolved.filter((u) => u.field === 'question_limit' || (u.kind === 'protection_check' && /上限/.test(u.why)));
  assert.ok(limitEntries.length > 0);
  assert.ok(p.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed));
  const social = p.growth_targets.find((g) => g.capability === 'social_ease');
  assert.ok(social.protection_check.some((c) => c.trait === 'inner_focus' && c.resolution === 'not_asked_question_limit' && c.status === 'unknown'));
});

test('現在像と本人選択の食い違い（ETI外向・本人は内省を残す）で確認の質問が出る', () => {
  const s = answerAll(etiCurrent(F.OWN_EXTRAVERT), { ...QUIET_CHARISMA, K1: ['inner_focus'] });
  assert.ok(s.followups.some((f) => f.kind === 'observed_mismatch' && f.observed === 'sociability'));
});

test('戻る・再操作：前の回答を変えると、不要になった追加質問の回答と下書きが消える', () => {
  const base = { ...QUIET_CHARISMA, E1: ['radiance'] };
  let s = answerAll(etiCurrent(), base, (q) => (q.kind === 'inversion' ? 'augment' : 'unknown'));
  const fid = s.followups.find((f) => f.kind === 'inversion').id;
  assert.equal(s.idealAnswers[fid][0], 'augment');
  s = S.buildDraft(s);
  assert.equal(s.step, 'draft');
  // 下書きから戻って E1 を変える
  s = S.goBack(s);
  assert.equal(s.step, 'ideal');
  s = S.answerIdeal(s, 'E1', ['quiet_presence']);
  assert.equal(s.profile, null, '古い下書きが残っています');
  assert.ok(!(fid in s.idealAnswers), '出なくなった追加質問の回答が残っています');
  assert.equal(s.followups.length, 0);
  s = S.buildDraft(s);
  assert.ok(!s.profile.source_provenance.followups_asked.some((f) => f.id === fid));
  assert.ok(!s.profile.aspirational_traits.some((a) => a.aspiration === 'radiance'));
});

test('戻る・再操作：同じ回答をやり直しても状態が変わらない／戻るを繰り返しても壊れない', () => {
  const s1 = S.buildDraft(answerAll(etiCurrent(), QUIET_CHARISMA));
  let s = s1;
  for (let i = 0; i < 30; i++) s = S.goBack(s);
  assert.equal(s.step, 'consent');
  // 現在像・回答は残っている
  assert.ok(s.current);
  assert.deepEqual(s.idealAnswers, s1.idealAnswers);
  // そのまま同じ回答をし直して下書きを作ると同一
  let t = S.startIdeal({ ...s, step: 'current_review' });
  for (const [k, v] of Object.entries(QUIET_CHARISMA)) t = S.answerIdeal(t, k, v);
  assert.deepEqual(S.buildDraft(t).profile, s1.profile);
});

test('現在像を ETI から簡易質問に切り替えると、下書きは作り直しになり ETI 由来が残らない', () => {
  let s = S.buildDraft(answerAll(etiCurrent(), QUIET_CHARISMA));
  s = S.chooseRoute({ ...s, step: 'current_select' }, 'quick');
  for (const q of QUICK_QUESTIONS) s = S.answerQuick(s, q.id, q.options[0].id);
  s = S.finishQuick(s);
  assert.equal(s.profile, null);
  assert.equal(s.imported, null);
  s = S.buildDraft(answerAll(s, QUIET_CHARISMA));
  assert.equal(s.profile.source_provenance.current_source, 'quick_questions');
  assert.ok(!JSON.stringify(s.profile).includes('syn-sess-0001'));
});

test('不正な選択（数・存在しない選択肢・未知の質問）は受け付けない', () => {
  const s = S.startIdeal(etiCurrent());
  assert.throws(() => S.answerIdeal(s, 'K1', ['inner_focus', 'curiosity', 'empathy']));
  assert.throws(() => S.answerIdeal(s, 'G1', ['clear_expression', 'mobilizing']));
  assert.throws(() => S.answerIdeal(s, 'G1', ['fly']));
  assert.throws(() => S.answerIdeal(s, 'Z9', ['x']));
  assert.throws(() => S.answerIdeal(s, 'K1', []));
  assert.deepEqual(S.answerIdeal(s, 'K1', ['inner_focus', 'unknown']).idealAnswers.K1, ['unknown']);
  assert.throws(() => S.buildDraft(s));
});

test('同意撤回（ETI）：取り込んだ値・ETI 由来の現在像・下書きを消し、現在像の選び直しへ', () => {
  let s = S.buildDraft(answerAll(etiCurrent(), QUIET_CHARISMA));
  const actions = judgeRevocation('eti_import', s).map((a) => `${a.target}:${a.action}`);
  assert.deepEqual(actions, ['imported_eti:delete', 'current:delete', 'ideal_answers:keep', 'profile:delete_and_regenerate', 'route:goto_current_select', 'persona_lifecycle:delete']);
  s = S.revoke(s, 'eti_import');
  assert.equal(s.imported, null); assert.equal(s.current, null); assert.equal(s.profile, null);
  assert.equal(s.consents.eti_import.status, 'revoked');
  assert.equal(s.step, 'current_select');
  assert.throws(() => S.buildDraft(s));
});

test('同意撤回（ETI）でも、簡易質問経路の下書きは ETI 由来を含まないので残す', () => {
  let s = S.submitConsent(S.initialState(F.SYNTHETIC_SUBJECT_ID), { eti_import: true, memory: false });
  s = S.chooseRoute(s, 'quick');
  for (const q of QUICK_QUESTIONS) s = S.answerQuick(s, q.id, q.options[0].id);
  s = S.buildDraft(answerAll(S.finishQuick(s), QUIET_CHARISMA));
  const before = s.profile;
  s = S.revoke(s, 'eti_import');
  assert.deepEqual(s.profile, before);
});

test('記憶の保存の撤回：端末保存を消す判定になる', () => {
  const s = S.submitConsent(S.initialState(F.SYNTHETIC_SUBJECT_ID), { eti_import: false, memory: true });
  assert.ok(S.canPersist(s));
  const r = S.revoke(s, 'memory');
  assert.ok(!S.canPersist(r));
  assert.ok(judgeRevocation('memory', s).some((a) => a.target === 'local_storage' && a.action === 'delete'));
});

test('外部AIへの送信は Phase 1 で固定（同意を変える操作が無い）', () => {
  const s = S.initialState(F.SYNTHETIC_SUBJECT_ID);
  assert.equal(s.consents.external_ai.status, 'not_sent');
  assert.equal(S.submitConsent(s, { eti_import: true, memory: true }).consents.external_ai.status, 'not_sent');
  assert.throws(() => S.revoke(s, 'external_ai'));
});
