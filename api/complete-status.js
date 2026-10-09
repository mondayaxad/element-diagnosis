// api/complete-status.js
// 完全解析の状態確認・閲覧 URL の発行・閲覧（本人の記録だけ）。Preview だけで動く（Production は 404 not_available）。
//
//   GET  /api/complete-status?diagnosisSessionId=<uuid>   Authorization: Bearer <Supabase access token>
//        → 200 { salesOpen, order, entitlements, report, mentorGoal }
//          生成が取り残されていれば（queued・再試行時刻を過ぎた failed・lease の切れた generating）応答の後で生成を始める。
//   POST /api/complete-status   Authorization: Bearer …   { "diagnosisSessionId": "<uuid>" }
//        → 200 { viewUrl, expiresIn: 300 }   閲覧用の短時間 URL（この API の GET ?view=…）
//   GET  /api/complete-status?view=<token>   （ブラウザで開く。認証ヘッダーは使わない）
//        → 200 text/html（46ページの完全解析レポート）
//
// 設計方針
//   - 確認の順：環境 → 認証 → 入力 → 本人の記録。他人の記録と存在しない記録は同じ 404 record_not_found。
//   - 状態の応答に Stripe ID・保存先・メール・診断コード・注文 ID・user ID・report ID を出さない。
//   - 閲覧 URL：本人確認（Bearer）と権利の確認の後に毎回発行する。トークンは AES-256-GCM（report・user・記録・期限 300秒）で、
//     中身は読めない。保存先は URL に入れない（Supabase Storage の署名 URL は保存先を含むため使わない）。
//   - 閲覧：トークンの期限を確かめ、開くたびに DB で権利を確かめ直す（complete_report_for_view：生成物 ready・注文 paid・
//     完全解析権 active）。suspended・revoked（返金・dispute 敗訴）では開けない。保存物の SHA-256 が記録と一致しなければ出さない。
//     応答は CSP（生成 HTML の CSP＋frame-ancestors・sandbox）・private, no-store・no-referrer・nosniff・noindex。
//   - 秘密値は 32バイト以上の乱数（base64url・43文字以上）。満たさなければ発行も閲覧も 503。トークンはログ・エラー応答に出さない。
//   - ログは理由コードと照合 ID だけ。
'use strict';
const { resolveAppEnv, requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const CE = require('../lib/complete-eligibility');
const CP = require('../lib/complete-payment');
const RJ = require('../lib/complete-report-job');

const API = 'complete-status';
const RIGHT_ORDER = ['active', 'suspended', 'revoked'];
const MAX_BODY_BYTES = 512;
const VIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; "
  + "frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox";

function queryParam(req, name) {
  if (req.query && typeof req.query[name] === 'string') return req.query[name];
  try { return new URL(req.url || '/', 'http://x').searchParams.get(name); } catch { return null; }
}

function rightStatus(rows, type) {
  const statuses = rows.filter((r) => r.right_type === type).map((r) => r.status);
  return RIGHT_ORDER.find((s) => statuses.includes(s)) || null;
}

function parseBody(req) {
  const raw = req.body;
  let obj = raw;
  let text;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    text = raw.toString('utf8');
    try { obj = JSON.parse(text); } catch { return { ok: false }; }
  } else if (raw && typeof raw === 'object') {
    text = JSON.stringify(raw);
  } else {
    return { ok: false };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== 'diagnosisSessionId' || !CE.isUuid(obj.diagnosisSessionId)) return { ok: false };
  return { ok: true, sessionId: obj.diagnosisSessionId };
}

function createHandler({ env, fetchImpl, logger = console, waitUntil = RJ.defaultWaitUntil(), storageFactory = null, now = () => Date.now() }) {
  function fail(res, status, code) {
    return res.status(status).json({ error: code });
  }
  function failLogged(res, status, code, reason) {
    const incident = CE.incidentId();
    CP.logError(logger, API, reason || code, incident);
    return res.status(status).json({ error: code, incident_id: incident });
  }
  const storageFor = (conn) => (storageFactory ? storageFactory(conn) : RJ.storageClient(conn, fetchImpl));

  // 取り残された生成を応答の後で始める（同時に呼ばれても DB の lease で1つだけが生成する）
  function recover(conn, reportId) {
    return RJ.scheduleReport(waitUntil, () => RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId, logger }), logger);
  }

  async function guardFor(req, opts) {
    const appEnv0 = resolveAppEnv(env, { host: requestHost(req) });
    if (appEnv0 !== 'preview' && appEnv0 !== 'production') return { status: 404, body: { error: 'not_available' } };
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, ...opts });
    if (!guard.ok) {
      const incident = logEnvDenied(API, guard, logger);
      return { status: 503, body: { error: 'service_unavailable', incident_id: incident } };
    }
    // Preview は Preview の Supabase、Production は本番の Supabase だけ（Ref の取り違えは存在しない扱い）
    const expectedRef = guard.appEnv === 'production' ? env.SUPABASE_PRODUCTION_PROJECT_REF : guard.appEnv === 'preview' ? env.SUPABASE_PREVIEW_PROJECT_REF : null;
    if (!expectedRef || guard.projectRef !== expectedRef) return { status: 404, body: { error: 'not_available' } };
    return { guard };
  }

  async function authenticate(req, res, guard) {
    const token = CP.bearerToken(req);
    if (!token) { fail(res, 401, 'not_authenticated'); return null; }
    let user;
    try {
      user = await CP.authUser(fetchImpl, guard, token);
    } catch (err) {
      failLogged(res, 503, 'service_unavailable', err.code);
      return null;
    }
    if (!user) { fail(res, 401, 'not_authenticated'); return null; }
    return user;
  }

  // ---- 閲覧（GET ?view=）
  async function view(req, res) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    const g = await guardFor(req, {});
    if (!g.guard) return res.status(g.status).json(g.body);
    if (!RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return failLogged(res, 503, 'service_unavailable', 'view_secret_missing');
    const t = RJ.readViewToken(env.COMPLETE_VIEW_TOKEN_SECRET, queryParam(req, 'view'), Math.floor(now() / 1000));
    if (!t.ok) {
      const incident = CE.incidentId();
      CP.logError(logger, API, t.reason, incident);
      return res.status(t.reason === 'token_expired' ? 410 : 403).json({ error: t.reason === 'token_expired' ? 'view_link_expired' : 'view_link_invalid', incident_id: incident });
    }
    let row;
    try {
      const rows = await CP.rpc(fetchImpl, g.guard, 'complete_report_for_view', { p_user_id: t.userId, p_diagnosis_session_id: t.sessionId });
      row = Array.isArray(rows) ? rows[0] : null;
    } catch (err) {
      return failLogged(res, 503, 'service_unavailable', err.code);
    }
    if (!row || row.state !== 'ok' || row.report_id !== t.reportId || typeof row.storage_path !== 'string' || !RJ.OBJECT_KEY_RE.test(row.storage_path)) {
      const code = row && row.state === 'not_ready' ? 'report_not_ready' : 'not_entitled';
      return fail(res, code === 'report_not_ready' ? 409 : 403, code);
    }
    let body;
    try {
      body = await storageFor(g.guard).download(row.storage_path);
    } catch (err) {
      return failLogged(res, err.transient ? 503 : 500, err.transient ? 'service_unavailable' : 'report_unavailable', err.code);
    }
    if (require('crypto').createHash('sha256').update(body).digest('hex') !== row.output_sha256) {
      return failLogged(res, 500, 'report_unavailable', 'output_hash_mismatch');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', VIEW_CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.status(200);
    return res.send(body);
  }

  return async function handler(req, res) {
    CP.setCommonHeaders(res);
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return fail(res, 405, 'method_not_allowed');
    }
    if (req.method === 'GET' && queryParam(req, 'view') !== null) return view(req, res);

    const g = await guardFor(req, { user: true });
    if (!g.guard) return res.status(g.status).json(g.body);
    const guard = g.guard;

    // 認証（入力の検査より先）
    const user = await authenticate(req, res, guard);
    if (!user) return undefined;

    let sessionId;
    if (req.method === 'GET') {
      sessionId = queryParam(req, 'diagnosisSessionId');
      if (!CE.isUuid(sessionId)) return fail(res, 400, 'invalid_request');
    } else {
      const parsed = parseBody(req);
      if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
      sessionId = parsed.sessionId;
    }

    const sid = encodeURIComponent(sessionId);
    const uid = encodeURIComponent(user.id);
    try {
      const sessions = await CP.selectRows(fetchImpl, guard, `diagnosis_sessions?id=eq.${sid}&user_id=eq.${uid}&select=id`);
      if (!sessions[0]) return fail(res, 404, 'record_not_found');

      if (req.method === 'POST') {
        // 閲覧 URL の発行：本人確認の後、毎回 DB で権利を確かめる
        if (!RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return failLogged(res, 503, 'service_unavailable', 'view_secret_missing');
        const rows = await CP.rpc(fetchImpl, guard, 'complete_report_for_view', { p_user_id: user.id, p_diagnosis_session_id: sessionId });
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row || row.state === 'not_found' || row.state === 'not_entitled') return fail(res, 403, 'not_entitled');
        if (row.state !== 'ok') {
          const reports = await CP.selectRows(fetchImpl, guard, `complete_reports?id=eq.${encodeURIComponent(row.report_id)}&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at`);
          if (RJ.isDue(reports[0], now())) recover(guard, reports[0].id);
          return fail(res, 409, 'report_not_ready');
        }
        const issued = RJ.issueViewToken(env.COMPLETE_VIEW_TOKEN_SECRET, { reportId: row.report_id, userId: user.id, sessionId }, Math.floor(now() / 1000));
        return res.status(200).json({ viewUrl: `/api/complete-status?view=${issued.token}`, expiresIn: RJ.VIEW_TTL_SEC });
      }

      const [orders, rights, reports, goals] = await Promise.all([
        CP.selectRows(fetchImpl, guard, `complete_orders?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=status,offer,amount,created_at&order=created_at.desc`),
        CP.selectRows(fetchImpl, guard, `record_entitlements?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=right_type,status`),
        CP.selectRows(fetchImpl, guard, `complete_reports?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}` +
          '&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at,created_at&order=created_at.desc'),
        CP.selectRows(fetchImpl, guard, `record_mentor_goals?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=goal_id,goal_catalog_version,locked_at`),
      ]);
      const order = orders[0] || null;
      const report = reports[0] || null;
      const goal = goals[0] || null;
      // 取り残しの回収（マイページの状態確認の時）
      if (report && RJ.isDue(report, now())) recover(guard, report.id);
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
