// 完全解析の決済 API（api/complete-checkout.js・api/stripe-webhook.js・api/complete-status.js）と lib/complete-payment.js のテスト。
// 外部へは接続しない（偽の Stripe・偽の Supabase）。
//   実行: node --test tests/complete_payment_api.test.js
//   DB の模型の代わりに本物の SQL 関数で試す場合：COMPLETE_DB_BACKEND=<createBackend を返すモジュール> を指定する
//   （ローカル PG17 に complete_01〜05 を適用した DB へ PostgREST 相当の要求を送る試験用の部品。リポジトリには含めない）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PREVIEW_ENV, PROD_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest, stripeError } = require('./fixtures/fake_stripe');
const { createMemoryBackend } = require('./fixtures/fake_supabase');
const CP = require('../lib/complete-payment');
const CE = require('../lib/complete-eligibility');
const Checkout = require(path.join(__dirname, '..', 'api', 'complete-checkout.js'));
const Webhook = require(path.join(__dirname, '..', 'api', 'stripe-webhook.js'));
const Status = require(path.join(__dirname, '..', 'api', 'complete-status.js'));
const { computeMaterials } = require('../scripts/complete-materials');

const createBackend = process.env.COMPLETE_DB_BACKEND ? require(process.env.COMPLETE_DB_BACKEND).createBackend : createMemoryBackend;

const SECRET = 'whsec_test_fake_secret_for_unit_tests';
const ORIGIN = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const SALES_ENV = {
  ...PREVIEW_ENV,
  COMPLETE_SALES_OPEN: 'true',
  COMPLETE_CHECKOUT_ORIGIN: ORIGIN,
  STRIPE_COMPLETE_PRICE_DIRECT: 'price_test_direct3000',
  STRIPE_COMPLETE_PRICE_UPGRADE: 'price_test_upgrade2000',
  STRIPE_PRICE_ANALYSIS: 'price_test_analysis1000',
  STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET,
  COMPLETE_VIEW_TOKEN_SECRET: 'x'.repeat(43),
};
const PRICES = {
  price_test_direct3000: { id: 'price_test_direct3000', active: true, livemode: false, currency: 'jpy', unit_amount: 3000, type: 'one_time' },
  price_test_upgrade2000: { id: 'price_test_upgrade2000', active: true, livemode: false, currency: 'jpy', unit_amount: 2000, type: 'one_time' },
  price_test_analysis1000: { id: 'price_test_analysis1000', active: true, livemode: false, currency: 'jpy', unit_amount: 1000, type: 'one_time' },
};

function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
function makeLogger() {
  const lines = [];
  const push = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return { lines, error: push, warn: push, log: push, info: push };
}

async function setup({ env = {}, prices = PRICES } = {}) {
  const db = await createBackend();
  const stripe = fakeStripe({ prices: JSON.parse(JSON.stringify(prices)) });
  const logger = makeLogger();
  const fullEnv = { ...SALES_ENV, ...env };
  // 生成・保存・閲覧は tests/complete_report_job.test.js で試す。ここでは後段の生成を起動しない（試験の後まで走り続けないように）
  const deps = { env: fullEnv, fetchImpl: db.fetchImpl, stripeFactory: stripe.factory, logger, waitUntil: null };
  const checkoutH = Checkout.createHandler(deps);
  const webhookH = Webhook.createHandler(deps);
  const statusH = Status.createHandler({ env: fullEnv, fetchImpl: db.fetchImpl, logger, waitUntil: null });
  const ctx = {
    db, stripe, logger, env: fullEnv,
    async checkout(token, body, { headers = {}, method = 'POST' } = {}) {
      const res = makeRes();
      await checkoutH({ method, headers: { host: 'evil.example', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body }, res);
      return res;
    },
    async status(token, sessionId, { method = 'GET' } = {}) {
      const res = makeRes();
      await statusH({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, query: sessionId === undefined ? {} : { diagnosisSessionId: sessionId } }, res);
      return res;
    },
    async webhook(opts) {
      const { req, event } = eventRequest({ secret: SECRET, ...opts });
      const res = makeRes();
      await webhookH(req, res);
      res.event = event;
      return res;
    },
    async webhookRaw(req) {
      const res = makeRes();
      await webhookH(req, res);
      return res;
    },
    async order(sessionId) {
      return (await db.rows('complete_orders')).filter((o) => o.diagnosis_session_id === sessionId);
    },
    async state(sessionId) {
      const [orders, rights, reports, goals] = await Promise.all(['complete_orders', 'record_entitlements', 'complete_reports', 'record_mentor_goals'].map((tb) => db.rows(tb)));
      const o = orders.filter((x) => x.diagnosis_session_id === sessionId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      if (!o) return 'none';
      const ent = rights.filter((e) => e.source_order_id === o.id).map((e) => `${e.right_type}:${e.status}`).sort().join(',') || 'none';
      const rep = reports.filter((r) => r.source_order_id === o.id).map((r) => r.status).join(',') || 'none';
      const g = goals.find((x) => x.diagnosis_session_id === sessionId);
      return `${o.status}|lock=${!!(g && g.locked_at)}|ent=${ent}|rep=${rep}`;
    },
  };
  return ctx;
}

// 本人・記録を作る
async function person(ctx, { email = 'buyer@example.test', confirmed = true, onboarding = 'completed', goal = 'GOAL_PACE_01', code, versions } = {}) {
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  const userId = await ctx.db.user({ email, confirmed, onboarding, token });
  const sessionId = await ctx.db.record({ userId, goal, code, versions });
  return { token, userId, sessionId };
}

// Checkout を開き、Stripe 側で支払いを完了させる
async function openAndPay(ctx, p) {
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const csId = r.body.checkoutUrl.split('/').pop();
  const paid = ctx.stripe.pay(csId);
  return { csId, ...paid };
}

const FORBIDDEN = (ctx, extra = []) => [/@/, /cs_test_/, /pi_[A-Za-z0-9]/, /ch_[A-Za-z0-9]/, /du_[A-Za-z0-9]/, /evt_/, /whsec_/, /sk_test_/, /CODE_/, /price_test_/,
  /stripe-signature/i, /t=\d+,v1=/, ...extra];

function assertNoForbidden(text, patterns, label) {
  for (const p of patterns) assert.doesNotMatch(text, p, `${label} に禁止情報（${p}）`);
}

// ================= Webhook のイベント名（Stripe で選ぶイベント＝実装したハンドラー＝SQL の記録の種類）
test('Webhook：処理するイベントは5つだけで、一覧（CP.HANDLED_EVENTS）とハンドラーの名前が完全に一致する', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'api', 'stripe-webhook.js'), 'utf8');
  const block = src.slice(src.indexOf('const HANDLERS = {'), src.indexOf('};', src.indexOf('const HANDLERS = {')));
  const keys = [...block.matchAll(/'([a-z_.]+)':/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), [...CP.HANDLED_EVENTS].sort());
  assert.deepEqual([...CP.HANDLED_EVENTS].sort(), ['charge.dispute.closed', 'charge.dispute.created', 'charge.refunded', 'checkout.session.completed', 'checkout.session.expired']);
});

// ================= lib/complete-payment.js
test('署名：正しい本文だけ通る（1バイト変更・署名なし・形式違反・古い／未来の時刻・別の secret を拒否）', () => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_test_123456789', type: 'checkout.session.completed' }));
  const t = 1_800_000_000;
  const header = CP.signPayload(body, SECRET, t);
  assert.deepEqual(CP.verifyStripeSignature(body, header, SECRET, t), { ok: true, timestamp: t });
  const changed = Buffer.from(body); changed[changed.length - 2] ^= 1;
  assert.equal(CP.verifyStripeSignature(changed, header, SECRET, t).reason, 'signature_mismatch');
  assert.equal(CP.verifyStripeSignature(Buffer.concat([body, Buffer.from(' ')]), header, SECRET, t).reason, 'signature_mismatch');
  assert.equal(CP.verifyStripeSignature(body, undefined, SECRET, t).reason, 'signature_missing');
  assert.equal(CP.verifyStripeSignature(body, 'v1=abc', SECRET, t).reason, 'signature_malformed');
  assert.equal(CP.verifyStripeSignature(body, header, SECRET, t + 301).reason, 'timestamp_out_of_range');
  assert.equal(CP.verifyStripeSignature(body, header, SECRET, t - 301).reason, 'timestamp_out_of_range');
  assert.equal(CP.verifyStripeSignature(body, header, SECRET, t + 300).ok, true);
  assert.equal(CP.verifyStripeSignature(body, CP.signPayload(body, 'whsec_other_secret', t), SECRET, t).reason, 'signature_mismatch');
  assert.equal(CP.verifyStripeSignature(body, header, '', t).reason, 'secret_missing');
  // 複数の v1（鍵の切り替え中）は、どれか1つが一致すれば通る
  const multi = `t=${t},v1=${'0'.repeat(64)},${header.split(',')[1]}`;
  assert.equal(CP.verifyStripeSignature(body, multi, SECRET, t).ok, true);
  assert.equal(CP.verifyStripeSignature(body.toString('utf8'), header, SECRET, t).reason, 'body_invalid');
});

test('Price の照合：有効・JPY・金額・Test・一回払い', () => {
  const ok = PRICES.price_test_direct3000;
  assert.equal(CP.priceProblem(ok, 'direct_complete'), null);
  assert.equal(CP.priceProblem(PRICES.price_test_upgrade2000, 'analysis_upgrade'), null);
  assert.equal(CP.priceProblem({ ...ok, active: false }, 'direct_complete'), 'price_inactive');
  assert.equal(CP.priceProblem({ ...ok, livemode: true }, 'direct_complete'), 'price_livemode');
  assert.equal(CP.priceProblem({ ...ok, currency: 'usd' }, 'direct_complete'), 'price_currency');
  assert.equal(CP.priceProblem({ ...ok, unit_amount: 2500 }, 'direct_complete'), 'price_amount');
  assert.equal(CP.priceProblem(ok, 'analysis_upgrade'), 'price_amount');
  assert.equal(CP.priceProblem({ ...ok, type: 'recurring' }, 'direct_complete'), 'price_type');
  assert.equal(CP.priceProblem(null, 'direct_complete'), 'price_missing');
});

test('戻り先 URL：https の origin だけ・Preview で許可した固定 origin と一致しなければ閉じる・販売の開始は文字列 true だけ', () => {
  assert.deepEqual(CP.PREVIEW_CHECKOUT_ORIGINS, [ORIGIN]);
  assert.deepEqual(CP.checkoutReturnUrls({ COMPLETE_CHECKOUT_ORIGIN: ORIGIN }), {
    successUrl: `${ORIGIN}/mypage.html?complete=returned`, cancelUrl: `${ORIGIN}/mypage.html?complete=canceled`,
  });
  const host = ORIGIN.slice('https://'.length);
  for (const bad of [undefined, '', null, 123,
    `http://${host}`, `${ORIGIN}/`, `${ORIGIN}/mypage.html`, `${ORIGIN}/x/y`, `${ORIGIN}?x=1`, `${ORIGIN}#frag`, `${ORIGIN}:443`, `${ORIGIN}:8443`,
    `https://user@${host}`, `https://user:pass@${host}`, ` ${ORIGIN}`, `${ORIGIN} `, ORIGIN.toUpperCase(),
    `https://evil.example`, `https://${host}.evil.example`, `https://evil-${host}`, 'https://element-diagnosis-five.vercel.app',
    'https://element-diagnosis-17h4gth5n-nmkw0322-4497s-projects.vercel.app', 'javascript:alert(1)', 'https://localhost']) {
    assert.equal(CP.checkoutReturnUrls({ COMPLETE_CHECKOUT_ORIGIN: bad }), null, String(bad));
  }
  // origin の形式検査（許可リストとは別）
  assert.equal(CP.strictHttpsOrigin('https://a.example'), 'https://a.example');
  for (const bad of ['https://a.example/', 'https://u@a.example', 'https://a.example:444', 'https://a.example?q', 'https://a.example#f', 'https://a.example/p', 'http://a.example']) {
    assert.equal(CP.strictHttpsOrigin(bad), null, bad);
  }
  assert.equal(CP.salesOpen({ COMPLETE_SALES_OPEN: 'true' }), true);
  for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) assert.equal(CP.salesOpen({ COMPLETE_SALES_OPEN: v }), false, String(v));
});

test('Stripe の決済画面の URL：https・checkout.stripe.com・userinfo／port なしだけ', () => {
  assert.equal(CP.isStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_abc#fid'), true);
  for (const bad of [undefined, '', 'http://checkout.stripe.com/c/pay/x', 'https://checkout.stripe.com.evil.example/c/pay/x', 'https://evil.example/checkout.stripe.com/',
    'https://user@checkout.stripe.com/c/pay/x', 'https://checkout.stripe.com:8443/c/pay/x', 'https://pay.stripe.com/x', 'javascript:alert(1)', `https://checkout.stripe.com/${'a'.repeat(3000)}`]) {
    assert.equal(CP.isStripeCheckoutUrl(bad), false, String(bad));
  }
});

test('metadata は order_id・app・env の3つだけを完全解析の注文として認める', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(CP.checkoutMetadataOf({ metadata: { order_id: id, app: CP.APP, env: 'preview' } }, 'preview'), { ok: true, orderId: id });
  assert.equal(CP.checkoutMetadataOf({ metadata: {} }, 'preview'), null);
  assert.equal(CP.checkoutMetadataOf({ metadata: { app: 'other' } }, 'preview'), null);
  assert.deepEqual(CP.checkoutMetadataOf({ metadata: { order_id: id, app: CP.APP, env: 'production' } }, 'preview'), { ok: false });
  assert.deepEqual(CP.checkoutMetadataOf({ metadata: { order_id: id, app: CP.APP, env: 'preview', email: 'x' } }, 'preview'), { ok: false });
  assert.deepEqual(CP.checkoutMetadataOf({ metadata: { order_id: 'nope', app: CP.APP, env: 'preview' } }, 'preview'), { ok: false });
});

test('生成素材のハッシュは素材ファイルと一致（lib/complete-materials.json が最新）・入力ハッシュは保存済みの値から決まる', () => {
  const fresh = computeMaterials();
  assert.deepEqual(CP.MATERIALS, fresh);
  assert.match(CP.MATERIALS.contentSha256, /^[0-9a-f]{64}$/);
  assert.match(CP.MATERIALS.templateSha256, /^[0-9a-f]{64}$/);
  const base = { encodedAnswers: 'CODE_A', result: { ...CE.RC1_REQUIRED_VERSIONS }, mentorGoalCatalogVersion: CE.MENTOR_CATALOG_VERSION, mentorGoalId: 'GOAL_PACE_01', diagnosedDate: '2026-10-04' };
  const h = CP.inputSha256(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(CP.inputSha256({ ...base }), h);
  assert.notEqual(CP.inputSha256({ ...base, mentorGoalId: 'GOAL_VISIBLE_01' }), h);
  assert.notEqual(CP.inputSha256({ ...base, encodedAnswers: 'CODE_B' }), h);
  assert.notEqual(CP.inputSha256({ ...base, result: { ...base.result, mirror_model_version: 'ETI-MIRROR-2.0.2' } }), h);
  assert.notEqual(CP.inputSha256({ ...base, diagnosedDate: '2026-10-05' }), h);
  // 診断日は日本時間の日付
  assert.equal(CP.jstDate('2026-10-03T15:00:00.000Z'), '2026-10-04');
  assert.equal(CP.jstDate('2026-10-03T14:59:59.999Z'), '2026-10-03');
  assert.equal(CP.jstDate('not a date'), null);
});

test('Stripe の例外の分類：通信・5xx・429・処理中の冪等キーは一時的', () => {
  assert.equal(CP.classifyStripeError(stripeError('StripeConnectionError', 0)), 'transient');
  assert.equal(CP.classifyStripeError(stripeError('StripeAPIError', 500)), 'transient');
  assert.equal(CP.classifyStripeError(stripeError('StripeRateLimitError', 429)), 'transient');
  assert.equal(CP.classifyStripeError(stripeError('StripeIdempotencyError', 409, 'idempotency_error')), 'transient');
  assert.equal(CP.classifyStripeError(stripeError('StripeInvalidRequestError', 404, 'resource_missing')), 'missing');
  assert.equal(CP.classifyStripeError(stripeError('StripeInvalidRequestError', 400, 'parameter_invalid')), 'permanent');
  assert.equal(CP.classifyStripeError(stripeError('StripeAuthenticationError', 401)), 'permanent');
});

// ================= 環境・販売の開始
test('Production（販売停止中）は Checkout が 503 sales_closed・ゲストの Checkout も 503（外部へ接続しない）', async () => {
  const env = { ...PROD_ENV, STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET };
  const calls = [];
  const stripe = fakeStripe({ prices: PRICES });
  const deps = { env, fetchImpl: async (u) => { calls.push(u); throw new Error('no network'); }, stripeFactory: stripe.factory, logger: makeLogger() };
  for (const req of [
    { method: 'POST', headers: { authorization: 'Bearer x' }, body: { diagnosisSessionId: '11111111-1111-4111-8111-111111111111' } },
    { method: 'POST', headers: {}, query: { op: 'guest-checkout' }, body: { offer: 'analysis', code: 'abcdefgh12' } },
  ]) {
    const res = makeRes();
    await Checkout.createHandler(deps)(req, res);
    assert.equal(res.code, 503);
    assert.deepEqual(res.body, { error: 'sales_closed' });
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(stripe.st.calls, []);
});

test('Production の Ref・Stripe モードの取り違えと環境不明では Checkout・Webhook・状態確認は 404（外部へ接続しない）', async () => {
  for (const env of [{ ...PROD_ENV, COMPLETE_SALES_OPEN: 'true', STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET, SUPABASE_PRODUCTION_PROJECT_REF: undefined },
    { ...SALES_ENV, VERCEL_ENV: undefined }, { ...SALES_ENV, VERCEL_ENV: 'development' }]) {
    const calls = [];
    const stripe = fakeStripe({ prices: PRICES });
    const deps = { env, fetchImpl: async (u) => { calls.push(u); throw new Error('no network'); }, stripeFactory: stripe.factory, logger: makeLogger() };
    for (const [h, req] of [
      [Checkout.createHandler(deps), { method: 'POST', headers: { authorization: 'Bearer x' }, body: { diagnosisSessionId: '11111111-1111-4111-8111-111111111111' } }],
      [Status.createHandler(deps), { method: 'GET', headers: { authorization: 'Bearer x' }, query: { diagnosisSessionId: '11111111-1111-4111-8111-111111111111' } }],
      [Webhook.createHandler(deps), eventRequest({ type: 'checkout.session.completed', objectId: 'cs_test_abcdefghij', secret: SECRET }).req],
    ]) {
      const res = makeRes();
      await h(req, res);
      // 環境不明は 404、Production の設定の取り違えは環境ガードが 503（どちらも外部へ接続しない・fail-closed）
      if (env.VERCEL_ENV === 'production') {
        assert.equal(res.code, 503, `${env.VERCEL_ENV}`);
        assert.equal(res.body.error, 'service_unavailable');
      } else {
        assert.equal(res.code, 404, `${env.VERCEL_ENV}`);
        assert.deepEqual(res.body, { error: 'not_available' });
      }
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(stripe.st.calls, []);
  }
});

test('販売を閉じている（未設定・false・TRUE）と Checkout は 503 sales_closed（認証・Stripe・DB に接続しない）', async () => {
  for (const v of [undefined, 'false', 'TRUE', '']) {
    const ctx = await setup({ env: { COMPLETE_SALES_OPEN: v } });
    const p = await person(ctx);
    const before = ctx.db.calls ? ctx.db.calls.length : 0;
    const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
    assert.equal(r.code, 503);
    assert.deepEqual(r.body, { error: 'sales_closed' });
    if (ctx.db.calls) assert.equal(ctx.db.calls.length, before);
    assert.deepEqual(ctx.stripe.st.calls, []);
    await ctx.db.close();
  }
});

test('設定不足（戻り先・Price）は 503（fail-closed）', async () => {
  for (const env of [{ COMPLETE_CHECKOUT_ORIGIN: undefined }, { COMPLETE_CHECKOUT_ORIGIN: 'http://x.example' }, { STRIPE_COMPLETE_PRICE_DIRECT: undefined },
    { STRIPE_COMPLETE_PRICE_UPGRADE: 'not-a-price' }, { STRIPE_MODE: 'live' }, { STRIPE_SECRET_KEY: 'sk_live_fake' }]) {
    const ctx = await setup({ env });
    const p = await person(ctx);
    const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
    assert.equal(r.code, 503, JSON.stringify(env));
    assert.deepEqual(ctx.stripe.st.calls, []);
    await ctx.db.close();
  }
});

// ================= Checkout
test('Checkout：認証を入力の検査より先に行い、本文は diagnosisSessionId だけを受け付ける', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  assert.deepEqual([(await ctx.checkout(null, { bad: 1 })).code, (await ctx.checkout(null, 'not json')).code], [401, 401]);
  assert.equal((await ctx.checkout('wrong-token', { bad: 1 })).code, 401);
  assert.equal((await ctx.checkout(p.token, { bad: 1 })).code, 400);
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: 'not-a-uuid' })).code, 400);
  for (const extra of [{ amount: 1 }, { priceId: 'price_test_upgrade2000' }, { userId: p.userId }, { goalId: 'GOAL_PACE_01' }, { offer: 'analysis_upgrade' }]) {
    const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId, ...extra });
    assert.equal(r.code, 400, JSON.stringify(extra));
  }
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId }, { method: 'GET' })).code, 405);
  assert.deepEqual(ctx.stripe.st.calls, []);
  assert.deepEqual(await ctx.order(p.sessionId), []);
  ctx.db.failNext('auth');
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).code, 503);
  await ctx.db.close();
});

test('Checkout：本人の記録・登録完了・RC1・MENTOR 選択を確かめる', async () => {
  const ctx = await setup();
  const a = await person(ctx);
  const b = await person(ctx, { email: 'other@example.test' });
  let r = await ctx.checkout(a.token, { diagnosisSessionId: b.sessionId });
  assert.deepEqual([r.code, r.body], [404, { error: 'record_not_found' }]);
  r = await ctx.checkout(a.token, { diagnosisSessionId: '99999999-9999-4999-8999-999999999999' });
  assert.deepEqual([r.code, r.body], [404, { error: 'record_not_found' }]);
  const pending = await person(ctx, { onboarding: 'required' });
  assert.equal((await ctx.checkout(pending.token, { diagnosisSessionId: pending.sessionId })).code, 403);
  const old = await person(ctx, { versions: { ...CE.RC1_REQUIRED_VERSIONS, mirror_model_version: 'ETI-MIRROR-2.0.2', character_profile_version: 'ETI-CHAR-2.0.1' } });
  assert.deepEqual((await ctx.checkout(old.token, { diagnosisSessionId: old.sessionId })).body, { error: 'not_eligible' });
  const noGoal = await person(ctx, { goal: null });
  assert.deepEqual((await ctx.checkout(noGoal.token, { diagnosisSessionId: noGoal.sessionId })).body, { error: 'mentor_goal_required' });
  assert.deepEqual(ctx.stripe.st.calls, []);
  await ctx.db.close();
});

test('Checkout direct ¥3,000：カードだけ・customer_email なし・metadata 3つ・戻り先は設定から・Idempotency-Key は注文 ID から', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId }, { headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['amount', 'checkoutUrl', 'offer']);
  assert.equal(r.body.offer, 'direct_complete');
  assert.equal(r.body.amount, 3000);
  assert.match(r.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  const [order] = await ctx.order(p.sessionId);
  assert.equal(order.status, 'checkout_open');
  const { params, opts } = ctx.stripe.st.lastCreate;
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.equal(params.mode, 'payment');
  assert.deepEqual(params.line_items, [{ price: 'price_test_direct3000', quantity: 1 }]);
  assert.equal('customer_email' in params, false);
  assert.equal('customer' in params, false);
  assert.equal('client_reference_id' in params, false);
  assert.deepEqual(params.metadata, { order_id: order.id, app: CP.APP, env: 'preview' });
  assert.equal(params.success_url, `${ORIGIN}/mypage.html?complete=returned`);
  assert.equal(params.cancel_url, `${ORIGIN}/mypage.html?complete=canceled`);
  assert.doesNotMatch(JSON.stringify(params), /attacker|evil|@|CODE_|GOAL_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?!")/);
  assert.deepEqual(opts, { idempotencyKey: `complete-checkout-${order.id}` });
  assert.equal(order.stripe_checkout_session_id, r.body.checkoutUrl.split('/').pop());
  // Price は Stripe から取得して照合している
  assert.ok(ctx.stripe.st.calls.includes('prices.retrieve'));
  await ctx.db.close();
});

test('Checkout：二重クリックは同じ注文・同じ Session（Stripe の作成は1回）', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r1 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  const r2 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.equal(r1.code, 200);
  assert.equal(r2.code, 200);
  assert.equal(r2.body.checkoutUrl, r1.body.checkoutUrl);
  assert.equal((await ctx.order(p.sessionId)).length, 1);
  assert.equal(ctx.stripe.st.calls.filter((c) => c === 'checkout.sessions.create').length, 1);
  await ctx.db.close();
});

test('Checkout：並行注文でも注文は1件・Session は1つ（同じ Idempotency-Key）', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const rs = await Promise.all([1, 2, 3].map(() => ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })));
  for (const r of rs) assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(new Set(rs.map((r) => r.body.checkoutUrl)).size, 1);
  const orders = await ctx.order(p.sessionId);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'checkout_open');
  assert.equal(Object.keys(ctx.stripe.st.sessions).length, 1);
  await ctx.db.close();
});

test('Checkout：Session 作成後に DB の checkout_open 記録が失敗 → 次の要求で同じ Session を回収', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  ctx.db.failNext('rpc:complete_mark_checkout_open');
  const r1 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.equal(r1.code, 503);
  assert.match(r1.body.incident_id, /^[0-9a-f]{12}$/);
  let [order] = await ctx.order(p.sessionId);
  assert.equal(order.status, 'created');
  assert.equal(Object.keys(ctx.stripe.st.sessions).length, 1);
  const firstSession = Object.keys(ctx.stripe.st.sessions)[0];
  const r2 = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.equal(r2.code, 200);
  [order] = await ctx.order(p.sessionId);
  assert.equal(order.status, 'checkout_open');
  assert.equal(order.stripe_checkout_session_id, firstSession);
  assert.equal(Object.keys(ctx.stripe.st.sessions).length, 1, 'Session を作り直さない');
  assert.equal((await ctx.order(p.sessionId)).length, 1);
  await ctx.db.close();
});

test('Checkout：Price の無効・金額違い・通貨違い・Live は注文を閉じて 503（Session を作らない）', async () => {
  for (const [name, change] of [['inactive', { active: false }], ['amount', { unit_amount: 2500 }], ['currency', { currency: 'usd' }], ['livemode', { livemode: true }]]) {
    const ctx = await setup({ prices: { ...PRICES, price_test_direct3000: { ...PRICES.price_test_direct3000, ...change } } });
    const p = await person(ctx);
    const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
    assert.equal(r.code, 503, name);
    assert.equal(r.body.error, 'service_unavailable');
    const [order] = await ctx.order(p.sessionId);
    assert.equal(order.status, 'canceled', name);
    assert.equal(Object.keys(ctx.stripe.st.sessions).length, 0, name);
    await ctx.db.close();
  }
});

test('Checkout：Stripe の一時的な失敗は注文を残して 503（次の要求で同じ注文から作る）・恒久的な失敗は注文を failed', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  ctx.stripe.fail('checkout.sessions.create', stripeError('StripeConnectionError', 0));
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).code, 503);
  assert.equal((await ctx.order(p.sessionId))[0].status, 'created');
  ctx.stripe.fail('prices.retrieve', stripeError('StripeAPIError', 500));
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).code, 503);
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).code, 200);
  assert.equal((await ctx.order(p.sessionId)).length, 1);

  const q = await person(ctx, { email: 'q@example.test' });
  ctx.stripe.fail('checkout.sessions.create', stripeError('StripeInvalidRequestError', 400, 'parameter_invalid'));
  const r = await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId });
  assert.equal(r.code, 502);
  assert.equal((await ctx.order(q.sessionId))[0].status, 'failed');
  // Stripe が正規ホスト以外の URL を返した：利用者へ返さない
  const w = await person(ctx, { email: 'w@example.test' });
  const origCreate = ctx.stripe.client.checkout.sessions.create;
  ctx.stripe.client.checkout.sessions.create = async (...a) => Object.assign(await origCreate(...a), { url: 'https://checkout.stripe.com.evil.example/c/pay/x' });
  const bad = await ctx.checkout(w.token, { diagnosisSessionId: w.sessionId });
  ctx.stripe.client.checkout.sessions.create = origCreate;
  assert.equal(bad.code, 500);
  assert.equal(bad.body.checkoutUrl, undefined);
  // 失敗した注文の後は新しい注文で作り直せる
  assert.equal((await ctx.checkout(q.token, { diagnosisSessionId: q.sessionId })).code, 200);
  assert.deepEqual((await ctx.order(q.sessionId)).map((o) => o.status).sort(), ['checkout_open', 'failed']);
  await ctx.db.close();
});

test('旧 ¥1,000：購入時メールと Auth の確認済みメールが一致すれば自動で結び付けて upgrade ¥2,000', async () => {
  const ctx = await setup();
  const code = 'CODE_LEGACY_MATCH';
  const p = await person(ctx, { email: 'Buyer@Example.test', code });
  const legacySession = ctx.stripe.legacySession({ email: ' buyer@example.TEST ' });
  const legacyId = await ctx.db.legacy({ code, stripeSessionId: legacySession });
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.offer, 'analysis_upgrade');
  assert.equal(r.body.amount, 2000);
  assert.deepEqual(ctx.stripe.st.lastCreate.params.line_items, [{ price: 'price_test_upgrade2000', quantity: 1 }]);
  const bindings = await ctx.db.rows('complete_legacy_bindings');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].legacy_entitlement_id, legacyId);
  assert.equal(bindings[0].match_method, 'stripe_email_verified');
  const [order] = await ctx.order(p.sessionId);
  assert.equal(order.offer, 'analysis_upgrade');
  assert.equal(order.analysis_basis, 'legacy_purchase_entitlement');
  // 2回目は結び付け済みとして upgrade のまま（Stripe の旧 Session を取り直さない）
  const before = ctx.stripe.st.calls.filter((c) => c === 'checkout.sessions.retrieve').length;
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).body.offer, 'analysis_upgrade');
  assert.equal(ctx.stripe.st.calls.filter((c) => c === 'checkout.sessions.retrieve').length, before + 1, '決済待ちの Session の確認だけ');
  assertNoForbidden(ctx.logger.lines.join('\n'), FORBIDDEN(ctx), 'ログ');
  await ctx.db.close();
});

test('旧 ¥1,000：メール不一致・Auth のメールなし／未確認・Session 取得不可・未払いは legacy_purchase_verification_required（¥3,000 へ誘導しない）', async () => {
  for (const [name, opts] of [
    ['mismatch', { auth: 'buyer@example.test', purchase: 'someone@example.test' }],
    ['auth_missing', { auth: null, purchase: 'buyer@example.test' }],
    ['auth_unconfirmed', { auth: 'buyer@example.test', confirmed: false, purchase: 'buyer@example.test' }],
    ['purchase_email_missing', { auth: 'buyer@example.test', purchase: undefined }],
    ['session_missing', { auth: 'buyer@example.test', missing: true }],
    ['unpaid', { auth: 'buyer@example.test', purchase: 'buyer@example.test', paid: false }],
  ]) {
    const ctx = await setup();
    const code = `CODE_LEGACY_${name}`;
    const p = await person(ctx, { email: opts.auth, confirmed: opts.confirmed !== false, code });
    const sessionId = opts.missing ? 'cs_test_missingsession000' : ctx.stripe.legacySession({ email: opts.purchase, paid: opts.paid !== false });
    await ctx.db.legacy({ code, stripeSessionId: sessionId });
    const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
    assert.equal(r.code, 409, name);
    assert.equal(r.body.error, 'legacy_purchase_verification_required', name);
    assert.deepEqual(await ctx.order(p.sessionId), [], `${name}：注文を作らない`);
    assert.deepEqual(await ctx.db.rows('complete_legacy_bindings'), [], `${name}：結び付けない`);
    assert.equal(ctx.stripe.st.calls.includes('checkout.sessions.create'), false, `${name}：Checkout を作らない`);
    const logs = ctx.logger.lines.join('\n');
    assertNoForbidden(logs, FORBIDDEN(ctx), `${name} のログ`);
    assert.doesNotMatch(JSON.stringify(r.body), /@|cs_test_|email/);
    await ctx.db.close();
  }
});

test('Checkout：支払い済み・返金済みの記録は再購入できない', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { csId } = await openAndPay(ctx, p);
  assert.equal((await ctx.webhook({ type: 'checkout.session.completed', objectId: csId })).code, 200);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  assert.deepEqual([r.code, r.body], [409, { error: 'repurchase_not_allowed' }]);
  await ctx.db.close();
});

// ================= Webhook
test('Webhook：署名なし・1バイト変更・古い timestamp・別の secret・不正な形式は 400（DB・Stripe に接続しない）', async () => {
  const ctx = await setup();
  const base = { type: 'checkout.session.completed', objectId: 'cs_test_abcdefghijkl' };
  const cases = [
    ['no signature', { signature: null }],
    ['tampered body', { tamper: (b) => { const c = Buffer.from(b); c[10] ^= 1; return c; } }],
    ['appended byte', { tamper: (b) => Buffer.concat([b, Buffer.from('\n')]) }],
    ['old timestamp', { signedAt: Math.floor(Date.now() / 1000) - 600 }],
    ['future timestamp', { signedAt: Math.floor(Date.now() / 1000) + 600 }],
    ['other secret', { signature: CP.signPayload(Buffer.from('{}'), 'whsec_other', Math.floor(Date.now() / 1000)) }],
    ['garbage header', { signature: 'garbage' }],
  ];
  const before = ctx.db.calls ? ctx.db.calls.length : 0;
  for (const [name, o] of cases) {
    const r = await ctx.webhook({ ...base, ...o });
    assert.equal(r.code, 400, name);
    assert.equal(r.body.error, 'signature_invalid', name);
  }
  if (ctx.db.calls) assert.equal(ctx.db.calls.length, before);
  assert.deepEqual(ctx.stripe.st.calls, []);
  assert.deepEqual(await ctx.db.rows('stripe_webhook_events'), []);
  // Bearer は使わない（付いていても署名が無ければ拒否）
  const { req } = eventRequest({ ...base, secret: SECRET, signature: null });
  req.headers.authorization = 'Bearer anything';
  assert.equal((await ctx.webhookRaw(req)).code, 400);
  // GET は 405、secret が無ければ 503
  const g = makeRes();
  await Webhook.createHandler({ env: SALES_ENV, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null })({ method: 'GET', headers: {} }, g);
  assert.equal(g.code, 405);
  const noSecret = Webhook.createHandler({ env: { ...SALES_ENV, STRIPE_COMPLETE_WEBHOOK_SECRET: undefined }, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null });
  const n = makeRes();
  await noSecret(eventRequest({ ...base, secret: SECRET }).req, n);
  assert.equal(n.code, 503);
  assertNoForbidden(ctx.logger.lines.join('\n'), FORBIDDEN(ctx), 'ログ');
  await ctx.db.close();
});

test('Webhook：Live のイベント・対象外のイベント・完全解析でない Session は DB に書かずに 200', async () => {
  const ctx = await setup();
  let r = await ctx.webhook({ type: 'checkout.session.completed', objectId: 'cs_test_abcdefghijkl', livemode: true });
  assert.deepEqual([r.code, r.body], [200, { received: true, result: 'ignored' }]);
  r = await ctx.webhook({ type: 'customer.created', objectId: 'cus_abcdefghijkl' });
  assert.deepEqual([r.code, r.body], [200, { received: true, result: 'ignored' }]);
  const legacy = ctx.stripe.legacySession({ email: 'x@example.test' });
  r = await ctx.webhook({ type: 'checkout.session.completed', objectId: legacy });
  assert.deepEqual([r.code, r.body], [200, { received: true, result: 'ignored' }]);
  assert.deepEqual(await ctx.db.rows('stripe_webhook_events'), []);
  await ctx.db.close();
});

test('Webhook 支払い確定：注文 paid・MENTOR ロック・権利・complete_reports queued を同時に作る（素材・入力のハッシュ付き）。重複・再配送は状態を変えない', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { csId } = await openAndPay(ctx, p);
  const r = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId });
  assert.deepEqual([r.code, r.body], [200, { received: true, result: 'processed' }]);
  assert.equal(await ctx.state(p.sessionId), 'paid|lock=true|ent=analysis:active,complete:active|rep=queued');
  const [report] = await ctx.db.rows('complete_reports');
  assert.equal(report.content_version, 'CORE1-CONTENT-1.0.1');
  assert.equal(report.template_version, 'CORE1-TEMPLATE-46P-WEB-1.0.1');
  assert.equal(report.template_version, CP.MATERIALS.templateVersion);
  assert.equal(report.content_sha256, CP.MATERIALS.contentSha256);
  assert.equal(report.template_sha256, CP.MATERIALS.templateSha256);
  const answers = await ctx.db.rows('diagnosis_answers');
  const code = answers.find((a) => a.session_id === p.sessionId).encoded_answers;
  const session = (await ctx.db.rows('diagnosis_sessions')).find((x) => x.id === p.sessionId);
  const diagnosedDate = CP.jstDate(new Date(session.completed_at).toISOString());
  assert.match(diagnosedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(report.input_sha256, CP.inputSha256({ encodedAnswers: code, result: CE.RC1_REQUIRED_VERSIONS, mentorGoalCatalogVersion: CE.MENTOR_CATALOG_VERSION, mentorGoalId: 'GOAL_PACE_01', diagnosedDate }));
  // 同じイベントの重複配送
  const dup = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId, id: r.event.id });
  assert.deepEqual([dup.code, dup.body.result], [200, 'processed']);
  // 別のイベント ID での再配送
  const again = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId });
  assert.equal(again.code, 200);
  // 支払い後の期限切れ通知は状態を戻さない
  ctx.stripe.expire(csId);
  assert.equal((await ctx.webhook({ type: 'checkout.session.expired', objectId: csId })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'paid|lock=true|ent=analysis:active,complete:active|rep=queued');
  assert.equal((await ctx.db.rows('complete_reports')).length, 1);
  assert.equal((await ctx.db.rows('record_entitlements')).length, 2);
  const events = await ctx.db.rows('stripe_webhook_events');
  assert.ok(events.every((e) => e.status === 'processed'), JSON.stringify(events.map((e) => e.status)));
  await ctx.db.close();
});

test('Webhook：期限切れは注文 expired（支払い前）・Stripe の最新状態が expired でなければ 500 で再送', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  const csId = r.body.checkoutUrl.split('/').pop();
  // イベント本文を信用しない：Stripe ではまだ open
  const early = await ctx.webhook({ type: 'checkout.session.expired', objectId: csId });
  assert.equal(early.code, 500);
  assert.equal((await ctx.order(p.sessionId))[0].status, 'checkout_open');
  ctx.stripe.expire(csId);
  const ok = await ctx.webhook({ type: 'checkout.session.expired', objectId: csId, id: early.event.id });
  assert.deepEqual([ok.code, ok.body.result], [200, 'processed']);
  assert.equal((await ctx.order(p.sessionId))[0].status, 'expired');
  // 期限切れの後は新しい注文を作れる
  assert.equal((await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId })).code, 200);
  assert.deepEqual((await ctx.order(p.sessionId)).map((o) => o.status).sort(), ['checkout_open', 'expired']);
  await ctx.db.close();
});

test('Webhook 返金：一部は記録だけ・全額で refunded（権利・生成物 revoked）。返金が支払い確定より先でも refunded を優先', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { csId, chargeId } = await openAndPay(ctx, p);
  await ctx.webhook({ type: 'checkout.session.completed', objectId: csId });
  ctx.stripe.refund(chargeId, 1000);
  assert.equal((await ctx.webhook({ type: 'charge.refunded', objectId: chargeId })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'paid|lock=true|ent=analysis:active,complete:active|rep=queued');
  ctx.stripe.refund(chargeId, 3000);
  assert.equal((await ctx.webhook({ type: 'charge.refunded', objectId: chargeId })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'refunded|lock=true|ent=analysis:revoked,complete:revoked|rep=revoked');

  // 順序逆転：支払い確定の通知より先に全額返金が届く
  const q = await person(ctx, { email: 'q@example.test' });
  const paid = await openAndPay(ctx, q);
  ctx.stripe.refund(paid.chargeId, 3000);
  assert.equal((await ctx.webhook({ type: 'charge.refunded', objectId: paid.chargeId })).code, 200);
  const late = await ctx.webhook({ type: 'checkout.session.completed', objectId: paid.csId });
  assert.equal(late.code, 200);
  const st = await ctx.state(q.sessionId);
  assert.match(st, /^refunded\|lock=false\|ent=none\|rep=none$/);
  await ctx.db.close();
});

test('Webhook dispute：開始で suspended・勝訴で active・敗訴で revoked。支払い確定前の dispute は complete_retry_later → 500 → 再送で処理', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { csId, chargeId } = await openAndPay(ctx, p);
  // 支払い確定より先に dispute が届く：500（Stripe が再送）
  const du = ctx.stripe.dispute(chargeId);
  const early = await ctx.webhook({ type: 'charge.dispute.created', objectId: du, created: Math.floor(Date.now() / 1000) - 50 });
  assert.equal(early.code, 500);
  assert.deepEqual(Object.keys(early.body).sort(), ['error', 'incident_id']);
  const failed = (await ctx.db.rows('stripe_webhook_events')).find((e) => e.event_id === early.event.id);
  assert.equal(failed && failed.status, 'failed');
  await ctx.webhook({ type: 'checkout.session.completed', objectId: csId, created: Math.floor(Date.now() / 1000) - 60 });
  const resend = await ctx.webhook({ type: 'charge.dispute.created', objectId: du, id: early.event.id, created: Math.floor(Date.now() / 1000) - 50 });
  assert.deepEqual([resend.code, resend.body.result], [200, 'processed']);
  assert.equal(await ctx.state(p.sessionId), 'disputed|lock=true|ent=analysis:suspended,complete:suspended|rep=queued');
  ctx.stripe.setDispute(du, 'won');
  assert.equal((await ctx.webhook({ type: 'charge.dispute.closed', objectId: du, created: Math.floor(Date.now() / 1000) - 40 })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'paid|lock=true|ent=analysis:active,complete:active|rep=queued');
  // 古い dispute 開始の再配送（別 ID）は無視
  assert.equal((await ctx.webhook({ type: 'charge.dispute.created', objectId: du, created: Math.floor(Date.now() / 1000) - 50 })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'paid|lock=true|ent=analysis:active,complete:active|rep=queued');
  // 新しい dispute で敗訴
  const du2 = ctx.stripe.dispute(chargeId);
  await ctx.webhook({ type: 'charge.dispute.created', objectId: du2, created: Math.floor(Date.now() / 1000) - 20 });
  ctx.stripe.setDispute(du2, 'lost');
  assert.equal((await ctx.webhook({ type: 'charge.dispute.closed', objectId: du2, created: Math.floor(Date.now() / 1000) - 10 })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'disputed|lock=true|ent=analysis:revoked,complete:revoked|rep=revoked');
  // 閉じていない dispute の closed 通知は恒久的な不一致として ignored
  const du3 = ctx.stripe.dispute(chargeId, 'under_review');
  const notClosed = await ctx.webhook({ type: 'charge.dispute.closed', objectId: du3 });
  assert.deepEqual([notClosed.code, notClosed.body.result], [200, 'ignored']);
  await ctx.db.close();
});

test('Webhook：Stripe・DB の一時的な失敗は failed を記録して 500 → 再送で処理', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { csId } = await openAndPay(ctx, p);
  ctx.stripe.fail('checkout.sessions.retrieve', stripeError('StripeConnectionError', 0));
  const r1 = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId });
  assert.equal(r1.code, 500);
  assert.equal((await ctx.db.rows('stripe_webhook_events')).find((e) => e.event_id === r1.event.id).status, 'failed');
  ctx.db.failNext('rpc:complete_apply_payment');
  const r2 = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId, id: r1.event.id });
  assert.equal(r2.code, 500);
  assert.equal(await ctx.state(p.sessionId), 'checkout_open|lock=false|ent=none|rep=none');
  const r3 = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId, id: r1.event.id });
  assert.deepEqual([r3.code, r3.body.result], [200, 'processed']);
  assert.equal(await ctx.state(p.sessionId), 'paid|lock=true|ent=analysis:active,complete:active|rep=queued');
  await ctx.db.close();
});

test('Webhook：恒久的な不一致（金額・Price・metadata）は ignored・200（権利なし）', async () => {
  // 金額違い：注文は failed
  let ctx = await setup();
  let p = await person(ctx);
  let paid = await openAndPay(ctx, p);
  ctx.stripe.st.sessions[paid.csId].amount_total = 2000;
  let r = await ctx.webhook({ type: 'checkout.session.completed', objectId: paid.csId });
  assert.deepEqual([r.code, r.body], [200, { received: true, result: 'ignored' }]);
  assert.equal(await ctx.state(p.sessionId), 'failed|lock=false|ent=none|rep=none');
  await ctx.db.close();
  // Price 違い（注文の offer の Price ではない）
  ctx = await setup();
  p = await person(ctx);
  paid = await openAndPay(ctx, p);
  ctx.stripe.st.sessions[paid.csId].line_items.data[0].price.id = 'price_test_upgrade2000';
  r = await ctx.webhook({ type: 'checkout.session.completed', objectId: paid.csId });
  assert.deepEqual([r.code, r.body.result], [200, 'ignored']);
  assert.equal(await ctx.state(p.sessionId), 'checkout_open|lock=false|ent=none|rep=none');
  assert.equal((await ctx.db.rows('stripe_webhook_events'))[0].error_code, 'price_mismatch');
  await ctx.db.close();
  // metadata 違い（env が production・項目の追加）
  for (const meta of [{ env: 'production' }, { extra: 'x' }, { order_id: 'not-a-uuid' }]) {
    ctx = await setup();
    p = await person(ctx);
    paid = await openAndPay(ctx, p);
    Object.assign(ctx.stripe.st.sessions[paid.csId].metadata, meta);
    r = await ctx.webhook({ type: 'checkout.session.completed', objectId: paid.csId });
    assert.deepEqual([r.code, r.body.result], [200, 'ignored'], JSON.stringify(meta));
    assert.equal(await ctx.state(p.sessionId), 'checkout_open|lock=false|ent=none|rep=none');
    await ctx.db.close();
  }
});

test('Webhook：販売を閉じていても返金・dispute を処理する', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const { csId, chargeId } = await openAndPay(ctx, p);
  // 販売を閉じた後の Webhook（同じ DB・Stripe）
  const closed = Webhook.createHandler({ env: { ...SALES_ENV, COMPLETE_SALES_OPEN: 'false' }, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger, waitUntil: null });
  const send = async (o) => { const res = makeRes(); await closed(eventRequest({ secret: SECRET, ...o }).req, res); return res; };
  assert.equal((await send({ type: 'checkout.session.completed', objectId: csId })).code, 200);
  ctx.stripe.refund(chargeId, 3000);
  assert.equal((await send({ type: 'charge.refunded', objectId: chargeId })).code, 200);
  assert.equal(await ctx.state(p.sessionId), 'refunded|lock=true|ent=analysis:revoked,complete:revoked|rep=revoked');
  // Checkout は閉じたまま
  const co = Checkout.createHandler({ env: { ...SALES_ENV, COMPLETE_SALES_OPEN: 'false' }, fetchImpl: ctx.db.fetchImpl, stripeFactory: ctx.stripe.factory, logger: ctx.logger });
  const res = makeRes();
  await co({ method: 'POST', headers: { authorization: `Bearer ${p.token}` }, body: { diagnosisSessionId: p.sessionId } }, res);
  assert.deepEqual([res.code, res.body], [503, { error: 'sales_closed' }]);
  await ctx.db.close();
});

// ================= 状態確認
test('状態確認：認証が先・本人の記録だけ・Stripe ID・保存パス・メール・診断コードを返さない', async () => {
  const ctx = await setup();
  const p = await person(ctx);
  const other = await person(ctx, { email: 'other@example.test' });
  assert.equal((await ctx.status(null, 'not-a-uuid')).code, 401);
  assert.equal((await ctx.status('wrong', p.sessionId)).code, 401);
  assert.equal((await ctx.status(p.token, 'not-a-uuid')).code, 400);
  assert.equal((await ctx.status(p.token, undefined)).code, 400);
  assert.deepEqual((await ctx.status(p.token, other.sessionId)).body, { error: 'record_not_found' });
  assert.equal((await ctx.status(p.token, p.sessionId, { method: 'PUT' })).code, 405);
  let r = await ctx.status(p.token, p.sessionId);
  assert.deepEqual(r.body, { salesOpen: true, order: null, entitlements: { analysis: null, complete: null }, report: null,
    mentorGoal: { goalId: 'GOAL_PACE_01', goalCatalogVersion: CE.MENTOR_CATALOG_VERSION, locked: false } });
  const { csId } = await openAndPay(ctx, p);
  await ctx.webhook({ type: 'checkout.session.completed', objectId: csId });
  r = await ctx.status(p.token, p.sessionId);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, {
    salesOpen: true,
    order: { status: 'paid', offer: 'direct_complete', amount: 3000 },
    entitlements: { analysis: 'active', complete: 'active' },
    report: { status: 'queued' },
    mentorGoal: { goalId: 'GOAL_PACE_01', goalCatalogVersion: CE.MENTOR_CATALOG_VERSION, locked: true },
  });
  const text = JSON.stringify(r.body);
  assertNoForbidden(text, [...FORBIDDEN(ctx), /storage_path/, /input_sha256/, new RegExp(p.userId), new RegExp(p.sessionId)], '応答');
  const orders = await ctx.order(p.sessionId);
  assert.doesNotMatch(text, new RegExp(orders[0].id));
  await ctx.db.close();
});

test('応答・ログ・metadata に禁止情報が無い（一連の決済・返金の後）', async () => {
  const ctx = await setup();
  const code = 'CODE_LEGACY_LOGCHECK';
  const p = await person(ctx, { email: 'logcheck@example.test', code });
  const legacy = ctx.stripe.legacySession({ email: 'logcheck@example.test' });
  await ctx.db.legacy({ code, stripeSessionId: legacy });
  const r = await ctx.checkout(p.token, { diagnosisSessionId: p.sessionId });
  const csId = r.body.checkoutUrl.split('/').pop();
  const { chargeId } = ctx.stripe.pay(csId);
  ctx.stripe.fail('charges.retrieve', stripeError('StripeAPIError', 500));
  ctx.stripe.refund(chargeId, 2000);
  const responses = [r.body];
  responses.push((await ctx.webhook({ type: 'checkout.session.completed', objectId: csId })).body);
  responses.push((await ctx.webhook({ type: 'charge.refunded', objectId: chargeId })).body);
  responses.push((await ctx.webhook({ type: 'charge.refunded', objectId: chargeId })).body);
  responses.push((await ctx.webhook({ type: 'charge.refunded', objectId: chargeId, signature: 'bad' })).body);
  responses.push((await ctx.status(p.token, p.sessionId)).body);
  const logs = ctx.logger.lines.join('\n');
  assert.ok(ctx.logger.lines.length > 0);
  for (const line of ctx.logger.lines) {
    assert.match(line, /^(complete-checkout|stripe-webhook|complete-status) error: [a-z_]+ [0-9a-f]{12}$|^\{"event":"env_guard_denied"/, line);
  }
  assertNoForbidden(logs, [...FORBIDDEN(ctx), new RegExp(p.userId), new RegExp(p.sessionId), /https?:\/\//, /Bearer/], 'ログ');
  // Checkout の応答の checkoutUrl（Stripe の決済画面）以外に Stripe ID を返さない
  const rest = JSON.stringify(responses.slice(1));
  assertNoForbidden(rest, [...FORBIDDEN(ctx), new RegExp(p.userId)], 'Webhook・状態確認の応答');
  for (const s of Object.values(ctx.stripe.st.sessions)) {
    if (s.metadata.app) assert.deepEqual(Object.keys(s.metadata).sort(), ['app', 'env', 'order_id']);
  }
  await ctx.db.close();
});
