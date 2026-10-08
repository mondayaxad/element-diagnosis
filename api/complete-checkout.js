// api/complete-checkout.js
// 完全解析の Checkout Session を作る。Preview だけ・COMPLETE_SALES_OPEN='true' のときだけ動く（未設定なら閉じる）。
//
//   POST /api/complete-checkout   Authorization: Bearer <Supabase access token>   { "diagnosisSessionId": "<uuid>" }
//        → 200 { checkoutUrl, offer, amount }
//
// 設計方針
//   - 確認の順：環境（Preview・接続先・販売開始）→ 認証 → 入力 → 本人の記録・登録完了・RC1・MENTOR 選択。
//   - 本文は diagnosisSessionId だけを受け付ける（金額・Price・user ID・目標 ID などは受け取らない。他の項目があれば 400）。
//   - offer（direct ¥3,000／upgrade ¥2,000）と Price はサーバーが決める。Price は Stripe から取得して
//     有効・JPY・金額・Test・一回払いを照合する。
//   - 旧 ¥1,000 の購入（診断コードのハッシュが一致）が未結び付けなら、購入時の Checkout Session を Stripe から取り直し、
//     購入時メールと Auth の確認済みメールが一致した時だけ complete_04 の結び付けを行って upgrade にする。
//     不一致・メールなし・取得できない場合は legacy_purchase_verification_required（¥3,000 へ誘導しない）。
//     メールは DB・ログに保存しない。
//   - 注文は complete_create_order（記録ごとに直列化・決済待ちの注文を返す）。Stripe の Idempotency-Key は注文 ID から固定し、
//     Checkout 作成後に DB の checkout_open 記録が失敗しても、次の要求で同じ Session を回収する。
//   - Checkout はカードだけ。customer_email は渡さない。metadata は order_id・app・env だけ。
//     success・cancel の URL は Host ヘッダーではなくサーバー設定（COMPLETE_CHECKOUT_ORIGIN）から作る（https の origin だけ・
//     Preview で許可した固定 origin と一致しなければ閉じる）。Stripe が返した決済画面の URL は https・checkout.stripe.com だけを返す。
//   - 応答・ログに Stripe ID 全文・メール・診断コード・記録 ID を出さない（応答の checkoutUrl は Stripe の決済画面の URL）。
'use strict';
const { resolveAppEnv, requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const CE = require('../lib/complete-eligibility');
const CP = require('../lib/complete-payment');

const MAX_BODY_BYTES = 512;
const API = 'complete-checkout';

function parseBody(req) {
  const raw = req.body;
  let obj = raw;
  let text;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    text = raw.toString('utf8');
    try { obj = JSON.parse(text); } catch { return { ok: false }; }
  } else if (raw && typeof raw === 'object') {
    text = JSON.stringify(raw);
  } else {
    return { ok: false };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== 'diagnosisSessionId' || !CE.isUuid(obj.diagnosisSessionId)) return { ok: false };
  return { ok: true, sessionId: obj.diagnosisSessionId };
}

// DB の例外 → 応答
const ORDER_ERRORS = {
  complete_record_not_found: [404, 'record_not_found'],
  complete_not_owner: [404, 'record_not_found'],
  complete_onboarding_required: [403, 'onboarding_required'],
  complete_version_not_eligible: [422, 'not_eligible'],
  complete_mentor_goal_required: [409, 'mentor_goal_required'],
  complete_mentor_goal_mismatch: [409, 'mentor_goal_required'],
  complete_repurchase_not_allowed: [409, 'repurchase_not_allowed'],
  complete_legacy_purchase_pending: [409, 'legacy_purchase_verification_required'],
  complete_upgrade_requires_analysis: [409, 'legacy_purchase_verification_required'],
  complete_direct_not_allowed_after_analysis: [409, 'offer_changed'],
  complete_idempotency_conflict: [409, 'offer_changed'],
};

function createHandler({ env, fetchImpl, stripeFactory, logger = console }) {
  const stripeClients = new Map();
  function stripeFor(key) {
    if (!stripeClients.has(key)) stripeClients.set(key, stripeFactory(key));
    return stripeClients.get(key);
  }
  function fail(res, status, code) {
    return res.status(status).json({ error: code });
  }
  function failLogged(res, status, code, reason) {
    const incident = CE.incidentId();
    CP.logError(logger, API, reason || code, incident);
    return res.status(status).json({ error: code, incident_id: incident });
  }

  async function loadState(conn, userId, sessionId) {
    const sid = encodeURIComponent(sessionId);
    const uid = encodeURIComponent(userId);
    const sessions = await CP.selectRows(fetchImpl, conn, `diagnosis_sessions?id=eq.${sid}&user_id=eq.${uid}&select=id,diagnosis_version`);
    if (!sessions[0]) return null;
    const [results, answers, profiles, goals, orders, rights, bindings] = await Promise.all([
      CP.selectRows(fetchImpl, conn, `diagnosis_results?session_id=eq.${sid}&select=diagnosis_version,item_set_version,scoring_version,` +
        'translation_model_version,character_profile_version,mirror_model_version'),
      CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=eq.${sid}&select=encoded_answers`),
      CP.selectRows(fetchImpl, conn, `profiles?id=eq.${uid}&select=onboarding_status`),
      CP.selectRows(fetchImpl, conn, `record_mentor_goals?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=goal_id,goal_catalog_version`),
      CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${sid}&select=status`),
      CP.selectRows(fetchImpl, conn, `record_entitlements?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=right_type,status`),
      CP.selectRows(fetchImpl, conn, `complete_legacy_bindings?diagnosis_session_id=eq.${sid}&user_id=eq.${uid}&select=legacy_entitlement_id`),
    ]);
    const answer = answers[0] || null;
    const hash = CE.legacyCodeHash(answer && answer.encoded_answers, sessions[0].diagnosis_version);
    let legacy = [];
    if (hash) {
      legacy = await CP.selectRows(fetchImpl, conn,
        `purchase_entitlements?diagnosis_code_hash=eq.${hash}&status=eq.active&product_type=in.(core1,complete)&select=id,stripe_checkout_session_id`);
    }
    let boundElsewhere = new Set();
    if (legacy.length) {
      const ids = legacy.map((l) => encodeURIComponent(l.id)).join(',');
      const all = await CP.selectRows(fetchImpl, conn, `complete_legacy_bindings?legacy_entitlement_id=in.(${ids})&select=legacy_entitlement_id`);
      boundElsewhere = new Set(all.map((b) => b.legacy_entitlement_id));
    }
    const boundHere = new Set(bindings.map((b) => b.legacy_entitlement_id));
    const goal = goals[0] || null;
    return {
      eligibility: CE.eligibilityOf(sessions[0].diagnosis_version, results[0] || null),
      onboardingCompleted: CE.isOnboardingComplete(profiles[0] && profiles[0].onboarding_status),
      goalSelected: !!(goal && CE.isMentorGoalId(goal.goal_id) && goal.goal_catalog_version === CE.MENTOR_CATALOG_VERSION),
      repurchaseBlocked: orders.some((o) => CE.REPURCHASE_BLOCKING_ORDER_STATUSES.includes(o.status))
        || rights.some((r) => r.right_type === 'complete'),
      hasAnalysis: rights.some((r) => r.right_type === 'analysis' && r.status === 'active')
        || legacy.some((l) => boundHere.has(l.id)),
      legacyCandidates: legacy.filter((l) => !boundElsewhere.has(l.id)),
      attempt: orders.length,
    };
  }

  // 旧 ¥1,000 の購入を、購入時メールと Auth の確認済みメールで照合して結び付ける。結び付けたら true。
  async function tryBindLegacy(conn, stripe, user, sessionId, candidates) {
    const authEmail = CP.normalizeEmail(user.email);
    if (!authEmail) return { bound: false, reason: 'auth_email_missing' };
    let reason = 'email_mismatch';
    for (const c of candidates) {
      if (typeof c.stripe_checkout_session_id !== 'string' || !CP.CHECKOUT_SESSION_RE.test(c.stripe_checkout_session_id)) {
        reason = 'stripe_session_unavailable';
        continue;
      }
      let legacySession;
      try {
        legacySession = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(c.stripe_checkout_session_id));
      } catch (err) {
        if (err.transient) throw err;
        reason = 'stripe_session_unavailable';
        continue;
      }
      if (!legacySession || legacySession.livemode !== false || legacySession.payment_status !== 'paid') {
        reason = 'purchase_not_eligible';
        continue;
      }
      const purchaseEmail = CP.normalizeEmail(legacySession.customer_details && legacySession.customer_details.email);
      if (!purchaseEmail) { reason = 'stripe_session_unavailable'; continue; }
      if (purchaseEmail !== authEmail) continue;
      try {
        await CP.rpc(fetchImpl, conn, 'complete_bind_legacy_purchase', {
          p_user_id: user.id, p_diagnosis_session_id: sessionId, p_legacy_entitlement_id: c.id, p_match_method: 'stripe_email_verified',
        });
        return { bound: true };
      } catch (err) {
        if (err.transient) throw err;
        reason = 'binding_conflict';
      }
    }
    return { bound: false, reason };
  }

  return async function handler(req, res) {
    CP.setCommonHeaders(res);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return fail(res, 405, 'method_not_allowed');
    }
    // 1. 環境：Production（と環境不明）では存在しない扱い。外部へは接続しない。
    if (resolveAppEnv(env, { host: requestHost(req) }) !== 'preview') return fail(res, 404, 'not_available');
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true, stripe: true });
    if (!guard.ok) {
      const incident = logEnvDenied(API, guard, logger);
      return res.status(503).json({ error: 'service_unavailable', incident_id: incident });
    }
    if (guard.appEnv !== 'preview' || guard.stripeMode !== 'test' || guard.projectRef !== env.SUPABASE_PREVIEW_PROJECT_REF) {
      return fail(res, 404, 'not_available');
    }
    if (!CP.salesOpen(env)) return fail(res, 503, 'sales_closed');
    const urls = CP.checkoutReturnUrls(env);
    if (!urls || !CP.priceIdFor(env, 'direct_complete') || !CP.priceIdFor(env, 'analysis_upgrade')) {
      return failLogged(res, 503, 'service_unavailable', 'checkout_config_missing');
    }

    // 2. 認証（入力の検査より先）
    const token = CP.bearerToken(req);
    if (!token) return fail(res, 401, 'not_authenticated');
    let user;
    try {
      user = await CP.authUser(fetchImpl, guard, token);
    } catch (err) {
      return failLogged(res, 503, 'service_unavailable', err.code);
    }
    if (!user) return fail(res, 401, 'not_authenticated');

    // 3. 入力
    const parsed = parseBody(req);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const sessionId = parsed.sessionId;

    const stripe = stripeFor(env.STRIPE_SECRET_KEY);
    try {
      // 4. 本人の記録と販売の前提
      const state = await loadState(guard, user.id, sessionId);
      if (!state) return fail(res, 404, 'record_not_found');
      if (!state.onboardingCompleted) return fail(res, 403, 'onboarding_required');
      if (!state.eligibility.eligible) return fail(res, 422, 'not_eligible');
      if (!state.goalSelected) return fail(res, 409, 'mentor_goal_required');
      if (state.repurchaseBlocked) return fail(res, 409, 'repurchase_not_allowed');

      // 5. offer をサーバーが決める
      let offer = 'direct_complete';
      if (state.hasAnalysis) {
        offer = 'analysis_upgrade';
      } else if (state.legacyCandidates.length) {
        const r = await tryBindLegacy(guard, stripe, user, sessionId, state.legacyCandidates);
        if (!r.bound) {
          const incident = CE.incidentId();
          CP.logError(logger, API, `legacy_${r.reason}`, incident);
          return res.status(409).json({ error: 'legacy_purchase_verification_required', incident_id: incident });
        }
        offer = 'analysis_upgrade';
      }

      // 6. 注文（決済待ちの注文があればそれを返す）
      const rows = await CP.rpc(fetchImpl, guard, 'complete_create_order', {
        p_user_id: user.id, p_diagnosis_session_id: sessionId, p_offer: offer,
        p_idempotency_key: CP.orderIdempotencyKey(user.id, sessionId, offer, state.attempt),
      });
      const order = Array.isArray(rows) ? rows[0] : null;
      if (!order || !CE.isUuid(order.order_id) || !CP.OFFER_AMOUNTS[order.offer]) return failLogged(res, 500, 'checkout_failed', 'order_invalid');
      const amount = CP.OFFER_AMOUNTS[order.offer];

      if (order.order_status === 'checkout_open') {
        if (!order.checkout_session_id) return failLogged(res, 500, 'checkout_failed', 'order_session_missing');
        const open = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.checkout_session_id));
        if (open && open.status === 'open' && CP.isStripeCheckoutUrl(open.url)) {
          return res.status(200).json({ checkoutUrl: open.url, offer: order.offer, amount });
        }
        return fail(res, 409, 'checkout_in_progress');
      }
      if (order.order_status !== 'created') return failLogged(res, 500, 'checkout_failed', 'order_status_unexpected');

      // 7. Price を Stripe から取得して照合
      const priceId = CP.priceIdFor(env, order.offer);
      const price = await CP.stripeCall(() => stripe.prices.retrieve(priceId));
      const priceProblem = CP.priceProblem(price, order.offer);
      if (priceProblem) {
        await CP.rpc(fetchImpl, guard, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'price_invalid' });
        return failLogged(res, 503, 'service_unavailable', priceProblem);
      }

      // 8. Checkout Session（注文 ID から固定した Idempotency-Key。同じ注文の再試行は同じ Session を返す）
      let session;
      try {
        session = await CP.stripeCall(() => stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: urls.successUrl,
          cancel_url: urls.cancelUrl,
          locale: 'ja',
          metadata: { order_id: order.order_id, app: CP.APP, env: guard.appEnv },
        }, { idempotencyKey: CP.stripeIdempotencyKey(order.order_id) }));
      } catch (err) {
        if (!err.transient) {
          await CP.rpc(fetchImpl, guard, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'stripe_error' });
        }
        throw err;
      }
      const meta = CP.checkoutMetadataOf(session, guard.appEnv);
      if (!session || !CP.CHECKOUT_SESSION_RE.test(session.id || '') || session.livemode !== false || !meta || !meta.ok
          || meta.orderId !== order.order_id || !CP.isStripeCheckoutUrl(session.url)
          || !Number.isInteger(session.expires_at)) {
        return failLogged(res, 500, 'checkout_failed', 'checkout_session_invalid');
      }
      // 9. checkout_open を記録（失敗しても、次の要求で同じ Idempotency-Key から同じ Session を回収する）
      try {
        await CP.rpc(fetchImpl, guard, 'complete_mark_checkout_open', {
          p_order_id: order.order_id, p_checkout_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
        });
      } catch (err) {
        return failLogged(res, 503, 'service_unavailable', `checkout_record_${err.code || 'failed'}`);
      }
      return res.status(200).json({ checkoutUrl: session.url, offer: order.offer, amount });
    } catch (err) {
      if (err instanceof CP.PaymentError) {
        const mapped = ORDER_ERRORS[err.code];
        if (mapped) return fail(res, mapped[0], mapped[1]);
        return failLogged(res, err.transient ? 503 : 502, err.transient ? 'service_unavailable' : 'checkout_failed', err.code);
      }
      return failLogged(res, 500, 'checkout_failed', 'internal_error');
    }
  };
}

module.exports = createHandler({
  env: process.env,
  fetchImpl: (...args) => fetch(...args),
  // Stripe SDK はリクエスト時に初めて読み込む（テストでは偽の stripeFactory を渡す）
  stripeFactory: (key) => require('stripe')(key, { maxNetworkRetries: 1, timeout: 10000 }),
});
module.exports.createHandler = createHandler;
