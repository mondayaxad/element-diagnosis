// api/subscribe.js（Kit 登録API）の安全化のテスト。Kit・Supabase への通信はすべて偽の fetch。
//   実行: node --test tests/subscribe_api.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createHandler, CONSENT_VERSION } = require(path.join(__dirname, '..', 'api', 'subscribe.js'));

const KEY = 'kit_secret_for_test_only';
const USER = { id: 'user-1', email: 'owner@example.test' };
const { PROD_ENV, PREVIEW_ENV } = require('./fixtures/server_env');
const baseEnv = { ...PROD_ENV, KIT_API_KEY: KEY };

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// profile: profiles 行（null で行なし）／ profileStatus: profiles 読み取りの HTTP ステータス
function harness({ env = {}, user = USER, profile = { newsletter_opted_in: true, newsletter_consent_version: CONSENT_VERSION },
  profileStatus = 200, kitLookup = { subscribers: [] }, kitLookupStatus = 200, kitCreateStatus = 201 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/v1/user')) {
      const auth = opts.headers.Authorization;
      return auth === 'Bearer good-token' && user ? json(200, user) : json(401, { msg: 'invalid' });
    }
    if (url.includes('/rest/v1/profiles')) {
      if (profileStatus !== 200) return json(profileStatus, { message: 'column does not exist' });
      return json(200, profile ? [profile] : []);
    }
    if (url.startsWith('https://api.kit.com/v4/subscribers?')) return json(kitLookupStatus, kitLookup);
    if (url === 'https://api.kit.com/v4/subscribers') return json(kitCreateStatus, { subscriber: { id: 1 } });
    throw new Error('unexpected fetch ' + url);
  };
  const handler = createHandler({ fetchImpl, env: { ...baseEnv, ...env } });
  async function call({ token = 'good-token', body = { consentVersion: CONSENT_VERSION }, method = 'POST' } = {}) {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, body }, res);
    return res;
  }
  const kitCalls = () => calls.filter((c) => c.url.startsWith('https://api.kit.com'));
  const kitCreates = () => calls.filter((c) => c.url === 'https://api.kit.com/v4/subscribers');
  return { call, calls, kitCalls, kitCreates };
}

test('未認証は 401、Kit を呼ばない', async () => {
  const h = harness();
  const r1 = await h.call({ token: null });
  assert.equal(r1.code, 401); assert.deepEqual(r1.body, { error: 'unauthorized' });
  const r2 = await h.call({ token: 'forged' });
  assert.equal(r2.code, 401);
  assert.equal(h.kitCalls().length, 0);
});

test('body に他人のメールを入れても、登録先は認証済み本人のメールだけ', async () => {
  const h = harness();
  const r = await h.call({ body: { consentVersion: CONSENT_VERSION, email: 'victim@example.test', email_address: 'victim@example.test' } });
  assert.equal(r.code, 200);
  const creates = h.kitCreates();
  assert.equal(creates.length, 1);
  assert.equal(JSON.parse(creates[0].opts.body).email_address, USER.email);
  assert.ok(!h.calls.some((c) => String(c.url).includes('victim') || String(c.opts.body || '').includes('victim')));
});

test('DB の同意が false／null／版違い／行なしなら 403、Kit を呼ばない', async () => {
  for (const profile of [
    { newsletter_opted_in: false, newsletter_consent_version: CONSENT_VERSION },
    { newsletter_opted_in: null, newsletter_consent_version: null },
    { newsletter_opted_in: 'true', newsletter_consent_version: CONSENT_VERSION },
    { newsletter_opted_in: true, newsletter_consent_version: 'old' },
    null,
  ]) {
    const h = harness({ profile });
    const r = await h.call();
    assert.equal(r.code, 403, JSON.stringify(profile)); assert.deepEqual(r.body, { error: 'consent_required' });
    assert.equal(h.kitCalls().length, 0);
  }
});

test('同意列を読めない（列が無い等）場合は fail-closed（403・Kit を呼ばない）', async () => {
  const h = harness({ profileStatus: 400 });
  const r = await h.call();
  assert.equal(r.code, 403);
  assert.equal(h.kitCalls().length, 0);
});

test('同意版が無い・違う request は 400', async () => {
  const h = harness();
  assert.equal((await h.call({ body: {} })).code, 400);
  assert.equal((await h.call({ body: 'not json' })).code, 400);
  assert.equal(h.kitCalls().length, 0);
});

test('KIT_API_KEY 未設定なら Kit を呼ばず、秘密を漏らさない', async () => {
  const logs = [];
  const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
  try {
    const h = harness({ env: { KIT_API_KEY: '' } });
    const r = await h.call();
    assert.equal(r.code, 503); assert.deepEqual(r.body, { error: 'kit_not_configured' });
    assert.equal(h.kitCalls().length, 0);
  } finally { console.error = orig; }
  assert.ok(!logs.join('\n').includes('svc_test'));
});

test('Kit 4xx/5xx は 502。レスポンス・ログにメール・秘密・Kit本文を出さない', async () => {
  for (const opts of [{ kitCreateStatus: 422 }, { kitCreateStatus: 500 }, { kitLookupStatus: 503 }]) {
    const logs = [];
    const orig = console.error; console.error = (...a) => logs.push(a.join(' '));
    let r;
    try { r = await harness(opts).call(); } finally { console.error = orig; }
    assert.equal(r.code, 502); assert.deepEqual(r.body, { error: 'kit_error' });
    const all = logs.join('\n') + JSON.stringify(r.body);
    for (const secret of [USER.email, KEY, 'svc_test', 'good-token']) assert.ok(!all.includes(secret), secret);
  }
});

test('配信停止済み（active 以外）は再登録しない', async () => {
  for (const state of ['cancelled', 'inactive', 'bounced', 'complained']) {
    const h = harness({ kitLookup: { subscribers: [{ id: 9, email_address: USER.email, state }] } });
    const r = await h.call();
    assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true, skipped: 'not_reactivated' });
    assert.equal(h.kitCreates().length, 0, state);
  }
});

test('重複処理：既に active なら作り直さない（2回呼んでも作成は0回）', async () => {
  const h = harness({ kitLookup: { subscribers: [{ id: 9, email_address: USER.email, state: 'active' }] } });
  assert.deepEqual((await h.call()).body, { ok: true, already: true });
  assert.deepEqual((await h.call()).body, { ok: true, already: true });
  assert.equal(h.kitCreates().length, 0);
});

test('同意 true・未登録なら、Kit 作成を1回だけ呼ぶ（API key はヘッダーだけ）', async () => {
  const h = harness();
  const r = await h.call();
  assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true });
  const creates = h.kitCreates();
  assert.equal(creates.length, 1);
  assert.equal(creates[0].opts.headers['X-Kit-Api-Key'], KEY);
  assert.deepEqual(JSON.parse(creates[0].opts.body), { email_address: USER.email, state: 'active' });
});

test('Preview ガード：許可リストに無いメールは Kit を呼ばない／許可したテスト用メールだけ送る', async () => {
  const h1 = harness({ env: { ...PREVIEW_ENV, KIT_PREVIEW_ALLOWED_EMAILS: '' } });
  const r1 = await h1.call();
  assert.deepEqual(r1.body, { ok: true, skipped: 'preview_guard' });
  assert.equal(h1.kitCalls().length, 0);
  // 環境不明は環境ガードで止める（503）。Supabase・Kit のどちらにも接続しない
  const h2 = harness({ env: { VERCEL_ENV: undefined } });
  const r2 = await h2.call();
  assert.equal(r2.code, 503);
  assert.equal(r2.body.error, 'service_unavailable');
  assert.equal(h2.calls.length, 0);
  const h3 = harness({ env: { ...PREVIEW_ENV, KIT_PREVIEW_ALLOWED_EMAILS: 'someone@x.test, OWNER@example.test' } });
  assert.deepEqual((await h3.call()).body, { ok: true });
  assert.equal(h3.kitCreates().length, 1);
});

test('POST 以外は 405', async () => {
  assert.equal((await harness().call({ method: 'GET' })).code, 405);
});
