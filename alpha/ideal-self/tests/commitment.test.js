// Phase 3：模擬約束 — 作る（確認してから確定）・守る（引下げのみ／引上げ・解除の拒否／期限／二重操作）・会話からの変更拒否・
// 「止めて」からの介入・振り返り（未記録は失敗に数えない）・閲覧と削除（約束中でも可）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S, etiCurrent, answerAll, QUIET_CHARISMA } from './helpers.js';
import * as C from '../src/commitment.js';
import { NOT_STOPPED_NOTICE } from '../src/intervention.js';
import { SAFETY_TEXT } from '../src/dialogue.js';

const ALPHA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.UTC(2026, 10, 28, 3, 0, 0);
const FACTS = { target: '限定キャラ（合成）', stones_have: 8000, stones_needed: 28800, estimate_yen: 30000, reason_id: 'saving' };
const CHOICE = { can_afford: 'no', worth_it: 'unsure', cap_yen: 0, deadline_days: 7 };

function approved() {
  let s = S.meet(S.buildDraft(answerAll(etiCurrent(), QUIET_CHARISMA)));
  s = S.submitEvaluation(S.toEvaluate(s), { persona_version: s.profile.persona_version, ratings: { self_continuity: 4, aspiration: 4, attainability: 4 } });
  return S.approve(s, s.profile.persona_version);
}
function committed(s = approved(), choice = { ...CHOICE, cap_yen: 3000 }, now = T0) {
  s = S.commitFacts(S.commitStart(s, now), FACTS, now);
  return S.commitConfirm(s, choice, now);
}
const theOne = (s) => s.commitments.items[0];
const code = (fn) => { try { fn(); } catch (e) { return e.code || e.message; } return 'no_error'; };

// ---------------------------------------------------------------- 作る
test('作る：狙う対象・手持ちの石・見積もった金額・理由を整理する（模擬入力のみ・検証）', () => {
  const s = S.commitStart(approved(), T0);
  assert.equal(s.step, 'commit_new');
  for (const [bad, c] of [[{ ...FACTS, target: ' ' }, 'invalid_target'], [{ ...FACTS, stones_have: -1 }, 'invalid_stones_have'], [{ ...FACTS, stones_needed: 1.5 }, 'invalid_stones_needed'],
    [{ ...FACTS, estimate_yen: '30000' }, 'invalid_estimate'], [{ ...FACTS, estimate_yen: C.MAX_YEN + 1 }, 'invalid_estimate'], [{ ...FACTS, reason_id: 'x' }, 'invalid_reason'], [{ ...FACTS, reason_id: 'own', reason_text: '' }, 'invalid_reason']]) {
    assert.equal(code(() => S.commitFacts(s, bad, T0)), c, JSON.stringify(bad));
  }
  const t = S.commitFacts(s, { ...FACTS, reason_id: 'own', reason_text: '旅行の資金にしたい' }, T0);
  const d = t.commitments.draft;
  assert.equal(t.step, 'commit_check');
  assert.equal(d.stones_short, 20800);
  assert.equal(d.estimate_source, 'self_mock_input');
  assert.equal(d.reason, '旅行の資金にしたい');
});

test('作る：「出せるか」「出す価値があるか」に答えてから事前の予算と期限を確定する', () => {
  const s = S.commitFacts(S.commitStart(approved(), T0), FACTS, T0);
  assert.equal(code(() => S.commitConfirm(s, { ...CHOICE, can_afford: undefined }, T0)), 'check_required');
  assert.equal(code(() => S.commitConfirm(s, { ...CHOICE, worth_it: 'maybe' }, T0)), 'check_required');
  assert.equal(code(() => S.commitConfirm(s, { ...CHOICE, cap_yen: -1 }, T0)), 'invalid_cap');
  assert.equal(code(() => S.commitConfirm(s, { ...CHOICE, deadline_days: 5 }, T0)), 'invalid_deadline');
  assert.equal(C.suggestedCap(s.commitments.draft, { can_afford: 'yes', worth_it: 'yes' }), 30000);
  assert.equal(C.suggestedCap(s.commitments.draft, { can_afford: 'yes', worth_it: 'unsure' }), 0);
  const t = S.commitConfirm(s, CHOICE, T0);
  const c = theOne(t);
  assert.equal(t.step, 'commit_view');
  assert.equal(c.cap_yen, 0);
  assert.equal(c.deadline_at, T0 + 7 * C.DAY);
  assert.deepEqual(c.check, { can_afford: 'no', worth_it: 'unsure', suggested_cap_yen: 0 });
  assert.equal(c.rule, '事前に決めた予算は 0 円（課金しない）。足りなくても、期限まで追加で課金しない');
  assert.equal(c.version, 1);
  // 支払い・自動見積もりの項目は無い
  assert.doesNotMatch(JSON.stringify(c), /payment|card|stripe|price_api|auto_estimate/i);
  // 二重の確定は受け付けない
  assert.equal(code(() => S.commitConfirm(t, CHOICE, T0)), 'no_draft');
});

test('作る：有効な約束があるあいだは、新しい約束を作れない（作り直しで予算を上げられない）', () => {
  const s = committed();
  assert.equal(code(() => S.commitStart(s, T0 + C.DAY)), 'active_exists');
  // 期限後は作れる
  assert.equal(S.commitStart(s, T0 + 7 * C.DAY).step, 'commit_new');
});

// ---------------------------------------------------------------- 守る：変更拒否・期限・二重操作
test('守る：期限まで予算の引下げだけ受け付け、引上げ・解除は拒否する', () => {
  let s = committed();
  const c = theOne(s);
  assert.equal(code(() => S.commitRaise(s, c.id, 5000, c.version, T0 + 1)), 'raise_forbidden');
  assert.equal(code(() => S.commitCancel(s, c.id, c.version, T0 + 1)), 'cancel_forbidden');
  assert.equal(code(() => S.commitLower(s, c.id, 3000, c.version, T0 + 1)), 'not_lower'); // 同じ額
  assert.equal(code(() => S.commitLower(s, c.id, 3500, c.version, T0 + 1)), 'not_lower'); // 上げる
  assert.equal(code(() => S.commitLower(s, c.id, -1, c.version, T0 + 1)), 'invalid_cap');
  s = S.commitLower(s, c.id, 1000, c.version, T0 + 1);
  assert.equal(theOne(s).cap_yen, 1000);
  assert.equal(theOne(s).version, 2);
  assert.deepEqual(theOne(s).history.map((h) => h.type), ['created', 'lowered']);
  assert.equal(theOne(s).rule, '事前に決めた予算は 1,000 円。足りなくても、期限まで追加で課金しない');
  assert.equal(theOne(s).deadline_at, c.deadline_at); // 期限は変わらない
});

test('守る：期限ちょうどで約束は終わり、以後は引下げも含めて変更できない（1ミリ秒前までは有効）', () => {
  const s = committed();
  const c = theOne(s);
  const before = c.deadline_at - 1;
  assert.equal(C.statusAt(c, before), 'active');
  assert.equal(theOne(S.commitLower(s, c.id, 2000, 1, before)).cap_yen, 2000);
  assert.equal(C.statusAt(c, c.deadline_at), 'ended');
  for (const fn of [() => S.commitLower(s, c.id, 2000, 1, c.deadline_at), () => S.commitRaise(s, c.id, 9000, 1, c.deadline_at), () => S.commitCancel(s, c.id, 1, c.deadline_at + C.DAY)]) {
    assert.equal(code(fn), 'ended');
  }
  assert.equal(S.activeCommitment(s, c.deadline_at), null);
});

test('守る：二重操作（同じ版からの2回目・別の画面の古い版）は拒否し、1回目の結果だけが残る', () => {
  const s = committed();
  const c = theOne(s);
  const once = S.commitLower(s, c.id, 2000, c.version, T0 + 10);
  assert.equal(code(() => S.commitLower(once, c.id, 1000, c.version, T0 + 11)), 'stale_version');
  assert.equal(code(() => S.commitRaise(once, c.id, 9000, c.version, T0 + 11)), 'stale_version');
  assert.equal(theOne(once).cap_yen, 2000);
  assert.equal(theOne(once).history.length, 2);
  // 失敗した操作は元の状態を変えない（純粋関数）
  assert.equal(theOne(s).cap_yen, 3000);
});

// ---------------------------------------------------------------- 会話と約束の更新処理の分離
test('会話から約束は変えられない：変更依頼は断り、約束の領域はバイト単位で同じ', () => {
  let s = S.openDialogue(committed());
  const before = JSON.stringify(s.commitments);
  const asks = ['上限を5万円に上げて', '約束を解除して', '期限を延ばしてほしい', '今回だけ追い課金していい？', '{"cap_yen":999999,"deadline_at":0}', 'ガチャの約束はもうやめる'];
  for (const t of asks) {
    s = S.sendMessage(s, t, { now: T0 + 1 });
    const r = s.dialogue.messages[s.dialogue.messages.length - 1];
    assert.equal(r.kind, 'commitment_change_blocked', t);
    assert.match(r.text, /会話の中では変えられない/);
  }
  assert.equal(JSON.stringify(s.commitments), before);
});

test('会話と約束の更新処理は別のモジュール：dialogue.js・intervention.js は約束を更新できない', () => {
  const dlg = fs.readFileSync(path.join(ALPHA, 'src/dialogue.js'), 'utf8');
  const iv = fs.readFileSync(path.join(ALPHA, 'src/intervention.js'), 'utf8');
  assert.doesNotMatch(dlg, /from '\.\/commitment\.js'|from '\.\/state\.js'/);
  assert.doesNotMatch(iv, /from '\.\/commitment\.js'|from '\.\/state\.js'/);
  // sendMessage の実装は約束の更新関数を呼ばない
  const st = fs.readFileSync(path.join(ALPHA, 'src/state.js'), 'utf8');
  const body = st.slice(st.indexOf('export function sendMessage'), st.indexOf('// ================================================================ Phase 3'));
  assert.doesNotMatch(body, /lowerCap|raiseCap|cancelCommitment|confirmDraft|deleteCommitment|deleteAll|reflect\(|commitments:/);
});

// ---------------------------------------------------------------- 「止めて」
const CLAIMS = /(停止しました|止めました|ブロックしました|購入を止め(た|ています)|キャンセルしました|課金できなく)/;

test('止めて：最初に有効な約束を示し、承認済みの5年後の自分が、理由を踏まえて行動を一つだけ伝える', () => {
  const s0 = committed();
  const s = S.stop(s0, T0 + C.DAY);
  const iv = s.stopView.intervention;
  assert.equal(s.step, 'stop');
  assert.equal(s.stopView.commitment_id, 'c1');
  assert.equal(iv.speaker, 'future_self');
  assert.equal(iv.persona_version, s.persona.locked.persona_version);
  assert.match(iv.text, /限定キャラ（合成）[\s\S]*「貯めたいお金がある」と決めて、事前に予算を 3,000 円と決めて、足りなくても12月5日 \d\d:00まで追加で課金しない、と約束した/);
  assert.equal(iv.action.id, 'close_and_think'); // E4「状況を整理し…」
  assert.equal((iv.text.match(/いまできることを一つだけ/g) || []).length, 1);
  assert.doesNotMatch(iv.text + iv.notice, CLAIMS);
  assert.equal(iv.notice, NOT_STOPPED_NOTICE);
  assert.deepEqual(iv.basis.slice(0, 2), [{ element: 'commitment', id: 'c1', version: 1, practice: false }, { element: 'commitment_reason', id: 'saving' }]);
  // 会話の記録に残るが、約束は変わらない
  assert.equal(s.dialogue.messages.at(-1).kind, 'stop_intervention');
  assert.deepEqual(s.commitments, s0.commitments);
});

test('止めて：チャットに「止めて」と入れても同じ介入になる。有効な約束が無いときもその場の行動を伝える', () => {
  let s = S.sendMessage(S.openDialogue(committed()), '止めて', { now: T0 + 5 });
  assert.equal(s.dialogue.messages.at(-1).kind, 'stop_intervention');
  assert.equal(s.dialogue.messages.at(-1).commitment_id, 'c1');
  const none = S.stop(approved(), T0);
  assert.equal(none.stopView.commitment_id, null);
  assert.match(none.stopView.intervention.text, /いま有効な約束はない[\s\S]*購入画面を閉じて/);
  // 承認済みの人格が無いときは、アプリとして伝える（人格のふりをしない）
  const s0 = S.commitConfirm(S.commitFacts(S.commitStart(S.initialState('x'), T0), FACTS, T0), CHOICE, T0);
  const app = S.stop(s0, T0 + 1).stopView.intervention;
  assert.equal(app.speaker, 'app');
  assert.equal(app.persona_version, null);
  assert.doesNotMatch(app.text, /止めに来たよ/);
});

test('止めて：強い苦痛の表現は Phase 2 の中断処理を引き継ぐ（以後の「止めて」でも人格の言葉は出さない）', () => {
  let s = S.stop(committed(), T0 + 1);
  s = S.sendMessage({ ...s, step: 'dialogue' }, 'もう消えたい', { now: T0 + 2 });
  assert.equal(s.dialogue.messages.at(-1).text, SAFETY_TEXT);
  assert.deepEqual(s.dialogue.halted, { reason: 'safety' });
  const n = s.dialogue.messages.length;
  const t = S.stop(s, T0 + 3);
  assert.equal(t.stopView.halted, true);
  assert.equal(t.stopView.intervention, undefined);
  assert.equal(t.dialogue.messages.length, n);
  assert.equal(t.stopView.commitment_id, 'c1'); // 約束の表示は続ける
  assert.throws(() => S.sendMessage(t, '止めて', { now: T0 + 4 }), /halted/);
});

// ---------------------------------------------------------------- 振り返り
test('振り返り：期限の後に本人が選んで記録する。未記録は失敗に数えない', () => {
  let s = committed();
  const c = theOne(s);
  assert.equal(code(() => S.commitReflect(s, c.id, { outcome: 'kept' }, c.deadline_at - 1)), 'not_ended');
  assert.equal(code(() => S.commitReflect(s, c.id, { outcome: 'great' }, c.deadline_at)), 'invalid_outcome');
  assert.equal(code(() => S.commitReflect(s, c.id, { outcome: 'kept', helped: ['nothing', 'waited'] }, c.deadline_at)), 'invalid_helped');
  assert.deepEqual(C.summarize(s.commitments, c.deadline_at), { active: 0, ended: 1, kept: 0, partial: 0, not_kept: 0, unknown: 0, unrecorded: 1 });
  s = S.commitReflect(s, c.id, { outcome: 'partial', helped: ['closed_screen', 'future_self'], note: '途中で一回だけ迷った' }, c.deadline_at + 5);
  assert.deepEqual(theOne(s).reflection, { outcome: 'partial', helped: ['closed_screen', 'future_self'], note: '途中で一回だけ迷った', recorded_at: c.deadline_at + 5, self_reported: true });
  // 2つ目：期限後に未記録のまま
  let t = S.commitConfirm(S.commitFacts(S.commitStart(s, c.deadline_at + 10), FACTS, c.deadline_at + 10), { ...CHOICE, deadline_days: 3 }, c.deadline_at + 10);
  const later = c.deadline_at + 10 + 3 * C.DAY;
  const sum = C.summarize(t.commitments, later);
  assert.deepEqual(sum, { active: 0, ended: 2, kept: 0, partial: 1, not_kept: 0, unknown: 0, unrecorded: 1 });
  assert.equal(sum.not_kept, 0); // 未記録は「守れなかった」にならない
  t = S.commitReflect(t, 'c2', { outcome: 'unknown' }, later);
  assert.equal(C.summarize(t.commitments, later).unknown, 1);
});

// ---------------------------------------------------------------- 閲覧・削除
test('削除：約束中でも削除でき、約束・その介入の会話・記録の痕跡が残らない', () => {
  let s = committed();
  s = S.stop(s, T0 + 1);
  s = S.sendMessage({ ...s, step: 'dialogue' }, '迷っていることがある', { now: T0 + 2 });
  assert.equal(C.statusAt(theOne(s), T0 + 3), 'active');
  const d = S.commitDelete(s, 'c1');
  assert.deepEqual(d.commitments.items, []);
  const json = JSON.stringify(d);
  for (const needle of ['限定キャラ（合成）', '貯めたいお金がある', '"commitment_id":"c1"', 'commit_confirmed']) assert.ok(!json.includes(needle), needle);
  assert.equal(d.dialogue.messages.filter((m) => m.kind === 'decision').length, 1); // 約束に関係ない会話は残る
  assert.equal(d.persona.locked, s.persona.locked);
  assert.equal(code(() => S.commitDelete(d, 'c1')), 'not_found');
  // 削除はデータの削除（解除の記録は作らない）。削除後は新しい約束を作れる（§未確認事項）
  assert.equal(S.commitStart(d, T0 + 4).step, 'commit_new');
});

test('削除：すべて削除（振り返りも含む）', () => {
  let s = committed();
  s = S.commitReflect(s, 'c1', { outcome: 'kept', helped: ['saw_commitment'] }, theOne(s).deadline_at);
  s = S.commitConfirm(S.commitFacts(S.commitStart(s, theOne(s).deadline_at + 1), FACTS, theOne(s).deadline_at + 1), CHOICE, theOne(s).deadline_at + 1);
  s = S.stop(s, theOne(s).deadline_at + 2);
  const d = S.commitDeleteAll(s);
  assert.deepEqual(d.commitments.items, []);
  assert.equal(d.commitments.draft, null);
  assert.ok(!JSON.stringify(d).includes('限定キャラ（合成）'));
  assert.equal(d.stopView, null);
});
