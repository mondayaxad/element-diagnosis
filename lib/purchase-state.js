// lib/purchase-state.js
// ログイン中の本人の記録ごとの購入状態（解析レポート・完全解析）を、1か所の規則で決める。
// api/complete-checkout.js・api/my-entitlements.js・api/mentor-goal.js・api/complete-status.js が同じ結果を使う
// （マイページの表示・目標の選択・決済・閲覧の判定がずれないように）。静的には公開しない。
//
//   ・権利の実体は「診断結果」単位：同じ本人の、同じ不変の診断結果（ETI v2 の回答の符号化＝診断コードのハッシュ）を持つ
//     複数の記録は1つのまとまり（結果グループ）として扱い、二重に請求しない。別の本人とは共有しない（user_id で絞る）。
//   ・グループの「表示の正本」（canonical）：本人が保存した記録（ゲスト購入から引き継いだ記録ではないもの）を優先し、
//     販売対象・古い順。画面にはこの記録だけを出し、他の記録は duplicateOf で正本を示す（記録は消さない）。
//   ・グループの「権利の所在」（target）：完全解析の権利 → 解析レポートの権利 → 決済待ち → 正本 の順。
//     決済・目標の選択・完全解析の閲覧は、表示の正本からの要求でも target の記録に対して行う（支払済みの行は動かさない）。
//   ・解析レポートの購入済み：解析権（状態を問わない）・支払済み等の解析／完全解析の注文・有効な旧 ¥1,000（結び付け済み、
//     または診断コードのハッシュが一致する有効な旧購入）。
//   ・完全解析の購入済み（再購入不可）：完全解析権（状態を問わない）・支払済み等の完全解析の注文。
//     解析レポートだけの支払済み注文（¥1,000）は完全解析の再購入禁止に数えない（¥2,000 へ進める）。
//   ・offer：解析権が有効（記録の解析権・結び付けた旧購入）なら ¥2,000（analysis_upgrade）、無ければ ¥3,000（direct_complete）。
//     旧購入が未確認なら確認待ち、解析権が一時停止（dispute 中）なら停止中として購入を出さない。
//   ・最終の防御は DB（complete_08：同じ結果グループの二重購入を注文の作成時に拒否する）。
'use strict';
const CE = require('./complete-eligibility');
const RJ = require('./complete-report-job');

const COMPLETE_OFFERS = Object.freeze(['direct_complete', 'analysis_upgrade']);
const ANALYSIS_OFFERS = Object.freeze(['analysis', 'direct_complete']);
const PAID_LIKE = Object.freeze(['paid', 'disputed', 'refunded']);
const OPEN = Object.freeze(['created', 'checkout_open']);
const RIGHT_RANK = Object.freeze({ active: 3, suspended: 2, revoked: 1 });
const REPORT_SELECT = 'id,diagnosis_session_id,source_order_id,status,attempts,max_attempts,next_retry_at,lease_expires_at,last_error_code,manual_retries,created_at';

const one = (v) => (Array.isArray(v) ? (v[0] || null) : (v || null));
const bestStatus = (rows) => rows.map((r) => r.status).sort((a, b) => (RIGHT_RANK[b] || 0) - (RIGHT_RANK[a] || 0))[0] || null;

// 本人の記録と、判定に必要な行をまとめて読む。select(path) は PostgREST の行の配列を返す（失敗は例外）。
async function loadUserFacts(select, userId) {
  const uid = encodeURIComponent(userId);
  const sessions = await select(`diagnosis_sessions?user_id=eq.${uid}&select=id,diagnosis_version,completed_at,guest_created_at,` +
    'diagnosis_answers(encoded_answers),diagnosis_results(diagnosis_version,item_set_version,scoring_version,translation_model_version,' +
    'character_profile_version,mirror_model_version)');
  const [rights, orders, goals, reports, bindings] = await Promise.all([
    select(`record_entitlements?user_id=eq.${uid}&select=diagnosis_session_id,right_type,status,source_order_id`),
    select(`complete_orders?user_id=eq.${uid}&select=id,diagnosis_session_id,offer,status,created_at,mentor_goal_id,analysis_basis`),
    select(`record_mentor_goals?user_id=eq.${uid}&select=diagnosis_session_id,goal_id,goal_catalog_version,selected_at,locked_at`),
    select(`complete_reports?user_id=eq.${uid}&select=${REPORT_SELECT}&order=created_at.desc`),
    select(`complete_legacy_bindings?user_id=eq.${uid}&select=diagnosis_session_id,legacy_entitlement_id`),
  ]);
  const hashes = [...new Set(sessions.map((s) => keyOf(s)).filter(Boolean))];
  let legacy = [];
  let legacyBindings = [];
  let blocked = new Set();
  if (hashes.length) {
    blocked = await blockedLegacyHashes(select, hashes);
    legacy = (await select(`purchase_entitlements?diagnosis_code_hash=in.(${hashes.join(',')})&status=eq.active` +
      '&product_type=in.(core1,complete)&select=id,diagnosis_code_hash,stripe_checkout_session_id'))
      .filter((l) => !blocked.has(l.diagnosis_code_hash));
    if (legacy.length) {
      legacyBindings = await select(`complete_legacy_bindings?legacy_entitlement_id=in.(${legacy.map((l) => l.id).join(',')})` +
        '&select=legacy_entitlement_id,user_id,diagnosis_session_id');
    }
  }
  return { userId, sessions, rights, orders, goals, reports, bindings, legacy, legacyBindings, blocked };
}

// 運営者が停止・取消した旧 ¥1,000（legacy_access_blocks：complete_08 §2）。停止中・取消済みの購入は権利に数えない。
// 読めない環境（complete_08 適用前）は例外（安全側：権利を確認できないものとして扱う）
async function blockedLegacyHashes(select, hashes) {
  if (!hashes.length) return new Set();
  const rows = await select(`legacy_access_blocks?diagnosis_code_hash=in.(${hashes.join(',')})&status=in.(suspended,revoked)&select=diagnosis_code_hash`);
  return new Set(rows.map((r) => r.diagnosis_code_hash));
}

// 結果グループの鍵（診断コードのハッシュ。旧購入権の参照値と同じ規則）
function keyOf(session) {
  const a = one(session && session.diagnosis_answers);
  return CE.legacyCodeHash(a && a.encoded_answers, session && session.diagnosis_version);
}

function recordFacts(facts, s) {
  const id = s.id;
  const rights = facts.rights.filter((r) => r.diagnosis_session_id === id);
  const orders = facts.orders.filter((o) => o.diagnosis_session_id === id);
  const key = keyOf(s);
  const activeLegacyIds = new Set(facts.legacy.filter((l) => l.diagnosis_code_hash === key).map((l) => l.id));
  const boundActive = facts.bindings.some((b) => b.diagnosis_session_id === id && activeLegacyIds.has(b.legacy_entitlement_id));
  const analysisRight = bestStatus(rights.filter((r) => r.right_type === 'analysis'));
  const completeRight = bestStatus(rights.filter((r) => r.right_type === 'complete'));
  const reportRows = facts.reports.filter((r) => r.diagnosis_session_id === id);
  // ¥2,000 の完全解析は、根拠（同じ記録の解析権・結び付けた旧 ¥1,000）が有効な間だけ読める（D5。DB の complete_report_for_view と同じ）
  const basisInactive = rights.filter((r) => r.right_type === 'complete' && r.status === 'active').some((r) => {
    const o = orders.find((x) => x.id === r.source_order_id);
    if (!o || o.offer !== 'analysis_upgrade') return false;
    return o.analysis_basis === 'legacy_purchase_entitlement' ? !boundActive : analysisRight !== 'active';
  });
  return {
    id,
    key,
    session: s,
    eligibility: CE.eligibilityOf(s.diagnosis_version, one(s.diagnosis_results)),
    guestOrigin: !!s.guest_created_at,
    completedAt: s.completed_at || '',
    analysisRight,
    completeRight,
    boundActive,
    analysisOwned: analysisRight === 'active' || boundActive,
    analysisPurchased: analysisRight !== null || boundActive
      || orders.some((o) => ANALYSIS_OFFERS.includes(o.offer) && PAID_LIKE.includes(o.status)),
    completeOwned: completeRight !== null || orders.some((o) => COMPLETE_OFFERS.includes(o.offer) && PAID_LIKE.includes(o.status)),
    openOrder: orders.find((o) => OPEN.includes(o.status)) || null,
    mentorFrozen: orders.some((o) => COMPLETE_OFFERS.includes(o.offer) && ['created', 'checkout_open', 'paid', 'disputed'].includes(o.status)),
    goal: facts.goals.find((g) => g.diagnosis_session_id === id) || null,
    basisInactive,
    report: reportRows.find((r) => r.status !== 'revoked') || reportRows[0] || null,
  };
}

const byEarliest = (a, b) => (a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : (a.id < b.id ? -1 : 1));
function canonicalOf(members) {
  return members.slice().sort((a, b) => (Number(a.guestOrigin) - Number(b.guestOrigin))
    || (Number(b.eligibility.eligible) - Number(a.eligibility.eligible)) || byEarliest(a, b))[0];
}
function rightsRank(m) {
  if (m.completeOwned) return 4;
  if (m.analysisOwned || m.analysisRight === 'suspended') return 3;
  if (m.openOrder) return 2;
  return 0;
}
function targetOf(members, canonical) {
  const best = Math.max(...members.map(rightsRank));
  if (best === 0) return canonical;
  const top = members.filter((m) => rightsRank(m) === best);
  return top.includes(canonical) ? canonical : top.sort(byEarliest)[0];
}

// 記録ごとの状態。{ [diagnosis_session_id]: state }
function computeStates(facts) {
  const all = facts.sessions.filter((s) => s && s.id).map((s) => recordFacts(facts, s));
  const groups = new Map();
  for (const m of all) {
    const k = m.key ? `k:${m.key}` : `r:${m.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  const out = {};
  for (const members of groups.values()) {
    const canonical = canonicalOf(members);
    const target = targetOf(members, canonical);
    const key = canonical.key;
    const legacyActive = key ? facts.legacy.filter((l) => l.diagnosis_code_hash === key) : [];
    const boundInGroup = members.some((m) => m.boundActive);
    const legacyBoundElsewhere = new Set(facts.legacyBindings
      .filter((b) => !members.some((m) => m.id === b.diagnosis_session_id)).map((b) => b.legacy_entitlement_id));
    const analysisSource = target.analysisRight === 'active' ? 'record_entitlement' : (target.boundActive ? 'legacy_purchase_entitlement' : null);
    const completeOwned = members.some((m) => m.completeOwned);
    const analysisSuspended = !members.some((m) => m.analysisOwned) && members.some((m) => m.analysisRight === 'suspended');
    const legacyPending = legacyActive.length > 0 && !boundInGroup;
    const open = members.find((m) => m.openOrder) || null;
    let completeOffer = null;
    let completeBlocked = null;
    if (!target.eligibility.eligible) completeBlocked = 'not_eligible';
    else if (completeOwned) completeBlocked = 'repurchase_not_allowed';
    else if (open) completeBlocked = 'checkout_in_progress';
    else if (analysisSource) completeOffer = 'analysis_upgrade';
    else if (analysisSuspended) completeBlocked = 'rights_suspended';
    else if (legacyPending) completeBlocked = 'legacy_verification_required';
    else completeOffer = 'direct_complete';
    const completeRights = members.map((m) => m.completeRight).filter(Boolean);
    const group = {
      canonicalId: canonical.id,
      targetId: target.id,
      memberIds: members.map((m) => m.id),
      key,
      analysisSource,
      // 解析レポートを読める（同じ診断結果の記録のどれかに有効な解析権・結び付けた旧購入、または有効な旧 ¥1,000）
      analysisAccess: members.some((m) => m.analysisOwned) || legacyActive.length > 0,
      analysisPurchased: members.some((m) => m.analysisPurchased) || legacyActive.length > 0,
      analysisSuspended,
      completeOwned,
      completeEntitlement: completeRights.sort((a, b) => (RIGHT_RANK[b] || 0) - (RIGHT_RANK[a] || 0))[0] || null,
      legacyPending,
      legacyCandidates: legacyActive.filter((l) => !legacyBoundElsewhere.has(l.id)),
      openOrder: open ? Object.assign({ sessionId: open.id }, open.openOrder) : null,
      completeOffer,
      completeBlocked,
    };
    for (const m of members) {
      out[m.id] = Object.assign({}, group, {
        id: m.id,
        record: m,
        target,
        duplicateOf: m.id === canonical.id ? null : canonical.id,
      });
    }
  }
  return out;
}

// /api/my-entitlements の records[id] に載せる値（記録 ID・注文 ID・Stripe ID・メールは含めない。duplicateOf は本人の記録 ID）
function publicRecordState(st) {
  const t = st.target;
  return {
    completeEligible: t.eligibility.eligible,
    ineligibleReason: t.eligibility.reason,
    mentorGoal: t.goal && CE.isMentorGoalId(t.goal.goal_id)
      ? { goalId: t.goal.goal_id, goalCatalogVersion: t.goal.goal_catalog_version, selectedAt: t.goal.selected_at } : null,
    mentorGoalLocked: !!(t.goal && t.goal.locked_at),
    checkoutInProgress: !!st.openOrder,
    completeEntitlement: st.completeEntitlement,
    completeStatus: t.report ? t.report.status : 'none',
    analysisSource: st.analysisSource,
    legacyPurchasePending: st.legacyPending,
    repurchaseBlocked: st.completeOwned,
    completeOffer: st.completeOffer,
    completeBlocked: st.completeBlocked,
    duplicateOf: st.duplicateOf,
    // 完全解析を今は読めない理由（basis_inactive：¥2,000 の根拠の解析レポートの購入が取消・停止中）
    completeViewBlocked: t.basisInactive ? 'basis_inactive' : null,
    // 生成の最終の失敗：available（同じ注文で作り直せる。追加の支払いなし）／operator（お問い合わせ）／null
    completeRegenerate: t.report ? RJ.regenerateState(t.report) : null,
  };
}

module.exports = {
  COMPLETE_OFFERS, ANALYSIS_OFFERS, PAID_LIKE, OPEN, REPORT_SELECT,
  loadUserFacts, computeStates, publicRecordState, keyOf, one, blockedLegacyHashes,
};
