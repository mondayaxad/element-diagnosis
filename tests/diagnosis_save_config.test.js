// diagnosis-save.js の接続先設定（/api/public-config から受け取る）のテスト。
// 直書きの接続先へフォールバックしないこと、設定が無い・食い違うときは Supabase の処理を止めることを確かめる。
//   実行: node --test tests/diagnosis_save_config.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PROD_REF, PREVIEW_REF } = require('./fixtures/server_env');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'diagnosis-save.js'), 'utf8');

const PREVIEW_CFG = { appEnv: 'preview', supabaseUrl: `https://${PREVIEW_REF}.supabase.co`, supabaseAnonKey: 'sb_publishable_preview_fake_for_test', projectRef: PREVIEW_REF };
const PROD_CFG = { appEnv: 'production', supabaseUrl: `https://${PROD_REF}.supabase.co`, supabaseAnonKey: 'sb_publishable_prod_fake_for_test', projectRef: PROD_REF };

function load({ config, hostname = 'element-diagnosis-git-release-c-preview.example.test' } = {}) {
  const created = [];
  const ctx = {
    console: { error() {}, log() {}, warn() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    crypto: { randomUUID: () => 'uuid-1' }, document: { getElementById: () => null },
    location: { origin: 'https://' + hostname, hostname }, URLSearchParams, Date, JSON, Promise, Proxy,
  };
  ctx.window = ctx;
  if (config !== undefined) ctx.__ED_PUBLIC_CONFIG__ = config;
  ctx.window.supabase = {
    createClient: (url, key) => {
      created.push({ url, key });
      return { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  // トップレベルの const は context のプロパティにならないため、評価して取り出す
  const client = vm.runInContext('supabaseClient', ctx);
  return { ctx, created, client };
}

test('直書きの Supabase URL・公開キーが無い（本番・旧プロジェクトの Ref を含む）', () => {
  assert.ok(!/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(SRC), 'URL の直書きなし');
  assert.ok(!/sb_publishable_[A-Za-z0-9_]+'/.test(SRC), '公開キーの直書きなし');
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(SRC), 'JWT の直書きなし');
});

test('index.html・mypage.html：public-config を supabase-js の後、diagnosis-save.js の前に同期で読む', () => {
  for (const f of ['index.html', 'mypage.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const lib = html.indexOf('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>');
    const cfg = html.indexOf('<script src="/api/public-config?format=js"></script>');
    const save = html.indexOf('<script src="diagnosis-save.js"></script>');
    assert.ok(lib >= 0 && cfg > lib && save > cfg, f);
    assert.equal(html.split('/api/public-config').length - 1, 1, `${f}: 1回だけ`);
  }
});

test('Preview の設定：Preview の URL・公開キーで接続する', () => {
  const { created, client } = load({ config: PREVIEW_CFG });
  assert.deepEqual(created, [{ url: PREVIEW_CFG.supabaseUrl, key: PREVIEW_CFG.supabaseAnonKey }]);
  assert.ok(!client.unavailable);
});

test('本番ホストでは production の設定だけで接続する', () => {
  const { created } = load({ config: PROD_CFG, hostname: 'element-diagnosis-five.vercel.app' });
  assert.deepEqual(created, [{ url: PROD_CFG.supabaseUrl, key: PROD_CFG.supabaseAnonKey }]);
});

const STOP = [
  ['設定なし（public-config の取得失敗）', undefined],
  ['設定が null（public-config が 503）', null],
  ['環境名が想定外', { ...PREVIEW_CFG, appEnv: 'staging' }],
  ['URL と Ref の不一致', { ...PREVIEW_CFG, supabaseUrl: `https://${PROD_REF}.supabase.co` }],
  ['URL の形式不正', { ...PREVIEW_CFG, supabaseUrl: 'https://evil.example.test' }],
  ['公開キーに秘密キー', { ...PREVIEW_CFG, supabaseAnonKey: 'sb_secret_fake' }],
  ['本番以外のホストで production の設定', PROD_CFG],
];
for (const [name, config] of STOP) {
  test(`接続しない：${name}`, async () => {
    const { created, client } = load({ config });
    assert.equal(created.length, 0, 'createClient を呼ばない');
    assert.equal(client.unavailable, true);
  });
}

test('本番ホストで preview の設定なら接続しない', () => {
  const { created, client } = load({ config: PREVIEW_CFG, hostname: 'element-diagnosis-five.vercel.app' });
  assert.equal(created.length, 0);
  assert.equal(client.unavailable, true);
});

test('代用クライアント：ログイン・保存・読み取りは config_unavailable で失敗し、例外を投げない', async () => {
  const { ctx, client: c } = load({ config: undefined });
  const sess = await c.auth.getSession();
  assert.equal(sess.data.session, null);
  assert.equal(sess.error.code, 'config_unavailable');
  assert.equal((await c.auth.getUser()).data.user, null);
  assert.equal((await c.auth.signInWithOAuth({ provider: 'google' })).error.code, 'config_unavailable');
  assert.equal((await c.auth.signInWithOtp({ email: 'x@example.test' })).error.code, 'config_unavailable');
  assert.equal((await c.rpc('save_diagnosis_session', {})).error.code, 'config_unavailable');
  const q = await c.from('profiles').select('x').eq('id', '1').single();
  assert.equal(q.data, null);
  assert.equal(q.error.code, 'config_unavailable');
  assert.equal(typeof c.auth.onAuthStateChange(() => {}).data.subscription.unsubscribe, 'function');
  assert.equal(await ctx.getCurrentUser(), null);
});

// ---- 実ブラウザ：実物の api/public-config.js を同期スクリプトとして読み込む ----
let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const http = require('http');
const { createHandler: createPublicConfig } = require(path.join(ROOT, 'api', 'public-config.js'));
const { PREVIEW_ENV, PROD_ENV } = require('./fixtures/server_env');

// supabase-js の代わりに、createClient の呼び出しを記録するだけの偽物
const FAKE_SUPABASE_JS = `window.__created = []; window.supabase = { createClient(url, key) { window.__created.push({ url, key });
  return { auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } }; } };`;
const PAGE = `<!doctype html><meta charset="utf-8"><script src="/fake-supabase.js"></script>
<script src="/api/public-config?format=js"></script><script src="/diagnosis-save.js"></script>`;

function startServer(env) {
  const handler = createPublicConfig({ env });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/public-config') {
      // Vercel の res.status を最小限で再現する
      res.status = (c) => { res.statusCode = c; return res; };
      req.query = Object.fromEntries(url.searchParams);
      return handler(req, res);
    }
    const body = url.pathname === '/fake-supabase.js' ? FAKE_SUPABASE_JS
      : url.pathname === '/diagnosis-save.js' ? SRC : url.pathname === '/' ? PAGE : null;
    if (body === null) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', url.pathname === '/' ? 'text/html; charset=utf-8' : 'application/javascript');
    res.end(body);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function openPage(env) {
  const server = await startServer(env);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const responses = [];
    page.on('response', (r) => { if (r.url().includes('/api/public-config')) responses.push(r); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const state = await page.evaluate(() => ({
      config: window.__ED_PUBLIC_CONFIG__ === undefined ? 'undefined' : window.__ED_PUBLIC_CONFIG__,
      created: window.__created,
      unavailable: !!(typeof supabaseClient !== 'undefined' && supabaseClient.unavailable),
    }));
    const r = responses[0];
    return { state, status: r.status(), headers: r.headers() };
  } finally {
    await browser.close();
    server.close();
  }
}

test('ブラウザ：public-config を同期スクリプトとして読み込み、Preview の接続先で createClient する', { skip: !chromium }, async () => {
  const { state, status, headers } = await openPage(PREVIEW_ENV);
  assert.equal(status, 200);
  assert.match(headers['content-type'], /^application\/javascript/);
  assert.match(headers['cache-control'], /no-store/);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(Object.keys(state.config).sort(), ['appEnv', 'projectRef', 'supabaseAnonKey', 'supabaseUrl']);
  assert.deepEqual(state.created, [{ url: PREVIEW_ENV.SUPABASE_URL, key: PREVIEW_ENV.SUPABASE_ANON_KEY }]);
  assert.equal(state.unavailable, false);
});

test('ブラウザ：Preview で本番 Ref の設定なら public-config は 503、Supabase へ接続しない（fail-closed）', { skip: !chromium }, async () => {
  const orig = console.error; console.error = () => {};
  try {
    const { state, status } = await openPage({ ...PREVIEW_ENV, SUPABASE_URL: PROD_ENV.SUPABASE_URL });
    assert.equal(status, 503);
    assert.notEqual(typeof state.config, 'object', '設定は得られない（undefined または null）');
    assert.deepEqual(state.created, []);
    assert.equal(state.unavailable, true);
  } finally { console.error = orig; }
});

test('ブラウザ：本番以外のホストで production の設定が返っても Supabase へ接続しない', { skip: !chromium }, async () => {
  const { state, status } = await openPage(PROD_ENV);
  assert.equal(status, 200);
  assert.deepEqual(state.created, []);
  assert.equal(state.unavailable, true);
});
