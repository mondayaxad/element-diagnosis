// api/complete-status.js
// 完全解析の状態確認（本人の記録だけ）。Preview だけで動く（Production は 404 not_available）。
//
//   GET /api/complete-status?diagnosisSessionId=<uuid>   Authorization: Bearer <Supabase access token>
//       → 200 { salesOpen, order, entitlements, report, mentorGoal }
//
// 設計方針
//   - 確認の順：環境 → 認証 → 入力 → 本人の記録。他人の記録と存在しない記録は同じ 404 record_not_found。
//   - 返すのは状態だけ：最新の注文（状態・offer・金額）、権利（analysis・complete の状態）、生成物の状態、MENTOR の選択とロック。
//     Stripe ID・保存パス・メール・診断コード・注文 ID・user ID は返さない。
//   - 署名 URL の発行（POST）は、Storage と閲覧機能の工程で追加する（この工程では作らない）。
'use strict';
const { resolveAppEnv, requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const CE = require('../lib/complete-eligibility');
const CP = require('../lib/complete-payment');

const API = 'complete-status';
const RIGHT_ORDER = ['active', 'suspended', 'revoked'];

function queryParam(req, name) {
  if (req.query && typeof req.query[name] === 'string') return req.query[name];
  try { return new URL(req.url || '/', 'http://x').searchParams.get(name); } catch { return null; }
}

function rightStatus(rows, type) {
  const statuses = rows.filter((r) => r.right_type === type).map((r) => r.status);
  return RIGHT_ORDER.find((s) => statuses.includes(s)) || null;
}

function createHandler({ env, fetchImpl, logger = console }) {
  function fail(res, status, code) {
    return res.status(status).json({ error: code });
  }
  function failLogged(res, status, code, reason) {
    const incident = CE.incidentId();
    CP.logError(logger, API, reason || code, incident);
    return res.status(status).json({ error: code, incident_id: incident });
  }

  return async function handler(req, res) {
    CP.setCommonHeaders(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return fail(res, 405, 'method_not_allowed');
    }
    if (resolveAppEnv(env, { host: requestHost(req) }) !== 'preview') return fail(res, 404, 'not_available');
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true });
    if (!guard.ok) {
      const incident = logEnvDenied(API, guard, logger);
      return res.status(503).json({ error: 'service_unavailable', incident_id: incident });
    }
    if (guard.appEnv !== 'preview' || guard.projectRef !== env.SUPABASE_PREVIEW_PROJECT_REF) return fail(res, 404, 'not_available');

    // 認証（入力の検査より先）
    const token = CP.bearerToken(req);
    if (!token) return fail(res, 401, 'not_authenticated');
    let user;
    try {
      user = await CP.authUser(fetchImpl, guard, token);
    } catch (err) {
      return failLogged(res, 503, 'service_unavailable', err.code);
    }
    if (!user) return fail(res, 401, 'not_authenticated');

    const sessionId = queryParam(req, 'diagnosisSessionId');
    if (!CE.isUuid(sessionId)) return fail(res, 400, 'invalid_request');

    try {
      const sid = encodeURIComponent(sessionId);
      const uid = encodeURIComponent(user.id);
      const sessions = await CP.selectRows(fetchImpl, guard, `diagnosis_sessions?id=eq.${sid}&user_id=eq.${uid}&select=id`);
      if (!sessions[0]) return fail(res, 404, 'record_not_found');
      const [orders, rights, reports, goals] = await Promise.all([
        CP.selectRows(fetchImpl, guard, `complete_orders?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=status,offer,amount,created_at&order=created_at.desc`),
        CP.selectRows(fetchImpl, guard, `record_entitlements?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=right_type,status`),
        CP.selectRows(fetchImpl, guard, `complete_reports?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=status,created_at&order=created_at.desc`),
        CP.selectRows(fetchImpl, guard, `record_mentor_goals?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=goal_id,goal_catalog_version,locked_at`),
      ]);
      const order = orders[0] || null;
      const report = reports[0] || null;
      const goal = goals[0] || null;
      return res.status(200).json({
        salesOpen: CP.salesOpen(env),
        order: order ? { status: order.status, offer: order.offer, amount: order.amount } : null,
        entitlements: { analysis: rightStatus(rights, 'analysis'), complete: rightStatus(rights, 'complete') },
        report: report ? { status: report.status } : null,
        mentorGoal: goal && CE.isMentorGoalId(goal.goal_id)
          ? { goalId: goal.goal_id, goalCatalogVersion: goal.goal_catalog_version, locked: !!goal.locked_at }
          : null,
      });
    } catch (err) {
      return failLogged(res, 503, 'service_unavailable', err && err.code ? err.code : 'lookup_failed');
    }
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
