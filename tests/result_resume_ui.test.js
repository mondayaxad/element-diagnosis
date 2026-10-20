// 診断結果の固有リンク（/result#r=<秘密値>）の画面の試験（Playwright）。
// API（/api/complete-checkout?op=…）・Supabase・Stripe はすべて差し替え。外部へは接続しない。
//   ・診断を完了すると、表示の後に固有リンクを作り、履歴の URL を /result#r=… に書き換える
//   ・同じ URL を開き直す（再読み込み・新しいタブ・履歴・ブックマーク相当）と、同じ診断結果を復元する
//   ・秘密値は URL のフラグメントにだけ置く（HTML・GA4・console・API の URL に出さない）
//   実行: node --test tests/result_resume_ui.test.js
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
    fs.createReadStream(f).pipe(res);
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
const resultText = (p) => p.evaluate(() => {
  const r = document.getElementById('diagnosis-root');
  return r ? (r.querySelector('h1, h2') || r).innerText.slice(0, 200) : '';
});
async function assertNoSecret(p, w, token) {
  const html = await p.content();
  assert.ok(!html.includes(token), 'HTML に秘密値を出さない');
  const ev = JSON.stringify(await p.evaluate(() => window.__ev));
  assert.ok(!ev.includes(token), 'GA4 に秘密値を出さない');
  assert.ok(!p.__console.some((l) => l.includes(token)), 'console に出さない');
  assert.ok(w.calls.every((c) => !c.url.includes(token)), 'API の URL に秘密値を入れない（本文だけ）');
}

test('診断完了 → 固有リンク（/result#r=）→ 再読み込み・新しいタブで同じ診断結果。案内は控えめに表示。秘密値を HTML・GA4・console に出さない', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForFunction(() => location.pathname === '/result' && location.hash.startsWith('#r='));
  const tk = w.issued[0];
  assert.match(tk, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(tk, 'base64url').length, 32, '256bit');
  assert.equal(new URL(p.url()).hash, '#r=' + tk);
  assert.equal(new URL(p.url()).search, '', '問い合わせ文字列に何も入れない');
  assert.deepEqual(w.calls.filter((c) => c.op === 'result-link').map((c) => c.body), [{ code, token: tk }]);
  const note = p.locator('#resumeNote');
  await note.waitFor();
  assert.equal((await note.innerText()).replace(/\s+/g, ''), 'この診断結果は、ブラウザの履歴からもう一度開けます。URLを知っている人は結果を表示できるため、共有にはご注意ください。');
  const before = await resultText(p);
  await assertNoSecret(p, w, tk);
  // 再読み込み
  await p.reload();
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(await resultText(p), before, '同じ診断結果');
  assert.equal(await p.locator('meta[name="robots"][content*="noindex"]').count(), 1, 'noindex');
  assert.equal(w.calls.filter((c) => c.op === 'result-link').length, 1, '開き直しでは新しいリンクを作らない');
  assert.deepEqual(w.calls.filter((c) => c.op === 'result-open').map((c) => c.body), [{ token: tk }]);
  // 新しいタブ（ブックマーク・履歴相当）
  const q = await open(ctx, `/result#r=${tk}`);
  await q.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(await resultText(q), before);
  assert.equal(await q.locator('#resumeNote').isVisible(), true);
  // 固有リンクから始めた購入は、その記録に結び付ける（秘密値は本文で送る）
  await q.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  await q.locator('#lockUnlockAllBtn').click();
  await q.waitForURL(/checkout\.stripe\.com/);
  assertBuy(w, tk);
  assert.deepEqual(p.__errors.concat(q.__errors), []);
  await ctx.close();
});

test('再診断はそれぞれ別の固有リンク。旧形式の ?code= から開いた結果には作らない。作成に失敗しても結果は使える（申込は購入の対象を作れるまで進めない）', { skip: skip() }, async () => {
  let w = world();
  let ctx = await newContext();
  await wire(ctx, w);
  let p = await open(ctx, '/');
  w.linkDelay = 400;
  await complete(p, 7);
  // 応答を待つ間の描き直し（連打・再表示）でも作成の要求は1回だけ
  await p.evaluate(() => { render(); render(); }); // eslint-disable-line no-undef
  await p.waitForFunction(() => location.hash.startsWith('#r='));
  assert.equal(w.calls.filter((c) => c.op === 'result-link').length, 1);
  assert.equal(new URL(p.url()).hash, '#r=' + w.issued[0]);
  w.linkDelay = 0;
  await p.evaluate(() => startNewDiagnosisV2()); // eslint-disable-line no-undef
  assert.equal(new URL(p.url()).pathname, '/', '新しい診断を始めたら TOP の URL へ戻す');
  await complete(p, 3);
  await p.waitForFunction((t) => location.hash.startsWith('#r=') && location.hash !== '#r=' + t, w.issued[0]);
  assert.equal(w.calls.filter((c) => c.op === 'result-link').length, 2);
  assert.equal(w.issued.length, 2);
  assert.notEqual(w.issued[0], w.issued[1], '再診断は別の秘密値');
  assert.equal(new URL(p.url()).hash, '#r=' + w.issued[1]);
  await ctx.close();
  // ?code= から開いた結果（共有 URL など）：リンクを作らない
  w = world();
  ctx = await newContext();
  await wire(ctx, w);
  p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForFunction(() => location.hash.startsWith('#r='));
  const q = await open(ctx, `/?dv=ETI-2.0&code=${code}`);
  await q.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await q.waitForTimeout(400);
  assert.equal(w.calls.filter((c) => c.op === 'result-link').length, 1);
  assert.equal(await q.locator('#resumeNote').isVisible(), false);
  await ctx.close();
  // 作成に失敗（429：作成の回数の上限・503）：URL は変えず、結果と ¥1,000 はそのまま
  w = world({ linkStatus: 429 });
  ctx = await newContext();
  await wire(ctx, w);
  p = await open(ctx, '/');
  const code2 = await complete(p);
  await p.waitForFunction(() => window.__resumeCreating === window.__resultNonce);
  await p.waitForTimeout(300);
  assert.equal(new URL(p.url()).pathname, '/');
  assert.equal(await p.locator('#resumeNote').isVisible(), false);
  // 購入の対象（記録）を作れなかった：申込は進めず、読み込み直しの案内（作り直しを1回試す）。診断コードだけでは申し込まない
  assert.ok(code2);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForFunction(() => /購入の準備ができませんでした/.test((document.getElementById('guestAnalysisMsg') || {}).textContent || ''), null, { timeout: 15000 });
  assert.equal(w.calls.filter((c) => c.op === 'buy').length, 0);
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

test('不正・失効・存在しない秘密値は「この診断結果は開けません」と TOP への導線だけ（情報を出さない）。一時的な失敗は再試行の案内', { skip: skip() }, async () => {
  for (const [hash, status, title] of [
    ['#r=' + 'Z'.repeat(43), null, 'この診断結果は開けません'], // サーバーに無い（失効・削除済みも同じ 404）
    ['#r=short', null, 'この診断結果は開けません'],
    ['', null, 'この診断結果は開けません'],
    ['#r=' + TOKEN, 503, 'いまは診断結果を開けません'],
  ]) {
    const w = world({ openStatus: status });
    const ctx = await newContext();
    await wire(ctx, w);
    const p = await open(ctx, '/result' + hash);
    await p.waitForSelector('.resume-err');
    assert.equal((await p.locator('.resume-err-title').innerText()).trim(), title, hash);
    assert.equal(await p.locator('.resume-err a[href="/"]').count(), 1);
    assert.doesNotMatch(await p.locator('.resume-err').innerText(), /result_not_found|404|ETI|[0-9a-f]{8}-/);
    assert.equal(await p.locator('#lockUnlockAllBtn').count(), 0);
    assert.deepEqual(p.__errors, []);
    await ctx.close();
  }
});

test('Stripe でキャンセルして戻っても、購入完了ページから同じ固有リンクの結果へ戻り、すぐ買い直せる・戻る/進む・pageshow で結果を保つ', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForFunction(() => location.hash.startsWith('#r='));
  const tk = w.issued[0];
  // キャンセルの戻り先（購入完了ページ）
  await ctx.route('**/api/complete-checkout?op=guest-cancel', (r) => r.fulfill({ contentType: 'application/json', body: '{"closed":1,"paid":0}' }));
  await p.goto(base + '/purchase-complete?status=canceled');
  const back = p.locator('#pcResultLink');
  await back.waitFor();
  assert.equal(await back.getAttribute('href'), '/result#r=' + tk);
  await back.click();
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assertBuy(w, tk);
  // ブラウザの「戻る」：結果の URL のまま
  await p.goBack();
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(new URL(p.url()).hash, '#r=' + tk);
  await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  // 戻る・進むで復元された結果ページは、購入状態を確かめ直してから押せる
  await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  await ctx.close();
});

test('320・390・1280px：固有リンクの案内・開けない時の表示に横はみ出しがない', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const w = world();
    const ctx = await newContext({ width });
    await wire(ctx, w);
    const p = await open(ctx, '/');
    await complete(p);
    await p.locator('#resumeNote').waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: 結果`);
    const q = await open(ctx, '/result#r=' + 'Q'.repeat(43));
    await q.waitForSelector('.resume-err');
    assert.ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}: 開けない時`);
    await ctx.close();
  }
});


test('同じ診断結果を別の人・別の端末が購入済みでも、この端末に記録が無ければ未購入として ¥1,000・¥3,000 を売る（別の人の購入を表示しない）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForSelector('[data-buy-complete]', { state: 'attached' });
  assert.doesNotMatch(await p.locator('[data-buy-complete]').textContent(), /購入済み/);
  await p.waitForFunction(() => location.hash.startsWith('#r='));
  await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
  assert.doesNotMatch(await p.locator('#lockUnlockAllBtn').innerText(), /購入済み/);
  await p.locator('#lockUnlockAllBtn').click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.ok(code);
  assertBuy(w, w.issued[0]);
  await ctx.close();
});
