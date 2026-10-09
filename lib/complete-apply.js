// lib/complete-apply.js
// 支払い済みの Checkout Session を注文へ適用する（Webhook と、購入完了ページでの Stripe への問い合わせの両方から使う）。
//   ・Session は呼び出し側がサーバーの鍵で Stripe から取得したものだけを渡す（ブラウザの値は使わない）。
//   ・Price（line_items が1件・数量1・offer の Price）・金額・通貨・モードを照合し、DB の complete_apply_payment で
//     注文 paid・権利・（完全解析は MENTOR ロックと生成物 queued）を1トランザクションで行う。
//   ・同じ Session を何度適用しても、権利・生成物・注文は増えない（DB 側で noop／duplicate）。
//   ・ゲストの注文は、購入時のメールを HMAC にして記録する（メール自体は保存しない・ログに出さない）。
'use strict';
const crypto = require('crypto');
const CP = require('./complete-payment');

const ZERO_SHA = '0'.repeat(64);

// 購入時メールの HMAC（Cookie を失った時の復旧照合用）。鍵は COMPLETE_VIEW_TOKEN_SECRET から用途別に導出する。
function purchaseEmailHmac(env, email) {
  const v = CP.normalizeEmail(email);
  const secret = env.COMPLETE_VIEW_TOKEN_SECRET;
  if (!v || typeof secret !== 'string' || secret.length < 43) return null;
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.alloc(0), Buffer.from('purchase-email-hmac-v1'), 32));
  return crypto.createHmac('sha256', key).update(v).digest('hex');
}

// session：stripe.checkout.sessions.retrieve(id, { expand: ['line_items'] }) の結果。orderId は metadata から確認済みの値。
// 戻り値：DB の結果（applied／noop／duplicate／ignored:<理由>）
async function applyPaidSession({ env, fetchImpl, conn, session, orderId, eventId, eventCreatedIso }) {
  const livemode = CP.livemodeOf(conn);
  const orders = await CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(orderId)}` +
    '&select=id,offer,buyer,diagnosis_session_id,mentor_goal_catalog_version,mentor_goal_id');
  const order = orders[0] || null;
  let input = ZERO_SHA;
  if (order) {
    const items = session.line_items && Array.isArray(session.line_items.data) ? session.line_items.data : null;
    const item = items && items.length === 1 ? items[0] : null;
    const priceId = item && CP.idOf(item.price);
    if (!item || item.quantity !== 1 || !priceId || priceId !== CP.priceIdFor(env, order.offer)) {
      await CP.rpc(fetchImpl, conn, 'complete_webhook_finish', {
        p_event_id: eventId, p_event_type: 'checkout.session.completed', p_livemode: livemode, p_event_created: eventCreatedIso,
        p_status: 'ignored', p_error_code: 'price_mismatch', p_order_id: order.id,
      });
      return 'ignored:price_mismatch';
    }
    if (order.offer !== 'analysis') {
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
  }
  const m = CP.MATERIALS;
  const isAnalysis = order && order.offer === 'analysis';
  const result = await CP.rpc(fetchImpl, conn, 'complete_apply_payment', {
    p_event_id: eventId, p_event_created: eventCreatedIso, p_livemode: livemode, p_order_id: orderId,
    p_checkout_session_id: session.id, p_payment_intent_id: CP.idOf(session.payment_intent),
    p_amount_total: session.amount_total, p_currency: session.currency, p_payment_status: session.payment_status,
    p_content_version: isAnalysis ? null : m.contentVersion, p_template_version: isAnalysis ? null : m.templateVersion,
    p_content_sha256: isAnalysis ? null : m.contentSha256, p_template_sha256: isAnalysis ? null : m.templateSha256,
    p_input_sha256: isAnalysis ? null : input,
  });
  if (order && order.buyer === 'guest' && (result === 'applied' || result === 'noop' || result === 'duplicate')) {
    const hmac = purchaseEmailHmac(env, session.customer_details && session.customer_details.email);
    if (hmac) await CP.rpc(fetchImpl, conn, 'complete_set_purchase_email', { p_order_id: orderId, p_purchase_email_hmac: hmac });
  }
  return result;
}

module.exports = { applyPaidSession, purchaseEmailHmac, ZERO_SHA };
