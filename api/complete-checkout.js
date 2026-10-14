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
//   - upgrade（¥2,000）の根拠は、新しい Checkout で買った解析レポートの権利（記録単位）だけ。
//     旧 Payment Link の購入（purchase_entitlements）は根拠にしない。新診断の記録に旧購入がある時は
//     legacy_purchase_not_eligible（完全解析を出さない）。旧購入の確認（?op=legacy-verify）は廃止（410）。
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
const GP = require('../lib/guest-purchase');
const PS = require('../lib/purchase-state');

const MAX_BODY_BYTES = 512;
const API = 'complete-checkout';

function queryOp(req) {
  const q = req.query && typeof req.query.op === 'string' ? req.query.op : (() => {
    try { return new URL(req.url || '/', 'http://x').searchParams.get('op'); } catch { return null; }
  })();
  return typeof q === 'string' && /^[a-z-]{3,32}$/.test(q) ? q : null;
}

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
  // product：'analysis'（解析レポート ¥1,000）だけを受け付ける。省略時は完全解析（offer はサーバーが決める）
  if (!keys.includes('diagnosisSessionId') || keys.some((k) => k !== 'diagnosisSessionId' && k !== 'product')
      || !CE.isUuid(obj.diagnosisSessionId) || (keys.includes('product') && obj.product !== 'analysis')) return { ok: false };
  return { ok: true, sessionId: obj.diagnosisSessionId, product: obj.product || 'complete' };
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
  complete_legacy_purchase_pending: [409, 'legacy_purchase_not_eligible'],
  complete_upgrade_requires_analysis: [409, 'offer_changed'],
  complete_direct_not_allowed_after_analysis: [409, 'offer_changed'],
  complete_idempotency_conflict: [409, 'offer_changed'],
  complete_analysis_already_purchased: [409, 'analysis_already_purchased'],
  complete_same_result_checkout_open: [409, 'checkout_in_progress'],
  complete_rights_suspended: [409, 'rights_suspended'],
};

function createHandler({ env, fetchImpl, stripeFactory, logger = console, waitUntil, storageFactory = null, now }) {
  const nowMs = now || (() => Date.now());
  const stripeClients = new Map();
  function stripeFor(key) {
    if (!stripeClients.has(key)) stripeClients.set(key, stripeFactory(key));
    return stripeClients.get(key);
  }
  const guestHandler = GP.createGuestHandler({
    env, fetchImpl, stripeFor: () => stripeFor(env.STRIPE_SECRET_KEY), logger, storageFactory,
    ...(waitUntil !== undefined ? { waitUntil } : {}), ...(now ? { now } : {}),
  });
  function fail(res, status, code) {
    return res.status(status).json({ error: code });
  }
  function failLogged(res, status, code, reason) {
    const incident = CE.incidentId();
    CP.logError(logger, API, reason || code, incident);
    return res.status(status).json({ error: code, incident_id: incident });
  }

  // 本人の記録の購入状態（lib/purchase-state.js：マイページ・目標の選択・閲覧と同じ規則）。本人の記録でなければ null。
  async function loadState(conn, userId, sessionId) {
    const facts = await PS.loadUserFacts((path) => CP.selectRows(fetchImpl, conn, path), userId);
    const st = PS.computeStates(facts)[sessionId];
    if (!st) return null;
    const profiles = await CP.selectRows(fetchImpl, conn, `profiles?id=eq.${encodeURIComponent(userId)}&select=onboarding_status`);
    const t = st.target;
    return {
      st,
      targetId: t.id,
      diagnosisVersion: t.session.diagnosis_version,
      eligibility: t.eligibility,
      onboardingCompleted: CE.isOnboardingComplete(profiles[0] && profiles[0].onboarding_status),
      goalSelected: !!(t.goal && CE.isMentorGoalId(t.goal.goal_id) && t.goal.goal_catalog_version === CE.MENTOR_CATALOG_VERSION),
      attempt: facts.orders.filter((o) => o.diagnosis_session_id === t.id).length,
    };
  }

  return async function handler(req, res) {
    CP.setCommonHeaders(res);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return fail(res, 405, 'method_not_allowed');
    }
    // 1. 環境：Preview（Stripe Test）と Production（Stripe Live）の正しい組み合わせだけ。環境不明では存在しない扱い。
    const appEnv0 = resolveAppEnv(env, { host: requestHost(req) });
    if (appEnv0 !== 'preview' && appEnv0 !== 'production') return fail(res, 404, 'not_available');
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true, stripe: true });
    if (!guard.ok) {
      const incident = logEnvDenied(API, guard, logger);
      return res.status(503).json({ error: 'service_unavailable', incident_id: incident });
    }
    if (!CP.paymentEnvOk(guard, env)) return fail(res, 404, 'not_available');
    // ゲスト購入・購入完了ページ・引き継ぎ（lib/guest-purchase.js）
    const op = queryOp(req);
    // 旧 ¥1,000（Payment Link）の購入の確認・結び付けは廃止（旧購入は完全解析の根拠にしない）
    if (op === 'legacy-verify') return fail(res, 410, 'legacy_verification_retired');
    if (op) return guestHandler(op, req, res, guard);
    if (!CP.salesOpen(env)) return fail(res, 503, 'sales_closed');
    const urls = CP.checkoutReturnUrls(env, guard.appEnv, 'user');
    if (!urls || !CP.priceIdFor(env, 'direct_complete') || !CP.priceIdFor(env, 'analysis_upgrade') || !CP.priceIdFor(env, 'analysis')) {
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
      // 4. 本人の記録と販売の前提。同じ本人・同じ診断結果の記録は1つの権利として扱い、権利の所在（target）の記録で購入する
      const state = await loadState(guard, user.id, sessionId);
      if (!state) return fail(res, 404, 'record_not_found');
      if (!state.onboardingCompleted) return fail(res, 403, 'onboarding_required');
      const st = state.st;
      const targetId = state.targetId;
      // この端末の Cookie に、同じ診断結果の未引き継ぎの支払い済みのゲスト購入がある：アカウントで重ねて売らない（先に引き継ぐ）
      const code = (PS.one(st.record.session.diagnosis_answers) || {}).encoded_answers;
      if (code && await guestHandler.cookieOwnsCode(req, guard, code, user.email)) return fail(res, 409, 'guest_purchase_unclaimed');
      // 別の端末・消えた Cookie でも：このアカウントのメールで支払った未引き継ぎのゲストの購入があれば、重ねて売らない
      //   （マイページの案内から、購入時メールの確認で引き継ぐ）
      if (code && await guestHandler.emailOwnsCode(guard, user.email, code)) return fail(res, 409, 'guest_purchase_unclaimed');

      // 5. offer をサーバーが決める
      let offer = 'direct_complete';
      if (parsed.product === 'analysis') {
        // 解析レポート ¥1,000（ETI v2 の記録・本人の同じ診断結果で新 Checkout の解析を未購入の時だけ。旧購入では断らない）
        if (state.diagnosisVersion !== 'ETI-2.0') return fail(res, 422, 'not_eligible');
        if (st.analysisPurchased) return fail(res, 409, 'analysis_already_purchased');
        offer = 'analysis';
      } else if (!state.eligibility.eligible) {
        return fail(res, 422, 'not_eligible');
      } else if (!state.goalSelected) {
        return fail(res, 409, 'mentor_goal_required');
      } else if (st.completeOwned) {
        // 完全解析を購入済み（返金・dispute を含む）。解析レポートだけの購入（¥1,000）はここに数えない
        return fail(res, 409, 'repurchase_not_allowed');
      } else if (st.analysisSource) {
        offer = 'analysis_upgrade';
      } else if (st.analysisSuspended) {
        return fail(res, 409, 'rights_suspended');
      }
      // 旧 Payment Link の購入は価格の判断に使わない（画面は結び付け済みの旧購入の記録に申込を出さないが、ここでは断らない）

      // 払える決済画面は、1人・1診断結果につき常に1つだけ：同じ診断結果の別の記録と、この端末のゲストの決済中の画面を
      //   Stripe で先に閉じる（¥1,000 の画面を開いたまま ¥3,000 を選んだ等でも、選んだ方を買える。古い画面では支払えない）。
      //   支払い済みだった画面は反映して、新しく売らない。この記録の決済中は、下の注文の作成で同じ規則で扱う
      const groupOpen = (await CP.selectRows(fetchImpl, guard, `complete_orders?diagnosis_session_id=in.(${st.memberIds.join(',')})` +
        `&user_id=eq.${encodeURIComponent(user.id)}&status=in.(created,checkout_open)` +
        '&select=id,diagnosis_session_id,offer,status,stripe_checkout_session_id,user_id,created_at'))
        .filter((o) => o.diagnosis_session_id !== targetId);
      const cookieOpen = code ? await guestHandler.cookieOpenForCode(req, guard, code) : [];
      const closedGroup = await guestHandler.closeOpenOrders(guard, groupOpen);
      if (closedGroup === 'paid') return fail(res, 409, 'purchase_completed');
      const closedCookie = await guestHandler.closeOpenOrders(guard, cookieOpen);
      // この端末のログインなしの画面で払い済みだった：ゲストの購入として反映した（アカウントへは引き継ぎで移す）
      if (closedCookie === 'paid') return fail(res, 409, 'guest_purchase_completed');
      if (closedGroup === 'busy' || closedCookie === 'busy') return fail(res, 409, 'checkout_in_progress');

      // 6. 注文（決済待ちの注文があればそれを返す）。offer が違う・Stripe の画面が閉じている決済待ちは、
      //    Stripe の Session を閉じてから片付け、1回だけ作り直す（別の価格の画面を返さない）。
      let order = null;
      let replaced = 0;
      let cancelled = false;
      for (let attempt = state.attempt; attempt <= state.attempt + 1 + replaced; attempt++) {
        const rows = await CP.rpc(fetchImpl, guard, 'complete_create_order', {
          p_user_id: user.id, p_diagnosis_session_id: targetId, p_offer: offer,
          p_idempotency_key: CP.orderIdempotencyKey(user.id, targetId, offer, attempt),
        });
        order = Array.isArray(rows) ? rows[0] : null;
        if (!order || !CE.isUuid(order.order_id) || !CP.OFFER_AMOUNTS[order.offer]) return failLogged(res, 500, 'checkout_failed', 'order_invalid');
        // 同じ鍵で前に作った注文が、もう終わっている（返金・期限切れ・中止・失敗）：次の鍵で作り直す（返金の後の買い直し・申込の切り替えの後）。
        //   鍵は「記録の注文の数」から作るため、切り替えで1つ先の鍵を使った後は、次の申込で同じ鍵になることがある
        if (!order.created && ['refunded', 'expired', 'canceled', 'failed'].includes(order.order_status) && replaced < 5) {
          replaced += 1;
          continue;
        }
        // 作ったまま 4 分を過ぎた注文（Stripe・DB の一時的な失敗で画面を渡せなかった）：片付けて次の鍵で作り直す。
        //   画面の URL は渡していない（渡すのは checkout_open にした後だけ）。期限（作成から 35 分）が近い画面を作らない
        if (!order.created && order.order_status === 'created' && replaced < 5
            && nowMs() - await guestHandler.orderCreatedAt(guard, order.order_id) > 4 * 60 * 1000) {
          await CP.rpc(fetchImpl, guard, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'stale' });
          replaced += 1;
          continue;
        }
        if (order.order_status !== 'checkout_open' && !(order.order_status === 'created' && order.offer !== offer)) break;
        let open = null;
        let settled = false;
        if (order.order_status === 'checkout_open') {
          if (!order.checkout_session_id) return failLogged(res, 500, 'checkout_failed', 'order_session_missing');
          open = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.checkout_session_id));
          if (open && open.status === 'open' && order.offer === offer && CP.isStripeCheckoutUrl(open.url)) {
            return res.status(200).json({ checkoutUrl: open.url, offer: order.offer, amount: CP.OFFER_AMOUNTS[order.offer] });
          }
          if (open && open.status === 'complete') {
            // Stripe では支払い済みで、反映（Webhook）がまだ：ここで反映してから、購入済みとして返す（もう一度売らない）
            const r = await guestHandler.settleOrder(guard, { id: order.order_id, status: 'checkout_open', stripe_checkout_session_id: order.checkout_session_id, user_id: user.id });
            return fail(res, 409, r === 'paid' ? 'purchase_completed' : 'checkout_in_progress');
          }
          if (!open) return fail(res, 409, 'checkout_in_progress');
          if (open.status === 'open') {
            // 閉じる間に支払いが完了した：反映して、購入済みとして返す（エラーにしない）
            const r = await guestHandler.settleOrder(guard, { id: order.order_id, status: 'checkout_open', stripe_checkout_session_id: order.checkout_session_id, user_id: user.id },
              { expireIfOpen: true, closeAs: 'canceled' });
            if (r === 'paid') return fail(res, 409, 'purchase_completed');
            if (r === 'open' || r === null) return fail(res, 409, 'checkout_in_progress');
            settled = true; // 閉じて片付けた（canceled・expired）
          }
        }
        if (cancelled) return fail(res, 409, 'checkout_in_progress');
        cancelled = true;
        if (!settled) await CP.rpc(fetchImpl, guard, 'complete_cancel_open_order', { p_order_id: order.order_id, p_checkout_session_id: order.checkout_session_id || null });
      }
      const amount = CP.OFFER_AMOUNTS[order.offer];
      if (order.order_status !== 'created') return failLogged(res, 500, 'checkout_failed', 'order_status_unexpected');
      // 金額は offer からだけ決まる（¥2,000 のアップグレードを ¥3,000・¥1,000 で作らない）。Stripe へ問い合わせる前に確かめる
      if (order.offer !== offer || amount !== CP.OFFER_AMOUNTS[offer]) {
        await CP.rpc(fetchImpl, guard, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'offer_mismatch' });
        return failLogged(res, 409, 'offer_changed', 'offer_mismatch');
      }

      const expiresAt = await guestHandler.orderExpiresAt(guard, order.order_id);
      if (!expiresAt) return failLogged(res, 500, 'checkout_failed', 'order_invalid');

      // 7. Price を Stripe から取得して照合
      const priceId = CP.priceIdFor(env, order.offer);
      const price = await CP.stripeCall(() => stripe.prices.retrieve(priceId));
      const priceProblem = CP.priceProblem(price, order.offer, guard.stripeMode);
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
          expires_at: expiresAt,
          metadata: { order_id: order.order_id, app: CP.APP, env: guard.appEnv },
        }, { idempotencyKey: CP.stripeIdempotencyKey(order.order_id) }));
      } catch (err) {
        if (!err.transient) {
          await CP.rpc(fetchImpl, guard, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'stripe_error' });
        }
        throw err;
      }
      const meta = CP.checkoutMetadataOf(session, guard.appEnv);
      if (!session || !CP.checkoutSessionIdOk(session.id, guard.stripeMode) || session.livemode !== CP.livemodeOf(guard) || !meta || !meta.ok
          || meta.orderId !== order.order_id || !CP.isStripeCheckoutUrl(session.url)
          || !Number.isInteger(session.expires_at)) {
        return failLogged(res, 500, 'checkout_failed', 'checkout_session_invalid');
      }
      // Stripe が作った決済画面の金額・通貨も、注文の金額と一致すること（違えば画面を閉じて注文を片付ける）
      if (session.amount_total !== amount || session.currency !== 'jpy') {
        try { await CP.stripeCall(() => stripe.checkout.sessions.expire(session.id)); } catch { /* 期限切れで閉じる */ }
        await CP.rpc(fetchImpl, guard, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'amount_mismatch' });
        return failLogged(res, 503, 'service_unavailable', 'checkout_amount_mismatch');
      }
      // 9. checkout_open を記録（失敗しても、次の要求で同じ Idempotency-Key から同じ Session を回収する）
      try {
        await CP.rpc(fetchImpl, guard, 'complete_mark_checkout_open', {
          p_order_id: order.order_id, p_checkout_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
        });
      } catch (err) {
        // 注文がもう決済待ちでない（返金・異議申し立て・引き継ぎで片付けた）：作った画面は渡さず、Stripe で閉じる
        if (err && err.code === 'complete_order_not_open') {
          try { await CP.stripeCall(() => stripe.checkout.sessions.expire(session.id)); } catch { /* 35 分で切れる */ }
          return fail(res, 409, 'offer_changed');
        }
        return failLogged(res, 503, 'service_unavailable', `checkout_record_${err.code || 'failed'}`);
      }
      // 作っている間に ¥1,000 の返金・異議申し立てが入った：根拠の無い ¥2,000 の画面は渡さない（閉じて片付ける）
      if (!(await guestHandler.upgradeBasisStillActive(guard, order, session))) return fail(res, 409, 'offer_changed');
      // 同時に別のタブ（ゲスト）で、この画面より前に作られた同じ結果の画面を閉じる（払える画面は1つ。後の画面はその申込が閉じる）
      if (code) {
        const mineAt = await guestHandler.orderCreatedAt(guard, order.order_id);
        const older = (await guestHandler.cookieOpenForCode(req, guard, code)).filter((o) => Date.parse(o.created_at) < mineAt);
        if (older.length) await guestHandler.closeOpenOrders(guard, older);
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
