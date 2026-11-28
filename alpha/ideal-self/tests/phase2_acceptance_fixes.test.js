// Phase 2 受入レビュー（86535b5）で再現した不具合の修正の確認
//   1. 見直しで追加質問が複数出たとき、1問目に答えた後も2問目に進み、両方に答えてから終われる
//   2. 見直しをキャンセルすると、開始前の回答・表示していた下書き・評価に戻る。承認済みの人格と対話は同じ版のまま
//   3. 模擬対話に未確認の相談窓口番号・受付時間を載せない。強い苦痛があれば通常の模擬対話を中断する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S, etiCurrent, answerAll, QUIET_CHARISMA } from './helpers.js';
import { SAFETY_TEXT } from '../src/dialogue.js';

const ALPHA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD = { self_continuity: 4, aspiration: 5, attainability: 4 };
const LOW_ASP = { self_continuity: 4, aspiration: 2, attainability: 4 };
// レビューの再現条件：K1 で内省と慎重さを選ぶ
const TWO_KEEP = { ...QUIET_CHARISMA, K1: ['inner_focus', 'deliberation'] };
const pv = (s) => s.profile.persona_version;
const meetOf = (base = TWO_KEEP) => S.meet(S.buildDraft(answerAll(etiCurrent(), base)));
const evaluate = (s, r) => S.submitEvaluation(S.toEvaluate(s), { persona_version: pv(s), ratings: r });
const currentQ = (s) => S.reviseQueue(s)[S.revisionIndex(s)];

// ---------------------------------------------------------------- 1
test('修正1：見直しで確認が2問出たら、1問目の後に2問目へ進み、両方に答えてから終われる', () => {
  let s = S.startRevision(evaluate(meetOf(), LOW_ASP), ['AS_CHARM']);
  s = S.answerRevision(s, 'E1', ['radiance']);
  assert.deepEqual(S.reviseQueue(s).map((q) => q.id), ['E1', 'F_INV_radiance_inner_focus', 'F_INV_radiance_deliberation']);
  assert.equal(currentQ(s).id, 'F_INV_radiance_inner_focus');
  s = S.answerRevision(s, 'F_INV_radiance_inner_focus', ['augment']);
  // 答えた質問は並びに残り、次の未回答（2問目）を指す
  assert.deepEqual(S.reviseQueue(s).map((q) => q.id), ['E1', 'F_INV_radiance_inner_focus', 'F_INV_radiance_deliberation']);
  assert.equal(currentQ(s).id, 'F_INV_radiance_deliberation');
  assert.equal(S.revisionComplete(s), false);
  assert.throws(() => S.finishRevision(s), /unanswered/);
  s = S.answerRevision(s, 'F_INV_radiance_deliberation', ['augment']);
  assert.equal(S.revisionIndex(s), 3);
  assert.equal(currentQ(s), undefined);
  assert.equal(S.revisionComplete(s), true);
  s = S.finishRevision(s);
  assert.equal(s.step, 'meet');
  const asp = s.profile.aspirational_traits.find((a) => a.aspiration === 'radiance');
  assert.deepEqual(asp.tension.map((t) => `${t.trait}:${t.resolution}`), ['inner_focus:augment', 'deliberation:augment']);
  assert.deepEqual(s.profile.source_provenance.followups_asked.map((f) => f.id), ['F_INV_radiance_inner_focus', 'F_INV_radiance_deliberation']);
});

test('修正1：2問目から戻って1問目を答え直しても、2問目に戻り、未回答を飛ばさない', () => {
  let s = S.startRevision(evaluate(meetOf(), LOW_ASP), ['AS_CHARM']);
  s = S.answerRevision(s, 'E1', ['radiance']);
  s = S.answerRevision(s, 'F_INV_radiance_inner_focus', ['augment']);
  s = S.goBack(s);
  assert.equal(currentQ(s).id, 'F_INV_radiance_inner_focus');
  s = S.answerRevision(s, 'F_INV_radiance_inner_focus', ['unknown']);
  assert.equal(currentQ(s).id, 'F_INV_radiance_deliberation');
  // E1 まで戻って変えると、出なくなった確認は並びから外れる
  s = S.goBack(S.goBack(s));
  assert.equal(currentQ(s).id, 'E1');
  s = S.answerRevision(s, 'E1', ['quiet_presence']);
  assert.deepEqual(S.reviseQueue(s).map((q) => q.id), ['E1']);
  assert.equal(S.revisionComplete(s), true);
});

// ---------------------------------------------------------------- 2
const SNAP = (s) => ({ idealAnswers: s.idealAnswers, followups: s.followups, overflow: s.overflow, profile: s.profile, evaluations: s.persona.evaluations, versions: s.persona.versions, confirmations: s.persona.confirmations });

test('修正2：見直しをキャンセルすると、開始前の回答・表示していた下書き・評価に戻る', () => {
  const s0 = evaluate(S.decideCandidate(meetOf(), 'empathy', 'not_keep'), LOW_ASP);
  const before = JSON.parse(JSON.stringify(SNAP(s0)));
  let s = S.startRevision(s0, ['AS_CHARM', 'SC_VALUES']);
  s = S.answerRevision(s, 'K3', ['BE']);
  s = S.answerRevision(s, 'E1', ['radiance']);
  s = S.answerRevision(s, 'F_INV_radiance_inner_focus', ['release']);
  assert.notDeepEqual(SNAP(s).idealAnswers, before.idealAnswers);
  s = S.cancelRevision(s);
  assert.equal(s.step, 'evaluate');
  assert.equal(s.persona.revision, null);
  assert.deepEqual(JSON.parse(JSON.stringify(SNAP(s))), before);
  assert.equal(S.latestEvaluation(s, pv(s)).ratings.aspiration, 2); // 表示していた版の評価のまま
  // 最初の質問から「戻る」でも同じように戻る
  let t = S.startRevision(s0, ['AS_CHARM']);
  t = S.answerRevision(t, 'E1', ['warmth_capacity']);
  t = S.goBack(S.goBack(t));
  assert.equal(t.persona.revision, null);
  assert.deepEqual(JSON.parse(JSON.stringify(SNAP(t))), before);
});

test('修正2：承認済みの人格と対話は、見直し中もキャンセル後も同じ版を使う', () => {
  let s = evaluate(meetOf(), GOOD);
  s = S.approve(s, pv(s));
  const lock = s.persona.locked;
  const approvals = s.persona.approvals;
  s = S.sendMessage(S.openDialogue(s), '迷っていることがある');
  // 見直しを始めて回答を変える（下書きは別の版になる）
  s = S.reviseApproved(S.toEvaluate(s), ['SC_VALUES']);
  s = S.answerRevision(s, 'K3', ['BE']);
  assert.equal(s.profile, null); // 下書きは作り直し待ち
  s = S.sendMessage({ ...s, step: 'dialogue' }, '大事にしている判断の基準は？');
  assert.equal(s.persona.locked, lock);
  assert.equal(s.dialogue.messages[3].persona_version, lock.persona_version);
  assert.match(s.dialogue.messages[3].text, /最後は自分で選ぶ/); // 承認済みの版の判断原則（K3＝SD）。見直し中の K3＝BE は使わない
  assert.deepEqual(s.dialogue.messages[3].basis, [{ element: 'decision_principles', id: 'DP_VALUE_SD' }]);
  s = S.cancelRevision({ ...s, step: 'revise' });
  assert.equal(s.persona.locked, lock);
  assert.equal(s.persona.approvals, approvals);
  assert.equal(pv(s), lock.persona_version); // 表示していた下書き（承認済みの版）に戻る
  assert.equal(s.dialogue.persona_version, lock.persona_version);
  assert.equal(s.dialogue.messages.length, 4); // 会話の記録はそのまま
  s = S.sendMessage({ ...s, step: 'dialogue' }, '迷っていることがある');
  assert.equal(s.dialogue.messages[5].persona_version, lock.persona_version);
  assert.match(s.dialogue.messages[5].text, /最後は自分で選ぶ/);
});

// ---------------------------------------------------------------- 3
const PHONE = /\d{2,4}[-‐－ー]\d{2,4}[-‐－ー]\d{3,4}|\d{10,11}|24時間|ホットライン|いのちの電話/;

test('修正3：画面で使うファイルに、未確認の相談窓口番号・受付時間が無い', () => {
  for (const f of ['src/dialogue.js', 'src/app.js', 'src/state.js', 'src/persona.js', 'index.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ALPHA, f), 'utf8'), PHONE, f);
  }
  assert.doesNotMatch(SAFETY_TEXT.replace(/5年後/g, ''), /\d/); // 「5年後」以外の数字（番号・時間）を含まない
  assert.match(SAFETY_TEXT, /模擬対話をいったん止めます/);
  assert.match(SAFETY_TEXT, /身近な信頼できる人/);
  assert.match(SAFETY_TEXT, /地域の公的な相談窓口/);
});

test('修正3：強い苦痛の表現があると通常の模擬対話を中断し、人格としての返答をしない。固定内容は変わらない', () => {
  let s = evaluate(meetOf(), GOOD);
  s = S.approve(s, pv(s));
  const lock = s.persona.locked;
  s = S.sendMessage(S.openDialogue(s), '最近うまくいかない');
  for (const t of ['もう消えたい', '死にたいと思う', 'もう限界かもしれない']) {
    const r = S.sendMessage(s, t);
    const m = r.dialogue.messages[r.dialogue.messages.length - 1];
    assert.equal(m.kind, 'safety', t);
    assert.equal(m.text, SAFETY_TEXT);
    assert.deepEqual(m.basis, []);
    assert.deepEqual(r.dialogue.halted, { reason: 'safety' });
    assert.throws(() => S.sendMessage(r, '迷っていることがある'), /halted/);
    assert.equal(r.persona.locked, lock);
  }
  // 続けるときは本人が新しく始める（記録は空から）
  let r = S.sendMessage(s, 'もう消えたい');
  r = S.restartDialogue(r);
  assert.deepEqual(r.dialogue.messages, []);
  assert.equal(r.dialogue.halted, null);
  r = S.sendMessage(r, '迷っていることがある');
  assert.equal(r.dialogue.messages[1].kind, 'decision');
});
