// トップ右上の「マイページ」導線（2026-10-27 追加）の画面テスト（Playwright）。外部への通信はすべて止める。
//   実行: node --test tests/top_mypage_link.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pipeFile } = require('./fixtures/serve_file');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const skip = () => !chromium;
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let server, base, browser;

test.before(async () => {
  if (skip()) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

test('トップ右上：読み込み時から「マイページ」。/mypage.html・既存の mypage_entry_click（1回だけ）・44px 以上・診断をはじめるより控えめ・横スクロールなし', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const p = await ctx.newPage();
    await p.route('**/*', (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await p.addInitScript(() => { window.__ev = []; window.gtag = (...a) => { if (a[0] === 'event') window.__ev.push(a[1]); }; });
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const a = p.locator('#top .hero-mypage');
    assert.equal(await a.count(), 1);
    assert.equal(await a.isVisible(), true, '読み込み時から見える ' + width);
    assert.equal(await a.getAttribute('href'), '/mypage.html');
    assert.match(await a.innerText(), /マイページ/);
    const got = await p.evaluate(() => {
      const el = document.querySelector('#top .hero-mypage');
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { w: r.width, h: r.height, right: r.right, top: r.top, pos: cs.position, bg: cs.backgroundColor, border: cs.borderTopWidth,
        vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
    });
    assert.ok(got.w >= 44 && got.h >= 44, '押せる範囲 44px 以上 ' + JSON.stringify(got));
    assert.notEqual(got.pos, 'fixed', '固定しない（ヘッダーの位置）');
    assert.ok(got.right <= got.vw && got.top >= 0, '画面内の右上 ' + JSON.stringify(got));
    assert.equal(got.bg, 'rgba(0, 0, 0, 0)', '箱・ピルなし');
    assert.equal(got.border, '0px');
    assert.ok(got.sw <= got.vw, '横スクロールなし ' + width);
    // 計測：既存のイベントを1回だけ（遷移は止めて数える）
    await p.evaluate(() => document.querySelector('#top .hero-mypage').addEventListener('click', (e) => e.preventDefault()));
    await a.click();
    const ev = await p.evaluate(() => window.__ev);
    assert.deepEqual(ev.filter((e) => /mypage/.test(e)), ['mypage_entry_click']);
    await ctx.close();
  }
});
