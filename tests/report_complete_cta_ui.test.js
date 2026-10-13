// 解析レポート末尾の完全解析の案内（実データ）の試験（Playwright）。API はすべて差し替え。外部へは接続しない。
//   ・ゲスト（この端末で ¥1,000 を購入）：追加 ¥2,000 の申込 → 同じ記録の結果ページで MENTOR 目標の選択を開く
//     （この端末の固有リンクが同じ診断結果ならそれを使い、無ければ診断コードで開く）
//   ・マイページ経由：マイページで申し込む導線。購入済み・決済中・確かめられない時は売らない
//   実行: node --test tests/report_complete_cta_ui.test.js
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
const TOKEN = 'ReportResumeTokenForTheSameRecord_ABCDEFGHI'; // 43文字
const VERSIONS = { itemSetVersion: 'ETI-ITEM-2.0.0', scoringVersion: 'ETI-SCORE-2.0.0', translationModelVersion: 'ETI-TRANS-2.0.0',
  characterProfileVersion: 'ETI-CHAR-2.1.0', mirrorModelVersion: 'ETI-MIRROR-2.1.0' };
const REF = 'a1b2c3d4e5f6a7b8c9d0';
const mine = (o) => Object.assign({ ref: REF, analysis: 'active', complete: null, report: null, pending: false, claimed: false, canClaim: true, canUpgrade: true, thisRecord: true }, o || {});

let server, base, browser, CODE, OTHER;
test.before(async () => {
  if (!chromium) return;
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
  const vm = require('vm');
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const make = (k) => vm.runInContext(`(() => { const A = {}; ETI_V2_QUESTIONS.forEach((q, i) => { A[q.id] = ((i * ${k}) % 5) - 2; }); return ETIv2.encodeAnswersV2(A, ETI_V2_QUESTIONS); })()`, ctx);
  CODE = make(7);
  OTHER = make(3);
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

function world(over) {
  return Object.assign({ viewer: 'guest', purchases: [mine()], statusCode: 200, salesOpen: true, links: { [TOKEN]: null }, calls: [] }, over || {});
}
async function context(w, { width = 390, lastResult } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  await ctx.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await ctx.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs({ completeSalesOpen: w.salesOpen, completeApiReady: true }) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/cdnjs\.cloudflare\.com|googletagmanager|jsdelivr/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await ctx.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await ctx.route('**/api/report-data**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: true, journey_report_access: false }, purchase: null, code: CODE, viewer: w.viewer }) }));
  await ctx.route('**/api/complete-checkout?op=*', (r) => {
    const req = r.request();
    const op = new URL(req.url()).searchParams.get('op');
    const body = JSON.parse(req.postData() || '{}');
    w.calls.push({ op, body, url: req.url() });
    const send = (status, json) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (op === 'guest-status') return w.statusCode !== 200 ? send(w.statusCode, { error: 'service_unavailable' }) : send(200, { salesOpen: w.salesOpen, purchases: w.purchases, codePurchased: false });
    if (op === 'result-open') {
      const code = Object.prototype.hasOwnProperty.call(w.links, body.token) ? (w.links[body.token] || CODE) : null;
      return code ? send(200, { code, diagnosisVersion: 'ETI-2.0', versions: VERSIONS }) : send(404, { error: 'result_not_found' });
    }
    if (op === 'guest-goals') return send(200, { salesOpen: true, catalog: CE.MENTOR_CATALOG });
    if (op === 'guest-checkout') return send(200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', offer: body.offer, amount: 2000 });
    if (op === 'result-link') return send(200, { result: 'created' });
    return send(404, { error: 'not_found' });
  });
  await ctx.addInitScript((t) => {
    window.__ev = []; window.gtag = function () { window.__ev.push(Array.from(arguments)); };
    if (t) { try { localStorage.setItem('ed_last_result_v1', t); } catch (e) { /* なし */ } }
  }, lastResult || null);
  return ctx;
}
async function openReport(ctx) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(String(e)));
  await p.goto(base + '/report.html?token=x');
  await p.waitForSelector('.ca-r-sec [data-report-complete]', { state: 'attached' });
  await p.waitForFunction(() => !/購入状態を確認しています/.test(document.querySelector('[data-report-complete]').innerText));
  return p;
}
const box = (p) => p.locator('[data-report-complete]');

test('ゲスト（解析レポート購入済み）：BEYOND THE REPORT・追加 ¥2,000 → 同じ記録の固有リンクの結果ページで目標の選択を開く → 決済はその記録に結び付く', { skip: skip() }, async () => {
  const w = world();
  const ctx = await context(w, { lastResult: TOKEN });
  const p = await openReport(ctx);
  const sec = await p.locator('.ca-r-sec').innerText();
  assert.match(sec, /BEYOND THE REPORT｜この先にあるもの/);
  assert.match(sec, /このレポートが描いたのは、いまのあなたの輪郭。\s*その奥にある三つの人物像を、46ページで読み解く。/);
  assert.match(sec, /MIRROR[\s\S]*HIDDEN SHAPE[\s\S]*MENTOR/);
  assert.match(sec, /この解析レポートの内容は、すべて含まれます\s*追加 ¥2,000/);
  assert.ok(!/¥3,000|¥1,000|購入状態を確認できない/.test(sec));
  const btn = box(p).locator('[data-report-upgrade]');
  assert.equal((await btn.innerText()).trim(), 'まだ見えていない輪郭を読む　追加¥2,000');
  assert.equal(await box(p).locator('a[href="/complete-sample"][target="_blank"]').count(), 1);
  assert.deepEqual(w.calls.find((c) => c.op === 'guest-status').body, { code: CODE }, 'この記録の購入状態を確かめる');
  await btn.click();
  await p.waitForURL((u) => u.pathname === '/result');
  // 結果ページ：欄が開き、MENTOR 目標の選択が出ている。URL の buy は消す（固有リンクは残す）
  await p.waitForSelector('input[name="guest-mentor-goal"]');
  assert.equal(new URL(p.url()).hash, '#r=' + TOKEN);
  assert.equal(await p.locator('details.ca-reveal').evaluate((d) => d.open), true);
  assert.match(await p.locator('[data-guest-complete]').innerText(), /まだ見えていない輪郭を読む　追加¥2,000/);
  await p.locator('input[name="guest-mentor-goal"]').first().check();
  await p.locator('[data-guest-buy]').click();
  await p.waitForURL(/checkout\.stripe\.com/);
  const co = w.calls.filter((c) => c.op === 'guest-checkout').map((c) => c.body);
  assert.equal(co.length, 1);
  assert.deepEqual([co[0].offer, co[0].code, co[0].resume, typeof co[0].goal], ['analysis_upgrade', CODE, TOKEN, 'string']);
  // 計測：レポート側で1回だけ（source=analysis_report）。診断コード・秘密値を送らない
  const ev = JSON.stringify(await p.evaluate(() => window.__ev).catch(() => []));
  assert.ok(!ev.includes(CODE) && !ev.includes(TOKEN));
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

test('ゲスト：この端末に固有リンクが無い・別の診断結果のリンクなら、診断コードで結果ページを開いて目標の選択へ', { skip: skip() }, async () => {
  for (const lastResult of [null, 'OtherResultTokenForAnotherDiagnosis_ABCDEFG']) {
    const w = world();
    if (lastResult) w.links[lastResult] = OTHER;
    const ctx = await context(w, { lastResult });
    const p = await openReport(ctx);
    await box(p).locator('[data-report-upgrade]').click();
    await p.waitForSelector('input[name="guest-mentor-goal"]');
    const u = new URL(p.url());
    assert.deepEqual([u.pathname, u.searchParams.get('code'), u.hash], ['/', CODE, ''], String(lastResult));
    assert.equal(w.calls.filter((c) => c.op === 'result-link').length, 0, '開き直した結果では新しいリンクを作らない');
    assert.deepEqual(p.__errors, []);
    await ctx.close();
  }
});

test('購入済み・決済中・購入が見つからない・確かめられない・販売停止・マイページ経由の出し分け', { skip: skip() }, async () => {
  const cases = [
    [{ purchases: [mine({ complete: 'active', canUpgrade: false })] }, /完全解析は購入済みです/, 'a[href="/purchase-complete"]'],
    [{ purchases: [mine({ pending: true })] }, /お支払いを確認しています/, 'a[href="/purchase-complete"]'],
    [{ purchases: [] }, /購入状態を確認できないため、購入導線は表示していません/, null],
    [{ statusCode: 503 }, /購入状態を確認できないため/, null],
    [{ salesOpen: false }, /追加¥2,000（準備中）[\s\S]*完全解析は準備中です/, 'button.is-pending[disabled]'],
    [{ viewer: 'mypage' }, /追加 ¥2,000[\s\S]*マイページで完全解析を申し込む/, 'a[href="/mypage.html"]'],
    [{ viewer: 'legacy' }, /購入状態を確認できないため/, null],
  ];
  for (const [over, re, sel] of cases) {
    const w = world(over);
    const ctx = await context(w);
    const p = await openReport(ctx);
    const t = await box(p).innerText();
    assert.match(t, re, JSON.stringify(over));
    if (sel) assert.equal(await box(p).locator(sel).count(), 1, JSON.stringify(over));
    assert.equal(await box(p).locator('[data-report-upgrade]').count(), 0, '売らない：' + JSON.stringify(over));
    if (over.viewer === 'mypage' || over.viewer === 'legacy') assert.equal(w.calls.filter((c) => c.op === 'guest-status').length, 0);
    assert.deepEqual(p.__errors, []);
    await ctx.close();
  }
});

test('320・390・1280px：完全解析の案内が横にはみ出さない・ボタンは 44px 以上', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const w = world();
    const ctx = await context(w, { width });
    const p = await openReport(ctx);
    // 今回の欄（完全解析の案内）が画面の幅に収まる（レポート上部の円グラフの 320px のはみ出しは既存・別件）
    const over = await p.evaluate(() => Array.from(document.querySelectorAll('.ca-r-sec, .ca-r-sec *'))
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 || e.getBoundingClientRect().left < -0.5).map((e) => e.tagName + '.' + e.className));
    assert.deepEqual(over, [], String(width));
    const b = await box(p).locator('[data-report-upgrade]').boundingBox();
    assert.ok(b.height >= 44, String(width));
    await ctx.close();
  }
});
