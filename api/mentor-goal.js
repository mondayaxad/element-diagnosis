// api/mentor-goal.js
// 完全解析の MENTOR 目標（記録ごとに1つ）の取得・選択。Preview だけで動く（Production は 404 not_available）。
//
//   GET  /api/mentor-goal?diagnosisSessionId=<uuid>
//        → { catalog, selection, locked, checkoutInProgress, changeAllowed, eligible, ineligibleReason,
//            onboardingCompleted, legacyPurchasePending }
//   POST /api/mentor-goal   { diagnosisSessionId, goalId }
//        → 200 { selection, locked, checkoutInProgress, changeAllowed, unchanged }
//
// 設計方針
//   - 本人のアクセストークンから user_id を特定し、本人の記録（diagnosis_sessions.id かつ user_id）だけを扱う。
//     他人の記録と存在しない記録は同じ 404 record_not_found にする。
//   - 目標はカタログ（CORE1-MENTOR-GOALS-1.0.0）の5つだけ。カタログの版はサーバーが決める。結果から自動で選ばない。
//   - 選択の前提：登録完了（completed／legacy_exempt）・販売対象（RC1 の6つの版が完全一致）・支払後ロックなし・
//     決済待ち／支払済みの注文（created・checkout_open・paid・disputed）なし。
//     同じ目標の再送は書き込まずに 200（冪等）。DB のトリガー（complete_01・03）を最終の防御にする。
//   - 応答・ログに記録 ID・目標の文面・個人情報を出さない。ログは理由コードと照合 ID だけ。
//   - 環境ガード（lib/server-env.js）を Supabase へ接続する前に通す。
'use strict';
const { resolveAppEnv, requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const CE = require('../lib/complete-eligibility');

const MAX_BODY_BYTES = 1024;

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function parseBody(req) {
  const raw = req.body;
  if (raw === undefined || raw === null || raw === '') return { ok: false };
  let text;
  let obj;
  if (typeof raw === 'string') {
    text = raw;
    try { obj = JSON.parse(raw); } catch { return { ok: false }; }
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString('utf8');
    try { obj = JSON.parse(text); } catch { return { ok: false }; }
  } else if (typeof raw === 'object') {
    obj = raw;
    text = JSON.stringify(raw);
  } else {
    return { ok: false };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  return { ok: true, body: obj };
}

function queryParam(req, name) {
  if (req.query && typeof req.query[name] === 'string') return req.query[name];
  try { return new URL(req.url || '/', 'http://x').searchParams.get(name); } catch { return null; }
}

function first(v) {
  return Array.isArray(v) ? (v[0] || null) : (v || null);
}

function createHandler({ env, fetchImpl, logger = console }) {
  async function json(res) {
    try { return await res.json(); } catch { return null; }
  }

  async function getUserIdFromAccessToken(conn, accessToken) {
    const res = await fetchImpl(`${conn.supabaseUrl}/auth/v1/user`, { headers: conn.userHeaders(accessToken) });
    if (!res.ok) return null;
    const user = await json(res);
    return user && user.id ? user.id : null;
  }

  async function select(conn, path) {
    const res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/${path}`, { headers: conn.adminHeaders() });
    if (!res.ok) throw new Error('lookup_failed');
    const rows = await json(res);
    if (!Array.isArray(rows)) throw new Error('lookup_failed');
    return rows;
  }

  // 記録と、目標の選択に必要な状態をまとめて読む。本人の記録でなければ null。
  async function loadState(conn, userId, sessionId) {
    const sid = encodeURIComponent(sessionId);
    const uid = encodeURIComponent(userId);
    const sessions = await select(conn,
      `diagnosis_sessions?id=eq.${sid}&user_id=eq.${uid}` +
      '&select=id,diagnosis_version,diagnosis_results(diagnosis_version,item_set_version,scoring_version,' +
      'translation_model_version,character_profile_version,mirror_model_version),diagnosis_answers(encoded_answers)');
    const session = sessions[0];
    if (!session) return null;
    const [profiles, goals, orders, bindings] = await Promise.all([
      select(conn, `profiles?id=eq.${uid}&select=onboarding_status`),
      select(conn, `record_mentor_goals?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=goal_id,goal_catalog_version,selected_at,locked_at`),
      select(conn, `complete_orders?diagnosis_session_id=eq.${sid}&select=status`),
      select(conn, `complete_legacy_bindings?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=legacy_entitlement_id`),
    ]);
    const answers = first(session.diagnosis_answers);
    const hash = CE.legacyCodeHash(answers && answers.encoded_answers, session.diagnosis_version);
    let legacyIds = [];
    if (hash) {
      const legacy = await select(conn,
        `purchase_entitlements?diagnosis_code_hash=eq.${hash}&status=eq.active&product_type=in.(core1,complete)&select=id`);
      legacyIds = legacy.map((r) => r.id);
    }
    const boundIds = new Set(bindings.map((b) => b.legacy_entitlement_id));
    const goal = goals[0] || null;
    const statuses = orders.map((o) => o.status);
    const eligibility = CE.eligibilityOf(session.diagnosis_version, first(session.diagnosis_results));
    const locked = !!(goal && goal.locked_at);
    const frozen = statuses.some((s) => CE.MENTOR_FROZEN_ORDER_STATUSES.includes(s));
    return {
      eligibility,
      onboardingCompleted: CE.isOnboardingComplete(profiles[0] && profiles[0].onboarding_status),
      goal,
      locked,
      frozen,
      checkoutInProgress: statuses.some((s) => CE.CHECKOUT_IN_PROGRESS_STATUSES.includes(s)),
      legacyPurchasePending: legacyIds.length > 0 && !legacyIds.some((id) => boundIds.has(id)),
    };
  }

  function view(state) {
    const g = state.goal;
    return {
      selection: g && CE.isMentorGoalId(g.goal_id)
        ? { goalId: g.goal_id, goalCatalogVersion: g.goal_catalog_version, selectedAt: g.selected_at }
        : null,
      locked: state.locked,
      checkoutInProgress: state.checkoutInProgress,
      changeAllowed: !state.locked && !state.frozen,
    };
  }

  function fail(res, status, code, extra) {
    res.status(status).json(Object.assign({ error: code }, extra || {}));
  }
  function failLogged(res, status, code) {
    const incident = CE.incidentId();
    logger.error('mentor-goal error:', code, incident);
    res.status(status).json({ error: code, incident_id: incident });
  }

  // PostgREST の誤り（DB トリガーの例外）を応答へ対応させる
  function mapWriteError(body) {
    const msg = String((body && (body.message || body.details || body.hint)) || '');
    if (msg.includes('mentor_goal_locked')) return [409, 'mentor_goal_locked'];
    if (msg.includes('mentor_goal_checkout_in_progress')) return [409, 'checkout_in_progress'];
    if (msg.includes('mentor_goal_record_not_found')) return [404, 'record_not_found'];
    return null;
  }

  return async function handler(req, res) {
    setCommonHeaders(res);
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return fail(res, 405, 'method_not_allowed');
    }
    // Production（と環境不明）では存在しない扱い。Supabase へは接続しない。
    if (resolveAppEnv(env, { host: requestHost(req) }) !== 'preview') {
      return fail(res, 404, 'not_available');
    }
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true });
    if (!guard.ok) {
      const incident = logEnvDenied('mentor-goal', guard, logger);
      return res.status(503).json({ error: 'service_unavailable', incident_id: incident });
    }
    if (guard.appEnv !== 'preview' || !env.SUPABASE_PREVIEW_PROJECT_REF || guard.projectRef !== env.SUPABASE_PREVIEW_PROJECT_REF) {
      return fail(res, 404, 'not_available');
    }

    let sessionId;
    let goalId = null;
    if (req.method === 'GET') {
      sessionId = queryParam(req, 'diagnosisSessionId');
    } else {
      const parsed = parseBody(req);
      if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
      sessionId = parsed.body.diagnosisSessionId;
      goalId = parsed.body.goalId;
      if (typeof goalId !== 'string' || goalId.length > 64) return fail(res, 400, 'invalid_request');
    }
    if (!CE.isUuid(sessionId)) return fail(res, 400, 'invalid_request');

    const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) return fail(res, 401, 'not_authenticated');

    let userId;
    let state;
    try {
      userId = await getUserIdFromAccessToken(guard, accessToken);
      if (!userId) return fail(res, 401, 'not_authenticated');
      state = await loadState(guard, userId, sessionId);
    } catch {
      return failLogged(res, 500, 'lookup_failed');
    }
    if (!state) return fail(res, 404, 'record_not_found');

    if (req.method === 'GET') {
      return res.status(200).json(Object.assign({
        catalog: CE.MENTOR_CATALOG,
        eligible: state.eligibility.eligible,
        ineligibleReason: state.eligibility.reason,
        onboardingCompleted: state.onboardingCompleted,
        legacyPurchasePending: state.legacyPurchasePending,
      }, view(state)));
    }

    // POST：選択
    if (!state.onboardingCompleted) return fail(res, 403, 'onboarding_required');
    if (!state.eligibility.eligible) return fail(res, 422, 'not_eligible', { reason: state.eligibility.reason });
    if (!CE.isMentorGoalId(goalId)) return fail(res, 422, 'unknown_goal');
    const current = state.goal;
    if (current && current.goal_id === goalId && current.goal_catalog_version === CE.MENTOR_CATALOG_VERSION) {
      return res.status(200).json(Object.assign({ unchanged: true }, view(state)));
    }
    if (state.locked) return fail(res, 409, 'mentor_goal_locked');
    if (state.frozen) return fail(res, 409, 'checkout_in_progress');

    let written;
    try {
      const w = await fetchImpl(`${guard.supabaseUrl}/rest/v1/record_mentor_goals?on_conflict=diagnosis_session_id`, {
        method: 'POST',
        headers: Object.assign({}, guard.adminHeaders(), {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        }),
        body: JSON.stringify({
          diagnosis_session_id: sessionId,
          user_id: userId,
          goal_catalog_version: CE.MENTOR_CATALOG_VERSION,
          goal_id: goalId,
          selected_at: new Date().toISOString(),
        }),
      });
      const body = await json(w);
      if (!w.ok) {
        const mapped = mapWriteError(body);
        if (mapped) return fail(res, mapped[0], mapped[1]);
        return failLogged(res, 500, 'save_failed');
      }
      written = Array.isArray(body) ? body[0] : body;
    } catch {
      return failLogged(res, 500, 'save_failed');
    }
    if (!written || written.goal_id !== goalId) return failLogged(res, 500, 'save_failed');
    return res.status(200).json(Object.assign({ unchanged: false }, view(Object.assign({}, state, { goal: written, locked: !!written.locked_at }))));
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
