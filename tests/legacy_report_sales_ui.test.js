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
const { previewPublicConfigJs } = require('./fixtures/server_env');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const HOST = 'https://element-diagnosis-five.vercel.app';
const LINK = 'https://buy.stripe.com/3cIcMXdCy5VbavmgsK3Nm08';

let browser;
test.before(async () => { if (chromium) browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); });
test.after(async () => { if (browser) await browser.close(); });

async function prodPage({ salesOpen = true, width = 390, reportData = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const hits = [];
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin === HOST) {
      if (u.pathname === '/api/public-config') return r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs(salesOpen ? { completeSalesOpen: true, completeApiReady: true } : { completeApiReady: true }) });
      if (u.pathname === '/api/report-data') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(reportData || {}) });
      if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      const rel = u.pathname === '/' || u.pathname === '/result' ? '/index.html' : decodeURIComponent(u.pathname);
      let f = path.join(ROOT, rel);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (u.origin === 'https://buy.stripe.com') { hits.push(r.request().url()); return r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }); }
    return r.fulfill({ contentType: 'application/javascript', body: '' });
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  p.__ctx = ctx; p.__hits = hits;
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
