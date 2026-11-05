// 共有リンク（?dv=ETI-2.0&code=…）で開いた結果から、購入（Stripe の決済画面）へ進める試験（Playwright）。
//   API（/api/complete-checkout?op=…）・Supabase・Stripe はすべて差し替え。外部へは接続しない。
//   実行: node --test tests/shared_link_purchase_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const skip = () => (chromium ? false : 'playwright がありません');
const ROOT = path.join(__dirname, '..');
const { pipeFile } = require('./fixtures/serve_file');
const { previewPublicConfigJs } = require('./fixtures/server_env');
const CE = require('../lib/complete-eligibility');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const TOKEN = 'Rz0kEnSecretValueForResumeLink_ABCDEFGHIJKL'; // 43文字（base64url）。サーバーに無い秘密値として使う
const VERSIONS = { itemSetVersion: 'ETI-ITEM-2.0.0', scoringVersion: 'ETI-SCORE-2.0.0', translationModelVersion: 'ETI-TRANS-2.0.0',
  characterProfileVersion: 'ETI-CHAR-2.1.0', mirrorModelVersion: 'ETI-MIRROR-2.1.0' };

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  // 本番の配信（vercel.json）と同じく /result は index.html を返す
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname === '/result' ? '/index.html' : u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const GOALS = [200, { salesOpen: true, catalog: CE.MENTOR_CATALOG }];
// 購入対象トークン（試験用。固有リンクの秘密値ごとに決まる値）
const CTX_FOR = (tk) => 'Ctx_' + Buffer.from(tk).toString('base64url').slice(0, 70);
// 申込は購入対象トークンと商品だけ（診断コード・固有リンクの秘密値を op=buy に送らない）
function assertBuy(w, tk, product = 'analysis') {
  assert.deepEqual(w.calls.filter((c) => c.op === 'buy-context').map((c) => c.body).slice(-1), [{ resume: tk }]);
  const buy = w.calls.filter((c) => c.op === 'buy');
  assert.deepEqual(buy.map((c) => [c.body.context, c.body.product]).slice(-1), [[CTX_FOR(tk), product]]);
  assert.ok(buy.every((c) => !JSON.stringify(c.body).includes(tk)), 'op=buy に固有リンクの秘密値を送らない');
}

// world：サーバーの状態（固有リンクの秘密値 → 診断コード）
function world(over) {
  return Object.assign({ links: {}, issued: [], linkStatus: null, linkDelay: 0, openStatus: null, calls: [] }, over || {});
}
async function newContext({ width = 390 } = {}) {
  return browser.newContext({ viewport: { width, height: 844 } });
}
async function wire(ctx, w) {
  await ctx.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await ctx.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs({ completeSalesOpen: true, completeApiReady: true }) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/cdnjs\.cloudflare\.com|googletagmanager|jsdelivr/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await ctx.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await ctx.route('**/api/complete-checkout?op=*', async (r) => {
    const req = r.request();
    const op = new URL(req.url()).searchParams.get('op');
    const body = JSON.parse(req.postData() || '{}');
    w.calls.push({ op, body, url: req.url() });
    const send = (status, json) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (op === 'result-link') {
      // 秘密値はブラウザが作る（応答には秘密値を含めない）。同じ秘密値の再送は 'existing'
      if (w.linkDelay) await new Promise((ok) => setTimeout(ok, w.linkDelay));
      if (w.linkStatus) return send(w.linkStatus, { error: w.linkStatus === 429 ? 'too_many_requests' : 'service_unavailable' });
      if (w.links[body.token]) return send(200, { result: 'existing' });
      w.issued.push(body.token);
      w.links[body.token] = body.code;
      return send(200, { result: 'created' });
    }
    if (op === 'result-open') {
      if (w.openStatus) return send(w.openStatus, { error: w.openStatus === 404 ? 'result_not_found' : 'service_unavailable' });
      const code = w.links[body.token];
      return code ? send(200, { code, diagnosisVersion: 'ETI-2.0', versions: VERSIONS }) : send(404, { error: 'result_not_found' });
    }
    if (op === 'guest-cancel') return send(200, { closed: 1, paid: 0 });
    // 申込（complete_13）：診断結果の固有リンクから購入対象トークン → 共通の op=buy
    if (op === 'buy-context') return w.links[body.resume] ? send(200, { context: CTX_FOR(body.resume), summary: {}, eligible: { analysis: true, complete: true } }) : send(404, { error: 'record_not_found' });
    if (op === 'buy') return send(200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', product: body.product });
    if (op === 'guest-status') return send(200, { salesOpen: true, purchases: [] });
    if (op === 'guest-goals') return send(...GOALS);
    if (op === 'guest-checkout') return send(200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', offer: body.offer, amount: 1000 });
    return send(404, { error: 'not_found' });
  });
  await ctx.addInitScript(() => { window.__ev = []; window.gtag = function () { window.__ev.push(Array.from(arguments)); }; });
}
async function open(ctx, url) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.__errors = [];
  p.__console = [];
  p.on('pageerror', (e) => p.__errors.push(String(e)));
  p.on('console', (m) => p.__console.push(m.text()));
  await p.goto(base + url);
  return p;
}
// 診断の完了（100問の回答を入れて、完了の処理を呼ぶ）
async function complete(p, k = 7) {
  await p.waitForFunction(() => typeof showResultV2 === 'function' && typeof ETI_V2_QUESTIONS !== 'undefined');
  return p.evaluate((kk) => {
    const a = {};
    ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * kk) % 5) - 2; });
    window.__diagnosisVersion = 'ETI-2.0';
    answersV2 = a; // eslint-disable-line no-undef
    showResultV2(); // eslint-disable-line no-undef
    return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS);
  }, k);
}

const SHARED_CODE = 'iv1akx5z7hh49hfzbcxz0rh1rkz3t2we101fcqyyg7eo2';
test('共有リンクで開いた結果で、購入ボタンを押すと、決済画面へ進む（診断コードを op=buy に送らない）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  const buy = w.calls.filter((c) => c.op === 'buy');
  assert.equal(buy.length, 1);
  assert.ok(!JSON.stringify(buy[0].body).includes(SHARED_CODE), 'op=buy に診断コードを送らない');
  assert.equal(w.calls.filter((c) => c.op === 'result-link').length, 1, '押した時に、固有リンクを1回だけ作る');
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

test('固有リンクの作成に一度失敗しても、もう一度押せば進める（同じ診断の秘密値で作り直す）', { skip: skip() }, async () => {
  const w = world({ linkStatus: 503 });
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForFunction(() => /購入の準備ができませんでした/.test((document.getElementById('guestAnalysisMsg') || {}).textContent || ''), null, { timeout: 15000 });
  assert.equal(w.calls.filter((c) => c.op === 'buy').length, 0, '失敗中は、決済画面を作らない');
  w.linkStatus = null; // 回復
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  const links = w.calls.filter((c) => c.op === 'result-link');
  assert.ok(links.length >= 2, '作り直す');
  assert.equal(new Set(links.map((c) => c.body.token)).size, 1, '同じ秘密値で作り直す（記録・リンクを増やさない）');
  assert.equal(w.calls.filter((c) => c.op === 'buy').length, 1);
  await ctx.close();
});

test('共有リンクで開いた結果から、完全解析（目標の選択 → 決済画面）へも進める', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  await p.waitForSelector('[data-buy-complete]', { state: 'attached' });
  await p.waitForFunction(() => !document.querySelector('[data-buy-complete]').disabled);
  await p.locator('details.ca-reveal summary').click(); // 「その先を見る」を開く
  await p.locator('[data-buy-complete]').waitFor();
  await p.locator('[data-buy-complete]').click();
  await p.locator('.edb-dialog input[name="edb-goal"]').first().check();
  await p.locator('[data-edb-go]').click();
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  const buy = w.calls.filter((c) => c.op === 'buy');
  assert.equal(buy.length, 1);
  assert.equal(buy[0].body.product, 'complete');
  assert.ok(buy[0].body.goal);
  assert.ok(!JSON.stringify(buy[0].body).includes(SHARED_CODE));
  await ctx.close();
});

test('開き直した結果のあとで診断し直して購入する時は、その診断の固有リンクで進む（共有リンクのリンクとは別）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.evaluate(() => startNewDiagnosisV2()); // eslint-disable-line no-undef
  const code = await complete(p, 11);
  await p.waitForFunction(() => location.pathname === '/result' && location.hash.startsWith('#r='));
  await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  const links = w.calls.filter((c) => c.op === 'result-link');
  assert.equal(links.length, 1);
  assert.equal(links[0].body.code, code, '新しい診断のコードで、固有リンクを作る');
  await ctx.close();
});

test('旧形式（dv の無い ?code=）の結果では、購入ボタンを出さない（従来どおり）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, `/?code=${SHARED_CODE}`);
  await p.waitForTimeout(1500);
  assert.equal(w.calls.filter((c) => c.op === 'buy' || c.op === 'result-link').length, 0);
  await ctx.close();
});
