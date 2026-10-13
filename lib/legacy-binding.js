// lib/legacy-binding.js
// 旧 ¥1,000（Payment Link・purchase_entitlements）の購入を、本人の診断記録へ一度だけ結び付ける（complete_legacy_bindings）。
// 完全解析の Checkout（api/complete-checkout.js）と、確認だけの操作（?op=legacy-verify）の両方から使う。
//
//   ・対象はログイン中の本人が所有する記録だけ（サーバーが diagnosis_sessions の所有者で確かめる）。
//   ・診断コードのハッシュの一致だけでは結び付けない。購入時の Stripe Checkout Session をサーバーの鍵で取り直し、
//     支払い済み・モード（Test／Live）の一致・購入時メールと、Auth の確認済みメール（正規化）の一致を確かめる。
//   ・結び付けは DB 関数 complete_bind_legacy_purchase（旧購入権1件 → 1人・1記録・一度だけ。同じ組み合わせの再実行は noop）。
//   ・Stripe Checkout Session は作らない・注文も作らない（課金を始めない）。
//   ・戻り値・ログにメール・Stripe ID・記録 ID を入れない（理由コードだけ）。
'use strict';
const CE = require('./complete-eligibility');
const CP = require('./complete-payment');

// 結果の status：
//   bound（結び付けた）／already_bound（この記録に結び付け済み）
//   record_not_found／no_legacy_purchase／bound_elsewhere（別の記録に結び付け済み）
//   auth_email_missing／auth_email_unconfirmed／email_mismatch
//   purchase_not_paid／livemode_mismatch／stripe_session_unavailable
//   Stripe・DB の一時的な失敗は例外（PaymentError transient）
async function verifyLegacyForRecord({ fetchImpl, conn, stripe, user, sessionId }) {
  const sid = encodeURIComponent(sessionId);
  const uid = encodeURIComponent(user.id);
  const sessions = await CP.selectRows(fetchImpl, conn, `diagnosis_sessions?id=eq.${sid}&user_id=eq.${uid}&select=id,diagnosis_version`);
  if (!sessions[0]) return { status: 'record_not_found' };
  const answers = await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=eq.${sid}&select=encoded_answers`);
  const hash = CE.legacyCodeHash(answers[0] && answers[0].encoded_answers, sessions[0].diagnosis_version);
  if (!hash) return { status: 'no_legacy_purchase' };
  const legacy = await CP.selectRows(fetchImpl, conn,
    `purchase_entitlements?diagnosis_code_hash=eq.${hash}&status=eq.active&product_type=in.(core1,complete)&select=id,stripe_checkout_session_id`);
  if (!legacy.length) return { status: 'no_legacy_purchase' };
  const ids = legacy.map((l) => encodeURIComponent(l.id)).join(',');
  const bindings = await CP.selectRows(fetchImpl, conn,
    `complete_legacy_bindings?legacy_entitlement_id=in.(${ids})&select=legacy_entitlement_id,user_id,diagnosis_session_id`);
  if (bindings.some((b) => b.user_id === user.id && b.diagnosis_session_id === sessionId)) return { status: 'already_bound' };
  const taken = new Set(bindings.map((b) => b.legacy_entitlement_id));
  const candidates = legacy.filter((l) => !taken.has(l.id));
  if (!candidates.length) return { status: 'bound_elsewhere' };

  const authEmail = CP.normalizeEmail(user.email);
  if (!authEmail) return { status: user.emailUnconfirmed ? 'auth_email_unconfirmed' : 'auth_email_missing' };

  const reasons = [];
  for (const c of candidates) {
    if (!CP.checkoutSessionIdOk(c.stripe_checkout_session_id, conn.stripeMode)) { reasons.push('stripe_session_unavailable'); continue; }
    let s;
    try {
      s = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(c.stripe_checkout_session_id));
    } catch (err) {
      if (err.transient) throw err;
      reasons.push('stripe_session_unavailable');
      continue;
    }
    if (!s) { reasons.push('stripe_session_unavailable'); continue; }
    if (s.livemode !== CP.livemodeOf(conn)) { reasons.push('livemode_mismatch'); continue; }
    if (s.payment_status !== 'paid') { reasons.push('purchase_not_paid'); continue; }
    const purchaseEmail = CP.normalizeEmail(s.customer_details && s.customer_details.email);
    if (!purchaseEmail) { reasons.push('stripe_session_unavailable'); continue; }
    if (purchaseEmail !== authEmail) { reasons.push('email_mismatch'); continue; }
    try {
      const r = await CP.rpc(fetchImpl, conn, 'complete_bind_legacy_purchase', {
        p_user_id: user.id, p_diagnosis_session_id: sessionId, p_legacy_entitlement_id: c.id, p_match_method: 'stripe_email_verified',
      });
      return { status: r === 'noop' ? 'already_bound' : 'bound' };
    } catch (err) {
      if (err.transient) throw err;
      reasons.push('bound_elsewhere');
    }
  }
  // 利用者に伝える理由：メール不一致を最優先（本人が対処できる）、次に支払い・モード・取得不可・結び付け済み
  const order = ['email_mismatch', 'purchase_not_paid', 'livemode_mismatch', 'stripe_session_unavailable', 'bound_elsewhere'];
  return { status: order.find((r) => reasons.includes(r)) || 'stripe_session_unavailable' };
}

// legacy-verify の応答（HTTP ステータス・理由コード）
const VERIFY_RESPONSES = Object.freeze({
  bound: [200, { result: 'bound' }],
  already_bound: [200, { result: 'already_bound' }],
  record_not_found: [404, { error: 'record_not_found' }],
  no_legacy_purchase: [404, { error: 'legacy_purchase_not_found' }],
  bound_elsewhere: [409, { error: 'legacy_bound_elsewhere' }],
  auth_email_missing: [403, { error: 'legacy_email_missing' }],
  auth_email_unconfirmed: [403, { error: 'legacy_email_unconfirmed' }],
  email_mismatch: [409, { error: 'legacy_email_mismatch' }],
  purchase_not_paid: [409, { error: 'legacy_purchase_not_paid' }],
  livemode_mismatch: [409, { error: 'legacy_purchase_unverifiable' }],
  stripe_session_unavailable: [409, { error: 'legacy_purchase_unverifiable' }],
});

module.exports = { verifyLegacyForRecord, VERIFY_RESPONSES };
