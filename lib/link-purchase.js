// lib/link-purchase.js
// 新しい購入の経路（complete_13）：解析レポート ¥1,000・完全解析 ¥3,000 の2商品と、期限なしのレポート固有リンク。
//
// 方針
//   ・購入はログイン不要。誰が買ったかではなく「どの診断記録の、どの商品か」だけを決める。
//     本人の判定に、購入時メール・ログイン中のメール・Cookie の所有・ログインの有無・ログイン方法を使わない。
//   ・購入の対象は「購入対象トークン」（AES-256-GCM。中身は記録 ID と期限。URL・GA4 には記録 ID・回答・診断コードを出さない）。
//     診断結果ページは診断結果の固有リンク（result_resume_links）の秘密値から、マイページは本人の記録（または本人が登録した
//     レポートの記録）から作る。サンプルページは、このトークンを URL のフラグメントで受け取る。
//   ・Checkout の作成：商品・金額・通貨・Stripe の環境・完全解析の MENTOR 目標はサーバーが決め、注文に固定する。
//     同じ購入操作（attempt）の再送・連打は同じ注文・同じ決済画面を返す。新しい購入操作は、同じ記録・同じ商品でも再購入として受け付ける。
//     決済待ちの古い注文は閉じない（新しい購入を妨げない。後から支払われた古い決済も、別の支払済みの注文として納品する）。
//   ・注文ごとに、期限なしのレポート固有リンクの秘密値（256bit）を作る。DB にはハッシュだけ。購入したブラウザには HttpOnly の
//     Cookie（__Host-ed_rl）で渡し、購入完了ページが Cookie の秘密値から固有リンクを示す（応答の本文だけ。URL・ログに出さない）。
//   ・固有リンク（/report-link#t=<秘密値>）を開くたびに、納品が active・注文が paid であることを確かめ、短時間の閲覧 URL を発行する
//     （解析レポートは report.html の 15 分のトークン、完全解析は 5 分の閲覧 URL）。返金・異議申し立て・運営者の停止で開けない。
//   ・マイページへの登録は、固有リンクの秘密値を知っている人が、ログインして明示的に行う（購入の移転ではない。別のアカウントにも登録できる）。
//   ・応答・ログに、秘密値・注文 ID・Stripe ID・メール・診断コードを出さない。応答は Cache-Control: private, no-store。
'use strict';
const crypto = require('crypto');
const CE = require('./complete-eligibility');
const CP = require('./complete-payment');
const CA = require('./complete-apply');
const RJ = require('./complete-report-job');
const GP = require('./guest-purchase');

const API = 'link-purchase';
const COOKIE = '__Host-ed_rl';
const COOKIE_MAX_AGE_SEC = 365 * 24 * 3600;
const MAX_ENTRIES = 20;
const ENTRY_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ATTEMPT_RE = /^[A-Za-z0-9_-]{22,64}$/;
const SOURCE_RE = /^[a-z_]{1,32}$/;
const CONTEXT_TTL_SEC = 24 * 3600;
const REPORT_TOKEN_TTL_MS = 15 * 60 * 1000;
const CHECKOUT_TTL_SEC = 35 * 60;
const MAX_BODY_BYTES = 1024;
const PRODUCTS = Object.freeze({ analysis: 'analysis', complete: 'direct_complete' });
const OPS = new Set(['buy-context', 'buy-summary', 'buy', 'deliveries', 'link-open', 'link-regenerate', 'link-register',
  'my-reports', 'my-report-open', 'my-report-regenerate']);

// 決済画面（最終確認画面）の支払いボタンの上に出す文言（特商法 第12条の6：価格・提供の時期・返品の決まり）
const REFUND_TEXT = 'デジタルコンテンツのため、お客様のご都合による返品・返金はお受けしていません（重複した決済や、レポートを提供できない場合は返金します）。';
const CHECKOUT_TEXT = Object.freeze({
  analysis: '解析レポート（1,000円・税込）。お支払いの確認の後、すぐにお読みいただけます。' + REFUND_TEXT,
  direct_complete: '完全解析（3,000円・税込）。解析レポートとは別の商品で、解析レポートの本文は含まれません。お支払いの確認の後、作成が終わり次第（通常、数分）お読みいただけます。選んだ MENTOR の目標は、お支払いの後は変更できません。' + REFUND_TEXT,
});

// 支払い後の請求書（Stripe のメール・PDF）に載せる文面：レポートの固有リンク（期限なし）。
//   カスタム項目は1項目140文字まで。収まらない長さの URL（Preview の長いドメインなど）は説明だけに載せる
const INVOICE_NAMES = Object.freeze({ analysis: '解析レポート', direct_complete: '完全解析' });
function reportInvoiceData(offer, reportUrl) {
  const data = {
    description: `${INVOICE_NAMES[offer]}のURL（期限なし）\n${reportUrl}`,
    footer: 'このURLから、購入したレポートをいつでも開けます。',
  };
  if (reportUrl.length <= 140) data.custom_fields = [{ name: 'レポートのURL', value: reportUrl }];
  return data;
}

const ORDER_ERRORS = {
  complete_offer_retired: [410, 'offer_retired'],
  complete_invalid_offer: [400, 'invalid_request'],
  complete_invalid_request: [400, 'invalid_request'],
  complete_record_not_found: [404, 'record_not_found'],
  complete_not_owner: [404, 'record_not_found'],
  complete_version_not_eligible: [422, 'not_eligible'],
  complete_mentor_goal_required: [409, 'mentor_goal_required'],
  complete_idempotency_conflict: [409, 'attempt_conflict'],
  complete_onboarding_required: [403, 'onboarding_required'],
};

// ---- Cookie（この端末で購入した注文の秘密値。購入完了ページで固有リンクを示すためだけに使う。閲覧の権利の判定には使わない）
function parseCookie(req) {
  const header = req.headers && (req.headers.cookie || req.headers.Cookie);
  const out = [];
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== COOKIE) continue;
    for (const e of part.slice(i + 1).trim().split('~')) {
      const m = ENTRY_RE.exec(e);
      if (m && !out.some((x) => x.orderId === m[1])) out.push({ orderId: m[1], secret: m[2] });
    }
  }
  return out.slice(-MAX_ENTRIES);
}
function serializeCookie(entries) {
  const list = entries.slice(-MAX_ENTRIES);
  if (!list.length) return `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
  return `${COOKIE}=${list.map((e) => `${e.orderId}.${e.secret}`).join('~')}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; Secure; HttpOnly; SameSite=Lax`;
}

const newSecret = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

// ---- 購入対象トークン（記録 ID を暗号化して持つ。改ざん・期限切れは使えない）
function contextKey(env) {
  const secret = env.COMPLETE_VIEW_TOKEN_SECRET;
  if (!RJ.viewSecretOk(secret)) return null;
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.alloc(0), Buffer.from('purchase-context-v1'), 32));
}
function issueContext(env, sessionId, nowSec) {
  const key = contextKey(env);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify({ v: 1, s: sessionId, e: nowSec + CONTEXT_TTL_SEC }), 'utf8'), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url');
}
function readContext(env, token, nowSec) {
  const key = contextKey(env);
  if (!key || typeof token !== 'string' || !/^[A-Za-z0-9_-]{60,200}$/.test(token)) return null;
  const buf = Buffer.from(token, 'base64url');
  if (buf.length < 12 + 16 + 2) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const p = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8'));
    if (!p || p.v !== 1 || !CE.isUuid(p.s) || !Number.isInteger(p.e) || p.e < nowSec || p.e > nowSec + CONTEXT_TTL_SEC + 5) return null;
    return p.s;
  } catch {
    return null;
  }
}

function parseBody(req, allowed) {
  const raw = req.body;
  let obj = raw;
  let text;
  if (raw === undefined || raw === null || raw === '') { obj = {}; text = '{}'; }
  else if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    text = raw.toString('utf8');
    try { obj = JSON.parse(text); } catch { return { ok: false }; }
  } else if (typeof raw === 'object') {
    text = JSON.stringify(raw);
  } else return { ok: false };
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  if (Object.keys(obj).some((k) => !allowed.includes(k))) return { ok: false };
  return { ok: true, body: obj };
}

// 納品の状態：active（読める）／suspended（異議申し立て中・敗訴）／refunded（返金）／revoked（運営者の停止）
function deliveryState(delivery, order) {
  if (!delivery || !order) return null;
  if (delivery.status === 'revoked') return 'revoked';
  if (order.status === 'paid') return 'active';
  if (order.status === 'refunded') return 'refunded';
  if (order.status === 'disputed') return 'suspended';
  return 'revoked';
}
const productOf = (offer) => (offer === 'analysis' ? 'analysis' : 'complete');

function createLinkHandler({ env, fetchImpl, stripeFor, logger = console, waitUntil = RJ.defaultWaitUntil(), storageFactory = null, now = () => Date.now() }) {
  const fail = (res, status, code) => res.status(status).json({ error: code });
  function failLogged(res, status, code, reason) {
    const incident = CE.incidentId();
    CP.logError(logger, API, reason || code, incident);
    return res.status(status).json({ error: code, incident_id: incident });
  }
  const select = (conn, path) => CP.selectRows(fetchImpl, conn, path);
  const nowSec = () => Math.floor(now() / 1000);
  const storageFor = (conn) => (storageFactory ? storageFactory(conn) : RJ.storageClient(conn, fetchImpl));

  async function accountOf(req, res, conn, { required }) {
    const token = CP.bearerToken(req);
    if (!token) { if (required) fail(res, 401, 'not_authenticated'); return required ? undefined : null; }
    let user;
    try {
      user = await CP.authUser(fetchImpl, conn, token);
    } catch (err) {
      failLogged(res, 503, 'service_unavailable', err.code);
      return undefined;
    }
    if (!user) { if (required) { fail(res, 401, 'not_authenticated'); return undefined; } return null; }
    return user;
  }

  // ---- 記録の概要（サンプル・固有リンクの画面に出す。日付・元素・武器・国家・MIRROR だけ。回答・コード・ID は出さない）
  async function summaryOf(conn, sessionId) {
    const sid = encodeURIComponent(sessionId);
    const [sessions, results] = await Promise.all([
      select(conn, `diagnosis_sessions?id=eq.${sid}&select=completed_at`),
      select(conn, `diagnosis_results?session_id=eq.${sid}&select=diagnosis_version,item_set_version,scoring_version,translation_model_version,` +
        'character_profile_version,mirror_model_version,v2_rankings,mirror_snapshot'),
    ]);
    const s = sessions[0];
    const r = results[0];
    if (!s || !r) return null;
    const top = (list) => (Array.isArray(list) && list[0] && typeof list[0].name === 'string' ? list[0].name : null);
    const rk = r.v2_rankings && typeof r.v2_rankings === 'object' ? r.v2_rankings : {};
    const mirror = Array.isArray(r.mirror_snapshot) ? (r.mirror_snapshot.find((m) => m && m.selected) || r.mirror_snapshot[0]) : null;
    const v = CE.RC1_REQUIRED_VERSIONS;
    const rc1 = Object.keys(v).every((k) => r[k] === v[k]);
    return {
      summary: {
        diagnosedOn: CP.jstDate(s.completed_at),
        element: top(rk.element), weapon: top(rk.weapon), nation: top(rk.nation),
        mirror: mirror && typeof mirror.name === 'string' ? mirror.name : null,
      },
      eligible: { analysis: r.diagnosis_version === 'ETI-2.0', complete: rc1 },
    };
  }

  // ---- 支払いの確認（Webhook を待たずに Stripe に問い合わせて反映する。冪等）
  async function settle(conn, stripe, order) {
    if (!['created', 'checkout_open', 'expired', 'canceled'].includes(order.status)) return order.status;
    if (!CP.checkoutSessionIdOk(order.stripe_checkout_session_id, conn.stripeMode)) return order.status;
    const session = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id, { expand: ['line_items'] }));
    const meta = CP.checkoutMetadataOf(session, conn.appEnv);
    if (!session || session.livemode !== CP.livemodeOf(conn) || !meta || !meta.ok || meta.orderId !== order.id) return order.status;
    if (session.payment_status === 'paid' && session.status === 'complete') {
      const created = Number.isInteger(session.created) ? session.created : nowSec();
      const result = await CA.applyPaidSession({
        env, fetchImpl, conn, session, orderId: order.id,
        eventId: `pull_${session.id}`, eventCreatedIso: new Date(created * 1000).toISOString(),
      });
      if (result === 'applied') scheduleReportFor(conn, order.id);
      return 'paid';
    }
    if (session.status === 'expired' && ['created', 'checkout_open'].includes(order.status)) {
      await CP.rpc(fetchImpl, conn, 'complete_apply_checkout_expired', {
        p_event_id: `pull_expired_${session.id}`, p_event_created: new Date(now()).toISOString(), p_livemode: CP.livemodeOf(conn),
        p_order_id: order.id, p_checkout_session_id: session.id,
      });
      return 'expired';
    }
    return order.status;
  }
  function scheduleReportFor(conn, orderId) {
    RJ.scheduleReport(waitUntil, async () => {
      const reports = await select(conn, `complete_reports?source_order_id=eq.${encodeURIComponent(orderId)}&status=neq.revoked&select=id`);
      if (!reports[0]) return;
      await RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId: reports[0].id, logger });
    }, logger);
  }

  // ---- 納品（固有リンクの秘密値のハッシュ・または納品 ID から）と、その注文・生成物
  async function deliveryBy(conn, filter) {
    const rows = await select(conn, `report_deliveries?${filter}&select=id,order_id,diagnosis_session_id,product,report_id,status`);
    const d = rows[0];
    if (!d) return null;
    const [orders, reports] = await Promise.all([
      select(conn, `complete_orders?id=eq.${encodeURIComponent(d.order_id)}&select=id,status,offer,paid_at`),
      d.report_id ? select(conn, `complete_reports?id=eq.${encodeURIComponent(d.report_id)}` +
        '&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at,last_error_code,manual_retries,storage_path,output_sha256')
        : Promise.resolve([]),
    ]);
    const order = orders[0] || null;
    return { delivery: d, order, report: reports[0] || null, state: deliveryState(d, order) };
  }
  // 生成物の状態（完全解析だけ）。due の取り残しは、応答の後で生成を進める
  function reportState(conn, report) {
    if (!report) return null;
    if (RJ.isDue(report, now())) {
      RJ.scheduleReport(waitUntil, () => RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId: report.id, logger }), logger);
    }
    const final = report.status === 'failed' && RJ.finalFailure(report, now());
    return {
      status: report.status === 'ready' ? 'ready' : final ? 'failed' : report.status === 'revoked' ? 'revoked' : 'generating',
      regenerate: final ? RJ.regenerateState(report) : null,
    };
  }

  // 閲覧の URL（解析レポート：report.html の 15 分のトークン／完全解析：5 分の閲覧 URL）。開けない時は null
  async function openUrl(conn, found) {
    const { delivery, report } = found;
    if (found.state !== 'active') return null;
    if (delivery.product === 'analysis') {
      const secret = env.REPORT_TOKEN_SECRET;
      if (typeof secret !== 'string' || !secret) throw new CP.PaymentError('report_secret_missing', false);
      const answers = await select(conn, `diagnosis_answers?session_id=eq.${encodeURIComponent(delivery.diagnosis_session_id)}&select=encoded_answers`);
      const code = answers[0] && answers[0].encoded_answers;
      if (typeof code !== 'string' || !code) throw new CP.PaymentError('delivery_code_missing', false);
      const token = GP.signReportToken(secret, {
        exp: now() + REPORT_TOKEN_TTL_MS, env: conn.appEnv, diagnosis_version: 'ETI-2.0',
        access_mode: 'delivery', did: delivery.id, sid: delivery.diagnosis_session_id,
        enc: GP.encryptReference(secret, `v2_${code}`),
      });
      return `/report.html?token=${encodeURIComponent(token)}`;
    }
    if (!report || report.status !== 'ready' || !RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return null;
    const issued = RJ.issueViewToken(env.COMPLETE_VIEW_TOKEN_SECRET,
      { reportId: report.id, userId: null, sessionId: delivery.diagnosis_session_id, deliveryId: delivery.id }, nowSec());
    return `/api/complete-status?view=${issued.token}`;
  }

  async function describe(conn, found, { open, withContext }) {
    const out = { product: found.delivery.product, state: found.state };
    if (found.delivery.product === 'complete') out.report = reportState(conn, found.report);
    if (found.order && found.order.paid_at) out.purchasedOn = CP.jstDate(found.order.paid_at);
    const s = await summaryOf(conn, found.delivery.diagnosis_session_id);
    if (s) out.summary = s.summary;
    // 解析レポートの最下部の「完全解析を作成する」：同じ記録の購入対象トークン
    if (withContext && found.state === 'active' && s && s.eligible.complete) out.context = issueContext(env, found.delivery.diagnosis_session_id, nowSec());
    if (open) out.url = await openUrl(conn, found);
    return out;
  }

  // ---- op：購入対象トークンを作る（診断結果の固有リンク／マイページの記録）
  async function buyContext(req, res, conn) {
    const parsed = parseBody(req, ['resume', 'record']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const { resume, record } = parsed.body;
    if ((resume === undefined) === (record === undefined)) return fail(res, 400, 'invalid_request');
    let sessionId = null;
    if (resume !== undefined) {
      if (typeof resume !== 'string' || !TOKEN_RE.test(resume)) return fail(res, 400, 'invalid_request');
      const rows = await CP.rpc(fetchImpl, conn, 'complete_open_result_link', { p_token_hash: tokenHash(resume) });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || !CE.isUuid(row.diagnosis_session_id)) return fail(res, 404, 'record_not_found');
      sessionId = row.diagnosis_session_id;
    } else {
      if (!CE.isUuid(record)) return fail(res, 400, 'invalid_request');
      const user = await accountOf(req, res, conn, { required: true });
      if (!user) return undefined;
      // 本人の記録、または本人が登録したレポートの記録だけ
      const own = await select(conn, `diagnosis_sessions?id=eq.${encodeURIComponent(record)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`);
      if (!own[0]) {
        const regs = await select(conn, `account_report_registrations?user_id=eq.${encodeURIComponent(user.id)}&select=delivery_id`);
        const ids = regs.map((r) => r.delivery_id).filter(CE.isUuid);
        const mine = ids.length ? await select(conn, `report_deliveries?id=in.(${ids.join(',')})&diagnosis_session_id=eq.${encodeURIComponent(record)}&select=id`) : [];
        if (!mine[0]) return fail(res, 404, 'record_not_found');
      }
      sessionId = record;
    }
    const s = await summaryOf(conn, sessionId);
    if (!s) return fail(res, 404, 'record_not_found');
    const context = issueContext(env, sessionId, nowSec());
    if (!context) return failLogged(res, 503, 'service_unavailable', 'context_secret_missing');
    return res.status(200).json({ context, summary: s.summary, eligible: s.eligible });
  }

  async function buySummary(req, res, conn) {
    const parsed = parseBody(req, ['context']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const sessionId = readContext(env, parsed.body.context, nowSec());
    if (!sessionId) return fail(res, 410, 'context_expired');
    const s = await summaryOf(conn, sessionId);
    if (!s) return fail(res, 404, 'record_not_found');
    return res.status(200).json({ summary: s.summary, eligible: s.eligible });
  }

  // ---- op：Checkout を作る（全入口で共通。入口 source は計測だけに使い、ここでは使わない）
  async function buy(req, res, conn) {
    const parsed = parseBody(req, ['context', 'product', 'goal', 'attempt', 'source']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const { context, product, goal, attempt, source } = parsed.body;
    const offer = PRODUCTS[product];
    if (!offer || typeof attempt !== 'string' || !ATTEMPT_RE.test(attempt) || (source !== undefined && (typeof source !== 'string' || !SOURCE_RE.test(source)))) {
      return fail(res, 400, product === 'upgrade' || product === 'analysis_upgrade' ? 'offer_retired' : 'invalid_request');
    }
    if (offer === 'direct_complete' ? !CE.isMentorGoalId(goal) : goal !== undefined) return fail(res, 400, offer === 'direct_complete' ? 'mentor_goal_required' : 'invalid_request');
    if (!CP.salesOpen(env)) return fail(res, 503, 'sales_closed');
    const sessionId = readContext(env, context, nowSec());
    if (!sessionId) return fail(res, 410, 'context_expired');
    const urls = CP.checkoutReturnUrls(env, conn.appEnv, 'guest');
    const priceId = CP.priceIdFor(env, offer);
    if (!urls || !priceId) return failLogged(res, 503, 'service_unavailable', 'checkout_config_missing');
    const stripe = stripeFor();
    const entries = parseCookie(req);
    const secret = newSecret();
    let order;
    try {
      const rows = await CP.rpc(fetchImpl, conn, 'complete_create_link_order', {
        p_diagnosis_session_id: sessionId, p_offer: offer, p_idempotency_key: `lk_${attempt}`,
        p_link_token_hash: tokenHash(secret), p_goal_id: offer === 'direct_complete' ? goal : null,
      });
      order = Array.isArray(rows) ? rows[0] : null;
    } catch (err) {
      const mapped = err instanceof CP.PaymentError ? ORDER_ERRORS[err.code] : null;
      if (mapped) return fail(res, mapped[0], mapped[1]);
      throw err;
    }
    if (!order || !CE.isUuid(order.order_id)) return failLogged(res, 500, 'checkout_failed', 'order_invalid');
    // 同じ購入操作の再送：この端末の Cookie に注文の秘密値がある時だけ、同じ決済画面を返す
    if (!order.created) {
      const mine = entries.find((e) => e.orderId === order.order_id);
      if (!mine) return fail(res, 409, 'attempt_reused');
      if (order.order_status === 'paid' || order.order_status === 'disputed' || order.order_status === 'refunded') return fail(res, 409, 'purchase_completed');
      if (order.order_status === 'checkout_open' && CP.checkoutSessionIdOk(order.checkout_session_id, conn.stripeMode)) {
        const s = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.checkout_session_id));
        if (s && s.status === 'open' && CP.isStripeCheckoutUrl(s.url)) return res.status(200).json({ checkoutUrl: s.url });
        if (s && s.status === 'complete') return fail(res, 409, 'purchase_completed');
        return fail(res, 409, 'attempt_expired');
      }
      if (order.order_status !== 'created') return fail(res, 409, 'attempt_expired');
    }
    const price = await CP.stripeCall(() => stripe.prices.retrieve(priceId));
    const problem = CP.priceProblem(price, offer, conn.stripeMode);
    if (problem) {
      await CP.rpc(fetchImpl, conn, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'price_invalid' });
      return failLogged(res, 503, 'service_unavailable', problem);
    }
    const reportUrl = `${new URL(urls.successUrl).origin}/report-link#t=${secret}`;
    let session;
    try {
      session = await CP.stripeCall(() => stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        // 戻り先は、購入したレポートの固有リンクそのもの（中継のページを通さない。秘密値はフラグメントでサーバーへ送られない）
        success_url: reportUrl,
        cancel_url: urls.cancelUrl,
        locale: 'ja',
        expires_at: nowSec() + CHECKOUT_TTL_SEC,
        custom_text: { submit: { message: CHECKOUT_TEXT[offer] } },
        // 支払い後の請求書（Stripe が購入者へメールで送る）に、レポートの固有リンクを載せる（自前のメール送信はしない）
        invoice_creation: { enabled: true, invoice_data: reportInvoiceData(offer, reportUrl) },
        metadata: { order_id: order.order_id, app: CP.APP, env: conn.appEnv },
      }, { idempotencyKey: CP.stripeIdempotencyKey(order.order_id) }));
    } catch (err) {
      if (!err.transient) {
        await CP.rpc(fetchImpl, conn, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'stripe_error' });
      }
      throw err;
    }
    const meta = CP.checkoutMetadataOf(session, conn.appEnv);
    if (!session || !CP.checkoutSessionIdOk(session.id, conn.stripeMode) || session.livemode !== CP.livemodeOf(conn) || !meta || !meta.ok
        || meta.orderId !== order.order_id || !CP.isStripeCheckoutUrl(session.url) || !Number.isInteger(session.expires_at)) {
      return failLogged(res, 500, 'checkout_failed', 'checkout_session_invalid');
    }
    await CP.rpc(fetchImpl, conn, 'complete_mark_checkout_open', {
      p_order_id: order.order_id, p_checkout_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    });
    if (order.created) {
      const kept = entries.filter((e) => e.orderId !== order.order_id).concat([{ orderId: order.order_id, secret }]);
      res.setHeader('Set-Cookie', serializeCookie(kept));
    }
    return res.status(200).json({ checkoutUrl: session.url });
  }

  // ---- op：この端末で購入したレポート（購入完了ページ）。支払い済みなら固有リンクを返す
  async function deliveries(req, res, conn) {
    const parsed = parseBody(req, ['session']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    // 今戻ってきた決済（Checkout Session の ID）。この端末の Cookie の注文と一致した時だけ current を付ける
    const session = parsed.body.session;
    if (session !== undefined && (typeof session !== 'string' || !CP.checkoutSessionIdOk(session, conn.stripeMode))) return fail(res, 400, 'invalid_request');
    const entries = parseCookie(req);
    if (!entries.length) return res.status(200).json({ purchases: [] });
    const ids = entries.map((e) => e.orderId);
    const orders = await select(conn, `complete_orders?id=in.(${ids.join(',')})&buyer=eq.link` +
      '&select=id,status,offer,claim_secret_hash,stripe_checkout_session_id,created_at,paid_at');
    const stripe = stripeFor();
    const out = [];
    for (const o of orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
      const entry = entries.find((e) => e.orderId === o.id);
      // Cookie の秘密値と注文の秘密値のハッシュが一致する時だけ（改ざんした Cookie では何も返さない）
      if (!entry || tokenHash(entry.secret) !== o.claim_secret_hash) continue;
      let status = o.status;
      try { status = await settle(conn, stripe, o); } catch (err) { if (!err.transient) throw err; }
      const item = { ref: GP.refOf(env, o.id), product: productOf(o.offer), createdAt: o.created_at };
      const current = !!session && o.stripe_checkout_session_id === session;
      if (current) item.current = true;
      // 今の購入は、支払いの確認の前でもリンクを返す（入口のページが支払いの確認・作成の状態を示す）
      if (status === 'created' || status === 'checkout_open') { item.state = 'pending'; if (current) item.link = entry.secret; }
      else if (status === 'expired' || status === 'canceled' || status === 'failed') item.state = 'closed';
      else {
        const found = await deliveryBy(conn, `order_id=eq.${encodeURIComponent(o.id)}`);
        if (!found) { item.state = 'pending'; if (current) item.link = entry.secret; out.push(item); continue; }
        item.state = found.state;
        if (found.order && found.order.paid_at) item.purchasedOn = CP.jstDate(found.order.paid_at);
        if (found.delivery.product === 'complete') item.report = reportState(conn, found.report);
        // 固有リンクは、納品の秘密値が Cookie の秘密値のままの時だけ（運営者が再発行した後は古い秘密値を示さない）
        const sameLink = await select(conn, `report_deliveries?id=eq.${encodeURIComponent(found.delivery.id)}&link_token_hash=eq.${tokenHash(entry.secret)}&select=id`);
        if (found.state === 'active' && sameLink[0]) item.link = entry.secret;
      }
      out.push(item);
    }
    return res.status(200).json({ purchases: out });
  }

  // ---- op：固有リンクを開く（開くたびに有効性を確かめる）
  async function linkFound(conn, token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return { error: [400, 'invalid_request'] };
    const hash = tokenHash(token);
    let found = await deliveryBy(conn, `link_token_hash=eq.${hash}`);
    if (!found) {
      // 支払い直後（Webhook の前）：この秘密値の注文が支払い待ちなら、Stripe に確かめて反映する
      const orders = await select(conn, `complete_orders?claim_secret_hash=eq.${hash}&buyer=eq.link&select=id,status,offer,claim_secret_hash,stripe_checkout_session_id,created_at`);
      const o = orders[0];
      if (!o) return { error: [404, 'link_not_found'] };
      // 納品済みの注文（運営者が固有リンクを再発行した後の古い秘密値）：開けない
      const delivered = await select(conn, `report_deliveries?order_id=eq.${encodeURIComponent(o.id)}&select=id`);
      if (delivered[0]) return { error: [404, 'link_not_found'] };
      let status = o.status;
      try { status = await settle(conn, stripeFor(), o); } catch (err) { if (!err.transient) throw err; }
      if (status !== 'paid') return { pending: { product: productOf(o.offer), state: ['created', 'checkout_open'].includes(status) ? 'pending' : 'closed' } };
      found = await deliveryBy(conn, `link_token_hash=eq.${hash}`);
      if (!found) return { pending: { product: productOf(o.offer), state: 'pending' } };
    }
    return { found };
  }
  async function linkOpen(req, res, conn) {
    const parsed = parseBody(req, ['token', 'open']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const r = await linkFound(conn, parsed.body.token);
    if (r.error) return fail(res, r.error[0], r.error[1]);
    if (r.pending) return res.status(200).json(r.pending);
    return res.status(200).json(await describe(conn, r.found, { open: parsed.body.open === true, withContext: true }));
  }
  async function regenerate(res, conn, found) {
    if (found.state !== 'active' || found.delivery.product !== 'complete' || !found.report) return fail(res, 403, 'not_entitled');
    const result = await CP.rpc(fetchImpl, conn, 'complete_regenerate_link_report', { p_report_id: found.report.id });
    if (result === 'requeued' || result === 'in_progress') {
      RJ.scheduleReport(waitUntil, () => RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId: found.report.id, logger }), logger);
      return res.status(200).json({ result: result === 'requeued' ? 'requeued' : 'in_progress' });
    }
    if (result === 'ready') return res.status(200).json({ result: 'ready' });
    if (result === 'limit_reached' || result === 'operator_required') return fail(res, 409, 'regenerate_operator_required');
    return fail(res, 403, 'not_entitled');
  }
  async function linkRegenerate(req, res, conn) {
    const parsed = parseBody(req, ['token']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const r = await linkFound(conn, parsed.body.token);
    if (r.error) return fail(res, r.error[0], r.error[1]);
    if (r.pending) return fail(res, 409, 'payment_pending');
    return regenerate(res, conn, r.found);
  }

  // ---- op：マイページへの登録（ログイン必須。購入の移転ではない。同じリンクを別のアカウントにも登録できる）
  async function linkRegister(req, res, conn) {
    const parsed = parseBody(req, ['token']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const user = await accountOf(req, res, conn, { required: true });
    if (!user) return undefined;
    const r = await linkFound(conn, parsed.body.token);
    if (r.error) return fail(res, r.error[0], r.error[1]);
    if (r.pending) return fail(res, 409, 'payment_pending');
    let rows;
    try {
      rows = await CP.rpc(fetchImpl, conn, 'complete_register_delivery', { p_user_id: user.id, p_link_token_hash: tokenHash(parsed.body.token) });
    } catch (err) {
      const mapped = err instanceof CP.PaymentError ? ORDER_ERRORS[err.code] : null;
      if (mapped) return fail(res, mapped[0], mapped[1]);
      throw err;
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    const result = row && row.reg_result;
    if (result === 'registered' || result === 'already') return res.status(200).json({ result, product: r.found.delivery.product });
    if (result === 'inactive') return fail(res, 403, 'link_inactive');
    return fail(res, 404, 'link_not_found');
  }

  // ---- op：マイページ（本人が登録したレポートと、本人の記録でない登録の記録）
  async function myReports(req, res, conn) {
    const parsed = parseBody(req, []);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request');
    const user = await accountOf(req, res, conn, { required: true });
    if (!user) return undefined;
    const regs = await select(conn, `account_report_registrations?user_id=eq.${encodeURIComponent(user.id)}&select=delivery_id,registered_at`);
    const ids = regs.map((r) => r.delivery_id).filter(CE.isUuid);
    if (!ids.length) return res.status(200).json({ reports: [], records: [] });
    const dels = await select(conn, `report_deliveries?id=in.(${ids.join(',')})&select=id,order_id,diagnosis_session_id,product,report_id,status`);
    const orderIds = dels.map((d) => d.order_id);
    const reportIds = dels.map((d) => d.report_id).filter(CE.isUuid);
    const sids = [...new Set(dels.map((d) => d.diagnosis_session_id))];
    const [orders, reports, sessions] = await Promise.all([
      select(conn, `complete_orders?id=in.(${orderIds.join(',')})&select=id,status,offer,paid_at`),
      reportIds.length ? select(conn, `complete_reports?id=in.(${reportIds.join(',')})&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at,last_error_code,manual_retries`) : Promise.resolve([]),
      select(conn, `diagnosis_sessions?id=in.(${sids.join(',')})&select=id,user_id,completed_at,diagnosis_type,diagnosis_version,item_set_version`),
    ]);
    const reportsOut = dels.map((d) => {
      const order = orders.find((o) => o.id === d.order_id);
      const item = {
        delivery: d.id, record: d.diagnosis_session_id, product: d.product, state: deliveryState(d, order),
        registeredAt: (regs.find((r) => r.delivery_id === d.id) || {}).registered_at || null,
        purchasedOn: order && order.paid_at ? CP.jstDate(order.paid_at) : null,
      };
      if (d.product === 'complete') item.report = reportState(conn, reports.find((r) => r.id === d.report_id) || null);
      return item;
    });
    // 本人の記録でない（購入したゲストの記録・別の人の記録）：マイページの記録と同じ形で返す（回答・結果の保存値）
    const foreign = sessions.filter((s) => s.user_id !== user.id);
    let records = [];
    if (foreign.length) {
      const fl = foreign.map((s) => s.id).join(',');
      const [results, answers] = await Promise.all([
        select(conn, `diagnosis_results?session_id=in.(${fl})&select=session_id,primary_result,scores,character_matches,diagnosis_code,item_set_version,` +
          'scoring_version,translation_model_version,character_profile_version,mirror_model_version,v2_scores,v2_rankings,mirror_snapshot'),
        select(conn, `diagnosis_answers?session_id=in.(${fl})&select=session_id,encoded_answers`),
      ]);
      records = foreign.map((s) => ({
        id: s.id, completed_at: s.completed_at, diagnosis_type: s.diagnosis_type, diagnosis_version: s.diagnosis_version,
        item_set_version: s.item_set_version,
        diagnosis_results: results.filter((r) => r.session_id === s.id).map(({ session_id, ...rest }) => rest),
        diagnosis_answers: answers.filter((a) => a.session_id === s.id).map(({ session_id, ...rest }) => rest),
      }));
    }
    return res.status(200).json({ reports: reportsOut, records });
  }
  async function myFound(req, res, conn, allowed) {
    const parsed = parseBody(req, allowed);
    if (!parsed.ok) { fail(res, parsed.tooLarge ? 413 : 400, 'invalid_request'); return null; }
    if (!CE.isUuid(parsed.body.delivery)) { fail(res, 400, 'invalid_request'); return null; }
    const user = await accountOf(req, res, conn, { required: true });
    if (!user) return null;
    const regs = await select(conn, `account_report_registrations?user_id=eq.${encodeURIComponent(user.id)}&delivery_id=eq.${encodeURIComponent(parsed.body.delivery)}&select=delivery_id`);
    if (!regs[0]) { fail(res, 404, 'not_registered'); return null; }
    const found = await deliveryBy(conn, `id=eq.${encodeURIComponent(parsed.body.delivery)}`);
    if (!found) { fail(res, 404, 'not_registered'); return null; }
    return { found, body: parsed.body };
  }
  async function myReportOpen(req, res, conn) {
    const r = await myFound(req, res, conn, ['delivery']);
    if (!r) return undefined;
    return res.status(200).json(await describe(conn, r.found, { open: true, withContext: false }));
  }
  async function myReportRegenerate(req, res, conn) {
    const r = await myFound(req, res, conn, ['delivery']);
    if (!r) return undefined;
    return regenerate(res, conn, r.found);
  }

  const HANDLERS = {
    'buy-context': buyContext, 'buy-summary': buySummary, buy, deliveries,
    'link-open': linkOpen, 'link-regenerate': linkRegenerate, 'link-register': linkRegister,
    'my-reports': myReports, 'my-report-open': myReportOpen, 'my-report-regenerate': myReportRegenerate,
  };
  return async function handle(op, req, res, conn) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const h = HANDLERS[op];
    if (!h) return fail(res, 404, 'not_found');
    try {
      return await h(req, res, conn);
    } catch (err) {
      const code = err instanceof CP.PaymentError ? err.code : 'internal_error';
      return failLogged(res, err && err.transient ? 503 : 500, err && err.transient ? 'service_unavailable' : 'internal_error', code);
    }
  };
}

module.exports = {
  COOKIE, MAX_ENTRIES, OPS, PRODUCTS, CONTEXT_TTL_SEC,
  createLinkHandler, parseCookie, serializeCookie, tokenHash, issueContext, readContext, deliveryState,
};
