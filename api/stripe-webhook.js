// api/stripe-webhook.js
// 完全解析の Stripe Webhook（Preview・Test のイベントだけ）。販売を閉じていても動く（返金・dispute を処理するため）。
//
//   POST /api/stripe-webhook   Stripe-Signature: t=...,v1=...   （生の本文）
//
// 設計方針
//   - Bearer 認証は使わない。生のリクエスト本文と Stripe-Signature だけで検証する（STRIPE_COMPLETE_WEBHOOK_SECRET）。
//     本文は req.body を使わずストリームから読む（Vercel の自動解析で本文が変わると署名を検証できないため）。
//   - イベント本文の値は信用しない。対象の Checkout Session・Charge・Dispute を Stripe から取り直して判断する。
//   - DB の更新は complete_04 の SQL 関数だけ（complete_apply_payment・_checkout_expired・_refund・_dispute・
//     complete_webhook_finish）。支払い確定で注文 paid・MENTOR ロック・権利・complete_reports（queued）を同時に作る。
//     この工程では生成処理を起動しない。
//   - 応答：処理済み・重複・恒久的な不一致（ignored）は HTTP 200。complete_retry_later、Stripe・DB の一時的な失敗は
//     failed を記録して HTTP 500（Stripe が再送し、failed のイベントは処理し直す）。
//   - 完全解析の注文でないイベント（metadata.app が違う・旧 ¥1,000 の決済など）は DB に書かずに 200。
//   - ログは理由コードと照合 ID だけ（URL・query・署名・メール・Stripe ID 全文を出さない）。
'use strict';
const { resolveAppEnv, requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const CE = require('../lib/complete-eligibility');
const CP = require('../lib/complete-payment');

const API = 'stripe-webhook';
const MAX_BODY_BYTES = 512 * 1024;
const ZERO_SHA = '0'.repeat(64);

function createHandler({ env, fetchImpl, stripeFactory, logger = console, now = () => Date.now() }) {
  const stripeClients = new Map();
  function stripeFor(key) {
    if (!stripeClients.has(key)) stripeClients.set(key, stripeFactory(key));
    return stripeClients.get(key);
  }
  function reply(res, status, body) {
    return res.status(status).json(body);
  }

  async function finish(conn, ev, status, code, orderId) {
    return CP.rpc(fetchImpl, conn, 'complete_webhook_finish', {
      p_event_id: ev.id, p_event_type: ev.type, p_livemode: false, p_event_created: ev.createdAt,
      p_status: status, p_error_code: code, p_order_id: orderId || null,
    });
  }

  // Checkout Session を取り直し、完全解析の注文なら { session, orderId } を返す。違えば { notOurs } / { mismatch }。
  async function sessionFor(stripe, sessionId, appEnv, expand) {
    if (!CP.CHECKOUT_SESSION_RE.test(sessionId || '')) return { notOurs: true };
    const session = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(sessionId, expand ? { expand } : undefined));
    if (!session || session.livemode !== false) return { mismatch: 'livemode_mismatch' };
    const meta = CP.checkoutMetadataOf(session, appEnv);
    if (!meta) return { notOurs: true };
    if (!meta.ok) return { mismatch: 'metadata_mismatch' };
    return { session, orderId: meta.orderId };
  }

  // PaymentIntent から完全解析の Checkout Session を探す（返金・dispute 用）
  async function sessionForPaymentIntent(stripe, paymentIntentId, appEnv) {
    if (!CP.PAYMENT_INTENT_RE.test(paymentIntentId || '')) return { notOurs: true };
    const list = await CP.stripeCall(() => stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 }));
    const s = list && Array.isArray(list.data) ? list.data[0] : null;
    if (!s) return { notOurs: true };
    return sessionFor(stripe, s.id, appEnv);
  }

  async function onCheckoutCompleted(conn, stripe, ev, obj) {
    const found = await sessionFor(stripe, CP.idOf(obj), conn.appEnv, ['line_items']);
    if (found.notOurs) return 'ignored:not_complete';
    if (found.mismatch) { await finish(conn, ev, 'ignored', found.mismatch); return `ignored:${found.mismatch}`; }
    const { session, orderId } = found;
    const orders = await CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(orderId)}` +
      '&select=id,offer,diagnosis_session_id,mentor_goal_catalog_version,mentor_goal_id');
    const order = orders[0] || null;
    let input = ZERO_SHA;
    if (order) {
      // 購入した Price が注文の offer の Price と一致すること（1行・数量1）
      const items = session.line_items && Array.isArray(session.line_items.data) ? session.line_items.data : null;
      const item = items && items.length === 1 ? items[0] : null;
      const priceId = item && CP.idOf(item.price);
      if (!item || item.quantity !== 1 || !priceId || priceId !== CP.priceIdFor(env, order.offer)) {
        await finish(conn, ev, 'ignored', 'price_mismatch', order.id);
        return 'ignored:price_mismatch';
      }
      const sid = encodeURIComponent(order.diagnosis_session_id);
      const [sessions, answers, results] = await Promise.all([
        CP.selectRows(fetchImpl, conn, `diagnosis_sessions?id=eq.${sid}&select=completed_at`),
        CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=eq.${sid}&select=encoded_answers`),
        CP.selectRows(fetchImpl, conn, `diagnosis_results?session_id=eq.${sid}&select=diagnosis_version,item_set_version,scoring_version,` +
          'translation_model_version,character_profile_version,mirror_model_version'),
      ]);
      const diagnosedDate = sessions[0] ? CP.jstDate(sessions[0].completed_at) : null;
      if (!answers[0] || !results[0] || !diagnosedDate) throw new CP.PaymentError('record_data_missing', true);
      input = CP.inputSha256({
        encodedAnswers: answers[0].encoded_answers, result: results[0],
        mentorGoalCatalogVersion: order.mentor_goal_catalog_version, mentorGoalId: order.mentor_goal_id, diagnosedDate,
      });
    }
    const m = CP.MATERIALS;
    return CP.rpc(fetchImpl, conn, 'complete_apply_payment', {
      p_event_id: ev.id, p_event_created: ev.createdAt, p_livemode: false, p_order_id: orderId,
      p_checkout_session_id: session.id, p_payment_intent_id: CP.idOf(session.payment_intent),
      p_amount_total: session.amount_total, p_currency: session.currency, p_payment_status: session.payment_status,
      p_content_version: m.contentVersion, p_template_version: m.templateVersion,
      p_content_sha256: m.contentSha256, p_template_sha256: m.templateSha256, p_input_sha256: input,
    });
  }

  async function onCheckoutExpired(conn, stripe, ev, obj) {
    const found = await sessionFor(stripe, CP.idOf(obj), conn.appEnv);
    if (found.notOurs) return 'ignored:not_complete';
    if (found.mismatch) { await finish(conn, ev, 'ignored', found.mismatch); return `ignored:${found.mismatch}`; }
    if (found.session.status !== 'expired') throw new CP.PaymentError('session_not_expired', true);
    return CP.rpc(fetchImpl, conn, 'complete_apply_checkout_expired', {
      p_event_id: ev.id, p_event_created: ev.createdAt, p_livemode: false, p_order_id: found.orderId, p_checkout_session_id: found.session.id,
    });
  }

  async function chargeOf(stripe, chargeId) {
    if (!/^(ch|py)_[A-Za-z0-9_]{8,200}$/.test(chargeId || '')) return null;
    return CP.stripeCall(() => stripe.charges.retrieve(chargeId));
  }

  async function onRefund(conn, stripe, ev, obj) {
    const charge = await chargeOf(stripe, CP.idOf(obj));
    if (!charge) return 'ignored:not_complete';
    const pi = CP.idOf(charge.payment_intent);
    const found = await sessionForPaymentIntent(stripe, pi, conn.appEnv);
    if (found.notOurs) return 'ignored:not_complete';
    const mismatch = found.mismatch || (charge.livemode !== false ? 'livemode_mismatch' : charge.currency !== 'jpy' ? 'currency_mismatch' : null);
    if (mismatch) { await finish(conn, ev, 'ignored', mismatch); return `ignored:${mismatch}`; }
    return CP.rpc(fetchImpl, conn, 'complete_apply_refund', {
      p_event_id: ev.id, p_event_created: ev.createdAt, p_livemode: false, p_order_id: found.orderId,
      p_payment_intent_id: pi, p_amount_refunded: Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null,
    });
  }

  async function onDispute(conn, stripe, ev, obj) {
    const disputeId = CP.idOf(obj);
    if (!/^du_[A-Za-z0-9_]{8,200}$/.test(disputeId || '')) return 'ignored:not_complete';
    const dispute = await CP.stripeCall(() => stripe.disputes.retrieve(disputeId));
    let pi = CP.idOf(dispute && dispute.payment_intent);
    if (!pi) {
      const charge = await chargeOf(stripe, CP.idOf(dispute && dispute.charge));
      pi = charge ? CP.idOf(charge.payment_intent) : null;
    }
    const found = await sessionForPaymentIntent(stripe, pi, conn.appEnv);
    if (found.notOurs) return 'ignored:not_complete';
    let action;
    if (ev.type === 'charge.dispute.created') action = 'opened';
    else if (dispute.status === 'won' || dispute.status === 'warning_closed') action = 'won';
    else if (dispute.status === 'lost') action = 'lost';
    const mismatch = found.mismatch || (dispute.livemode !== false ? 'livemode_mismatch' : !action ? 'dispute_not_closed' : null);
    if (mismatch) { await finish(conn, ev, 'ignored', mismatch); return `ignored:${mismatch}`; }
    return CP.rpc(fetchImpl, conn, 'complete_apply_dispute', {
      p_event_id: ev.id, p_event_created: ev.createdAt, p_livemode: false, p_order_id: found.orderId,
      p_payment_intent_id: pi, p_action: action,
    });
  }

  const HANDLERS = {
    'checkout.session.completed': onCheckoutCompleted,
    'checkout.session.expired': onCheckoutExpired,
    'charge.refunded': onRefund,
    'charge.dispute.created': onDispute,
    'charge.dispute.closed': onDispute,
  };

  return async function handler(req, res) {
    CP.setCommonHeaders(res);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(res, 405, { error: 'method_not_allowed' });
    }
    if (resolveAppEnv(env, { host: requestHost(req) }) !== 'preview') return reply(res, 404, { error: 'not_available' });
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, stripe: true });
    if (!guard.ok) {
      const incident = logEnvDenied(API, guard, logger);
      return reply(res, 503, { error: 'service_unavailable', incident_id: incident });
    }
    if (guard.appEnv !== 'preview' || guard.stripeMode !== 'test' || guard.projectRef !== env.SUPABASE_PREVIEW_PROJECT_REF) {
      return reply(res, 404, { error: 'not_available' });
    }
    const secret = env.STRIPE_COMPLETE_WEBHOOK_SECRET;
    if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
      const incident = CE.incidentId();
      CP.logError(logger, API, 'webhook_secret_missing', incident);
      return reply(res, 503, { error: 'service_unavailable', incident_id: incident });
    }

    let raw;
    try {
      raw = await CP.readRawBody(req, MAX_BODY_BYTES);
    } catch {
      return reply(res, 400, { error: 'invalid_request' });
    }
    if (raw.tooLarge) return reply(res, 413, { error: 'payload_too_large' });
    const headers = req.headers || {};
    const verified = CP.verifyStripeSignature(raw.body, headers['stripe-signature'], secret, Math.floor(now() / 1000));
    if (!verified.ok) {
      const incident = CE.incidentId();
      CP.logError(logger, API, verified.reason, incident);
      return reply(res, 400, { error: 'signature_invalid', incident_id: incident });
    }

    let event;
    try { event = JSON.parse(raw.body.toString('utf8')); } catch { return reply(res, 400, { error: 'invalid_request' }); }
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_]{8,200}$/.test(event.id)
        || typeof event.type !== 'string' || !Number.isInteger(event.created) || !event.data || !event.data.object) {
      return reply(res, 400, { error: 'invalid_request' });
    }
    // Live のイベントは Preview では扱わない（DB に書かない）
    if (event.livemode !== false) {
      const incident = CE.incidentId();
      CP.logError(logger, API, 'livemode_event', incident);
      return reply(res, 200, { received: true, result: 'ignored' });
    }
    const handle = HANDLERS[event.type];
    if (!handle) return reply(res, 200, { received: true, result: 'ignored' });

    const ev = { id: event.id, type: event.type, createdAt: new Date(event.created * 1000).toISOString() };
    const stripe = stripeFor(env.STRIPE_SECRET_KEY);
    try {
      const result = await handle(guard, stripe, ev, event.data.object);
      const kind = typeof result === 'string' && result.startsWith('ignored') ? 'ignored' : 'processed';
      return reply(res, 200, { received: true, result: kind });
    } catch (err) {
      // 恒久的な不一致（ignored）は各処理で 200 にしている。ここに来るものはすべて failed を記録して 500（Stripe が再送する）。
      // complete_retry_later・Stripe／DB の一時的な失敗のほか、想定外の DB 例外も権利を失わないよう再送に回す。
      const code = err instanceof CP.PaymentError ? err.code : 'internal_error';
      const incident = CE.incidentId();
      CP.logError(logger, API, code, incident);
      try {
        await finish(guard, ev, 'failed', code);
      } catch {
        // failed を記録できなくても 500 で再送させる（イベントの記録は再送時に作られる）
      }
      return reply(res, 500, { error: 'retry_later', incident_id: incident });
    }
  };
}

module.exports = createHandler({
  env: process.env,
  fetchImpl: (...args) => fetch(...args),
  stripeFactory: (key) => require('stripe')(key, { maxNetworkRetries: 1, timeout: 10000 }),
});
module.exports.createHandler = createHandler;
