// テスト用の偽の Stripe SDK（外部へは接続しない）。api/complete-checkout.js・api/stripe-webhook.js の stripeFactory に渡す。
//   ・Checkout Session の作成は Idempotency-Key ごとに同じ Session を返す（同じキー・別の内容は idempotency_error）。
//   ・fail(method, err) で次の1回の呼び出しを失敗させる。
//   ・pay・refund・dispute で Stripe 側の状態を進め、event() で署名付きの Webhook 要求を作る。
'use strict';
const crypto = require('crypto');
const { Readable } = require('stream');
const CP = require('../../lib/complete-payment');

const rid = (p) => `${p}${crypto.randomBytes(12).toString('hex')}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const stripeError = (type, statusCode, code) => Object.assign(new Error(type), { type, statusCode, code });

function fakeStripe({ prices = {} } = {}) {
  const st = { prices: { ...prices }, sessions: {}, charges: {}, disputes: {}, idem: {}, calls: [], failures: {} };
  function call(method, fn) {
    st.calls.push(method);
    const queue = st.failures[method];
    if (queue && queue.length) throw queue.shift();
    return fn();
  }
  const missing = () => stripeError('StripeInvalidRequestError', 404, 'resource_missing');
  const client = {
    prices: {
      retrieve: async (id) => call('prices.retrieve', () => { if (!st.prices[id]) throw missing(); return clone(st.prices[id]); }),
    },
    checkout: {
      sessions: {
        create: async (params, opts = {}) => call('checkout.sessions.create', () => {
          st.lastCreate = { params: clone(params), opts: clone(opts) };
          const key = opts.idempotencyKey;
          const sig = JSON.stringify(params);
          if (key && st.idem[key]) {
            if (st.idem[key].sig !== sig) throw stripeError('StripeIdempotencyError', 400, 'idempotency_error');
            return clone(st.sessions[st.idem[key].id]);
          }
          const price = st.prices[params.line_items[0].price];
          if (!price) throw missing();
          const id = rid('cs_test_');
          st.sessions[id] = {
            id, object: 'checkout.session', livemode: false, status: 'open', payment_status: 'unpaid',
            url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Math.floor(Date.now() / 1000) + 86400,
            amount_total: price.unit_amount, currency: price.currency, metadata: clone(params.metadata || {}),
            payment_intent: null, customer_details: null,
            line_items: { data: params.line_items.map((li) => ({ price: { id: li.price }, quantity: li.quantity })) },
          };
          if (key) st.idem[key] = { id, sig };
          return clone(st.sessions[id]);
        }),
        retrieve: async (id, opts) => call('checkout.sessions.retrieve', () => {
          const s = st.sessions[id];
          if (!s) throw missing();
          const out = clone(s);
          if (!(opts && Array.isArray(opts.expand) && opts.expand.includes('line_items'))) delete out.line_items;
          return out;
        }),
        expire: async (id) => call('checkout.sessions.expire', () => {
          const s = st.sessions[id];
          if (!s) throw missing();
          if (s.status !== 'open') throw stripeError('StripeInvalidRequestError', 400, 'checkout_session_not_open');
          s.status = 'expired';
          return clone(s);
        }),
        list: async (q) => call('checkout.sessions.list', () => ({
          data: Object.values(st.sessions).filter((s) => s.payment_intent === q.payment_intent).slice(0, q.limit || 10).map(clone),
        })),
      },
    },
    charges: {
      retrieve: async (id) => call('charges.retrieve', () => { if (!st.charges[id]) throw missing(); return clone(st.charges[id]); }),
    },
    disputes: {
      retrieve: async (id) => call('disputes.retrieve', () => { if (!st.disputes[id]) throw missing(); return clone(st.disputes[id]); }),
    },
  };
  return {
    st,
    client,
    factory: () => client,
    fail(method, err) { (st.failures[method] = st.failures[method] || []).push(err || stripeError('StripeConnectionError', 0)); },
    // 旧 ¥1,000 の購入（verify の経路で作られた Session）
    legacySession({ email, paid = true, livemode = false } = {}) {
      const id = rid('cs_test_');
      st.sessions[id] = { id, livemode, status: 'complete', payment_status: paid ? 'paid' : 'unpaid', metadata: {},
        customer_details: email === undefined ? null : { email }, amount_total: 1000, currency: 'jpy', payment_intent: rid('pi_') };
      return id;
    },
    pay(sessionId, over = {}) {
      const s = st.sessions[sessionId];
      Object.assign(s, { status: 'complete', payment_status: 'paid', payment_intent: s.payment_intent || rid('pi_') }, over);
      const ch = rid('ch_');
      st.charges[ch] = { id: ch, livemode: false, payment_intent: s.payment_intent, amount: s.amount_total, amount_refunded: 0, currency: s.currency };
      return { chargeId: ch, paymentIntentId: s.payment_intent };
    },
    expire(sessionId) { st.sessions[sessionId].status = 'expired'; },
    refund(chargeId, amount) { st.charges[chargeId].amount_refunded = amount; },
    dispute(chargeId, status = 'needs_response') {
      const du = rid('du_');
      st.disputes[du] = { id: du, livemode: false, charge: chargeId, payment_intent: st.charges[chargeId].payment_intent, status };
      return du;
    },
    setDispute(du, status) { st.disputes[du].status = status; },
  };
}

// 署名付きの Webhook 要求（生の本文のストリーム）
function eventRequest({ type, objectId, secret, created = Math.floor(Date.now() / 1000), id = rid('evt_'), livemode = false,
  signedAt = Math.floor(Date.now() / 1000), tamper = null, signature, extra = {} }) {
  const event = { id, object: 'event', type, created, livemode, data: { object: { id: objectId, ...extra } } };
  let raw = Buffer.from(JSON.stringify(event));
  const sig = signature !== undefined ? signature : CP.signPayload(raw, secret, signedAt);
  if (tamper) raw = tamper(raw);
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.headers = sig === null ? {} : { 'stripe-signature': sig };
  return { req, event };
}

module.exports = { fakeStripe, eventRequest, stripeError };
