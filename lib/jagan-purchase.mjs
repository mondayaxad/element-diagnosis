// lib/jagan-purchase.mjs
// 邪眼解析レポート（¥1,000・買い切り）の購入・固有リンク・マイページへの登録・閲覧と、Stripe Webhook の反映（2026-11-07・Preview）。
//   POST /api/jagan-report?op=buy | link-open | link-register | open   （api/jagan-report.mjs。関数は増やさない）
//
// 方針（ETI の complete_13・lib/link-purchase.js と同じ考え方）
//   ・購入はログイン不要。対象は「どの邪眼の結果（50問の回答）か」。サーバーが同じ版（jagan/engine）で回答を検査・再計算し、
//     注文に回答・DTI コード・見出しを固定する（ブラウザが送る見出し・人物・一致率・金額は使わない）。
//     ログイン中に自分の保存した結果から買うときは、回答を送らずに resultId だけ（サーバーが本人の行から読む）。
//   ・金額・通貨・商品はサーバーが決める（¥1,000／¥3,000・JPY・一回払い。支払い方法はカードと PayPay）。Stripe の Price は、環境変数
//     JAGAN_PRICE_ID・JAGAN_COMPLETE_PRICE_ID を Stripe から取得して照合する（元素診断と同じ）。本番は Price が必須、Preview だけ未設定なら price_data。
//     ETI の商品・価格（STRIPE_PRICE_ANALYSIS 等）は使わない。metadata.app は 'element-diagnosis-jagan'（ETI の Webhook と分ける）。
//   ・固有リンクの秘密値（256bit）は、注文の冪等キーとサーバーの鍵（COMPLETE_VIEW_TOKEN_SECRET から HKDF で別の用途の鍵を作る）
//     から決まる（同じ購入操作の再送は同じ秘密値・同じ決済画面）。DB にはハッシュだけ。決済の戻り先は固有リンクそのもの
//     （/jagan/report#t=<秘密値>。フラグメントはサーバーへ送られない）。
//   ・固有リンクを開くたびに、注文が支払い済み・リンクが有効であることを確かめる。Webhook がまだなら Stripe に問い合わせて反映する。
//   ・販売：Preview は JAGAN_SALES_OPEN=true のときだけ申し込める。本番は product.json の sales_open も true のときだけ。
//     閲覧・登録・Webhook は販売を閉じていても動く（購入済みのレポートは読める・返金を反映する）。
//   ・応答・ログに、秘密値・注文 ID・Stripe ID・メール・回答を出さない（固有リンクの閲覧の応答だけ、その人が買った回答を返す）。
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import serverEnv from './server-env.js';
import { computeDiagnosis, RESULT_SCHEMA_VERSION } from '../jagan/engine/runtime.mjs';
import { BUNDLE } from '../jagan/engine/data.mjs';
import { recompute, headlineOf, jaganEnabled, UUID_RE } from './jagan-api.mjs';

const require = createRequire(import.meta.url);
const CP = require('./complete-payment.js');
const { requireServerEnv, requestHost, logEnvDenied } = serverEnv;

export const APP = 'element-diagnosis-jagan';
export const PRODUCT_KEY = 'jagan_report_v1';
export const AMOUNT = 1000;
// 商品（2026-11-10）：解析レポート（¥1,000）と完全解析「DIPPER」（¥3,000）。金額・名前・閲覧ページはサーバーが決める
export const COMPLETE_KEY = 'jagan_complete_v1';
export const PRODUCTS = Object.freeze({
  [PRODUCT_KEY]: Object.freeze({ key: PRODUCT_KEY, amount: 1000, name: '邪眼解析レポート', path: '/jagan/report', priceEnv: 'JAGAN_PRICE_ID', label: '邪眼解析レポート（1,000円・税込）' }),
  [COMPLETE_KEY]: Object.freeze({ key: COMPLETE_KEY, amount: 3000, name: '邪眼完全解析レポート「DIPPER」', path: '/jagan/dipper', priceEnv: 'JAGAN_COMPLETE_PRICE_ID', label: '邪眼完全解析レポート「DIPPER」（3,000円・税込・全23ページ）' }),
});
// ブラウザから送る商品名（'report'｜'complete'）→ 商品
export const PRODUCT_OF = Object.freeze({ report: PRODUCT_KEY, complete: COMPLETE_KEY });
export const productOf = (name) => PRODUCTS[PRODUCT_OF[name === undefined ? 'report' : name]] || null;
export const OPS = new Set(['buy', 'link-open', 'link-register', 'open']);
export const PAYMENT_METHODS = ['card', 'paypay']; // 元素診断と同じ（PayPay を Stripe 側で有効にしている前提。拒まれたらカードだけ）
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ATTEMPT_RE = /^[A-Za-z0-9_-]{22,64}$/;
const SOURCE_RE = /^[a-z_]{1,32}$/;
const MAX_BODY_BYTES = 8 * 1024;
const ORDERS_PER_HOUR = 20;
// 決済画面の支払いボタンの上の文言（ETI の解析レポートと同じ趣旨：価格・支払の時期と方法・提供の時期・返品の決まり）
const REFUND_TEXT = 'デジタルコンテンツの性質上、提供開始後のお客様都合による返品・キャンセル・返金は原則として受け付けません。ただし、二重決済、正常に提供できない場合、契約内容との不一致、法令上必要な場合は、状況を確認して個別に対応します。';
export function checkoutText(origin, product = PRODUCTS[PRODUCT_KEY]) {
  return `${product.label}。お支払いはクレジットカードで、ご注文の確定時です。お支払いの確認の後、すぐにお読みいただけます。`
    + 'お支払い後に表示される固有のリンク（URL）を必ず保存してください。リンク自体に通常の有効期限はありません。'
    + `${REFUND_TEXT}特定商取引法に基づく表記：${origin}/tokushoho　利用規約：${origin}/terms.html`;
}

// ---- 純粋な処理（テストで直接使う）
export const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function linkKey(env) {
  const raw = env.COMPLETE_VIEW_TOKEN_SECRET;
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43,}$/.test(raw)) return null;
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(raw, 'base64url'), Buffer.alloc(0), Buffer.from('jagan-report-link-v1'), 32));
}
export function idempotencyKeyOf(resultId, buyer, attempt, productKey = PRODUCT_KEY) {
  // 解析レポートは以前と同じキー（再送の互換）。完全解析は商品を含めて別のキーにする
  return 'jo_' + sha256hex(`${resultId}|${buyer || '-'}|${attempt}${productKey === PRODUCT_KEY ? '' : `|${productKey}`}`).slice(0, 40);
}
export function linkSecretOf(key, idempotencyKey) {
  return crypto.createHmac('sha256', key).update(`link|${idempotencyKey}`).digest('base64url');
}
export function salesOpen(env, appEnv, bundle = BUNDLE) {
  if (env.JAGAN_SALES_OPEN !== 'true') return false;
  if (appEnv === 'preview') return true;
  return appEnv === 'production' && bundle.product.sales_open === true;
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
function priceProblem(price, mode, amount = AMOUNT) {
  if (!price || typeof price !== 'object') return 'price_missing';
  if (price.active !== true) return 'price_inactive';
  if (price.livemode !== (mode === 'live')) return 'price_livemode';
  if (price.currency !== 'jpy') return 'price_currency';
  if (price.unit_amount !== amount) return 'price_amount';
  if (price.type && price.type !== 'one_time') return 'price_type';
  return null;
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
function only(body, allowed) { return Object.keys(body).every((k) => allowed.includes(k)); }
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
function incident() { return crypto.randomBytes(6).toString('hex'); }
function logError(logger, code) { const id = incident(); try { logger.error(`[jagan-purchase] ${code} incident=${id}`); } catch { /* noop */ } return id; }

// DB の関数（RPC）。jagan_ で始まる例外は、その名前を code にして投げる（一時的な失敗ではない）
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
  if (/^jagan_[a-z_]+$/.test(msg)) throw new CP.PaymentError(msg, false);
  throw new CP.PaymentError('db_error', true);
}

// 本人の保存した結果の行（回答・版）。無ければ null
async function ownRow(fetchImpl, conn, userId, resultId) {
  const rows = await CP.selectRows(fetchImpl, conn, `jagan_results?result_id=eq.${resultId}&user_id=eq.${userId}&select=result_id,item_set_version,answers,headline`);
  return rows[0] || null;
}
async function orderByHash(fetchImpl, conn, hash) {
  const rows = await CP.selectRows(fetchImpl, conn, `jagan_orders?link_token_hash=eq.${hash}&select=id,result_id,item_set_version,answers,dti_code,headline,status,link_status,stripe_checkout_session_id,stripe_mode,paid_at,created_at,product_key`);
  return rows[0] || null;
}
async function profileOk(fetchImpl, conn, userId) {
  const rows = await CP.selectRows(fetchImpl, conn, `profiles?id=eq.${encodeURIComponent(userId)}&select=onboarding_status`);
  const s = rows[0] && rows[0].onboarding_status;
  return s === 'completed' || s === 'legacy_exempt';
}

// Stripe の決済画面を取り直し、支払い済みなら反映する（Webhook がまだの時。何度呼んでも同じ結果）
export async function settleFromStripe({ fetchImpl, conn, stripe, order }) {
  if (!order || !['created', 'checkout_open'].includes(order.status) || !CP.checkoutSessionIdOk(order.stripe_checkout_session_id, conn.stripeMode)) return order && order.status;
  const s = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id));
  const meta = metadataOf(s, conn.appEnv);
  if (!s || !meta || !meta.ok || meta.orderId !== order.id || s.livemode !== CP.livemodeOf(conn)) return order.status;
  if (s.status === 'complete' && s.payment_status === 'paid') {
    const r = await rpc(fetchImpl, conn, 'jagan_apply_payment', {
      p_order_id: order.id, p_checkout_session_id: s.id, p_payment_intent_id: CP.idOf(s.payment_intent),
      p_amount_total: s.amount_total, p_currency: s.currency, p_payment_status: s.payment_status, p_livemode: s.livemode,
    });
    return r === 'applied' || r === 'noop' ? 'paid' : order.status;
  }
  if (s.status === 'expired') {
    await rpc(fetchImpl, conn, 'jagan_close_order', { p_order_id: order.id, p_status: 'expired', p_failure_code: 'checkout_expired' });
    return 'expired';
  }
  return order.status;
}

// 閲覧に返す内容：その注文の回答（買った人が自分で計算して表示する。同じ版の計算で同じ本文になる）
function reportPayload(o) {
  // headline：購入時に保存した見出し（人物名・一致度を含む）。判定の版が更新されて人物が変わった場合に、画面で説明するために返す
  return { resultId: o.result_id, itemSetVersion: o.item_set_version, answers: o.answers, dtiCode: o.dti_code, paidAt: o.paid_at, headline: o.headline || null, product: o.product_key === COMPLETE_KEY ? 'complete' : 'report' };
}

export function createPurchaseHandler({ env, fetchImpl, stripeFactory, logger = console, now = () => Date.now(), randomUuid = () => crypto.randomUUID() }) {
  let stripe = null;
  const stripeOf = () => (stripe || (stripe = stripeFactory(env.STRIPE_SECRET_KEY)));
  const priceCache = new Map();
  async function priceOk(conn, product) {
    const id = env[product.priceEnv];
    // 元素診断と同じ：本番は Stripe の Price（Live）を必ず使う。Preview だけ、Price が無ければ金額を直接指定（price_data）
    if (!id) return conn.appEnv === 'production' ? 'price_id_missing' : null;
    if (!/^price_[A-Za-z0-9_]{8,200}$/.test(id)) return 'price_id_invalid';
    const hit = priceCache.get(id);
    if (hit && now() - hit < 10 * 60 * 1000) return null;
    const p = await CP.stripeCall(() => stripeOf().prices.retrieve(id));
    const problem = priceProblem(p, conn.stripeMode, product.amount);
    if (!problem) priceCache.set(id, now());
    return problem;
  }

  // 決済画面の作成：支払い方法はカードと PayPay（元素診断 lib/link-purchase.js と同じ）。Stripe が PayPay 付きの作成を拒んだ時は、
  //   カードだけで1回だけ作り直す（別の Idempotency-Key）。拒まれた後の10分は、最初からカードだけで作る
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
    if (!only(body, ['resultId', 'itemSetVersion', 'answers', 'attempt', 'source', 'product'])) return send(res, 400, { error: 'invalid_request' });
    const { resultId, attempt, source } = body;
    const product = productOf(body.product);
    if (!product) return send(res, 400, { error: 'invalid_request' });
    if (!UUID_RE.test(String(resultId || '')) || !ATTEMPT_RE.test(String(attempt || '')) || (source !== undefined && !SOURCE_RE.test(String(source)))) {
      return send(res, 400, { error: 'invalid_request' });
    }
    if (!salesOpen(env, conn.appEnv)) return send(res, 503, { error: 'sales_closed' });
    const origin = checkoutOrigin(env, conn.appEnv);
    const key = linkKey(env);
    if (!origin || !key) return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, 'checkout_config_missing') });
    // ログイン中なら本人（自分の保存した結果からの購入は、支払いの時に自動でマイページに登録する）
    const token = CP.bearerToken(req);
    let userId = null;
    if (token) {
      const u = await CP.authUser(fetchImpl, conn, token);
      if (!u) return send(res, 401, { error: 'not_authenticated' });
      userId = u.id;
    }
    // 回答：送られた回答を検査・再計算する。回答が無ければ、本人の保存した結果の行から読む
    let rc;
    if (body.answers !== undefined) {
      rc = recompute({ resultId, itemSetVersion: body.itemSetVersion, answers: body.answers });
      if (!rc.ok) return send(res, 400, { error: rc.error });
    } else {
      if (!userId) return send(res, 401, { error: 'not_authenticated' });
      const row = await ownRow(fetchImpl, conn, userId, resultId);
      if (!row) return send(res, 404, { error: 'record_not_found' });
      rc = recompute({ resultId, itemSetVersion: row.item_set_version, answers: row.answers });
      if (!rc.ok) return send(res, 422, { error: 'record_not_eligible' });
    }
    const result = rc.result;
    const problem = await priceOk(conn, product);
    if (problem) return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, problem) });
    const idem = idempotencyKeyOf(resultId, userId, attempt, product.key);
    const secret = linkSecretOf(key, idem);
    let order;
    try {
      const rows = await rpc(fetchImpl, conn, 'jagan_create_order', {
        p_result_id: resultId, p_item_set_version: result.versions.itemSet, p_answers: result.answers, p_dti_code: result.dti.code,
        p_headline: headlineOf(result), p_buyer_user_id: userId, p_stripe_mode: conn.stripeMode, p_idempotency_key: idem, p_link_token_hash: sha256hex(secret),
        p_product_key: product.key,
      });
      order = Array.isArray(rows) ? rows[0] : null;
    } catch (err) {
      if (err && err.code === 'jagan_idempotency_conflict') return send(res, 409, { error: 'attempt_conflict' });
      throw err;
    }
    if (!order || !UUID_RE.test(order.order_id)) return send(res, 500, { error: 'checkout_failed', incident_id: logError(logger, 'order_invalid') });
    if (order.created) {
      // 決済画面の作りすぎを防ぐ（同じ結果で直近1時間の新しい注文の数に上限。再送は数えない）
      const since = new Date(now() - 3600 * 1000).toISOString();
      const recent = await CP.selectRows(fetchImpl, conn, `jagan_orders?result_id=eq.${resultId}&product_key=eq.${product.key}&created_at=gt.${encodeURIComponent(since)}&select=id&limit=${ORDERS_PER_HOUR + 1}`);
      if (recent.length > ORDERS_PER_HOUR) {
        await rpc(fetchImpl, conn, 'jagan_close_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'rate_limited' });
        return send(res, 429, { error: 'too_many_attempts' });
      }
    } else {
      if (['paid', 'refunded', 'disputed'].includes(order.order_status)) return send(res, 409, { error: 'purchase_completed' });
      if (order.order_status === 'checkout_open' && CP.checkoutSessionIdOk(order.checkout_session_id, conn.stripeMode)) {
        const s = await CP.stripeCall(() => stripeOf().checkout.sessions.retrieve(order.checkout_session_id));
        if (s && s.status === 'open' && CP.isStripeCheckoutUrl(s.url)) return send(res, 200, { checkoutUrl: s.url, amount: product.amount });
        if (s && s.status === 'complete') return send(res, 409, { error: 'purchase_completed' });
        return send(res, 409, { error: 'attempt_expired' });
      }
      if (order.order_status !== 'created') return send(res, 409, { error: 'attempt_expired' });
    }
    const createdRows = await CP.selectRows(fetchImpl, conn, `jagan_orders?id=eq.${order.order_id}&select=created_at`);
    const expiresAt = (createdRows[0] && CP.checkoutExpiresAt(createdRows[0].created_at)) || Math.floor(now() / 1000) + CP.CHECKOUT_LIFETIME_SEC;
    const lineItem = env[product.priceEnv]
      ? { price: env[product.priceEnv], quantity: 1 }
      : { price_data: { currency: 'jpy', unit_amount: product.amount, product_data: { name: product.name } }, quantity: 1 };
    let session;
    try {
      session = await createCheckoutSession({
        mode: 'payment',
        line_items: [lineItem],
        // 戻り先は、購入したレポートの固有リンクそのもの（秘密値はフラグメント。サーバーへ送られない）
        success_url: `${origin}${product.path}#t=${secret}`,
        // 中止した時の戻り先：マイページの記録から（回答を送らない申込）はマイページへ、結果ページ・レポート・サンプルからは結果ページへ
        cancel_url: body.answers === undefined ? `${origin}/mypage#jagan` : `${origin}/jagan/?checkout=canceled`,
        locale: 'ja',
        expires_at: expiresAt,
        custom_text: { submit: { message: checkoutText(origin, product) } },
        metadata: { order_id: order.order_id, app: APP, env: conn.appEnv },
      }, `jagan-checkout-${order.order_id}`);
    } catch (err) {
      if (!err.transient) await rpc(fetchImpl, conn, 'jagan_close_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'stripe_error' });
      throw err;
    }
    const meta = metadataOf(session, conn.appEnv);
    if (!session || !CP.checkoutSessionIdOk(session.id, conn.stripeMode) || session.livemode !== CP.livemodeOf(conn) || !meta || !meta.ok
        || meta.orderId !== order.order_id || !CP.isStripeCheckoutUrl(session.url)) {
      return send(res, 500, { error: 'checkout_failed', incident_id: logError(logger, 'checkout_session_invalid') });
    }
    // 金額・通貨も注文と一致すること（違えば画面を閉じて注文を片付ける）
    if (session.amount_total !== product.amount || session.currency !== 'jpy') {
      try { await CP.stripeCall(() => stripeOf().checkout.sessions.expire(session.id)); } catch { /* 期限切れで閉じる */ }
      await rpc(fetchImpl, conn, 'jagan_close_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'amount_mismatch' });
      return send(res, 503, { error: 'service_unavailable', incident_id: logError(logger, 'checkout_amount_mismatch') });
    }
    await rpc(fetchImpl, conn, 'jagan_mark_checkout_open', { p_order_id: order.order_id, p_checkout_session_id: session.id });
    return send(res, 200, { checkoutUrl: session.url, amount: product.amount });
  }

  async function linkOpen(req, res, conn, body) {
    if (!only(body, ['token']) || !TOKEN_RE.test(String(body.token || ''))) return send(res, 400, { error: 'invalid_request' });
    let o = await orderByHash(fetchImpl, conn, sha256hex(body.token));
    if (!o) return send(res, 404, { error: 'link_not_found' });
    if (o.status === 'created' || o.status === 'checkout_open') {
      const st = await settleFromStripe({ fetchImpl, conn, stripe: stripeOf(), order: o });
      if (st === 'paid') o = await orderByHash(fetchImpl, conn, sha256hex(body.token));
    }
    if (o.status === 'paid' && o.link_status === 'active') return send(res, 200, { ok: true, state: 'paid', report: reportPayload(o) });
    if (o.status === 'created' || o.status === 'checkout_open') return send(res, 200, { ok: true, state: 'pending' });
    return send(res, 200, { ok: true, state: 'unavailable' });
  }

  async function linkRegister(req, res, conn, body) {
    if (!only(body, ['token']) || !TOKEN_RE.test(String(body.token || ''))) return send(res, 400, { error: 'invalid_request' });
    const token = CP.bearerToken(req);
    if (!token) return send(res, 401, { error: 'not_authenticated' });
    const u = await CP.authUser(fetchImpl, conn, token);
    if (!u) return send(res, 401, { error: 'not_authenticated' });
    if (!(await profileOk(fetchImpl, conn, u.id))) return send(res, 403, { error: 'onboarding_required' });
    const hash = sha256hex(body.token);
    let o = await orderByHash(fetchImpl, conn, hash);
    if (!o) return send(res, 404, { error: 'link_not_found' });
    // 支払いの反映（Webhook）がまだ：Stripe に確かめて反映してから登録する
    if ((o.status === 'created' || o.status === 'checkout_open') && (await settleFromStripe({ fetchImpl, conn, stripe: stripeOf(), order: o })) === 'paid') {
      o = await orderByHash(fetchImpl, conn, hash);
    }
    if (o.status !== 'paid' || o.link_status !== 'active') return send(res, 409, { error: 'link_inactive' });
    // 登録先の記録 ID：同じ結果 ID の行が無い・本人の行ならその ID、別の人の行なら新しい ID（同じ計算で記録を作る）
    const owner = await CP.selectRows(fetchImpl, conn, `jagan_results?result_id=eq.${o.result_id}&select=user_id`);
    const rid = !owner[0] || owner[0].user_id === u.id ? o.result_id : randomUuid();
    const result = computeDiagnosis({ resultId: rid, itemSetVersion: o.item_set_version, answers: o.answers }, BUNDLE);
    let rows;
    try { rows = await rpc(fetchImpl, conn, 'jagan_register_order', {
      p_user_id: u.id, p_link_token_hash: hash, p_fallback_result_id: rid,
      p_schema_version: RESULT_SCHEMA_VERSION, p_engine_version: result.versions.engine, p_scoring_version: result.versions.scoring,
      p_interpretation_version: result.versions.interpretation, p_character_model_version: result.versions.characterModel,
      p_naming_version: result.versions.naming, p_snapshot: result,
    }); } catch (err) {
      if (err && err.code === 'jagan_onboarding_required') return send(res, 403, { error: 'onboarding_required' });
      throw err;
    }
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r || !['registered', 'already'].includes(r.reg_result)) return send(res, 409, { error: r && r.reg_result === 'not_found' ? 'link_not_found' : 'link_inactive' });
    return send(res, 200, { ok: true, result: r.reg_result, resultId: r.reg_result_id });
  }

  // マイページから開く：本人の記録で、権利が active の時だけ（回答は本人の行から）
  async function open(req, res, conn, body) {
    if (!only(body, ['resultId', 'product']) || !UUID_RE.test(String(body.resultId || ''))) return send(res, 400, { error: 'invalid_request' });
    const product = productOf(body.product);
    if (!product) return send(res, 400, { error: 'invalid_request' });
    const token = CP.bearerToken(req);
    if (!token) return send(res, 401, { error: 'not_authenticated' });
    const u = await CP.authUser(fetchImpl, conn, token);
    if (!u) return send(res, 401, { error: 'not_authenticated' });
    const ent = await CP.selectRows(fetchImpl, conn, `jagan_entitlements?user_id=eq.${u.id}&result_id=eq.${body.resultId}&product_key=eq.${product.key}&status=eq.active&select=id`);
    if (!ent[0]) return send(res, 403, { error: 'not_purchased' });
    const row = await ownRow(fetchImpl, conn, u.id, body.resultId);
    if (!row) return send(res, 404, { error: 'record_not_found' });
    return send(res, 200, { ok: true, state: 'paid', report: { resultId: row.result_id, itemSetVersion: row.item_set_version, answers: row.answers, headline: row.headline || null, product: product.key === COMPLETE_KEY ? 'complete' : 'report' } });
  }

  const HANDLERS = { buy, 'link-open': linkOpen, 'link-register': linkRegister, open };
  return async function handler(req, res, op) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
    if (!OPS.has(op)) return send(res, 404, { error: 'not_found' });
    if (crossSite(req)) return send(res, 403, { error: 'forbidden' });
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true, stripe: true });
    if (!guard.ok) return send(res, 503, { error: 'service_unavailable', incident_id: logEnvDenied('jagan-purchase', guard, logger) });
    if (!jaganEnabled(env, guard.appEnv)) return send(res, 503, { error: 'jagan_not_enabled' });
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

// ---- Stripe Webhook（api/stripe-webhook.js から。ETI の注文でないイベントのうち、邪眼の注文だけを反映する）
//   戻り値：null＝邪眼の注文ではない（ETI と同じく 'ignored:not_complete' にする）／文字列＝処理の結果。
//   一時的な失敗は投げる（Webhook が 500 を返し、Stripe が再送する）。
export async function handleWebhook({ fetchImpl, conn, stripe, type, obj }) {
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
    if (f.mismatch) return 'ignored:jagan_metadata_mismatch';
    const s = f.session;
    return rpc(fetchImpl, conn, 'jagan_apply_payment', {
      p_order_id: f.orderId, p_checkout_session_id: s.id, p_payment_intent_id: CP.idOf(s.payment_intent),
      p_amount_total: s.amount_total, p_currency: s.currency, p_payment_status: s.payment_status, p_livemode: s.livemode,
    });
  }
  if (type === 'checkout.session.expired') {
    const f = await sessionById(CP.idOf(obj));
    if (!f) return null;
    if (f.mismatch) return 'ignored:jagan_metadata_mismatch';
    if (f.session.status !== 'expired') throw new CP.PaymentError('session_not_expired', true);
    return rpc(fetchImpl, conn, 'jagan_close_order', { p_order_id: f.orderId, p_status: 'expired', p_failure_code: 'checkout_expired' });
  }
  if (type === 'charge.refunded') {
    const chargeId = CP.idOf(obj);
    if (!/^(ch|py)_[A-Za-z0-9_]{8,200}$/.test(chargeId || '')) return null;
    const charge = await CP.stripeCall(() => stripe.charges.retrieve(chargeId));
    const f = await sessionByPaymentIntent(CP.idOf(charge && charge.payment_intent));
    if (!f) return null;
    if (f.mismatch || charge.livemode !== CP.livemodeOf(conn)) return 'ignored:jagan_metadata_mismatch';
    // 一部の返金ではレポートを止めない（全額の返金だけ）
    if (charge.refunded !== true) return 'ignored:partial_refund';
    return rpc(fetchImpl, conn, 'jagan_apply_reversal', { p_order_id: f.orderId, p_kind: 'refunded' });
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
    if (f.mismatch || dispute.livemode !== CP.livemodeOf(conn)) return 'ignored:jagan_metadata_mismatch';
    const kind = type === 'charge.dispute.created' ? 'disputed'
      : (dispute.status === 'won' || dispute.status === 'warning_closed') ? 'dispute_won' : dispute.status === 'lost' ? 'disputed' : null;
    if (!kind) return 'ignored:dispute_not_closed';
    return rpc(fetchImpl, conn, 'jagan_apply_reversal', { p_order_id: f.orderId, p_kind: kind });
  }
  return null;
}
