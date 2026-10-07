// lib/complete-eligibility.js のテスト。販売対象の版・MENTOR 目標カタログ・注文状態の一覧が、
// 適用済みの migration（complete_01・03・04）とカタログ JSON の正本に一致することを確かめる。
//   実行: node --test tests/complete_eligibility.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CE = require('../lib/complete-eligibility');

const ROOT = path.join(__dirname, '..');
const SQL01 = fs.readFileSync(path.join(ROOT, 'docs/sql/20261007111306_complete_01_orders_entitlements_reports.sql'), 'utf8');
const SQL03 = fs.readFileSync(path.join(ROOT, 'docs/sql/20261007205700_complete_03_mentor_goal_ownership.sql'), 'utf8');
const SQL04 = fs.readFileSync(path.join(ROOT, 'docs/sql/20261007213147_complete_04_payment_transactions.sql'), 'utf8');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototypes/core1_v4_result_driven/src/content/mentor-goals.json'), 'utf8'));

test('RC1 の6つの版は complete_01 の complete_rc1_required_versions() と同じ', () => {
  const m = SQL01.match(/select 'ETI-2\.0'::text, 'ETI-ITEM-2\.0\.0'::text, 'ETI-SCORE-2\.0\.0'::text,\s*'ETI-TRANS-2\.0\.0'::text, 'ETI-CHAR-2\.1\.0'::text, 'ETI-MIRROR-2\.1\.0'::text/);
  assert.ok(m, 'SQL の版の一覧が見つかりません');
  assert.deepEqual(CE.RC1_REQUIRED_VERSIONS, {
    diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0', scoring_version: 'ETI-SCORE-2.0.0',
    translation_model_version: 'ETI-TRANS-2.0.0', character_profile_version: 'ETI-CHAR-2.1.0', mirror_model_version: 'ETI-MIRROR-2.1.0',
  });
});

test('MENTOR 目標カタログ：版・5つの ID が complete_01 の CHECK と一致し、文言は JSON の正本のまま', () => {
  assert.equal(CE.MENTOR_CATALOG_VERSION, 'CORE1-MENTOR-GOALS-1.0.0');
  assert.equal(CATALOG.version, CE.MENTOR_CATALOG_VERSION);
  assert.ok(SQL01.includes(`goal_catalog_version = '${CE.MENTOR_CATALOG_VERSION}'`));
  assert.deepEqual(CE.MENTOR_GOAL_IDS, ['GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01']);
  assert.ok(SQL01.includes("goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')"));
  assert.equal(CE.MENTOR_CATALOG.goals.length, 5);
  CE.MENTOR_CATALOG.goals.forEach((g, i) => {
    assert.deepEqual(Object.keys(g), ['goalId', 'label', 'description']);
    assert.equal(g.goalId, CATALOG.goals[i].goal_id);
    assert.equal(g.label, CATALOG.goals[i].label);
    assert.equal(g.description, CATALOG.goals[i].keep_phrase); // keep_phrase をそのまま（改変・要約なし）
  });
  assert.ok(!JSON.stringify(CE.MENTOR_CATALOG).includes('deltas') && !JSON.stringify(CE.MENTOR_CATALOG).includes('borrow'));
  assert.ok(Object.isFrozen(CE.MENTOR_CATALOG) && Object.isFrozen(CE.MENTOR_CATALOG.goals[0]));
  assert.equal(CE.isMentorGoalId('GOAL_PACE_01'), true);
  assert.equal(CE.isMentorGoalId('GOAL_UNKNOWN_99'), false);
  assert.equal(CE.isMentorGoalId(null), false);
});

test('注文状態の一覧は complete_03（MENTOR 変更禁止）・complete_04（再購入禁止）と一致', () => {
  assert.ok(SQL03.includes("o.status in ('created', 'checkout_open', 'paid', 'disputed')"));
  assert.deepEqual(CE.MENTOR_FROZEN_ORDER_STATUSES, ['created', 'checkout_open', 'paid', 'disputed']);
  assert.ok(SQL04.includes("o.status in ('paid', 'disputed', 'refunded')"));
  assert.deepEqual(CE.REPURCHASE_BLOCKING_ORDER_STATUSES, ['paid', 'disputed', 'refunded']);
  assert.deepEqual(CE.CHECKOUT_IN_PROGRESS_STATUSES, ['created', 'checkout_open']);
  assert.deepEqual(CE.ONBOARDING_COMPLETE, ['completed', 'legacy_exempt']);
});

test('販売対象の判定：最新版・結果あり・6つの版が完全一致だけ', () => {
  const ok = { ...CE.RC1_REQUIRED_VERSIONS };
  assert.deepEqual(CE.eligibilityOf('ETI-2.0', ok), { eligible: true, reason: null });
  assert.deepEqual(CE.eligibilityOf(null, ok), { eligible: false, reason: 'legacy_version' });
  assert.deepEqual(CE.eligibilityOf('legacy-v1', ok), { eligible: false, reason: 'legacy_version' });
  assert.deepEqual(CE.eligibilityOf('ETI-2.0', null), { eligible: false, reason: 'result_missing' });
  for (const k of Object.keys(ok)) {
    assert.deepEqual(CE.eligibilityOf('ETI-2.0', { ...ok, [k]: 'X' }), { eligible: false, reason: 'version_mismatch' }, k);
  }
  assert.deepEqual(CE.eligibilityOf('ETI-2.0', { ...ok, mirror_model_version: 'ETI-MIRROR-2.0.2', character_profile_version: 'ETI-CHAR-2.0.1' }),
    { eligible: false, reason: 'version_mismatch' });
});

test('旧 ¥1,000 購入権の参照値は verify.js・my-entitlements と同じ規則（v2 は v2_ 付き）', () => {
  const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
  assert.equal(CE.legacyCodeHash('ABC', 'ETI-2.0'), h('v2_ABC'));
  assert.equal(CE.legacyCodeHash('ABC', 'legacy-v1'), h('ABC'));
  assert.equal(CE.legacyCodeHash('', 'ETI-2.0'), null);
  assert.equal(CE.isOnboardingComplete('completed'), true);
  assert.equal(CE.isOnboardingComplete('legacy_exempt'), true);
  assert.equal(CE.isOnboardingComplete('required'), false);
  assert.equal(CE.isUuid('11111111-2222-4333-8444-555555555555'), true);
  assert.equal(CE.isUuid('not-a-uuid'), false);
  assert.match(CE.incidentId(), /^[0-9a-f]{12}$/);
});
