// 購入（Stripe の決済画面へ進む）の耐障害の試験（Playwright）：入口 × 障害の組み合わせ。
//   目的：どの入口から、どんな障害があっても、「決済画面へ進める」か、「失敗の理由が分かり、すぐ押し直せる」状態に、必ずなる。
//   API（/api/complete-checkout?op=…）・Supabase・Stripe はすべて差し替え。外部へは接続しない。
//   実行: node --test tests/checkout_resilience_ui.test.js
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
    if (w.abort && w.abort.has(op)) return r.abort('failed');
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
    if (w.hook && w.hook[op]) { const h = await w.hook[op](body, req); if (h) return send(h[0], h[1]); }
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


// ================= 入口 × 障害の組み合わせ =================
const NAV_MSG = /購入の準備ができませんでした|通信できませんでした|お手続きを開始できませんでした|お申し込みの回数が多い|確かめられませんでした/;
const btnState = (p) => p.evaluate(() => { const b = document.querySelector('#lockUnlockAllBtn'); return b ? { disabled: b.disabled, busy: b.getAttribute('data-nav-busy'), text: b.textContent.trim().slice(0, 30) } : null; });
const msgOf = (p) => p.evaluate(() => (document.getElementById('guestAnalysisMsg') || {}).textContent || '');
async function waitBuyable(p) {
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.waitForFunction(() => { const b = document.querySelector('#lockUnlockAllBtn'); return b && !b.disabled && !b.getAttribute('data-nav-busy'); });
}
// 入口：fresh（診断の直後）／shared（共有リンク）／resume（/result#r=）
async function openEntry(ctx, w, entry) {
  if (entry === 'shared') return open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  const p = await open(ctx, '/');
  const code = await complete(p, 5);
  await p.waitForFunction(() => location.pathname === '/result' && location.hash.startsWith('#r='));
  if (entry === 'fresh') return p;
  const tk = w.issued[0];
  const q = await open(ctx, `/result#r=${tk}`);
  return q;
}
const ENTRIES = ['fresh', 'shared', 'resume'];

for (const entry of ENTRIES) {
  test(`[${entry}] 通常：¥1,000 の購入ボタンから決済画面へ進む。申し込みは1回だけ（連打しても）`, { skip: skip() }, async () => {
    const w = world();
    const ctx = await newContext();
    await wire(ctx, w);
    const p = await openEntry(ctx, w, entry);
    await waitBuyable(p);
    // 連打（同じ瞬間に3回押す）
    await p.evaluate(() => { const el = document.querySelector('#lockUnlockAllBtn'); el.click(); el.click(); el.click(); });
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    assert.equal(w.calls.filter((c) => c.op === 'buy').length, 1, '連打でも申し込みは1回');
    await ctx.close();
  });

  // サーバーが拒否・失敗した時：理由が出て、すぐに押し直せる（押せない表示のまま止まらない）
  for (const [name, hook] of [
    ['申し込みが 429（回数制限）', () => [429, { error: 'too_many_attempts' }]],
    ['申し込みが 503（一時的な失敗）', () => [503, { error: 'service_unavailable' }]],
    ['申し込みが 500', () => [500, { error: 'checkout_failed' }]],
    ['申し込みが 410（購入対象の期限切れ）', () => [410, { error: 'context_expired' }]],
    ['申し込みの応答が不正（決済画面の URL が無い）', () => [200, { product: 'analysis' }]],
    ['申し込みの応答が Stripe 以外の URL', () => [200, { checkoutUrl: 'https://example.test/pay' }]],
  ]) {
    test(`[${entry}] ${name}：理由を表示し、押し直せる。押し直して回復すれば、決済画面へ進める`, { skip: skip() }, async () => {
      const w = world();
      let fail = true;
      w.hook = { buy: () => (fail ? hook() : null) };
      const ctx = await newContext();
      await wire(ctx, w);
      const p = await openEntry(ctx, w, entry);
      await waitBuyable(p);
      await p.locator('#lockUnlockAllBtn').click();
      await p.waitForFunction(() => /\S/.test((document.getElementById('guestAnalysisMsg') || {}).textContent || ''), null, { timeout: 15000 });
      assert.match(await msgOf(p), NAV_MSG, `理由の表示：${await msgOf(p)}`);
      const st = await btnState(p);
      assert.equal(st.disabled, false, `押し直せる：${JSON.stringify(st)}`);
      assert.ok(!st.busy, '「移動しています」の表示のまま止まらない');
      fail = false;
      await p.locator('#lockUnlockAllBtn').click();
      await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
      await ctx.close();
    });
  }

  test(`[${entry}] 通信の失敗（申し込みの接続が切れる）：同じ操作で1回だけ再送して進む。失敗が続けば、理由を表示して、押し直せる`, { skip: skip() }, async () => {
    const w = world();
    const ctx = await newContext();
    await wire(ctx, w);
    const p = await openEntry(ctx, w, entry);
    await waitBuyable(p);
    let n = 0;
    await ctx.route('**/api/complete-checkout?op=buy', (r) => { n += 1; return n === 1 ? r.abort('failed') : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake' }) }); });
    await p.locator('#lockUnlockAllBtn').click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    assert.equal(n, 2, '1回だけ再送');
    await ctx.close();
  });

  test(`[${entry}] 購入の準備（購入対象トークン）の取得が失敗：理由を表示して押し直せる。回復すれば進める`, { skip: skip() }, async () => {
    const w = world();
    let fail = entry !== 'fresh' ? true : false;
    w.hook = { 'buy-context': () => (fail ? [503, { error: 'service_unavailable' }] : null) };
    if (entry === 'fresh') w.hook['buy-context'] = () => (fail ? [503, { error: 'service_unavailable' }] : null);
    const ctx = await newContext();
    await wire(ctx, w);
    const p = await openEntry(ctx, w, entry);
    await waitBuyable(p);
    fail = true;
    await p.locator('#lockUnlockAllBtn').click();
    await p.waitForFunction(() => /購入の準備ができませんでした/.test((document.getElementById('guestAnalysisMsg') || {}).textContent || ''), null, { timeout: 20000 });
    const st = await btnState(p);
    assert.equal(st.disabled, false);
    assert.ok(!st.busy);
    fail = false;
    await p.locator('#lockUnlockAllBtn').click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    await ctx.close();
  });

  // ブラウザ側の制約：ストレージ・広告ブロック・外部スクリプトの遮断でも、購入は止まらない
  for (const [name, setup] of [
    ['sessionStorage・localStorage が使えない（プライベートブラウズ・ブロック）', async (ctx) => {
      await ctx.addInitScript(() => {
        const boom = () => { throw new DOMException('denied', 'SecurityError'); };
        for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) { try { Storage.prototype[k] = boom; } catch (e) { /* noop */ } }
      });
    }],
    ['計測のスクリプト（ga.js）が広告ブロックで読み込めない', async (ctx) => { await ctx.route('**/js/ga.js', (r) => r.abort('blockedbyclient')); }],
    ['Supabase のスクリプト（CDN）が読み込めない', async (ctx) => { await ctx.route(/supabase-js@2/, (r) => r.abort('blockedbyclient')); }],
    ['Google Fonts・CDN のスクリプトがすべて読み込めない', async (ctx) => { await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com|jsdelivr/, (r) => r.abort('blockedbyclient')); }],
  ]) {
    test(`[${entry}] ${name}：購入は止まらない`, { skip: skip() }, async () => {
      const w = world();
      const ctx = await newContext();
      await wire(ctx, w);
      await setup(ctx);
      let p;
      try { p = await openEntry(ctx, w, entry); } catch (e) { await ctx.close(); throw e; }
      await waitBuyable(p);
      await p.locator('#lockUnlockAllBtn').click();
      await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
      assert.deepEqual(p.__errors.filter((e) => !/SecurityError|denied/i.test(e)), [], '想定外のスクリプトエラーなし');
      await ctx.close();
    });
  }

  test(`[${entry}] 決済画面から「戻る」で戻ったあと、もう一度押して、決済画面へ進める（新しい申し込み）`, { skip: skip() }, async () => {
    const w = world();
    const ctx = await newContext();
    await wire(ctx, w);
    const p = await openEntry(ctx, w, entry);
    await waitBuyable(p);
    await p.locator('#lockUnlockAllBtn').click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    await p.goBack();
    await waitBuyable(p);
    await p.locator('#lockUnlockAllBtn').click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    assert.equal(w.calls.filter((c) => c.op === 'buy').length, 2);
    await ctx.close();
  });
}

// ================= 公開設定（/api/public-config）の取得に失敗した時 =================
const CFG_JSON = { appEnv: 'preview', supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test', projectRef: 'examplereference', completeSalesOpen: true, completeApiReady: true };
async function configRoutes(ctx, { first, retry }) {
  const seen = { js: 0, retry: 0 };
  await ctx.route(/\/api\/public-config/, (r) => {
    const url = r.request().url();
    if (/format=js/.test(url)) { seen.js += 1; return first(r); }
    seen.retry += 1;
    return retry(r, seen.retry);
  });
  return seen;
}
const okJson = (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CFG_JSON) });
for (const entry of ['fresh', 'shared']) {
  test(`[${entry}] 公開設定の最初の取得が失敗（500・通信の失敗）しても、取り直して、購入できる（「準備中」のまま止まらない）`, { skip: skip() }, async () => {
    for (const first of [
      (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'error' }),
      (r) => r.abort('failed'),
      (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html>bad gateway</html>' }),
    ]) {
      const w = world();
      const ctx = await newContext();
      await wire(ctx, w);
      const seen = await configRoutes(ctx, { first, retry: okJson });
      const p = await openEntry(ctx, w, entry);
      await waitBuyable(p);
      assert.equal(seen.retry, 1, '取り直しは1回で済む');
      assert.equal(await p.evaluate(() => window.__ED_PUBLIC_CONFIG__ && window.__ED_PUBLIC_CONFIG__.completeSalesOpen), true);
      await p.locator('#lockUnlockAllBtn').click();
      await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
      await ctx.close();
    }
  });
}

test('公開設定の取り直しは最大2回。それでも取れなければ「準備中」のまま（購入ボタンは押せない）。ページは壊れない', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const seen = await configRoutes(ctx, { first: (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }), retry: (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }) });
  const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(seen.retry, 2, '最大2回');
  assert.match((await btnState(p)).text, /準備中/);
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

test('サーバーが意図して止めた（503）時は、確認を1回だけして、それ以上は取り直さない。取り直した値の形が違えば、採用しない', { skip: skip() }, async () => {
  for (const [first, retry, expectRetry] of [
    [(r) => r.fulfill({ status: 503, contentType: 'application/javascript', body: 'window.__ED_PUBLIC_CONFIG__ = null;\n' }), (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'config_unavailable' }) }), 1],
    [(r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }), (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ completeSalesOpen: true }) }), 2],
    [(r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }), (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '<<not json' }), 2],
  ]) {
    const w = world();
    const ctx = await newContext();
    await wire(ctx, w);
    const seen = await configRoutes(ctx, { first, retry });
    const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    // 503 の時は、サーバーの停止を、そのまま尊重する（確認の1回だけ。以降は取り直さない）
    assert.equal(seen.retry, expectRetry);
    assert.equal(await p.evaluate(() => window.__ED_PUBLIC_CONFIG__ == null), true);
    assert.match((await btnState(p)).text, /準備中/);
    assert.deepEqual(p.__errors, []);
    await ctx.close();
  }
});

test('販売が明示的に停止（completeSalesOpen:false）の時は、取り直さず、「準備中」のまま（従来どおり）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const seen = await configRoutes(ctx, { first: (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs({ completeSalesOpen: false, completeApiReady: true }) }), retry: okJson });
  const p = await open(ctx, `/?dv=ETI-2.0&code=${SHARED_CODE}&mv=2.1.0`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(seen.retry, 0);
  assert.match((await btnState(p)).text, /準備中/);
  await ctx.close();
});

test('公開設定を読み込む全てのページに、取り直しのスクリプトがある（設定の直後）', () => {
  for (const f of ['index.html', 'mypage.html', 'report.html', 'report_sample.html', 'complete-sample.html']) {
    const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const a = h.indexOf('<script src="/api/public-config?format=js"></script>');
    const b = h.indexOf('<script src="/js/public-config-retry.js"></script>');
    assert.ok(a > 0 && b > a && b - a < 120, `${f}：公開設定の直後`);
  }
  assert.ok(fs.readFileSync(path.join(ROOT, 'scripts/build-public.js'), 'utf8').includes("'js/public-config-retry.js'"), '配信の一覧に含める');
});

// ================= 押せない表示のまま止まらない（安全網） =================
test('通信中（pending）のまま応答が返らなくても、一定時間で元の押せる状態へ戻る。移動中（away）は、従来の20秒の規則', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  await p.waitForFunction(() => typeof EdNavBusy !== 'undefined');
  const r = await p.evaluate(async () => {
    EdNavBusy.maxPendingMs = 300;
    const b = document.createElement('button'); b.textContent = '購入'; document.body.appendChild(b);
    EdNavBusy.hold(b, '決済画面へ移動しています…');
    const during = { disabled: b.disabled, text: b.textContent, busy: b.getAttribute('data-nav-busy') };
    await new Promise((ok) => setTimeout(ok, 600));
    const after = { disabled: b.disabled, text: b.textContent, busy: b.getAttribute('data-nav-busy') };
    // 解除してから、もう一度 hold → 古いタイマーが、新しい hold を、解除しない
    EdNavBusy.maxPendingMs = 100000;
    EdNavBusy.hold(b, '移動');
    EdNavBusy.release(b);
    EdNavBusy.hold(b, '移動2');
    await new Promise((ok) => setTimeout(ok, 400));
    const again = { disabled: b.disabled, busy: b.getAttribute('data-nav-busy') };
    return { during, after, again };
  });
  assert.deepEqual(r.during, { disabled: true, text: '決済画面へ移動しています…', busy: 'pending' });
  assert.deepEqual(r.after, { disabled: false, text: '購入', busy: null });
  assert.deepEqual(r.again, { disabled: true, busy: 'pending' });
  await ctx.close();
});

test('アカウントのトークンの取得が詰まっても（認証の応答が返らない）、5秒で諦めて、購入の処理が止まらない', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  await p.waitForFunction(() => typeof EdBuy !== 'undefined' && typeof EdBuy.accountToken === 'function');
  const r = await p.evaluate(async () => {
    window.supabaseClient = { auth: { getSession: () => new Promise(() => {}) } }; // eslint-disable-line no-undef
    const t0 = Date.now();
    const v = await EdBuy.accountToken();
    return { v, ms: Date.now() - t0 };
  });
  // supabaseClient が let/const で束縛されていて、差し替えられない場合は、元の値（null）のまま
  assert.equal(r.v, null);
  assert.ok(r.ms < 7000, `5秒前後で終わる（${r.ms}ms）`);
  await ctx.close();
});

// ================= 購入対象の判定が無効になった時：キャッシュを捨てて、次に押した時に作り直す =================
test('[resume] 購入対象が無効（410）と判定されたあと、押し直すと、購入対象を作り直して進める（古い値のまま同じ失敗を繰り返さない）', { skip: skip() }, async () => {
  const w = world();
  let bad = true;
  w.hook = { buy: (body) => (bad && body.context === CTX_FOR(w.issued[0]) ? [410, { error: 'context_expired' }] : null) };
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await openEntry(ctx, w, 'fresh');
  await waitBuyable(p);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForFunction(() => /確かめられませんでした/.test((document.getElementById('guestAnalysisMsg') || {}).textContent || ''), null, { timeout: 15000 });
  const ctxCalls = w.calls.filter((c) => c.op === 'buy-context').length;
  // サーバーが、新しい購入対象を返すようになった（再発行）
  const tk = w.issued[0];
  const origContext = CTX_FOR(tk);
  w.hook = { 'buy-context': () => [200, { context: 'Ctx_REISSUED_' + origContext.slice(4), summary: {}, eligible: { analysis: true, complete: true } }] };
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
  assert.ok(w.calls.filter((c) => c.op === 'buy-context').length > ctxCalls, '購入対象を作り直した');
  assert.match(w.calls.filter((c) => c.op === 'buy').pop().body.context, /^Ctx_REISSUED_/);
  await ctx.close();
});

// ================= 完全解析（¥3,000）：目標の選択 → 決済画面 =================
async function openFoldAndBuyComplete(p) {
  await p.waitForSelector('details.ca-reveal', { state: 'attached' });
  await p.locator('details.ca-reveal summary').click();
  await p.locator('[data-buy-complete]').waitFor();
  await p.waitForFunction(() => { const b = document.querySelector('[data-buy-complete]'); return b && !b.disabled; });
  await p.locator('[data-buy-complete]').click();
}
for (const entry of ENTRIES) {
  test(`[${entry}] 完全解析 ¥3,000：目標を選んで決済画面へ進む。目標の一覧の取得に失敗しても、やめて押し直せば進める`, { skip: skip() }, async () => {
    const w = world();
    let goalsFail = true;
    w.hook = { 'guest-goals': () => (goalsFail ? [500, { error: 'service_unavailable' }] : null) };
    const ctx = await newContext();
    await wire(ctx, w);
    const p = await openEntry(ctx, w, entry);
    await waitBuyable(p);
    await openFoldAndBuyComplete(p);
    await p.waitForFunction(() => /目標の一覧を読み込めませんでした/.test((document.querySelector('.edb-msg') || {}).textContent || ''), null, { timeout: 15000 });
    assert.equal(await p.locator('[data-edb-go]').isDisabled(), true, '一覧が無い間は、決済へ進めない');
    await p.locator('[data-edb-cancel]').click(); // やめる
    assert.equal(await p.locator('.edb-dialog').count(), 0, '画面が閉じて、操作を取り戻せる');
    goalsFail = false;
    await p.locator('[data-buy-complete]').click();
    await p.locator('.edb-dialog input[name="edb-goal"]').first().check();
    await p.locator('[data-edb-go]').click();
    await p.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    const buy = w.calls.filter((c) => c.op === 'buy');
    assert.equal(buy.length, 1);
    assert.equal(buy[0].body.product, 'complete');
    assert.ok(buy[0].body.goal);
    await ctx.close();
  });
}

// ================= 画面の幅：購入ボタンが、見える・押せる（他の要素に覆われない） =================
for (const width of [320, 360, 390, 430]) {
  test(`[${width}px] 購入ボタンが、画面の中で、押せる位置にあり、他の要素に覆われていない（解析・完全解析）`, { skip: skip() }, async () => {
    const w = world();
    const ctx = await newContext({ width });
    await wire(ctx, w);
    const p = await openEntry(ctx, w, 'shared');
    await waitBuyable(p);
    const hit = (sel) => p.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return { found: false };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { found: true, w: r.width, h: r.height, inView: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight, ok: !!top && (top === el || el.contains(top)), overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
    }, sel);
    const a = await hit('#lockUnlockAllBtn');
    assert.ok(a.found && a.inView && a.ok, `解析：${JSON.stringify(a)}`);
    assert.ok(a.h >= 40, `押しやすい高さ：${a.h}`);
    await p.locator('details.ca-reveal summary').click();
    await p.locator('[data-buy-complete]').waitFor();
    const c = await hit('[data-buy-complete]');
    assert.ok(c.found && c.inView && c.ok, `完全解析：${JSON.stringify(c)}`);
    assert.equal(c.overflowX, false, '横にはみ出さない');
    await ctx.close();
  });
}

// ================= 応答が遅い・返らない =================
test('[fresh] 申し込みの応答が遅く（5秒）ても、押せない表示で待ち、1回だけ申し込んで、決済画面へ進む', { skip: skip() }, async () => {
  const w = world();
  w.hook = { buy: async () => { await new Promise((ok) => setTimeout(ok, 5000)); return null; } };
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await openEntry(ctx, w, 'fresh');
  await waitBuyable(p);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForTimeout(800);
  const st = await btnState(p);
  assert.equal(st.disabled, true);
  assert.match(st.text, /決済画面へ移動しています/);
  await p.locator('#lockUnlockAllBtn').click({ force: true, timeout: 500 }).catch(() => {}); // 待っている間の再押下
  await p.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 });
  assert.equal(w.calls.filter((c) => c.op === 'buy').length, 1);
  await ctx.close();
});

test('[fresh] 申し込みの応答が返らない（15秒×2回の後）：理由を表示して、押し直せる状態に戻る', { skip: skip() }, async () => {
  const w = world();
  w.hook = { buy: async () => { await new Promise((ok) => setTimeout(ok, 20000)); return [200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_late' }]; } };
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await openEntry(ctx, w, 'fresh');
  await waitBuyable(p);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForFunction(() => /通信できませんでした/.test((document.getElementById('guestAnalysisMsg') || {}).textContent || ''), null, { timeout: 50000 });
  const st = await btnState(p);
  assert.equal(st.disabled, false);
  assert.ok(!st.busy);
  assert.equal(w.calls.filter((c) => c.op === 'buy').length, 2, '同じ操作の再送は1回だけ');
  await ctx.close();
});
