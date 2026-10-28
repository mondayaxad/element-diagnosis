// ゲスト購入の画面（診断完了ページ・購入完了ページ・解析レポートの「マイページに引き継ぐ」）の表示テスト（Playwright）。
// API（/api/complete-checkout?op=…）・Supabase・Stripe はすべて差し替え。外部へは接続しない。
//   実行: node --test tests/guest_purchase_ui.test.js
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
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REF = 'a1b2c3d4e5f6a7b8c9d0';

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
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

// api：op ごとの応答（関数なら body を受け取って [status, json] を返す）
// user：ログイン中の本人として開く（supabase の代用品が本人とセッションを返す）。purchased：/api/my-entitlements の購入済みの診断コード
// reportData：/api/report-data の応答（解析レポートのページ用）
async function page(url, { width = 390, salesOpen = true, api = {}, clock = false, user = false, purchased = [], reportData = null, resultStates = null, entitlementsStatus = 200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [];
  const calls = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const userJs = user ? '{id:"11111111-1111-4111-8111-111111111111"}' : 'null';
  const sessionJs = user ? '{access_token:"tok-user",user:{id:"11111111-1111-4111-8111-111111111111"}}' : 'null';
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:' + userJs + '}}),getSession:async()=>({data:{session:' + sessionJs + '}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await p.route('**/api/my-entitlements', (r) => {
    calls.push({ op: 'my-entitlements', auth: r.request().headers().authorization || '' });
    const keys = {};
    const states = Object.assign({}, resultStates || {});
    purchased.forEach((c) => {
      keys['ETI-2.0:' + c] = true;
      states['ETI-2.0:' + c] = { analysisAccess: true, analysisPurchased: true, legacyAnalysis: false, completeOffer: 'analysis_upgrade',
        completeBlocked: null, completeEntitlement: null, completeStatus: 'none', checkoutInProgress: false };
    });
    if (entitlementsStatus !== 200) return r.fulfill({ status: entitlementsStatus, contentType: 'application/json', body: '{"error":"lookup_failed"}' });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ purchased_by_version: keys, completeLookup: 'ok', records: {}, result_states: states }) });
  });
  if (reportData) await p.route('**/api/report-data**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(reportData) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs(salesOpen ? { completeSalesOpen: true, completeApiReady: true } : { completeApiReady: true }) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager|jsdelivr/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  // ログイン中として開く時は、supabase-js の代用品を CDN の空の応答より優先する（後から登録した route が先に使われる）
  if (user) await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:' + userJs + '}}),getSession:async()=>({data:{session:' + sessionJs + '}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await p.route('**/api/complete-checkout?op=*', (r) => {
    const op = new URL(r.request().url()).searchParams.get('op');
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push({ op, body });
    const h = api[op];
    const [status, json] = typeof h === 'function' ? h(body) : h || [404, { error: 'not_found' }];
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  if (clock) await p.clock.install();
  await p.goto(base + url);
  p.__ctx = ctx; p.__errors = errors; p.__calls = calls;
  return p;
}
async function resultPage(opts) {
  const p = await page('/', opts);
  const code = await p.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p.goto(`${base}/?dv=ETI-2.0&code=${code}`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  p.__code = code;
  return p;
}
const GOALS = [200, { salesOpen: true, catalog: CE.MENTOR_CATALOG }];
const CHECKOUT = (b) => [200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', offer: b.offer, amount: { analysis: 1000, direct_complete: 3000, analysis_upgrade: 2000 }[b.offer] }];
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);



test('旧版（legacy-v1）の結果：本番以外のドメインでは実際の決済に進ませず「準備中」。完全解析の導線は出さない', { skip: skip() }, async () => {
  for (const width of [320, 1280]) {
    const p = await page('/', { width, api: { 'guest-status': [200, { salesOpen: true, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
    const legacyCode = await p.evaluate(() => { const a = {}; for (let i = 0; i < QUESTIONS.length; i++) a[i] = (i % 5) - 2; return encodeAnswers(a); });
    await p.goto(`${base}/?code=${legacyCode}`);
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
    const btn = p.locator('#lockUnlockAllBtn');
    assert.equal(await btn.isDisabled(), true);
    assert.match((await btn.innerText()).trim(), /準備中/);
    assert.equal(await p.locator('#legacyRetiredNote').count(), 0);
    await btn.click({ force: true }).catch(() => {});
    for (const b of await p.locator('.lock-cta').all()) await b.click({ force: true }).catch(() => {});
    assert.deepEqual(await p.evaluate(() => window.__opened), []);
    assert.equal(p.__calls.filter((c) => c.op === 'guest-checkout').length, 0, '新しい Checkout にも進まない');
    assert.equal(await p.locator('[data-buy-complete]').count(), 0, '完全解析は販売しない');
    assert.equal(await noScroll(p), true, String(width));
    await p.__ctx.close();
  }
});













test('サンプルからマイページ：sample_to_mypage を1回だけ（入口だけ・ID なし）記録し、URL から from=sample を消す', { skip: skip() }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__ev = JSON.parse(sessionStorage.getItem('__ev') || '[]');
    window.gtag = function (kind, name, params) {
      if (kind !== 'event') return;
      window.__ev.push([name, params || {}]);
      sessionStorage.setItem('__ev', JSON.stringify(window.__ev));
    };
  });
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs() }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.goto(base + '/mypage.html?from=sample');
  await p.waitForSelector('#gateAuth', { state: 'attached' });
  assert.equal(new URL(p.url()).search, '', 'from=sample を消す');
  await p.goto(base + '/mypage.html?from=sample');
  await p.waitForSelector('#gateAuth', { state: 'attached' });
  const ev = await p.evaluate(() => window.__ev);
  const hits = ev.filter((e) => e[0] === 'sample_to_mypage');
  assert.equal(hits.length, 1, '同じタブでは1回だけ');
  assert.deepEqual(hits[0][1], { source: 'sample' });
  assert.doesNotMatch(JSON.stringify(ev), /[0-9a-f]{8}-[0-9a-f]{4}-|@/);
  await ctx.close();
});





// ================= A：BEYOND THE RESULT（完全解析の訴求）
test('BEYOND THE RESULT：¥1,000 の主導線の下。閉じた状態は予告だけ・展開でサンプルと ¥3,000（complete_13 の共通の申込）。320／390／1280px で重なり・はみ出しなし', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await resultPage({ width, api: { 'guest-status': [200, { salesOpen: true, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
    await p.evaluate(() => { window.__ev = []; window.gtag = function () { window.__ev.push(Array.from(arguments)); }; });
    const fold = p.locator('details.ca-reveal');
    // 購入状態の確認が終わって購入の欄が描かれてから、2つの位置を同じ時点で測る（描き替えの途中で測らない）
    await fold.locator('[data-buy-complete]').waitFor({ state: 'attached' });
    const { b1, f1 } = await p.evaluate(() => {
      const r = (el) => { const x = el.getBoundingClientRect(); return { y: x.top + window.scrollY, height: x.height }; };
      return { b1: r(document.querySelector('#lockUnlockAllBtn')), f1: r(document.querySelector('details.ca-reveal')) };
    });
    assert.ok(f1.y >= b1.y + b1.height, `${width}: ¥1,000 の下（${b1.y + b1.height} ≤ ${f1.y}）`);
    assert.ok(b1.height >= 44, `${width}: ¥1,000 の大きさを保つ`);
    assert.equal(await fold.evaluate((d) => d.open), false);
    assert.equal(await fold.locator('[data-buy-complete]').isVisible(), false, '閉じた状態に ¥3,000 の導線を見せない');
    assert.equal(await fold.locator('[data-ca-sample]').isVisible(), false);
    assert.doesNotMatch(await fold.locator('summary').innerText(), /¥/);
    assert.equal(await noScroll(p), true, `${width}: 閉じた状態`);
    await fold.locator('summary').click();
    await fold.locator('[data-buy-complete]').waitFor();
    assert.equal(await fold.locator('[data-ca-sample]').isVisible(), true);
    assert.equal(await noScroll(p), true, `${width}: 開いた状態`);
    // 本文・ボタンが横にはみ出さない（カードの内側に収まる）
    const out = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll('details.ca-reveal *')).filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((el) => el.className || el.tagName);
    });
    assert.deepEqual(out, [], `${width}: はみ出し`);
    // ¥3,000 を押すと、共通の目標の選択の画面（決済はまだ）
    await fold.locator('[data-buy-complete]').click();
    await p.locator('.edb-dialog input[name="edb-goal"]').first().waitFor();
    await p.keyboard.press('Escape');
    // 計測：展開（匿名。記録 ID・URL・診断コードを含めない）
    const ev = await p.evaluate(() => window.__ev.filter((a) => a[0] === 'event').map((a) => [a[1], a[2]]));
    const names = ev.map((e) => e[0]);
    for (const n of ['complete_details_open']) assert.ok(names.includes(n), `${width}: ${n}`);
    assert.doesNotMatch(JSON.stringify(ev), new RegExp(`${p.__code}|https?:|sess-|@`));
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('BEYOND THE RESULT：展開時だけ光点と線が現れ、prefers-reduced-motion では動きを止める', { skip: skip() }, async () => {
  for (const reduced of [false, true]) {
    const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
    await p.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await p.locator('details.ca-reveal summary').click();
    const anim = await p.evaluate(() => Array.from(document.querySelectorAll('.ca-reveal-stars i')).map((i) => getComputedStyle(i).animationName));
    assert.equal(anim.length, 3);
    if (reduced) assert.deepEqual(anim, ['none', 'none', 'none']);
    else assert.ok(anim.every((n) => n === 'ca-reveal-dot'), JSON.stringify(anim));
    // 常時点滅しない（無限に繰り返さない）
    const iter = await p.evaluate(() => getComputedStyle(document.querySelector('.ca-reveal-stars i')).animationIterationCount);
    assert.equal(iter, '1');
    await p.__ctx.close();
  }
});

// ================= 監査（2026-10-14）：結果ページの購入欄
const codeOf = async () => {
  const p0 = await page('/');
  const code = await p0.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p0.__ctx.close();
  return code;
};
const ST = (o) => Object.assign({ analysisAccess: false, analysisPurchased: false, legacyAnalysis: false, completeOffer: null, completeBlocked: null,
  completeEntitlement: null, completeStatus: 'none', checkoutInProgress: false }, o);
