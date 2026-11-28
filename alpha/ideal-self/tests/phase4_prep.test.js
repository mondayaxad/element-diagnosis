// Phase 4 本人テスト準備：練習の約束（1分）・「止めて」の後に取った行動の記録
import test from 'node:test';
import assert from 'node:assert/strict';
import { S, etiCurrent, answerAll, QUIET_CHARISMA } from './helpers.js';
import * as C from '../src/commitment.js';

const T0 = Date.UTC(2026, 10, 29, 3, 0, 0);
const FACTS = { target: '限定キャラ（合成・練習）', stones_have: 8000, stones_needed: 28800, estimate_yen: 30000, reason_id: 'saving' };
const CHOICE = { can_afford: 'no', worth_it: 'unsure', cap_yen: 0 };
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return 'no_error'; };
function approved() {
  let s = S.meet(S.buildDraft(answerAll(etiCurrent(), QUIET_CHARISMA)));
  s = S.submitEvaluation(S.toEvaluate(s), { persona_version: s.profile.persona_version, ratings: { self_continuity: 4, aspiration: 4, attainability: 4 } });
  return S.approve(s, s.profile.persona_version);
}
const practice = (s, now = T0, choice = CHOICE) => S.commitConfirm(S.commitFacts(S.commitStart(s, now, { practice: true }), FACTS, now), { ...choice, deadline_days: null }, now);
const normal = (s, now = T0, days = 7) => S.commitConfirm(S.commitFacts(S.commitStart(s, now), { ...FACTS, target: '限定キャラ（合成）' }, now), { ...CHOICE, cap_yen: 1000, deadline_days: days }, now);
const byId = (s, id) => s.commitments.items.find((c) => c.id === id);

// ---------------------------------------------------------------- 1. 練習の約束
test('練習：期限は作成から1分、練習の印があり、期限の選択は要らない', () => {
  const s = practice(approved());
  const c = s.commitments.items[0];
  assert.equal(c.practice, true);
  assert.equal(c.deadline_at - c.created_at, 60 * 1000);
  assert.equal(c.deadline_days, null);
  assert.equal(c.rule, '事前に決めた予算は 0 円（課金しない）。足りなくても、期限まで追加で課金しない');
  assert.equal(C.statusAt(c, T0 + 59999), 'active');
  assert.equal(C.statusAt(c, T0 + 60000), 'ended');
});

test('練習：作成 → 止めて → 期限到達 → 振り返りを一度に通せる', () => {
  let s = practice(approved());
  s = S.stop(s, T0 + 10 * 1000);
  assert.equal(s.stopView.commitment_id, 'c1');
  assert.match(s.stopView.intervention.text, /^（練習）止めに来たよ。/);
  assert.equal(s.stopView.intervention.basis[0].practice, true);
  assert.equal(code(() => S.commitReflect(s, 'c1', { outcome: 'kept' }, T0 + 59 * 1000)), 'not_ended');
  s = S.commitReflect(s, 'c1', { outcome: 'kept', helped: ['closed_screen'] }, T0 + 61 * 1000);
  assert.equal(byId(s, 'c1').reflection.outcome, 'kept');
});

test('練習：通常の約束の「有効な約束は1つ」・期限・変更ルール・集計に影響しない', () => {
  // 練習中でも通常の約束を作れ、通常の約束中でも練習を作れる
  let s = practice(approved());
  s = normal(s, T0 + 1000);
  const n = byId(s, 'c2');
  assert.equal(n.practice, false);
  assert.equal(n.deadline_at - n.created_at, 7 * C.DAY); // 通常の期限はそのまま
  assert.equal(S.activeCommitment(s, T0 + 2000).id, 'c2'); // 「有効な約束」は通常の約束だけ
  assert.equal(S.activePractice(s, T0 + 2000).id, 'c1');
  assert.equal(code(() => S.commitStart(s, T0 + 2000)), 'active_exists'); // 通常の決まりは変わらない
  assert.equal(code(() => S.commitStart(s, T0 + 2000, { practice: true })), 'practice_active'); // 練習も同時に1つ
  // 通常の約束の変更ルールは同じ（引下げのみ）、練習も同じルール
  assert.equal(code(() => S.commitRaise(s, 'c2', 5000, 1, T0 + 3000)), 'raise_forbidden');
  assert.equal(code(() => S.commitCancel(s, 'c1', 1, T0 + 3000)), 'cancel_forbidden');
  // 通常の約束の期限は 3/7/14/30 日の選択が必須のまま（練習の指定は startDraft からだけ）
  const t = S.commitFacts(S.commitStart(approved(), T0), FACTS, T0);
  assert.equal(code(() => S.commitConfirm(t, { ...CHOICE, deadline_days: null }, T0)), 'invalid_deadline');
  assert.equal(code(() => S.commitConfirm(t, { ...CHOICE, deadline_days: 7, practice: true }, T0)), 'no_error');
  // 「止めて」は通常の約束を優先する
  assert.equal(S.stop(s, T0 + 4000).stopView.commitment_id, 'c2');
  // 集計（7日間）に練習は入らない
  s = S.commitReflect(s, 'c1', { outcome: 'not_kept' }, T0 + 61 * 1000);
  const sum = C.summarize(s.commitments, T0 + 61 * 1000);
  assert.deepEqual(sum, { active: 1, ended: 0, kept: 0, partial: 0, not_kept: 0, unknown: 0, unrecorded: 0 });
});

test('練習：期限が過ぎたら通常の約束がなくても「止めて」は練習を示さない（有効な約束なし）', () => {
  const s = practice(approved());
  assert.equal(S.stop(s, T0 + 60 * 1000).stopView.commitment_id, null);
});

// ---------------------------------------------------------------- 2. 実際に取った行動（任意）
test('取った行動：提案とは別に記録し、約束の版・変更の記録・振り返りには触れない', () => {
  let s = S.stop(practice(approved()), T0 + 5000);
  const before = byId(s, 'c1');
  const suggested = s.stopView.intervention.action.id;
  s = S.recordTakenAction(s, { action_id: 'waited' }, T0 + 6000);
  const c = byId(s, 'c1');
  assert.deepEqual(c.actions_taken, [{ action_id: 'waited', note: '', suggested_action_id: suggested, at: T0 + 6000, self_reported: true }]);
  assert.notEqual(c.actions_taken[0].action_id, suggested); // 提案（購入画面を閉じて考える）とは別の項目
  assert.equal(c.version, before.version);
  assert.deepEqual(c.history, before.history);
  assert.equal(c.reflection, null);
  assert.equal(s.stopView.recorded, true);
  // 「そのほか」は自分の言葉が必要
  assert.equal(code(() => S.recordTakenAction(s, { action_id: 'other', note: ' ' }, T0 + 7000)), 'invalid_action');
  assert.equal(byId(S.recordTakenAction(s, { action_id: 'other', note: 'お茶を入れた' }, T0 + 7000), 'c1').actions_taken[1].note, 'お茶を入れた');
  assert.equal(code(() => S.recordTakenAction(s, { action_id: 'bought' }, T0 + 7000)), 'invalid_action');
});

test('取った行動：記録しなければ何も残らず、行動や結果を推定しない', () => {
  let s = S.stop(normal(approved()), T0 + 5000); // 止めてを開いたが、行動は記録しない
  const c = byId(s, 'c1');
  assert.deepEqual(c.actions_taken, []);
  // 期限後の集計は「未記録」で、守れた・守れなかったに数えない
  const end = c.deadline_at;
  assert.deepEqual(C.summarize(s.commitments, end), { active: 0, ended: 1, kept: 0, partial: 0, not_kept: 0, unknown: 0, unrecorded: 1 });
  // 行動を記録しても、振り返りの結果・助けになったことは自動で入らない
  s = S.recordTakenAction(s, { action_id: 'closed_screen' }, T0 + 6000);
  assert.equal(byId(s, 'c1').reflection, null);
  assert.deepEqual(C.summarize(s.commitments, end), { active: 0, ended: 1, kept: 0, partial: 0, not_kept: 0, unknown: 0, unrecorded: 1 });
  s = S.commitReflect(s, 'c1', { outcome: 'unknown' }, end);
  assert.deepEqual(byId(s, 'c1').reflection.helped, []);
});

test('取った行動：約束と一緒に削除される', () => {
  let s = S.recordTakenAction(S.stop(practice(approved()), T0 + 5000), { action_id: 'other', note: 'お茶を入れた' }, T0 + 6000);
  s = S.commitDelete(s, 'c1');
  assert.ok(!JSON.stringify(s).includes('お茶を入れた'));
});
