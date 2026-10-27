// Production 相当の設定から STRIPE_COMPLETE_PRICE_UPGRADE を外した回帰試験（2026-10-27）。
//   追加 ¥2,000（upgrade／analysis_upgrade）は廃止済み（complete_13）で、Production には STRIPE_COMPLETE_PRICE_UPGRADE を設定しない。
//   その状態でも、現行の申込（解析レポート ¥1,000・完全解析 ¥3,000）が通り、廃止した経路は従来どおり拒否されることを確かめる。
//   すべて偽物（偽の鍵・偽の Stripe・ローカル DB）。環境変数・Stripe・既存コードには触れない。
//   本物の SQL 関数（complete_01〜13）が必要：COMPLETE_DB_BACKEND=<createBackend を返すモジュール> と PGT_HOST を指定して実行する。
//   指定が無い時は skip する。COMPLETE_DB_STRIPE_MODE=live で本番の構成（Stripe Live・prod_01〜04b の DB）。既定は Preview の構成。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PREVIEW_ENV, PROD_ENV } = require('./fixtures/server_env');
const { fakeStripe } = require('./fixtures/fake_stripe');
const { createFakeStorage } = require('./fixtures/fake_storage');
const { savedRecord } = require('./fixtures/report_data');
const CP = require('../lib/complete-payment');

const BACKEND = process.env.COMPLETE_DB_BACKEND;
const skip = BACKEND ? false : 'COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip';
const Checkout = require('../api/complete-checkout.js');

const LIVE = process.env.COMPLETE_DB_STRIPE_MODE === 'live';
const MODE = LIVE ? 'live' : 'test';
const ORIGIN = LIVE ? 'https://element-diagnosis-five.vercel.app' : 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const ANALYSIS = `price_${MODE}_analysis1000`;
const DIRECT = `price_${MODE}_direct3000`;
const UPGRADE = `price_${MODE}_upgrade2000`;
const GOAL = 'GOAL_PACE_01';

// STRIPE_COMPLETE_PRICE_UPGRADE を持たない設定（Production の実際の構成）
const ENV = {
  ...(LIVE ? PROD_ENV : PREVIEW_ENV),
  COMPLETE_SALES_OPEN: 'true',
  COMPLETE_CHECKOUT_ORIGIN: ORIGIN,
  STRIPE_PRICE_ANALYSIS: ANALYSIS,
  STRIPE_COMPLETE_PRICE_DIRECT: DIRECT,
  STRIPE_COMPLETE_WEBHOOK_SECRET: 'whsec_test_fake_secret_for_unit_tests',
  COMPLETE_VIEW_TOKEN_SECRET: crypto.randomBytes(32).toString('base64url'),
};
delete ENV.STRIPE_COMPLETE_PRICE_UPGRADE;
// Stripe 側には ¥2,000 の Price を用意しない（用意しても使われないことではなく、無くても動くことを確かめる）
const PRICES = {
  [ANALYSIS]: { id: ANALYSIS, active: true, livemode: LIVE, currency: 'jpy', unit_amount: 1000, type: 'one_time' },
  [DIRECT]: { id: DIRECT, active: true, livemode: LIVE, currency: 'jpy', unit_amount: 3000, type: 'one_time' },
};
const CODE_A = savedRecord().encoded_answers;
const attemptId = () => crypto.randomBytes(18).toString('base64url');

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
const logger = { error() {}, warn() {}, log() {}, info() {} };

const OPEN = [];
test.afterEach(async () => {
  while (OPEN.length) {
    const db = OPEN.pop();
    if (!db.__closed) await db.close().catch(() => {});
  }
});

async function setup() {
  const db = await require(BACKEND).createBackend();
  const close0 = db.close.bind(db);
  db.close = async () => { if (db.__closed) return; db.__closed = true; await close0(); };
  OPEN.push(db);
  const storage = createFakeStorage();
  const stripe = fakeStripe({ prices: JSON.parse(JSON.stringify(PRICES)), livemode: LIVE });
  // 公開の関数と同じ作り方（retiredRoutesForTests なし）
  const handler = Checkout.createHandler({ env: ENV, fetchImpl: storage.wrap(db.fetchImpl), stripeFactory: stripe.factory, logger, waitUntil: () => {} });
  let cookie = '';
  const ctx = {
    db, stripe,
    async op(op, body, { token, noCookie } = {}) {
      const res = makeRes();
      const headers = { host: 'evil.example' };
      if (!noCookie && cookie) headers.cookie = cookie;
      if (token) headers.authorization = `Bearer ${token}`;
      await handler({ method: 'POST', headers, query: op ? { op } : {}, body }, res);
      const set = res.headers['set-cookie'];
      if (set && !noCookie) cookie = set.split(';')[0];
      return res;
    },
    created() { return ctx.stripe.st.calls.filter((c) => c === 'checkout.sessions.create').length; },
  };
  return ctx;
}
async function resultContext(ctx) {
  const resume = crypto.randomBytes(32).toString('base64url');
  const r = await ctx.op('result-link', { code: CODE_A, token: resume }, { noCookie: true });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const c = await ctx.op('buy-context', { resume }, { noCookie: true });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  return c.body.context;
}
const priceOf = (ctx, checkoutUrl) => {
  const s = ctx.stripe.st.sessions[checkoutUrl.split('/').pop()];
  return { priceId: s.line_items.data[0].price.id, amount: s.amount_total, livemode: s.livemode };
};

test('前提：この試験の設定には STRIPE_COMPLETE_PRICE_UPGRADE が無く、Stripe にも ¥2,000 の Price が無い', () => {
  assert.equal('STRIPE_COMPLETE_PRICE_UPGRADE' in ENV, false);
  assert.equal(CP.priceIdFor(ENV, 'analysis_upgrade'), null, '¥2,000 の Price は解決できない');
  assert.equal(CP.priceIdFor(ENV, 'analysis'), ANALYSIS);
  assert.equal(CP.priceIdFor(ENV, 'direct_complete'), DIRECT);
  assert.equal(PRICES[UPGRADE], undefined);
  if (LIVE) assert.equal(ENV.STRIPE_MODE, 'live', 'Production 相当（Stripe Live）');
});

test('UPGRADE なし：解析レポート ¥1,000 の Checkout が作れる（¥1,000 の Price・解析レポートだけ）', { skip }, async () => {
  const ctx = await setup();
  const context = await resultContext(ctx);
  const r = await ctx.op('buy', { context, product: 'analysis', attempt: attemptId(), source: 'result' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.match(r.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  assert.deepEqual(priceOf(ctx, r.body.checkoutUrl), { priceId: ANALYSIS, amount: 1000, livemode: LIVE });
  assert.equal(ctx.created(), 1);
  const orders = await ctx.db.rows('complete_orders');
  assert.deepEqual(orders.map((o) => `${o.offer}:${o.amount}:${o.status}`), ['analysis:1000:checkout_open']);
  await ctx.db.close();
});

test('UPGRADE なし：完全解析 ¥3,000 の Checkout が作れる（¥3,000 の Price・目標が必須）', { skip }, async () => {
  const ctx = await setup();
  const context = await resultContext(ctx);
  const noGoal = await ctx.op('buy', { context, product: 'complete', attempt: attemptId(), source: 'result' });
  assert.deepEqual([noGoal.code, noGoal.body.error], [400, 'mentor_goal_required']);
  assert.equal(ctx.created(), 0);
  const r = await ctx.op('buy', { context, product: 'complete', goal: GOAL, attempt: attemptId(), source: 'result' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.match(r.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  assert.deepEqual(priceOf(ctx, r.body.checkoutUrl), { priceId: DIRECT, amount: 3000, livemode: LIVE });
  assert.equal(ctx.created(), 1);
  const orders = await ctx.db.rows('complete_orders');
  assert.deepEqual(orders.map((o) => `${o.offer}:${o.amount}:${o.status}`), ['direct_complete:3000:checkout_open']);
  await ctx.db.close();
});

test('UPGRADE なし：upgrade・analysis_upgrade は従来どおり offer_retired（400）で、決済画面も注文も作らない', { skip }, async () => {
  const ctx = await setup();
  const context = await resultContext(ctx);
  for (const product of ['upgrade', 'analysis_upgrade']) {
    for (const goal of [undefined, GOAL]) {
      const body = { context, product, attempt: attemptId(), source: 'result' };
      if (goal) body.goal = goal;
      const r = await ctx.op('buy', body);
      assert.deepEqual([r.code, r.body], [400, { error: 'offer_retired' }], `${product} goal=${goal}`);
    }
  }
  assert.equal(ctx.created(), 0, 'Stripe の決済画面を作らない');
  assert.deepEqual(await ctx.db.rows('complete_orders'), [], '注文を作らない');
  await ctx.db.close();
});

test('UPGRADE なし：旧ゲスト経路・旧引き継ぎ・マイページの旧 Checkout は 410 のまま（設定不足の 503 にならない）', { skip }, async () => {
  const ctx = await setup();
  const context = await resultContext(ctx);
  // 設定が揃っていない時の 503 ではなく、廃止の 410 が先に返る（UPGRADE の有無に左右されない）
  const cases = [
    ['guest-checkout', { offer: 'analysis', code: CODE_A }, 'checkout_retired'],
    ['guest-checkout', { offer: 'direct_complete', code: CODE_A, goal: GOAL }, 'checkout_retired'],
    ['guest-checkout', { offer: 'analysis_upgrade', code: CODE_A, goal: GOAL }, 'checkout_retired'],
    ['guest-claim', { ref: 'x' }, 'transfer_retired'],
    ['guest-recover', {}, 'transfer_retired'],
    ['legacy-verify', {}, 'legacy_verification_retired'],
  ];
  for (const [op, body, error] of cases) {
    const r = await ctx.op(op, body, { token: 'tok' });
    assert.deepEqual([r.code, r.body.error], [410, error], op + ' ' + JSON.stringify(body));
  }
  // op なし（マイページの旧 Checkout：diagnosisSessionId だけ）
  const legacy = await ctx.op(undefined, { diagnosisSessionId: crypto.randomUUID() }, { token: 'tok' });
  assert.deepEqual([legacy.code, legacy.body.error], [410, 'checkout_retired']);
  assert.equal(ctx.created(), 0);
  assert.deepEqual(await ctx.db.rows('complete_orders'), []);
  // 同じ設定で、現行の申込は通る（旧経路を塞いだ結果、現行の経路まで塞がっていない）
  const ok = await ctx.op('buy', { context, product: 'analysis', attempt: attemptId(), source: 'result' });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  await ctx.db.close();
});
