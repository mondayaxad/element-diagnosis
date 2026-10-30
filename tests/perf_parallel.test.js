// 決済・マイページの待ち時間の短縮（2026-10-30）の試験：待ち時間を重ねる変更が、結果を変えず、期待どおり重なっていること。
//   ・/api/my-entitlements：本人の記録の一覧と、権利の事実の読み取りを並行して始める（直列だった DB の往復を 1 つ減らす）
//   ・マイページ：登録したレポートの取得を、記録の読み込みと並行して始める。利用者の確認は 3 秒の間、1 回にまとめる
//   ・/api/public-config：成功はエッジに短く置く（tests/public_config.test.js）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PREVIEW_ENV } = require('./fixtures/server_env');
const myEntitlements = require('../api/my-entitlements.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const U1 = '11111111-1111-4111-8111-111111111111';

test('my-entitlements：記録の一覧と権利の事実の読み取りが重なって始まる。応答の内容は直列の時と同じ', async () => {
  const events = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const name = u.pathname.replace('/rest/v1/', '') + (u.searchParams.get('select') && u.pathname.endsWith('diagnosis_sessions') ? (u.searchParams.get('select').includes('diagnosis_results') ? ':list' : ':facts') : '');
    if (u.pathname === '/auth/v1/user') return json(200, { id: U1 });
    events.push(`start ${name}`);
    await sleep(40);
    events.push(`end ${name}`);
    if (u.pathname.endsWith('diagnosis_sessions')) {
      return json(200, [{ id: 's1', diagnosis_version: 'element-v1', diagnosis_answers: [{ encoded_answers: 'codeA' }], diagnosis_results: [] }]);
    }
    return json(200, []);
  };
  const res = { code: 0, body: undefined, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await myEntitlements.createHandler({ env: PREVIEW_ENV, fetchImpl })({ method: 'GET', headers: { authorization: 'Bearer t' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.completeLookup, 'ok');
  assert.deepEqual(Object.keys(res.body.purchased_by_version), [], '購入権なし');
  // 記録の一覧（diagnosis_sessions）と、権利の事実の最初の読み取り（同じ表）が、どちらも完了を待たずに始まる
  const firstEnd = events.findIndex((e) => e.startsWith('end '));
  const startedBeforeFirstEnd = events.slice(0, firstEnd).filter((e) => e.startsWith('start diagnosis_sessions')).length;
  assert.equal(startedBeforeFirstEnd, 2, '2 つの読み取りが重なって始まる: ' + events.join(' | '));
});

test('my-entitlements：権利の事実の読み取りが失敗しても、記録の一覧は返す（completeLookup: failed。従来と同じ）', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') return json(200, { id: U1 });
    if (u.pathname.endsWith('record_entitlements')) return json(500, {});
    if (u.pathname.endsWith('diagnosis_sessions')) return json(200, [{ id: 's1', diagnosis_version: 'element-v1', diagnosis_answers: [{ encoded_answers: 'codeA' }], diagnosis_results: [] }]);
    return json(200, []);
  };
  const res = { code: 0, body: undefined, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const orig = console.error; console.error = () => {};
  try { await myEntitlements.createHandler({ env: PREVIEW_ENV, fetchImpl })({ method: 'GET', headers: { authorization: 'Bearer t' } }, res); } finally { console.error = orig; }
  assert.equal(res.code, 200);
  assert.equal(res.body.completeLookup, 'failed');
  assert.deepEqual(res.body.purchased_by_version, {});
});

// ---- マイページ（実ブラウザ）
let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* 次 */ } }
const skip = () => (chromium ? false : 'playwright がありません');
const ROOT = path.join(__dirname, '..');
const { pipeFile } = require('./fixtures/serve_file');
const { previewPublicConfigJs } = require('./fixtures/server_env');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const ROW = { id: 'sess-L', user_id: 'user-1', completed_at: '2026-09-01T10:00:00Z', diagnosis_type: 'element', diagnosis_version: null,
  diagnosis_results: [{ primary_result: { element: '水', weapon: '長柄', nation: '璃月' }, scores: {}, character_matches: [{ name: '行秋', match: 77, el: '水' }] }], diagnosis_answers: [{ encoded_answers: 'legacycode01' }] };
const fakeSupabase = () => `window.__getUserCalls = 0; window.supabase = { createClient() {
  const user = { id: "user-1", email: "o@example.test" }; const rows = ${JSON.stringify([ROW])};
  function builder(table) { const q = new Proxy({}, { get(_t, k) {
    if (k === 'then') return (res, rej) => Promise.resolve({ data: table === 'diagnosis_sessions' ? rows : table === 'profiles' ? { onboarding_status: 'completed', newsletter_sync_status: 'synced', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: null } : [], error: null }).then(res, rej);
    return () => q; } }); return q; }
  return { from: builder, rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => { window.__getUserCalls++; return { data: { user } }; }, getSession: async () => ({ data: { session: { access_token: "tok-1" } } }),
      onAuthStateChange(cb) { (window.__authCbs = window.__authCbs || []).push(cb); return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) } };
} };`;

async function openMypage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const t = {};
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase() }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs() }));
  await p.route(/fonts\.(googleapis|gstatic)\.com|googletagmanager/, (r) => r.abort());
  await p.route('**/api/complete-checkout?op=my-reports', async (r) => { t.repStart = Date.now(); await sleep(400); t.repEnd = Date.now(); r.fulfill({ contentType: 'application/json', body: '{"reports":[],"records":[]}' }); });
  await p.route('**/api/my-entitlements', async (r) => { t.entStart = Date.now(); await sleep(400); t.entEnd = Date.now(); r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{"element-v1:legacycode01":true}}' }); });
  await p.goto(base + '/mypage.html');
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  return { p, ctx, t };
}

test('マイページ：登録したレポートの取得は、記録の読み込み（購入状態の確認）と並行して始まる。表示は従来どおり', { skip: skip() }, async () => {
  const { p, ctx, t } = await openMypage();
  assert.ok(t.repStart && t.entStart, '2 つの取得が行われた');
  assert.ok(t.repStart < t.entEnd, `登録したレポートの取得は、購入状態の応答を待たずに始まる（rep start ${t.repStart - t.entStart}ms / ent 完了 ${t.entEnd - t.entStart}ms）`);
  assert.ok(await p.evaluate(() => document.querySelectorAll('.mp-latest').length) >= 1, '記録が表示される');
  await ctx.close();
});

test('マイページ：利用者の確認（auth.getUser）は初期化の中で 1 回にまとまる。ログアウト・認証の変化の後は取り直す', { skip: skip() }, async () => {
  const { p, ctx } = await openMypage();
  const first = await p.evaluate(() => window.__getUserCalls);
  assert.equal(first, 1, `初期化の中の確認は 1 回（実際 ${first}）`);
  // 認証の変化で捨てる：次の呼び出しは新しく確認する
  await p.evaluate(() => { (window.__authCbs || []).forEach((cb) => { try { cb('TOKEN_REFRESHED', { access_token: 'x' }); } catch (e) { /* 他の購読者の失敗は無関係 */ } }); });
  await p.evaluate(() => getCurrentUser());
  assert.equal(await p.evaluate(() => window.__getUserCalls), 2, '認証の変化の後は取り直す');
  // 3 秒以内の続けての呼び出しは覚えたものを返す
  await p.evaluate(() => getCurrentUser());
  assert.equal(await p.evaluate(() => window.__getUserCalls), 2);
  await ctx.close();
});
