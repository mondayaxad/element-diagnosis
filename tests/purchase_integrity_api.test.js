// 購入・権利の整合（リリース前監査 C1〜C9・D1〜D6）の試験。本物の SQL 関数（complete_01〜08）で実行する。
//   COMPLETE_DB_BACKEND=<createBackend を返すモジュール> と PGT_HOST を指定して実行する（tests/complete_guest_api.test.js と同じ部品）。
//   指定が無い時は skip する（メモリ上の模型には complete_07・08 の規則を写していないため）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PREVIEW_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const { savedRecord, variantAnswers } = require('./fixtures/report_data');

const BACKEND = process.env.COMPLETE_DB_BACKEND;
const skip = BACKEND ? false : 'COMPLETE_DB_BACKEND（PG17・complete_01〜08）が無いため skip';
const Checkout = require('../api/complete-checkout.js');
const Webhook = require('../api/stripe-webhook.js');
const MyEnt = require('../api/my-entitlements.js');
const MentorGoal = require('../api/mentor-goal.js');
const Status = require('../api/complete-status.js');
const MyReportLink = require('../api/my-report-link.js');
const ReportData = require('../api/report-data.js');

const SECRET = 'whsec_test_fake_secret_for_unit_tests';
const ORIGIN = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const ENV = {
  ...PREVIEW_ENV,
  COMPLETE_SALES_OPEN: 'true',
  COMPLETE_CHECKOUT_ORIGIN: ORIGIN,
  STRIPE_PRICE_ANALYSIS: 'price_test_analysis1000',
  STRIPE_COMPLETE_PRICE_DIRECT: 'price_test_direct3000',
  STRIPE_COMPLETE_PRICE_UPGRADE: 'price_test_upgrade2000',
  STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET,
  COMPLETE_VIEW_TOKEN_SECRET: crypto.randomBytes(32).toString('base64url'),
};
const PRICES = {
  price_test_analysis1000: { id: 'price_test_analysis1000', active: true, livemode: false, currency: 'jpy', unit_amount: 1000, type: 'one_time' },
  price_test_direct3000: { id: 'price_test_direct3000', active: true, livemode: false, currency: 'jpy', unit_amount: 3000, type: 'one_time' },
  price_test_upgrade2000: { id: 'price_test_upgrade2000', active: true, livemode: false, currency: 'jpy', unit_amount: 2000, type: 'one_time' },
};
const CODE_A = savedRecord().encoded_answers;
const CODE_B = savedRecord(variantAnswers(1)).encoded_answers;

function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); },
    end() { return this; },
  };
}
function makeLogger() {
  const lines = [];
  const push = (...a) => lines.push(a.map(String).join(' '));
  return { lines, error: push, warn: push, log: push, info: push };
}

// 失敗した試験でも DB を閉じる（接続が残って試験の実行が終わらないのを防ぐ）
const OPEN = [];
test.afterEach(async () => {
  while (OPEN.length) {
    const db = OPEN.pop();
    if (!db.__closed) await db.close().catch(() => {});
  }
});

async function setup({ env = {} } = {}) {
  const db = await require(BACKEND).createBackend();
  const close0 = db.close.bind(db);
  db.close = async () => { if (db.__closed) return; db.__closed = true; await close0(); };
  OPEN.push(db);
  const stripe = fakeStripe({ prices: JSON.parse(JSON.stringify(PRICES)) });
  const logger = makeLogger();
  const fullEnv = { ...ENV, ...env };
  const deps = { env: fullEnv, fetchImpl: db.fetchImpl, stripeFactory: stripe.factory, logger, waitUntil: null };
  const checkoutH = Checkout.createHandler(deps);
  const webhookH = Webhook.createHandler(deps);
  const ctx = {
    db, stripe, logger, env: fullEnv, cookie: '',
    async checkout(token, body) {
      const res = makeRes();
      await checkoutH({ method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${token}` }, body }, res);
      return res;
    },
    // ブラウザ（Cookie を保持する）として ?op= を呼ぶ
    async op(op, body, { token, cookie } = {}) {
      const res = makeRes();
      const headers = { host: 'evil.example' };
      const jar = cookie !== undefined ? cookie : ctx.cookie;
      if (jar) headers.cookie = jar;
      if (token) headers.authorization = `Bearer ${token}`;
      await checkoutH({ method: 'POST', headers, query: { op }, body }, res);
      const set = res.headers['set-cookie'];
      if (set && cookie === undefined) ctx.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return res;
    },
    async webhook(opts) {
      const { req } = eventRequest({ secret: SECRET, ...opts });
      const res = makeRes();
      await webhookH(req, res);
      return res;
    },
    async entitlements(token) {
      const res = makeRes();
      const orig = console.error; console.error = () => {};
      try { await MyEnt.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl })({ method: 'GET', headers: { host: 'x', authorization: `Bearer ${token}` } }, res); }
      finally { console.error = orig; }
      return res;
    },
    async mentor(token, sessionId, goalId) {
      const res = makeRes();
      await MentorGoal.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl, logger })(
        { method: 'POST', headers: { host: 'x', authorization: `Bearer ${token}` }, body: { diagnosisSessionId: sessionId, goalId } }, res);
      return res;
    },
    async status(token, sessionId, method = 'GET') {
      const res = makeRes();
      const h = Status.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl, logger, waitUntil: null });
      if (method === 'GET') await h({ method, headers: { authorization: `Bearer ${token}` }, query: { diagnosisSessionId: sessionId } }, res);
      else await h({ method, headers: { authorization: `Bearer ${token}` }, body: { diagnosisSessionId: sessionId } }, res);
      return res;
    },
    async reportLink(token, sessionId) {
      const res = makeRes();
      const orig = console.error; console.error = () => {};
      try { await MyReportLink.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl })({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { diagnosis_session_id: sessionId } }, res); }
      finally { console.error = orig; }
      return res;
    },
    async reportData(url) {
      const token = decodeURIComponent(url.split('token=')[1]);
      const res = makeRes();
      const orig = console.error; console.error = () => {};
      try { await ReportData.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl })({ method: 'GET', headers: {}, query: { token } }, res); }
      finally { console.error = orig; }
      return res;
    },
    csIdOf(url) { return url.split('/').pop(); },
    async rows(t) { return db.rows(t); },
  };
  return ctx;
}

// 本人・記録
async function person(ctx, { email = 'buyer@example.test', code = CODE_A, goal = 'GOAL_PACE_01', completedAt } = {}) {
  const token = `tok-${crypto.randomBytes(6).toString('hex')}`;
  const userId = await ctx.db.user({ email, token });
  const sessionId = await ctx.db.record({ userId, code, goal, completedAt });
  return { token, userId, sessionId };
}

// ログイン中の Checkout を開いて Stripe 側で支払い、Webhook で確定する
async function payLoggedIn(ctx, p, body, { email } = {}) {
  const r = await ctx.checkout(p.token, body);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  const paid = ctx.stripe.pay(cs, email ? { customer_details: { email } } : {});
  const w = await ctx.webhook({ type: 'checkout.session.completed', objectId: cs });
  assert.equal(w.code, 200, JSON.stringify(w.body));
  return { r, cs, ...paid };
}

const rightsOf = async (ctx, sid) => (await ctx.rows('record_entitlements')).filter((e) => e.diagnosis_session_id === sid)
  .map((e) => `${e.right_type}:${e.status}`).sort();

// ================= G1：新しい Checkout の ¥1,000 から ¥2,000（C1）
test('ログイン状態の ¥1,000：Checkout ¥1,000 → 支払い確定で解析権。マイページは ¥2,000 の案内・解析レポートを読める', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { r } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.deepEqual([r.body.offer, r.body.amount], ['analysis', 1000]);
  assert.deepEqual(ctx.stripe.st.lastCreate.params.line_items, [{ price: 'price_test_analysis1000', quantity: 1 }]);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active']);
  const e = (await ctx.entitlements(p.token)).body;
  const rec = e.records[p.sessionId];
  assert.equal(rec.analysisSource, 'record_entitlement');
  assert.equal(rec.repurchaseBlocked, false, '解析レポートだけの購入は完全解析の再購入禁止に数えない');
  assert.equal(rec.completeOffer, 'analysis_upgrade');
  assert.equal(e.purchased_by_version[`ETI-2.0:${CODE_A}`], true);
  // 解析レポートの閲覧リンク（マイページ）
  const link = await ctx.reportLink(p.token, p.sessionId);
  assert.equal(link.code, 200);
  assert.equal((await ctx.reportData(link.body.url)).body.code, CODE_A);
  // ¥1,000 の再購入はできない
  const again = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.deepEqual([again.code, again.body.error], [409, 'analysis_already_purchased']);
  await ctx.db.close();
});

test('新しい ¥1,000 の購入者：目標を選び直せる → ¥2,000（Stripe の前後で金額を確認）→ 完全解析権だけ追加・解析権は重複しない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const g = await ctx.mentor(p.token, p.sessionId, 'GOAL_VISIBLE_01');
  assert.equal(g.code, 200, JSON.stringify(g.body));
  const { r } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([r.body.offer, r.body.amount], ['analysis_upgrade', 2000]);
  assert.deepEqual(ctx.stripe.st.lastCreate.params.line_items, [{ price: 'price_test_upgrade2000', quantity: 1 }]);
  const orders = (await ctx.rows('complete_orders')).filter((o) => o.diagnosis_session_id === p.sessionId);
  assert.deepEqual(orders.map((o) => `${o.offer}:${o.amount}:${o.status}`).sort(), ['analysis:1000:paid', 'analysis_upgrade:2000:paid']);
  const up = orders.find((o) => o.offer === 'analysis_upgrade');
  assert.equal(up.analysis_basis, 'record_entitlement');
  assert.equal(up.mentor_goal_id, 'GOAL_VISIBLE_01');
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active', 'complete:active'], 'アップグレード後の権利は2つだけ');
  assert.equal((await ctx.rows('complete_reports')).length, 1);
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.completeEntitlement, rec.repurchaseBlocked, rec.completeOffer], ['active', true, null]);
  // 完全解析は再購入できない・¥3,000 も作らない
  const again = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([again.code, again.body.error], [409, 'repurchase_not_allowed']);
  await ctx.db.close();
});

test('¥2,000：Stripe の決済画面の金額が ¥2,000 でなければ画面を閉じ、注文を failed にして請求しない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const create = ctx.stripe.client.checkout.sessions.create;
  ctx.stripe.client.checkout.sessions.create = async (...a) => {
    const s = await create(...a);
    ctx.stripe.st.sessions[s.id].amount_total = 3000;
    return Object.assign(s, { amount_total: 3000 });
  };
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([r.code, r.body.error], [503, 'service_unavailable']);
  assert.equal(r.body.checkoutUrl, undefined);
  const up = (await ctx.rows('complete_orders')).find((o) => o.offer === 'analysis_upgrade');
  assert.deepEqual([up.status, up.failure_code], ['failed', 'amount_mismatch']);
  assert.ok(Object.values(ctx.stripe.st.sessions).some((s) => s.amount_total === 3000 && s.status === 'expired'));
  await ctx.db.close();
});

test('ゲスト ¥1,000 を同じメールのアカウントへ引き継いだ記録から、マイページで ¥2,000（C1）', { skip }, async () => {
  const ctx = await setup();
  const r = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  ctx.stripe.pay(ctx.csIdOf(r.body.checkoutUrl), { customer_details: { email: 'owner@example.test' } });
  const st = await ctx.op('guest-status', {});
  const ref = st.body.purchases[0].ref;
  const token = 'tok-claim-owner';
  const userId = await ctx.db.user({ email: 'owner@example.test', token });
  const c = await ctx.op('guest-claim', { ref }, { token });
  assert.deepEqual([c.code, c.body], [200, { result: 'claimed' }]);
  const sid = (await ctx.rows('diagnosis_sessions')).find((s) => s.user_id === userId).id;
  assert.equal((await ctx.mentor(token, sid, 'GOAL_EXPLORE_01')).code, 200);
  const rec = (await ctx.entitlements(token)).body.records[sid];
  assert.equal(rec.completeOffer, 'analysis_upgrade');
  const { r: up } = await payLoggedIn(ctx, { token, sessionId: sid }, { diagnosisSessionId: sid });
  assert.deepEqual([up.body.offer, up.body.amount], ['analysis_upgrade', 2000]);
  assert.deepEqual(await rightsOf(ctx, sid), ['analysis:active', 'complete:active']);
  await ctx.db.close();
});

test('解析権が一時停止中（dispute 中）は ¥3,000・¥2,000 を作らない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { chargeId } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const du = ctx.stripe.dispute(chargeId);
  assert.equal((await ctx.webhook({ type: 'charge.dispute.created', objectId: du })).code, 200);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:suspended']);
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.completeOffer, rec.completeBlocked], [null, 'rights_suspended']);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([r.code, r.body.error], [409, 'rights_suspended']);
  // DB も直接の ¥3,000 を拒否する（最終の防御）
  const rows = await ctx.db.fetchImpl(`${ENV.SUPABASE_URL}/rest/v1/rpc/complete_create_order`, { method: 'POST', body: JSON.stringify({
    p_user_id: p.userId, p_diagnosis_session_id: p.sessionId, p_offer: 'direct_complete', p_idempotency_key: 'co_direct_while_suspended_1' }) });
  assert.match((await rows.json()).message, /complete_rights_suspended|complete_repurchase_not_allowed/);
  await ctx.db.close();
});

// ================= G1：同じ本人・同じ診断結果の記録（D1）
test('同じ本人・同じ診断結果の2つの記録：保存した記録が表示の正本。購入は権利の所在へ回り、二重に請求しない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx, { completedAt: '2026-10-01T00:00:00Z' });
  const second = await ctx.db.record({ userId: p.userId, code: CODE_A, goal: 'GOAL_PACE_01', completedAt: '2026-10-05T00:00:00Z' });
  // 2つ目の記録から ¥1,000：権利は正本（最初の保存）に付く
  await payLoggedIn(ctx, p, { diagnosisSessionId: second, product: 'analysis' });
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active']);
  assert.deepEqual(await rightsOf(ctx, second), []);
  const e = (await ctx.entitlements(p.token)).body.records;
  assert.equal(e[p.sessionId].duplicateOf, null);
  assert.equal(e[second].duplicateOf, p.sessionId);
  assert.equal(e[second].completeOffer, 'analysis_upgrade');
  // どちらの記録からも ¥1,000 は再購入できない
  for (const sid of [p.sessionId, second]) {
    const r = await ctx.checkout(p.token, { diagnosisSessionId: sid, product: 'analysis' });
    assert.deepEqual([r.code, r.body.error], [409, 'analysis_already_purchased'], sid);
  }
  // DB の最終防御：同じ結果グループの別の記録に直接 ¥1,000・¥3,000 を作れない
  for (const offer of ['analysis', 'direct_complete']) {
    const res = await ctx.db.fetchImpl(`${ENV.SUPABASE_URL}/rest/v1/rpc/complete_create_order`, { method: 'POST', body: JSON.stringify({
      p_user_id: p.userId, p_diagnosis_session_id: second, p_offer: offer, p_idempotency_key: `co_dup_${offer}_00000000` }) });
    assert.equal(res.ok, false, offer);
    assert.match((await res.json()).message, /complete_repurchase_not_allowed|complete_direct_not_allowed_after_analysis/, offer);
  }
  // 2つ目の記録から ¥2,000：正本の記録に注文・権利が付く。目標の選択も正本へ回る
  assert.equal((await ctx.mentor(p.token, second, 'GOAL_RELATION_01')).code, 200);
  const { r } = await payLoggedIn(ctx, p, { diagnosisSessionId: second });
  assert.deepEqual([r.body.offer, r.body.amount], ['analysis_upgrade', 2000]);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active', 'complete:active']);
  assert.deepEqual(await rightsOf(ctx, second), []);
  // 状態確認・解析レポートも、2つ目の記録から正本の権利で読める
  const s = await ctx.status(p.token, second);
  assert.deepEqual([s.code, s.body.entitlements], [200, { analysis: 'active', complete: 'active' }]);
  assert.equal((await ctx.reportLink(p.token, second)).code, 200);
  const paid = (await ctx.rows('complete_orders')).filter((o) => o.status === 'paid');
  assert.deepEqual(paid.map((o) => `${o.offer}:${o.diagnosis_session_id === p.sessionId}`).sort(), ['analysis:true', 'analysis_upgrade:true']);
  await ctx.db.close();
});

test('同じ診断コードでも別の本人には権利を共有しない（¥1,000 を別に買える・解析レポートは読めない）', { skip }, async () => {
  const ctx = await setup();
  const a = await person(ctx, { email: 'a@example.test' });
  const b = await person(ctx, { email: 'b@example.test' });
  await payLoggedIn(ctx, a, { diagnosisSessionId: a.sessionId, product: 'analysis' });
  const eb = (await ctx.entitlements(b.token)).body.records[b.sessionId];
  assert.deepEqual([eb.analysisSource, eb.duplicateOf, eb.completeOffer], [null, null, 'direct_complete']);
  assert.equal((await ctx.reportLink(b.token, b.sessionId)).code, 403);
  const r = await ctx.checkout(b.token, { diagnosisSessionId: b.sessionId, product: 'analysis' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  await ctx.db.close();
});
