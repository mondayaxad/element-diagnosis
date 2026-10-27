// lib/complete-eligibility.js
// 完全解析（COMPLETE-RC1）の販売対象の判定・MENTOR 目標カタログ・旧 ¥1,000 購入権の参照値。
// API（api/mentor-goal.js・api/my-entitlements.js）からだけ使う。静的には公開しない（scripts/build-public.js の対象外）。
//
//   ・販売対象は、保存済みの診断結果の6つの版が RC1 の要求と完全に一致する記録だけ
//     （DB の complete_rc1_required_versions()・注文トリガーと同じ値。tests/complete_eligibility.test.js で照合する）。
//   ・MENTOR 目標の正本は prototypes/core1_v4_result_driven/src/content/mentor-goals.json（CORE1-MENTOR-GOALS-1.0.0）。
//     表示に使うのは goal_id・label・keep_phrase だけ（文言は改変しない）。deltas・borrow は返さない。
//   ・登録完了は profiles.onboarding_status が completed または legacy_exempt。
'use strict';
const crypto = require('crypto');
const MENTOR_GOALS_SOURCE = require('../prototypes/core1_v4_result_driven/src/content/mentor-goals.json');

const RC1_REQUIRED_VERSIONS = Object.freeze({
  diagnosis_version: 'ETI-2.0',
  item_set_version: 'ETI-ITEM-2.0.0',
  scoring_version: 'ETI-SCORE-2.0.0',
  translation_model_version: 'ETI-TRANS-2.0.0',
  character_profile_version: 'ETI-CHAR-2.1.0',
  mirror_model_version: 'ETI-MIRROR-2.1.0',
});

const MENTOR_CATALOG_VERSION = 'CORE1-MENTOR-GOALS-1.0.0';
const ONBOARDING_COMPLETE = Object.freeze(['completed', 'legacy_exempt']);

// 決済待ち・支払済みの注文（MENTOR 目標を変えられない状態。complete_03 と同じ一覧）
const MENTOR_FROZEN_ORDER_STATUSES = Object.freeze(['created', 'checkout_open', 'paid', 'disputed']);
// 決済処理中（Checkout を開いている途中）
const CHECKOUT_IN_PROGRESS_STATUSES = Object.freeze(['created', 'checkout_open']);
// 同じ記録の再購入を禁止する注文（complete_04 と同じ一覧）
const REPURCHASE_BLOCKING_ORDER_STATUSES = Object.freeze(['paid', 'disputed', 'refunded']);

function loadMentorCatalog() {
  if (!MENTOR_GOALS_SOURCE || MENTOR_GOALS_SOURCE.version !== MENTOR_CATALOG_VERSION || !Array.isArray(MENTOR_GOALS_SOURCE.goals)) {
    throw new Error('mentor_catalog_invalid');
  }
  return Object.freeze({
    version: MENTOR_CATALOG_VERSION,
    goals: Object.freeze(MENTOR_GOALS_SOURCE.goals.map((g) => Object.freeze({
      goalId: g.goal_id,
      label: g.label,
      description: g.keep_phrase,
    }))),
  });
}
const MENTOR_CATALOG = loadMentorCatalog();
const MENTOR_GOAL_IDS = Object.freeze(MENTOR_CATALOG.goals.map((g) => g.goalId));

function isMentorGoalId(goalId) {
  return typeof goalId === 'string' && MENTOR_GOAL_IDS.includes(goalId);
}

// 記録（diagnosis_sessions の診断版）と保存済みの結果（diagnosis_results の行）から販売対象かを判定する。
//   legacy_version：最新版（ETI-2.0）ではない／result_missing：保存済みの結果が無い／version_mismatch：6つの版のどれかが違う
function eligibilityOf(sessionDiagnosisVersion, result) {
  if (sessionDiagnosisVersion !== RC1_REQUIRED_VERSIONS.diagnosis_version) return { eligible: false, reason: 'legacy_version' };
  if (!result || typeof result !== 'object') return { eligible: false, reason: 'result_missing' };
  for (const [k, v] of Object.entries(RC1_REQUIRED_VERSIONS)) {
    if (result[k] !== v) return { eligible: false, reason: 'version_mismatch' };
  }
  return { eligible: true, reason: null };
}

function isOnboardingComplete(status) {
  return ONBOARDING_COMPLETE.includes(status);
}

// 旧 ¥1,000 購入権（purchase_entitlements.diagnosis_code_hash）の参照値。verify.js・my-entitlements.js と同じ規則。
function legacyCodeHash(encodedAnswers, diagnosisVersion) {
  if (typeof encodedAnswers !== 'string' || !encodedAnswers) return null;
  const reference = diagnosisVersion === 'ETI-2.0' ? `v2_${encodedAnswers}` : encodedAnswers;
  return crypto.createHash('sha256').update(reference).digest('hex');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// 照合ID（ログ・応答に出す。個人情報・記録 ID は含めない）
function incidentId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = {
  RC1_REQUIRED_VERSIONS,
  MENTOR_CATALOG_VERSION,
  MENTOR_CATALOG,
  MENTOR_GOAL_IDS,
  ONBOARDING_COMPLETE,
  MENTOR_FROZEN_ORDER_STATUSES,
  CHECKOUT_IN_PROGRESS_STATUSES,
  REPURCHASE_BLOCKING_ORDER_STATUSES,
  isMentorGoalId,
  eligibilityOf,
  isOnboardingComplete,
  legacyCodeHash,
  isUuid,
  incidentId,
};
