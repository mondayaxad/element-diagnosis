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
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// api：op ごとの応答（関数なら body を受け取って [status, json] を返す）
async function page(url, { width = 390, salesOpen = true, api = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [];
  const calls = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs(salesOpen ? { completeSalesOpen: true, completeApiReady: true } : { completeApiReady: true }) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager|jsdelivr/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await p.route('**/api/complete-checkout?op=*', (r) => {
    const op = new URL(r.request().url()).searchParams.get('op');
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push({ op, body });
    const h = api[op];
    const [status, json] = typeof h === 'function' ? h(body) : h || [404, { error: 'not_found' }];
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
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

test('完了ページ（販売中）：¥1,000 はゲストの Checkout（offer と診断コードだけ）。同じタブで Stripe へ', { skip: skip() }, async () => {
  const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: false }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  const btn = p.locator('#lockUnlockAllBtn');
  assert.equal((await btn.innerText()).trim(), '全てのロックを解除する →');
  assert.match(await p.content(), /登録不要。お支払いの後、このブラウザですぐにお読みいただけます。/);
  await btn.click();
  await p.waitForURL(/checkout\.stripe\.com/);
  const co = p.__calls.filter((c) => c.op === 'guest-checkout');
  assert.deepEqual(co.map((c) => c.body), [{ offer: 'analysis', code: p.__code }]);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('完了ページ（販売中）：完全解析 ¥3,000 は目標を選ぶまで押せない → 目標つきで Checkout', { skip: skip() }, async () => {
  const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  await p.click('details.ca-fold > summary');
  const fold = p.locator('details.ca-fold');
  await fold.locator('[data-guest-buy]').waitFor();
  assert.match(await fold.innerText(), /¥3,000/);
  const buy = fold.locator('[data-guest-buy="direct_complete"]');
  assert.equal(await buy.isDisabled(), true, '目標を選ぶまで押せない');
  assert.equal(await fold.locator('input[name="guest-mentor-goal"]').count(), 5);
  await fold.locator('input[value="GOAL_EXPLORE_01"]').check();
  assert.equal(await buy.isDisabled(), false);
  await buy.click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(p.__calls.filter((c) => c.op === 'guest-checkout').map((c) => c.body), [{ offer: 'direct_complete', code: p.__code, goal: 'GOAL_EXPLORE_01' }]);
  await p.__ctx.close();
});

test('完了ページ：この端末で解析レポート購入済みなら「解析レポートを読む」と追加 ¥2,000（同じ記録）', { skip: skip() }, async () => {
  const purchases = [{ ref: REF, analysis: 'active', complete: null, report: null, pending: false, claimed: false, canClaim: true, canUpgrade: true, thisRecord: true }];
  const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT,
    'guest-report': [200, { url: '/report.html?token=fake', expiresIn: 900 }] } });
  await p.waitForFunction(() => /解析レポートを読む/.test(document.querySelector('#lockUnlockAllBtn').textContent));
  await p.click('details.ca-fold > summary');
  const fold = p.locator('details.ca-fold');
  await fold.locator('[data-guest-buy="analysis_upgrade"]').waitFor();
  assert.match(await fold.innerText(), /追加 ¥2,000/);
  await fold.locator('input[value="GOAL_PACE_01"]').check();
  await fold.locator('[data-guest-buy="analysis_upgrade"]').click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(p.__calls.filter((c) => c.op === 'guest-checkout').map((c) => c.body), [{ offer: 'analysis_upgrade', code: p.__code, goal: 'GOAL_PACE_01' }]);
  await p.__ctx.close();
});

test('完了ページ（販売停止中）：¥1,000・¥3,000 とも「準備中」で押せない・Checkout を呼ばない', { skip: skip() }, async () => {
  const p = await resultPage({ salesOpen: false, api: { 'guest-status': [200, { salesOpen: false, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  assert.equal((await p.locator('#lockUnlockAllBtn').innerText()).trim(), '解析レポート（準備中）');
  assert.equal(await p.locator('#lockUnlockAllBtn').isDisabled(), true);
  await p.click('details.ca-fold > summary');
  await p.locator('details.ca-fold button.is-pending').waitFor();
  assert.equal((await p.locator('details.ca-fold button.is-pending').innerText()).trim(), '完全解析 ¥3,000（準備中）');
  await p.locator('#lockUnlockAllBtn').click({ force: true });
  assert.equal(p.__calls.filter((c) => c.op === 'guest-checkout').length, 0);
  await p.__ctx.close();
});

test('購入完了ページ：すぐ読めるボタン・完全解析の状態・控えめな引き継ぎ（文言どおり）。ID を画面に出さない', { skip: skip() }, async () => {
  const purchases = [{ ref: REF, analysis: 'active', complete: 'active', report: 'ready', pending: false, claimed: false, canClaim: true, canUpgrade: false }];
  for (const width of [320, 390, 1280]) {
    const p = await page('/purchase-complete', { width, api: { 'guest-status': [200, { salesOpen: true, purchases }],
      'guest-view': [200, { viewUrl: '/api/complete-status?view=fake', expiresIn: 300 }] } });
    await p.locator('[data-open-analysis]').waitFor();
    const text = await p.locator('main').innerText();
    assert.match(text, /ご購入ありがとうございます/);
    assert.match(text, /解析レポートを読む/);
    assert.match(text, /完全解析を読む/);
    assert.match(text, /この購入をマイページに引き継ぐ/);
    assert.match(text, /ログインすると、この診断記録と購入済みレポートをいつでも見返せます。/);
    assert.doesNotMatch(await p.content(), UUID_RE);
    assert.ok(await noScroll(p), 'width ' + width);
    // ログイン方法は押した時だけ（ここではマイページへ移動する）
    assert.equal(await p.locator('.au, #gateAuth').count(), 0);
    await p.__ctx.close();
  }
  const p = await page('/purchase-complete', { api: { 'guest-status': [200, { salesOpen: true, purchases }] } });
  await p.locator('[data-claim]').click();
  await p.waitForURL(/\/mypage\.html$/);
  assert.ok(await p.evaluate(() => !!sessionStorage.getItem('ed_claim_intent_v1')));
  await p.__ctx.close();
});

test('購入完了ページ：生成中は状態を表示して確認を続け、ready で「完全解析を読む」', { skip: skip() }, async () => {
  let n = 0;
  const p = await page('/purchase-complete', { api: { 'guest-status': () => [200, { salesOpen: true, purchases: [
    { ref: REF, analysis: 'active', complete: 'active', report: n++ < 1 ? 'generating' : 'ready', pending: false, claimed: false, canClaim: true, canUpgrade: false }] }] } });
  await p.waitForFunction(() => /作成中/.test(document.body.innerText));
  await p.locator('[data-open-complete]').waitFor({ timeout: 6000 });
  await p.__ctx.close();
});

test('購入完了ページ：この端末に購入が無い時は、同じ端末で開く案内と購入時メールでの引き継ぎ（マイページ）', { skip: skip() }, async () => {
  const p = await page('/purchase-complete?status=canceled', { api: { 'guest-status': [200, { salesOpen: true, purchases: [] }] } });
  await p.waitForFunction(() => /お手続きを中止しました/.test(document.body.innerText));
  assert.match(await p.locator('main').innerText(), /購入したときと同じ端末・ブラウザで開いてください/);
  assert.equal(await p.locator('a[href="/mypage.html#recover"]').count(), 1);
  assert.equal(new URL(p.url()).search, '', '戻り先の印を URL から消す');
  await p.__ctx.close();
});

test('解析レポート：この端末に引き継げる購入がある時だけ、最後に控えめな「マイページに引き継ぐ」', { skip: skip() }, async () => {
  const purchases = [{ ref: REF, analysis: 'active', complete: null, report: null, pending: false, claimed: false, canClaim: true, canUpgrade: true }];
  const p = await page('/report.html?token=fake', { api: { 'guest-status': [200, { salesOpen: true, purchases }] } });
  await p.waitForFunction(() => /この購入をマイページに引き継ぐ/.test(document.body.innerText), null, { timeout: 15000 });
  assert.match(await p.locator('body').innerText(), /ログインすると、この診断記録と購入済みレポートをいつでも見返せます。/);
  await p.__ctx.close();
  const q = await page('/report.html?token=fake', { api: { 'guest-status': [200, { salesOpen: true, purchases: [] }] } });
  await q.waitForTimeout(2500);
  assert.doesNotMatch(await q.locator('body').innerText(), /マイページに引き継ぐ/);
  await q.__ctx.close();
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
