// api/verify・report-data・my-entitlements・my-report-link・subscribe の環境ガードのテスト。
// Supabase・Stripe・Kit への通信はすべて偽物。設定の取り違えでは、どこにも接続せず 503 で止まることを確かめる。
//   実行: node --test tests/api_env_guard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { PROD_REF, PREVIEW_REF, PROD_ENV, PREVIEW_ENV, fakeJwt } = require('./fixtures/server_env');

const api = (name) => require(path.join(__dirname, '..', 'api', name));
const verify = api('verify.js');
const reportData = api('report-data.js');
const myEntitlements = api('my-entitlements.js');
const myReportLink = api('my-report-link.js');
const subscribe = api('subscribe.js');

const TEST_CORE1_PRICE = 'price_1UINCK0IX2Svp0V39HaCB7WJ';
const LIVE_CORE1_PRICE = 'price_1TxZzE0IX2Svp0V3tAdVRTPJ';

function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); },
    end(b) { if (b !== undefined) this.body = b; },
  };
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// 偽の Supabase。呼ばれた URL を記録する。
function fakeSupabase({ rows = {}, user = { id: 'user-1', email: 'owner@example.test' } } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/v1/user')) return opts.headers.Authorization === 'Bearer good-token' ? json(200, user) : json(401, {});
    if (url.includes('/rest/v1/purchase_entitlements') && opts.method === 'POST') {
      const [row] = JSON.parse(opts.body);
      return json(201, [{ ...row, id: 'ent-1' }]);
    }
    if (url.includes('/rest/v1/purchase_entitlements')) return json(200, rows.entitlements || []);
    if (url.includes('/rest/v1/diagnosis_sessions')) return json(200, rows.sessions || []);
    if (url.includes('/rest/v1/profiles') && opts.method === 'PATCH') return json(200, [{ id: 'user-1' }]);
    if (url.includes('/rest/v1/profiles')) {
      return json(200, [{ onboarding_status: 'completed', newsletter_opted_in: true, newsletter_consent_version: subscribe.CONSENT_VERSION,
        newsletter_consent_source: 'registration_onboarding', newsletter_sync_status: 'pending', newsletter_sync_attempts: 0, newsletter_sync_attempted_at: null }]);
    }
    if (url.startsWith('https://api.kit.com')) return json(200, { subscribers: [] });
    throw new Error('unexpected fetch ' + url);
  };
  return { calls, fetchImpl };
}

// 偽の Stripe。生成されたキーと retrieve の呼び出しを記録する。
function fakeStripe(session) {
  const created = [], retrieved = [];
  const stripeFactory = (key) => {
    created.push(key);
    return { checkout: { sessions: { retrieve: async (id) => { retrieved.push(id); return session(id); } } } };
  };
  return { created, retrieved, stripeFactory };
}

function paidSession({ price, livemode }) {
  return (id) => ({
    id, livemode, payment_status: 'paid', client_reference_id: 'v2_ABCDEF', currency: 'jpy', amount_total: 1000,
    payment_intent: 'pi_fake', line_items: { data: [{ price: { id: price } }] },
  });
}

function decodeToken(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
}
function signWith(secret, payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`;
}

function silenced(fn) {
  return async () => {
    const orig = console.error;
    const logs = [];
    console.error = (...a) => logs.push(a.map(String).join(' '));
    try { await fn(logs); } finally { console.error = orig; }
  };
}

// ---- 取り違え・設定不足：どの API も接続前に 503 ----
const WRONG = [
  ['Preview で本番 Ref', { ...PREVIEW_ENV, SUPABASE_URL: PROD_ENV.SUPABASE_URL }],
  ['Preview で本番 Ref（期待 Ref も本番）', { ...PREVIEW_ENV, SUPABASE_URL: PROD_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PROD_REF }],
  ['Production で Preview Ref', { ...PROD_ENV, SUPABASE_URL: PREVIEW_ENV.SUPABASE_URL }],
  ['Production で Preview Ref（期待 Ref も Preview）', { ...PROD_ENV, SUPABASE_URL: PREVIEW_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PREVIEW_REF }],
  ['環境不明', { ...PREVIEW_ENV, VERCEL_ENV: undefined }],
  ['期待 Ref 未設定', { ...PREVIEW_ENV, SUPABASE_EXPECTED_PROJECT_REF: undefined }],
  ['URL と Ref の不一致', { ...PREVIEW_ENV, SUPABASE_URL: 'https://otherref000000000000.supabase.co' }],
  ['サーバー用キーに公開キー', { ...PREVIEW_ENV, SUPABASE_SECRET_KEY: PREVIEW_ENV.SUPABASE_ANON_KEY }],
  ['サーバー用キーが不明な形式', { ...PREVIEW_ENV, SUPABASE_SECRET_KEY: 'unknown_format_server_key' }],
  ['旧変数のサーバー用キーが不明な形式', { ...PREVIEW_ENV, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: 'plain_text_service_key' }],
  ['旧変数のサーバー用キーが別プロジェクトの JWT', { ...PROD_ENV, SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: PREVIEW_REF }) }],
  ['サーバー用キーが未設定', { ...PREVIEW_ENV, SUPABASE_SECRET_KEY: undefined }],
];

const HANDLERS = [
  ['verify', (env, sb, st) => verify.createHandler({ env, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory }),
    { method: 'GET', query: { session_id: 'cs_test_fakesession000001' }, headers: {} }],
  ['report-data', (env, sb) => reportData.createHandler({ env, fetchImpl: sb.fetchImpl }),
    { method: 'GET', query: { token: signWith(PREVIEW_ENV.REPORT_TOKEN_SECRET, { exp: Date.now() + 60000, code: 'X' }) }, headers: {} }],
  ['my-entitlements', (env, sb) => myEntitlements.createHandler({ env, fetchImpl: sb.fetchImpl }),
    { method: 'GET', headers: { authorization: 'Bearer good-token' } }],
  ['my-report-link', (env, sb) => myReportLink.createHandler({ env, fetchImpl: sb.fetchImpl }),
    { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { diagnosis_session_id: 's-1' } }],
  ['subscribe', (env, sb) => subscribe.createHandler({ env: { ...env, KIT_API_KEY: 'kit_fake' }, fetchImpl: sb.fetchImpl }),
    { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { consentVersion: subscribe.CONSENT_VERSION } }],
];

for (const [apiName, make, req] of HANDLERS) {
  for (const [caseName, env] of WRONG) {
    test(`${apiName}：${caseName} → 503。Supabase・Stripe・Kit へ接続しない。ログに秘密値を出さない`, silenced(async (logs) => {
      const sb = fakeSupabase();
      const st = fakeStripe(paidSession({ price: TEST_CORE1_PRICE, livemode: false }));
      const res = makeRes();
      await make(env, sb, st)({ ...req }, res);
      assert.equal(res.code, 503);
      assert.equal(sb.calls.length, 0, 'fetch しない');
      assert.equal(st.created.length + st.retrieved.length, 0, 'Stripe へ接続しない');
      const text = logs.join('\n') + JSON.stringify(res.body);
      for (const s of [PROD_ENV.SUPABASE_URL, PREVIEW_ENV.SUPABASE_URL, PROD_REF, PREVIEW_REF,
        env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_ANON_KEY, env.STRIPE_SECRET_KEY, env.REPORT_TOKEN_SECRET, 'cs_test_fakesession000001', 'good-token']) {
        if (s) assert.ok(!text.includes(s), s);
      }
    }));
  }
}

// ---- verify：Stripe のモード ----
test('verify Preview：Test の Session で Preview の Supabase にだけ記録し、トークンに env=preview を入れる', silenced(async () => {
  const sb = fakeSupabase();
  const st = fakeStripe(paidSession({ price: TEST_CORE1_PRICE, livemode: false }));
  const res = makeRes();
  await verify.createHandler({ env: PREVIEW_ENV, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
    { method: 'GET', query: { session_id: 'cs_test_fakesession000001' }, headers: {} }, res);
  assert.equal(res.code, 302);
  assert.deepEqual(st.created, [PREVIEW_ENV.STRIPE_SECRET_KEY]);
  assert.ok(sb.calls.length >= 2);
  assert.ok(sb.calls.every((c) => c.url.startsWith(PREVIEW_ENV.SUPABASE_URL + '/')), 'Preview の Supabase だけ');
  const token = decodeURIComponent(res.headers.Location.split('token=')[1]);
  assert.equal(decodeToken(token).env, 'preview');
}));

test('verify Preview：Live の Session ID（cs_live_）は Stripe・Supabase へ問い合わせずに拒否', silenced(async () => {
  const sb = fakeSupabase();
  const st = fakeStripe(paidSession({ price: TEST_CORE1_PRICE, livemode: false }));
  const res = makeRes();
  await verify.createHandler({ env: PREVIEW_ENV, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
    { method: 'GET', query: { session_id: 'cs_live_fakesession000001' }, headers: {} }, res);
  assert.equal(res.code, 400);
  assert.equal(st.retrieved.length + sb.calls.length, 0);
}));

test('verify Production：Test の Session ID（cs_test_）は拒否', silenced(async () => {
  const sb = fakeSupabase();
  const st = fakeStripe(paidSession({ price: LIVE_CORE1_PRICE, livemode: true }));
  const res = makeRes();
  await verify.createHandler({ env: PROD_ENV, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
    { method: 'GET', query: { session_id: 'cs_test_fakesession000001' }, headers: {} }, res);
  assert.equal(res.code, 400);
  assert.equal(st.retrieved.length + sb.calls.length, 0);
}));

for (const [name, env] of [
  ['Preview に Live のキー（rk_live_）', { ...PREVIEW_ENV, STRIPE_SECRET_KEY: 'rk_live_fake' }],
  ['Preview に Live のキー（sk_live_）', { ...PREVIEW_ENV, STRIPE_SECRET_KEY: 'sk_live_fake' }],
  ['Preview に STRIPE_MODE=live', { ...PREVIEW_ENV, STRIPE_MODE: 'live' }],
  ['Production に Test のキー', { ...PROD_ENV, STRIPE_SECRET_KEY: 'sk_test_fake' }],
  ['Production に STRIPE_MODE=test', { ...PROD_ENV, STRIPE_MODE: 'test' }],
  ['STRIPE_MODE 未設定', { ...PROD_ENV, STRIPE_MODE: undefined }],
  ['REPORT_TOKEN_SECRET 未設定', { ...PREVIEW_ENV, REPORT_TOKEN_SECRET: undefined }],
]) {
  test(`verify：${name} → 503（Stripe・Supabase へ接続しない）`, silenced(async () => {
    const sb = fakeSupabase();
    const st = fakeStripe(paidSession({ price: TEST_CORE1_PRICE, livemode: false }));
    const res = makeRes();
    await verify.createHandler({ env, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
      { method: 'GET', query: { session_id: 'cs_test_fakesession000001' }, headers: {} }, res);
    assert.equal(res.code, 503);
    assert.equal(st.created.length + st.retrieved.length + sb.calls.length, 0);
  }));
}

test('verify Production：制限付きキー rk_live_ を Live と判定し、Live の Price 表で処理する（以前は Test と誤判定）', silenced(async () => {
  const sb = fakeSupabase();
  const st = fakeStripe(paidSession({ price: LIVE_CORE1_PRICE, livemode: true }));
  const res = makeRes();
  const env = { ...PROD_ENV, STRIPE_SECRET_KEY: 'rk_live_fake_restricted' };
  await verify.createHandler({ env, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
    { method: 'GET', query: { session_id: 'cs_live_fakesession000001' }, headers: {} }, res);
  assert.equal(res.code, 302);
  assert.ok(sb.calls.every((c) => c.url.startsWith(PROD_ENV.SUPABASE_URL + '/')));
  const token = decodeURIComponent(res.headers.Location.split('token=')[1]);
  assert.equal(decodeToken(token).env, 'production');
  assert.equal(verify.priceMapFor('live')[LIVE_CORE1_PRICE], 'core1');
  assert.equal(verify.priceMapFor('test')[LIVE_CORE1_PRICE], undefined);
}));

test('verify：Stripe の livemode が環境と食い違えば 503（Supabase へ書かない）', silenced(async () => {
  const sb = fakeSupabase();
  const st = fakeStripe(paidSession({ price: TEST_CORE1_PRICE, livemode: true }));
  const res = makeRes();
  await verify.createHandler({ env: PREVIEW_ENV, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
    { method: 'GET', query: { session_id: 'cs_test_fakesession000001' }, headers: {} }, res);
  assert.equal(res.code, 503);
  assert.equal(sb.calls.length, 0);
}));

// ---- report-data：環境ごとのトークン ----
async function callReportData(env, token, sb = fakeSupabase({ rows: { entitlements: [{ product_type: 'core1' }] } })) {
  const res = makeRes();
  await reportData.createHandler({ env, fetchImpl: sb.fetchImpl })({ method: 'GET', query: { token }, headers: {} }, res);
  return { res, sb };
}

test('report-data：Preview で発行したトークンは Preview で開ける。Preview の Supabase だけを読む', silenced(async () => {
  const sb = fakeSupabase();
  const st = fakeStripe(paidSession({ price: TEST_CORE1_PRICE, livemode: false }));
  const vres = makeRes();
  await verify.createHandler({ env: PREVIEW_ENV, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory })(
    { method: 'GET', query: { session_id: 'cs_test_fakesession000001' }, headers: {} }, vres);
  const token = decodeURIComponent(vres.headers.Location.split('token=')[1]);
  const { res, sb: rsb } = await callReportData(PREVIEW_ENV, token);
  assert.equal(res.code, 200);
  assert.equal(res.body.code, 'ABCDEF');
  assert.ok(rsb.calls.every((c) => c.url.startsWith(PREVIEW_ENV.SUPABASE_URL + '/')));
}));

test('report-data：別環境のトークンは開けない（鍵が別なら署名で、同じ鍵でも env で拒否）', silenced(async () => {
  // 本番の鍵で署名したトークンは Preview では署名不一致
  const prodSigned = signWith(PROD_ENV.REPORT_TOKEN_SECRET, { exp: Date.now() + 60000, env: 'production', code: 'X' });
  assert.equal((await callReportData(PREVIEW_ENV, prodSigned)).res.code, 403);
  // 万一同じ鍵でも、env=production のトークンは Preview で受け付けない（DB も読まない）
  const sameKey = signWith(PREVIEW_ENV.REPORT_TOKEN_SECRET, { exp: Date.now() + 60000, env: 'production', code: 'X' });
  const r = await callReportData(PREVIEW_ENV, sameKey);
  assert.equal(r.res.code, 403);
  assert.equal(r.sb.calls.length, 0);
  // env を持たない旧形式トークンは従来どおり（legacy_floor）
  const legacy = signWith(PROD_ENV.REPORT_TOKEN_SECRET, { exp: Date.now() + 60000, code: 'LEGACY1' });
  const l = await callReportData(PROD_ENV, legacy, fakeSupabase());
  assert.equal(l.res.code, 200);
  assert.equal(l.res.body.code, 'LEGACY1');
  assert.equal(l.res.body.entitlements.core_analysis_access, true);
}));

// ---- my-report-link・my-entitlements・subscribe：正常系は検査済みの接続先だけを使う ----
test('my-report-link Preview：Preview の Supabase だけを使い、env=preview のトークンを発行する', silenced(async () => {
  const sb = fakeSupabase({ rows: {
    sessions: [{ id: 's-1', diagnosis_version: 'ETI-2.0', diagnosis_answers: [{ encoded_answers: 'ABCDEF' }] }],
    entitlements: [{ product_type: 'core1' }],
  } });
  const res = makeRes();
  await myReportLink.createHandler({ env: PREVIEW_ENV, fetchImpl: sb.fetchImpl })(
    { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { diagnosis_session_id: 's-1' } }, res);
  assert.equal(res.code, 200);
  assert.ok(sb.calls.every((c) => c.url.startsWith(PREVIEW_ENV.SUPABASE_URL + '/')));
  const token = decodeURIComponent(res.body.url.split('token=')[1]);
  assert.equal(decodeToken(token).env, 'preview');
  assert.equal((await callReportData(PREVIEW_ENV, token)).res.code, 200);
}));

test('my-entitlements Production：本番の Supabase だけを使う', silenced(async () => {
  const sb = fakeSupabase({ rows: {
    sessions: [{ diagnosis_version: 'ETI-2.0', diagnosis_answers: [{ encoded_answers: 'ABCDEF' }] }],
    entitlements: [{ diagnosis_code_hash: crypto.createHash('sha256').update('v2_ABCDEF').digest('hex'), product_type: 'core1' }],
  } });
  const res = makeRes();
  await myEntitlements.createHandler({ env: PROD_ENV, fetchImpl: sb.fetchImpl })(
    { method: 'GET', headers: { authorization: 'Bearer good-token' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { purchased_by_version: { 'ETI-2.0:ABCDEF': true } });
  assert.ok(sb.calls.every((c) => c.url.startsWith(PROD_ENV.SUPABASE_URL + '/')));
}));

test('subscribe Preview：Preview の Supabase だけを読む（Kit は許可リストのメールだけ）', silenced(async () => {
  const sb = fakeSupabase();
  const res = makeRes();
  await subscribe.createHandler({ env: { ...PREVIEW_ENV, KIT_API_KEY: 'kit_fake' }, fetchImpl: sb.fetchImpl })(
    { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { consentVersion: subscribe.CONSENT_VERSION } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, skipped: 'preview_guard' });
  assert.ok(sb.calls.every((c) => c.url.startsWith(PREVIEW_ENV.SUPABASE_URL + '/')));
}));

// ---- Supabase へのヘッダー：管理者アクセスとログインユーザーのアクセスを分け、キーの形式に合わせる ----
const SCENARIOS = {
  verify: (env, sb) => {
    const live = env.STRIPE_MODE === 'live';
    const st = fakeStripe(paidSession({ price: live ? LIVE_CORE1_PRICE : TEST_CORE1_PRICE, livemode: live }));
    return [verify.createHandler({ env, fetchImpl: sb.fetchImpl, stripeFactory: st.stripeFactory }),
      { method: 'GET', query: { session_id: `${live ? 'cs_live_' : 'cs_test_'}fakesession000001` }, headers: {} }, 302];
  },
  'report-data': (env, sb) => [reportData.createHandler({ env, fetchImpl: sb.fetchImpl }),
    { method: 'GET', query: { token: signWith(env.REPORT_TOKEN_SECRET, { exp: Date.now() + 60000, code: 'X' }) }, headers: {} }, 200],
  'my-entitlements': (env, sb) => [myEntitlements.createHandler({ env, fetchImpl: sb.fetchImpl }),
    { method: 'GET', headers: { authorization: 'Bearer good-token' } }, 200],
  'my-report-link': (env, sb) => [myReportLink.createHandler({ env, fetchImpl: sb.fetchImpl }),
    { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { diagnosis_session_id: 's-1' } }, 200],
  subscribe: (env, sb) => [subscribe.createHandler({ env: { ...env, KIT_API_KEY: 'kit_fake' }, fetchImpl: sb.fetchImpl }),
    { method: 'POST', headers: { authorization: 'Bearer good-token' }, body: { consentVersion: subscribe.CONSENT_VERSION } }, 200],
};
const SCENARIO_ROWS = {
  sessions: [{ id: 's-1', diagnosis_version: 'ETI-2.0', diagnosis_answers: [{ encoded_answers: 'ABCDEF' }] }],
  entitlements: [{ product_type: 'core1', diagnosis_code_hash: crypto.createHash('sha256').update('v2_ABCDEF').digest('hex') }],
};

function supabaseCalls(sb, env) {
  return sb.calls.filter((c) => c.url.startsWith(env.SUPABASE_URL + '/'));
}

for (const [apiName, scenario] of Object.entries(SCENARIOS)) {
  test(`${apiName} Preview（sb_secret_）：管理者アクセスは apikey だけ・Authorization なし。本人確認は公開キー＋ユーザーJWT`, silenced(async (logs) => {
    const sb = fakeSupabase({ rows: SCENARIO_ROWS });
    const [handler, req, expected] = scenario(PREVIEW_ENV, sb);
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.code, expected);
    const calls = supabaseCalls(sb, PREVIEW_ENV);
    assert.ok(calls.length >= 1);
    for (const c of calls) {
      const h = c.opts.headers;
      if (c.url.endsWith('/auth/v1/user')) {
        assert.equal(h.apikey, PREVIEW_ENV.SUPABASE_ANON_KEY, 'ユーザー確認の apikey は公開キー');
        assert.equal(h.Authorization, 'Bearer good-token');
      } else {
        assert.equal(h.apikey, PREVIEW_ENV.SUPABASE_SECRET_KEY);
        assert.equal(h.Authorization, undefined, 'sb_secret_ を Authorization に入れない');
      }
      // サーバー用キーとユーザーの token を同じリクエストに混ぜない
      const values = Object.values(h).join(' ');
      assert.ok(!(values.includes(PREVIEW_ENV.SUPABASE_SECRET_KEY) && values.includes('good-token')), c.url);
    }
    if (['my-entitlements', 'my-report-link', 'subscribe'].includes(apiName)) {
      assert.ok(calls.some((c) => c.url.endsWith('/auth/v1/user')), '本人確認をしている');
    }
    const text = logs.join('\n') + JSON.stringify(res.body || '') + JSON.stringify(res.headers);
    assert.ok(!text.includes(PREVIEW_ENV.SUPABASE_SECRET_KEY) && !text.includes('sb_secret_'));
  }));

  test(`${apiName} Production（旧 service_role JWT）：従来どおり apikey と Authorization の両方。本人確認は公開キー＋ユーザーJWT`, silenced(async (logs) => {
    const sb = fakeSupabase({ rows: SCENARIO_ROWS });
    const [handler, req, expected] = scenario(PROD_ENV, sb);
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.code, expected);
    const key = PROD_ENV.SUPABASE_SERVICE_ROLE_KEY;
    for (const c of supabaseCalls(sb, PROD_ENV)) {
      const h = c.opts.headers;
      if (c.url.endsWith('/auth/v1/user')) {
        assert.deepEqual(h, { apikey: PROD_ENV.SUPABASE_ANON_KEY, Authorization: 'Bearer good-token' });
      } else {
        assert.equal(h.apikey, key);
        assert.equal(h.Authorization, `Bearer ${key}`);
      }
    }
    const text = logs.join('\n') + JSON.stringify(res.body || '') + JSON.stringify(res.headers);
    assert.ok(!text.includes(key));
  }));
}

test('両方のサーバー用キーが設定されていれば SUPABASE_SECRET_KEY を使い、どちらの値もログ・応答に出さない', silenced(async (logs) => {
  const legacy = fakeJwt({ iss: 'supabase', ref: PREVIEW_REF, role: 'service_role' });
  const env = { ...PREVIEW_ENV, SUPABASE_SERVICE_ROLE_KEY: legacy };
  const sb = fakeSupabase({ rows: SCENARIO_ROWS });
  const res = makeRes();
  await myEntitlements.createHandler({ env, fetchImpl: sb.fetchImpl })({ method: 'GET', headers: { authorization: 'Bearer good-token' } }, res);
  assert.equal(res.code, 200);
  const admin = sb.calls.filter((c) => c.url.includes('/rest/v1/'));
  assert.ok(admin.length >= 1);
  for (const c of admin) assert.deepEqual(c.opts.headers, { apikey: PREVIEW_ENV.SUPABASE_SECRET_KEY });
  assert.ok(sb.calls.every((c) => !JSON.stringify(c.opts.headers).includes(legacy)));
  const text = logs.join('\n') + JSON.stringify(res.body);
  assert.ok(!text.includes(legacy) && !text.includes(PREVIEW_ENV.SUPABASE_SECRET_KEY) && !text.includes('sb_secret_'));
}));
