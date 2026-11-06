// Preview 上の邪眼診断：未ログインでの動作（診断 → 結果 → 共有、保存・レポート API の認可）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const SHARE = process.argv[2];
const out = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(SHARE, { waitUntil: 'networkidle' });
out.title = await page.title();

// 診断：50問（5問ずつ）。回答は 1〜5 を巡回
await page.click('[data-start]');
for (let p = 0; p < 10; p++) {
  await page.waitForSelector('#quizRoot .qz-card');
  const cards = await page.$$('#quizRoot .qz-card');
  if (p === 0) out.firstPageItems = cards.length;
  let k = 0;
  for (let i = 0; i < cards.length; i++) { await page.locator('#quizRoot .qz-card').nth(i).locator('[data-v]').nth((p + k++) % 5).click(); await page.waitForTimeout(60); }
  if (p < 9) await page.waitForTimeout(500);
}
await page.click('#qResult');
await page.waitForSelector('#view-result:not([hidden])', { timeout: 15000 });
out.resultVisible = true;
out.resultHead = (await page.textContent('#resultBody')).replace(/\s+/g, ' ').slice(0, 160);
out.unlockButtonsDisabled = await page.evaluate(() => [...document.querySelectorAll('[data-buy]')].every((b) => b.disabled));
out.unlockButtonCount = await page.evaluate(() => document.querySelectorAll('[data-buy]').length);

// 共有
await page.click('#shareBtn');
await page.waitForSelector('#shareDialog[open]');
out.shareText = await page.textContent('#shareText');
out.shareHasOrigin = out.shareText.includes(BASE + '/jagan/share?');
await page.click('#shareClose');

// 保存（未ログイン）：登録・ログインを促す表示になるか
const saveBtn = await page.$('#saveBtn');
if (saveBtn) { await saveBtn.click(); await page.waitForTimeout(800); out.afterSaveClick = (await page.textContent('body')).replace(/\s+/g, ' ').match(/(ログイン|登録|メール|保存)[^。]{0,40}/)?.[0] ?? null; }

// API の認可（未ログイン）
const api = async (method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}, [method, path, body]);
out.saveNoAuth = await api('POST', '/api/jagan-save', { resultId: '00000000-0000-4000-8000-000000000000', answers: {}, itemSetVersion: 'x' });
out.reportNoAuth = await api('GET', '/api/jagan-report?resultId=00000000-0000-4000-8000-000000000000');
out.shareApiNoAuth = await api('POST', '/api/jagan-share', {});
out.pageErrors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
await browser.close();
