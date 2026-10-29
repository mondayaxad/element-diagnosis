// 旧版（element-v1）の解析レポート販売の再開（2026-10-29）の画面試験（Playwright。外部へは接続しない）。
//   ・本番のドメインで販売中：旧版の結果の「解析レポート ¥1,000」が押せて、旧 Payment Link（client_reference_id＝診断コード）へ進む。完全解析は出ない
//   ・販売停止中・診断コードが不正：押せない（準備中）
//   ・旧版のレポート下部：「マイページに引き継ぐ」→ 診断結果の保存カード（/?code=…#recordCard）
//   実行: node --test tests/legacy_report_sales_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const skip = () => (chromium ? false : 'playwright がありません');
const ROOT = path.join(__dirname, '..');
const { PROD_ENV, PROD_REF } = require('./fixtures/server_env');
// 本番のドメイン用の公開設定（appEnv=production）
const prodPublicConfigJs = (extra = {}) => `window.__ED_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify({ appEnv: 'production', supabaseUrl: PROD_ENV.SUPABASE_URL, supabaseAnonKey: PROD_ENV.SUPABASE_ANON_KEY, projectRef: PROD_REF, ...extra })});`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const HOST = 'https://element-diagnosis-five.vercel.app';
const LINK = 'https://buy.stripe.com/3cIcMXdCy5VbavmgsK3Nm08';

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); });
test.after(async () => { if (browser) await browser.close(); });

async function prodPage({ salesOpen = true, width = 390, reportData = null, signedIn = false, saved = false, handoff = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const hits = [];
  const calls = [];
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin === HOST) {
      if (u.pathname === '/api/public-config') return r.fulfill({ contentType: 'application/javascript', body: prodPublicConfigJs(salesOpen ? { completeSalesOpen: true, completeApiReady: true } : { completeApiReady: true }) });
      if (u.pathname === '/api/my-report-link' && handoff) {
        calls.push({ auth: r.request().headers().authorization || '', body: JSON.parse(r.request().postData() || '{}') });
        return handoff(r);
      }
      if (u.pathname === '/api/report-data') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(reportData || {}) });
      if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      const rel = u.pathname === '/' || u.pathname === '/result' ? '/index.html' : decodeURIComponent(u.pathname);
      let f = path.join(ROOT, rel);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
      // 試験のサーバーと同じく、外部スクリプトの integrity（SRI）は外して返す（本番の HTML はそのまま）
      const raw = path.extname(f) === '.html' ? fs.readFileSync(f, 'utf8').replace(/\s+integrity="sha(?:256|384|512)-[A-Za-z0-9+/=]+"/g, '') : fs.readFileSync(f);
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: raw });
    }
    if (signedIn && /supabase-js@2/.test(u.href)) {
      const user = '{id:"11111111-1111-4111-8111-111111111111"}';
      const row = saved ? '[{id:"22222222-2222-4222-8222-222222222222",diagnosis_version:"element-v1",item_set_version:null,diagnosis_results:[{diagnosis_code:window.__lastApplyData,scoring_version:SCORING_VERSION,item_set_version:null}]}]' : '[]';
      return r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:' + row + ',error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:' + user + '}}),getSession:async()=>({data:{session:{access_token:"tok-user",user:' + user + '}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' });
    }
    if (u.origin === 'https://buy.stripe.com') { hits.push(r.request().url()); return r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }); }
    return r.fulfill({ contentType: 'application/javascript', body: '' });
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  p.__ctx = ctx; p.__hits = hits; p.__calls = calls;
  return p;
}
async function legacyCode(p) {
  await p.goto(`${HOST}/`);
  return p.evaluate(() => { const a = {}; for (let i = 0; i < QUESTIONS.length; i++) a[i] = (i % 5) - 2; return encodeAnswers(a); });
}

test('本番のドメインで販売中：旧版の結果から旧 Payment Link へ（client_reference_id＝診断コード）。完全解析は出さない', { skip: skip() }, async () => {
  for (const sel of ['#lockUnlockAllBtn', '.lock-cta']) {
    const p = await prodPage();
    const code = await legacyCode(p);
    await p.goto(`${HOST}/?code=${code}`);
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    assert.equal(await p.locator('[data-buy-complete]').count(), 0, '完全解析は販売しない');
    const btn = p.locator(sel).first();
    assert.equal(await btn.isDisabled(), false);
    assert.doesNotMatch(await p.locator('#lockUnlockAllBtn').innerText(), /準備中/);
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await p.waitForURL((u) => u.origin === 'https://buy.stripe.com', { timeout: 8000 }).catch(() => {});
    assert.equal(p.__hits.length, 1, sel);
    const u = new URL(p.__hits[0]);
    assert.equal(u.origin + u.pathname, LINK);
    assert.equal(u.searchParams.get('client_reference_id'), code);
    assert.ok(!/^v2_/.test(u.searchParams.get('client_reference_id')));
    await p.__ctx.close();
  }
});

test('販売停止中は旧版も押せない（準備中）。Payment Link へ進まない', { skip: skip() }, async () => {
  const p = await prodPage({ salesOpen: false });
  const code = await legacyCode(p);
  await p.goto(`${HOST}/?code=${code}`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  const btn = p.locator('#lockUnlockAllBtn');
  assert.equal(await btn.isDisabled(), true);
  assert.match(await btn.innerText(), /準備中/);
  await btn.click({ force: true }).catch(() => {});
  assert.equal(p.__hits.length, 0);
  await p.__ctx.close();
});

test('現在の診断（ETI v2）のボタンは Payment Link に進まない（旧版だけが旧リンク）', { skip: skip() }, async () => {
  const p = await prodPage();
  await p.goto(`${HOST}/`);
  const code = await p.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p.goto(`${HOST}/?dv=ETI-2.0&code=${code}`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(await p.locator('[data-legacy-buy]').count(), 0);
  await p.__ctx.close();
});

test('旧版のレポート下部：「マイページに引き継ぐ」が、診断結果の保存カードへ進む', { skip: skip() }, async () => {
  const p = await prodPage();
  const code = await legacyCode(p);
  await p.close();
  const q = await prodPage({ reportData: { diagnosis_version: 'element-v1', code, entitlements: { core_analysis_access: true } } });
  await q.goto(`${HOST}/report.html?token=x`);
  const a = q.locator('[data-legacy-handoff]');
  await a.waitFor({ state: 'attached' });
  assert.equal(await a.getAttribute('href'), `/?code=${code}#recordCard`);
  assert.match(await a.innerText(), /マイページに引き継ぐ/);
  await a.click();
  await q.waitForURL((u) => u.pathname === '/' && u.hash === '#recordCard');
  await q.waitForSelector('#recordCard', { state: 'attached' });
  assert.equal(await q.locator('[data-buy-complete]').count(), 0);
  await q.__ctx.close();
});

test('ETI v2 のレポートには「マイページに引き継ぐ」を出さない', { skip: skip() }, async () => {
  const src = fs.readFileSync(path.join(ROOT, 'report.html'), 'utf8');
  const calls = src.match(/^\s+initLegacyHandoff\(code\);/gm) || [];
  assert.equal(calls.length, 1, '旧版の分岐でだけ呼ぶ');
  assert.ok(src.indexOf('initLegacyHandoff(code);') > src.indexOf("data.diagnosis_version === 'ETI-2.0'"), 'v2 の分岐のあと（旧版）');
});

// ---- 旧版のレポートから「マイページに引き継ぐ」→ 結果ページで購入を本人の記録へ結び付ける ----
const KEY = 'ed_legacy_handoff_v1';
async function handoffPage(handoff, { saved = true, stash = true } = {}) {
  const p = await prodPage({ signedIn: true, saved, handoff });
  const code = await legacyCode(p);
  if (stash) await p.evaluate(([k, c]) => localStorage.setItem(k, JSON.stringify({ code: c, token: 'signed.token', at: Date.now() })), [KEY, code]);
  await p.goto(`${HOST}/?code=${code}`);
  return { p, code };
}
const reply = (status, body) => (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('引き継ぎ：保存済みの記録でレポートから来た → 購入時のリンクを本人として送り、成功を表示。控えを消す', { skip: skip() }, async () => {
  const { p } = await handoffPage(reply(200, { ok: true, bound: 'applied' }));
  await p.waitForSelector('[data-legacy-handoff-box] .rs-done-head');
  assert.match(await p.locator('[data-legacy-handoff-box]').innerText(), /マイページに引き継ぎました/);
  assert.deepEqual(p.__calls.map((c) => [c.auth, c.body]), [['Bearer tok-user', { op: 'legacy_handoff', token: 'signed.token' }]]);
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), KEY), null);
  assert.equal(await p.locator('[data-buy-complete]').count(), 0);
  await p.__ctx.close();
});

test('引き継ぎ：ほかの人が先に引き継ぎ済み（409）／購入を確認できない（403）は、案内を出して控えを消す', { skip: skip() }, async () => {
  for (const [status, body, re] of [[409, { error: 'already_bound' }, /すでに別のアカウントに引き継がれています/], [403, { error: 'not_entitled' }, /購入を確認できませんでした/]]) {
    const { p } = await handoffPage(reply(status, body));
    await p.waitForSelector('[data-legacy-handoff-box] .rs-text:not(:has-text("引き継いでいます"))');
    assert.match(await p.locator('[data-legacy-handoff-box]').innerText(), re);
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), KEY), null);
    await p.__ctx.close();
  }
});

test('引き継ぎ：通信の失敗は控えを残して「もう一度試す」。押すと再び送る', { skip: skip() }, async () => {
  let n = 0;
  const { p } = await handoffPage((r) => (++n === 1 ? r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : r.fulfill({ contentType: 'application/json', body: '{"ok":true}' })));
  await p.waitForSelector('[data-legacy-handoff-retry]');
  assert.notEqual(await p.evaluate((k) => localStorage.getItem(k), KEY), null);
  await p.click('[data-legacy-handoff-retry]');
  await p.waitForSelector('[data-legacy-handoff-box] .rs-done-head');
  assert.equal(p.__calls.length, 2);
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), KEY), null);
  await p.__ctx.close();
});

test('引き継ぎ：控えが無い・別の診断コード・1時間を過ぎた控えでは、何も送らない', { skip: skip() }, async () => {
  for (const mode of ['none', 'other', 'old']) {
    const p = await prodPage({ signedIn: true, saved: true, handoff: reply(200, { ok: true }) });
    const code = await legacyCode(p);
    if (mode === 'other') await p.evaluate((k) => localStorage.setItem(k, JSON.stringify({ code: 'otherCode0000000000000000', token: 't', at: Date.now() })), KEY);
    if (mode === 'old') await p.evaluate(([k, c]) => localStorage.setItem(k, JSON.stringify({ code: c, token: 't', at: Date.now() - 2 * 3600 * 1000 })), [KEY, code]);
    await p.goto(`${HOST}/?code=${code}`);
    await p.waitForSelector('#recordCard');
    await p.waitForTimeout(500);
    assert.equal(p.__calls.length, 0, mode);
    assert.equal(await p.locator('[data-legacy-handoff-box]').count(), 0, mode);
    await p.__ctx.close();
  }
});

test('引き継ぎ：現在の診断（ETI v2）の結果ページでは、控えがあっても送らない', { skip: skip() }, async () => {
  const p = await prodPage({ signedIn: true, saved: true, handoff: reply(200, { ok: true }) });
  await p.goto(`${HOST}/`);
  const code = await p.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p.evaluate(([k, c]) => localStorage.setItem(k, JSON.stringify({ code: c, token: 't', at: Date.now() })), [KEY, code]);
  await p.goto(`${HOST}/?dv=ETI-2.0&code=${code}`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.waitForTimeout(500);
  assert.equal(p.__calls.length, 0);
  await p.__ctx.close();
});

test('レポートの「マイページに引き継ぐ」：購入時のリンクを控えてから、保存カードへ進む', { skip: skip() }, async () => {
  const p = await prodPage();
  const code = await legacyCode(p);
  await p.close();
  const q = await prodPage({ reportData: { diagnosis_version: 'element-v1', code, entitlements: { core_analysis_access: true } } });
  await q.goto(`${HOST}/report.html?token=abc.def`);
  const a = q.locator('[data-legacy-handoff]');
  await a.waitFor({ state: 'attached' });
  await a.click();
  await q.waitForURL((u) => u.pathname === '/' && u.hash === '#recordCard');
  const kept = JSON.parse(await q.evaluate((k) => localStorage.getItem(k), KEY));
  assert.equal(kept.code, code);
  assert.equal(kept.token, 'abc.def');
  await q.__ctx.close();
});
