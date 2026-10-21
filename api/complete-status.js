// api/complete-status.js
// 完全解析の状態確認・閲覧 URL の発行・閲覧（本人の記録だけ）。Preview だけで動く（Production は 404 not_available）。
//
//   GET  /api/complete-status?diagnosisSessionId=<uuid>   Authorization: Bearer <Supabase access token>
//        → 200 { salesOpen, order, entitlements, report, mentorGoal }
//          生成が取り残されていれば（queued・再試行時刻を過ぎた failed・lease の切れた generating）応答の後で生成を始める。
//   POST /api/complete-status   Authorization: Bearer …   { "diagnosisSessionId": "<uuid>" }
//        → 200 { viewUrl, expiresIn: 300 }   閲覧用の短時間 URL（この API の GET ?view=…）
//   POST /api/complete-status   Authorization: Bearer …   { "diagnosisSessionId": "<uuid>", "action": "regenerate" }
//        → 202 { result: 'queued' }／200 { result: 'ready' }／409 regenerate_operator_required（上限・作り直しても直らない失敗）
//          生成の最終の失敗を、同じ支払済みの注文・目標で作り直す（新しい注文・権利・請求は作らない）
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
const PS = require('../lib/purchase-state');

const API = 'complete-status';
const RIGHT_ORDER = ['active', 'suspended', 'revoked'];
const MAX_BODY_BYTES = 512;
const VIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; "
  + "frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox";

// 完全解析の最下部の「マイページを作成する」（同じタブで開くリンクだけ。CSP の sandbox で別タブ・スクリプトは使えない）
const MYPAGE_FOOTER = '<aside aria-label="マイページ" style="max-width:640px;margin:48px auto 64px;padding:20px 18px;border:1px solid #2a2440;border-radius:12px;'
  + 'text-align:center;font-family:inherit;background:rgba(20,16,36,.6)">'
  + '<p style="margin:0 0 12px;font-size:13px;line-height:1.9;color:#b9b2d6"><b style="color:#e0dcf0">購入時のメールアドレス</b>でマイページを作成（ログイン）すると、この診断記録と完全解析・解析レポートがマイページに引き継がれ、いつでも見返せます。購入した端末でなくても引き継げます。</p>'
  + '<a href="/mypage.html" style="display:inline-block;min-height:44px;line-height:44px;padding:0 18px;border-radius:8px;color:#fff;'
  + 'text-decoration:none;font-size:13px;letter-spacing:.06em;background:linear-gradient(120deg,#5b78c8 0%,#8a5fc0 50%,#c9a860 100%)">'
  + 'マイページを作成する（この購入を引き継ぎます）</a></aside>';
// レポート固有リンク・マイページの登録から開いた完全解析の最下部（complete_13）：マイページへの登録だけ（注釈は出さない）。
//   固有リンクの秘密値はこの HTML に入れない（入口のページがこのタブの sessionStorage に持つ）。印刷（PDF）には出さない
const DELIVERY_FOOTER = '<aside aria-label="このレポートについて" class="ed-delivery-footer" style="max-width:640px;margin:48px auto 64px;padding:20px 18px;'
  + 'border:1px solid #2a2440;border-radius:12px;text-align:center;font-family:inherit;background:rgba(20,16,36,.6)">'
  + '<style>@media print{.ed-delivery-footer{display:none!important}}</style>'
  + '<a href="__REGISTER_HREF__" style="display:inline-block;min-height:44px;line-height:44px;padding:0 18px;border-radius:8px;color:#fff;'
  + 'text-decoration:none;font-size:13px;letter-spacing:.06em;background:#6a52b0;border:1px solid #8a72d0">マイページに登録する</a></aside>';
// 登録先は、この閲覧 URL を開いた固有リンク（入口のページがこのタブに控えた {t, url} と、閲覧トークンで照らし合わせる）
function withDeliveryFooter(body, viewToken) {
  const html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const footer = DELIVERY_FOOTER.replace('__REGISTER_HREF__', `/report-link#register&amp;v=${encodeURIComponent(viewToken)}`);
  const i = html.lastIndexOf('</body>');
  return i < 0 ? html + footer : html.slice(0, i) + footer + html.slice(i);
}
function withMypageFooter(body) {
  const html = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const i = html.lastIndexOf('</body>');
  return i < 0 ? html + MYPAGE_FOOTER : html.slice(0, i) + MYPAGE_FOOTER + html.slice(i);
}

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
  if (!keys.every((k) => k === 'diagnosisSessionId' || k === 'action') || !CE.isUuid(obj.diagnosisSessionId)) return { ok: false };
  if (obj.action !== undefined && obj.action !== 'regenerate') return { ok: false };
  return { ok: true, sessionId: obj.diagnosisSessionId, action: obj.action || 'view' };
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

  // 納品（レポート固有リンク・マイページの登録）からの閲覧：開くたびに、納品が active・注文が paid・生成物が ready であることを確かめる
  async function deliveryViewRow(conn, t) {
    const dels = await CP.selectRows(fetchImpl, conn, `report_deliveries?id=eq.${encodeURIComponent(t.deliveryId)}&select=status,order_id,report_id,product,diagnosis_session_id`);
    const d = dels[0];
    if (!d || d.status !== 'active' || d.product !== 'complete' || d.report_id !== t.reportId || d.diagnosis_session_id !== t.sessionId) return { state: 'not_entitled' };
    const [orders, reports] = await Promise.all([
      CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(d.order_id)}&select=status`),
      CP.selectRows(fetchImpl, conn, `complete_reports?id=eq.${encodeURIComponent(t.reportId)}&select=id,status,storage_path,output_sha256,revoked_at,quarantined_at`),
    ]);
    const r = reports[0];
    if (!orders[0] || orders[0].status !== 'paid' || !r || r.status === 'revoked' || r.revoked_at || r.quarantined_at) return { state: 'not_entitled' };
    if (r.status !== 'ready' || !r.storage_path || !r.output_sha256) return { state: 'not_ready', report_id: r.id };
    return { state: 'ok', report_id: r.id, storage_path: r.storage_path, output_sha256: r.output_sha256 };
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
      // ブラウザで開き直した（再読み込み・戻る）：レポートの入口へ。入口がこのタブの固有リンクから開き直す
      if (/text\/html/.test(String((req.headers && req.headers.accept) || ''))) {
        res.setHeader('Cache-Control', 'no-store');
        // 閲覧トークンを渡す：入口のページは、このトークンで開いた固有リンク（このタブの控え）だけを開き直す
        //   固有リンクから開いた閲覧（src=link）だけ入口へ。マイページ・以前の仕組みから開いた閲覧は、マイページへ戻す
        //   入口へは閲覧トークンを ?v= で渡す（# を付けない：ブラウザは、元のアドレスの # 〔固有リンク #t=〕を引き継ぐ。
        //   アドレスをコピーして5分後に開いても、入口が固有リンクで開き直す）
        res.setHeader('Location', queryParam(req, 'src') === 'link'
          ? `/report-link?v=${encodeURIComponent(String(queryParam(req, 'view') || '').slice(0, 2048))}` : '/mypage.html');
        return res.status(302).end();
      }
      return res.status(t.reason === 'token_expired' ? 410 : 403).json({ error: t.reason === 'token_expired' ? 'view_link_expired' : 'view_link_invalid', incident_id: incident });
    }
    let row;
    try {
      if (t.deliveryId) {
        row = await deliveryViewRow(g.guard, t);
      } else {
        const rows = await CP.rpc(fetchImpl, g.guard, 'complete_report_for_view', { p_user_id: t.userId, p_diagnosis_session_id: t.sessionId });
        row = Array.isArray(rows) ? rows[0] : null;
      }
    } catch (err) {
      return failLogged(res, 503, 'service_unavailable', err.code);
    }
    if (!row || row.state !== 'ok' || row.report_id !== t.reportId || typeof row.storage_path !== 'string' || !RJ.OBJECT_KEY_RE.test(row.storage_path)) {
      const code = row && row.state === 'not_ready' ? 'report_not_ready' : (row && row.state === 'basis_inactive' ? 'basis_inactive' : 'not_entitled');
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
    // ログインなしの購入（ゲスト）で開いた時だけ、最下部にマイページの作成への導線を足す（保存した生成物は変えない。照合の後に足す）
    if (t.deliveryId && queryParam(req, 'src') === 'link') body = withDeliveryFooter(body, queryParam(req, 'view'));
    // 以前のゲスト購入の閲覧：マイページへの引き継ぎは廃止（complete_13）。最下部には何も足さない
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
    let action = 'view';
    if (req.method === 'GET') {
      sessionId = queryParam(req, 'diagnosisSessionId');
      if (!CE.isUuid(sessionId)) return fail(res, 400, 'invalid_request');
    } else {
      const parsed = parseBody(req);
      if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
      sessionId = parsed.sessionId;
      action = parsed.action;
    }

    const uid = encodeURIComponent(user.id);
    try {
      // 本人の記録だけ。同じ本人・同じ診断結果の記録は、権利の所在（target）の記録の状態・生成物を扱う（lib/purchase-state.js）
      const st = PS.computeStates(await PS.loadUserFacts((path) => CP.selectRows(fetchImpl, guard, path), user.id))[sessionId];
      if (!st) return fail(res, 404, 'record_not_found');
      const targetId = st.target.id;
      const sid = encodeURIComponent(targetId);

      if (req.method === 'POST' && action === 'regenerate') {
        // 生成の最終の失敗からの作り直し：同じ支払済みの注文・目標・生成物の行で（新しい注文・権利・請求は作らない）。
        // DB が行をロックして最終の失敗の時だけ queued に戻すので、連打・同時の依頼でも生成は1つ
        const result = await CP.rpc(fetchImpl, guard, 'complete_regenerate_report', { p_user_id: user.id, p_diagnosis_session_id: targetId });
        if (result === 'requeued' || result === 'in_progress') {
          const reports = await CP.selectRows(fetchImpl, guard, `complete_reports?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at&order=created_at.desc`);
          if (reports[0] && RJ.isDue(reports[0], now())) recover(guard, reports[0].id);
          return res.status(202).json({ result: 'queued' });
        }
        if (result === 'ready') return res.status(200).json({ result: 'ready' });
        if (result === 'limit_reached' || result === 'operator_required') return fail(res, 409, 'regenerate_operator_required');
        if (result === 'not_found') return fail(res, 404, 'report_not_found');
        return fail(res, 403, 'not_entitled');
      }

      if (req.method === 'POST') {
        // 閲覧 URL の発行：本人確認の後、毎回 DB で権利を確かめる
        if (!RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return failLogged(res, 503, 'service_unavailable', 'view_secret_missing');
        const rows = await CP.rpc(fetchImpl, guard, 'complete_report_for_view', { p_user_id: user.id, p_diagnosis_session_id: targetId });
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row || row.state === 'not_found' || row.state === 'not_entitled') return fail(res, 403, 'not_entitled');
        // ¥2,000 の根拠（解析レポートの購入）が取消・停止中：完全解析の権利は残るが今は読めない（D5）
        if (row.state === 'basis_inactive') return fail(res, 403, 'basis_inactive');
        if (row.state !== 'ok') {
          const reports = await CP.selectRows(fetchImpl, guard, `complete_reports?id=eq.${encodeURIComponent(row.report_id)}&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at`);
          if (RJ.isDue(reports[0], now())) recover(guard, reports[0].id);
          return fail(res, 409, 'report_not_ready');
        }
        const issued = RJ.issueViewToken(env.COMPLETE_VIEW_TOKEN_SECRET, { reportId: row.report_id, userId: user.id, sessionId: targetId }, Math.floor(now() / 1000));
        return res.status(200).json({ viewUrl: `/api/complete-status?view=${issued.token}`, expiresIn: RJ.VIEW_TTL_SEC });
      }

      const [orders, rights, reports, goals] = await Promise.all([
        CP.selectRows(fetchImpl, guard, `complete_orders?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=status,offer,amount,created_at&order=created_at.desc`),
        CP.selectRows(fetchImpl, guard, `record_entitlements?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=right_type,status`),
        CP.selectRows(fetchImpl, guard, `complete_reports?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}` +
          '&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at,last_error_code,manual_retries,created_at&order=created_at.desc'),
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
        // regenerate：生成の最終の失敗の時だけ available（作り直せる）／operator（お問い合わせ）
        report: report ? { status: report.status, regenerate: RJ.regenerateState(report, now()) } : null,
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
module.exports.withMypageFooter = withMypageFooter;
