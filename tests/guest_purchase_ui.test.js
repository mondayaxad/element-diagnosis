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
// user：ログイン中の本人として開く（supabase の代用品が本人とセッションを返す）。purchased：/api/my-entitlements の購入済みの診断コード
// reportData：/api/report-data の応答（解析レポートのページ用）
async function page(url, { width = 390, salesOpen = true, api = {}, clock = false, user = false, purchased = [], reportData = null } = {}) {
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
    purchased.forEach((c) => { keys['ETI-2.0:' + c] = true; });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ purchased_by_version: keys }) });
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

test('完了ページ（C7）：Stripe から「戻る」・タブ復帰・移動できなかった時に「決済画面へ移動しています…」のまま止めない', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await resultPage({ width, api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: false }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
    const btn = p.locator('#lockUnlockAllBtn');
    const label = (await btn.innerText()).trim();
    // 決済画面へ移れなかった（204）：移動を始めた印のまま → タブ復帰で戻る
    await p.route('https://checkout.stripe.com/**', (r) => r.fulfill({ status: 204, body: '' }));
    await btn.click();
    await p.waitForFunction(() => document.querySelector('#lockUnlockAllBtn[data-nav-busy="away"]'));
    assert.equal((await btn.innerText()).trim(), '決済画面へ移動しています…');
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal((await btn.innerText()).trim(), label);
    assert.equal(await btn.isDisabled(), false);
    // bfcache からの表示（pageshow persisted）
    await btn.click();
    await p.waitForFunction(() => document.querySelector('#lockUnlockAllBtn[data-nav-busy="away"]'));
    await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal((await btn.innerText()).trim(), label, String(width));
    assert.equal(await btn.isDisabled(), false);
    assert.equal(await noScroll(p), true, String(width));
    await p.__ctx.close();
  }
});

test('D4：旧版（legacy-v1）の結果には旧 Payment Link も新しい Checkout も出さず、対象外と最新の診断への案内（販売中でも）', { skip: skip() }, async () => {
  for (const width of [320, 1280]) {
    const p = await page('/', { width, api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: false }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
    const legacyCode = await p.evaluate(() => { const a = {}; for (let i = 0; i < QUESTIONS.length; i++) a[i] = (i % 5) - 2; return encodeAnswers(a); });
    await p.goto(`${base}/?code=${legacyCode}`);
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    await p.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
    const btn = p.locator('#lockUnlockAllBtn');
    assert.equal(await btn.isDisabled(), true);
    assert.equal((await p.locator('#legacyRetiredNote').innerText()).trim(), 'この結果は現在の解析商品の対象外です。最新の元素診断を受けてください。');
    await btn.click({ force: true }).catch(() => {});
    for (const b of await p.locator('.lock-cta').all()) await b.click({ force: true }).catch(() => {});
    assert.deepEqual(await p.evaluate(() => window.__opened), [], 'Payment Link を開かない');
    assert.equal(p.__calls.filter((c) => c.op === 'guest-checkout').length, 0, '新しい Checkout にも進まない');
    assert.doesNotMatch(await p.content(), /buy\.stripe\.com/);
    assert.equal(await noScroll(p), true, String(width));
    await p.__ctx.close();
  }
});

test('完了ページ（販売中）：完全解析 ¥3,000 は目標を選ぶまで押せない → 目標つきで Checkout', { skip: skip() }, async () => {
  const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  await p.click('details.ca-fold > summary');
  const fold = p.locator('details.ca-fold');
  // 展開しただけでは目標の選択・決済を出さない。「まだ見えていない輪郭を読む ¥3,000」を押してから
  const reveal = fold.locator('[data-reveal-offer="direct_complete"]');
  await reveal.waitFor();
  assert.equal((await reveal.innerText()).trim(), 'まだ見えていない輪郭を読む　¥3,000');
  assert.equal(await fold.locator('[data-guest-buy]').count(), 0);
  await reveal.click();
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

test('完了ページ（ログインなし）：この端末で購入済みでも「読む」に切り替えず、¥1,000・¥3,000 を申し込める（閲覧は購入完了ページ・メールの案内）', { skip: skip() }, async () => {
  const purchases = [{ ref: REF, analysis: 'active', complete: null, report: null, pending: false, claimed: false, canClaim: true, canUpgrade: true, thisRecord: true }];
  const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  await p.click('details.ca-fold > summary');
  const fold = p.locator('details.ca-fold');
  await fold.locator('[data-reveal-offer="direct_complete"]').waitFor();
  assert.match(await fold.innerText(), /この結果を購入済みの場合は、購入完了ページや購入時のメールからご覧いただけます。/);
  assert.equal(await fold.locator('a[href="/purchase-complete"]').count(), 1);
  assert.equal(await fold.locator('[data-reveal-offer="analysis_upgrade"]').count(), 0, '¥2,000 は解析レポートから');
  assert.doesNotMatch(await p.locator('#lockUnlockAllBtn').innerText(), /読む|購入済み/);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(p.__calls.filter((c) => c.op === 'guest-checkout').map((c) => c.body), [{ offer: 'analysis', code: p.__code }]);
  assert.equal(p.__calls.filter((c) => c.op === 'my-entitlements').length, 0, 'ログインしていなければマイページの権利は見ない');
  await p.__ctx.close();
});

test('完了ページ（ログイン中・マイページから過去の結果を開いた）：本人が購入済みなら「解析レポートを読む（マイページ）」・完全解析もマイページから（二重に決済しない）', { skip: skip() }, async () => {
  const p0 = await page('/');
  const code = await p0.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p0.__ctx.close();
  const p = await page('/', { user: true, purchased: [code], api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: true }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  await p.goto(`${base}/?dv=ETI-2.0&code=${code}`);
  await p.waitForFunction(() => /解析レポートを読む（マイページ）/.test(document.querySelector('#lockUnlockAllBtn').textContent));
  await p.click('details.ca-fold > summary');
  const fold = p.locator('details.ca-fold');
  assert.match(await fold.innerText(), /この結果は購入済みです。解析レポート・完全解析は、マイページの診断記録からご覧いただけます。/);
  assert.equal(await fold.locator('[data-reveal-offer]').count(), 0);
  assert.match(p.__calls.find((c) => c.op === 'my-entitlements').auth, /^Bearer /);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL((u) => u.pathname === '/mypage.html');
  assert.equal(p.__calls.filter((c) => c.op === 'guest-checkout').length, 0);
  await p.__ctx.close();
});

test('完了ページ（ログイン中）：前の結果を購入済みでも、違う診断結果ならそのまま ¥1,000・¥3,000 を買える', { skip: skip() }, async () => {
  const p0 = await page('/');
  const [codeA, codeB] = await p0.evaluate(() => [7, 3].map((k) => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * k) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); }));
  await p0.__ctx.close();
  const p = await page('/', { user: true, purchased: [codeA], api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: false }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  await p.goto(`${base}/?dv=ETI-2.0&code=${codeB}`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.click('details.ca-fold > summary');
  await p.locator('details.ca-fold [data-reveal-offer="direct_complete"]').waitFor();
  assert.ok(p.__calls.some((c) => c.op === 'my-entitlements'), '本人の購入を確かめた');
  assert.doesNotMatch(await p.locator('#lockUnlockAllBtn').innerText(), /マイページ|購入済み/);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(p.__calls.filter((c) => c.op === 'guest-checkout').map((c) => c.body), [{ offer: 'analysis', code: codeB }]);
  await p.__ctx.close();
});

test('完了ページ（販売停止中）：¥1,000・¥3,000 とも「準備中」で押せない・Checkout を呼ばない', { skip: skip() }, async () => {
  const p = await resultPage({ salesOpen: false, api: { 'guest-status': [200, { salesOpen: false, purchases: [] }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  assert.equal((await p.locator('#lockUnlockAllBtn').innerText()).trim(), '解析レポート（準備中）');
  assert.equal(await p.locator('#lockUnlockAllBtn').isDisabled(), true);
  await p.click('details.ca-fold > summary');
  await p.locator('details.ca-fold button.is-pending').waitFor();
  assert.equal((await p.locator('details.ca-fold button.is-pending').innerText()).trim(), 'まだ見えていない輪郭を読む　¥3,000（準備中）');
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

test('購入完了ページ：生成の最終の失敗は回り続けず「作成できませんでした」。「もう一度作成する」で作り直し→ready（C6）', { skip: skip() }, async () => {
  let queued = false;
  const p = await page('/purchase-complete', { api: {
    'guest-status': () => [200, { salesOpen: true, purchases: [
      { ref: REF, analysis: 'active', complete: 'active', report: queued ? 'ready' : 'failed', regenerate: queued ? null : 'available', pending: false, claimed: false, canClaim: true, canUpgrade: false }] }],
    'guest-regenerate': () => { queued = true; return [202, { result: 'queued' }]; },
  } });
  await p.waitForFunction(() => /作成できませんでした/.test(document.body.innerText));
  assert.equal(await p.locator('.spinner').count(), 0, '最終の失敗では回る表示を出さない');
  assert.doesNotMatch(await p.locator('body').innerText(), /作成をやり直しています/);
  assert.match(await p.locator('body').innerText(), /追加のお支払いはありません/);
  await p.locator('[data-regenerate]').click();
  await p.locator('[data-open-complete]').waitFor({ timeout: 6000 });
  assert.deepEqual(p.__calls.filter((c) => c.op === 'guest-regenerate').map((c) => c.body), [{ ref: REF }]);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
  // 上限：ボタンなし・お問い合わせ
  const q = await page('/purchase-complete', { api: { 'guest-status': [200, { salesOpen: true, purchases: [
    { ref: REF, analysis: 'active', complete: 'active', report: 'failed', regenerate: 'operator', pending: false, claimed: false, canClaim: true, canUpgrade: false }] }] } });
  await q.waitForFunction(() => /@mondayaxad までご連絡ください/.test(document.body.innerText));
  assert.equal(await q.locator('[data-regenerate]').count(), 0);
  await q.__ctx.close();
});

test('購入完了ページ：この端末に購入が無い時は、同じ端末で開く案内と購入時メールでの引き継ぎ（マイページ）', { skip: skip() }, async () => {
  const p = await page('/purchase-complete?status=canceled', { api: { 'guest-status': [200, { salesOpen: true, purchases: [] }] } });
  await p.waitForFunction(() => /お手続きを中止しました/.test(document.body.innerText));
  assert.match(await p.locator('main').innerText(), /購入したときと同じ端末・ブラウザで開いてください/);
  assert.equal(await p.locator('a[href="/mypage.html#recover"]').count(), 1);
  assert.equal(new URL(p.url()).search, '', '戻り先の印を URL から消す');
  await p.__ctx.close();
});

test('解析レポート：完全解析の欄から「マイページに保存する」。この端末の購入は引き継ぎへ、無ければ購入時のメールの確認へ', { skip: skip() }, async () => {
  const p0 = await page('/');
  const code = await p0.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p0.__ctx.close();
  const reportData = { diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: true, journey_report_access: false }, purchase: null, code, viewer: 'guest' };
  const purchases = [{ ref: REF, analysis: 'active', complete: null, report: null, pending: false, claimed: false, canClaim: true, canUpgrade: true, thisRecord: true }];
  const p = await page('/report.html?token=fake', { reportData, api: { 'guest-status': [200, { salesOpen: true, purchases }] } });
  const save = p.locator('[data-report-mypage-save]');
  await save.waitFor();
  assert.equal((await save.innerText()).trim(), 'マイページに保存する（ログイン）');
  await save.click();
  await p.waitForURL((u) => u.pathname === '/mypage.html' && u.hash === '');
  await p.__ctx.close();
  const q = await page('/report.html?token=fake', { reportData, api: { 'guest-status': [200, { salesOpen: true, purchases: [] }] } });
  await q.locator('[data-report-mypage-save]').click();
  await q.waitForURL((u) => u.pathname === '/mypage.html' && u.hash === '#recover');
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

test('完了ページ：未払いの決済が残っていても買っていない扱い。申込の導線をそのまま出し、そこから申し込める（C3）', { skip: skip() }, async () => {
  const p = await resultPage({ api: {
    'guest-status': () => [200, { salesOpen: true, purchases: [{ ref: REF, analysis: null, complete: null, report: null, pending: true, claimed: false, canClaim: false, canUpgrade: false, thisRecord: true }], codePurchased: false }],
    'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
  await p.evaluate(() => { const d = document.querySelector('details.ca-fold'); if (d) d.open = true; });
  const offer = p.locator('[data-reveal-offer="direct_complete"]');
  await offer.waitFor();
  const text = await p.locator('[data-guest-complete]').innerText();
  assert.match(text, /前回のお手続きは完了していません（お支払いは発生していません）。もう一度お申し込みいただけます。/);
  assert.doesNotMatch(text, /購入状況を見る|購入済み/);
  await offer.click();
  await p.waitForSelector('input[name="guest-mentor-goal"]');
  assert.ok(await noScroll(p));
  await p.__ctx.close();
});

test('購入完了ページ：このブラウザに複数の購入がある時は、購入の日時で見分けられる', { skip: skip() }, async () => {
  const one = (at) => ({ ref: REF, analysis: 'active', complete: null, report: null, pending: false, claimed: false, canClaim: true, canUpgrade: true, purchasedAt: at });
  const p = await page('/purchase-complete', { api: { 'guest-status': [200, { salesOpen: true, purchases: [one('2026-10-13T22:08:58.000Z'), one('2026-10-14T01:42:35.000Z')] }] } });
  await p.waitForFunction(() => document.querySelectorAll('.pc-at').length === 2);
  const lines = await p.locator('.pc-at').allInnerTexts();
  assert.ok(lines.every((t) => /^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2} のご購入$/.test(t.trim())), lines.join('|'));
  assert.notEqual(lines[0], lines[1]);
  await p.__ctx.close();
});

test('購入完了ページ（Stripe で戻った ?status=canceled）：未払いの決済を閉じてから表示・URL から印を消す（C3）', { skip: skip() }, async () => {
  const p = await page('/purchase-complete?status=canceled', { api: {
    'guest-cancel': [200, { closed: 1, paid: 0 }], 'guest-status': [200, { salesOpen: true, purchases: [] }] } });
  await p.waitForFunction(() => /ご購入を確認できませんでした/.test(document.body.innerText));
  const ops = p.__calls.map((c) => c.op);
  assert.deepEqual(ops.slice(0, 2), ['guest-cancel', 'guest-status']);
  assert.match(await p.locator('#pcTitle').innerText(), /中止/);
  assert.equal(await p.evaluate(() => location.search), '');
  await p.__ctx.close();
});

test('購入完了ページ：確認を使い切ったら回り続ける表示を止め、読み込み直しの案内を出す', { skip: skip() }, async () => {
  const p = await page('/purchase-complete', { clock: true, api: { 'guest-status': [200, { salesOpen: true, purchases: [{ ref: REF, analysis: null, complete: null, report: null, pending: true, claimed: false, canClaim: false, canUpgrade: false }] }] } });
  await p.waitForSelector('.spinner');
  // 偽の時計を進める間に、実際の通信（状態の確認）が終わるのを待つ（負荷の高い時でも確認の回数を使い切るまで進める）
  for (let i = 0; i < 40; i++) {
    if (await p.evaluate(() => /確認に時間がかかっています/.test(document.body.innerText))) break;
    await p.clock.runFor(31000);
    await new Promise((r) => setTimeout(r, 100));
  }
  await p.waitForFunction(() => /確認に時間がかかっています/.test(document.body.innerText));
  assert.equal(await p.locator('.spinner').count(), 0);
  await p.__ctx.close();
});

// ================= A：BEYOND THE RESULT（完全解析の訴求）
test('BEYOND THE RESULT：¥1,000 の主導線の下。閉じた状態は予告だけ・展開でサンプルと ¥3,000。320／390／1280px で重なり・はみ出しなし', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await resultPage({ width, api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: false }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
    await p.evaluate(() => { window.__ev = []; window.gtag = function () { window.__ev.push(Array.from(arguments)); }; });
    const fold = p.locator('details.ca-reveal');
    const btn = p.locator('#lockUnlockAllBtn');
    const b1 = await btn.boundingBox();
    const f1 = await fold.boundingBox();
    assert.ok(f1.y >= b1.y + b1.height, `${width}: ¥1,000 の下（${b1.y + b1.height} ≤ ${f1.y}）`);
    assert.ok(b1.height >= 44, `${width}: ¥1,000 の大きさを保つ`);
    assert.equal(await fold.evaluate((d) => d.open), false);
    await fold.locator('[data-reveal-offer]').waitFor({ state: 'attached' });
    assert.equal(await fold.locator('[data-reveal-offer]').isVisible(), false, '閉じた状態に ¥3,000 の導線を見せない');
    assert.equal(await fold.locator('[data-ca-sample]').isVisible(), false);
    assert.doesNotMatch(await fold.locator('summary').innerText(), /¥/);
    assert.equal(await noScroll(p), true, `${width}: 閉じた状態`);
    await fold.locator('summary').click();
    await fold.locator('[data-reveal-offer="direct_complete"]').waitFor();
    assert.equal(await fold.locator('[data-ca-sample]').isVisible(), true);
    assert.equal(await noScroll(p), true, `${width}: 開いた状態`);
    // 本文・ボタンが横にはみ出さない（カードの内側に収まる）
    const out = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll('details.ca-reveal *')).filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > vw + 0.5 || r.left < -0.5); }).map((el) => el.className || el.tagName);
    });
    assert.deepEqual(out, [], `${width}: はみ出し`);
    // 計測：展開・サンプル・¥3,000（匿名。記録 ID・URL・診断コードを含めない）
    await p.route('**/complete-sample', (r) => r.fulfill({ contentType: 'text/html', body: '<p>sample</p>' }));
    const [popup] = await Promise.all([p.waitForEvent('popup'), fold.locator('[data-ca-sample]').click()]);
    await popup.close();
    await fold.locator('[data-reveal-offer="direct_complete"]').click();
    await fold.locator('[data-guest-buy]').waitFor();
    const ev = await p.evaluate(() => window.__ev.filter((a) => a[0] === 'event').map((a) => [a[1], a[2]]));
    const names = ev.map((e) => e[0]);
    for (const n of ['complete_details_open', 'complete_sample_open', 'complete_offer_click']) assert.ok(names.includes(n), `${width}: ${n}`);
    assert.doesNotMatch(JSON.stringify(ev), new RegExp(`${p.__code}|https?:|sess-|@`));
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('BEYOND THE RESULT：展開時だけ光点と線が現れ、prefers-reduced-motion では動きを止める', { skip: skip() }, async () => {
  for (const reduced of [false, true]) {
    const p = await resultPage({ api: { 'guest-status': [200, { salesOpen: true, purchases: [], codePurchased: false }], 'guest-goals': GOALS, 'guest-checkout': CHECKOUT } });
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
