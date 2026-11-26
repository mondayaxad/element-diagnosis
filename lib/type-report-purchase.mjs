// lib/type-report-purchase.mjs
// 元素診断のタイプ別レポート（¥1,000・買い切り・35タイプ共通の読み物）の購入・固有リンクの閲覧と、Stripe Webhook の反映（2026-11-25・Preview）。
//   POST /api/type-report?op=buy | link-open   （api/type-report.mjs）
//
// 方針（邪眼診断の lib/jagan-purchase.mjs と同じ考え方）
//   ・購入はログイン不要。対象は「どのタイプ（元素×武器種。例：PYSW）か」。注文に、サーバーが決めた標準の回答の符号
//     （lib/type-standard-answers.json）を固定する。ブラウザが送るのはタイプコードと購入操作の ID だけ（金額・商品・符号は送らない）。
//   ・金額・通貨・商品はサーバーが決める（¥1,000・JPY・一回払い。支払い方法はカードと PayPay）。Stripe の Price は環境変数
//     STRIPE_PRICE_TYPE_REPORT を Stripe から取得して照合する。本番は Price が必須、Preview だけ未設定なら price_data。
//     metadata.app は 'element-diagnosis-type'（解析レポート・邪眼の Webhook と分ける）。
//   ・固有リンクの秘密値（256bit）は、注文の冪等キーとサーバーの鍵（COMPLETE_VIEW_TOKEN_SECRET から HKDF で別の用途の鍵を作る）
//     から決まる（同じ購入操作の再送は同じ秘密値・同じ決済画面）。DB にはハッシュだけ。決済の戻り先は固有リンク（/type-report#t=<秘密値>）。
//   ・固有リンクを開くたびに、注文が支払い済み・リンクが有効であることを確かめ、レポート（report.html）を開く 15 分の閲覧トークンを発行する。
//     Webhook がまだなら Stripe に問い合わせて反映する。
//   ・販売：TYPE_REPORT_SALES_OPEN=true のときだけ申し込める（Preview・本番とも。本番は別途の承認の後に設定する）。
//     閲覧・Webhook は販売を閉じていても動く（購入済みのレポートは読める・返金を反映する）。
//   ・応答・ログに、秘密値・注文 ID・Stripe ID・メール・符号を出さない。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import serverEnv from './server-env.js';

const require = createRequire(import.meta.url);
const GR = require('./ga-ref.js');
const CP = require('./complete-payment.js');
const GP = require('./guest-purchase.js');
const { requireServerEnv, requestHost, logEnvDenied } = serverEnv;

export const APP = 'element-diagnosis-type';
export const PRODUCT_KEY = 'eti_type_report_v1';
export const AMOUNT = 1000;
export const PRICE_ENV = 'STRIPE_PRICE_TYPE_REPORT';
export const PRODUCT_NAME = 'タイプ別レポート';
export const LINK_PATH = '/type-report';
export const OPS = new Set(['buy', 'link-open']);
export const PAYMENT_METHODS = ['card', 'paypay'];
const STANDARD = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'type-standard-answers.json'), 'utf8'));
export const TYPE_RE = /^(PY|HY|CR|EL|AN|GE|DE)(SW|CM|PL|CT|BW)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ATTEMPT_RE = /^[A-Za-z0-9_-]{22,64}$/;
const SOURCE_RE = /^[a-z_]{1,32}$/;
const MAX_BODY_BYTES = 2 * 1024;
const ORDERS_PER_HOUR = 60; // 同じタイプの直近1時間の新しい注文の上限（35タイプ共通の商品のため、記録ごとより多め）
const REPORT_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFUND_TEXT = 'デジタルコンテンツの性質上、提供開始後のお客様都合による返品・キャンセル・返金は原則として受け付けません。ただし、二重決済、正常に提供できない場合、契約内容との不一致、法令上必要な場合は、状況を確認して個別に対応します。';
export function checkoutText(origin, typeName) {
  return `タイプ別レポート「${typeName}」（1,000円・税込）。同じタイプの方に共通の読み物で、あなた自身の回答から作る「解析レポート」とは別の商品です。`
    + 'お支払いはクレジットカードで、ご注文の確定時です。お支払いの確認の後、すぐにお読みいただけます。'
    + 'お支払い後に表示される固有のリンク（URL）を必ず保存してください。リンク自体に通常の有効期限はありません。'
    + `${REFUND_TEXT}特定商取引法に基づく表記：${origin}/tokushoho　利用規約：${origin}/terms.html`;
}

// ---- 純粋な処理（テストで直接使う）
export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function standardOf(typeCode) {
  if (!TYPE_RE.test(String(typeCode || ''))) return null;
  const t = STANDARD.types[typeCode];
  return t ? { typeCode, itemSetVersion: STANDARD.item_set_version, diagnosisCode: t.diagnosis_code, element: t.element, weapon: t.weapon, nation: t.nation, name: t.name } : null;
}
export function linkKey(env) {
  const raw = env.COMPLETE_VIEW_TOKEN_SECRET;
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43,}$/.test(raw)) return null;
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(raw, 'base64url'), Buffer.alloc(0), Buffer.from('type-report-link-v1'), 32));
}
export const idempotencyKeyOf = (typeCode, attempt) => 'to_' + sha256hex(`${typeCode}|${attempt}`).slice(0, 40);
export const linkSecretOf = (key, idempotencyKey) => crypto.createHmac('sha256', key).update(`link|${idempotencyKey}`).digest('base64url');
export function salesOpen(env, appEnv) {
  return env.TYPE_REPORT_SALES_OPEN === 'true' && (appEnv === 'preview' || appEnv === 'production');
}
export function checkoutOrigin(env, appEnv) {
  const origin = CP.strictHttpsOrigin(env.COMPLETE_CHECKOUT_ORIGIN);
  const allowed = appEnv === 'production' ? CP.PRODUCTION_CHECKOUT_ORIGINS : appEnv === 'preview' ? CP.PREVIEW_CHECKOUT_ORIGINS : [];
  return origin && allowed.includes(origin) ? origin : null;
}
export function metadataOf(session, appEnv) {
  const m = session && session.metadata;
  if (!m || typeof m !== 'object' || m.app !== APP) return null;
  if (Object.keys(m).sort().join(',') !== 'app,env,order_id' || m.env !== appEnv || !UUID_RE.test(m.order_id)) return { ok: false };
  return { ok: true, orderId: m.order_id };
}
function priceProblem(price, mode) {
  if (!price || typeof price !== 'object') return 'price_missing';
  if (price.active !== true) return 'price_inactive';
  if (price.livemode !== (mode === 'live')) return 'price_livemode';
  if (price.currency !== 'jpy') return 'price_currency';
  if (price.unit_amount !== AMOUNT) return 'price_amount';
  if (price.type && price.type !== 'one_time') return 'price_type';
  return null;
}
// レポート（report.html）を開く閲覧トークン。診断コードは暗号化して持つ（既存の解析レポートと同じ形式・鍵）
export function reportTokenOf(secret, order, appEnv, nowMs) {
  return GP.signReportToken(secret, {
    exp: nowMs + REPORT_TOKEN_TTL_MS, env: appEnv, diagnosis_version: 'ETI-2.0',
    access_mode: 'type_report', oid: order.id, t: order.type_code,
    enc: GP.encryptReference(secret, `v2_${order.diagnosis_code}`),
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let text;
  if (typeof req.body === 'string') text = req.body;
  else if (Buffer.isBuffer(req.body)) text = req.body.toString('utf8');
  else if (req.body && typeof req.body === 'object') text = JSON.stringify(req.body);
  else {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY_BYTES) return { tooLarge: true }; chunks.push(c); }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text || '', 'utf8') > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    const v = JSON.parse(text || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v } : { bad: true };
  } catch { return { bad: true }; }
}
const only = (body, allowed) => Object.keys(body).every((k) => allowed.includes(k));
function crossSite(req) {
  const h = req.headers || {};
  const type = String(h['content-type'] || '');
  if (type && !/^application\/json\b/i.test(type)) return true;
  if (String(h['sec-fetch-site'] || '') === 'cross-site') return true;
  const origin = h.origin;
  if (origin === 'null') return true;
  if (origin) { try { if (new URL(origin).host !== requestHost(req)) return true; } catch { return true; } }
  return false;
}
function logError(logger, code) { const id = crypto.randomBytes(6).toString('hex'); try { logger.error(`[type-report] ${code} incident=${id}`); } catch { /* noop */ } return id; }

// DB の関数（RPC）。type_report_ で始まる例外は、その名前を code にして投げる（一時的な失敗ではない）
export async function rpc(fetchImpl, conn, fn, args) {
  let res;
  try {
    res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: Object.assign({}, conn.adminHeaders(), { 'Content-Type': 'application/json' }), body: JSON.stringify(args),
    });
  } catch {
    throw new CP.PaymentError('db_unavailable', true);
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (res.ok) return body;
  const msg = body && typeof body.message === 'string' ? body.message : '';
  if (/^type_report_[a-z_]+$/.test(msg)) throw new CP.PaymentError(msg, false);
  throw new CP.PaymentError('db_error', true);
}
async function orderByHash(fetchImpl, conn, hash) {
  const rows = await CP.selectRows(fetchImpl, conn, `type_report_orders?link_token_hash=eq.${hash}&select=id,type_code,diagnosis_code,status,link_status,stripe_checkout_session_id,stripe_mode,paid_at`);
  return rows[0] || null;
}

// Stripe の決済画面を取り直し、支払い済みなら反映する（Webhook がまだの時。何度呼んでも同じ結果）
export async function settleFromStripe({ fetchImpl, conn, stripe, order }) {
  if (!order || !['created', 'checkout_open'].includes(order.status) || !CP.checkoutSessionIdOk(order.stripe_checkout_session_id, conn.stripeMode)) return order && order.status;
  const s = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id));
  const meta = metadataOf(s, conn.appEnv);
  if (!s || !meta || !meta.ok || meta.orderId !== order.id || s.livemode !== CP.livemodeOf(conn)) return order.status;
  if (s.status === 'complete' && s.payment_status === 'paid') {
    const r = await rpc(fetchImpl, conn, 'type_report_apply_payment', {
      p_order_id: order.id, p_checkout_session_id: s.id, p_payment_intent_id: CP.idOf(s.payment_intent),
      p_amount_total: s.amount_total, p_currency: s.currency, p_payment_status: s.payment_status, p_livemode: s.livemode,
    });
    return r === 'applied' || r === 'noop' ? 'paid' : order.status;
  }
  if (s.status === 'expired') {
    await rpc(fetchImpl, conn, 'type_report_close_order', { p_order_id: order.id, p_status: 'expired', p_failure_code: 'checkout_expired' });
    return 'expired';
  }
  return order.status;
}

export function createPurchaseHandler({ env, fetchImpl, stripeFactory, logger = console, now = () => Date.now() }) {
  let stripe = null;
  const stripeOf = () => (stripe || (stripe = stripeFactory(env.STRIPE_SECRET_KEY)));
  const priceCache = new Map();
  async function priceOk(conn) {
    const id = env[PRICE_ENV];
    // 本番は Stripe の Price（Live）を必ず使う。Preview だけ、Price が無ければ金額を直接指定（price_data）
    if (!id) return conn.appEnv === 'production' ? 'price_id_missing' : null;
    if (!/^price_[A-Za-z0-9_]{8,200}$/.test(id)) return 'price_id_invalid';
    const hit = priceCache.get(id);
    if (hit && now() - hit < 10 * 60 * 1000) return null;
    const p = await CP.stripeCall(() => stripeOf().prices.retrieve(id));
    const problem = priceProblem(p, conn.stripeMode);
    if (!problem) priceCache.set(id, now());
    return problem;
  }
  // 決済画面の作成：カードと PayPay。Stripe が PayPay 付きの作成を拒んだ時は、カードだけで1回だけ作り直す
  let cardOnlyUntil = 0;
  async function createCheckoutSession(params, idempotencyKey) {
    const cardOnly = () => CP.stripeCall(() => stripeOf().checkout.sessions.create({ ...params, payment_method_types: ['card'] }, { idempotencyKey: `${idempotencyKey}_c` }));
    if (cardOnlyUntil > now()) return cardOnly();
    try {
      return await CP.stripeCall(() => stripeOf().checkout.sessions.create({ ...params, payment_method_types: PAYMENT_METHODS }, { idempotencyKey }));
    } catch (err) {
      if (!(err && err.code === 'stripe_rejected' && !err.transient)) throw err;
      cardOnlyUntil = now() + 10 * 60 * 1000;
      return cardOnly();
    }
  }

  async function buy(req, res, conn, body) {
    if (!only(body, ['type', 'attempt', 'source', 'ga'])) return send(res, 400, { error: 'invalid_request' });
    const gaRef = GR.valid(body.ga) ? body.ga : null;
    const std = standardOf(body.type);
    if (!std || !ATTEMPT_RE.test(String(body.attempt || '')) || (body.source !== undefined && !SOURCE_RE.test(String(body.source)))) {
      return send(res, 400, { error: 'invalid_request' });
    }
    if (!salesOpen(env, conn.appEnv)) return send(res, 503, { error: 'sales_closed' });
    const origin = checkoutOrigin(env, conn.appEnv);
    const key = linkKey(env);
    if (!origin || !key) return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, 'checkout_config_missing') });
    const priceP = priceOk(conn);
    priceP.catch(() => {});
    const problem = await priceP;
    if (problem) return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, problem) });
    const idem = idempotencyKeyOf(std.typeCode, body.attempt);
    const secret = linkSecretOf(key, idem);
    let order;
    try {
      const rows = await rpc(fetchImpl, conn, 'type_report_create_order', {
        p_type_code: std.typeCode, p_item_set_version: std.itemSetVersion, p_diagnosis_code: std.diagnosisCode,
        p_stripe_mode: conn.stripeMode, p_idempotency_key: idem, p_link_token_hash: sha256hex(secret),
      });
      order = Array.isArray(rows) ? rows[0] : null;
    } catch (err) {
      if (err && err.code === 'type_report_idempotency_conflict') return send(res, 409, { error: 'attempt_conflict' });
      throw err;
    }
    if (!order || !UUID_RE.test(order.order_id)) return send(res, 500, { error: 'checkout_failed', incident_id: logError(logger, 'order_invalid') });
    if (order.created) {
      // 決済画面の作りすぎを防ぐ（同じタイプで直近1時間の新しい注文の数に上限。再送は数えない）
      const since = new Date(now() - 3600 * 1000).toISOString();
      const recent = await CP.selectRows(fetchImpl, conn, `type_report_orders?type_code=eq.${std.typeCode}&created_at=gt.${encodeURIComponent(since)}&select=id&limit=${ORDERS_PER_HOUR + 1}`);
      if (recent.length > ORDERS_PER_HOUR) {
        await rpc(fetchImpl, conn, 'type_report_close_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'rate_limited' });
        return send(res, 429, { error: 'too_many_attempts' });
      }
    } else {
      if (['paid', 'refunded', 'disputed'].includes(order.order_status)) return send(res, 409, { error: 'purchase_completed' });
      if (order.order_status === 'checkout_open' && CP.checkoutSessionIdOk(order.checkout_session_id, conn.stripeMode)) {
        const s = await CP.stripeCall(() => stripeOf().checkout.sessions.retrieve(order.checkout_session_id));
        if (s && s.status === 'open' && CP.isStripeCheckoutUrl(s.url)) return send(res, 200, { checkoutUrl: s.url, amount: AMOUNT });
        if (s && s.status === 'complete') return send(res, 409, { error: 'purchase_completed' });
        return send(res, 409, { error: 'attempt_expired' });
      }
      if (order.order_status !== 'created') return send(res, 409, { error: 'attempt_expired' });
    }
    const createdRows = order.created ? [] : await CP.selectRows(fetchImpl, conn, `type_report_orders?id=eq.${order.order_id}&select=created_at`);
    const expiresAt = (createdRows[0] && CP.checkoutExpiresAt(createdRows[0].created_at)) || Math.floor(now() / 1000) + CP.CHECKOUT_LIFETIME_SEC;
    const lineItem = env[PRICE_ENV]
      ? { price: env[PRICE_ENV], quantity: 1 }
      : { price_data: { currency: 'jpy', unit_amount: AMOUNT, product_data: { name: PRODUCT_NAME } }, quantity: 1 };
    let session;
    try {
      session = await createCheckoutSession({
        mode: 'payment',
        line_items: [lineItem],
        // 戻り先は、購入したレポートの固有リンクそのもの（秘密値はフラグメント。サーバーへ送られない）
        success_url: `${origin}${LINK_PATH}#t=${secret}`,
        cancel_url: `${origin}/type/${std.typeCode.toLowerCase()}?checkout=canceled`,
        locale: 'ja',
        expires_at: expiresAt,
        custom_text: { submit: { message: checkoutText(origin, std.name) } },
        metadata: { order_id: order.order_id, app: APP, env: conn.appEnv },
        ...(gaRef ? { client_reference_id: gaRef } : {}),
      }, `type-report-checkout-${order.order_id}`);
    } catch (err) {
      if (!err.transient) await rpc(fetchImpl, conn, 'type_report_close_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'stripe_error' });
      throw err;
    }
    const meta = metadataOf(session, conn.appEnv);
    if (!session || !CP.checkoutSessionIdOk(session.id, conn.stripeMode) || session.livemode !== CP.livemodeOf(conn) || !meta || !meta.ok
        || meta.orderId !== order.order_id || !CP.isStripeCheckoutUrl(session.url)) {
      return send(res, 500, { error: 'checkout_failed', incident_id: logError(logger, 'checkout_session_invalid') });
    }
    if (session.amount_total !== AMOUNT || session.currency !== 'jpy') {
      try { await CP.stripeCall(() => stripeOf().checkout.sessions.expire(session.id)); } catch { /* 期限切れで閉じる */ }
      await rpc(fetchImpl, conn, 'type_report_close_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'amount_mismatch' });
      return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, 'checkout_amount_mismatch') });
    }
    await rpc(fetchImpl, conn, 'type_report_mark_checkout_open', { p_order_id: order.order_id, p_checkout_session_id: session.id });
    return send(res, 200, { checkoutUrl: session.url, amount: AMOUNT });
  }

  async function linkOpen(req, res, conn, body) {
    if (!only(body, ['token']) || !TOKEN_RE.test(String(body.token || ''))) return send(res, 400, { error: 'invalid_request' });
    let o = await orderByHash(fetchImpl, conn, sha256hex(body.token));
    if (!o) return send(res, 404, { error: 'link_not_found' });
    if (o.status === 'created' || o.status === 'checkout_open') {
      const st = await settleFromStripe({ fetchImpl, conn, stripe: stripeOf(), order: o });
      if (st === 'paid') o = await orderByHash(fetchImpl, conn, sha256hex(body.token));
    }
    if (o.status === 'paid' && o.link_status === 'active') {
      const secret = env.REPORT_TOKEN_SECRET;
      if (typeof secret !== 'string' || !secret) return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, 'report_secret_missing') });
      const std = standardOf(o.type_code);
      return send(res, 200, {
        ok: true, state: 'paid', type: o.type_code, typeName: std ? std.name : null,
        purchasedOn: CP.jstDate(o.paid_at), reportUrl: `/report.html?token=${encodeURIComponent(reportTokenOf(secret, o, conn.appEnv, now()))}`,
      });
    }
    if (o.status === 'created' || o.status === 'checkout_open') return send(res, 200, { ok: true, state: 'pending' });
    return send(res, 200, { ok: true, state: 'unavailable' });
  }

  const HANDLERS = { buy, 'link-open': linkOpen };
  return async function handler(req, res, op) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
    if (!OPS.has(op)) return send(res, 404, { error: 'not_found' });
    if (crossSite(req)) return send(res, 403, { error: 'forbidden' });
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, stripe: true });
    if (!guard.ok) return send(res, 503, { error: 'service_unavailable', incident_id: logEnvDenied('type-report', guard, logger) });
    if (!CP.paymentEnvOk(guard, env)) return send(res, 404, { error: 'not_available' });
    const parsed = await readBody(req);
    if (parsed.tooLarge) return send(res, 413, { error: 'payload_too_large' });
    if (!parsed.body) return send(res, 400, { error: 'invalid_request' });
    try {
      return await HANDLERS[op](req, res, guard, parsed.body);
    } catch (err) {
      const transient = !!(err && err.transient);
      return send(res, transient ? 503 : 500, { error: transient ? 'service_unavailable' : 'request_failed', incident_id: logError(logger, (err && err.code) || 'internal_error') });
    }
  };
}

// ---- Stripe Webhook（api/stripe-webhook.js から。ETI・邪眼の注文でないイベントのうち、タイプ別レポートの注文だけを反映する）
//   戻り値：null＝タイプ別レポートの注文ではない／文字列＝処理の結果。一時的な失敗は投げる（Webhook が 500 を返し、Stripe が再送する）
export async function handleWebhook({ fetchImpl, conn, stripe, type, obj, onPaid }) {
  async function sessionById(id) {
    if (!CP.checkoutSessionIdOk(id, conn.stripeMode)) return null;
    const s = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(id));
    const meta = metadataOf(s, conn.appEnv);
    if (!meta) return null;
    if (!meta.ok || s.livemode !== CP.livemodeOf(conn)) return { mismatch: true };
    return { session: s, orderId: meta.orderId };
  }
  async function sessionByPaymentIntent(pi) {
    if (!CP.PAYMENT_INTENT_RE.test(pi || '')) return null;
    const list = await CP.stripeCall(() => stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 }));
    const s = list && Array.isArray(list.data) ? list.data[0] : null;
    return s ? sessionById(s.id) : null;
  }
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    const f = await sessionById(CP.idOf(obj));
    if (!f) return null;
    if (f.mismatch) return 'ignored:type_report_metadata_mismatch';
    const s = f.session;
    const result = await rpc(fetchImpl, conn, 'type_report_apply_payment', {
      p_order_id: f.orderId, p_checkout_session_id: s.id, p_payment_intent_id: CP.idOf(s.payment_intent),
      p_amount_total: s.amount_total, p_currency: s.currency, p_payment_status: s.payment_status, p_livemode: s.livemode,
    });
    if (onPaid && (result === 'applied' || result === 'noop')) {
      try { await onPaid(f.orderId, s.client_reference_id); } catch { /* 計測だけ */ }
    }
    return result;
  }
  if (type === 'checkout.session.expired') {
    const f = await sessionById(CP.idOf(obj));
    if (!f) return null;
    if (f.mismatch) return 'ignored:type_report_metadata_mismatch';
    if (f.session.status !== 'expired') throw new CP.PaymentError('session_not_expired', true);
    return rpc(fetchImpl, conn, 'type_report_close_order', { p_order_id: f.orderId, p_status: 'expired', p_failure_code: 'checkout_expired' });
  }
  if (type === 'charge.refunded') {
    const chargeId = CP.idOf(obj);
    if (!/^(ch|py)_[A-Za-z0-9_]{8,200}$/.test(chargeId || '')) return null;
    const charge = await CP.stripeCall(() => stripe.charges.retrieve(chargeId));
    const f = await sessionByPaymentIntent(CP.idOf(charge && charge.payment_intent));
    if (!f) return null;
    if (f.mismatch || charge.livemode !== CP.livemodeOf(conn)) return 'ignored:type_report_metadata_mismatch';
    if (charge.refunded !== true) return 'ignored:partial_refund';
    return rpc(fetchImpl, conn, 'type_report_apply_reversal', { p_order_id: f.orderId, p_kind: 'refunded' });
  }
  if (type === 'charge.dispute.created' || type === 'charge.dispute.closed') {
    const disputeId = CP.idOf(obj);
    if (!/^du_[A-Za-z0-9_]{8,200}$/.test(disputeId || '')) return null;
    const dispute = await CP.stripeCall(() => stripe.disputes.retrieve(disputeId));
    let pi = CP.idOf(dispute && dispute.payment_intent);
    if (!pi && dispute && dispute.charge) {
      const ch = await CP.stripeCall(() => stripe.charges.retrieve(CP.idOf(dispute.charge)));
      pi = CP.idOf(ch && ch.payment_intent);
    }
    const f = await sessionByPaymentIntent(pi);
    if (!f) return null;
    if (f.mismatch || dispute.livemode !== CP.livemodeOf(conn)) return 'ignored:type_report_metadata_mismatch';
    const kind = type === 'charge.dispute.created' ? 'disputed'
      : (dispute.status === 'won' || dispute.status === 'warning_closed') ? 'dispute_won' : dispute.status === 'lost' ? 'disputed' : null;
    if (!kind) return 'ignored:dispute_not_closed';
    return rpc(fetchImpl, conn, 'type_report_apply_reversal', { p_order_id: f.orderId, p_kind: kind });
  }
  return null;
}
