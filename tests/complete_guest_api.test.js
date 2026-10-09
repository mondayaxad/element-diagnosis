// ゲスト購入（診断完了ページ）・購入完了ページ・マイページへの引き継ぎ・メール OTP での復旧の試験。
//   本物の SQL 関数（complete_01〜07）が必要：COMPLETE_DB_BACKEND=<createBackend を返すモジュール> と PGT_HOST を指定して実行する
//   （ローカル PG17 に complete_01〜07 を適用した DB。tests/complete_payment_api.test.js と同じ部品）。
//   指定が無い時は skip する（メモリ上の模型には complete_07 の規則を写していないため）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PREVIEW_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const { savedRecord, variantAnswers } = require('./fixtures/report_data');
const GP = require('../lib/guest-purchase');
const CA = require('../lib/complete-apply');

const BACKEND = process.env.COMPLETE_DB_BACKEND;
const skip = BACKEND ? false : 'COMPLETE_DB_BACKEND（PG17・complete_01〜07）が無いため skip';
const Checkout = require('../api/complete-checkout.js');
const Webhook = require('../api/stripe-webhook.js');
const ReportData = require('../api/report-data.js');

const SECRET = 'whsec_test_fake_secret_for_unit_tests';
const ORIGIN = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const VIEW_SECRET = crypto.randomBytes(32).toString('base64url');
const ENV = {
  ...PREVIEW_ENV,
  COMPLETE_SALES_OPEN: 'true',
  COMPLETE_CHECKOUT_ORIGIN: ORIGIN,
  STRIPE_PRICE_ANALYSIS: 'price_test_analysis1000',
  STRIPE_COMPLETE_PRICE_DIRECT: 'price_test_direct3000',
  STRIPE_COMPLETE_PRICE_UPGRADE: 'price_test_upgrade2000',
  STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET,
  COMPLETE_VIEW_TOKEN_SECRET: VIEW_SECRET,
};
const PRICES = {
  price_test_analysis1000: { id: 'price_test_analysis1000', active: true, livemode: false, currency: 'jpy', unit_amount: 1000, type: 'one_time' },
  price_test_direct3000: { id: 'price_test_direct3000', active: true, livemode: false, currency: 'jpy', unit_amount: 3000, type: 'one_time' },
  price_test_upgrade2000: { id: 'price_test_upgrade2000', active: true, livemode: false, currency: 'jpy', unit_amount: 2000, type: 'one_time' },
};
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CODE_A = savedRecord().encoded_answers;
const CODE_B = savedRecord(variantAnswers(1)).encoded_answers;
const CODE_C = savedRecord(variantAnswers(2)).encoded_answers;

function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end() { return this; },
  };
}
function makeLogger() {
  const lines = [];
  const push = (...a) => lines.push(a.map(String).join(' '));
  return { lines, error: push, warn: push, log: push, info: push };
}
// JWT の形をしたアクセストークン（amr 付き）。署名の確認は偽の Auth（/auth/v1/user）が token の一致で行う
function jwtWith(claims) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b(claims)}.${crypto.randomBytes(16).toString('base64url')}`;
}

async function setup({ env = {} } = {}) {
  const db = await require(BACKEND).createBackend();
  const stripe = fakeStripe({ prices: JSON.parse(JSON.stringify(PRICES)) });
  const logger = makeLogger();
  const fullEnv = { ...ENV, ...env };
  const deps = { env: fullEnv, fetchImpl: db.fetchImpl, stripeFactory: stripe.factory, logger, waitUntil: null };
  const checkoutH = Checkout.createHandler(deps);
  const webhookH = Webhook.createHandler(deps);
  const bodies = [];
  const ctx = {
    db, stripe, logger, env: fullEnv, bodies, cookie: '',
    // ブラウザ（Cookie を保持する）として呼ぶ
    async op(op, body, { token, cookie } = {}) {
      const res = makeRes();
      const headers = { host: 'evil.example' };
      const jar = cookie !== undefined ? cookie : ctx.cookie;
      if (jar) headers.cookie = jar;
      if (token) headers.authorization = `Bearer ${token}`;
      await checkoutH({ method: 'POST', headers, query: { op }, body }, res);
      const set = res.headers['set-cookie'];
      if (set && cookie === undefined) ctx.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      bodies.push(JSON.stringify(res.body));
      return res;
    },
    async webhook(opts) {
      const { req } = eventRequest({ secret: SECRET, ...opts });
      const res = makeRes();
      await webhookH(req, res);
      return res;
    },
    async reportData(url) {
      const token = decodeURIComponent(url.split('token=')[1]);
      const res = makeRes();
      await ReportData.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl })({ method: 'GET', headers: {}, query: { token } }, res);
      return res;
    },
    csIdOf(url) { return url.split('/').pop(); },
    async rows(t) { return db.rows(t); },
  };
  return ctx;
}

async function buy(ctx, body, { email = 'guest.buyer@example.test' } = {}) {
  const r = await ctx.op('guest-checkout', body);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  const paid = ctx.stripe.pay(cs, { customer_details: { email } });
  return { r, cs, ...paid };
}

test('販売停止・入力の検査：sales_closed／余分な項目・不正なコード・目標の不足は拒否（DB・Stripe に触れない）', { skip }, async () => {
  const closed = await setup({ env: { COMPLETE_SALES_OPEN: undefined } });
  const r0 = await closed.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.deepEqual([r0.code, r0.body], [503, { error: 'sales_closed' }]);
  assert.deepEqual(closed.stripe.st.calls, []);
  await closed.db.close();
  const ctx = await setup();
  for (const [body, code] of [
    [{ offer: 'analysis', code: CODE_A, price: 1 }, 400], [{ offer: 'analysis', code: CODE_A, amount: 1 }, 400],
    [{ offer: 'complete', code: CODE_A }, 400], [{ offer: 'analysis', code: 'NOT A CODE' }, 400],
    [{ offer: 'direct_complete', code: CODE_A }, 400], [{ offer: 'analysis', code: CODE_A, goal: 'GOAL_PACE_01' }, 400],
  ]) {
    const r = await ctx.op('guest-checkout', body);
    assert.equal(r.code, code, JSON.stringify(body));
  }
  assert.deepEqual(ctx.stripe.st.calls, []);
  assert.equal((await ctx.rows('complete_orders')).length, 0);
  await ctx.db.close();
});

test('ゲスト ¥1,000：サーバーが記録を作り、Checkout は metadata 3つ・client_reference_id／メールなし・Cookie は HttpOnly／Secure／SameSite=Lax', { skip }, async () => {
  const ctx = await setup();
  const r = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['amount', 'checkoutUrl', 'offer']);
  assert.equal(r.body.amount, 1000);
  const p = ctx.stripe.st.lastCreate.params;
  assert.deepEqual(Object.keys(p.metadata).sort(), ['app', 'env', 'order_id']);
  assert.equal(p.client_reference_id, undefined);
  assert.equal(p.customer_email, undefined);
  assert.equal(p.success_url, `${ORIGIN}/purchase-complete`);
  assert.equal(p.cancel_url, `${ORIGIN}/purchase-complete?status=canceled`);
  assert.doesNotMatch(JSON.stringify(p), new RegExp(CODE_A));
  assert.deepEqual(p.line_items, [{ price: 'price_test_analysis1000', quantity: 1 }]);
  // Cookie：__Host-・Secure・HttpOnly・SameSite=Lax。秘密値は Cookie にだけあり、DB はハッシュだけ
  const set = r.headers['set-cookie'];
  assert.match(set, /^__Host-ed_gp=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/);
  const secret = set.split('=')[1].split(';')[0].split('.')[1];
  assert.equal(Buffer.from(secret, 'base64url').length, 32);
  const [order] = await ctx.rows('complete_orders');
  assert.equal(order.claim_secret_hash, crypto.createHash('sha256').update(secret).digest('hex'));
  assert.ok(!JSON.stringify(await ctx.rows('complete_orders')).includes(secret));
  assert.deepEqual([order.amount, order.offer, order.buyer, order.user_id, order.status], [1000, 'analysis', 'guest', null, 'checkout_open']);
  // 記録はサーバーが回答から算出し直したもの（所有者なし・RC1 の版）
  const sessions = await ctx.rows('diagnosis_sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].user_id, null);
  const results = await ctx.rows('diagnosis_results');
  assert.deepEqual(results[0].v2_scores, savedRecord().v2_scores);
  assert.deepEqual(results[0].mirror_snapshot, savedRecord().mirror_snapshot);
  // 応答本文に秘密値・注文 ID・Session ID が無い
  assert.ok(!r.body.checkoutUrl.includes(secret));
  assert.doesNotMatch(JSON.stringify(r.body), UUID_RE);
  await ctx.db.close();
});

test('購入完了ページ：Webhook より先でも Stripe に問い合わせて付与・解析レポートをすぐ読める・Webhook の再送で増えない', { skip }, async () => {
  const ctx = await setup();
  const { cs } = await buy(ctx, { offer: 'analysis', code: CODE_A });
  const s1 = await ctx.op('guest-status', {});
  assert.equal(s1.code, 200);
  assert.equal(s1.body.purchases.length, 1);
  const pu = s1.body.purchases[0];
  assert.deepEqual([pu.analysis, pu.complete, pu.pending, pu.canClaim, pu.canUpgrade], ['active', null, false, true, true]);
  assert.match(pu.ref, /^[0-9a-f]{20}$/);
  // 解析レポートの閲覧リンク → report-data が記録単位の解析権で code を返す
  const link = await ctx.op('guest-report', { ref: pu.ref });
  assert.equal(link.code, 200);
  assert.match(link.body.url, /^\/report\.html\?token=/);
  const data = await ctx.reportData(link.body.url);
  assert.equal(data.code, 200);
  assert.equal(data.body.entitlements.core_analysis_access, true);
  assert.equal(data.body.code, CODE_A);
  // Webhook（後から到着・2回）：権利・注文は増えない
  for (let i = 0; i < 2; i++) {
    const w = await ctx.webhook({ type: 'checkout.session.completed', objectId: cs, id: 'evt_guestanalysis000001' });
    assert.equal(w.code, 200);
  }
  const w2 = await ctx.webhook({ type: 'checkout.session.completed', objectId: cs });
  assert.equal(w2.code, 200);
  assert.equal((await ctx.rows('record_entitlements')).length, 1);
  assert.equal((await ctx.rows('complete_orders')).filter((o) => o.status === 'paid').length, 1);
  assert.equal((await ctx.rows('complete_reports')).length, 0);
  // 購入時メールは HMAC だけ（メールの文字列は DB に無い）
  const [order] = await ctx.rows('complete_orders');
  assert.equal(order.purchase_email_hmac, CA.purchaseEmailHmac(ctx.env, 'guest.buyer@example.test'));
  assert.ok(!JSON.stringify(await ctx.rows('complete_orders')).includes('guest.buyer'));
  await ctx.db.close();
});

test('ゲスト ¥2,000（同じ記録・同じブラウザ）→ 完全解析 queued。¥3,000 は別の記録で解析＋完全解析', { skip }, async () => {
  const ctx = await setup();
  await buy(ctx, { offer: 'analysis', code: CODE_A });
  await ctx.op('guest-status', {});
  const noGoal = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A });
  assert.equal(noGoal.code, 400);
  await buy(ctx, { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal(ctx.stripe.st.lastCreate.params.line_items[0].price, 'price_test_upgrade2000');
  const s = await ctx.op('guest-status', { code: CODE_A });
  const mine = s.body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([mine.analysis, mine.complete, mine.report, mine.canUpgrade], ['active', 'active', 'queued', false]);
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 1, '同じ記録に積む');
  // 同じ記録の ¥2,000 の再購入・¥1,000 の再購入はできない
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' })).code, 409);
  // ¥3,000（別の記録）
  await buy(ctx, { offer: 'direct_complete', code: CODE_B, goal: 'GOAL_EXPLORE_01' });
  const s2 = await ctx.op('guest-status', { code: CODE_B });
  const b = s2.body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([b.analysis, b.complete, b.report], ['active', 'active', 'queued']);
  const orders = await ctx.rows('complete_orders');
  assert.deepEqual(orders.filter((o) => o.status === 'paid').map((o) => `${o.offer}:${o.amount}`).sort(),
    ['analysis:1000', 'analysis_upgrade:2000', 'direct_complete:3000']);
  // 完全解析の閲覧：生成前は 409 report_not_ready
  assert.equal((await ctx.op('guest-view', { ref: b.ref })).code, 409);
  // Cookie の無いブラウザでは何も見えない・ref だけでは開けない
  const other = await ctx.op('guest-report', { ref: b.ref }, { cookie: '' });
  assert.equal(other.code, 403);
  await ctx.db.close();
});

test('アップグレードは同じブラウザの解析購入が必要・別の offer に切り替えると前の Stripe 画面を閉じる', { skip }, async () => {
  const ctx = await setup();
  const up = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_C, goal: 'GOAL_PACE_01' });
  assert.deepEqual([up.code, up.body.error], [409, 'upgrade_requires_analysis']);
  const a = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_C });
  assert.equal(a.code, 200);
  const again = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_C });
  assert.equal(again.body.checkoutUrl, a.body.checkoutUrl, '同じ offer は同じ画面');
  const d = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_C, goal: 'GOAL_PACE_01' });
  assert.equal(d.code, 200);
  assert.notEqual(d.body.checkoutUrl, a.body.checkoutUrl);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(a.body.checkoutUrl)].status, 'expired');
  const orders = await ctx.rows('complete_orders');
  assert.deepEqual(orders.map((o) => `${o.offer}:${o.status}`).sort(), ['analysis:canceled', 'direct_complete:checkout_open']);
  await ctx.db.close();
});

test('引き継ぎ：ログイン必須・支払済みだけ・1回限り（同じ人は冪等・別の人は 409）・改ざん／期限切れ／未払いは拒否', { skip }, async () => {
  const ctx = await setup();
  await buy(ctx, { offer: 'analysis', code: CODE_A });
  const st = await ctx.op('guest-status', {});
  const ref = st.body.purchases[0].ref;
  const original = ctx.cookie;
  const tokA = 'tok-claim-a';
  const tokB = 'tok-claim-b';
  const userA = await ctx.db.user({ email: 'a@example.test', token: tokA });
  await ctx.db.user({ email: 'b@example.test', token: tokB });
  assert.equal((await ctx.op('guest-claim', { ref })).code, 401);
  // 改ざんした秘密値
  const tampered = original.replace(/\.([A-Za-z0-9_-])/, (m, c) => `.${c === 'A' ? 'B' : 'A'}`);
  assert.equal((await ctx.op('guest-claim', { ref }, { token: tokA, cookie: tampered })).code, 403);
  // 引き継ぎ
  const c1 = await ctx.op('guest-claim', { ref }, { token: tokA });
  assert.deepEqual([c1.code, c1.body], [200, { result: 'claimed' }]);
  assert.equal(ctx.cookie, '', '引き継いだ秘密値は Cookie から外す');
  const [session] = await ctx.rows('diagnosis_sessions');
  assert.equal(session.user_id, userA);
  for (const t of ['complete_orders', 'record_entitlements']) assert.ok((await ctx.rows(t)).every((x) => x.user_id === userA), t);
  // 古い Cookie を再送：同じ人は冪等、別の人は 409
  const again = await ctx.op('guest-claim', { ref }, { token: tokA, cookie: original });
  assert.deepEqual([again.code, again.body], [200, { result: 'already_claimed' }]);
  const steal = await ctx.op('guest-claim', { ref }, { token: tokB, cookie: original });
  assert.deepEqual([steal.code, steal.body.error], [409, 'claim_conflict']);
  // 引き継ぎ後は Cookie で閲覧できない（マイページで見る）
  assert.equal((await ctx.op('guest-report', { ref }, { cookie: original })).code, 409);
  // マイページの購入済み判定（/api/my-entitlements）は tests/mentor_goal_api.test.js で確かめる（入れ子の select のため）
  assert.ok((await ctx.rows('record_entitlements')).some((e) => e.user_id === userA && e.right_type === 'analysis' && e.status === 'active'));

  // 未払い（決済待ち）・期限切れ
  ctx.cookie = '';
  await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B });
  const pend = (await ctx.op('guest-status', {})).body.purchases[0];
  assert.equal(pend.canClaim, false);
  assert.equal((await ctx.op('guest-claim', { ref: pend.ref }, { token: tokB })).code, 409);
  const cs = Object.keys(ctx.stripe.st.sessions).pop();
  ctx.stripe.pay(cs, { customer_details: { email: 'x@example.test' } });
  await ctx.op('guest-status', {});
  const ord = (await ctx.rows('complete_orders')).find((o) => o.user_id === null && o.status === 'paid');
  await ctx.db.patch('complete_orders', ord.id, { claim_expires_at: new Date(Date.now() - 1000).toISOString() });
  const exp = await ctx.op('guest-claim', { ref: pend.ref }, { token: tokB });
  assert.deepEqual([exp.code, exp.body.error], [410, 'claim_expired']);
  await ctx.db.close();
});

test('Cookie を失った時の復旧：メール OTP（10分以内）＋購入時メールの一致だけ。OTP 以外のログイン・メールの一致だけでは引き継がない', { skip }, async () => {
  const ctx = await setup();
  await buy(ctx, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }, { email: 'Owner@Example.test' });
  await ctx.op('guest-status', {});
  ctx.cookie = '';
  const now = Math.floor(Date.now() / 1000);
  const oauth = jwtWith({ sub: 'x', amr: [{ method: 'oauth', timestamp: now }] });
  const oldOtp = jwtWith({ sub: 'x', amr: [{ method: 'otp', timestamp: now - 3600 }] });
  const otp = jwtWith({ sub: 'x', amr: [{ method: 'otp', timestamp: now - 30 }] });
  const otherOtp = jwtWith({ sub: 'y', amr: [{ method: 'otp', timestamp: now - 30 }] });
  const owner = await ctx.db.user({ email: 'owner@example.test', token: oauth });
  await ctx.db.user({ id: crypto.randomUUID(), email: 'someone@example.test', token: otherOtp });
  // 同じ人の別トークン（OTP の古さ・方式だけを変える）
  const ownerOld = await ctx.db.user({ email: 'owner@example.test', token: oldOtp });
  const ownerOtp = await ctx.db.user({ email: 'owner@example.test', token: otp });
  assert.deepEqual([(await ctx.op('guest-recover', {}, { token: oauth })).body.error], ['email_otp_required']);
  assert.deepEqual([(await ctx.op('guest-recover', {}, { token: oldOtp })).body.error], ['email_otp_required']);
  const wrong = await ctx.op('guest-recover', {}, { token: otherOtp });
  assert.deepEqual([wrong.code, wrong.body], [200, { claimed: 0, skipped: 0 }]);
  const ok = await ctx.op('guest-recover', {}, { token: otp });
  assert.deepEqual([ok.code, ok.body], [200, { claimed: 1, skipped: 0 }]);
  const [session] = await ctx.rows('diagnosis_sessions');
  assert.equal(session.user_id, ownerOtp);
  assert.ok((await ctx.rows('complete_orders')).every((o) => o.claim_method === 'email_otp'));
  assert.ok((await ctx.rows('complete_reports')).every((r) => r.user_id === ownerOtp));
  const again = await ctx.op('guest-recover', {}, { token: otp });
  assert.deepEqual(again.body, { claimed: 0, skipped: 0 });
  assert.ok(owner && ownerOld);
  await ctx.db.close();
});

test('支払い後の一時的な失敗：DB の失敗は付与せず、次の確認（再処理）で回復する', { skip }, async () => {
  const ctx = await setup();
  await buy(ctx, { offer: 'analysis', code: CODE_A });
  ctx.db.failNext('rpc:complete_apply_payment');
  const s1 = await ctx.op('guest-status', {});
  assert.equal(s1.code, 200);
  assert.equal(s1.body.purchases[0].analysis, null);
  assert.equal(s1.body.purchases[0].pending, true);
  const s2 = await ctx.op('guest-status', {});
  assert.equal(s2.body.purchases[0].analysis, 'active');
  assert.equal((await ctx.rows('record_entitlements')).length, 1);
  await ctx.db.close();
});

test('応答・ログに秘密値・注文 ID・Session ID・メール・診断コードを出さない', { skip }, async () => {
  const ctx = await setup();
  await buy(ctx, { offer: 'analysis', code: CODE_A });
  const st = await ctx.op('guest-status', { code: CODE_A });
  await ctx.op('guest-report', { ref: st.body.purchases[0].ref });
  const secret = ctx.cookie.split('.')[1];
  const all = ctx.bodies.filter((b) => !b.includes('checkoutUrl')).join('\n') + ctx.logger.lines.join('\n');
  assert.ok(!all.includes(secret));
  assert.doesNotMatch(all, UUID_RE);
  assert.doesNotMatch(all, /cs_test_|pi_[A-Za-z0-9]|@|evt_/);
  assert.ok(!all.includes(CODE_A));
  await ctx.db.close();
});

test('Cookie の解析：形式外の値・重複を捨て、最大件数を超えたら古いものから外す', () => {
  const id = () => crypto.randomUUID();
  const s = () => crypto.randomBytes(32).toString('base64url');
  const a = `${id()}.${s()}`;
  const list = GP.parseCookieHeader(`x=1; __Host-ed_gp=${a}~bad~${a}~${id()}.short; y=2`);
  assert.equal(list.length, 1);
  const many = Array.from({ length: 20 }, () => ({ orderId: id(), secret: s() }));
  const ser = GP.serializeCookie(many);
  assert.equal(GP.parseCookieHeader(ser.split(';')[0]).length, GP.MAX_ENTRIES);
  assert.match(GP.serializeCookie([]), /Max-Age=0/);
  assert.equal(GP.recentEmailOtp({ amr: [{ method: 'otp', timestamp: 1000 }] }, 1000 + 601), false);
  assert.equal(GP.recentEmailOtp({ amr: [{ method: 'otp', timestamp: 1000 }] }, 1000 + 599), true);
  assert.equal(GP.recentEmailOtp({ amr: [{ method: 'oauth', timestamp: 1000 }] }, 1001), false);
  assert.equal(GP.recordFromCode('ZZ'), null);
  assert.equal(GP.recordFromCode('abc DEF'), null);
  assert.equal(GP.recordFromCode(CODE_A).p_encoded_answers, CODE_A);
});
