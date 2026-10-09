// lib/complete-payment.js
// 完全解析の決済（Checkout・Webhook・状態確認）で共有する処理。API（api/complete-checkout.js・api/stripe-webhook.js・
// api/complete-status.js）からだけ使う。静的には公開しない（scripts/build-public.js の対象外）。
//
//   ・販売の開始は環境変数 COMPLETE_SALES_OPEN が文字列 'true' のときだけ（未設定・それ以外は閉じる）。
//     Webhook は販売を閉じていても動く（返金・dispute を処理するため）。
//   ・Stripe の署名は生のリクエスト本文と Stripe-Signature だけで検証する（HMAC-SHA256・許容300秒・定数時間比較）。
//   ・DB の更新は適用済みの SQL 関数（complete_04）だけで行う。関数の例外は complete_* の理由コードとして扱う。
//     complete_retry_later・通信・DB の一時的な失敗は「一時的」（Webhook は HTTP 500）。
//   ・Stripe の metadata は order_id・app・env の3つだけ。メール・診断コード・user ID・記録 ID・目標を入れない。
//   ・ログは理由コードと照合 ID だけ（URL・query・署名・メール・Stripe ID 全文を出さない）。
'use strict';
const crypto = require('crypto');
const CE = require('./complete-eligibility');
const MATERIALS = require('./complete-materials.json');

const APP = 'element-diagnosis-complete';
// 価格はサーバーが offer から決める（ブラウザの値は使わない）。DB の complete_orders_amount_matches_offer と同じ。
//   analysis ¥1,000 → 解析レポート、direct_complete ¥3,000 → 解析レポート＋完全解析、analysis_upgrade ¥2,000 → 完全解析
const OFFER_AMOUNTS = Object.freeze({ analysis: 1000, direct_complete: 3000, analysis_upgrade: 2000 });
const PRICE_ENV = Object.freeze({ analysis: 'STRIPE_PRICE_ANALYSIS', direct_complete: 'STRIPE_COMPLETE_PRICE_DIRECT', analysis_upgrade: 'STRIPE_COMPLETE_PRICE_UPGRADE' });
const WEBHOOK_TOLERANCE_SEC = 300;
const HANDLED_EVENTS = Object.freeze([
  'checkout.session.completed',
  'checkout.session.expired',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
]);

const CHECKOUT_SESSION_RE = /^cs_test_[A-Za-z0-9_]{8,200}$/;
const PAYMENT_INTENT_RE = /^pi_[A-Za-z0-9_]{8,200}$/;
const PRICE_ID_RE = /^price_[A-Za-z0-9_]{8,200}$/;
const STRIPE_OBJECT_RE = /^(ch|du|evt|py)_[A-Za-z0-9_]{8,200}$/;
// Checkout の戻り先として認める origin（Preview の固定ブランチ URL だけ）。COMPLETE_CHECKOUT_ORIGIN がこれと一致しなければ閉じる。
const PREVIEW_CHECKOUT_ORIGINS = Object.freeze(['https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app']);
// Production の戻り先（本番ドメインだけ）
const PRODUCTION_CHECKOUT_ORIGINS = Object.freeze(['https://element-diagnosis-five.vercel.app']);
// Stripe が返す決済画面の URL の正規ホスト
const STRIPE_CHECKOUT_HOST = 'checkout.stripe.com';

function salesOpen(env) {
  return env.COMPLETE_SALES_OPEN === 'true';
}

// https の origin だけ（userinfo・port・path・query・fragment・末尾の / を含まない）なら正規化した origin、違えば null。
function strictHttpsOrigin(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || u.pathname !== '/') return null;
  return value === u.origin ? u.origin : null;
}

// success・cancel の戻り先。Host ヘッダーからは作らず、サーバー設定 COMPLETE_CHECKOUT_ORIGIN から作る。
// https の origin だけを認め、Preview で許可した固定 origin と一致しなければ null（Checkout は閉じる）。
//   appEnv：preview は Preview の固定 origin、production は本番ドメインだけ。kind：user（マイページへ戻る）／guest（購入完了ページへ戻る）。
//   戻り先の URL に注文 ID・Session ID・診断コードを入れない（GA4 の page_location にも載らない）。
function checkoutReturnUrls(env, appEnv = 'preview', kind = 'user') {
  const origin = strictHttpsOrigin(env.COMPLETE_CHECKOUT_ORIGIN);
  const allowed = appEnv === 'production' ? PRODUCTION_CHECKOUT_ORIGINS : appEnv === 'preview' ? PREVIEW_CHECKOUT_ORIGINS : [];
  if (!origin || !allowed.includes(origin)) return null;
  if (kind === 'guest') {
    return { successUrl: `${origin}/purchase-complete`, cancelUrl: `${origin}/purchase-complete?status=canceled` };
  }
  return {
    successUrl: `${origin}/mypage.html?complete=returned`,
    cancelUrl: `${origin}/mypage.html?complete=canceled`,
  };
}

// 決済 API を動かしてよい環境：Preview（Stripe Test・Preview の Supabase）か Production（Stripe Live・本番の Supabase）だけ。
// 環境ガード（lib/server-env.js）を通った結果 guard を受け取り、どちらでもなければ false。
function paymentEnvOk(guard, env) {
  if (!guard || !guard.ok) return false;
  if (guard.appEnv === 'preview') return guard.stripeMode === 'test' && !!env.SUPABASE_PREVIEW_PROJECT_REF && guard.projectRef === env.SUPABASE_PREVIEW_PROJECT_REF;
  if (guard.appEnv === 'production') return guard.stripeMode === 'live' && !!env.SUPABASE_PRODUCTION_PROJECT_REF && guard.projectRef === env.SUPABASE_PRODUCTION_PROJECT_REF;
  return false;
}
// Stripe の livemode（Test=false・Live=true）
function livemodeOf(guard) {
  return !!(guard && guard.stripeMode === 'live');
}
// Checkout Session ID の形式とモード（Test：cs_test_／Live：cs_live_）
function checkoutSessionIdOk(id, mode) {
  return typeof id === 'string' && (mode === 'live' ? /^cs_live_[A-Za-z0-9_]{8,200}$/ : CHECKOUT_SESSION_RE).test(id);
}

// Stripe が返した決済画面の URL が https・正規ホスト（checkout.stripe.com）・userinfo／port なしであること
function isStripeCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  return u.protocol === 'https:' && u.hostname === STRIPE_CHECKOUT_HOST && !u.username && !u.password && !u.port;
}

function priceIdFor(env, offer) {
  const v = env[PRICE_ENV[offer]];
  return typeof v === 'string' && PRICE_ID_RE.test(v) ? v : null;
}

// Stripe から取得した Price を照合する：有効・JPY・金額・Test・一回払い。違えば理由コード。
function priceProblem(price, offer, mode = 'test') {
  if (!price || typeof price !== 'object') return 'price_missing';
  if (price.active !== true) return 'price_inactive';
  if (price.livemode !== (mode === 'live')) return 'price_livemode';
  if (price.currency !== 'jpy') return 'price_currency';
  if (price.unit_amount !== OFFER_AMOUNTS[offer]) return 'price_amount';
  if (price.type && price.type !== 'one_time') return 'price_type';
  return null;
}

// ---- Webhook の署名（Stripe-Signature: t=<秒>,v1=<hex>[,v1=...]）
function parseSignatureHeader(header) {
  if (typeof header !== 'string' || !header) return null;
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
}

function verifyStripeSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = WEBHOOK_TOLERANCE_SEC) {
  if (!Buffer.isBuffer(rawBody)) return { ok: false, reason: 'body_invalid' };
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) return { ok: false, reason: 'secret_missing' };
  if (!header) return { ok: false, reason: 'signature_missing' };
  const sig = parseSignatureHeader(header);
  if (!sig) return { ok: false, reason: 'signature_malformed' };
  if (Math.abs(nowSec - sig.t) > tolerance) return { ok: false, reason: 'timestamp_out_of_range' };
  const expected = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${sig.t}.`, 'utf8'), rawBody])).digest();
  const match = sig.v1.some((h) => {
    const got = Buffer.from(h, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  return match ? { ok: true, timestamp: sig.t } : { ok: false, reason: 'signature_mismatch' };
}

// テスト・ローカル確認用：署名ヘッダーを作る（本番の処理では使わない）
function signPayload(rawBody, secret, t) {
  const mac = crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`, 'utf8'), rawBody])).digest('hex');
  return `t=${t},v1=${mac}`;
}

async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > limit) return { tooLarge: true };
    chunks.push(b);
  }
  return { body: Buffer.concat(chunks) };
}

// ---- DB（PostgREST）
class PaymentError extends Error {
  constructor(code, transient) {
    super(code);
    this.code = code;
    this.transient = !!transient;
  }
}

async function jsonOf(res) {
  try { return await res.json(); } catch { return null; }
}

// 適用済みの SQL 関数を呼ぶ。例外の文言が complete_* なら理由コード、それ以外は一時的な失敗（db_error）。
async function rpc(fetchImpl, conn, fn, args) {
  let res;
  try {
    res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: Object.assign({}, conn.adminHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(args),
    });
  } catch {
    throw new PaymentError('db_unavailable', true);
  }
  const body = await jsonOf(res);
  if (res.ok) return body;
  const msg = body && typeof body.message === 'string' ? body.message : '';
  if (/^(complete|mentor_goal)_[a-z_]+$/.test(msg)) throw new PaymentError(msg, msg === 'complete_retry_later');
  throw new PaymentError('db_error', true);
}

async function selectRows(fetchImpl, conn, pathAndQuery) {
  let res;
  try {
    res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/${pathAndQuery}`, { headers: conn.adminHeaders() });
  } catch {
    throw new PaymentError('db_unavailable', true);
  }
  if (!res.ok) throw new PaymentError('db_error', true);
  const rows = await jsonOf(res);
  if (!Array.isArray(rows)) throw new PaymentError('db_error', true);
  return rows;
}

function bearerToken(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return typeof h === 'string' && h.startsWith('Bearer ') && h.length > 7 ? h.slice(7) : null;
}

// 本人の確認（/auth/v1/user）。認証できなければ null。Auth の一時的な失敗は例外。
async function authUser(fetchImpl, conn, accessToken) {
  let res;
  try {
    res = await fetchImpl(`${conn.supabaseUrl}/auth/v1/user`, { headers: conn.userHeaders(accessToken) });
  } catch {
    throw new PaymentError('auth_unavailable', true);
  }
  if (res.status >= 500) throw new PaymentError('auth_unavailable', true);
  if (!res.ok) return null;
  const user = await jsonOf(res);
  if (!user || !CE.isUuid(user.id)) return null;
  return {
    id: user.id,
    // 確認済みのメールだけを照合に使う（未確認のメールは「メールなし」と同じ扱い）
    email: user.email && (user.email_confirmed_at || user.confirmed_at) ? user.email : null,
  };
}

function normalizeEmail(e) {
  if (typeof e !== 'string') return null;
  const v = e.trim().toLowerCase();
  return v.includes('@') ? v : null;
}

// ---- Stripe
// SDK の例外の分類：transient（再試行）／missing（存在しない）／permanent（それ以外）
function classifyStripeError(err) {
  if (!err) return 'permanent';
  const type = err.type || err.rawType || '';
  const status = err.statusCode || 0;
  // 同じ Idempotency-Key の要求が処理中（二重クリック等）も一時的な失敗として扱う（注文を閉じない）
  if (['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError', 'StripeIdempotencyError', 'api_error', 'idempotency_error'].includes(type)
      || status >= 500 || status === 429) {
    return 'transient';
  }
  if (status === 404 || err.code === 'resource_missing') return 'missing';
  return 'permanent';
}

async function stripeCall(fn) {
  try {
    return await fn();
  } catch (err) {
    const kind = classifyStripeError(err);
    throw new PaymentError(kind === 'transient' ? 'stripe_unavailable' : kind === 'missing' ? 'stripe_object_missing' : 'stripe_rejected',
      kind === 'transient');
  }
}

// Checkout Session の metadata：order_id・app・env の3つだけ。完全解析の注文でなければ null。
function checkoutMetadataOf(session, appEnv) {
  const m = session && session.metadata;
  if (!m || typeof m !== 'object' || m.app !== APP) return null;
  const keys = Object.keys(m).sort().join(',');
  if (keys !== 'app,env,order_id' || m.env !== appEnv || !CE.isUuid(m.order_id)) return { ok: false };
  return { ok: true, orderId: m.order_id };
}

function idOf(v) {
  if (typeof v === 'string') return v;
  return v && typeof v.id === 'string' ? v.id : null;
}

// 注文の冪等キー（DB の idempotency_key）。サーバーが user・記録・offer・試行枠から決める。
function orderIdempotencyKey(userId, sessionId, offer, attempt) {
  return `co_${crypto.createHash('sha256').update(`${userId}|${sessionId}|${offer}|${attempt}`).digest('hex').slice(0, 40)}`;
}

// Stripe の Idempotency-Key は注文 ID から固定する（DB 更新に失敗しても同じ Session を回収できる）
function stripeIdempotencyKey(orderId) {
  return `complete-checkout-${orderId}`;
}

// 生成の入力ハッシュ：保存済みの回答（encoded_answers）・6つの版・注文に固定した MENTOR 目標・診断日（日本時間の日付）から計算する
// （ブラウザの入力は使わない）。生成器（api/_complete/generate-report.js）も同じ関数で計算する。
function inputSha256({ encodedAnswers, result, mentorGoalCatalogVersion, mentorGoalId, diagnosedDate }) {
  const versions = Object.keys(CE.RC1_REQUIRED_VERSIONS).map((k) => [k, result ? result[k] : null]);
  const canonical = JSON.stringify([
    ['generator_release', MATERIALS.generatorRelease],
    ['encoded_answers', encodedAnswers],
    ...versions,
    ['mentor_goal_catalog_version', mentorGoalCatalogVersion],
    ['mentor_goal_id', mentorGoalId],
    ['diagnosed_date', diagnosedDate],
  ]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// 診断日時を Asia/Tokyo（+09:00、夏時間なし）の ISO 形式へ（保存済みの diagnosis_sessions.completed_at だけを渡す。現在時刻は使わない）。
// 同じ UTC 値からは必ず同じ値になる。読めない値は null。
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
function jstIso(value) {
  if (typeof value !== 'string' || !ISO_DATETIME_RE.test(value)) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return `${new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 19)}+09:00`;
}
// 診断日（Asia/Tokyo の YYYY-MM-DD）。生成器が HTML に出す日付と、入力ハッシュに入れる日付は、どちらもこの値（jstIso から作る）。
function jstDate(value) {
  const iso = jstIso(value);
  return iso ? iso.slice(0, 10) : null;
}

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function logError(logger, api, code, incident) {
  logger.error(`${api} error: ${code} ${incident}`);
}

module.exports = {
  APP,
  OFFER_AMOUNTS,
  PRICE_ENV,
  HANDLED_EVENTS,
  MATERIALS,
  WEBHOOK_TOLERANCE_SEC,
  CHECKOUT_SESSION_RE,
  PAYMENT_INTENT_RE,
  STRIPE_OBJECT_RE,
  PaymentError,
  PREVIEW_CHECKOUT_ORIGINS,
  PRODUCTION_CHECKOUT_ORIGINS,
  paymentEnvOk,
  livemodeOf,
  checkoutSessionIdOk,
  salesOpen,
  strictHttpsOrigin,
  checkoutReturnUrls,
  isStripeCheckoutUrl,
  priceIdFor,
  priceProblem,
  parseSignatureHeader,
  verifyStripeSignature,
  signPayload,
  readRawBody,
  rpc,
  selectRows,
  bearerToken,
  authUser,
  normalizeEmail,
  classifyStripeError,
  stripeCall,
  checkoutMetadataOf,
  idOf,
  orderIdempotencyKey,
  stripeIdempotencyKey,
  inputSha256,
  jstIso,
  jstDate,
  setCommonHeaders,
  logError,
};
