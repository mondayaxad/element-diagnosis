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
    async op(op, body, { token, cookie, ip } = {}) {
      const res = makeRes();
      const headers = { host: 'evil.example', 'x-real-ip': ip || '198.51.100.7' };
      const jar = cookie !== undefined ? cookie : ctx.cookie;
      if (jar) headers.cookie = jar;
      if (token) headers.authorization = `Bearer ${token}`;
      await checkoutH({ method: 'POST', headers, query: { op }, body }, res);
      const set = res.headers['set-cookie'];
      if (set && cookie === undefined) ctx.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return res;
    },
    // 診断完了の固有リンク（秘密値はブラウザが作る）
    async link(code, { ip } = {}) {
      const t = crypto.randomBytes(32).toString('base64url');
      const r = await ctx.op('result-link', { code, token: t }, { cookie: '', ip });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      return t;
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

// ================= G2：ゲスト注文・引き継ぎ・キャンセル（C2・C3・C5・D2・D3）
async function guestBuy(ctx, body, email = 'owner@example.test') {
  const r = await ctx.op('guest-checkout', body);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  ctx.stripe.pay(cs, { customer_details: { email } });
  await ctx.op('guest-status', {});
  return cs;
}

test('C2：¥1,000 の後に追加 ¥2,000 を始めて中止・放置しても、支払済みの注文で引き継げる（同じ秘密値の再実行は冪等）', { skip }, async () => {
  const ctx = await setup();
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  // ¥2,000 を始めて中止（Stripe の画面で戻る）→ もう一度始めて放置（開いたまま。同じ記録）
  const up1 = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.deepEqual([up1.code, up1.body.amount], [200, 2000]);
  assert.deepEqual((await ctx.op('guest-cancel', {})).body, { closed: 1, paid: 0 });
  const up2 = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal(up2.code, 200);
  assert.equal(new Set((await ctx.rows('complete_orders')).map((o) => o.diagnosis_session_id)).size, 1, '記録を増やさない');
  const paidOrder = (await ctx.rows('complete_orders')).find((o) => o.status === 'paid');
  const st = (await ctx.op('guest-status', {})).body.purchases.find((x) => x.canClaim);
  assert.ok(st, '支払済みの記録は引き継げる');
  const token = 'tok-owner-c2';
  const userId = await ctx.db.user({ email: 'owner@example.test', token });
  const c = await ctx.op('guest-claim', { ref: st.ref }, { token });
  assert.deepEqual([c.code, c.body], [200, { result: 'claimed' }]);
  const sid = paidOrder.diagnosis_session_id;
  assert.equal((await ctx.rows('diagnosis_sessions')).find((x) => x.id === sid).user_id, userId);
  assert.deepEqual(await rightsOf(ctx, sid), ['analysis:active']);
  // マイページで ¥2,000 へ進める（放置した ¥2,000 の画面は、申込の時にサーバーが閉じてから作り直す）
  const rec = (await ctx.entitlements(token)).body.records[sid];
  assert.ok(rec.completeOffer === 'analysis_upgrade' || rec.completeBlocked === 'checkout_in_progress', JSON.stringify(rec));
  assert.equal(rec.analysisPurchased, true);
  await ctx.db.close();
});

test('C3（ゲスト）：Stripe で戻った・閉じた決済はすぐ買い直せる。支払いと重なった時は二重に請求しない', { skip }, async () => {
  const ctx = await setup();
  const r1 = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  const cs1 = ctx.csIdOf(r1.body.checkoutUrl);
  // 戻り先（?status=canceled）での片付け：未払いの画面を閉じ、注文は expired
  assert.deepEqual((await ctx.op('guest-cancel', {})).body, { closed: 1, paid: 0 });
  assert.equal(ctx.stripe.st.sessions[cs1].status, 'expired');
  assert.equal((await ctx.rows('complete_orders'))[0].status, 'expired');
  const s = (await ctx.op('guest-status', { code: CODE_A })).body.purchases[0];
  assert.equal(s.pending, false);
  // すぐ買い直せる（新しい画面）
  const r2 = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.equal(r2.code, 200);
  assert.notEqual(r2.body.checkoutUrl, r1.body.checkoutUrl);
  // 「決済をやり直す」と支払いが重なった（Stripe 側では支払い済み）：閉じずに適用し、新しい注文は作らない
  ctx.stripe.pay(ctx.csIdOf(r2.body.checkoutUrl), { customer_details: { email: 'x@example.test' } });
  assert.deepEqual((await ctx.op('guest-cancel', {})).body, { closed: 0, paid: 1 });
  assert.equal((await ctx.rows('complete_orders')).filter((o) => o.status === 'paid').length, 1);
  // この端末で購入済みの記録の ¥1,000 は断る（結果ページは「解析レポートを読む」と追加 ¥2,000 を出す。二重に請求しない）
  const again = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.deepEqual([again.code, again.body.error], [409, 'analysis_already_purchased']);
  assert.equal(new Set((await ctx.rows('complete_orders')).map((o) => o.diagnosis_session_id)).size, 1);
  // Cookie の無い別のブラウザ（同じ回答の別の人かもしれない）は新しい記録で買える
  const other = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A }, { cookie: '' });
  assert.equal(other.code, 200, JSON.stringify(other.body));
  assert.equal(new Set((await ctx.rows('complete_orders')).map((o) => o.diagnosis_session_id)).size, 2);
  await ctx.db.close();
});

test('C3（ログイン）：マイページへ戻った（中止）・「決済をやり直す」で決済待ちを片付け、すぐ買い直せる', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r1 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal((await ctx.entitlements(p.token)).body.records[p.sessionId].checkoutInProgress, true);
  // ?complete=canceled から：user-reconcile { cancel: true }
  const back = await ctx.op('user-reconcile', { cancel: true }, { token: p.token });
  assert.deepEqual([back.code, back.body], [200, { applied: 0, closed: 1 }]);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(r1.body.checkoutUrl)].status, 'expired');
  assert.equal((await ctx.entitlements(p.token)).body.records[p.sessionId].checkoutInProgress, false);
  // もう一度始めて放置 → 「決済をやり直す」
  const r2 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal(r2.code, 200);
  const reset = await ctx.op('user-checkout-reset', { diagnosisSessionId: p.sessionId }, { token: p.token });
  assert.deepEqual([reset.code, reset.body], [200, { result: 'reset' }]);
  const r3 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal(r3.code, 200);
  // 支払い済みの決済を「やり直す」：適用して終わる（新しい請求なし）
  ctx.stripe.pay(ctx.csIdOf(r3.body.checkoutUrl));
  const done = await ctx.op('user-checkout-reset', { diagnosisSessionId: p.sessionId }, { token: p.token });
  assert.deepEqual(done.body, { result: 'paid' });
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active']);
  // 他人の記録・入力不正
  const q = await person(ctx, { email: 'q@example.test', code: CODE_B });
  assert.equal((await ctx.op('user-checkout-reset', { diagnosisSessionId: p.sessionId }, { token: q.token })).code, 404);
  assert.equal((await ctx.op('user-checkout-reset', { diagnosisSessionId: 'x' }, { token: p.token })).code, 400);
  assert.equal((await ctx.op('user-reconcile', { cancel: 'yes' }, { token: p.token })).code, 400);
  await ctx.db.close();
});

test('C5：戻って MENTOR 目標を変えたら古い画面を使わず、新しい目標で決済。支払い後に固定される目標は支払った注文の目標', { skip }, async () => {
  const ctx = await setup();
  const a = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal(a.code, 200);
  const same = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal(same.body.checkoutUrl, a.body.checkoutUrl, '同じ目標なら同じ画面');
  const b = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_VISIBLE_01' });
  assert.equal(b.code, 200);
  assert.notEqual(b.body.checkoutUrl, a.body.checkoutUrl);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(a.body.checkoutUrl)].status, 'expired');
  // 古い画面は支払えない（Stripe で閉じた）。新しい画面で支払う
  ctx.stripe.pay(ctx.csIdOf(b.body.checkoutUrl), { customer_details: { email: 'x@example.test' } });
  await ctx.op('guest-status', {});
  const orders = await ctx.rows('complete_orders');
  assert.deepEqual(orders.map((o) => `${o.mentor_goal_id}:${o.status}`).sort(), ['GOAL_PACE_01:canceled', 'GOAL_VISIBLE_01:paid']);
  const [goal] = await ctx.rows('record_mentor_goals');
  assert.equal(goal.goal_id, 'GOAL_VISIBLE_01');
  assert.ok(goal.locked_at);
  const [report] = await ctx.rows('complete_reports');
  assert.equal(report.mentor_goal_id, 'GOAL_VISIBLE_01');
  await ctx.db.close();
});

test('D2・D3：Google 等でも同じ確認済みメールなら引き継げる。共有端末で別のメールの人へは移らない。Cookie 消失は OTP で復旧（決済待ちがあっても）', { skip }, async () => {
  const ctx = await setup();
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A }, 'Owner@Example.test');
  const st = (await ctx.op('guest-status', {})).body.purchases[0];
  // 共有端末：同じブラウザで別の人（別のメール）がログインしても移らない
  const other = 'tok-shared-other';
  await ctx.db.user({ email: 'family@example.test', token: other });
  assert.deepEqual((await ctx.op('guest-claim', { ref: st.ref }, { token: other })).body, { error: 'claim_email_mismatch' });
  // メール未確認のアカウント
  const unconfirmed = 'tok-unconfirmed';
  await ctx.db.user({ email: 'owner@example.test', confirmed: false, token: unconfirmed });
  assert.deepEqual((await ctx.op('guest-claim', { ref: st.ref }, { token: unconfirmed })).body, { error: 'claim_email_unconfirmed' });
  // Cookie を失い、別端末で ¥2,000 を始めたわけではないが決済待ちを作ってから、メール OTP で復旧する
  const cookie = ctx.cookie;
  await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' });
  ctx.cookie = '';
  const nowSec = Math.floor(Date.now() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const otp = `${b({ alg: 'HS256' })}.${b({ sub: 'x', amr: [{ method: 'otp', timestamp: nowSec - 20 }] })}.sig`;
  const owner = await ctx.db.user({ email: 'owner@example.test', token: otp });
  const r = await ctx.op('guest-recover', {}, { token: otp });
  assert.deepEqual([r.code, r.body], [200, { claimed: 1, skipped: 0 }]);
  // 支払済みの記録は本人へ（決済待ちの ¥3,000 は新しい記録で、まだ支払っていないため引き継がない）
  const paidSids = new Set((await ctx.rows('complete_orders')).filter((o) => o.status === 'paid').map((o) => o.diagnosis_session_id));
  assert.ok((await ctx.rows('diagnosis_sessions')).filter((x) => paidSids.has(x.id)).every((x) => x.user_id === owner));
  assert.equal((await ctx.op('guest-report', { ref: st.ref }, { cookie })).code, 409, '引き継ぎ後は Cookie では読めない');
  await ctx.db.close();
});

// ================= G3：閲覧のたびに権利を確かめる・返金・停止（C4・C9・D5・D6）
const signReport = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', ENV.REPORT_TOKEN_SECRET).update(body).digest('base64url')}`;
};
const encRef = (ref) => {
  const key = Buffer.from(crypto.hkdfSync('sha256', ENV.REPORT_TOKEN_SECRET, Buffer.alloc(0), 'report-token-code-encryption-v1', 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(ref, 'utf8'), c.final()]);
  return { iv: iv.toString('base64url'), tag: c.getAuthTag().toString('base64url'), data: data.toString('base64url') };
};
const urlOf = (payload) => `/report.html?token=${encodeURIComponent(signReport(payload))}`;
// 完全解析の生成物を ready にする（生成の処理は別の試験）
async function markReady(ctx, sid) {
  const rep = (await ctx.rows('complete_reports')).find((r) => r.diagnosis_session_id === sid && r.status !== 'revoked');
  await ctx.db.patch('complete_reports', rep.id, { status: 'ready', storage_path: `reports/${rep.id}/1-${'a'.repeat(32)}.html`, output_sha256: 'b'.repeat(64), ready_at: new Date().toISOString() });
  return rep.id;
}
async function viewGet(ctx, viewUrl) {
  const res = makeRes();
  const h = Status.createHandler({ env: ctx.env, fetchImpl: ctx.db.fetchImpl, logger: ctx.logger, waitUntil: null,
    storage: { download: async () => { throw Object.assign(new Error('x'), { code: 'not_in_test' }); } } });
  await h({ method: 'GET', headers: {}, query: { view: viewUrl.split('view=')[1] } }, res);
  return res;
}
async function chargeOf(ctx, cs) { return ctx.stripe.st.sessions[cs].payment_intent && Object.values(ctx.stripe.st.charges).find((c) => c.payment_intent === ctx.stripe.st.sessions[cs].payment_intent).id; }
async function refund(ctx, cs, amount) {
  const ch = await chargeOf(ctx, cs);
  ctx.stripe.refund(ch, amount);
  const w = await ctx.webhook({ type: 'charge.refunded', objectId: ch });
  assert.equal(w.code, 200, JSON.stringify(w.body));
}

test('¥1,000 の返金：解析権は revoked。発行済みの閲覧リンク（期限内）も、新しいリンクも開けない。応答は private, no-store', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { cs } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const link = await ctx.reportLink(p.token, p.sessionId);
  assert.equal(link.code, 200);
  assert.equal(link.headers['cache-control'], 'private, no-store');
  const before = await ctx.reportData(link.body.url);
  assert.deepEqual([before.code, before.body.code, before.headers['cache-control']], [200, CODE_A, 'private, no-store']);
  await refund(ctx, cs, 1000);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:revoked']);
  const after = await ctx.reportData(link.body.url);
  assert.deepEqual([after.code, after.body.error, after.body.code], [403, 'not_entitled', undefined]);
  assert.equal(after.headers['cache-control'], 'private, no-store');
  assert.deepEqual([(await ctx.reportLink(p.token, p.sessionId)).code], [403]);
  // 返金後は ¥1,000 の再購入を出さない（返金済みの購入は「購入済み」のまま。運営者の判断で扱う）
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.equal(rec.analysisSource, null);
  await ctx.db.close();
});

test('¥2,000 の返金：完全解析だけ revoked。解析レポートは読める・完全解析の閲覧は発行済みの URL も含め不可', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const { cs } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  await markReady(ctx, p.sessionId);
  const v = await ctx.status(p.token, p.sessionId, 'POST');
  assert.equal(v.code, 200, JSON.stringify(v.body));
  const link = await ctx.reportLink(p.token, p.sessionId);
  await refund(ctx, cs, 2000);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active', 'complete:revoked']);
  assert.equal((await ctx.reportData(link.body.url)).code, 200, '解析レポートは読める');
  assert.deepEqual([(await ctx.status(p.token, p.sessionId, 'POST')).code], [403]);
  const old = await viewGet(ctx, v.body.viewUrl);
  assert.deepEqual([old.code, old.body.error], [403, 'not_entitled']);
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  // 返金した完全解析は購入済みに数えない：解析レポートを持っているため、もう一度 追加 ¥2,000 を申し込める（complete_11）
  assert.deepEqual([rec.completeEntitlement, rec.repurchaseBlocked, rec.completeOffer], ['revoked', false, 'analysis_upgrade']);
  await ctx.db.close();
});

test('¥3,000 の返金：解析・完全解析とも revoked。両方の閲覧が、発行済みのリンクでも不可', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { cs } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  await markReady(ctx, p.sessionId);
  const v = await ctx.status(p.token, p.sessionId, 'POST');
  const link = await ctx.reportLink(p.token, p.sessionId);
  assert.deepEqual([v.code, link.code, (await ctx.reportData(link.body.url)).code], [200, 200, 200]);
  await refund(ctx, cs, 3000);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:revoked', 'complete:revoked']);
  assert.equal((await ctx.reportData(link.body.url)).code, 403);
  assert.equal((await viewGet(ctx, v.body.viewUrl)).code, 403);
  assert.equal((await ctx.status(p.token, p.sessionId, 'POST')).code, 403);
  await ctx.db.close();
});

test('¥2,000 の後に ¥1,000 だけ返金：完全解析の権利は残すが閲覧は止める（basis_inactive）。解析レポートは読めない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { cs: cs1 } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  await markReady(ctx, p.sessionId);
  const v = await ctx.status(p.token, p.sessionId, 'POST');
  assert.equal(v.code, 200);
  await refund(ctx, cs1, 1000);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:revoked', 'complete:active']);
  const post = await ctx.status(p.token, p.sessionId, 'POST');
  assert.deepEqual([post.code, post.body.error], [403, 'basis_inactive']);
  const old = await viewGet(ctx, v.body.viewUrl);
  assert.deepEqual([old.code, old.body.error], [403, 'basis_inactive']);
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.completeEntitlement, rec.completeViewBlocked, rec.completeOffer], ['active', 'basis_inactive', null]);
  assert.equal((await ctx.reportLink(p.token, p.sessionId)).code, 403);
  await ctx.db.close();
});

test('ゲストの返金：Cookie の端末の閲覧リンク（発行済み）も開けない。引き継ぎ後はゲストのリンクを使えない', { skip }, async () => {
  const ctx = await setup();
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  const st = (await ctx.op('guest-status', {})).body.purchases[0];
  const g = await ctx.op('guest-report', { ref: st.ref });
  assert.equal(g.code, 200);
  assert.equal(g.headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal((await ctx.reportData(g.body.url)).code, 200);
  // 引き継いだら、Cookie の端末で発行済みのリンクは使えない（権利はアカウントへ移った）
  const token = 'tok-guest-refund';
  await ctx.db.user({ email: 'owner@example.test', token });
  assert.equal((await ctx.op('guest-claim', { ref: st.ref }, { token })).code, 200);
  assert.equal((await ctx.reportData(g.body.url)).code, 403);
  // 別のゲスト購入：返金で閲覧不可
  const ctx2cs = await guestBuy(ctx, { offer: 'analysis', code: CODE_B }, 'b@example.test');
  const st2 = (await ctx.op('guest-status', {})).body.purchases.find((x) => !x.claimed);
  const g2 = await ctx.op('guest-report', { ref: st2.ref });
  assert.equal((await ctx.reportData(g2.body.url)).code, 200);
  await refund(ctx, ctx2cs, 1000);
  assert.equal((await ctx.reportData(g2.body.url)).code, 403);
  assert.equal((await ctx.op('guest-report', { ref: st2.ref })).code, 403);
  await ctx.db.close();
});

test('未払いの Webhook（checkout.session.completed・payment_status=unpaid）：権利・生成物を作らない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  Object.assign(ctx.stripe.st.sessions[cs], { status: 'complete', payment_status: 'unpaid' });
  const w = await ctx.webhook({ type: 'checkout.session.completed', objectId: cs });
  assert.ok([200, 202].includes(w.code), JSON.stringify(w.body));
  assert.deepEqual(await rightsOf(ctx, p.sessionId), []);
  assert.equal((await ctx.rows('complete_reports')).length, 0);
  assert.ok((await ctx.rows('complete_orders')).every((o) => o.status !== 'paid'));
  assert.equal((await ctx.reportLink(p.token, p.sessionId)).code, 403);
  await ctx.db.close();
});

test('閲覧リンクの流用：別の本人・別の記録・別の診断結果・不明な種類・sid の無い再発行トークンは開けない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const q = await person(ctx, { email: 'q@example.test', code: CODE_A }); // 同じ診断コード・未購入
  const qb = await ctx.db.record({ userId: p.userId, code: CODE_B }); // 本人の別の結果（未購入）
  const base = { exp: Date.now() + 60000, env: 'preview', diagnosis_version: 'ETI-2.0', access_mode: 'mypage_entitlement_reissue' };
  const ok = await ctx.reportData(urlOf({ ...base, sid: p.sessionId, uid: p.userId, enc: encRef(`v2_${CODE_A}`) }));
  assert.equal(ok.code, 200);
  // 同じ診断コードの別の本人：権利を共有しない
  assert.equal((await ctx.reportLink(q.token, q.sessionId)).code, 403);
  assert.equal((await ctx.reportData(urlOf({ ...base, sid: q.sessionId, uid: q.userId, enc: encRef(`v2_${CODE_A}`) }))).code, 403);
  // 他人の記録を自分の uid で
  assert.equal((await ctx.reportData(urlOf({ ...base, sid: p.sessionId, uid: q.userId, enc: encRef(`v2_${CODE_A}`) }))).code, 403);
  // 本人の別の結果（未購入）の診断コード
  assert.equal((await ctx.reportData(urlOf({ ...base, sid: p.sessionId, uid: p.userId, enc: encRef(`v2_${CODE_B}`) }))).code, 403);
  assert.equal((await ctx.reportData(urlOf({ ...base, sid: qb, uid: p.userId, enc: encRef(`v2_${CODE_B}`) }))).code, 403);
  // sid の無い再発行トークン・不明な access_mode・ゲスト記録でない sid
  assert.equal((await ctx.reportData(urlOf({ ...base, enc: encRef(`v2_${CODE_A}`) }))).code, 403);
  assert.equal((await ctx.reportData(urlOf({ ...base, access_mode: 'admin', sid: p.sessionId, uid: p.userId, enc: encRef(`v2_${CODE_A}`) }))).code, 403);
  assert.equal((await ctx.reportData(urlOf({ ...base, access_mode: 'guest_entitlement_reissue', sid: p.sessionId, enc: encRef(`v2_${CODE_A}`) }))).code, 403);
  // 期限切れ
  assert.equal((await ctx.reportData(urlOf({ ...base, exp: Date.now() - 1, sid: p.sessionId, uid: p.userId, enc: encRef(`v2_${CODE_A}`) }))).code, 403);
  await ctx.db.close();
});

test('旧 ¥1,000：運営者が停止すると旧形式リンク・マイページ（本人に結び付け済み）とも閲覧不可、復帰で戻る。取消は最終。API のロールは操作できない', { skip }, async () => {
  const ctx = await setup();
  const code = 'CODE_LEGACY_BLOCK';
  const p = await person(ctx, { email: 'buyer@example.test', code });
  const legacyCs = ctx.stripe.legacySession({ email: 'buyer@example.test' });
  await ctx.db.legacy({ code, stripeSessionId: legacyCs });
  // 結び付けの前：マイページは診断コードのハッシュだけでは旧購入を本人の購入にしない（complete_10）
  assert.equal((await ctx.reportLink(p.token, p.sessionId)).code, 403);
  // 所有の根拠のある結び付け（運営者が確認した既存の結び付け）
  await ctx.db.sql(`insert into public.complete_legacy_bindings (legacy_entitlement_id, user_id, diagnosis_session_id, match_method)
    select id, $1, $2, 'operator_verified' from public.purchase_entitlements where stripe_checkout_session_id = $3`, [p.userId, p.sessionId, legacyCs]);
  const floor = urlOf({ exp: Date.now() + 60000, code: `v2_${code}` });
  const verifyTok = urlOf({ exp: Date.now() + 60000, env: 'preview', diagnosis_version: 'ETI-2.0', purchase: { transaction_id: 'x' }, enc: encRef(`v2_${code}`) });
  assert.deepEqual([(await ctx.reportData(floor)).code, (await ctx.reportData(verifyTok)).code], [200, 200]);
  assert.equal((await ctx.reportLink(p.token, p.sessionId)).code, 200);
  const admin = (action, incident, reason = 'refund') => ctx.db.sql(
    'select public.complete_admin_legacy_access(null, $1, $2, $3, $4) as r', [legacyCs, action, reason, incident]).then((r) => r[0].r);
  assert.equal(await admin('suspend', 'aaaaaaaaaaa1'), 'suspended');
  assert.equal(await admin('suspend', 'aaaaaaaaaaa1'), 'suspended', '同じ照合 ID の再実行は同じ結果');
  assert.deepEqual([(await ctx.reportData(floor)).code, (await ctx.reportData(verifyTok)).code], [403, 403]);
  assert.equal((await ctx.reportLink(p.token, p.sessionId)).code, 403);
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.legacyPurchasePending, rec.analysisAccess, rec.completeOffer], [false, false, 'direct_complete']);
  // DB は旧購入を ¥2,000 の根拠に数えない（停止中に限らない）
  const up = await ctx.db.fetchImpl(`${ENV.SUPABASE_URL}/rest/v1/rpc/complete_create_order`, { method: 'POST', body: JSON.stringify({
    p_user_id: p.userId, p_diagnosis_session_id: p.sessionId, p_offer: 'analysis_upgrade', p_idempotency_key: 'co_upgrade_while_blocked_1' }) });
  assert.match((await up.json()).message, /complete_upgrade_requires_analysis/);
  assert.equal(await admin('restore', 'aaaaaaaaaaa2', 'operator_error'), 'lifted');
  assert.deepEqual([(await ctx.reportData(floor)).code, (await ctx.reportData(verifyTok)).code], [200, 200]);
  assert.equal(await admin('revoke', 'aaaaaaaaaaa3'), 'revoked');
  await assert.rejects(admin('restore', 'aaaaaaaaaaa4'), /legacy_access_revoked_is_final/);
  assert.equal((await ctx.reportData(floor)).code, 403);
  await assert.rejects(admin('suspend', 'aaaaaaaaaaa1'.replace('1', '9'), 'bogus'), /complete_admin_invalid_request/);
  // API のロール（service_role）からは実行できない・記録の表は書けない
  const r = await ctx.db.fetchImpl(`${ENV.SUPABASE_URL}/rest/v1/rpc/complete_admin_legacy_access`, { method: 'POST', body: JSON.stringify({
    p_diagnosis_code_hash: null, p_stripe_checkout_session_id: legacyCs, p_action: 'restore', p_reason_code: 'refund', p_incident_id: 'bbbbbbbbbbb1' }) });
  assert.equal(r.ok, false);
  const ev = await ctx.db.sql('select action, result_status from public.legacy_access_events order by created_at');
  assert.deepEqual(ev.map((e) => `${e.action}:${e.result_status}`), ['suspend:suspended', 'restore:lifted', 'revoke:revoked']);
  await assert.rejects(ctx.db.sql('delete from public.legacy_access_events'), /legacy_access_events_immutable/);
  await ctx.db.close();
});

// ================= G4：ゲストの生成の最終の失敗（C6）
test('C6（ゲスト）：最終の失敗は「作成できませんでした」。この端末（Cookie）からだけ同じ注文で作り直せる。引き継ぎ後はマイページで', { skip }, async () => {
  const ctx = await setup();
  await guestBuy(ctx, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' });
  const [rep] = await ctx.rows('complete_reports');
  await ctx.db.patch('complete_reports', rep.id, { status: 'failed', attempts: rep.max_attempts, next_retry_at: null, last_error_code: 'storage_failed' });
  let st = (await ctx.op('guest-status', {})).body.purchases[0];
  assert.deepEqual([st.report, st.regenerate], ['failed', 'available']);
  // Cookie の無い端末・別の端末からは作れない
  assert.equal((await ctx.op('guest-regenerate', { ref: st.ref }, { cookie: '' })).code, 403);
  const r = await ctx.op('guest-regenerate', { ref: st.ref });
  assert.deepEqual([r.code, r.body], [202, { result: 'queued' }]);
  const [after] = await ctx.rows('complete_reports');
  assert.deepEqual([after.id, after.status, after.manual_retries, after.attempts], [rep.id, 'queued', 1, 0]);
  assert.equal((await ctx.rows('complete_orders')).length, 1);
  st = (await ctx.op('guest-status', {})).body.purchases[0];
  assert.equal(st.regenerate, null);
  // 引き継いだ後は、ゲストの操作では作れない
  const token = 'tok-guest-regen';
  await ctx.db.user({ email: 'owner@example.test', token });
  assert.equal((await ctx.op('guest-claim', { ref: st.ref }, { token })).code, 200);
  assert.deepEqual((await ctx.op('guest-regenerate', { ref: st.ref })).body, { error: 'claimed' });
  await ctx.db.close();
});

// ================= G7：ロックの順・並行実行（C9）
const GP = require('../lib/guest-purchase');
test('ロックの順：支払いの確定は 結果グループ → 記録 → 注文の行 の順に取る（注文の作成・引き継ぎと同じ順）', () => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'sql', '20261013120000_complete_08_purchase_integrity.sql'), 'utf8');
  const body = (name) => {
    const i = sql.lastIndexOf(`create or replace function public.${name}(`);
    return sql.slice(i, sql.indexOf('\n$$;', i));
  };
  for (const fn of ['complete_apply_payment', 'complete_create_order_internal', 'complete_transfer_guest_record']) {
    const b = body(fn);
    const group = b.indexOf('complete_lock_result_group(');
    const record = b.indexOf("'complete_order:'");
    // 行に触れる最初の操作（行のロック、または注文の追加）
    const firstRow = [b.search(/for update/), b.search(/insert into public\.complete_orders/)].filter((x) => x >= 0);
    const row = Math.min(...firstRow);
    assert.ok(group > 0 && record > group && row > record, `${fn}: group ${group} < record ${record} < row ${row}`);
  }
});

test('並行：引き継ぎと支払いの確定（Webhook の再送）が重なっても、デッドロックせず1つの状態に揃う', { skip }, async () => {
  const ctx = await setup();
  const token = 'tok-concurrent-owner';
  const owner = await ctx.db.user({ email: 'owner@example.test', token });
  for (let i = 0; i < 6; i++) {
    const code = savedRecord(variantAnswers(10 + i)).encoded_answers;
    ctx.cookie = '';
    const r = await ctx.op('guest-checkout', { offer: 'analysis', code });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const cs = ctx.csIdOf(r.body.checkoutUrl);
    ctx.stripe.pay(cs, { customer_details: { email: 'owner@example.test' } });
    const order = (await ctx.rows('complete_orders')).find((o) => o.stripe_checkout_session_id === cs);
    const ref = GP.refOf(ctx.env, order.id);
    // 引き継ぎ（Stripe へ問い合わせて適用 → 本人へ移す）と、同じ決済の Webhook を2回、同時に
    const [claim, w1, w2] = await Promise.all([
      ctx.op('guest-claim', { ref }, { token }),
      ctx.webhook({ type: 'checkout.session.completed', objectId: cs }),
      ctx.webhook({ type: 'checkout.session.completed', objectId: cs }),
    ]);
    // 一時的な失敗（取り直し）は Stripe の再送で反映される。デッドロック（db_error）は起きない
    for (const w of [w1, w2]) assert.ok([200, 500, 503].includes(w.code), JSON.stringify(w.body));
    if (claim.code !== 200) {
      assert.ok([409, 503].includes(claim.code), JSON.stringify(claim.body));
      assert.equal((await ctx.op('guest-claim', { ref }, { token })).code, 200);
    }
    assert.equal((await ctx.webhook({ type: 'checkout.session.completed', objectId: cs })).code, 200);
    const o = (await ctx.rows('complete_orders')).find((x) => x.id === order.id);
    assert.deepEqual([o.status, o.user_id], ['paid', owner], `回 ${i}`);
    const rights = (await ctx.rows('record_entitlements')).filter((e) => e.source_order_id === order.id);
    assert.deepEqual(rights.map((e) => `${e.right_type}:${e.status}:${e.user_id === owner}`), ['analysis:active:true'], `回 ${i}`);
  }
  assert.ok(!ctx.logger.lines.some((l) => /db_error|deadlock/.test(l)), ctx.logger.lines.filter((l) => /db_error|deadlock/.test(l)).join('\n'));
  await ctx.db.close();
});

test('並行：同じ診断結果の2つの記録で、支払いの確定と別の記録の注文の作成が重なっても、デッドロックせず二重に買えない', { skip }, async () => {
  const ctx = await setup();
  for (let i = 0; i < 6; i++) {
    const code = savedRecord(variantAnswers(30 + i)).encoded_answers;
    const p = await person(ctx, { email: `p${i}@example.test`, code });
    const second = await ctx.db.record({ userId: p.userId, code, completedAt: new Date(Date.now() + 60000).toISOString() });
    const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
    assert.equal(r.code, 200);
    const cs = ctx.csIdOf(r.body.checkoutUrl);
    ctx.stripe.pay(cs);
    const [w, other] = await Promise.all([
      ctx.webhook({ type: 'checkout.session.completed', objectId: cs }),
      ctx.checkout(p.token, { diagnosisSessionId: second, product: 'analysis' }),
    ]);
    assert.equal(w.code, 200, JSON.stringify(w.body));
    assert.ok([409].includes(other.code), `回 ${i}: ${other.code} ${JSON.stringify(other.body)}`);
    const paid = (await ctx.rows('complete_orders')).filter((o) => o.user_id === p.userId && o.status === 'paid');
    assert.equal(paid.length, 1, `回 ${i}`);
  }
  assert.ok(!ctx.logger.lines.some((l) => /db_error|deadlock/.test(l)));
  await ctx.db.close();
});

test('並行（決定的）：記録のロックを持つ処理（引き継ぎ・注文の作成）が注文の行を取る時、支払いの確定は記録のロックを先に待つ（デッドロックしない）', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  ctx.stripe.pay(cs);
  const order = (await ctx.rows('complete_orders'))[0];
  const s1 = await ctx.db.session();
  try {
    // 引き継ぎ・注文の作成と同じ順：記録のロック → 注文の行
    await s1.query('begin');
    await s1.query("set local lock_timeout = '5s'");
    await s1.query("select pg_advisory_xact_lock(hashtextextended('complete_order:' || $1::text, 0))", [p.sessionId]);
    const applying = ctx.webhook({ type: 'checkout.session.completed', objectId: cs });
    await new Promise((res) => setTimeout(res, 500)); // 支払いの確定がロックを待つところまで進める
    const t0 = Date.now();
    await s1.query('select id from public.complete_orders where id = $1 for update', [order.id]);
    assert.ok(Date.now() - t0 < 900, '注文の行はすぐ取れる（支払いの確定は記録のロックを待っていて、行を持っていない）');
    await s1.query('commit');
    const w = await applying;
    assert.equal(w.code, 200, JSON.stringify(w.body));
  } finally {
    await s1.end().catch(() => {});
  }
  assert.equal((await ctx.rows('complete_orders'))[0].status, 'paid');
  await ctx.db.close();
});

// ================= B：診断結果の固有リンク（/result#r=<秘密値>。complete_09）
const sha256hex = (t) => crypto.createHash('sha256').update(t).digest('hex');
test('固有リンク：診断完了で発行（256bit・DB はハッシュだけ）→ 同じ診断結果を復元。不正・失効・削除済みは 404（情報を出さない）', { skip }, async () => {
  const ctx = await setup();
  const token = crypto.randomBytes(32).toString('base64url');
  const r = await ctx.op('result-link', { code: CODE_A, token }, { cookie: '' });
  assert.deepEqual([r.code, r.body], [200, { result: 'created' }], '応答に秘密値・記録 ID を返さない');
  const [link] = await ctx.rows('result_resume_links');
  assert.equal(link.token_hash, sha256hex(token));
  assert.ok(!JSON.stringify(await ctx.rows('result_resume_links')).includes(token), 'DB に秘密値そのものを保存しない');
  const [s] = await ctx.rows('diagnosis_sessions');
  assert.deepEqual([s.user_id, !!s.guest_created_at, s.id], [null, true, link.diagnosis_session_id]);
  const [res] = await ctx.rows('diagnosis_results');
  assert.ok(res.v2_scores && res.v2_rankings && res.mirror_snapshot, '保存時の結果のスナップショット');
  // 復元（新しいタブ・履歴・ブックマーク相当：Cookie なし）
  const o = await ctx.op('result-open', { token }, { cookie: '' });
  assert.equal(o.code, 200);
  assert.equal(o.body.code, CODE_A);
  assert.equal(o.body.diagnosisVersion, 'ETI-2.0');
  assert.deepEqual(Object.keys(o.body).sort(), ['code', 'diagnosisVersion', 'versions']);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(o.body)), '記録 ID を返さない');
  // 2回目の診断は別のリンク
  const r2 = { body: { token: await ctx.link(CODE_B) } };
  assert.equal((await ctx.rows('result_resume_links')).length, 2);
  // 不正・失効・削除済み
  for (const bad of ['x'.repeat(43), crypto.randomBytes(32).toString('base64url')]) {
    assert.deepEqual([(await ctx.op('result-open', { token: bad })).code, (await ctx.op('result-open', { token: bad })).body], [404, { error: 'result_not_found' }]);
  }
  assert.equal((await ctx.op('result-open', { token: 'short' })).code, 404);
  assert.equal((await ctx.op('result-open', { token: 1 })).code, 404);
  await ctx.db.sql("update public.result_resume_links set expires_at = now() - interval '1 second' where token_hash = $1", [sha256hex(token)]);
  assert.equal((await ctx.op('result-open', { token })).code, 404, '失効');
  await ctx.db.sql('delete from public.diagnosis_sessions where id = (select diagnosis_session_id from public.result_resume_links where token_hash = $1)', [sha256hex(r2.body.token)]);
  assert.equal((await ctx.op('result-open', { token: r2.body.token })).code, 404, '削除済みの記録');
  // 不正な診断コードでは作らない
  assert.equal((await ctx.op('result-link', { code: '00000000', token: crypto.randomBytes(32).toString('base64url') })).code, 422);
  assert.ok(!ctx.logger.lines.join('\n').includes(token), 'ログに秘密値を出さない');
  await ctx.db.close();
});

test('固有リンクから ¥1,000：同じ記録に結び付く（新しい記録を作らない）。キャンセル後すぐ買い直せる。追加 ¥2,000 も同じ記録。リンクだけの別の端末は所有者にしない', { skip }, async () => {
  const ctx = await setup();
  const token = await ctx.link(CODE_A);
  const [linked] = await ctx.rows('result_resume_links');
  // 別の端末（Cookie なし）で固有リンクを開いて ¥1,000
  ctx.cookie = '';
  const c1 = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A, resume: token });
  assert.equal(c1.code, 200, JSON.stringify(c1.body));
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 1, '記録を新しく作らない');
  assert.equal((await ctx.rows('complete_orders'))[0].diagnosis_session_id, linked.diagnosis_session_id);
  // Stripe でキャンセル → すぐ買い直せる
  assert.deepEqual((await ctx.op('guest-cancel', {})).body, { closed: 1, paid: 0 });
  const c2 = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A, resume: token });
  assert.equal(c2.code, 200);
  ctx.stripe.pay(ctx.csIdOf(c2.body.checkoutUrl), { customer_details: { email: 'owner@example.test' } });
  const st = (await ctx.op('guest-status', { code: CODE_A, resume: token })).body.purchases.find((p) => p.thisRecord);
  assert.deepEqual([st.analysis, st.pending], ['active', false]);
  assert.deepEqual(await rightsOf(ctx, linked.diagnosis_session_id), ['analysis:active']);
  // 固有リンクだけを持つ別の端末（Cookie なし・同じリンクを受け取った別の人かもしれない）：所有者にしない
  //   ¥2,000 は作らない。¥1,000 は、購入済みのリンクの記録には積まず、新しい記録で売る
  const jar = ctx.cookie;
  const noUp = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01', resume: token }, { cookie: '' });
  assert.deepEqual([noUp.code, noUp.body.error], [409, 'upgrade_not_available']);
  const otherBuyer = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A, resume: token }, { cookie: '' });
  assert.equal(otherBuyer.code, 200, JSON.stringify(otherBuyer.body));
  const otherOrder = (await ctx.rows('complete_orders')).find((o) => o.status === 'checkout_open' && o.offer === 'analysis');
  assert.notEqual(otherOrder.diagnosis_session_id, linked.diagnosis_session_id, 'リンクの記録（購入済み）に積まない');
  ctx.cookie = jar;
  // この端末の追加 ¥2,000：同じ記録
  const up = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01', resume: token });
  assert.deepEqual([up.code, up.body.amount], [200, 2000], JSON.stringify(up.body));
  assert.equal((await ctx.rows('complete_orders')).find((o) => o.offer === 'analysis_upgrade').diagnosis_session_id, linked.diagnosis_session_id);
  // 別の記録の固有リンク（違う診断結果）は無視する：その記録には結び付けない（この端末の記録で判断する）
  const other = await ctx.link(CODE_B);
  const [otherLink] = (await ctx.rows('result_resume_links')).filter((l) => l.token_hash === sha256hex(other));
  const misuse = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A, resume: other });
  assert.deepEqual([misuse.code, misuse.body.error], [409, 'analysis_already_purchased'], 'この端末の記録は購入済み');
  assert.equal((await ctx.rows('complete_orders')).filter((o) => o.diagnosis_session_id === otherLink.diagnosis_session_id).length, 0, '違う診断結果の記録には結び付けない');
  // 固有リンクだけでは有料レポートを開けない（Cookie の無い別の端末）
  assert.equal((await ctx.op('guest-report', { ref: st.ref }, { cookie: '' })).code, 403);
  await ctx.db.close();
});

test('固有リンク：引き継いだ後も同じ記録（重複しない）・無料結果は開ける・ゲストとしての購入は断る。返金後は有料部分を開けない', { skip }, async () => {
  const ctx = await setup();
  const token = await ctx.link(CODE_A);
  ctx.cookie = '';
  const c = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A, resume: token });
  const cs = ctx.csIdOf(c.body.checkoutUrl);
  ctx.stripe.pay(cs, { customer_details: { email: 'owner@example.test' } });
  const st = (await ctx.op('guest-status', { code: CODE_A, resume: token })).body.purchases[0];
  const g = await ctx.op('guest-report', { ref: st.ref });
  assert.equal((await ctx.reportData(g.body.url)).code, 200);
  const tok = 'tok-resume-owner';
  const owner = await ctx.db.user({ email: 'owner@example.test', token: tok });
  assert.equal((await ctx.op('guest-claim', { ref: st.ref }, { token: tok })).code, 200);
  const sessions = await ctx.rows('diagnosis_sessions');
  assert.equal(sessions.length, 1, '引き継ぎで記録を増やさない');
  assert.equal(sessions[0].user_id, owner);
  assert.equal((await ctx.op('result-open', { token }, { cookie: '' })).code, 200, '無料結果は開ける');
  // 引き継ぎ済みの記録の固有リンクから、ログインなしで買う：断らずに新しいゲストの記録で売る（引き継いだ記録には触れない）
  const fresh = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01', resume: token }, { cookie: '' });
  assert.equal(fresh.code, 200, JSON.stringify(fresh.body));
  const after = await ctx.rows('diagnosis_sessions');
  assert.equal(after.length, 2);
  assert.equal(after.find((x) => x.id === sessions[0].id).user_id, owner);
  assert.equal((await ctx.rows('complete_orders')).filter((o) => o.diagnosis_session_id === sessions[0].id && o.offer === 'direct_complete').length, 0);
  // 返金後は、発行済みのリンクでも有料部分を開けない
  const ch = Object.values(ctx.stripe.st.charges)[0].id;
  ctx.stripe.refund(ch, 1000);
  assert.equal((await ctx.webhook({ type: 'charge.refunded', objectId: ch })).code, 200);
  assert.equal((await ctx.reportData(g.body.url)).code, 403);
  await ctx.db.close();
});

test('固有リンクの整理（運営者）：期限切れのリンクと、購入の無い古いゲストの記録だけを消す。購入のある記録は残す。API のロールは実行できない', { skip }, async () => {
  const ctx = await setup();
  const t1 = await ctx.link(CODE_A);
  const t2 = await ctx.link(CODE_B);
  ctx.cookie = '';
  const c = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B, resume: t2 });
  ctx.stripe.pay(ctx.csIdOf(c.body.checkoutUrl), { customer_details: { email: 'x@example.test' } });
  await ctx.op('guest-status', {});
  await ctx.db.sql("update public.result_resume_links set expires_at = now() - interval '1 day'");
  await ctx.db.sql("update public.diagnosis_sessions set guest_created_at = now() - interval '181 days'");
  const api = await ctx.db.fetchImpl(`${ENV.SUPABASE_URL}/rest/v1/rpc/complete_purge_result_links`, { method: 'POST', body: '{}' });
  assert.equal(api.ok, false);
  const [r] = await ctx.db.sql('select * from public.complete_purge_result_links()');
  assert.deepEqual([r.links_deleted, r.records_deleted], [2, 1]);
  const left = await ctx.rows('diagnosis_sessions');
  assert.equal(left.length, 1, '購入のある記録は残す');
  assert.equal((await ctx.rows('complete_orders'))[0].diagnosis_session_id, left[0].id);
  assert.equal((await ctx.op('result-open', { token: t1 })).code, 404);
  await ctx.db.close();
});

test('固有リンクの大量作成の防止：同じ秘密値は冪等（連打・再送で記録もリンクも増えない）・入力の制限・接続元ごとに 10 分 10 件で 429・IP は保存もログもしない', { skip }, async () => {
  const ctx = await setup();
  const token = crypto.randomBytes(32).toString('base64url');
  // 連打（同時）と再送：記録もリンクも1つ
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => ctx.op('result-link', { code: CODE_A, token }, { cookie: '' })));
  assert.deepEqual(burst.map((r) => r.code), [200, 200, 200, 200, 200]);
  assert.deepEqual(burst.map((r) => r.body.result).sort(), ['created', 'existing', 'existing', 'existing', 'existing']);
  assert.equal((await ctx.op('result-link', { code: CODE_A, token }, { cookie: '' })).body.result, 'existing');
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 1);
  assert.equal((await ctx.rows('result_resume_links')).length, 1);
  const [rate] = await ctx.rows('result_link_rate');
  assert.equal(rate.n, 1, '冪等の再送は回数に数えない');
  // 同じ秘密値で別の診断結果：断る（記録を増やさない）
  assert.deepEqual([(await ctx.op('result-link', { code: CODE_B, token }, { cookie: '' })).code], [409]);
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 1);
  // 入力の制限（必須・形式・余分な項目・大きさ）
  for (const body of [{ code: CODE_A }, { token }, { code: CODE_A, token: 'short' }, { code: 'A!', token }, { code: CODE_A, token, extra: 1 }, { code: 1, token }]) {
    assert.equal((await ctx.op('result-link', body, { cookie: '' })).code, 400, JSON.stringify(body));
  }
  assert.equal((await ctx.op('result-link', { code: 'a'.repeat(2000), token }, { cookie: '' })).code, 413);
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 1);
  // 同じ接続元から 10 分で 10 件まで（1 件作成済み → あと 9 件）。11 件目は 429（記録もリンクも作らない）
  for (let i = 0; i < 9; i++) await ctx.link(i % 2 ? CODE_A : CODE_B);
  const over = await ctx.op('result-link', { code: CODE_A, token: crypto.randomBytes(32).toString('base64url') }, { cookie: '' });
  assert.deepEqual([over.code, over.body.error, over.headers['retry-after']], [429, 'too_many_requests', '600']);
  assert.equal((await ctx.rows('result_resume_links')).length, 10);
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 10);
  // 作成済みの秘密値の再送は、上限の後でも同じリンクを返す（回数に数えない）
  assert.equal((await ctx.op('result-link', { code: CODE_A, token }, { cookie: '' })).body.result, 'existing');
  // 別の接続元は作れる（IPv6 は /64 で1つ）
  await ctx.link(CODE_A, { ip: '2001:db8:1:2::10' });
  await ctx.db.sql("update public.result_link_rate set bucket = bucket - interval '11 minutes'");
  // 10 分を過ぎれば作れる。24 時間で 100 件まで
  await ctx.link(CODE_A);
  await ctx.db.sql("update public.result_link_rate set n = 99, bucket = now() - interval '2 hours' where n = 10");
  assert.equal((await ctx.op('result-link', { code: CODE_A, token: crypto.randomBytes(32).toString('base64url') }, { cookie: '' })).code, 429, '24 時間で 100 件');
  // 24 時間を過ぎた回数の行は消える
  await ctx.db.sql("update public.result_link_rate set bucket = bucket - interval '25 hours'");
  await ctx.link(CODE_B);
  // IP アドレスそのものは DB にもログにも無い
  const rows = JSON.stringify(await ctx.rows('result_link_rate'));
  assert.ok(!rows.includes('198.51.100.7') && !rows.includes('2001:db8'), rows);
  assert.ok((await ctx.rows('result_link_rate')).every((r) => /^[0-9a-f]{64}$/.test(r.rate_key)));
  const log = ctx.logger.lines.join('\n');
  assert.ok(!log.includes('198.51.100.7') && !log.includes(token), log);
  // anon・authenticated は回数の表・リンクの表を読めない
  const [priv] = await ctx.db.sql("select has_table_privilege('anon', 'public.result_link_rate', 'SELECT') as a, has_table_privilege('authenticated', 'public.result_link_rate', 'SELECT') as b, has_table_privilege('anon', 'public.result_resume_links', 'SELECT') as c");
  assert.deepEqual([priv.a, priv.b, priv.c], [false, false, false]);
  await ctx.db.close();
});

test('ログインなしの購入は買えることを優先：別のブラウザで購入済みの診断結果も新しい記録で買える・別のタブで放置された決済は閉じて作り直す', { skip }, async () => {
  const ctx = await setup();
  // ブラウザ A：¥1,000 を購入
  ctx.cookie = '';
  const a = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  ctx.stripe.pay(ctx.csIdOf(a.body.checkoutUrl), { customer_details: { email: 'owner@example.test' } });
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.equal(st.analysis, 'active');
  const cookieA = ctx.cookie;
  // ブラウザ B（Cookie なし）：同じ診断結果の ¥1,000 を買える（断らない。新しい記録）
  const b = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A }, { cookie: '' });
  assert.equal(b.code, 200, JSON.stringify(b.body));
  assert.equal((await ctx.rows('diagnosis_sessions')).length, 2);
  // 固有リンクの記録 R で、ブラウザ D が ¥1,000 の決済を始めて放置（D の Cookie にしか無い）→ ブラウザ C が同じリンクから ¥1,000：
  //   R には D の注文があるため、C は R に結び付けず新しい記録で買う（「決済の手続き中」で止めない・D の決済も閉じない。
  //   共有されたリンクで、別の人の注文がある記録の権利を渡さない）
  const rTok = await ctx.link(CODE_B);
  const staleD = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B, resume: rTok }, { cookie: '' });
  assert.equal(staleD.code, 200);
  const fromC = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B, resume: rTok }, { cookie: '' });
  assert.equal(fromC.code, 200, JSON.stringify(fromC.body));
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(staleD.body.checkoutUrl)].status, 'open', '別の人の決済画面は閉じない');
  const [rLink] = (await ctx.rows('result_resume_links')).filter((l) => l.token_hash === sha256hex(rTok));
  const rOrders = (await ctx.rows('complete_orders')).filter((o) => o.diagnosis_session_id === rLink.diagnosis_session_id);
  assert.deepEqual(rOrders.map((o) => o.status).sort(), ['checkout_open'], 'R には D の注文だけ');
  // 購入の日時（同じブラウザに複数の購入がある時に見分ける）
  const at = (await ctx.op('guest-status', {}, { cookie: cookieA })).body.purchases[0].purchasedAt;
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  // 再診断で違う結果：別の記録で ¥1,000 を買える（前の購入に関係なく）
  const c = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B }, { cookie: cookieA });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  await ctx.db.close();
});

test('違う診断結果なら買える：ログイン中（マイページ）は前の結果の購入に関係なく ¥1,000・¥3,000 を作れる。同じ診断結果は重ねて売らない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx, { code: CODE_A });
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  // 再診断で違う結果の記録
  const other = await ctx.db.record({ userId: p.userId, code: CODE_B, goal: 'GOAL_PACE_01' });
  const a = await ctx.checkout(p.token, { diagnosisSessionId: other, product: 'analysis' });
  assert.equal(a.code, 200, JSON.stringify(a.body));
  ctx.stripe.pay(ctx.csIdOf(a.body.checkoutUrl), {});
  await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(a.body.checkoutUrl) });
  assert.deepEqual(await rightsOf(ctx, other), ['analysis:active']);
  // 同じ結果をもう一度保存した記録：重ねて売らない
  const same = await ctx.db.record({ userId: p.userId, code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: same, product: 'analysis' })).code, 409);
  await ctx.db.close();
});

// ================= complete_10：所有者の分離・価格の統一（2026-10-14）
//   価格はマイページの有無で変えない。診断コード・result_key・そのハッシュは所有の根拠にしない。
//   ログイン中の結果グループ＝同じ user_id・同じ result_key だけ。ゲストにグループは無い（Cookie の秘密値で確かめた記録だけ）。
async function guestPaid(ctx, body, cookie) {
  const r = await ctx.op('guest-checkout', body, { cookie });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  ctx.stripe.pay(ctx.csIdOf(r.body.checkoutUrl), { customer_details: { email: 'g@example.test' } });
  return r;
}
// Set-Cookie を持たない呼び出し（cookie を明示）でも、新しい Cookie を受け取る
async function guestJar(ctx, body, jar = '') {
  const res = makeRes();
  const h = Checkout.createHandler({ env: ctx.env, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null });
  await h({ method: 'POST', headers: { host: 'evil.example', 'x-real-ip': '198.51.100.9', ...(jar ? { cookie: jar } : {}) }, query: { op: 'guest-checkout' }, body }, res);
  const set = res.headers['set-cookie'];
  return { res, jar: set ? set.split(';')[0] : jar };
}

test('同じ診断結果のログイン中の別ユーザー A・B：A の ¥3,000 は B に付かない。B は ¥1,000・¥3,000 を買える。A は重ねて買えない', { skip }, async () => {
  const ctx = await setup();
  const a = await person(ctx, { email: 'a@example.test' });
  const b = await person(ctx, { email: 'b@example.test' });
  const { r } = await payLoggedIn(ctx, a, { diagnosisSessionId: a.sessionId });
  assert.deepEqual([r.body.offer, r.body.amount], ['direct_complete', 3000]);
  assert.deepEqual(await rightsOf(ctx, a.sessionId), ['analysis:active', 'complete:active']);
  // B：A の購入は見えない・使えない
  const eb = (await ctx.entitlements(b.token)).body;
  const rb = eb.records[b.sessionId];
  assert.deepEqual([rb.analysisAccess, rb.analysisPurchased, rb.completeOffer, rb.completeBlocked, rb.repurchaseBlocked], [false, false, 'direct_complete', null, false]);
  assert.deepEqual(eb.purchased_by_version, {});
  assert.equal((await ctx.reportLink(b.token, b.sessionId)).code, 403);
  assert.deepEqual((await ctx.status(b.token, b.sessionId)).body.entitlements, { analysis: null, complete: null });
  // B は ¥3,000 を作れる（中止）→ ¥1,000 も作れる
  const b3 = await ctx.checkout(b.token, { diagnosisSessionId: b.sessionId });
  assert.deepEqual([b3.code, b3.body.offer, b3.body.amount], [200, 'direct_complete', 3000]);
  assert.equal((await ctx.op('user-reconcile', { cancel: true }, { token: b.token })).code, 200);
  const b1 = await ctx.checkout(b.token, { diagnosisSessionId: b.sessionId, product: 'analysis' });
  assert.deepEqual([b1.code, b1.body.offer, b1.body.amount], [200, 'analysis', 1000]);
  // A：完全解析を購入済み。¥1,000・¥3,000 とも断る
  assert.deepEqual((await ctx.checkout(a.token, { diagnosisSessionId: a.sessionId, product: 'analysis' })).body.error, 'analysis_already_purchased');
  assert.equal((await ctx.checkout(a.token, { diagnosisSessionId: a.sessionId })).code, 409);
  await ctx.db.close();
});

test('同じ診断結果のゲスト A・B：権利は Cookie の秘密値で確かめた記録だけ。秘密値を入れ替えた Cookie は使えない', { skip }, async () => {
  const ctx = await setup();
  let A = await guestJar(ctx, { offer: 'analysis', code: CODE_A });
  ctx.stripe.pay(ctx.csIdOf(A.res.body.checkoutUrl), { customer_details: { email: 'a@example.test' } });
  let B = await guestJar(ctx, { offer: 'analysis', code: CODE_A });
  ctx.stripe.pay(ctx.csIdOf(B.res.body.checkoutUrl), { customer_details: { email: 'b@example.test' } });
  const stA = (await ctx.op('guest-status', { code: CODE_A }, { cookie: A.jar })).body.purchases;
  const stB = (await ctx.op('guest-status', { code: CODE_A }, { cookie: B.jar })).body.purchases;
  assert.deepEqual([stA.length, stB.length], [1, 1]);
  assert.notEqual(stA[0].ref, stB[0].ref, '別の記録');
  assert.deepEqual([stA[0].canUpgrade, stB[0].canUpgrade], [true, true]);
  // 秘密値の入れ替え：A の注文 ID ＋ B の秘密値・B の注文 ID ＋ A の秘密値
  const [aId, aSecret] = A.jar.split('=')[1].split('.');
  const [bId, bSecret] = B.jar.split('=')[1].split('.');
  const name = A.jar.split('=')[0];
  for (const forged of [`${name}=${aId}.${bSecret}`, `${name}=${bId}.${aSecret}`]) {
    assert.deepEqual((await ctx.op('guest-status', { code: CODE_A }, { cookie: forged })).body.purchases, [], '確かめられない注文は返さない');
    assert.equal((await ctx.op('guest-report', { ref: stA[0].ref }, { cookie: forged })).code, 403);
    const up = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' }, { cookie: forged });
    assert.deepEqual([up.code, up.body.error], [409, 'upgrade_not_available']);
  }
  // B の Cookie で A の ref は開けない
  assert.equal((await ctx.op('guest-report', { ref: stA[0].ref }, { cookie: B.jar })).code, 403);
  // A の ¥2,000 は A の記録だけに付く。B は影響を受けない
  A = await guestJar(ctx, { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' }, A.jar);
  assert.deepEqual([A.res.code, A.res.body.amount], [200, 2000]);
  ctx.stripe.pay(ctx.csIdOf(A.res.body.checkoutUrl), { customer_details: { email: 'a@example.test' } });
  const a2 = (await ctx.op('guest-status', { code: CODE_A }, { cookie: A.jar })).body.purchases.find((x) => x.thisRecord);
  const b2 = (await ctx.op('guest-status', { code: CODE_A }, { cookie: B.jar })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([a2.complete, a2.canUpgrade], ['active', false]);
  assert.deepEqual([b2.complete, b2.canUpgrade], [null, true]);
  await ctx.db.close();
});

test('同じ診断結果の別の人の旧 Payment Link の購入：ログイン中・ゲストとも購入済みにせず、¥1,000・¥3,000・（¥1,000 の後の）¥2,000 を売る', { skip }, async () => {
  const ctx = await setup();
  await ctx.db.legacy({ code: CODE_A, stripeSessionId: ctx.stripe.legacySession({ email: 'other@example.test' }) });
  const p = await person(ctx, { email: 'me@example.test' });
  const rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.analysisAccess, rec.analysisPurchased, rec.legacyAnalysis, rec.completeOffer, rec.completeBlocked], [false, false, false, 'direct_complete', null]);
  assert.equal((await ctx.reportLink(p.token, p.sessionId)).code, 403, '別の人の旧購入で読めない');
  // ¥3,000（DB も旧購入で断らない）→ 中止 → ¥1,000 → ¥2,000
  const d = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([d.code, d.body.amount], [200, 3000]);
  await ctx.op('user-reconcile', { cancel: true }, { token: p.token });
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const { r } = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([r.body.offer, r.body.amount], ['analysis_upgrade', 2000]);
  assert.deepEqual((await ctx.rows('complete_orders')).filter((o) => o.status === 'paid').map((o) => `${o.offer}:${o.analysis_basis}`).sort(),
    ['analysis:null', 'analysis_upgrade:record_entitlement']);
  assert.equal((await ctx.rows('complete_legacy_bindings')).length, 0, '推測で結び付けない');
  // ゲスト（別のブラウザ）も同じ：旧購入で断らない
  const g = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }, { cookie: '' });
  assert.deepEqual([g.code, g.body.amount], [200, 3000]);
  const st = (await ctx.op('guest-status', { code: CODE_A }, { cookie: '' })).body;
  assert.deepEqual(st.purchases, []);
  assert.equal('codePurchased' in st, false, '診断コードだけで購入済みを返さない');
  await ctx.db.close();
});

test('同じ診断結果の別の人が同時に決済を始める（ログイン中 A・B、ゲスト C・D）：互いに止めず、別の注文・別の記録', { skip }, async () => {
  const ctx = await setup();
  const a = await person(ctx, { email: 'a@example.test' });
  const b = await person(ctx, { email: 'b@example.test' });
  const [ra, rb, gc, gd] = await Promise.all([
    ctx.checkout(a.token, { diagnosisSessionId: a.sessionId }),
    ctx.checkout(b.token, { diagnosisSessionId: b.sessionId }),
    guestJar(ctx, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }),
    guestJar(ctx, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }),
  ]);
  assert.deepEqual([ra.code, rb.code, gc.res.code, gd.res.code], [200, 200, 200, 200], JSON.stringify([ra.body, rb.body, gc.res.body, gd.res.body]));
  const open = (await ctx.rows('complete_orders')).filter((o) => o.status === 'checkout_open');
  assert.equal(open.length, 4);
  assert.equal(new Set(open.map((o) => o.diagnosis_session_id)).size, 4);
  // 4つとも支払う：それぞれの記録にだけ権利が付く
  for (const o of open) ctx.stripe.pay(o.stripe_checkout_session_id, {});
  for (const o of open) assert.equal((await ctx.webhook({ type: 'checkout.session.completed', objectId: o.stripe_checkout_session_id })).code, 200);
  for (const o of open) assert.deepEqual(await rightsOf(ctx, o.diagnosis_session_id), ['analysis:active', 'complete:active']);
  await ctx.db.close();
});

test('価格・経路の一覧（サーバーが権利から決める。マイページの有無で変えない）', { skip }, async () => {
  const ctx = await setup();
  const off = (r) => (r.code === 200 ? `${r.body.offer}:${r.body.amount}` : `${r.code}:${r.body.error}`);
  // ログイン中：未購入 → ¥1,000・¥3,000。解析レポート → ¥2,000 だけ。完全解析 → 買えない
  const p = await person(ctx);
  assert.equal(off(await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' })), 'analysis:1000');
  await ctx.op('user-reconcile', { cancel: true }, { token: p.token });
  assert.equal(off(await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })), 'direct_complete:3000');
  await ctx.op('user-reconcile', { cancel: true }, { token: p.token });
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal(off(await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' })), '409:analysis_already_purchased');
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  assert.equal(ctx.stripe.st.lastCreate.params.line_items[0].price, 'price_test_upgrade2000');
  assert.equal(off(await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' })), '409:analysis_already_purchased');
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).code, 409);
  // ゲスト（同じ端末）：未購入 → ¥1,000・¥3,000（¥2,000 は無い）。解析レポート → ¥2,000 だけ。完全解析 → 買えない
  ctx.cookie = '';
  assert.equal(off(await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_B, goal: 'GOAL_PACE_01' })), '409:upgrade_not_available');
  assert.equal(off(await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_B, goal: 'GOAL_PACE_01' })), 'direct_complete:3000');
  await ctx.op('guest-cancel', {});
  const g1 = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B });
  assert.equal(off(g1), 'analysis:1000');
  ctx.stripe.pay(ctx.csIdOf(g1.body.checkoutUrl), {});
  await ctx.op('guest-status', {});
  assert.equal(off(await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B })), '409:analysis_already_purchased');
  assert.equal(off(await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_B, goal: 'GOAL_PACE_01' })), '409:upgrade_available');
  const g2 = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_B, goal: 'GOAL_PACE_01' });
  assert.equal(off(g2), 'analysis_upgrade:2000');
  ctx.stripe.pay(ctx.csIdOf(g2.body.checkoutUrl), {});
  await ctx.op('guest-status', {});
  for (const body of [{ offer: 'analysis', code: CODE_B }, { offer: 'direct_complete', code: CODE_B, goal: 'GOAL_PACE_01' }, { offer: 'analysis_upgrade', code: CODE_B, goal: 'GOAL_PACE_01' }]) {
    assert.equal((await ctx.op('guest-checkout', body)).code, 409, body.offer);
  }
  // 金額・価格・割引・参照元はクライアントから受け取らない（余分な項目は 400）
  for (const extra of [{ amount: 1 }, { price: 'price_x' }, { discount: 'x' }, { source: 'report' }, { referrer: 'x' }]) {
    assert.equal((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A, ...extra }, { cookie: '' })).code, 400, JSON.stringify(extra));
  }
  await ctx.db.close();
});

test('ゲストの ¥2,000 の連打・再読み込み：同じ記録の決済は1つだけ（同じ画面を返すか、手続き中）', { skip }, async () => {
  const ctx = await setup();
  await guestPaid(ctx, { offer: 'analysis', code: CODE_A });
  await ctx.op('guest-status', {});
  const jar = ctx.cookie;
  const rs = await Promise.all([0, 1, 2].map(() => ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' }, { cookie: jar })));
  assert.ok(rs.every((r) => r.code === 200 || (r.code === 409 && r.body.error === 'checkout_in_progress')), JSON.stringify(rs.map((r) => r.body)));
  const open = (await ctx.rows('complete_orders')).filter((o) => o.offer === 'analysis_upgrade' && (o.status === 'checkout_open' || o.status === 'created'));
  assert.ok(open.length <= 1, '同じ記録に開いた ¥2,000 の決済は1つだけ');
  await ctx.db.close();
});

// ================= 総当たり（2026-10-14）：ゲストで購入 → マイページを作成・引き継ぎ。支払っていない決済で「購入済み」にならない
//   ゲストの購入の組み合わせ × 引き継ぎの方法（この端末の Cookie／購入時メールの OTP）× 引き継ぐ前に同じ結果の記録を保存していたか
const GUEST_EMAIL = 'buyer.matrix@example.test';
async function guestPay(ctx, body) {
  const r = await ctx.op('guest-checkout', body);
  assert.equal(r.code, 200, `${body.offer}: ${JSON.stringify(r.body)}`);
  ctx.stripe.pay(ctx.csIdOf(r.body.checkoutUrl), { customer_details: { email: GUEST_EMAIL } });
  await ctx.op('guest-status', { code: body.code });
  return r;
}
function otpToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b({ sub: crypto.randomUUID(), amr: [{ method: 'otp', timestamp: nowSec - 10 }] })}.sig`;
}
// マイページから見た、この本人の同じ診断結果の記録すべての状態（表示・閲覧・申込）
async function accountView(ctx, token, code) {
  const ent = (await ctx.entitlements(token)).body;
  const sids = (await ctx.rows('diagnosis_sessions')).filter((s) => s.user_id && Object.prototype.hasOwnProperty.call(ent.records || {}, s.id)).map((s) => s.id);
  const answers = await ctx.rows('diagnosis_answers');
  const mine = sids.filter((id) => answers.some((a) => a.session_id === id && a.encoded_answers === code));
  return { ent, sids: mine };
}
const MATRIX = [
  { name: '¥1,000', seq: ['analysis'], expect: 'analysis' },
  { name: '¥3,000', seq: ['direct_complete'], expect: 'complete' },
  { name: '¥1,000 → 追加 ¥2,000', seq: ['analysis', 'analysis_upgrade'], expect: 'complete' },
];
for (const m of MATRIX) {
  for (const method of ['cookie', 'email_otp']) {
    for (const savedFirst of [false, true]) {
      test(`総当たり：ゲストで${m.name} → ${method === 'cookie' ? 'この端末で' : '購入時メールで'}引き継ぎ${savedFirst ? '（先に同じ結果を保存した記録あり）' : ''} → マイページで正しく読める・買い直しを求めない`, { skip }, async () => {
        const ctx = await setup();
        ctx.cookie = '';
        for (const offer of m.seq) await guestPay(ctx, offer === 'analysis' ? { offer, code: CODE_A } : { offer, code: CODE_A, goal: 'GOAL_PACE_01' });
        // マイページ作成（購入時と同じメール）
        const token = method === 'cookie' ? `tok-${crypto.randomBytes(6).toString('hex')}` : otpToken();
        const userId = await ctx.db.user({ email: GUEST_EMAIL, token });
        if (savedFirst) await ctx.db.record({ userId, code: CODE_A, goal: 'GOAL_PACE_01' });
        if (method === 'cookie') {
          const claimable = (await ctx.op('guest-status', {})).body.purchases.filter((p) => p.canClaim);
          assert.equal(claimable.length, 1, '引き継げる購入は1件（1つの記録）');
          const c = await ctx.op('guest-claim', { ref: claimable[0].ref }, { token });
          assert.deepEqual([c.code, c.body.result], [200, 'claimed'], JSON.stringify(c.body));
        } else {
          const prevCookie = ctx.cookie;
          const r = await ctx.op('guest-recover', {}, { token, cookie: '' });
          assert.deepEqual([r.code, r.body.claimed], [200, 1], JSON.stringify(r.body));
          ctx.cookie = prevCookie;
        }
        const { ent, sids } = await accountView(ctx, token, CODE_A);
        assert.equal(sids.length, savedFirst ? 2 : 1, '記録を複製しない（保存した記録＋引き継いだ記録だけ）');
        assert.equal(ent.purchased_by_version[`ETI-2.0:${CODE_A}`], true, '解析レポートは購入済み');
        assert.equal(sids.filter((id) => ent.records[id].duplicateOf === null).length, 1, '表示の正本は1つ');
        const rights = (await ctx.rows('record_entitlements')).filter((e) => e.user_id === userId).map((e) => `${e.right_type}:${e.status}`).sort();
        assert.deepEqual(rights, m.expect === 'complete' ? ['analysis:active', 'complete:active'] : ['analysis:active'], '権利は本人へ移り、複製しない');
        for (const id of sids) {
          const rec = ent.records[id];
          assert.deepEqual([rec.analysisAccess, rec.analysisPurchased], [true, true], `${id === sids[0] ? 'A' : 'B'}：解析レポート`);
          if (m.expect === 'complete') {
            assert.deepEqual([rec.completeEntitlement, rec.repurchaseBlocked, rec.completeOffer, rec.completeBlocked], ['active', true, null, 'repurchase_not_allowed']);
            const s = await ctx.status(token, id);
            assert.deepEqual([s.code, s.body.entitlements], [200, { analysis: 'active', complete: 'active' }], '完全解析の状態');
          } else {
            assert.deepEqual([rec.completeEntitlement, rec.repurchaseBlocked, rec.completeOffer, rec.completeBlocked], [null, false, 'analysis_upgrade', null]);
          }
          // 解析レポートを開ける（どちらの記録からでも）
          const link = await ctx.reportLink(token, id);
          assert.equal(link.code, 200);
          const data = await ctx.reportData(link.body.url);
          assert.deepEqual([data.code, data.body.code, data.body.complete], [200, CODE_A, m.expect === 'complete' ? 'owned' : 'analysis_upgrade']);
          // 買い直しを求めない：¥1,000 は断る。完全解析は ¥2,000（解析だけ）／断る（完全解析まで）
          assert.equal((await ctx.checkout(token, { diagnosisSessionId: id, product: 'analysis' })).body.error, 'analysis_already_purchased');
        }
        // マイページの手順：MENTOR の目標を選んでから申し込む（完全解析を購入済みなら目標の選択も断る）
        const g = await ctx.mentor(token, sids[0], 'GOAL_RELATION_01');
        assert.equal(g.code, m.expect === 'complete' ? 409 : 200, JSON.stringify(g.body));
        const up = await ctx.checkout(token, { diagnosisSessionId: sids[0] });
        if (m.expect === 'complete') assert.equal(up.code, 409);
        else {
          assert.deepEqual([up.code, up.body.offer, up.body.amount], [200, 'analysis_upgrade', 2000], 'マイページ作成後も追加 ¥2,000 のまま：' + JSON.stringify(up.body));
          // そのまま ¥2,000 を払う → 両方を読める
          ctx.stripe.pay(ctx.csIdOf(up.body.checkoutUrl), {});
          await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(up.body.checkoutUrl) });
          const after = (await accountView(ctx, token, CODE_A)).ent;
          for (const id of sids) assert.deepEqual([after.records[id].completeEntitlement, after.records[id].completeBlocked], ['active', 'repurchase_not_allowed']);
        }
        // ゲストとしての画面（同じ端末）：引き継ぎ済みは Cookie から外れ、ゲストとして売り直さない状態の記録は残らない
        const gs = (await ctx.op('guest-status', { code: CODE_A })).body.purchases;
        assert.ok(gs.every((p) => p.claimed || p.canClaim === false));
        await ctx.db.close();
      });
    }
  }
}

test('総当たり：引き継ぐ前に始めて放置した未払いの決済（¥2,000）があっても、マイページで「購入済み」にせず、¥2,000 を申し込める', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  await guestPay(ctx, { offer: 'analysis', code: CODE_A });
  const open = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' }); // 放置（未払い）
  assert.equal(open.code, 200);
  const token = `tok-${crypto.randomBytes(6).toString('hex')}`;
  await ctx.db.user({ email: GUEST_EMAIL, token });
  const claimable = (await ctx.op('guest-status', {})).body.purchases.filter((p) => p.canClaim);
  assert.equal((await ctx.op('guest-claim', { ref: claimable[0].ref }, { token })).code, 200);
  const { ent, sids } = await accountView(ctx, token, CODE_A);
  const rec = ent.records[sids[0]];
  assert.deepEqual([rec.analysisAccess, rec.completeEntitlement, rec.repurchaseBlocked], [true, null, false], '未払いの ¥2,000 で完全解析を購入済みにしない');
  // 決済の手続き中なら「決済をやり直す」で戻せる。いずれにしても ¥2,000 を作れる
  if (rec.completeBlocked === 'checkout_in_progress') {
    const reset = await ctx.op('user-checkout-reset', { diagnosisSessionId: sids[0] }, { token });
    assert.equal(reset.code, 200, JSON.stringify(reset.body));
  }
  assert.equal((await ctx.mentor(token, sids[0], 'GOAL_RELATION_01')).code, 200);
  const up = await ctx.checkout(token, { diagnosisSessionId: sids[0] });
  assert.deepEqual([up.code, up.body.offer, up.body.amount], [200, 'analysis_upgrade', 2000], JSON.stringify(up.body));
  await ctx.db.close();
});

test('総当たり：支払っていない決済（開いたまま・Stripe で期限切れ・中止）で、ゲスト・ログイン中とも「購入済み」にならず、すぐ買える', { skip }, async () => {
  const ctx = await setup();
  // ゲスト：3種類とも、開いたまま・期限切れでは権利なし。同じ・別の申込をすぐ作れる
  ctx.cookie = '';
  for (const body of [{ offer: 'analysis', code: CODE_A }, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }]) {
    const r = await ctx.op('guest-checkout', body);
    assert.equal(r.code, 200);
    const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
    assert.deepEqual([st.analysis, st.complete, st.canClaim, st.canUpgrade], [null, null, false, false], `${body.offer}：未払いは購入済みにしない`);
    ctx.stripe.expire(ctx.csIdOf(r.body.checkoutUrl));
    const st2 = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
    assert.deepEqual([st2.analysis, st2.complete, st2.pending], [null, null, false], `${body.offer}：期限切れ`);
  }
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A })).code, 200, '期限切れの後に買える');
  assert.deepEqual((await ctx.op('guest-cancel', {})).body, { closed: 1, paid: 0 });
  assert.equal((await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' })).code, 200, '中止の後に買える');
  // ¥2,000 の未払い：解析レポートは購入済みのまま、完全解析は未購入のまま・もう一度申し込める
  ctx.cookie = '';
  await guestPay(ctx, { offer: 'analysis', code: CODE_B });
  const up = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_B, goal: 'GOAL_PACE_01' });
  assert.equal(up.code, 200);
  let b = (await ctx.op('guest-status', { code: CODE_B })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([b.analysis, b.complete, b.canUpgrade], ['active', null, true]);
  ctx.stripe.expire(ctx.csIdOf(up.body.checkoutUrl));
  b = (await ctx.op('guest-status', { code: CODE_B })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([b.analysis, b.complete, b.canUpgrade, b.pending], ['active', null, true, false]);
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_B, goal: 'GOAL_PACE_01' })).code, 200);

  // ログイン中：開いたまま・期限切れ・中止で、購入済み・再購入不可にならない
  const p = await person(ctx, { code: savedRecord(variantAnswers(2)).encoded_answers });
  const a = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal(a.code, 200);
  let rec = (await ctx.entitlements(p.token)).body;
  assert.deepEqual([rec.purchased_by_version, rec.records[p.sessionId].analysisPurchased, rec.records[p.sessionId].analysisAccess], [{}, false, false], '開いたままの ¥1,000');
  // 開いたままでも、同じ ¥1,000・別の ¥3,000 を作れる（古い画面は閉じる）
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' })).code, 200);
  const d = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([d.code, d.body.offer], [200, 'direct_complete'], JSON.stringify(d.body));
  rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.completeEntitlement, rec.repurchaseBlocked, rec.analysisPurchased], [null, false, false], '開いたままの ¥3,000');
  ctx.stripe.expire(ctx.csIdOf(d.body.checkoutUrl));
  await ctx.op('user-reconcile', {}, { token: p.token });
  rec = (await ctx.entitlements(p.token)).body.records[p.sessionId];
  assert.deepEqual([rec.checkoutInProgress, rec.completeOffer, rec.analysisPurchased], [false, 'direct_complete', false], '期限切れの後');
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' })).code, 200, '期限切れの後に買える');
  await ctx.db.close();
});

test('総当たり：ログイン中に結果ページから買う（ゲストの決済）：決済画面のメールはアカウントの確認済みメール → マイページで引き継げる。ログインを確かめられなくても売る', { skip }, async () => {
  const ctx = await setup();
  const token = `tok-${crypto.randomBytes(6).toString('hex')}`;
  const userId = await ctx.db.user({ email: 'member@example.test', token });
  await ctx.db.record({ userId, code: CODE_A, goal: 'GOAL_PACE_01' }); // 結果ページで保存済みの同じ結果
  ctx.cookie = '';
  const r = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }, { token });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(ctx.stripe.st.lastCreate.params.customer_email, 'member@example.test');
  ctx.stripe.pay(ctx.csIdOf(r.body.checkoutUrl), { customer_details: { email: 'member@example.test' } });
  const claimable = (await ctx.op('guest-status', {})).body.purchases.filter((p) => p.canClaim);
  assert.equal((await ctx.op('guest-claim', { ref: claimable[0].ref }, { token })).code, 200);
  const { ent, sids } = await accountView(ctx, token, CODE_A);
  assert.equal(sids.length, 2);
  for (const id of sids) assert.deepEqual([ent.records[id].analysisAccess, ent.records[id].completeEntitlement, ent.records[id].completeOffer], [true, 'active', null]);
  // ログインを確かめられない（期限切れのトークン）・ログインしていない：メールを入れずに売る（止めない）
  for (const t of ['tok-expired-unknown', undefined]) {
    const g = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B }, { token: t, cookie: '' });
    assert.equal(g.code, 200, JSON.stringify(g.body));
    assert.equal('customer_email' in ctx.stripe.st.lastCreate.params, false);
  }
  await ctx.db.close();
});

test('総当たり：¥1,000 と追加 ¥2,000 を別のメールで払った：どちらかのメールのアカウントへ引き継げる（この端末・購入時メールの確認とも）。どちらでもないメールには移らない', { skip }, async () => {
  for (const method of ['cookie', 'email_otp']) {
    const ctx = await setup();
    ctx.cookie = '';
    const a = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
    ctx.stripe.pay(ctx.csIdOf(a.body.checkoutUrl), { customer_details: { email: 'first@example.test' } });
    await ctx.op('guest-status', {});
    const u = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
    ctx.stripe.pay(ctx.csIdOf(u.body.checkoutUrl), { customer_details: { email: 'second@example.test' } });
    await ctx.op('guest-status', {});
    const ref = (await ctx.op('guest-status', {})).body.purchases[0].ref;
    // どちらでもないメール：移らない
    const stranger = `tok-${crypto.randomBytes(6).toString('hex')}`;
    await ctx.db.user({ email: 'stranger@example.test', token: stranger });
    assert.deepEqual((await ctx.op('guest-claim', { ref }, { token: stranger })).body, { error: 'claim_email_mismatch' });
    // 2つ目の支払いのメールのアカウント
    const token = method === 'cookie' ? `tok-${crypto.randomBytes(6).toString('hex')}` : otpToken();
    const userId = await ctx.db.user({ email: 'second@example.test', token });
    if (method === 'cookie') assert.equal((await ctx.op('guest-claim', { ref }, { token })).code, 200);
    else assert.equal((await ctx.op('guest-recover', {}, { token, cookie: '' })).body.claimed, 1);
    const rights = (await ctx.rows('record_entitlements')).filter((e) => e.user_id === userId).map((e) => `${e.right_type}:${e.status}`).sort();
    assert.deepEqual(rights, ['analysis:active', 'complete:active'], method);
    await ctx.db.close();
  }
});

// ================= 監査（2026-10-14）で見つかった漏れの再発防止
test('監査：共有された結果リンクで、別の人が決済を放置・支払っても、持ち主の購入を見せない・使わせない', { skip }, async () => {
  const ctx = await setup();
  const link = await ctx.link(CODE_A); // A の結果（固有リンク）
  // B（リンクを受け取った別の人）が同じリンクから ¥1,000 を始めて放置
  const B = await guestJar(ctx, { offer: 'analysis', code: CODE_A, resume: link });
  assert.equal(B.res.code, 200);
  ctx.stripe.expire(ctx.csIdOf(B.res.body.checkoutUrl));
  // A がリンクから ¥1,000 を買う：B の注文がある記録には結び付けず、新しい記録で
  const A = await guestJar(ctx, { offer: 'analysis', code: CODE_A, resume: link });
  assert.equal(A.res.code, 200);
  ctx.stripe.pay(ctx.csIdOf(A.res.body.checkoutUrl), { customer_details: { email: 'a@example.test' } });
  const sa = (await ctx.op('guest-status', { code: CODE_A, resume: link }, { cookie: A.jar })).body.purchases.find((x) => x.thisRecord);
  assert.equal(sa.analysis, 'active');
  // B の端末：A の購入は見えない・読めない・¥2,000 も引き継ぎもできない
  const sb = (await ctx.op('guest-status', { code: CODE_A, resume: link }, { cookie: B.jar })).body.purchases;
  assert.ok(sb.every((x) => x.analysis === null && x.complete === null && !x.canClaim && !x.canUpgrade), JSON.stringify(sb));
  assert.equal((await ctx.op('guest-report', { ref: sa.ref }, { cookie: B.jar })).code, 403);
  assert.deepEqual((await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' }, { cookie: B.jar })).body.error, 'upgrade_not_available');
  // B は自分で買える（新しい記録）
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A }, { cookie: B.jar })).code, 200);
  await ctx.db.close();
});

test('監査：ログイン中に結果ページから買う：アカウントで同じ結果を購入済み・決済中なら、ゲストとして重ねて売らない（マイページへ）', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx, { email: 'me@example.test' });
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  for (const body of [{ offer: 'analysis', code: CODE_A }, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }]) {
    const r = await ctx.op('guest-checkout', body, { token: p.token, cookie: '' });
    assert.deepEqual([r.code, r.body.error], [409, 'owned_in_account'], body.offer);
  }
  // 違う診断結果は買える
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B }, { token: p.token, cookie: '' })).code, 200);
  // ログインしていない（トークンなし）：同じ人か確かめられないため売る
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A }, { cookie: '' })).code, 200);
  await ctx.db.close();
});

test('監査：この端末に未引き継ぎのゲスト購入がある結果は、マイページ（アカウント）で重ねて売らない', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  const g = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  ctx.stripe.pay(ctx.csIdOf(g.body.checkoutUrl), { customer_details: { email: 'guest@example.test' } });
  await ctx.op('guest-status', {});
  const H = Checkout.createHandler({ env: ctx.env, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null });
  const call = async (p) => {
    const res = makeRes();
    await H({ method: 'POST', headers: { host: 'x', authorization: `Bearer ${p.token}`, cookie: ctx.cookie }, body: { diagnosisSessionId: p.sessionId, product: 'analysis' } }, res);
    return res;
  };
  // 引き継げる（購入時と同じメールの）アカウント：先に引き継ぐ（重ねて売らない）
  const same = await person(ctx, { email: 'guest@example.test' });
  assert.deepEqual([(await call(same)).code, (await call(same)).body.error], [409, 'guest_purchase_unclaimed']);
  // 引き継げない（別のメールの）アカウント：同じ端末の別の人かもしれない。止めずに売る（自分のアカウントで買える）
  const p = await person(ctx, { email: 'other@example.test' });
  assert.equal((await call(p)).code, 200);
  await ctx.op('user-reconcile', { cancel: true }, { token: p.token });
  // Cookie の無い端末では売る（同じ人か確かめられない）
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' })).code, 200);
  await ctx.db.close();
});

test('監査：返金の後は、ログイン中も同じ記録でもう一度買える（¥1,000・¥2,000・¥3,000）。¥2,000 の後の ¥1,000 返金は ¥1,000 の買い直しで完全解析も読める', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const a1 = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  await refund(ctx, a1.cs, 1000);
  const a2 = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.deepEqual([a2.r.body.offer, a2.r.body.amount], ['analysis', 1000]);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active', 'analysis:revoked']);
  const u1 = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([u1.r.body.offer, u1.r.body.amount], ['analysis_upgrade', 2000]);
  await refund(ctx, u1.cs, 2000);
  const u2 = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([u2.r.body.offer, u2.r.body.amount], ['analysis_upgrade', 2000], '¥2,000 の返金の後に ¥2,000');
  // ¥2,000 の後に ¥1,000 だけ返金：完全解析は根拠が無く読めない → ¥1,000 をもう一度買うと読める
  await refund(ctx, a2.cs, 1000);
  assert.equal((await ctx.entitlements(p.token)).body.records[p.sessionId].completeViewBlocked, 'basis_inactive');
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal((await ctx.entitlements(p.token)).body.records[p.sessionId].completeViewBlocked, null);
  // ¥3,000 の返金の後に ¥3,000（別の記録）
  const q = await person(ctx, { email: 'q@example.test', code: CODE_B });
  const d1 = await payLoggedIn(ctx, q, { diagnosisSessionId: q.sessionId });
  assert.equal(d1.r.body.amount, 3000);
  await refund(ctx, d1.cs, 3000);
  const d2 = await payLoggedIn(ctx, q, { diagnosisSessionId: q.sessionId });
  assert.deepEqual([d2.r.body.offer, d2.r.body.amount], ['direct_complete', 3000]);
  assert.deepEqual(await rightsOf(ctx, q.sessionId), ['analysis:active', 'analysis:revoked', 'complete:active', 'complete:revoked']);
  await ctx.db.close();
});

test('監査：二重の購入になる支払いは反映しない（運営者確認）：引き継ぎ後に届いた同じ結果の支払い・切り替え前の ¥3,000 の遅れた支払い・根拠の無い ¥2,000', { skip }, async () => {
  const ctx = await setup();
  // (1) 本人の同じ結果の記録 A で ¥1,000 の決済を開いたまま、ゲスト購入（¥1,000 支払い済み）を引き継ぐ：A の決済は閉じられる
  const p = await person(ctx, { email: 'owner@example.test' });
  const open = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal(open.code, 200);
  ctx.cookie = '';
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  const ref = (await ctx.op('guest-status', {})).body.purchases[0].ref;
  assert.equal((await ctx.op('guest-claim', { ref }, { token: p.token })).code, 200);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(open.body.checkoutUrl)].status, 'expired', '引き継ぎの前に本人の同じ結果の決済を閉じる');
  // それでも遅れて支払われた：反映しない（解析権は1つのまま）
  ctx.stripe.pay(ctx.csIdOf(open.body.checkoutUrl), {});
  const w = await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(open.body.checkoutUrl) });
  assert.equal(w.code, 200);
  const rights = (await ctx.rows('record_entitlements')).filter((e) => e.user_id === p.userId && e.status === 'active');
  assert.equal(rights.filter((e) => e.right_type === 'analysis').length, 1, '解析権を二重にしない');
  // (2) 根拠の無い ¥2,000：決済中に ¥1,000 が返金された
  const q = await person(ctx, { email: 'q@example.test', code: CODE_B });
  const a = await payLoggedIn(ctx, q, { diagnosisSessionId: q.sessionId, product: 'analysis' });
  const up = await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId });
  assert.equal(up.body.offer, 'analysis_upgrade');
  await refund(ctx, a.cs, 1000);
  ctx.stripe.pay(ctx.csIdOf(up.body.checkoutUrl), {});
  await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(up.body.checkoutUrl) });
  assert.deepEqual((await rightsOf(ctx, q.sessionId)).filter((x) => x.startsWith('complete')), [], '根拠の無い ¥2,000 で完全解析を付けない（運営者が返金する）');
  const ev = await ctx.db.sql(`select error_code from public.stripe_webhook_events where error_code in ('basis_inactive', 'live_order_conflict') order by error_code`);
  assert.deepEqual(ev.map((e) => e.error_code), ['basis_inactive', 'live_order_conflict']);
  await ctx.db.close();
});

test('監査：ゲストの同じ結果の記録が複数（返金後の買い直し）：「この結果」は権利の有効な記録。¥2,000 を出し、¥1,000 を重ねない', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  const cs1 = await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  await refund(ctx, cs1, 1000);
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A }); // 返金の後の買い直し（新しい記録）
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([st.analysis, st.canUpgrade], ['active', true]);
  assert.deepEqual((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A })).body.error, 'analysis_already_purchased');
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' })).body.amount, 2000);
  await ctx.db.close();
});

test('監査：Cookie の上限を超えても、支払い済みの購入をこの端末から失わない', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  for (let i = 0; i < 14; i++) {
    const r = await ctx.op('guest-checkout', { offer: 'analysis', code: savedRecord(variantAnswers(10 + i)).encoded_answers });
    assert.equal(r.code, 200);
    await ctx.op('guest-cancel', {});
  }
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.ok(st && st.analysis === 'active', '支払い済みの購入が残る');
  await ctx.db.close();
});

test('監査：この端末で引き継いだ結果を、ログアウトした状態で開いた：ゲストとして売り直さない（マイページで開く）', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  const token = 'tok-claimed-owner';
  await ctx.db.user({ email: 'owner@example.test', token });
  const ref = (await ctx.op('guest-status', {})).body.purchases[0].ref;
  assert.equal((await ctx.op('guest-claim', { ref }, { token })).code, 200);
  const st = (await ctx.op('guest-status', { code: CODE_A })).body;
  assert.equal(st.claimedThisResult, true);
  for (const body of [{ offer: 'analysis', code: CODE_A }, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' }]) {
    assert.deepEqual((await ctx.op('guest-checkout', body)).body.error, 'claimed', body.offer);
  }
  await ctx.db.close();
});

test('監査：反映しなかった注文（中止後の遅れた支払い）への異議申し立ては、記録だけ残して Webhook を失敗させない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const [order] = await ctx.rows('complete_orders');
  await ctx.db.sql(`update public.complete_orders set status = 'canceled' where id = $1`, [order.id]);
  const out = await ctx.db.sql(`select public.complete_apply_dispute('evt_dispute_canceled_1', now(), false, $1, 'pi_x', 'opened') as r`, [order.id]);
  assert.equal(out[0].r, 'ignored:order_not_applied');
  assert.ok(r.code === 200);
  await ctx.db.close();
});

// ================= 再監査（2026-10-14）の再発防止
test('再監査：ゲストの ¥2,000 を返金した後、別の目標で ¥2,000 を買い直せる（目標の固定を外す）', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  const cs = await guestBuy(ctx, { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  await refund(ctx, cs, 2000);
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([st.analysis, st.complete, st.canUpgrade], ['active', 'revoked', true]);
  const r = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_RELATION_01' });
  assert.deepEqual([r.code, r.body.amount], [200, 2000], JSON.stringify(r.body));
  ctx.stripe.pay(ctx.csIdOf(r.body.checkoutUrl), { customer_details: { email: 'owner@example.test' } });
  const st2 = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.equal(st2.complete, 'active');
  const [goal] = await ctx.rows('record_mentor_goals');
  assert.deepEqual([goal.goal_id, !!goal.locked_at], ['GOAL_RELATION_01', true]);
  await ctx.db.close();
});

test('再監査：ログイン中の返金の後、目標を選び直して ¥3,000・¥2,000 を買い直せる', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const d = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  await refund(ctx, d.cs, 3000);
  assert.equal((await ctx.mentor(p.token, p.sessionId, 'GOAL_EXPLORE_01')).code, 200, '固定を外して選び直せる');
  const d2 = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([d2.r.body.offer, d2.r.body.amount], ['direct_complete', 3000]);
  assert.equal((await ctx.rows('record_mentor_goals'))[0].goal_id, 'GOAL_EXPLORE_01');
  // 完全解析を持つ間は、目標は変えられない
  assert.equal((await ctx.mentor(p.token, p.sessionId, 'GOAL_PACE_01')).code, 409);
  await ctx.db.close();
});

test('再監査：反映しなかった支払いの注文は failed にして残さない（その記録で次に買える）', { skip }, async () => {
  const ctx = await setup();
  const q = await person(ctx, { email: 'q@example.test', code: CODE_B });
  const a = await payLoggedIn(ctx, q, { diagnosisSessionId: q.sessionId, product: 'analysis' });
  const up = await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId });
  // 返金の時に ¥2,000 の画面を閉じられなかった（Stripe の一時的な失敗。通常は返金の時に閉じる）：その画面で払われた時の最後の守り
  ctx.stripe.st.failures['checkout.sessions.expire'] = [Object.assign(new Error('x'), { type: 'StripeConnectionError', statusCode: 500 })];
  await refund(ctx, a.cs, 1000);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(up.body.checkoutUrl)].status, 'open');
  ctx.stripe.pay(ctx.csIdOf(up.body.checkoutUrl), {});
  await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(up.body.checkoutUrl) });
  const o = (await ctx.rows('complete_orders')).find((x) => x.offer === 'analysis_upgrade');
  assert.deepEqual([o.status, o.failure_code], ['failed', 'basis_inactive']);
  const rec = (await ctx.entitlements(q.token)).body.records[q.sessionId];
  assert.equal(rec.checkoutInProgress, false);
  assert.equal((await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId, product: 'analysis' })).code, 200, '次の申込を止めない');
  await ctx.db.close();
});

test('再監査：持ち主でない端末（他人の記録に未払いの注文だけを持つ）は、完全解析を開けない・作り直せない', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  await guestBuy(ctx, { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' });
  const owner = (await ctx.rows('complete_orders'))[0];
  await markReady(ctx, owner.diagnosis_session_id);
  // 別の端末 B の未払いの注文（以前の作りで、同じ記録に付いてしまったもの）
  const B = await guestJar(ctx, { offer: 'analysis', code: CODE_B });
  const bOrder = (await ctx.rows('complete_orders')).find((x) => x.offer === 'analysis' && x.status === 'checkout_open');
  await ctx.db.sql(`update public.complete_orders set status = 'expired', diagnosis_session_id = $1 where id = $2`, [owner.diagnosis_session_id, bOrder.id]);
  const sb = (await ctx.op('guest-status', {}, { cookie: B.jar })).body.purchases;
  for (const p of sb) {
    assert.equal((await ctx.op('guest-view', { ref: p.ref }, { cookie: B.jar })).code, 403);
    assert.equal((await ctx.op('guest-regenerate', { ref: p.ref }, { cookie: B.jar })).code, 403);
    assert.equal((await ctx.op('guest-report', { ref: p.ref }, { cookie: B.jar })).code, 403);
  }
  await ctx.db.close();
});

test('再監査：ゲストの ¥2,000 の後に ¥1,000 だけ返金：同じ記録で ¥1,000 を買い直すと、完全解析も読める', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  const a = await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  await guestBuy(ctx, { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  await refund(ctx, a, 1000);
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([st.analysis, st.complete, st.needsAnalysis], ['revoked', 'active', true]);
  const sid = (await ctx.rows('complete_orders'))[0].diagnosis_session_id;
  await markReady(ctx, sid);
  assert.deepEqual((await ctx.op('guest-view', { ref: st.ref })).body.error, 'basis_inactive');
  const r = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.deepEqual([r.code, r.body.amount], [200, 1000], JSON.stringify(r.body));
  ctx.stripe.pay(ctx.csIdOf(r.body.checkoutUrl), { customer_details: { email: 'owner@example.test' } });
  await ctx.op('guest-status', {});
  assert.equal(new Set((await ctx.rows('complete_orders')).map((o) => o.diagnosis_session_id)).size, 1, '同じ記録');
  assert.equal((await ctx.op('guest-view', { ref: st.ref })).code, 200, '完全解析も読める');
  await ctx.db.close();
});

test('再監査：解析レポートの支払いで異議申し立てに負けた記録では、¥3,000 も売らない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  const [o] = await ctx.rows('complete_orders');
  await ctx.db.sql(`select public.complete_apply_dispute('evt_dl_open', now(), false, $1, $2, 'opened')`, [o.id, o.stripe_payment_intent_id]);
  await ctx.db.sql(`select public.complete_apply_dispute('evt_dl_lost', now() + interval '1 minute', false, $1, $2, 'lost')`, [o.id, o.stripe_payment_intent_id]);
  const res = await ctx.db.fetchImpl(`${ENV.SUPABASE_URL}/rest/v1/rpc/complete_create_order`, { method: 'POST', body: JSON.stringify({
    p_user_id: p.userId, p_diagnosis_session_id: p.sessionId, p_offer: 'direct_complete', p_idempotency_key: 'co_after_dispute_lost_1' }) });
  assert.equal(res.ok, false);
  assert.match((await res.json()).message, /complete_repurchase_not_allowed|complete_mentor_goal_required/);
  await ctx.db.close();
});

test('再々監査：申込の切り替え（¥1,000 → ¥3,000 → ¥1,000）の後に支払い・返金しても、同じ記録でもう一度買える（前の注文の鍵と重ならない）', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const body = { diagnosisSessionId: p.sessionId, product: 'analysis' };
  const r1 = await ctx.checkout(p.token, body);
  assert.equal(r1.code, 200);
  const r2 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([r2.code, r2.body.amount], [200, 3000], JSON.stringify(r2.body));
  const a = await payLoggedIn(ctx, p, body);
  assert.equal(a.r.body.amount, 1000);
  await refund(ctx, a.cs, 1000);
  const again = await payLoggedIn(ctx, p, body);
  assert.equal(again.r.body.amount, 1000);
  assert.deepEqual(await rightsOf(ctx, p.sessionId), ['analysis:active', 'analysis:revoked']);
  // 期限切れの後も同じ（Stripe で期限切れになった ¥3,000 を開き直す）
  const q = await person(ctx, { email: 'q@example.test', code: CODE_B });
  const d1 = await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId });
  const e1 = await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId, product: 'analysis' });
  assert.equal(e1.code, 200);
  ctx.stripe.st.sessions[ctx.csIdOf(e1.body.checkoutUrl)].status = 'expired';
  await ctx.webhook({ type: 'checkout.session.expired', objectId: ctx.csIdOf(e1.body.checkoutUrl) });
  const d2 = await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId });
  assert.deepEqual([d2.code, d2.body.amount], [200, 3000], JSON.stringify(d2.body));
  assert.equal(d1.code, 200);
  await ctx.db.close();
});

test('再々監査：Cookie の上限を超えた時、決済中の注文の印より先に、閉じた未払いの注文の印を外す', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  const open = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.equal(open.code, 200);
  for (let i = 0; i < 14; i++) {
    const r = await ctx.op('guest-checkout', { offer: 'analysis', code: savedRecord(variantAnswers(30 + i)).encoded_answers });
    assert.equal(r.code, 200);
    // この注文だけ Stripe で期限切れ（guest-cancel はこの端末の決済中をすべて閉じるため使わない）
    const cs = ctx.csIdOf(r.body.checkoutUrl);
    ctx.stripe.st.sessions[cs].status = 'expired';
    assert.equal((await ctx.webhook({ type: 'checkout.session.expired', objectId: cs })).code, 200);
  }
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.ok(st && st.pending === true, JSON.stringify(st));
  // 決済中の注文の支払いが届けば、この端末で読める
  ctx.stripe.pay(ctx.csIdOf(open.body.checkoutUrl));
  await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(open.body.checkoutUrl) });
  const after = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.equal(after.analysis, 'active');
  await ctx.db.close();
});

// ================= 払える決済画面は、1人・1診断結果につき常に1つだけ（反映できない支払いを作らない）
const openSessions = (ctx) => Object.values(ctx.stripe.st.sessions).filter((s) => s.status === 'open');

test('1つだけ：ゲストで ¥1,000 の画面を開いたまま ¥3,000 を選ぶ → ¥1,000 の画面は Stripe で閉じ、¥3,000 を買える。逆も同じ', { skip }, async () => {
  const ctx = await setup();
  ctx.cookie = '';
  const a = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.equal(a.code, 200);
  const d = await ctx.op('guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.deepEqual([d.code, d.body.amount], [200, 3000], JSON.stringify(d.body));
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(a.body.checkoutUrl)].status, 'expired', '¥1,000 の画面では払えない');
  assert.deepEqual(openSessions(ctx).map((s) => s.id), [ctx.csIdOf(d.body.checkoutUrl)]);
  const a2 = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.deepEqual([a2.code, a2.body.amount], [200, 1000]);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(d.body.checkoutUrl)].status, 'expired');
  assert.equal(openSessions(ctx).length, 1);
  // 残った画面で払うと、そのまま反映される（反映できない支払いにならない）
  ctx.stripe.pay(ctx.csIdOf(a2.body.checkoutUrl), { customer_details: { email: 'owner@example.test' } });
  const w = await ctx.webhook({ type: 'checkout.session.completed', objectId: ctx.csIdOf(a2.body.checkoutUrl) });
  assert.equal(w.body.result, 'processed');
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.equal(st.analysis, 'active');
  assert.equal((await ctx.rows('complete_orders')).filter((o) => o.status === 'failed').length, 0, '反映しなかった支払いが無い');
  await ctx.db.close();
});

test('1つだけ：ログイン中（マイページ）の ¥3,000 の画面を開いたまま、結果ページで ¥1,000 を選ぶ → マイページの画面を閉じて ¥1,000 を買える', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx, { email: 'me@example.test' });
  const d = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.equal(d.code, 200);
  const g = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A }, { token: p.token, cookie: '' });
  assert.deepEqual([g.code, g.body.amount], [200, 1000], JSON.stringify(g.body));
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(d.body.checkoutUrl)].status, 'expired');
  assert.equal(openSessions(ctx).length, 1);
  assert.equal((await ctx.entitlements(p.token)).body.records[p.sessionId].checkoutInProgress, false);
  await ctx.db.close();
});

test('1つだけ：この端末のゲストの ¥1,000 の画面を開いたまま、マイページで ¥3,000 → ゲストの画面を閉じて ¥3,000 を買える。払い済みだった画面は反映して重ねて売らない', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx, { email: 'me@example.test' });
  ctx.cookie = '';
  const a = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.equal(a.code, 200);
  const jar = ctx.cookie;
  const mypage = async (body) => {
    const res = { code: 0, headers: {}, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
    await Checkout.createHandler({ env: ctx.env, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null })(
      { method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${p.token}`, cookie: jar }, body }, res);
    return res;
  };
  const d = await mypage({ diagnosisSessionId: p.sessionId });
  assert.deepEqual([d.code, d.body.amount], [200, 3000], JSON.stringify(d.body));
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(a.body.checkoutUrl)].status, 'expired');
  // 別の端末の画面ではなく、この端末のゲストの画面で先に払っていた：反映して、¥3,000 を重ねて売らない
  ctx.cookie = '';
  const b = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  const jar2 = ctx.cookie;
  ctx.stripe.pay(ctx.csIdOf(b.body.checkoutUrl), { customer_details: { email: 'other@example.test' } });
  const res = { code: 0, headers: {}, body: null, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, setHeader() {} };
  await Checkout.createHandler({ env: ctx.env, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null })(
    { method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${p.token}`, cookie: jar2 }, body: { diagnosisSessionId: p.sessionId, product: 'analysis' } }, res);
  assert.deepEqual([res.code, res.body.error], [409, 'purchase_completed']);
  const paid = (await ctx.rows('complete_orders')).filter((o) => o.status === 'paid');
  assert.equal(paid.length, 1, '払った画面は反映した');
  await ctx.db.close();
});

test('1つだけ：¥1,000 の返金・異議申し立てで、開いたままの追加 ¥2,000 の画面を閉じる（根拠の無い ¥2,000 を払わせない）', { skip }, async () => {
  for (const kind of ['refund', 'dispute']) {
    const ctx = await setup();
    const p = await person(ctx);
    const a = await payLoggedIn(ctx, p, { diagnosisSessionId: p.sessionId, product: 'analysis' });
    const u = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
    assert.deepEqual([u.code, u.body.amount], [200, 2000]);
    if (kind === 'refund') await refund(ctx, a.cs, 1000);
    else {
      const ch = await chargeOf(ctx, a.cs);
      const du = ctx.stripe.dispute(ch);
      assert.equal((await ctx.webhook({ type: 'charge.dispute.created', objectId: du })).code, 200);
    }
    assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(u.body.checkoutUrl)].status, 'expired', kind);
    assert.equal(openSessions(ctx).length, 0, kind);
    await ctx.db.close();
  }
});

test('決済画面の期限：注文の作成から 35 分（24 時間の画面を作らない）。同じ注文の再試行は同じ画面を受け取る', { skip }, async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, product: 'analysis' });
  assert.equal(r.code, 200);
  const o = (await ctx.rows('complete_orders')).find((x) => x.user_id === p.userId);
  const exp = ctx.stripe.st.lastCreate.params.expires_at;
  assert.equal(exp, Math.floor(Date.parse(o.created_at) / 1000) + 35 * 60);
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(r.body.checkoutUrl)].expires_at, exp);
  ctx.cookie = '';
  const g = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_B });
  assert.equal(g.code, 200);
  const go = (await ctx.rows('complete_orders')).find((x) => x.stripe_checkout_session_id === ctx.csIdOf(g.body.checkoutUrl));
  assert.equal(ctx.stripe.st.lastCreate.params.expires_at, Math.floor(Date.parse(go.created_at) / 1000) + 35 * 60);
  await ctx.db.close();
});
