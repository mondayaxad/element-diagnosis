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

// ================= G2：ゲスト注文・引き継ぎ・キャンセル（C2・C3・C5・D2・D3）
async function guestBuy(ctx, body, email = 'owner@example.test') {
  const r = await ctx.op('guest-checkout', body);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  ctx.stripe.pay(cs, { customer_details: { email } });
  await ctx.op('guest-status', {});
  return cs;
}

test('C2：¥1,000 の後に ¥2,000 を始めて中止・放置しても、支払済みの注文で引き継げる（同じ秘密値の再実行は冪等）', { skip }, async () => {
  const ctx = await setup();
  await guestBuy(ctx, { offer: 'analysis', code: CODE_A });
  // ¥2,000 を始めて中止（Stripe の画面で戻る）→ もう一度始めて放置（開いたまま）
  const up1 = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal(up1.code, 200);
  assert.deepEqual((await ctx.op('guest-cancel', {})).body, { closed: 1, paid: 0 });
  const up2 = await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  assert.equal(up2.code, 200);
  const st = (await ctx.op('guest-status', { code: CODE_A })).body.purchases.find((x) => x.thisRecord);
  assert.deepEqual([st.canClaim, st.pending], [true, true], '決済待ちがあっても引き継ぎを出す');
  const token = 'tok-owner-c2';
  const userId = await ctx.db.user({ email: 'owner@example.test', token });
  const c = await ctx.op('guest-claim', { ref: st.ref }, { token });
  assert.deepEqual([c.code, c.body], [200, { result: 'claimed' }]);
  // 放置した ¥2,000 の画面は閉じ、注文は期限切れ。権利は解析だけ（重複なし）
  assert.equal(ctx.stripe.st.sessions[ctx.csIdOf(up2.body.checkoutUrl)].status, 'expired');
  const orders = await ctx.rows('complete_orders');
  assert.deepEqual(orders.map((o) => `${o.offer}:${o.status}`).sort(), ['analysis:paid', 'analysis_upgrade:expired', 'analysis_upgrade:expired']);
  assert.ok(orders.every((o) => o.user_id === userId));
  const sid = orders[0].diagnosis_session_id;
  assert.deepEqual(await rightsOf(ctx, sid), ['analysis:active']);
  // マイページで ¥2,000 へ進める
  assert.equal((await ctx.entitlements(token)).body.records[sid].completeOffer, 'analysis_upgrade');
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
  const again = await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A });
  assert.equal(again.code, 409);
  assert.equal((await ctx.rows('complete_orders')).filter((o) => o.status === 'paid').length, 1);
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
  await ctx.op('guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: 'GOAL_PACE_01' });
  ctx.cookie = '';
  const nowSec = Math.floor(Date.now() / 1000);
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const otp = `${b({ alg: 'HS256' })}.${b({ sub: 'x', amr: [{ method: 'otp', timestamp: nowSec - 20 }] })}.sig`;
  const owner = await ctx.db.user({ email: 'owner@example.test', token: otp });
  const r = await ctx.op('guest-recover', {}, { token: otp });
  assert.deepEqual([r.code, r.body], [200, { claimed: 1, skipped: 0 }]);
  assert.ok((await ctx.rows('diagnosis_sessions')).every((s) => s.user_id === owner));
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
  assert.deepEqual([rec.completeEntitlement, rec.repurchaseBlocked, rec.completeOffer], ['revoked', true, null]);
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

test('旧 ¥1,000：運営者が停止すると旧形式リンク・マイページとも閲覧不可、復帰で戻る。取消は最終。API のロールは操作できない', { skip }, async () => {
  const ctx = await setup();
  const code = 'CODE_LEGACY_BLOCK';
  const p = await person(ctx, { email: 'buyer@example.test', code });
  const legacyCs = ctx.stripe.legacySession({ email: 'buyer@example.test' });
  await ctx.db.legacy({ code, stripeSessionId: legacyCs });
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
  assert.deepEqual([rec.legacyPurchasePending, rec.completeOffer], [false, 'direct_complete']);
  // DB も停止中の旧購入を ¥2,000 の根拠に数えない
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
  assert.equal((await ctx.op('guest-regenerate', { ref: st.ref })).code, 403);
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
