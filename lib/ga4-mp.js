// lib/ga4-mp.js
// GA4 の Measurement Protocol（サーバーからの送信）。購入（purchase）と返金（refund）を送る。
//   ・購入は Stripe の Webhook（支払いの確定）を正とする。ブラウザで固有リンクを開かなかった購入も数える。
//   ・Stripe の返金は利用者の画面を通らないため、ブラウザの gtag では計測できない。Webhook（charge.refunded）の処理の後に送る。
//   ・送るのは Stripe Live（本番）で、秘密値 GA4_API_SECRET がある時だけ。無ければ何もしない（決済の処理には影響しない）。
//   ・transaction_id は purchase と同じ参照（注文 ID から作った 20 桁。注文 ID・Stripe の ID・メールは送らない）。
//   ・送信の失敗は処理を止めない（理由コードだけを記録する）。応答の後に waitUntil で送る。
'use strict';
const CE = require('./complete-eligibility');
const CP = require('./complete-payment');
const GR = require('./ga-ref');

const MEASUREMENT_ID = 'G-FDN7NYZW9D';
const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const TIMEOUT_MS = 5000;
const SECRET_RE = /^[A-Za-z0-9_-]{8,100}$/;
const REF_RE = /^[0-9a-f]{20}$/;

function enabled(env, livemode) {
  return livemode === true && typeof env.GA4_API_SECRET === 'string' && SECRET_RE.test(env.GA4_API_SECRET);
}

// client_id は取引ごとに固定の合成値（利用者の端末の ID は使わない）。同じ取引の再送は「同じ利用者・同じ transaction_id」になり、GA4 が重複を除く
function serverClientId(transactionId) {
  return `srv.${parseInt(transactionId.slice(0, 8), 16)}.${parseInt(transactionId.slice(8, 16), 16)}`;
}
// 商品（ブラウザの js/ga.js の共通 product_id と同じ値。item_id は既存の値を保つ）
const PRODUCTS = {
  eti_analysis_v1: { diagnosis: 'eti', itemId: 'analysis', name: '解析レポート', category: '元素診断' },
  eti_type_report_v1: { diagnosis: 'eti', itemId: 'eti_type_report_v1', name: 'タイプ別レポート', category: '元素診断' },
  eti_complete_v1: { diagnosis: 'eti', itemId: 'complete', name: '完全解析', category: '元素診断' },
  jagan_report_v1: { diagnosis: 'jagan', itemId: 'jagan_report_v1', name: '邪眼解析レポート', category: '邪眼診断' },
  jagan_complete_v1: { diagnosis: 'jagan', itemId: 'jagan_complete_v1', name: '邪眼完全解析レポート「DIPPER」', category: '邪眼診断' },
};
function productParams(productId) {
  const p = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : null;
  return p ? { diagnosis_type: p.diagnosis, product_id: productId } : {};
}
// 返金の本文
function refundPayload(transactionId, value, productId) {
  if (!REF_RE.test(String(transactionId || '')) || !Number.isInteger(value) || value <= 0) return null;
  return {
    client_id: serverClientId(transactionId),
    non_personalized_ads: true,
    events: [{ name: 'refund', params: { transaction_id: transactionId, currency: 'JPY', value, ...productParams(productId) } }],
  };
}
// 購入の本文（支払いの確定時刻を timestamp_micros に入れる。72時間より古いものは送らない）
const MAX_AGE_MS = 72 * 3600 * 1000;
function purchasePayload({ transactionId, value, productId, paidAtMs, nowMs = Date.now(), gaRef = null, typeCode = null }) {
  const ref = GR.parse(gaRef);
  const p = Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : null;
  if (!p || !REF_RE.test(String(transactionId || '')) || !Number.isInteger(value) || value <= 0) return null;
  const at = Number.isFinite(paidAtMs) && paidAtMs <= nowMs && nowMs - paidAtMs < MAX_AGE_MS ? paidAtMs : null;
  if (Number.isFinite(paidAtMs) && at === null) return null;
  const isTypeReport = productId === 'eti_type_report_v1';
  if (isTypeReport && !/^(PY|HY|CR|EL|AN|GE|DE)(SW|CM|PL|CT|BW)$/.test(typeCode || '')) return null;
  return {
    // 申込の時点の利用者（参照があれば）。無ければ取引ごとの合成の利用者
    client_id: ref ? ref.clientId : serverClientId(transactionId),
    non_personalized_ads: true,
    ...(at ? { timestamp_micros: at * 1000 } : {}),
    events: [{ name: 'purchase', params: {
      transaction_id: transactionId, currency: 'JPY', value, diagnosis_type: p.diagnosis, product_id: productId,
      source: ref && ref.source ? ref.source : 'server_webhook', sent_by: 'server',
      ...(isTypeReport ? { type_code: typeCode } : {}),
      ...(ref && ref.sessionId ? { session_id: ref.sessionId, engagement_time_msec: 1 } : {}),
      ...(ref && ref.internal ? { traffic_type: 'internal' } : {}),
      items: [{ item_id: p.itemId, item_name: p.name, item_category: p.category, price: value, quantity: 1, ...(isTypeReport ? { item_variant: typeCode } : {}) }],
    } }],
  };
}

async function post(env, fetchImpl, body, kind, logger) {
  const url = `${ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
    if (res && res.status >= 200 && res.status < 300) return 'sent';
    CP.logError(logger, 'ga4-mp', `${kind}_rejected`, CE.incidentId());
    return 'rejected';
  } catch {
    CP.logError(logger, 'ga4-mp', `${kind}_unreachable`, CE.incidentId());
    return 'failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendPurchase({ env, fetchImpl, livemode, transactionId, value, productId, paidAtMs, gaRef = null, typeCode = null, logger = console }) {
  if (!enabled(env, livemode)) return 'disabled';
  const body = purchasePayload({ transactionId, value, productId, paidAtMs, gaRef, typeCode });
  if (!body) return 'invalid';
  return post(env, fetchImpl, body, 'purchase', logger);
}
function schedulePurchase(waitUntil, args) {
  if (typeof waitUntil !== 'function' || !enabled(args.env, args.livemode)) return false;
  waitUntil(sendPurchase(args).catch(() => 'failed'));
  return true;
}

async function sendRefund({ env, fetchImpl, livemode, transactionId, value, productId, logger = console }) {
  if (!enabled(env, livemode)) return 'disabled';
  const body = refundPayload(transactionId, value, productId);
  if (!body) return 'invalid';
  return post(env, fetchImpl, body, 'refund', logger);
}
// 応答の後で送る（waitUntil が無い環境では送らない）
function scheduleRefund(waitUntil, args) {
  if (typeof waitUntil !== 'function' || !enabled(args.env, args.livemode)) return false;
  waitUntil(sendRefund(args).catch(() => 'failed'));
  return true;
}

module.exports = { MEASUREMENT_ID, PRODUCTS, enabled, serverClientId, refundPayload, purchasePayload, sendRefund, scheduleRefund, sendPurchase, schedulePurchase };
