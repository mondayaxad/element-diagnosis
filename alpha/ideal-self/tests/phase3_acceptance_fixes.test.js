// Phase 3 受入レビュー（7881c56）への修正の確認
//   1. 事前に決めた予算と「期限まで追加で課金しない」を分けた文言（作成・引下げ後・止めて・振り返り／0円と正の額）
//   2. ETI 取込同意の撤回で、ETI 由来の人格版で作った「止めて」の介入を状態と端末保存から取り除く（約束は残す）
//   3. 有効な約束の削除：データを残さず、その時点で有効でなくなり、新しい約束を作れる
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S, etiCurrent, quickCurrent, answerAll, QUIET_CHARISMA } from './helpers.js';
import * as C from '../src/commitment.js';
import * as CT from '../src/commitment_text.js';

const ALPHA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T0 = Date.UTC(2026, 10, 28, 3, 0, 0);
const FACTS = { target: '限定キャラ（合成）', stones_have: 8000, stones_needed: 28800, estimate_yen: 30000, reason_id: 'saving' };

function approvedFrom(cur, consents = { eti_import: true, memory: true }) {
  let s = S.meet(S.buildDraft(answerAll(cur, QUIET_CHARISMA)));
  s = { ...s, consents: S.submitConsent(S.initialState('x'), consents).consents };
  s = S.submitEvaluation(S.toEvaluate(s), { persona_version: s.profile.persona_version, ratings: { self_continuity: 4, aspiration: 4, attainability: 4 } });
  return S.approve(s, s.profile.persona_version);
}
const commit = (s, cap, now = T0) => S.commitConfirm(S.commitFacts(S.commitStart(s, now), FACTS, now), { can_afford: 'no', worth_it: 'no', cap_yen: cap, deadline_days: 7 }, now);
const OLD = /上限|超える追い課金|まで追い課金|円まで課金/;

// ---------------------------------------------------------------- 1
test('修正1：文言の部品 — 予算 0 円と正の額で、予算と「追加で課金しない」を分けて言う', () => {
  assert.equal(CT.ruleText(0), '事前に決めた予算は 0 円（課金しない）。足りなくても、期限まで追加で課金しない');
  assert.equal(CT.ruleText(1000), '事前に決めた予算は 1,000 円。足りなくても、期限まで追加で課金しない');
  assert.equal(CT.reflectionQuestion(0), '期限まで、課金せずに済みましたか（予算 0 円）');
  assert.equal(CT.reflectionQuestion(1000), '事前に決めた予算（1,000 円）のほかに、期限まで追加で課金せずに済みましたか');
  for (const t of [CT.ruleText(0), CT.ruleText(1000), CT.reflectionQuestion(0), CT.reflectionQuestion(1000), CT.promiseSpoken(0, '12月5日'), CT.promiseSpoken(1000, '12月5日')]) assert.doesNotMatch(t, OLD, t);
});

for (const [label, cap, lowered] of [['予算が正の額', 3000, 1000], ['予算が 0 円', 0, null]]) {
  test(`修正1：${label} — 作成・引下げ後・止めて・振り返りで同じ意味の文になる`, () => {
    let s = commit(approvedFrom(etiCurrent()), cap);
    let c = s.commitments.items[0];
    assert.equal(c.rule, CT.ruleText(cap)); // 作成
    if (lowered !== null) {
      s = S.commitLower(s, c.id, lowered, c.version, T0 + 1);
      c = s.commitments.items[0];
      assert.equal(c.rule, CT.ruleText(lowered)); // 引下げ後
    } else {
      assert.throws(() => S.commitLower(s, c.id, 0, c.version, T0 + 1), (e) => e.code === 'not_lower'); // 0 円より下げられない
    }
    const budget = lowered ?? cap;
    const iv = S.stop(s, T0 + 2).stopView.intervention; // 止めて
    assert.match(iv.text, budget === 0 ? /課金はしない（予算 0 円）。足りなくても追加で課金しない、と約束した/ : /事前に予算を 1,000 円と決めて、足りなくても12月5日 \d\d:00まで追加で課金しない、と約束した/);
    assert.equal(CT.reflectionQuestion(c.cap_yen), budget === 0 ? '期限まで、課金せずに済みましたか（予算 0 円）' : '事前に決めた予算（1,000 円）のほかに、期限まで追加で課金せずに済みましたか'); // 振り返り
    for (const t of [c.rule, iv.text, ...c.history.map((h) => JSON.stringify(h))]) assert.doesNotMatch(t, OLD);
  });
}

test('修正1：画面・約束・介入・会話のソースに、旧い言い方が残っていない', () => {
  for (const f of ['src/app.js', 'src/commitment.js', 'src/intervention.js', 'src/dialogue.js', 'src/commitment_text.js']) {
    const src = fs.readFileSync(path.join(ALPHA, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(src, /超える追い課金|上限 \$\{|'上限'|上限を下げ|上限を上げ|上限 0 円/, f);
  }
});

// ---------------------------------------------------------------- 2
test('修正2：ETI の同意を撤回すると、旧人格版の「止めて」の介入が状態から消え、約束は残る', () => {
  let s = commit(approvedFrom(etiCurrent()), 1000);
  s = S.stop(s, T0 + 1);
  const oldPv = s.persona.locked.persona_version;
  assert.equal(s.stopView.intervention.persona_version, oldPv);
  s = S.revoke(s, 'eti_import');
  assert.equal(s.persona.locked, null);
  assert.equal(s.stopView.intervention, null);
  assert.equal(s.stopView.commitment_id, 'c1');
  const json = JSON.stringify(s); // 操作の記録（log）も含めて確かめる
  assert.ok(!json.includes(oldPv), '旧人格版が残っています');
  assert.ok(!json.includes('止めに来たよ'), '旧人格の介入の文が残っています');
  assert.ok(s.log.some((e) => e.type === 'stale_intervention_dropped'));
  // 約束は本人の入力なので残り、記録から見られる
  assert.equal(s.commitments.items.length, 1);
  assert.equal(S.openRecords(s).step, 'records');
  assert.equal(S.viewCommitment(s, 'c1').step, 'commit_view');
  // 撤回後に「止めて」を開いても、旧人格の言葉は出ない（アプリとして伝える）
  const again = S.stop(s, T0 + 2).stopView.intervention;
  assert.equal(again.persona_version, null);
  assert.equal(again.speaker, 'app');
  assert.doesNotMatch(again.text, /止めに来たよ/);
});

test('修正2：端末保存から戻しても、古い介入は再表示されない（撤回後の保存・撤回前の古い保存の両方）', () => {
  let s = S.stop(commit(approvedFrom(etiCurrent()), 1000), T0 + 1);
  const oldPv = s.persona.locked.persona_version;
  // 撤回後に保存された内容
  const afterRevoke = S.restoreSaved(JSON.parse(JSON.stringify(S.revoke(s, 'eti_import'))), 'x');
  assert.equal(afterRevoke.stopView.intervention, null);
  assert.equal(afterRevoke.commitments.items.length, 1);
  assert.ok(!JSON.stringify(afterRevoke).includes(oldPv));
  // 承認済みの人格が消えた（または改変された）のに、古い介入だけが保存に残っていた場合
  const stale = JSON.parse(JSON.stringify(s));
  stale.persona.locked.decision_principles[0].text = '改変';
  const restored = S.restoreSaved(stale, 'x');
  assert.equal(restored.persona.locked, null);
  assert.equal(restored.stopView.intervention, null);
  assert.deepEqual(restored.dialogue.messages, []); // 旧版の会話（介入の文を含む）も使わない
  assert.notEqual(restored.step, 'stop');
  // 同じ承認済みの版のままなら、介入はそのまま戻る
  const same = S.restoreSaved(JSON.parse(JSON.stringify(s)), 'x');
  assert.equal(same.stopView.intervention.persona_version, oldPv);
});

test('修正2：簡易質問経路の人格（ETI 由来でない）の介入は、ETI の撤回で消えない', () => {
  let s = S.stop(commit(approvedFrom(quickCurrent()), 1000), T0 + 1);
  const pv = s.persona.locked.persona_version;
  s = S.revoke(s, 'eti_import');
  assert.equal(s.persona.locked.persona_version, pv);
  assert.equal(s.stopView.intervention.persona_version, pv);
});

// ---------------------------------------------------------------- 3
test('修正3：有効な約束を削除すると、期限などのデータは残らず、その時点で有効でなくなり、新しい約束を作れる', () => {
  let s = commit(approvedFrom(etiCurrent()), 1000);
  const c = s.commitments.items[0];
  assert.equal(C.statusAt(c, T0 + 1), 'active');
  assert.throws(() => S.commitStart(s, T0 + 1), (e) => e.code === 'active_exists');
  s = S.commitDelete(s, c.id);
  assert.equal(S.activeCommitment(s, T0 + 2), null);
  const json = JSON.stringify(s);
  for (const needle of [String(c.deadline_at), String(c.created_at), '限定キャラ（合成）', '貯めたいお金がある', CT.ruleText(1000)]) assert.ok(!json.includes(needle), needle);
  assert.equal(S.commitStart(s, T0 + 3).step, 'commit_new');
});
