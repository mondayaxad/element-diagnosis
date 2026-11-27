// ETI 取込の境界：同意前・拒否・撤回・本人確認前・別の所有者・欠損・範囲外・旧版・未知版は取り込めない。
// 取り込めるのは Big Five・STYLE・VALUES 中心化値と出所・版だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { importEtiResult } from '../src/eti_import.js';
import { S, F, consented, etiCurrent } from './helpers.js';

const ok = { subjectId: F.SYNTHETIC_SUBJECT_ID, identityVerified: true, consent: { status: 'granted', version: 'v' } };

test('本人・同意・本人確認・既知版なら取り込める', () => {
  const r = importEtiResult(F.OWN_INTROVERT, ok);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.data).sort(), ['provenance', 'scales']);
  assert.deepEqual(Object.keys(r.data.scales).sort(), ['personality', 'style', 'valuesCentered']);
  assert.equal(r.data.provenance.diagnosis_version, 'ETI-2.0');
  assert.equal(r.data.provenance.item_set_version, 'ETI-ITEM-2.0.0');
  assert.equal(r.data.provenance.scoring_version, 'ETI-SCORE-2.0.0');
});

test('生回答・診断コード・購入情報・順位・ミラーは取り込まない', () => {
  const r = importEtiResult(F.OWN_INTROVERT, ok);
  const json = JSON.stringify(r.data);
  for (const banned of ['answers_v2', 'encoded_answers', 'SYNTHETIC-ENCODED-ANSWERS', 'diagnosis_code', 'SYN-CODE-0000', 'purchase', 'syn_order_1', 'element_ranking', 'mirror_snapshot', 'Q001', '"values"']) {
    assert.ok(!json.includes(banned), `取り込んではいけない値が含まれています: ${banned}`);
  }
});

const cases = [
  ['同意前（unset）', F.OWN_INTROVERT, { ...ok, consent: { status: 'unset' } }, 'consent_not_granted'],
  ['同意なし（undefined）', F.OWN_INTROVERT, { ...ok, consent: undefined }, 'consent_not_granted'],
  ['拒否', F.OWN_INTROVERT, { ...ok, consent: { status: 'denied' } }, 'consent_not_granted'],
  ['撤回', F.OWN_INTROVERT, { ...ok, consent: { status: 'revoked' } }, 'consent_revoked'],
  ['本人確認前', F.OWN_INTROVERT, { ...ok, identityVerified: false }, 'identity_not_verified'],
  ['別の所有者', F.OTHER_OWNER, ok, 'owner_mismatch'],
  ['欠損', F.MISSING_FIELD, ok, 'missing_or_invalid'],
  ['範囲外', F.OUT_OF_RANGE, ok, 'missing_or_invalid'],
  ['旧版', F.LEGACY_VERSION, ok, 'legacy_version'],
  ['未知版', F.UNKNOWN_VERSION, ok, 'unknown_version'],
  ['採点版の不一致', F.MISMATCHED_SCORING, ok, 'unknown_version'],
  ['記録なし', null, ok, 'no_record'],
  ['元素診断以外', { ...F.OWN_INTROVERT, diagnosis_type: 'jagan' }, ok, 'not_eti'],
];
for (const [name, rec, ctx, reason] of cases) {
  test(`取り込めない：${name}`, () => {
    const r = importEtiResult(rec, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.ok(!('data' in r));
  });
}

test('画面の状態遷移でも、拒否された記録は現在像にならず、簡易質問へ進める', () => {
  for (const rec of [F.OTHER_OWNER, F.MISSING_FIELD, F.LEGACY_VERSION, F.UNKNOWN_VERSION]) {
    const s = etiCurrent(rec);
    assert.equal(s.current, null);
    assert.equal(s.imported, null);
    assert.equal(s.step, 'eti_import');
    assert.equal(S.chooseRoute(s, 'quick').step, 'quick');
  }
});

test('同意を拒否した状態では、本人の正しい記録でも取り込めない', () => {
  let s = S.chooseRoute(consented({ eti_import: false, memory: false }), 'eti');
  s = S.verifyIdentity(s, true);
  s = S.attemptImport(s, F.OWN_INTROVERT, 'own');
  assert.equal(s.current, null);
  assert.equal(s.importAttempt.reason, 'consent_not_granted');
});

test('撤回後は、再び取り込もうとしても拒否される', () => {
  let s = etiCurrent();
  assert.ok(s.current);
  s = S.revoke(s, 'eti_import');
  s = S.chooseRoute(s, 'eti');
  s = S.attemptImport(s, F.OWN_INTROVERT, 'own');
  assert.equal(s.current, null);
  assert.equal(s.importAttempt.reason, 'consent_revoked');
});
