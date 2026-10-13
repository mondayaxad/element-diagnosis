// lib/guest-purchase.js
// 診断完了ページからのゲスト購入（ログイン不要）と、購入後のマイページへの引き継ぎ。
// api/complete-checkout.js が ?op=<名前> で振り分ける（Vercel の関数の数を増やさない）。
//
//   POST /api/complete-checkout?op=guest-goals     {}                          → { salesOpen, catalog }（MENTOR 目標の一覧）
//   POST /api/complete-checkout?op=guest-checkout  { offer, code, goal? }      → { checkoutUrl, offer, amount }
//   POST /api/complete-checkout?op=guest-status    { code? }                   → { salesOpen, purchases: [...] }
//   POST /api/complete-checkout?op=guest-report    { ref }                     → { url }（解析レポート。15分の閲覧リンク）
//   POST /api/complete-checkout?op=guest-view      { ref }                     → { viewUrl }（完全解析。300秒の閲覧リンク）
//   POST /api/complete-checkout?op=guest-claim     { ref }   Bearer            → { result }
//   POST /api/complete-checkout?op=guest-recover   {}        Bearer（メール OTP 直後） → { claimed, skipped }
//   POST /api/complete-checkout?op=guest-cancel    {}                          → { closed, paid }（決済をやり直す・Stripe で戻った）
//   POST /api/complete-checkout?op=user-reconcile  { cancel? } Bearer          → { applied, closed }（マイページへ戻った）
//   POST /api/complete-checkout?op=user-checkout-reset { diagnosisSessionId } Bearer → { result }（決済をやり直す）
//
// 方針
//   ・金額・offer・権利はサーバーが決める。診断コードはサーバーが正本エンジンで回答へ戻し、結果を算出し直して記録を作る
//     （ブラウザの結果・価格・種類は使わない）。
//   ・注文ごとに 256bit の秘密値を作り、Cookie（__Host-・Secure・HttpOnly・SameSite=Lax）にだけ入れる。DB はハッシュだけ。
//     秘密値・注文 ID は URL・HTML・応答本文・ログに出さない。応答の ref は注文 ID から作った不可逆の短い値。
//   ・Stripe の metadata は order_id・app・env だけ。client_reference_id・customer_email は使わない。
//   ・購入完了ページは、Webhook を待たずに Stripe へ問い合わせて支払い済みなら適用する（同じ共通処理・冪等）。
//     Webhook が一時的に失敗しても、ここでの再処理で回復する。
//   ・Cookie だけの閲覧（購入したブラウザ）と、アカウントへの恒久的な引き継ぎを分ける。引き継ぎは、ログイン中の確認済みメールが
//     購入時メールと一致する時だけ（Cookie の秘密値だけでは、別のメールのアカウントへ移さない）。
//   ・Cookie を失った時の復旧：Supabase のメール OTP で10分以内にログインした本人の確認済みメールと、
//     Stripe の購入時メールの HMAC が一致した、支払済み・未引き継ぎの記録だけを引き継ぐ（メールの文字列一致だけでは引き継がない）。
//   ・決済待ち（Stripe の画面を閉じた・戻った）は、Stripe の状態を確かめて片付ける（未払いなら画面を閉じる、支払い済みなら適用）。
//     決済待ちがあるだけで、購入・引き継ぎを止めない。
'use strict';
const crypto = require('crypto');
const CE = require('./complete-eligibility');
const CP = require('./complete-payment');
const CA = require('./complete-apply');
const RJ = require('./complete-report-job');
const PS = require('./purchase-state');

const COOKIE = '__Host-ed_gp';
const COOKIE_MAX_AGE_SEC = 180 * 24 * 3600;
const MAX_ENTRIES = 12;
const ENTRY_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const CODE_RE = /^[0-9a-z]{8,400}$/;
const REF_RE = /^[0-9a-f]{20}$/;
const OTP_MAX_AGE_SEC = 10 * 60;
const REPORT_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 1024;
const GUEST_OFFERS = ['analysis', 'direct_complete', 'analysis_upgrade'];

// ---- Cookie
function parseCookieHeader(header) {
  const out = [];
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== COOKIE) continue;
    for (const e of part.slice(i + 1).trim().split('~')) {
      const m = ENTRY_RE.exec(e);
      if (m && !out.some((x) => x.orderId === m[1])) out.push({ orderId: m[1], secret: m[2] });
    }
  }
  return out.slice(-MAX_ENTRIES);
}
function cookieEntries(req) {
  return parseCookieHeader(req.headers && (req.headers.cookie || req.headers.Cookie));
}
function serializeCookie(entries) {
  const list = entries.slice(-MAX_ENTRIES);
  if (!list.length) return `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
  return `${COOKIE}=${list.map((e) => `${e.orderId}.${e.secret}`).join('~')}; Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}; Secure; HttpOnly; SameSite=Lax`;
}
const newSecret = () => crypto.randomBytes(32).toString('base64url');
const secretHash = (secret) => crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
// 応答に載せる参照値（注文 ID から作る。注文 ID・秘密値は返さない）
function refOf(env, orderId) {
  const key = String(env.COMPLETE_VIEW_TOKEN_SECRET || '');
  return crypto.createHmac('sha256', `guest-ref-v1:${key}`).update(orderId).digest('hex').slice(0, 20);
}

// ---- 解析レポートの閲覧リンク（/api/report-data が権利を DB で確かめる。旧形式の legacy_floor は使わない）
function signReportToken(secret, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function encryptReference(secret, reference) {
  const key = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'report-token-code-encryption-v1', 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(reference, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}

// ---- 診断コード → 保存値（正本エンジンで算出し直す。tests/fixtures/report_data.js の savedRecord と同じ形）
let engineCache = null;
function engine() {
  if (!engineCache) engineCache = require('../api/_complete/rc1/src/engine').loadEngine();
  return engineCache;
}
function recordFromCode(code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
  const eng = engine();
  let answers;
  try {
    answers = eng.E.decodeAnswersV2(code, eng.Q);
    if (!answers || typeof answers !== 'object' || Object.keys(answers).length !== eng.Q.length) return null;
    if (eng.E.encodeAnswersV2(answers, eng.Q) !== code) return null;
  } catch {
    return null;
  }
  const res = eng.E.computeResultsV2(answers, { questions: eng.Q, meta: eng.META, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
  const mir = eng.resolver.computeMirror(res, 'ETI-MIRROR-2.1.0');
  const v = CE.RC1_REQUIRED_VERSIONS;
  return {
    p_answers_v2: answers,
    p_encoded_answers: code,
    p_v2_scores: { personality: res.personality, style: res.style, values: res.values, valuesCentered: res.valuesCentered },
    p_v2_rankings: { element: res.elementRanking, weapon: res.weaponRanking, nation: res.nationRanking },
    p_mirror_snapshot: eng.resolver.buildMirrorSnapshot(mir),
    p_item_set_version: v.item_set_version,
    p_scoring_version: v.scoring_version,
    p_translation_model_version: v.translation_model_version,
    p_character_profile_version: v.character_profile_version,
    p_mirror_model_version: v.mirror_model_version,
  };
}

function parseJsonBody(req, allowed) {
  const raw = req.body;
  let obj = raw;
  let text;
  if (raw === undefined || raw === null || raw === '') { obj = {}; text = '{}'; }
  else if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    text = raw.toString('utf8');
    try { obj = JSON.parse(text); } catch { return { ok: false }; }
  } else if (typeof raw === 'object') {
    text = JSON.stringify(raw);
  } else return { ok: false };
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false };
  if (Object.keys(obj).some((k) => !allowed.includes(k))) return { ok: false };
  return { ok: true, body: obj };
}

// JWT の payload（/auth/v1/user で有効と確かめた後だけ読む。署名の確認は Supabase Auth が済ませている）
function jwtClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
}
// メール OTP（verifyOtp type:'email'）で、いま（10分以内）ログインしたこと
function recentEmailOtp(claims, nowSec) {
  if (!claims || !Array.isArray(claims.amr)) return false;
  return claims.amr.some((a) => a && a.method === 'otp' && Number.isInteger(a.timestamp)
    && a.timestamp <= nowSec + 60 && nowSec - a.timestamp <= OTP_MAX_AGE_SEC);
}

const ORDER_ERRORS = {
  complete_record_not_found: [404, 'record_not_found'],
  complete_not_owner: [404, 'record_not_found'],
  complete_version_not_eligible: [422, 'not_eligible'],
  complete_mentor_goal_required: [409, 'mentor_goal_required'],
  complete_mentor_goal_mismatch: [409, 'mentor_goal_required'],
  mentor_goal_checkout_in_progress: [409, 'checkout_in_progress'],
  mentor_goal_locked: [409, 'repurchase_not_allowed'],
  complete_repurchase_not_allowed: [409, 'repurchase_not_allowed'],
  complete_analysis_already_purchased: [409, 'analysis_already_purchased'],
  complete_legacy_purchase_pending: [409, 'legacy_purchase_verification_required'],
  complete_upgrade_requires_analysis: [409, 'upgrade_requires_analysis'],
  complete_direct_not_allowed_after_analysis: [409, 'offer_changed'],
  complete_idempotency_conflict: [409, 'offer_changed'],
  complete_rights_suspended: [409, 'rights_suspended'],
};
const CLAIM_ERRORS = {
  complete_claim_invalid: [403, 'claim_invalid'],
  complete_claim_conflict: [409, 'claim_conflict'],
  complete_claim_expired: [410, 'claim_expired'],
  complete_claim_not_paid: [409, 'claim_not_paid'],
  complete_claim_checkout_open: [409, 'checkout_in_progress'],
  complete_onboarding_required: [403, 'onboarding_required'],
};

function createGuestHandler({ env, fetchImpl, stripeFor, logger = console, waitUntil = RJ.defaultWaitUntil(), storageFactory = null, now = () => Date.now() }) {
  const API = 'guest-purchase';
  const fail = (res, status, code) => res.status(status).json({ error: code });
  function failLogged(res, status, code, reason) {
    const incident = CE.incidentId();
    CP.logError(logger, API, reason || code, incident);
    return res.status(status).json({ error: code, incident_id: incident });
  }
  const storageFor = (conn) => (storageFactory ? storageFactory(conn) : RJ.storageClient(conn, fetchImpl));

  // Cookie の注文のうち、秘密値のハッシュが DB と一致するものだけ（一致しない値は黙って捨てる）
  async function verifiedOrders(conn, entries) {
    if (!entries.length) return [];
    const ids = entries.map((e) => e.orderId).join(',');
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?id=in.(${ids})&buyer=eq.guest&select=id,offer,status,amount,user_id,` +
      'diagnosis_session_id,claim_secret_hash,stripe_checkout_session_id,created_at,mentor_goal_id');
    const out = [];
    for (const e of entries) {
      const row = rows.find((r) => r.id === e.orderId);
      if (row && sameHex(row.claim_secret_hash, secretHash(e.secret))) out.push(Object.assign({}, row, { entry: e }));
    }
    return out;
  }

  // 決済待ちの注文を Stripe の状態に合わせて片付ける（Webhook と同じ共通処理。冪等）。
  //   支払い済み → 適用（paid）／Stripe で期限切れ → expired／開いたまま：expireIfOpen なら Stripe で閉じてから
  //   closeAs（expired：中止・放置、canceled：offer・目標の変更で作り直す）にする。閉じない時は open のまま。
  //   Checkout Session を作る前の created（Session なし）は、expireIfOpen なら canceled。
  //   戻り値：'paid'｜'expired'｜'canceled'｜'open'｜null（対象外・照合できない）
  async function settleOpen(conn, stripe, order, { expireIfOpen = false, closeAs = 'expired' } = {}) {
    if (order.status === 'created' && !order.stripe_checkout_session_id) {
      if (!expireIfOpen) return 'open';
      await CP.rpc(fetchImpl, conn, 'complete_close_unopened_order', { p_order_id: order.id, p_status: 'canceled', p_failure_code: 'abandoned' });
      return 'canceled';
    }
    if (!['created', 'checkout_open'].includes(order.status) || !CP.checkoutSessionIdOk(order.stripe_checkout_session_id, conn.stripeMode)) return null;
    const get = () => CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id, { expand: ['line_items'] }));
    let session = await get();
    const meta = CP.checkoutMetadataOf(session, conn.appEnv);
    if (!session || session.livemode !== CP.livemodeOf(conn) || !meta || !meta.ok || meta.orderId !== order.id) return null;
    let closedHere = false;
    if (session.status === 'open' && expireIfOpen) {
      try {
        await CP.stripeCall(() => stripe.checkout.sessions.expire(session.id));
        closedHere = true;
      } catch (err) {
        if (err.transient) throw err; // 支払いの完了と重なった等：取り直して判断する
      }
      session = await get();
    }
    if (session.payment_status === 'paid' && session.status === 'complete') {
      const created = Number.isInteger(session.created) ? session.created : Math.floor(now() / 1000);
      const result = await CA.applyPaidSession({
        env, fetchImpl, conn, session, orderId: order.id,
        eventId: `pull_${session.id}`, eventCreatedIso: new Date(created * 1000).toISOString(),
      });
      if (result === 'applied') scheduleReportFor(conn, order.id);
      return 'paid';
    }
    if (session.status === 'expired') {
      if (closedHere && closeAs === 'canceled') {
        await CP.rpc(fetchImpl, conn, 'complete_cancel_open_order', { p_order_id: order.id, p_checkout_session_id: session.id });
        return 'canceled';
      }
      await CP.rpc(fetchImpl, conn, 'complete_apply_checkout_expired', {
        p_event_id: `pull_expired_${session.id}`, p_event_created: new Date(now()).toISOString(), p_livemode: CP.livemodeOf(conn),
        p_order_id: order.id, p_checkout_session_id: session.id,
      });
      return 'expired';
    }
    return 'open';
  }

  function scheduleReportFor(conn, orderId) {
    RJ.scheduleReport(waitUntil, async () => {
      const reports = await CP.selectRows(fetchImpl, conn, `complete_reports?source_order_id=eq.${encodeURIComponent(orderId)}&select=id`);
      if (!reports[0]) return;
      await RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId: reports[0].id, logger });
    }, logger);
  }

  // 同じ記録（ゲストの記録）の状態をまとめる
  async function summarize(conn, orders) {
    const sessionIds = [...new Set(orders.map((o) => o.diagnosis_session_id))];
    if (!sessionIds.length) return [];
    const list = sessionIds.join(',');
    const [sessions, rights, reports, allOrders] = await Promise.all([
      CP.selectRows(fetchImpl, conn, `diagnosis_sessions?id=in.(${list})&select=id,user_id`),
      CP.selectRows(fetchImpl, conn, `record_entitlements?diagnosis_session_id=in.(${list})&select=diagnosis_session_id,right_type,status`),
      CP.selectRows(fetchImpl, conn, `complete_reports?diagnosis_session_id=in.(${list})&select=id,diagnosis_session_id,status,attempts,max_attempts,next_retry_at,lease_expires_at,created_at&order=created_at.desc`),
      CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=in.(${list})&select=diagnosis_session_id,offer,status`),
    ]);
    const rank = { active: 3, suspended: 2, revoked: 1 };
    const best = (sid, type) => rights.filter((r) => r.diagnosis_session_id === sid && r.right_type === type)
      .sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0)).map((r) => r.status)[0] || null;
    return sessionIds.map((sid) => {
      const mine = orders.filter((o) => o.diagnosis_session_id === sid).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const session = sessions.find((s) => s.id === sid) || null;
      const rep = reports.filter((r) => r.diagnosis_session_id === sid).find((r) => r.status !== 'revoked')
        || reports.find((r) => r.diagnosis_session_id === sid) || null;
      if (rep && RJ.isDue(rep, now())) {
        RJ.scheduleReport(waitUntil, () => RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId: rep.id, logger }), logger);
      }
      const os = allOrders.filter((o) => o.diagnosis_session_id === sid);
      const analysis = best(sid, 'analysis');
      const complete = best(sid, 'complete');
      const claimed = !!(session && session.user_id);
      return {
        sid,
        primary: mine[0],
        orders: mine,
        claimed,
        analysis,
        complete,
        report: rep ? rep.status : null,
        pending: os.some((o) => o.status === 'created' || o.status === 'checkout_open'),
        paid: os.some((o) => o.status === 'paid'),
        canUpgrade: !claimed && analysis === 'active' && !complete
          && !os.some((o) => ['direct_complete', 'analysis_upgrade'].includes(o.offer) && ['paid', 'disputed', 'refunded'].includes(o.status)),
      };
    });
  }

  function publicSummary(s, matchCodeSid) {
    const out = {
      ref: refOf(env, s.primary.id),
      analysis: s.claimed ? null : s.analysis,
      complete: s.claimed ? null : s.complete,
      report: s.claimed ? null : s.report,
      pending: s.pending,
      claimed: s.claimed,
      // 決済待ちがあっても引き継げる・買い直せる（サーバーが Stripe の状態を確かめて片付けてから行う）
      canClaim: !s.claimed && s.paid,
      canUpgrade: s.canUpgrade,
    };
    if (matchCodeSid) out.thisRecord = s.sid === matchCodeSid;
    return out;
  }

  async function sessionForCode(conn, summaries, code) {
    if (!code || !summaries.length) return null;
    const list = summaries.filter((s) => !s.claimed).map((s) => s.sid);
    if (!list.length) return null;
    const answers = await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=in.(${list.join(',')})&select=session_id,encoded_answers`);
    const hit = answers.find((a) => a.encoded_answers === code);
    return hit ? hit.session_id : null;
  }

  async function codeAnalysisActive(conn, code) {
    const hash = crypto.createHash('sha256').update(`v2_${code}`).digest('hex');
    const legacy = await CP.selectRows(fetchImpl, conn,
      `purchase_entitlements?diagnosis_code_hash=eq.${hash}&status=eq.active&product_type=in.(core1,complete)&select=id`);
    if (legacy.length) return true;
    return (await CP.rpc(fetchImpl, conn, 'complete_analysis_active_for_code_hash', { p_code_hash: hash })) === true;
  }

  function findByRef(summaries, ref) {
    return summaries.find((s) => s.orders.some((o) => refOf(env, o.id) === ref)) || null;
  }

  // ---- 操作
  async function guestCheckout(req, res, conn) {
    if (!CP.salesOpen(env)) return fail(res, 503, 'sales_closed');
    const urls = CP.checkoutReturnUrls(env, conn.appEnv, 'guest');
    if (!urls || GUEST_OFFERS.some((o) => !CP.priceIdFor(env, o))) return failLogged(res, 503, 'service_unavailable', 'checkout_config_missing');
    const parsed = parseJsonBody(req, ['offer', 'code', 'goal']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const { offer, code, goal } = parsed.body;
    if (!GUEST_OFFERS.includes(offer) || typeof code !== 'string' || !CODE_RE.test(code)) return fail(res, 400, 'invalid_request');
    const needsGoal = offer !== 'analysis';
    if (needsGoal ? !CE.isMentorGoalId(goal) : goal !== undefined) return fail(res, 400, 'invalid_request');
    const record = recordFromCode(code);
    if (!record) return fail(res, 422, 'not_eligible');

    const stripe = stripeFor();
    const entries = cookieEntries(req);
    const orders = await verifiedOrders(conn, entries);
    const summaries = await summarize(conn, orders);
    let sessionId = await sessionForCode(conn, summaries, code);
    if (offer === 'analysis_upgrade' && !sessionId) return fail(res, 409, 'upgrade_requires_analysis');
    // この端末のゲスト記録が無いのに、同じ診断コードの解析レポートが購入済み（引き継ぎ済み・別の端末）なら二重に売らない
    if (!sessionId && await codeAnalysisActive(conn, code)) return fail(res, 409, 'analysis_already_purchased');
    if (!sessionId) {
      sessionId = await CP.rpc(fetchImpl, conn, 'complete_create_guest_record', record);
      if (!CE.isUuid(sessionId)) return failLogged(res, 500, 'checkout_failed', 'guest_record_invalid');
    }

    // 同じ記録の決済待ち：同じ offer・同じ MENTOR 目標で Stripe の画面がまだ開いていればそれを返す。
    // offer か目標が違えば、古い画面を閉じてから作り直す（古い目標の画面で支払わせない）。支払い済みなら作らない
    const open = orders.find((o) => o.diagnosis_session_id === sessionId && (o.status === 'created' || o.status === 'checkout_open'));
    if (open) {
      const sameGoal = offer === 'analysis' || open.mentor_goal_id === goal;
      if (open.status === 'checkout_open' && open.offer === offer && sameGoal && CP.checkoutSessionIdOk(open.stripe_checkout_session_id, conn.stripeMode)) {
        const s = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(open.stripe_checkout_session_id));
        if (s && s.status === 'open' && CP.isStripeCheckoutUrl(s.url)) {
          return res.status(200).json({ checkoutUrl: s.url, offer, amount: CP.OFFER_AMOUNTS[offer] });
        }
      }
      const settled = await settleOpen(conn, stripe, open, { expireIfOpen: true, closeAs: 'canceled' });
      if (settled === 'paid') return fail(res, 409, 'purchase_completed');
      if (settled === 'open' || settled === null) return fail(res, 409, 'checkout_in_progress');
    }

    const secret = newSecret();
    const rows = await CP.rpc(fetchImpl, conn, 'complete_create_guest_order', {
      p_diagnosis_session_id: sessionId, p_offer: offer,
      p_idempotency_key: `cg_${crypto.randomBytes(18).toString('hex')}`,
      p_claim_secret_hash: secretHash(secret), p_goal_id: needsGoal ? goal : null,
    });
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order || !CE.isUuid(order.order_id) || order.offer !== offer || !order.created) {
      // ブラウザの Cookie に無い決済待ちの注文（別の端末・別のタブ）：作らない
      return fail(res, 409, 'checkout_in_progress');
    }
    const priceId = CP.priceIdFor(env, offer);
    const price = await CP.stripeCall(() => stripe.prices.retrieve(priceId));
    const problem = CP.priceProblem(price, offer, conn.stripeMode);
    if (problem) {
      await CP.rpc(fetchImpl, conn, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'canceled', p_failure_code: 'price_invalid' });
      return failLogged(res, 503, 'service_unavailable', problem);
    }
    let session;
    try {
      session = await CP.stripeCall(() => stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: urls.successUrl,
        cancel_url: urls.cancelUrl,
        locale: 'ja',
        metadata: { order_id: order.order_id, app: CP.APP, env: conn.appEnv },
      }, { idempotencyKey: CP.stripeIdempotencyKey(order.order_id) }));
    } catch (err) {
      if (!err.transient) {
        await CP.rpc(fetchImpl, conn, 'complete_close_unopened_order', { p_order_id: order.order_id, p_status: 'failed', p_failure_code: 'stripe_error' });
      }
      throw err;
    }
    const meta = CP.checkoutMetadataOf(session, conn.appEnv);
    if (!session || !CP.checkoutSessionIdOk(session.id, conn.stripeMode) || session.livemode !== CP.livemodeOf(conn) || !meta || !meta.ok
        || meta.orderId !== order.order_id || !CP.isStripeCheckoutUrl(session.url) || !Number.isInteger(session.expires_at)) {
      return failLogged(res, 500, 'checkout_failed', 'checkout_session_invalid');
    }
    await CP.rpc(fetchImpl, conn, 'complete_mark_checkout_open', {
      p_order_id: order.order_id, p_checkout_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    });
    // 秘密値は Cookie にだけ入れる（応答本文・URL には出さない）
    const kept = entries.filter((e) => e.orderId !== order.order_id);
    res.setHeader('Set-Cookie', serializeCookie([...kept, { orderId: order.order_id, secret }]));
    return res.status(200).json({ checkoutUrl: session.url, offer, amount: CP.OFFER_AMOUNTS[offer] });
  }

  async function guestStatus(req, res, conn) {
    const parsed = parseJsonBody(req, ['code']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const code = parsed.body.code;
    if (code !== undefined && (typeof code !== 'string' || !CODE_RE.test(code))) return fail(res, 400, 'invalid_request');
    const entries = cookieEntries(req);
    let orders = await verifiedOrders(conn, entries);
    if (orders.some((o) => o.status === 'checkout_open')) {
      const stripe = stripeFor();
      let changed = false;
      for (const o of orders) {
        if (o.status !== 'checkout_open') continue;
        try {
          const r = await settleOpen(conn, stripe, o);
          if (r && r !== 'open') changed = true;
        } catch (err) {
          CP.logError(logger, API, `reconcile_${err.code || 'failed'}`, CE.incidentId());
        }
      }
      if (changed) orders = await verifiedOrders(conn, entries);
    }
    const summaries = await summarize(conn, orders);
    const sid = code ? await sessionForCode(conn, summaries, code) : null;
    // 引き継ぎ済みの記録の秘密値は Cookie から外す（以後はマイページで見る）
    const claimedIds = new Set(summaries.filter((s) => s.claimed).flatMap((s) => s.orders.map((o) => o.id)));
    if (claimedIds.size) res.setHeader('Set-Cookie', serializeCookie(entries.filter((e) => !claimedIds.has(e.orderId))));
    const body = { salesOpen: CP.salesOpen(env), purchases: summaries.map((s) => publicSummary(s, code ? sid : null)) };
    // この端末に記録が無い診断コードが購入済みか（完了ページで二重購入へ誘導しないため。内容は返さない）
    if (code && !sid) body.codePurchased = await codeAnalysisActive(conn, code);
    return res.status(200).json(body);
  }

  async function withRef(req, res, conn) {
    const parsed = parseJsonBody(req, ['ref']);
    if (!parsed.ok || typeof parsed.body.ref !== 'string' || !REF_RE.test(parsed.body.ref)) {
      fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
      return null;
    }
    const entries = cookieEntries(req);
    const orders = await verifiedOrders(conn, entries);
    const summaries = await summarize(conn, orders);
    const s = findByRef(summaries, parsed.body.ref);
    if (!s) { fail(res, 403, 'claim_invalid'); return null; }
    return { s, entries, orders, ref: parsed.body.ref };
  }

  async function guestReport(req, res, conn) {
    const found = await withRef(req, res, conn);
    if (!found) return undefined;
    const { s } = found;
    if (s.claimed) return fail(res, 409, 'claimed');
    if (s.analysis !== 'active') return fail(res, 403, 'not_entitled');
    const secret = env.REPORT_TOKEN_SECRET;
    if (typeof secret !== 'string' || !secret) return failLogged(res, 503, 'service_unavailable', 'report_secret_missing');
    const answers = await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=eq.${encodeURIComponent(s.sid)}&select=encoded_answers`);
    const code = answers[0] && answers[0].encoded_answers;
    if (typeof code !== 'string' || !CODE_RE.test(code)) return failLogged(res, 500, 'report_unavailable', 'guest_code_missing');
    const token = signReportToken(secret, {
      exp: now() + REPORT_TOKEN_TTL_MS,
      env: conn.appEnv,
      diagnosis_version: 'ETI-2.0',
      access_mode: 'guest_entitlement_reissue',
      // 閲覧のたびに report-data.js がこの記録（未引き継ぎ）の解析権を確かめる
      sid: s.sid,
      enc: encryptReference(secret, `v2_${code}`),
    });
    return res.status(200).json({ url: `/report.html?token=${encodeURIComponent(token)}`, expiresIn: Math.floor(REPORT_TOKEN_TTL_MS / 1000) });
  }

  async function guestView(req, res, conn) {
    const found = await withRef(req, res, conn);
    if (!found) return undefined;
    const { s } = found;
    if (s.claimed) return fail(res, 409, 'claimed');
    if (!RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return failLogged(res, 503, 'service_unavailable', 'view_secret_missing');
    const rows = await CP.rpc(fetchImpl, conn, 'complete_report_for_view', { p_user_id: null, p_diagnosis_session_id: s.sid });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.state === 'not_found' || row.state === 'not_entitled') return fail(res, 403, 'not_entitled');
    if (row.state === 'basis_inactive') return fail(res, 403, 'basis_inactive');
    if (row.state !== 'ok') return fail(res, 409, 'report_not_ready');
    const issued = RJ.issueViewToken(env.COMPLETE_VIEW_TOKEN_SECRET, { reportId: row.report_id, userId: null, sessionId: s.sid }, Math.floor(now() / 1000));
    return res.status(200).json({ viewUrl: `/api/complete-status?view=${issued.token}`, expiresIn: RJ.VIEW_TTL_SEC });
  }

  async function authenticated(req, res, conn) {
    const token = CP.bearerToken(req);
    if (!token) { fail(res, 401, 'not_authenticated'); return null; }
    let user;
    try {
      user = await CP.authUser(fetchImpl, conn, token);
    } catch (err) {
      failLogged(res, 503, 'service_unavailable', err.code);
      return null;
    }
    if (!user) { fail(res, 401, 'not_authenticated'); return null; }
    return { user, token };
  }

  // 購入時メールの HMAC（注文に無ければ、支払い済みの Checkout Session をサーバーの鍵で取り直して記録する）
  async function purchaseHmacOf(conn, stripe, order) {
    if (order.purchase_email_hmac) return order.purchase_email_hmac;
    if (!CP.checkoutSessionIdOk(order.stripe_checkout_session_id, conn.stripeMode)) return null;
    const session = await CP.stripeCall(() => stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id));
    const hmac = session && session.livemode === CP.livemodeOf(conn) ? CA.purchaseEmailHmac(env, session.customer_details && session.customer_details.email) : null;
    if (hmac) await CP.rpc(fetchImpl, conn, 'complete_set_purchase_email', { p_order_id: order.id, p_purchase_email_hmac: hmac });
    return hmac;
  }

  // 引き継ぎ（Cookie）：Cookie を持つブラウザでの閲覧とは分け、アカウントへ恒久的に移すのは、
  // ログイン中の確認済みメールが購入時メールと一致する時だけ（D3。メール OTP でも Google・X でも、確認済みメールが同じなら可）。
  //   ・照合する注文は「Cookie の秘密値に対応する、支払済みの注文」。後から作られた決済待ち・期限切れ・取消の注文に妨げられない。
  //   ・その記録の決済待ちは、Stripe の状態を確かめて片付けてから移す（支払い済みなら適用、開いたままなら閉じる）。
  //   ・同じ秘密値・同じ人の再実行は冪等（already_claimed）。別の人が引き継ぎ済みなら 409。
  async function guestClaim(req, res, conn) {
    const auth = await authenticated(req, res, conn);
    if (!auth) return undefined;
    const found = await withRef(req, res, conn);
    if (!found) return undefined;
    const sid = found.s.sid;
    let order = found.orders.find((o) => refOf(env, o.id) === found.ref) || found.s.primary;
    if (!found.s.claimed) {
      if (!auth.user.email) return fail(res, 403, auth.user.emailUnconfirmed ? 'claim_email_unconfirmed' : 'claim_email_required');
      const hmac = CA.purchaseEmailHmac(env, auth.user.email);
      if (!hmac) return failLogged(res, 503, 'service_unavailable', 'email_hmac_unavailable');
      const stripe = stripeFor();
      for (const o of found.orders.filter((x) => x.diagnosis_session_id === sid && (x.status === 'created' || x.status === 'checkout_open'))) {
        await settleOpen(conn, stripe, o, { expireIfOpen: true });
      }
      const mine = (await verifiedOrders(conn, found.entries)).filter((o) => o.diagnosis_session_id === sid);
      const paid = mine.filter((o) => o.status === 'paid').sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      if (!paid.length) return fail(res, 409, 'claim_not_paid');
      // この記録の支払い済み等の注文（Cookie に無いものも含む）はすべて、購入時メールがログイン中のメールと一致すること
      const all = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${encodeURIComponent(sid)}` +
        '&select=id,status,purchase_email_hmac,stripe_checkout_session_id');
      for (const o of all.filter((x) => ['paid', 'disputed', 'refunded'].includes(x.status))) {
        const h = await purchaseHmacOf(conn, stripe, o);
        if (!h || !sameHex(h, hmac)) return fail(res, 403, 'claim_email_mismatch');
      }
      order = paid[0];
    }
    let result;
    try {
      result = await CP.rpc(fetchImpl, conn, 'complete_claim_guest_record', {
        p_user_id: auth.user.id, p_order_id: order.id, p_claim_secret_hash: secretHash(order.entry.secret),
      });
    } catch (err) {
      const mapped = err instanceof CP.PaymentError ? CLAIM_ERRORS[err.code] : null;
      if (mapped) return fail(res, mapped[0], mapped[1]);
      throw err;
    }
    // 引き継いだ記録の秘密値は Cookie から外す（1回限り）
    const done = new Set(found.s.orders.map((o) => o.id));
    res.setHeader('Set-Cookie', serializeCookie(found.entries.filter((e) => !done.has(e.orderId))));
    return res.status(200).json({ result: result === 'noop' ? 'already_claimed' : 'claimed' });
  }

  // Cookie を失った時の復旧：メール OTP（10分以内）でログインした本人の確認済みメールと、購入時メールの HMAC が一致する
  // 支払済み・未引き継ぎの記録だけ。決済待ちが残る記録は、Stripe の状態を確かめて片付けてから移す。
  async function guestRecover(req, res, conn) {
    const auth = await authenticated(req, res, conn);
    if (!auth) return undefined;
    const parsed = parseJsonBody(req, []);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    // メールの文字列一致だけでは引き継がない：Supabase のメール OTP で10分以内に確認した本人のメールだけを使う
    if (!recentEmailOtp(jwtClaims(auth.token), Math.floor(now() / 1000))) return fail(res, 403, 'email_otp_required');
    if (!auth.user.email) return fail(res, 403, 'email_otp_required');
    const hmac = CA.purchaseEmailHmac(env, auth.user.email);
    if (!hmac) return failLogged(res, 503, 'service_unavailable', 'email_hmac_unavailable');
    const mine = (await CP.selectRows(fetchImpl, conn, `complete_orders?purchase_email_hmac=eq.${hmac}&buyer=eq.guest&status=eq.paid` +
      '&select=diagnosis_session_id,user_id')).filter((o) => o.user_id === null);
    const sids = [...new Set(mine.map((o) => o.diagnosis_session_id))];
    if (sids.length) {
      const stripe = stripeFor();
      const opens = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=in.(${sids.join(',')})&status=in.(created,checkout_open)` +
        '&select=id,status,stripe_checkout_session_id');
      for (const o of opens) await settleOpen(conn, stripe, o, { expireIfOpen: true });
    }
    let rows;
    try {
      rows = await CP.rpc(fetchImpl, conn, 'complete_claim_guest_by_email', { p_user_id: auth.user.id, p_purchase_email_hmac: hmac });
    } catch (err) {
      const mapped = err instanceof CP.PaymentError ? CLAIM_ERRORS[err.code] : null;
      if (mapped) return fail(res, mapped[0], mapped[1]);
      throw err;
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return res.status(200).json({ claimed: (row && row.claimed) || 0, skipped: (row && row.skipped) || 0 });
  }

  // 決済をやり直す（ゲスト）：この端末の決済待ちを Stripe の状態に合わせて片付ける。開いたままの画面は閉じる（未払いの時だけ）。
  // Stripe の決済画面で「戻る」を選んだ時（購入完了ページ ?status=canceled）・「決済をやり直す」を押した時に呼ぶ。
  async function guestCancel(req, res, conn) {
    const parsed = parseJsonBody(req, []);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const orders = (await verifiedOrders(conn, cookieEntries(req))).filter((o) => o.user_id === null && (o.status === 'created' || o.status === 'checkout_open'));
    const stripe = stripeFor();
    const out = { closed: 0, paid: 0 };
    for (const o of orders) {
      const r = await settleOpen(conn, stripe, o, { expireIfOpen: true });
      if (r === 'paid') out.paid += 1;
      else if (r === 'expired' || r === 'canceled') out.closed += 1;
    }
    return res.status(200).json(out);
  }

  // MENTOR 目標のカタログ（完了ページでの選択用。記録・Cookie には触れない）
  async function guestGoals(req, res) {
    return res.status(200).json({ salesOpen: CP.salesOpen(env), catalog: CE.MENTOR_CATALOG });
  }

  // ログイン中の購入（マイページ）から戻った時：本人の決済待ちの注文を Stripe に問い合わせ、支払い済みなら適用する（冪等）。
  // { cancel: true }（Stripe の画面で「戻る」を選んだ時）は、未払いの開いた画面を閉じて決済待ちを片付ける（すぐ買い直せる）。
  async function userReconcile(req, res, conn) {
    const auth = await authenticated(req, res, conn);
    if (!auth) return undefined;
    const parsed = parseJsonBody(req, ['cancel']);
    if (!parsed.ok || (parsed.body.cancel !== undefined && parsed.body.cancel !== true)) return fail(res, 400, 'invalid_request');
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?user_id=eq.${encodeURIComponent(auth.user.id)}&status=in.(created,checkout_open)` +
      '&select=id,status,stripe_checkout_session_id');
    const stripe = stripeFor();
    let applied = 0;
    let closed = 0;
    for (const o of rows.slice(0, 5)) {
      try {
        const r = await settleOpen(conn, stripe, o, { expireIfOpen: parsed.body.cancel === true });
        if (r === 'paid') applied += 1;
        else if (r === 'expired' || r === 'canceled') closed += 1;
      } catch (err) {
        CP.logError(logger, API, `reconcile_${err.code || 'failed'}`, CE.incidentId());
      }
    }
    return res.status(200).json({ applied, closed });
  }

  // 決済をやり直す（ログイン中）：この記録（同じ診断結果の記録を含む）の決済待ちを、Stripe の状態に合わせて片付ける。
  // 未払いの開いた画面は閉じる。支払い済みなら適用する（二重に請求しない）。
  async function userCheckoutReset(req, res, conn) {
    const auth = await authenticated(req, res, conn);
    if (!auth) return undefined;
    const parsed = parseJsonBody(req, ['diagnosisSessionId']);
    if (!parsed.ok || !CE.isUuid(parsed.body.diagnosisSessionId)) return fail(res, 400, 'invalid_request');
    const st = PS.computeStates(await PS.loadUserFacts((path) => CP.selectRows(fetchImpl, conn, path), auth.user.id))[parsed.body.diagnosisSessionId];
    if (!st) return fail(res, 404, 'record_not_found');
    if (!st.memberIds.length) return res.status(200).json({ result: 'none' });
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=in.(${st.memberIds.join(',')})` +
      `&user_id=eq.${encodeURIComponent(auth.user.id)}&status=in.(created,checkout_open)&select=id,status,stripe_checkout_session_id`);
    const stripe = stripeFor();
    let result = 'none';
    for (const o of rows) {
      const r = await settleOpen(conn, stripe, o, { expireIfOpen: true });
      if (r === 'paid') result = 'paid';
      else if ((r === 'expired' || r === 'canceled') && result === 'none') result = 'reset';
      else if (r === 'open') return fail(res, 409, 'checkout_in_progress');
    }
    return res.status(200).json({ result });
  }

  const OPS = {
    'user-reconcile': userReconcile,
    'guest-goals': guestGoals,
    'guest-checkout': guestCheckout,
    'guest-status': guestStatus,
    'guest-report': guestReport,
    'guest-view': guestView,
    'guest-claim': guestClaim,
    'guest-recover': guestRecover,
    'guest-cancel': guestCancel,
    'user-checkout-reset': userCheckoutReset,
  };

  return async function guestHandler(op, req, res, conn) {
    const fn = OPS[op];
    if (!fn) return fail(res, 404, 'not_found');
    try {
      return await fn(req, res, conn);
    } catch (err) {
      if (err instanceof CP.PaymentError) {
        const mapped = ORDER_ERRORS[err.code];
        if (mapped) return fail(res, mapped[0], mapped[1]);
        return failLogged(res, err.transient ? 503 : 502, err.transient ? 'service_unavailable' : 'request_failed', err.code);
      }
      return failLogged(res, 500, 'request_failed', 'internal_error');
    }
  };
}

module.exports = {
  COOKIE, MAX_ENTRIES, OTP_MAX_AGE_SEC, GUEST_OFFERS,
  createGuestHandler, parseCookieHeader, serializeCookie, secretHash, refOf, recordFromCode, recentEmailOtp, jwtClaims,
};
