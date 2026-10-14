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
//   ・解析レポートの購入済み（新 Checkout の再購入禁止に使う）：解析権（状態を問わない）・支払済み等の解析／完全解析の注文。
//   ・診断コード・result_key・そのハッシュは所有者を示さない（完全に同じ回答の別人がいる）。結果グループは本人の記録だけ
//     （user_id で読んだ記録の中で、同じ result_key のもの）。別の本人の購入・権利・旧購入は数えない。
//   ・完全解析の購入済み（再購入不可）：完全解析権（状態を問わない）・支払済み等の完全解析の注文。
//     解析レポートだけの支払済み注文（¥1,000）は完全解析の再購入禁止に数えない（¥2,000 へ進める）。
//   ・offer：新しい Checkout の解析権（記録単位）が有効なら ¥2,000（analysis_upgrade）、無ければ ¥3,000（direct_complete）。
//     解析権が一時停止（dispute 中）なら停止中として購入を出さない。
//   ・旧 Payment Link の購入（purchase_entitlements）は、本人に結び付け済み（complete_legacy_bindings の user_id）のものだけを、
//     既存の解析レポートを読むために使う。診断コードのハッシュの一致だけでは使わない（別人の購入を本人の記録に付けない）。
//     新 Checkout の購入済みの判定・再購入の禁止・追加 ¥2,000 の根拠・¥3,000 の禁止には使わない。
//     画面では、結び付け済みの旧購入の記録に完全解析の申込を出さない（legacy_purchase_not_eligible は表示のためだけ）。
//   ・最終の防御は DB（complete_08・complete_10：同じ本人の結果グループの二重購入を注文の作成時に拒否する。旧購入は見ない）。
'use strict';
const CE = require('./complete-eligibility');
const RJ = require('./complete-report-job');

const COMPLETE_OFFERS = Object.freeze(['direct_complete', 'analysis_upgrade']);
const ANALYSIS_OFFERS = Object.freeze(['analysis', 'direct_complete']);
// 購入済みに数える注文（complete_11：返金済みは数えない。返金の後は買い直せる。異議申し立てで負けた注文は disputed のまま数える）
const PAID_LIKE = Object.freeze(['paid', 'disputed']);
// 購入済みに数える権利（失効は数えない）
const LIVE_RIGHTS = Object.freeze(['active', 'suspended']);
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
  // 旧購入：本人に結び付け済みのものだけ（診断コードのハッシュでは探さない）
  const boundIds = [...new Set(bindings.map((b) => b.legacy_entitlement_id).filter((x) => CE.isUuid(x)))];
  let legacy = [];
  let blocked = new Set();
  if (boundIds.length) {
    const rows = await select(`purchase_entitlements?id=in.(${boundIds.join(',')})&status=eq.active` +
      '&product_type=in.(core1,complete)&select=id,diagnosis_code_hash');
    blocked = await blockedLegacyHashes(select, [...new Set(rows.map((r) => r.diagnosis_code_hash))]);
    legacy = rows.filter((l) => !blocked.has(l.diagnosis_code_hash));
  }
  return { userId, sessions, rights, orders, goals, reports, bindings, legacy, blocked };
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
  const activeLegacyIds = new Set(facts.legacy.map((l) => l.id));
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
    // 新 Checkout の解析権（閲覧・追加 ¥2,000・再購入の禁止はこれだけで決める）
    analysisOwned: analysisRight === 'active',
    analysisPurchased: LIVE_RIGHTS.includes(analysisRight)
      || orders.some((o) => ANALYSIS_OFFERS.includes(o.offer) && PAID_LIKE.includes(o.status)),
    completeOwned: LIVE_RIGHTS.includes(completeRight) || orders.some((o) => COMPLETE_OFFERS.includes(o.offer) && PAID_LIKE.includes(o.status)),
    // 完全解析を有効に持つ（閲覧の対象を選ぶ時に、返金・失効の記録より優先する）
    completeActive: completeRight === 'active',
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
// 権利の所在（閲覧・申込の対象）の順位：有効な完全解析 > 停止中などの完全解析 > 解析レポート > 決済待ち
//   返金・失効だけの記録は数えない（買い直した記録より前に選ばない）
function rightsRank(m) {
  if (m.completeActive) return 5;
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
    // 本人に結び付け済みの有効な旧購入（閲覧と表示のためだけ）
    const boundInGroup = members.some((m) => m.boundActive);
    // ¥2,000 の根拠は新しい Checkout の解析権だけ（旧 Payment Link の購入は根拠にしない）
    const analysisSource = target.analysisRight === 'active' ? 'record_entitlement' : null;
    const completeOwned = members.some((m) => m.completeOwned);
    const analysisSuspended = !members.some((m) => m.analysisOwned) && members.some((m) => m.analysisRight === 'suspended');
    const legacyOnly = boundInGroup && !members.some((m) => m.analysisPurchased);
    const open = members.find((m) => m.openOrder) || null;
    let completeOffer = null;
    let completeBlocked = null;
    if (!target.eligibility.eligible) completeBlocked = 'not_eligible';
    else if (completeOwned) completeBlocked = 'repurchase_not_allowed';
    else if (open) completeBlocked = 'checkout_in_progress';
    else if (analysisSource) completeOffer = 'analysis_upgrade';
    else if (analysisSuspended) completeBlocked = 'rights_suspended';
    else if (legacyOnly) completeBlocked = 'legacy_purchase_not_eligible'; // 表示だけ（API は旧購入で断らない）
    else completeOffer = 'direct_complete';
    const completeRights = members.map((m) => m.completeRight).filter(Boolean);
    const group = {
      canonicalId: canonical.id,
      targetId: target.id,
      memberIds: members.map((m) => m.id),
      key,
      analysisSource,
      // 解析レポートを読める（本人の同じ診断結果の記録のどれかに有効な新 Checkout の解析権、または本人に結び付け済みの有効な旧購入）
      analysisAccess: members.some((m) => m.analysisOwned) || boundInGroup,
      // 新 Checkout の解析レポートの購入済み（¥1,000 の再購入の禁止。旧購入は数えない）
      analysisPurchased: members.some((m) => m.analysisPurchased),
      legacyAnalysis: boundInGroup,
      analysisSuspended,
      completeOwned,
      completeEntitlement: completeRights.sort((a, b) => (RIGHT_RANK[b] || 0) - (RIGHT_RANK[a] || 0))[0] || null,
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
    // 解析レポートを読める（新 Checkout の解析権・本人に結び付け済みの旧購入）／新 Checkout の解析を購入済み／旧購入の記録
    analysisAccess: st.analysisAccess,
    analysisPurchased: st.analysisPurchased,
    legacyAnalysis: st.legacyAnalysis,
    legacyPurchasePending: false, // 旧購入の確認（結び付け）は廃止。古い画面との互換のため常に false
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
  COMPLETE_OFFERS, ANALYSIS_OFFERS, PAID_LIKE, LIVE_RIGHTS, OPEN, REPORT_SELECT,
  loadUserFacts, computeStates, publicRecordState, keyOf, one, blockedLegacyHashes,
};
