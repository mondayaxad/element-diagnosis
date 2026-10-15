// lib/guest-purchase.js
// 診断完了ページからのゲスト購入（ログイン不要）と、購入後のマイページへの引き継ぎ。
// api/complete-checkout.js が ?op=<名前> で振り分ける（Vercel の関数の数を増やさない）。
//
//   POST /api/complete-checkout?op=guest-goals     {}                          → { salesOpen, catalog }（MENTOR 目標の一覧）
//   POST /api/complete-checkout?op=guest-checkout  { offer, code, goal? }      → { checkoutUrl, offer, amount }
//   POST /api/complete-checkout?op=guest-status    { code? }                   → { salesOpen, purchases: [...] }
//   POST /api/complete-checkout?op=guest-report    { ref }                     → { url }（解析レポート。15分の閲覧リンク）
//   POST /api/complete-checkout?op=guest-view      { ref }                     → { viewUrl }（完全解析。300秒の閲覧リンク）
//   POST /api/complete-checkout?op=guest-regenerate { ref }                    → 202 { result: 'queued' }（生成の最終の失敗の作り直し。追加の支払いなし）
//   POST /api/complete-checkout?op=guest-claim     { ref }   Bearer            → { result }
//   POST /api/complete-checkout?op=guest-recover   {}        Bearer（確認済みメール） → { claimed, skipped }
//   POST /api/complete-checkout?op=result-link     { code, token }             → { result: created|existing }（秘密値はブラウザが作る。DB にはハッシュだけ。
//                                                                                  同じ秘密値の再送は冪等。接続元ごとに 10 分 10 件・24 時間 100 件を超えたら 429）
//   POST /api/complete-checkout?op=result-open     { token }                   → { code, diagnosisVersion, versions }（無料結果の表示だけ）
//   guest-checkout・guest-status は { resume } を受け付ける（固有リンクの記録に結び付ける。使えないリンクは無視する）
//   ログインなしの offer は analysis（¥1,000）・direct_complete（¥3,000）・analysis_upgrade（追加 ¥2,000）。価格はマイページの有無で変えない
//   ・¥2,000 は、この端末の Cookie の秘密値で確かめた記録に新 Checkout の有効な解析権があり、完全解析が無い時だけ
//   ・この端末の記録に有効な権利があれば ¥1,000・¥3,000 は断る（画面は「読む」・¥2,000 を出す）
//   ・この端末に記録が無ければ、同じ診断結果が別の場所・別の人で購入済みでも新しい記録で売る（診断コードは所有の根拠にしない）
//   POST /api/complete-checkout?op=guest-cancel    {}                          → { closed, paid }（決済をやり直す・Stripe で戻った）
//   POST /api/complete-checkout?op=user-reconcile  { cancel? } Bearer          → { applied, closed }（マイページへ戻った）
//   POST /api/complete-checkout?op=user-checkout-reset { diagnosisSessionId } Bearer → { result }（決済をやり直す）
//
// 方針
//   ・金額・offer・権利はサーバーが決める。診断コードはサーバーが正本エンジンで回答へ戻し、結果を算出し直して記録を作る
//     （ブラウザの結果・価格・種類は使わない）。
//   ・注文ごとに 256bit の秘密値を作り、Cookie（__Host-・Secure・HttpOnly・SameSite=Lax）にだけ入れる。DB はハッシュだけ。
//     秘密値・注文 ID は URL・HTML・応答本文・ログに出さない。応答の ref は注文 ID から作った不可逆の短い値。
//   ・Stripe の metadata は order_id・app・env だけ。client_reference_id は使わない。
//   ・ログイン中に結果ページ・解析レポートから買った時だけ、Stripe の決済画面のメールにアカウントの確認済みメールを入れる
//     （customer_email）。購入時メール＝アカウントのメールになり、マイページで確実に引き継げる（別のメールで払って
//     引き継げず、同じ結果の記録に購入を求め直すのを防ぐ）。ログインを確かめられない時は入れずに売る（止めない）。
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
// 決済中の注文を閉じる時に読む列（settleOpen が使う）
const OPEN_ORDER_SELECT = 'id,diagnosis_session_id,offer,status,stripe_checkout_session_id,user_id,created_at';
const ENTRY_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const CODE_RE = /^[0-9a-z]{8,400}$/;
// 診断結果の固有リンクの秘密値（32バイトの乱数・base64url 43文字）。DB には SHA-256 だけを保存する（complete_09）
const RESUME_RE = /^[A-Za-z0-9_-]{43}$/;
const resumeHash = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
// 固有リンクの作成の回数を数える単位（接続元）。IPv6 は /64 にまとめる。IP アドレスそのものは保存・ログに出さない
function clientAddress(req) {
  const h = (req && req.headers) || {};
  const pick = (v) => (Array.isArray(v) ? v[0] : v);
  let ip = String(pick(h['x-real-ip']) || String(pick(h['x-forwarded-for']) || '').split(',')[0] || '').trim().toLowerCase();
  if (!ip && req && req.socket) ip = String(req.socket.remoteAddress || '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.includes(':')) {
    const [head, tail] = ip.split('::');
    const a = head ? head.split(':') : [];
    const b = tail !== undefined && tail ? tail.split(':') : [];
    const full = tail !== undefined ? a.concat(Array(Math.max(0, 8 - a.length - b.length)).fill('0'), b) : a;
    return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
  }
  return ip || 'unknown';
}
const rateKeyOf = (env, address) => crypto.createHmac('sha256', `result-link-rate-v1:${String(env.COMPLETE_VIEW_TOKEN_SECRET || '')}`).update(address).digest('hex');
const REF_RE = /^[0-9a-f]{20}$/;
const OTP_MAX_AGE_SEC = 10 * 60;
const REPORT_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 1024;
// ログインなしの購入：¥1,000 解析レポート・¥3,000 解析＋完全解析・追加 ¥2,000（この端末で確かめた解析レポートの記録だけ）
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
  complete_legacy_purchase_pending: [409, 'legacy_purchase_not_eligible'],
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
      'diagnosis_session_id,claim_secret_hash,claim_expires_at,stripe_checkout_session_id,created_at,mentor_goal_id');
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
      CP.selectRows(fetchImpl, conn, `complete_reports?diagnosis_session_id=in.(${list})&select=id,diagnosis_session_id,status,attempts,max_attempts,next_retry_at,lease_expires_at,last_error_code,manual_retries,created_at&order=created_at.desc`),
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
      // この端末が記録の持ち主か：この Cookie の秘密値に、支払い済み等の注文があること（complete_11 の監査）。
      //   決済を始めただけ・期限切れ・中止の注文の秘密値では、その記録の権利・閲覧・引き継ぎを渡さない
      //   （共有された結果リンクの記録で決済を放置した別の人に、持ち主の購入を見せない）
      const owner = mine.some((o) => ['paid', 'disputed', 'refunded'].includes(o.status));
      const analysis = owner ? best(sid, 'analysis') : null;
      const complete = owner ? best(sid, 'complete') : null;
      const claimed = !!(session && session.user_id);
      const live = (v) => v === 'active' || v === 'suspended';
      return {
        sid,
        primary: mine[0],
        orders: mine,
        owner,
        claimed,
        analysis,
        complete,
        report: owner && rep ? rep.status : null,
        regenerate: owner && rep ? RJ.regenerateState(rep, now()) : null,
        pending: mine.some((o) => o.status === 'created' || o.status === 'checkout_open'),
        paid: mine.some((o) => o.status === 'paid'),
        // 「この結果」を選ぶ順位：完全解析を持つ > 解析レポートを持つ > 決済待ち > その他（新しい購入を先に）
        rank: live(complete) ? 3 : live(analysis) ? 2 : mine.some((o) => o.status === 'created' || o.status === 'checkout_open') ? 1 : 0,
        latestAt: mine.map((o) => o.created_at).sort().pop() || '',
        // 追加 ¥2,000：この端末の Cookie で確かめた記録（秘密値の照合済み）に、新 Checkout の有効な解析権があり、
        //   完全解析の権利・決済待ちが無い時だけ（マイページの有無で価格を変えない。旧購入・診断コードは根拠にしない）
        //   決済待ちがあっても出す（申込の時にサーバーが Stripe の状態を確かめて閉じてから作り直す。買いそびれを防ぐ）
        //   返金・失効した完全解析（¥2,000 の返金）は持っていないものとして、もう一度 ¥2,000 を申し込める
        canUpgrade: !claimed && owner && analysis === 'active' && !live(complete),
        // 完全解析を読むために解析レポートの買い直しが要る（¥2,000 の後に ¥1,000 だけ返金）
        //   異議申し立て中・負けた解析レポートの支払いがある記録では出さない（DB が断る）
        needsAnalysis: !claimed && owner && complete === 'active' && !live(analysis)
          && !os.some((o) => ['analysis', 'direct_complete'].includes(o.offer) && o.status === 'disputed'),
      };
    });
  }

  function publicSummary(s, matchCodeSid) {
    const out = {
      ref: refOf(env, s.primary.id),
      analysis: s.claimed ? null : s.analysis,
      complete: s.claimed ? null : s.complete,
      report: s.claimed ? null : s.report,
      // 生成の最終の失敗：available（この端末から作り直せる）／operator（お問い合わせ）
      regenerate: s.claimed ? null : s.regenerate,
      pending: s.pending,
      claimed: s.claimed,
      // 購入の日時（同じブラウザに複数の購入がある時に見分ける。分まで）
      purchasedAt: (() => {
        const paid = s.orders.filter((o) => o.status === 'paid').map((o) => o.created_at).sort()[0];
        const at = paid || (s.primary && s.primary.created_at);
        const d = at ? new Date(at) : null;
        return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
      })(),
      // 決済待ちがあっても引き継げる・買い直せる（サーバーが Stripe の状態を確かめて片付けてから行う）
      canClaim: !s.claimed && s.paid,
      canUpgrade: s.canUpgrade,
      needsAnalysis: !!s.needsAnalysis,
      // この記録の最後に支払われた申込（購入完了ページの閲覧の導線の順を決めるだけ。価格・権利には使わない）
      lastOffer: (() => {
        const paid = s.orders.filter((o) => o.status === 'paid').sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        return paid && GUEST_OFFERS.includes(paid.offer) ? paid.offer : null;
      })(),
    };
    if (matchCodeSid) out.thisRecord = s.sid === matchCodeSid;
    return out;
  }

  // この端末の Cookie で確かめた記録のうち、同じ診断コードのもの（新しい購入の順）。診断コードは所有の根拠ではなく、
  //   Cookie で確かめた記録の中から「この結果」を選ぶためだけに使う
  async function sessionsForCode(conn, summaries, code) {
    if (!code || !summaries.length) return [];
    const list = summaries.filter((s) => !s.claimed).map((s) => s.sid);
    if (!list.length) return [];
    const answers = await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=in.(${list.join(',')})&select=session_id,encoded_answers`);
    const hits = new Set(answers.filter((a) => a.encoded_answers === code).map((a) => a.session_id));
    const by = (sid) => summaries.find((x) => x.sid === sid) || { rank: 0, latestAt: '' };
    return list.filter((sid) => hits.has(sid))
      .sort((a, b) => (by(b).rank - by(a).rank) || (by(a).latestAt < by(b).latestAt ? 1 : by(a).latestAt > by(b).latestAt ? -1 : 0));
  }
  // この端末の引き継ぎ済みの記録で、同じ診断コードのもの（あれば true。マイページで開くよう案内する）
  async function claimedForCode(conn, summaries, code) {
    const list = summaries.filter((s) => s.claimed && s.owner).map((s) => s.sid);
    if (!code || !list.length) return false;
    const answers = await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=in.(${list.join(',')})&select=session_id,encoded_answers`);
    return answers.some((a) => a.encoded_answers === code);
  }
  // ログイン中の本人のアカウントに、この診断結果の購入があるか（ゲストとして重ねて売らない）。
  //   決済中（未払いの開いた画面）は購入に数えない：申込の時に閉じてから売る（払える画面は常に1つ）。
  //   { owns, open（アカウントの決済中の注文）}。アカウントの購入を読めない時は 'unknown'（重ねて売らないよう、時間をおいて再度）
  async function accountResult(user, conn, code) {
    try {
      const key = CE.legacyCodeHash(code, 'ETI-2.0');
      const states = PS.computeStates(await PS.loadUserFacts((path) => CP.selectRows(fetchImpl, conn, path), user.id));
      const mine = Object.values(states).filter((st) => st.key === key);
      const owns = mine.some((st) => st.analysisPurchased || st.completeOwned || st.analysisSuspended || st.legacyAnalysis);
      const ids = [...new Set(mine.flatMap((st) => st.memberIds))];
      const open = owns || !ids.length ? [] : await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=in.(${ids.join(',')})` +
        `&user_id=eq.${encodeURIComponent(user.id)}&status=in.(created,checkout_open)&select=${OPEN_ORDER_SELECT}`);
      return { owns, open };
    } catch (err) {
      return 'unknown';
    }
  }
  async function accountOwnsResult(user, conn, code) {
    const r = await accountResult(user, conn, code);
    return r === 'unknown' ? r : r.owns;
  }

  // 払える決済画面は、1人・1診断結果につき常に1つだけ：新しい画面を作る前に、同じ人・同じ診断結果の
  //   他の開いている画面を Stripe で閉じる（閉じた画面では支払えない。反映できない支払いを作らない）。
  //   'ok'（閉じた・無かった）／'paid'（支払い済みだった：反映した。新しく売らない）／
  //   'busy'（同時に届いた別の申込が作っている途中・Stripe で閉じられなかった。どちらも一時的）
  async function closeOpenOrders(conn, stripe, rows, { force = false } = {}) {
    let out = 'ok';
    for (const o of rows) {
      if (!o || !['created', 'checkout_open'].includes(o.status)) continue;
      // force：作りかけの注文も片付ける（作っている途中の申込は、画面を渡す前に注文が閉じていると分かり、URL を渡さない）
      if (!force && o.status === 'created' && !o.stripe_checkout_session_id && now() - Date.parse(o.created_at) < 2 * 60 * 1000) {
        if (out === 'ok') out = 'busy';
        continue;
      }
      const r = await settleOpen(conn, stripe, o, { expireIfOpen: true, closeAs: 'canceled' });
      if (r === 'paid') out = 'paid';
      // Stripe で閉じられなかった（まだ開いている）：今は作らない（画面は 35 分で切れる）。
      //   この注文の画面として確かめられない（null）は、この注文へ払える画面ではないので申込を止めない（買えることを優先）
      else if (r === 'open' && out === 'ok') out = 'busy';
    }
    return out;
  }
  // この端末（Cookie の秘密値で確かめた注文）の、同じ診断コードの記録の決済中の注文
  async function cookieOpenForCode(req, conn, code) {
    const orders = (await verifiedOrders(conn, cookieEntries(req))).filter((o) => o.user_id == null && ['created', 'checkout_open'].includes(o.status));
    if (!orders.length) return [];
    const sids = new Set(await sessionsForCode(conn, await summarize(conn, orders), code));
    return orders.filter((o) => sids.has(o.diagnosis_session_id));
  }
  async function sessionForCode(conn, summaries, code) {
    return (await sessionsForCode(conn, summaries, code))[0] || null;
  }

  // この記録で、その申込の物をすでに購入済み（権利がある・支払い済み）か。¥3,000 は解析レポートの購入も含める
  async function recordHasOffer(conn, sid, offer) {
    const [rights, paid] = await Promise.all([
      CP.selectRows(fetchImpl, conn, `record_entitlements?diagnosis_session_id=eq.${sid}&select=right_type`),
      CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${sid}&status=in.(paid,disputed,refunded)&select=offer`),
    ]);
    const has = (t) => rights.some((r) => r.right_type === t);
    const paidOf = (list) => paid.some((o) => list.includes(o.offer));
    if (offer === 'analysis') return has('analysis') || paidOf(['analysis', 'direct_complete']);
    return has('analysis') || has('complete') || paidOf(['analysis', 'direct_complete', 'analysis_upgrade']);
  }

  function findByRef(summaries, ref) {
    return summaries.find((s) => s.orders.some((o) => refOf(env, o.id) === ref)) || null;
  }

  // ---- 診断結果の固有リンク（/result#r=<秘密値>）。秘密値はログ・応答に出さない
  // 秘密値から記録を引く（期限内だけ。開くたびに期限を延ばす）。無ければ null
  async function openResume(conn, token) {
    if (typeof token !== 'string' || !RESUME_RE.test(token)) return null;
    const rows = await CP.rpc(fetchImpl, conn, 'complete_open_result_link', { p_token_hash: resumeHash(token) });
    const row = Array.isArray(rows) ? rows[0] : null;
    return row && CE.isUuid(row.diagnosis_session_id) ? row : null;
  }
  // 作成：診断完了の時（無料結果の表示の直後）。保存値はサーバーが診断コードから算出する（ブラウザの値は使わない）
  //   秘密値はブラウザが作る（診断ごとに1つ）。同じ秘密値の再送は同じリンクを返すだけ（記録・リンクを増やさない）。
  //   接続元ごとの作成の回数（IP アドレスをサーバーの鍵で HMAC にした値だけを DB で数える）が上限を超えたら 429。
  async function resultLink(req, res, conn) {
    const parsed = parseJsonBody(req, ['code', 'token']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const { code, token } = parsed.body;
    if (typeof code !== 'string' || !CODE_RE.test(code) || typeof token !== 'string' || !RESUME_RE.test(token)) return fail(res, 400, 'invalid_request');
    if (!RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return failLogged(res, 503, 'service_unavailable', 'view_secret_missing');
    const record = recordFromCode(code);
    if (!record) return fail(res, 422, 'not_eligible');
    let result;
    try {
      result = await CP.rpc(fetchImpl, conn, 'complete_create_result_link',
        Object.assign({ p_token_hash: resumeHash(token), p_rate_key: rateKeyOf(env, clientAddress(req)) }, record));
    } catch (err) {
      if (err instanceof CP.PaymentError && err.code === 'complete_result_link_rate_limited') {
        if (typeof res.setHeader === 'function') res.setHeader('Retry-After', '600');
        return fail(res, 429, 'too_many_requests');
      }
      if (err instanceof CP.PaymentError && err.code === 'complete_result_link_conflict') return fail(res, 409, 'result_link_conflict');
      throw err;
    }
    return res.status(200).json({ result: result === 'existing' ? 'existing' : 'created' });
  }
  // 照会：無料結果の表示に必要な保存値だけを返す（権利・注文・記録 ID は返さない）
  async function resultOpen(req, res, conn) {
    const parsed = parseJsonBody(req, ['token']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const row = await openResume(conn, parsed.body.token);
    if (!row || typeof row.encoded_answers !== 'string' || !CODE_RE.test(row.encoded_answers)) return fail(res, 404, 'result_not_found');
    return res.status(200).json({
      code: row.encoded_answers,
      diagnosisVersion: row.diagnosis_version,
      versions: {
        itemSetVersion: row.item_set_version, scoringVersion: row.scoring_version, translationModelVersion: row.translation_model_version,
        characterProfileVersion: row.character_profile_version, mirrorModelVersion: row.mirror_model_version,
      },
    });
  }

  // ---- 操作
  async function guestCheckout(req, res, conn) {
    if (!CP.salesOpen(env)) return fail(res, 503, 'sales_closed');
    const urls = CP.checkoutReturnUrls(env, conn.appEnv, 'guest');
    if (!urls || GUEST_OFFERS.some((o) => !CP.priceIdFor(env, o))) return failLogged(res, 503, 'service_unavailable', 'checkout_config_missing');
    const parsed = parseJsonBody(req, ['offer', 'code', 'goal', 'resume']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const { offer, code, goal, resume } = parsed.body;
    if (resume !== undefined && (typeof resume !== 'string' || !RESUME_RE.test(resume))) return fail(res, 400, 'invalid_request');
    if (!GUEST_OFFERS.includes(offer) || typeof code !== 'string' || !CODE_RE.test(code)) return fail(res, 400, 'invalid_request');
    const needsGoal = offer !== 'analysis';
    if (needsGoal ? !CE.isMentorGoalId(goal) : goal !== undefined) return fail(res, 400, 'invalid_request');
    const record = recordFromCode(code);
    if (!record) return fail(res, 422, 'not_eligible');

    const stripe = stripeFor();
    // ログイン中の本人（トークンがある時だけ。1回だけ確かめる）
    const account = await optionalAccount(req, conn);
    if (account === 'unknown') return failLogged(res, 503, 'service_unavailable', 'auth_unavailable');
    const accountEmail = account && account.email ? account.email : null;
    const entries = cookieEntries(req);
    const orders = await verifiedOrders(conn, entries);
    const summaries = await summarize(conn, orders);
    const cookieSids = await sessionsForCode(conn, summaries, code);
    // この端末で、この結果の購入をマイページに引き継ぎ済み：ゲストとして売り直さない（マイページで開く）
    if (!cookieSids.length && await claimedForCode(conn, summaries, code)) return fail(res, 409, 'claimed');
    // ログイン中の本人のアカウントに、この結果の購入・決済待ちがある：ゲストとして重ねて売らない（マイページで開く・申し込む）
    const accountState = account ? await accountResult(account, conn, code) : { owns: false, open: [] };
    if (accountState === 'unknown') return failLogged(res, 503, 'service_unavailable', 'account_state_unavailable');
    if (accountState.owns) return fail(res, 409, 'owned_in_account');
    // 別の端末・消えた Cookie の、このアカウントのメールで支払った未引き継ぎの購入：重ねて売らない（購入時メールの確認で引き継ぐ）
    if (accountEmail && (await emailPurchasesForCode(conn, accountEmail, code, cookieSids)).length) return fail(res, 409, 'guest_purchase_unclaimed');
    const linked = resume !== undefined ? await openResume(conn, resume) : null;
    let linkedSid = linked && linked.encoded_answers === code && linked.guest ? linked.diagnosis_session_id : null;
    // 固有リンクの記録に、この端末以外の注文がある（リンクを共有された別の人が決済した等）：その記録には結び付けない
    if (linkedSid && !cookieSids.includes(linkedSid)) {
      const foreign = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${linkedSid}&select=id`);
      if (foreign.some((o) => !entries.some((e) => e.orderId === o.id))) linkedSid = null;
    }
    const live = (v) => v === 'active' || v === 'suspended';
    let sessionId = null;
    if (offer === 'analysis_upgrade') {
      // 追加 ¥2,000：この端末の Cookie で確かめた記録（固有リンクの記録を優先）で、解析レポートを購入済み・完全解析が未購入のものだけ。
      //   固有リンク・診断コード・参照元だけでは売らない（別人の記録に付けない）
      const ok = (sid) => summaries.some((x) => x.sid === sid && x.canUpgrade);
      sessionId = (linkedSid && cookieSids.includes(linkedSid) && ok(linkedSid)) ? linkedSid : (cookieSids.find(ok) || null);
      if (!sessionId) {
        const top = summaries.find((x) => x.sid === cookieSids[0]);
        if (top && top.analysis === 'suspended') return fail(res, 409, 'rights_suspended');
        if (top && live(top.complete)) return fail(res, 409, 'repurchase_not_allowed');
        return fail(res, 409, 'upgrade_not_available');
      }
      // ログイン中：この端末の購入が、このアカウントのメールで支払われたものの時だけ追加する
      //   （共有の端末で、別の人の ¥1,000 の記録に自分のメールで ¥2,000 を足し、その記録ごと引き継げてしまうのを防ぐ）
      if (account && !(await recordPaidByEmail(conn, sessionId, accountEmail))) return fail(res, 409, 'purchase_email_mismatch');
    } else {
      // ¥1,000・¥3,000：この端末の記録（固有リンクの記録を優先、無ければ権利の強い順）。その記録に有効な権利があれば断る
      //   （画面は ¥2,000・読むを出す）。返金・取消で権利が無効になった記録は、断らずに新しい記録で売る
      if (linkedSid && cookieSids.includes(linkedSid)) sessionId = linkedSid;
      else if (cookieSids.length) sessionId = cookieSids[0];
      let keepRecord = false;
      if (sessionId) {
        const sum = summaries.find((x) => x.sid === sessionId);
        // ¥2,000 の後に ¥1,000 だけ返金：完全解析を読むために、同じ記録で解析レポート（¥1,000）を買い直せる
        if (offer === 'analysis' && sum && sum.needsAnalysis) keepRecord = true;
        else if (sum && live(sum.complete)) return fail(res, 409, 'repurchase_not_allowed');
        if (sum && sum.analysis === 'suspended') return fail(res, 409, 'rights_suspended');
        if (sum && sum.analysis === 'active') return fail(res, 409, offer === 'analysis' ? 'analysis_already_purchased' : 'upgrade_available');
        if (!keepRecord && await recordHasOffer(conn, sessionId, offer)) sessionId = null;
      }
      // この端末に記録が無い時：固有リンクの記録（同じ診断コード・未引き継ぎ・この端末以外の注文が無い・まだその物を買っていない）に
      //   結び付ける。使えないリンクは断らずに新しい記録で売る（ログインなしでは同じ人か確かめられない。別の人の購入を根拠にしない）
      if (!sessionId && linkedSid && !(await recordHasOffer(conn, linkedSid, offer))) sessionId = linkedSid;
      if (!sessionId) {
        sessionId = await CP.rpc(fetchImpl, conn, 'complete_create_guest_record', record);
        if (!CE.isUuid(sessionId)) return failLogged(res, 500, 'checkout_failed', 'guest_record_invalid');
      }
    }

    // 払える画面は1つだけ：この端末の同じ診断結果の別の記録・ログイン中の本人のアカウントの、決済中の画面を先に閉じる
    //   （¥1,000 の画面を開いたまま ¥3,000 を選んだ等でも、選んだ方を買える。古い画面では支払えない）
    const sameCode = new Set(cookieSids);
    const others = orders.filter((o) => o.diagnosis_session_id !== sessionId && sameCode.has(o.diagnosis_session_id) && o.user_id == null)
      .concat(accountState.open);
    const closedOthers = await closeOpenOrders(conn, stripe, others);
    if (closedOthers === 'paid') return fail(res, 409, 'purchase_completed');
    if (closedOthers === 'busy') return fail(res, 409, 'checkout_in_progress');

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
    // この端末の Cookie に無い決済待ち（別のタブ・別のブラウザで始めて放置した等）：ログインなしの購入は買えることを優先し、
    //   Stripe の状態を確かめて閉じてから作り直す（支払い済みなら反映して作らない）。この端末の注文として作り直すので、
    //   支払った後にこのブラウザで読める
    if (!open) {
      const stale = (await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${sessionId}&status=in.(created,checkout_open)` +
        '&select=id,offer,status,stripe_checkout_session_id,user_id,created_at')).filter((o) => o.user_id == null);
      // 作りかけ（Stripe の画面を作る前・2分以内）の注文は、同時に届いた別の申込が作っている途中：閉じずに「手続き中」にする
      if (stale.some((o) => o.status === 'created' && !o.stripe_checkout_session_id && now() - Date.parse(o.created_at) < 2 * 60 * 1000)) {
        return fail(res, 409, 'checkout_in_progress');
      }
      for (const o of stale) {
        const settled = await settleOpen(conn, stripe, o, { expireIfOpen: true, closeAs: 'canceled' });
        if (settled === 'paid') return fail(res, 409, 'purchase_completed');
        if (settled === 'open' || settled === null) return fail(res, 409, 'checkout_in_progress');
      }
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
    const expiresAt = await orderExpiresAt(conn, order.order_id);
    if (!expiresAt) return failLogged(res, 500, 'checkout_failed', 'order_invalid');
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
        expires_at: expiresAt,
        metadata: { order_id: order.order_id, app: CP.APP, env: conn.appEnv },
        ...(accountEmail ? { customer_email: accountEmail } : {}),
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
    try {
      await CP.rpc(fetchImpl, conn, 'complete_mark_checkout_open', {
        p_order_id: order.order_id, p_checkout_session_id: session.id, p_expires_at: new Date(session.expires_at * 1000).toISOString(),
      });
    } catch (err) {
      // 注文がもう決済待ちでない（返金・異議申し立て・引き継ぎで片付けた）：作った画面は渡さず、Stripe で閉じる
      if (err && err.code === 'complete_order_not_open') {
        try { await CP.stripeCall(() => stripe.checkout.sessions.expire(session.id)); } catch { /* 35 分で切れる */ }
        return fail(res, 409, 'offer_changed');
      }
      throw err;
    }
    // 作っている間に ¥1,000 の返金・異議申し立てが入った：根拠の無い ¥2,000 の画面は渡さない（閉じて片付ける）
    if (!(await upgradeBasisStillActive(conn, order, session))) return fail(res, 409, 'offer_changed');
    // 同時に別のタブ（ログイン中のマイページ）で、この画面より前に作られた同じ結果のアカウントの画面を閉じる（払える画面は1つ。
    //   後に作られた画面は、その申込の方がこの画面を閉じる。両方を閉じない）
    if (account) {
      const again = await accountResult(account, conn, code);
      const mineAt = await orderCreatedAt(conn, order.order_id);
      if (again !== 'unknown') await closeOpenOrders(conn, stripe, again.open.filter((o) => Date.parse(o.created_at) < mineAt));
    }
    // 秘密値は Cookie にだけ入れる（応答本文・URL には出さない）
    // Cookie の上限（MAX_ENTRIES）：古い順に外す時は、支払いの無い閉じた注文から外す（支払い済みの購入をこの端末から失わない）
    const statusOf = (e) => (orders.find((o) => o.id === e.orderId) || {}).status;
    let kept = entries.filter((e) => e.orderId !== order.order_id);
    // 引き継ぎ済みの記録ごとに、印を1つは残す（ログアウト中に、引き継ぎ済みの結果をゲストとして売り直さない）
    const claimedSidOf = new Map();
    summaries.filter((x) => x.claimed).forEach((x) => x.orders.forEach((o) => claimedSidOf.set(o.id, x.sid)));
    while (kept.length >= MAX_ENTRIES) {
      // 外す順：閉じた未払いの注文（期限切れ・中止・失敗・照合できない）→ 同じ引き継ぎ済みの記録の2つ目以降の印 →
      //   決済中の注文（支払われても、購入時メールの確認で引き継げる）→ 引き継ぎ済みの記録の印 → 最も古いもの
      const closed = (e) => { const st = statusOf(e); return !st || ['expired', 'canceled', 'failed'].includes(st); };
      const dupClaimed = (e) => claimedSidOf.has(e.orderId)
        && kept.some((f) => f !== e && claimedSidOf.get(f.orderId) === claimedSidOf.get(e.orderId));
      let i = kept.findIndex((e) => closed(e) && !claimedSidOf.has(e.orderId));
      if (i < 0) i = kept.findIndex(dupClaimed);
      if (i < 0) i = kept.findIndex((e) => ['created', 'checkout_open'].includes(statusOf(e)) && !claimedSidOf.has(e.orderId));
      if (i < 0) i = kept.findIndex((e) => claimedSidOf.has(e.orderId));
      kept.splice(i >= 0 ? i : 0, 1);
    }
    res.setHeader('Set-Cookie', serializeCookie([...kept, { orderId: order.order_id, secret }]));
    return res.status(200).json({ checkoutUrl: session.url, offer, amount: CP.OFFER_AMOUNTS[offer] });
  }

  async function guestStatus(req, res, conn) {
    const parsed = parseJsonBody(req, ['code', 'resume']);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    const code = parsed.body.code;
    if (code !== undefined && (typeof code !== 'string' || !CODE_RE.test(code))) return fail(res, 400, 'invalid_request');
    const resume = parsed.body.resume;
    if (resume !== undefined && (typeof resume !== 'string' || !RESUME_RE.test(resume) || code === undefined)) return fail(res, 400, 'invalid_request');
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
    let sid = code ? await sessionForCode(conn, summaries, code) : null;
    // 固有リンクの記録がこの端末の購入にあれば、それを「この結果」とする（同じ診断コードの別の記録より優先）
    if (resume !== undefined) {
      const linked = await openResume(conn, resume);
      if (linked && linked.encoded_answers === code && summaries.some((s) => s.sid === linked.diagnosis_session_id)) sid = linked.diagnosis_session_id;
    }
    // 引き継ぎ済みの記録の秘密値は Cookie に残す（権利・閲覧には使わない。この端末で「マイページに引き継ぎ済み」と案内するためだけ）
    // 同じ診断コードの別の人・別の端末の購入は返さない（診断コードは所有の根拠にしない）
    const body = { salesOpen: CP.salesOpen(env), purchases: summaries.map((s) => publicSummary(s, code ? sid : null)) };
    if (code && !sid) body.claimedThisResult = await claimedForCode(conn, summaries, code);
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
    if (!s.owner || s.analysis !== 'active') return fail(res, 403, 'not_entitled');
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
    // この端末が記録の持ち主（支払い済みの注文の秘密値）でなければ閲覧させない
    if (!s.owner) return fail(res, 403, 'not_entitled');
    if (!RJ.viewSecretOk(env.COMPLETE_VIEW_TOKEN_SECRET)) return failLogged(res, 503, 'service_unavailable', 'view_secret_missing');
    const rows = await CP.rpc(fetchImpl, conn, 'complete_report_for_view', { p_user_id: null, p_diagnosis_session_id: s.sid });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.state === 'not_found' || row.state === 'not_entitled') return fail(res, 403, 'not_entitled');
    if (row.state === 'basis_inactive') return fail(res, 403, 'basis_inactive');
    if (row.state !== 'ok') return fail(res, 409, 'report_not_ready');
    const issued = RJ.issueViewToken(env.COMPLETE_VIEW_TOKEN_SECRET, { reportId: row.report_id, userId: null, sessionId: s.sid }, Math.floor(now() / 1000));
    return res.status(200).json({ viewUrl: `/api/complete-status?view=${issued.token}`, expiresIn: RJ.VIEW_TTL_SEC });
  }

  // 生成の最終の失敗からの作り直し（この端末の Cookie の秘密値で確かめた、未引き継ぎのゲスト記録だけ）
  async function guestRegenerate(req, res, conn) {
    const found = await withRef(req, res, conn);
    if (!found) return undefined;
    const { s } = found;
    if (s.claimed) return fail(res, 409, 'claimed');
    if (!s.owner) return fail(res, 403, 'not_entitled');
    const result = await CP.rpc(fetchImpl, conn, 'complete_regenerate_report', { p_user_id: null, p_diagnosis_session_id: s.sid });
    if (result === 'requeued' || result === 'in_progress') {
      const reports = await CP.selectRows(fetchImpl, conn, `complete_reports?diagnosis_session_id=eq.${encodeURIComponent(s.sid)}` +
        '&select=id,status,attempts,max_attempts,next_retry_at,lease_expires_at&order=created_at.desc');
      const rep = reports[0];
      if (rep && RJ.isDue(rep, now())) {
        RJ.scheduleReport(waitUntil, () => RJ.processReport({ conn, fetchImpl, storage: storageFor(conn), reportId: rep.id, logger }), logger);
      }
      return res.status(202).json({ result: 'queued' });
    }
    if (result === 'ready') return res.status(200).json({ result: 'ready' });
    if (result === 'limit_reached' || result === 'operator_required') return fail(res, 409, 'regenerate_operator_required');
    return fail(res, 403, 'not_entitled');
  }

  // トークンがあれば本人を確かめる：本人（{ id, email }）／null（トークンが無い・期限切れなど本人と確かめられない：ゲストとして売る）／
  //   'unknown'（Auth の一時的な失敗：アカウントの購入を確かめられないため、重ねて売らないよう時間をおいて再度）
  async function optionalAccount(req, conn) {
    const token = CP.bearerToken(req);
    if (!token) return null;
    try {
      return (await CP.authUser(fetchImpl, conn, token)) || null;
    } catch (err) {
      return 'unknown';
    }
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
  // ログイン中の確認済みメールが、その記録の支払い済みの購入時メールのどれかと一致する時だけ（D3。メール OTP でも Google・X でも、確認済みメールが同じなら可）。
  //   ・照合する注文は「Cookie の秘密値に対応する、支払済みの注文」。後から作られた決済待ち・期限切れ・取消の注文に妨げられない。
  //   ・その記録の決済待ちは、Stripe の状態を確かめて片付けてから移す（支払い済みなら適用、開いたままなら閉じる）。
  //   ・同じ秘密値・同じ人の再実行は冪等（already_claimed）。別の人が引き継ぎ済みなら 409。
  // 本人（ログイン中）の、同じ診断結果の記録の決済待ちを Stripe で確かめて片付ける（支払い済みなら反映・開いたままなら閉じる）
  async function settleAccountOpenForSameResult(conn, stripe, userId, guestSid) {
    const [answer] = await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=eq.${encodeURIComponent(guestSid)}&select=encoded_answers`);
    if (!answer) return;
    const mine = await CP.selectRows(fetchImpl, conn, `complete_orders?user_id=eq.${encodeURIComponent(userId)}&status=in.(created,checkout_open)` +
      '&select=id,offer,status,stripe_checkout_session_id,user_id,diagnosis_session_id');
    if (!mine.length) return;
    const ids = [...new Set(mine.map((o) => o.diagnosis_session_id))];
    const same = new Set((await CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=in.(${ids.join(',')})&select=session_id,encoded_answers`))
      .filter((a) => a.encoded_answers === answer.encoded_answers).map((a) => a.session_id));
    for (const o of mine.filter((x) => same.has(x.diagnosis_session_id))) await settleOpen(conn, stripe, o, { expireIfOpen: true });
  }

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
      // 引き継ぐ記録の決済待ち（この端末の Cookie に無いもの・Session を作る前に止まったものも）を、Stripe で確かめて片付ける。
      //   支払い済みなら反映し、開いたままなら閉じる（決済待ちが残ると引き継げない）
      const opens = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${encodeURIComponent(sid)}` +
        '&status=in.(created,checkout_open)&select=id,offer,status,stripe_checkout_session_id,user_id');
      for (const o of opens) await settleOpen(conn, stripe, o, { expireIfOpen: true });
      const mine = (await verifiedOrders(conn, found.entries)).filter((o) => o.diagnosis_session_id === sid);
      // 引き継ぎに使う注文：期限内の新しい支払い済みの注文（古い注文の引き継ぎの期限切れで止めない）
      const nowIso = new Date(now()).toISOString();
      const paid = mine.filter((o) => o.status === 'paid')
        .sort((a, b) => ((!a.claim_expires_at || a.claim_expires_at > nowIso) === (!b.claim_expires_at || b.claim_expires_at > nowIso)
          ? (a.created_at < b.created_at ? 1 : -1) : ((!a.claim_expires_at || a.claim_expires_at > nowIso) ? -1 : 1)));
      if (!paid.length) return fail(res, 409, 'claim_not_paid');
      // この記録の支払い済みの注文のどれかの購入時メールが、ログイン中の確認済みメールと一致すること（Cookie の秘密値と合わせて本人の確認）。
      //   購入時メールでの確認（guest-recover・complete_claim_guest_by_email）と同じ規則。¥1,000 と追加 ¥2,000 を別のメールで
      //   払った時も、どちらかのメールのアカウントへ引き継げる（すべての一致を求めると、どこにも引き継げなくなる）
      const all = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${encodeURIComponent(sid)}` +
        '&select=id,status,purchase_email_hmac,stripe_checkout_session_id');
      let matched = false;
      for (const o of all.filter((x) => x.status === 'paid')) {
        const h = await purchaseHmacOf(conn, stripe, o);
        if (h && sameHex(h, hmac)) { matched = true; break; }
      }
      if (!matched) return fail(res, 403, 'claim_email_mismatch');
      // 本人の同じ診断結果の記録の決済待ちも片付ける（引き継いだ後に、その決済が支払われて同じ権利を二重に払わないように）。
      //   引き継げると確かめてから行う（引き継げない時に、本人が進めている決済を閉じない）
      await settleAccountOpenForSameResult(conn, stripe, auth.user.id, sid);
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
    // 引き継いだ後にも、本人の同じ診断結果の決済中の画面を閉じる（確かめてから移すまでの間に、別のタブで開いた画面で
    //   すでに持っている物を払わせない。失敗しても引き継ぎは済んでいる）
    if (result !== 'noop') {
      try { await settleAccountOpenForSameResult(conn, stripeFor(), auth.user.id, sid); } catch (err) {
        CP.logError(logger, API, `claim_close_${err.code || 'failed'}`, CE.incidentId());
      }
    }
    // 引き継いだ記録の秘密値は Cookie に残す（引き継ぎ済みの記録の権利・閲覧には使えない。この端末で「マイページに引き継ぎ済み」と
    //   案内し、ゲストとして売り直さないためだけ）
    return res.status(200).json({ result: result === 'noop' ? 'already_claimed' : 'claimed' });
  }

  // Cookie を失った時の復旧（別の端末・別のブラウザ）：ログイン中の本人の確認済みメール（メールの6桁コード・Google 等で
  //   メールの持ち主だと確かめたもの）と、購入時メールの HMAC が一致する、支払済み・未引き継ぎの記録だけを移す。
  //   未確認のメール・メールの無いログイン（X 等）では移さない。マイページは開くたびに呼ぶ（購入時のメールで登録すれば引き継がれる）。
  //   決済待ちが残る記録は、Stripe の状態を確かめて片付けてから移す。
  async function guestRecover(req, res, conn) {
    const auth = await authenticated(req, res, conn);
    if (!auth) return undefined;
    const parsed = parseJsonBody(req, []);
    if (!parsed.ok) return fail(res, parsed.tooLarge ? 413 : 400, parsed.tooLarge ? 'payload_too_large' : 'invalid_request');
    // 確認済みのメールだけを使う（未確認のメールは「メールなし」と同じ扱い。lib/complete-payment.js の authUser）
    if (!auth.user.email) return fail(res, 403, auth.user.emailUnconfirmed ? 'claim_email_unconfirmed' : 'claim_email_required');
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
      for (const sid of sids) await settleAccountOpenForSameResult(conn, stripe, auth.user.id, sid);
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
    // 引き継いだ後にも、本人の同じ診断結果の決済中の画面を閉じる（引き継ぎ（Cookie）と同じ）
    for (const sid of sids) {
      try { await settleAccountOpenForSameResult(conn, stripeFor(), auth.user.id, sid); } catch (err) {
        CP.logError(logger, API, `claim_close_${err.code || 'failed'}`, CE.incidentId());
      }
    }
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
    'result-link': resultLink,
    'result-open': resultOpen,
    'guest-regenerate': guestRegenerate,
    'guest-view': guestView,
    'guest-claim': guestClaim,
    'guest-recover': guestRecover,
    'guest-cancel': guestCancel,
    'user-checkout-reset': userCheckoutReset,
  };

  // ログイン中の購入（マイページ）の前に：この端末の Cookie に、同じ診断コードの未引き継ぎの支払い済みの購入があるか。
  //   ある時はアカウントで重ねて売らない（先に引き継ぐ）。確かめられない時は false（買えることを優先する）
  //   引き継げる（ログイン中の確認済みメールが、その記録の支払いのどれかの購入時メールと一致する）時だけ true。
  //   別のメールの購入（同じ端末の別の人の購入かもしれない）では断らない（この人は自分のアカウントで買える）
  async function cookieOwnsCode(req, conn, code, email) {
    try {
      const hmac = email ? CA.purchaseEmailHmac(env, email) : null;
      if (!hmac) return false;
      const summaries = await summarize(conn, await verifiedOrders(conn, cookieEntries(req)));
      const sids = await sessionsForCode(conn, summaries.filter((x) => x.owner && x.paid), code);
      const stripe = stripeFor();
      for (const sid of sids) {
        const paid = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${encodeURIComponent(sid)}&status=eq.paid` +
          '&select=id,status,purchase_email_hmac,stripe_checkout_session_id');
        for (const o of paid) {
          const h = await purchaseHmacOf(conn, stripe, o);
          if (h && sameHex(h, hmac)) return true;
        }
      }
      return false;
    } catch (err) {
      return false;
    }
  }
  // ログイン中の本人の確認済みメールで支払った、未引き継ぎのゲストの購入（同じ診断コード）がある記録 ID。
  //   別の端末で買った・Cookie を消した後でも、同じ人に同じ物を重ねて売らない（先に購入時メールの確認で引き継ぐ）。
  //   except：この端末の Cookie で確かめた記録（その画面で読める・追加できる）。確かめられない時は []（買えることを優先する）
  async function emailPurchasesForCode(conn, email, code, except = []) {
    try {
      const hmac = email ? CA.purchaseEmailHmac(env, email) : null;
      if (!hmac || !code) return [];
      const rows = (await CP.selectRows(fetchImpl, conn, `complete_orders?buyer=eq.guest&status=in.(paid,disputed)` +
        `&purchase_email_hmac=eq.${hmac}&select=diagnosis_session_id,user_id`)).filter((r) => r.user_id == null);
      const sids = [...new Set(rows.map((r) => r.diagnosis_session_id))].filter((sid) => CE.isUuid(sid) && !except.includes(sid));
      if (!sids.length) return [];
      const [sessions, answers] = await Promise.all([
        CP.selectRows(fetchImpl, conn, `diagnosis_sessions?id=in.(${sids.join(',')})&select=id,user_id`),
        CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=in.(${sids.join(',')})&select=session_id,encoded_answers`),
      ]);
      const open = new Set(sessions.filter((s) => s.user_id == null).map((s) => s.id));
      return answers.filter((a) => a.encoded_answers === code && open.has(a.session_id)).map((a) => a.session_id);
    } catch (err) {
      return [];
    }
  }
  // この記録の支払いのどれかが、このメールで支払われたか（引き継ぎと同じ照合）
  async function recordPaidByEmail(conn, sid, email) {
    const hmac = email ? CA.purchaseEmailHmac(env, email) : null;
    if (!hmac) return false;
    const paid = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=eq.${encodeURIComponent(sid)}&status=eq.paid` +
      '&select=id,status,purchase_email_hmac,stripe_checkout_session_id');
    const stripe = stripeFor();
    for (const o of paid) {
      const h = await purchaseHmacOf(conn, stripe, o);
      if (h && sameHex(h, hmac)) return true;
    }
    return false;
  }
  async function emailOwnsCode(conn, email, code) { return (await emailPurchasesForCode(conn, email, code)).length > 0; }
  async function settleOrder(conn, order, opts) { return settleOpen(conn, stripeFor(), order, opts); }
  // 追加 ¥2,000 の画面を渡す直前に、根拠（同じ記録の有効な解析権）を確かめ直す。作っている間に返金・異議申し立てで
  //   止まった時は、その画面を閉じて注文を片付け、false を返す（根拠の無い ¥2,000 を払わせない）
  async function upgradeBasisStillActive(conn, order, session) {
    if (order.offer !== 'analysis_upgrade') return true;
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(order.order_id)}&select=diagnosis_session_id`);
    const sid = rows[0] && rows[0].diagnosis_session_id;
    const basis = sid ? await CP.selectRows(fetchImpl, conn, `record_entitlements?diagnosis_session_id=eq.${encodeURIComponent(sid)}` +
      '&right_type=eq.analysis&status=eq.active&select=diagnosis_session_id') : [];
    if (basis.length) return true;
    const r = await settleOpen(conn, stripeFor(), { id: order.order_id, status: 'checkout_open', stripe_checkout_session_id: session.id },
      { expireIfOpen: true, closeAs: 'canceled' });
    return r === 'paid';
  }
  async function orderCreatedAt(conn, orderId) {
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(orderId)}&select=created_at`);
    return rows[0] ? Date.parse(rows[0].created_at) : NaN;
  }
  // 決済画面の期限（注文の作成時刻から固定。lib/complete-payment.js）
  async function orderExpiresAt(conn, orderId) {
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(orderId)}&select=created_at`);
    return rows[0] ? CP.checkoutExpiresAt(rows[0].created_at) : null;
  }
  // 返金・異議申し立てで解析レポートの権利が止まった：その記録（ログイン中は同じ診断結果の記録）の、追加 ¥2,000 の決済中の画面を閉じる
  //   （根拠の無い ¥2,000 を払わせない）
  async function closeUpgradesAfterBasisChange(conn, orderId) {
    const rows = await CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(orderId)}&select=diagnosis_session_id,user_id`);
    const o = rows[0];
    if (!o) return 'ok';
    // その記録に有効な解析権が残っている（買い直した等）：¥2,000 の画面は正しいので閉じない
    const basis = await CP.selectRows(fetchImpl, conn, `record_entitlements?diagnosis_session_id=eq.${encodeURIComponent(o.diagnosis_session_id)}` +
      '&right_type=eq.analysis&status=eq.active&select=diagnosis_session_id');
    if (basis.length) return 'ok';
    let ids = [o.diagnosis_session_id];
    if (o.user_id) {
      const st = PS.computeStates(await PS.loadUserFacts((path) => CP.selectRows(fetchImpl, conn, path), o.user_id))[o.diagnosis_session_id];
      if (st) ids = st.memberIds;
    }
    const open = await CP.selectRows(fetchImpl, conn, `complete_orders?diagnosis_session_id=in.(${ids.join(',')})` +
      `&offer=eq.analysis_upgrade&status=in.(created,checkout_open)&select=${OPEN_ORDER_SELECT}`);
    return closeOpenOrders(conn, stripeFor(), open.filter((x) => (x.user_id || null) === (o.user_id || null)), { force: true });
  }

  async function guestHandler(op, req, res, conn) {
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
  }
  guestHandler.cookieOwnsCode = cookieOwnsCode;
  guestHandler.emailOwnsCode = emailOwnsCode;
  guestHandler.settleOrder = settleOrder;
  guestHandler.closeOpenOrders = (conn, rows) => closeOpenOrders(conn, stripeFor(), rows);
  guestHandler.cookieOpenForCode = cookieOpenForCode;
  guestHandler.orderExpiresAt = orderExpiresAt;
  guestHandler.upgradeBasisStillActive = upgradeBasisStillActive;
  guestHandler.orderCreatedAt = orderCreatedAt;
  guestHandler.closeUpgradesAfterBasisChange = closeUpgradesAfterBasisChange;
  return guestHandler;
}

module.exports = {
  COOKIE, MAX_ENTRIES, OTP_MAX_AGE_SEC, GUEST_OFFERS,
  createGuestHandler, parseCookieHeader, serializeCookie, secretHash, refOf, recordFromCode, recentEmailOtp, jwtClaims, clientAddress,
};
