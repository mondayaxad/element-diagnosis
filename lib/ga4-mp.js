// lib/ga4-mp.js
// GA4 の Measurement Protocol（サーバーからの送信）。いまは返金（refund）だけを送る。
//   ・Stripe の返金は利用者の画面を通らないため、ブラウザの gtag では計測できない。Webhook（charge.refunded）の処理の後に送る。
//   ・送るのは Stripe Live（本番）で、秘密値 GA4_API_SECRET がある時だけ。無ければ何もしない（決済の処理には影響しない）。
//   ・transaction_id は purchase と同じ参照（注文 ID から作った 20 桁。注文 ID・Stripe の ID・メールは送らない）。
//   ・送信の失敗は処理を止めない（理由コードだけを記録する）。応答の後に waitUntil で送る。
'use strict';
const CE = require('./complete-eligibility');
const CP = require('./complete-payment');

const MEASUREMENT_ID = 'G-FDN7NYZW9D';
const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const TIMEOUT_MS = 5000;
const SECRET_RE = /^[A-Za-z0-9_-]{8,100}$/;
const REF_RE = /^[0-9a-f]{20}$/;

function enabled(env, livemode) {
  return livemode === true && typeof env.GA4_API_SECRET === 'string' && SECRET_RE.test(env.GA4_API_SECRET);
}

// 返金の本文（client_id は取引ごとに固定の合成値。利用者の端末の ID は使わない）
function refundPayload(transactionId, value) {
  if (!REF_RE.test(String(transactionId || '')) || !Number.isInteger(value) || value <= 0) return null;
  return {
    client_id: `srv.${parseInt(transactionId.slice(0, 8), 16)}.${parseInt(transactionId.slice(8, 16), 16)}`,
    non_personalized_ads: true,
    events: [{ name: 'refund', params: { transaction_id: transactionId, currency: 'JPY', value } }],
  };
}

async function sendRefund({ env, fetchImpl, livemode, transactionId, value, logger = console }) {
  if (!enabled(env, livemode)) return 'disabled';
  const body = refundPayload(transactionId, value);
  if (!body) return 'invalid';
  const url = `${ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
    if (res && res.status >= 200 && res.status < 300) return 'sent';
    CP.logError(logger, 'ga4-mp', 'refund_rejected', CE.incidentId());
    return 'rejected';
  } catch {
    CP.logError(logger, 'ga4-mp', 'refund_unreachable', CE.incidentId());
    return 'failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 応答の後で送る（waitUntil が無い環境では送らない）
function scheduleRefund(waitUntil, args) {
  if (typeof waitUntil !== 'function' || !enabled(args.env, args.livemode)) return false;
  waitUntil(sendRefund(args).catch(() => 'failed'));
  return true;
}

module.exports = { MEASUREMENT_ID, enabled, refundPayload, sendRefund, scheduleRefund };
