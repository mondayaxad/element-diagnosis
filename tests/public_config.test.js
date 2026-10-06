// api/public-config.js のテスト。返す項目は4つだけ、サーバー専用キーを返さない・読まない、
// 環境の取り違え・設定不足では 503 で止める。外部へは接続しない。
//   実行: node --test tests/public_config.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC_PATH = path.join(__dirname, '..', 'api', 'public-config.js');
const { createHandler } = require(SRC_PATH);
const { PROD_REF, PREVIEW_REF, PROD_ENV, PREVIEW_ENV, fakeJwt } = require('./fixtures/server_env');

const ALLOWED_KEYS = ['appEnv', 'projectRef', 'supabaseAnonKey', 'supabaseUrl'];

function call(env, { url = '/api/public-config', method = 'GET', host = 'element-diagnosis.example.test', query } = {}) {
  const res = {
    code: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.code = c; return this; },
    end(b) { this.body = b || ''; },
  };
  const q = query || Object.fromEntries(new URL(url, 'http://x').searchParams);
  createHandler({ env })({ method, url, query: q, headers: { host } }, res);
  return res;
}

function runJs(body) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(body, ctx);
  return ctx.window.__ED_PUBLIC_CONFIG__;
}

test('ソースにサーバー専用キーの変数名が無い（読まない）', () => {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  assert.ok(!/SERVICE_ROLE|service_role|SUPABASE_SECRET_KEY|STRIPE_SECRET|REPORT_TOKEN_SECRET|KIT_API_KEY/.test(src));
});

test('Production：本番の URL・公開キー・環境名・Ref の4項目だけを返す', () => {
  const r = call(PROD_ENV);
  assert.equal(r.code, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual(Object.keys(body).sort(), ALLOWED_KEYS);
  assert.deepEqual(body, {
    appEnv: 'production', supabaseUrl: `https://${PROD_REF}.supabase.co`,
    supabaseAnonKey: PROD_ENV.SUPABASE_ANON_KEY, projectRef: PROD_REF,
  });
});

test('Preview：Preview の4項目。環境変数にある秘密値はどれも応答に含めない', () => {
  const env = { ...PREVIEW_ENV, KIT_API_KEY: 'kit_fake_secret', SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-fake' };
  for (const url of ['/api/public-config', '/api/public-config?format=js']) {
    const r = call(env, { url });
    assert.equal(r.code, 200);
    for (const secret of [env.SUPABASE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.STRIPE_SECRET_KEY, env.REPORT_TOKEN_SECRET, env.KIT_API_KEY, 'sb_secret_']) {
      assert.ok(!r.body.includes(secret), `${url}: ${secret}`);
    }
  }
  assert.equal(JSON.parse(call(env).body).projectRef, PREVIEW_REF);
});

test('format=js：window.__ED_PUBLIC_CONFIG__ を凍結したオブジェクトで設定する', () => {
  const r = call(PREVIEW_ENV, { url: '/api/public-config?format=js' });
  assert.equal(r.code, 200);
  assert.match(r.headers['content-type'], /^application\/javascript/);
  const cfg = runJs(r.body);
  assert.deepEqual(Object.keys(cfg).sort(), ALLOWED_KEYS);
  assert.equal(cfg.appEnv, 'preview');
  assert.ok(Object.isFrozen(cfg));
  // query が無い場合も URL から format を読む
  assert.equal(runJs(call(PREVIEW_ENV, { url: '/api/public-config?format=js', query: {} }).body).projectRef, PREVIEW_REF);
});

test('ヘッダー：Cache-Control: no-store と X-Content-Type-Options: nosniff（成功・失敗とも）', () => {
  for (const env of [PREVIEW_ENV, { ...PREVIEW_ENV, VERCEL_ENV: 'staging' }]) {
    for (const url of ['/api/public-config', '/api/public-config?format=js']) {
      const r = call(env, { url });
      assert.match(r.headers['cache-control'], /no-store/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
  }
  assert.match(call(PREVIEW_ENV).headers['content-type'], /^application\/json/);
});

const DENY = [
  ['Preview で本番 Ref', { ...PREVIEW_ENV, SUPABASE_URL: PROD_ENV.SUPABASE_URL }],
  ['Preview で本番 Ref（期待 Ref も本番）', { ...PREVIEW_ENV, SUPABASE_URL: PROD_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PROD_REF }],
  ['Production で Preview Ref', { ...PROD_ENV, SUPABASE_URL: PREVIEW_ENV.SUPABASE_URL }],
  ['Production で Preview Ref（期待 Ref も Preview）', { ...PROD_ENV, SUPABASE_URL: PREVIEW_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PREVIEW_REF }],
  ['環境不明', { ...PREVIEW_ENV, VERCEL_ENV: undefined }],
  ['development（ローカル許可なし）', { ...PREVIEW_ENV, VERCEL_ENV: 'development' }],
  ['期待 Ref 未設定', { ...PREVIEW_ENV, SUPABASE_EXPECTED_PROJECT_REF: '' }],
  ['Production で Preview Ref の変数が未設定', { ...PROD_ENV, SUPABASE_PREVIEW_PROJECT_REF: undefined }],
  ['URL と Ref の不一致', { ...PREVIEW_ENV, SUPABASE_URL: 'https://otherref000000000000.supabase.co' }],
  ['URL の形式不正', { ...PREVIEW_ENV, SUPABASE_URL: 'https://example.test' }],
  ['公開キーが未設定', { ...PREVIEW_ENV, SUPABASE_ANON_KEY: undefined }],
  ['公開キーに秘密キー（sb_secret_）', { ...PREVIEW_ENV, SUPABASE_ANON_KEY: 'sb_secret_leak_fake' }],
  ['公開キーに service_role の JWT', { ...PREVIEW_ENV, SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role', ref: PREVIEW_REF }) }],
  ['公開キーが別プロジェクトの anon JWT', { ...PREVIEW_ENV, SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: PROD_REF }) }],
];

for (const [name, env] of DENY) {
  test(`503 で止める：${name}`, () => {
    const errors = [];
    const orig = console.error;
    console.error = (s) => errors.push(String(s));
    try {
      const j = call(env);
      assert.equal(j.code, 503);
      const body = JSON.parse(j.body);
      assert.equal(body.error, 'config_unavailable');
      assert.deepEqual(Object.keys(body).sort(), ['error', 'incident_id']);
      const js = call(env, { url: '/api/public-config?format=js' });
      assert.equal(js.code, 503);
      assert.equal(runJs(js.body), null);
      for (const s of [PROD_ENV.SUPABASE_URL, PREVIEW_ENV.SUPABASE_URL, env.SUPABASE_ANON_KEY || 'x-none', 'sb_secret_']) {
        assert.ok(!j.body.includes(s) && !js.body.includes(s), s);
        assert.ok(errors.every((e) => !e.includes(s)), `log: ${s}`);
      }
      assert.ok(errors.length >= 1 && errors.every((e) => JSON.parse(e).event === 'env_guard_denied'));
    } finally {
      console.error = orig;
    }
  });
}

test('localhost は ALLOW_LOCAL_DEVELOPMENT=1 かつ Host が localhost のときだけ（Preview と同じ接続先の規則）', () => {
  const env = { ...PREVIEW_ENV, VERCEL_ENV: 'development', ALLOW_LOCAL_DEVELOPMENT: '1' };
  const ok = call(env, { host: 'localhost:3000' });
  assert.equal(ok.code, 200);
  assert.equal(JSON.parse(ok.body).appEnv, 'development');
  const orig = console.error; console.error = () => {};
  try {
    assert.equal(call(env, { host: 'element-diagnosis.example.test' }).code, 503);
    assert.equal(call({ ...env, SUPABASE_URL: PROD_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PROD_REF }, { host: 'localhost' }).code, 503);
  } finally { console.error = orig; }
});

test('GET・HEAD 以外は 405', () => {
  const r = call(PREVIEW_ENV, { method: 'POST' });
  assert.equal(r.code, 405);
  assert.ok(!r.body.includes(PREVIEW_ENV.SUPABASE_ANON_KEY));
});
