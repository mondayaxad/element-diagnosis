// 完全解析サンプルの「申し込みに戻る」の試験（Playwright）。外部へは接続しない。
//   ・申込欄から別のタブで開いた：タブを閉じて元のページ（申込欄）へ戻す
//   ・閉じられない（直接開いた）：解析レポートから → 購入完了ページ／診断結果から → この端末の最後の固有リンク（無ければトップ）
//   実行: node --test tests/sample_return_ui.test.js
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript' };
const TOKEN = 'SampleReturnTokenForTheLastResult_ABCDEFGHI'; // 43文字
let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const name = u.pathname === '/complete-sample' ? '/complete-sample.html' : u.pathname;
    const f = path.join(ROOT, decodeURIComponent(name));
    if (name === '/opener.html') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      return res.end('<a id="go" href="/complete-sample?from=result" target="_blank" rel="noopener">sample</a>');
    }
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      return res.end('<p>other</p>');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

test('申込欄から別のタブで開いたサンプル：「申し込みに戻る」でタブを閉じる（元のページの申込欄は残る）', { skip: skip() }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const opener = await ctx.newPage();
  await opener.goto(base + '/opener.html');
  const [popup] = await Promise.all([ctx.waitForEvent('page'), opener.click('#go')]);
  await popup.waitForLoadState();
  const errors = [];
  popup.on('pageerror', (e) => errors.push(String(e)));
  assert.equal(await popup.locator('[data-sample-return]').count(), 2, '上部と末尾');
  await popup.locator('.sample-cta [data-sample-return][data-ready="1"]').waitFor({ state: 'attached' });
  const closed = popup.waitForEvent('close', { timeout: 15000 });
  await popup.locator('.sample-cta [data-sample-return]').click();
  await closed;
  assert.equal(new URL(opener.url()).pathname, '/opener.html');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('直接開いた（閉じられない）：入口に合わせて移動する。秘密値はフラグメントだけ', { skip: skip() }, async () => {
  const cases = [
    ['/complete-sample?from=report', null, (u) => u.pathname === '/purchase-complete' && u.hash === ''],
    ['/complete-sample?from=result', TOKEN, (u) => u.pathname === '/result' && u.hash === '#r=' + TOKEN && u.search === ''],
    ['/complete-sample?from=result', null, (u) => u.pathname === '/' && u.hash === ''],
    ['/complete-sample', 'bad-token', (u) => u.pathname === '/' && u.hash === ''],
  ];
  for (const [url, token, ok] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (token) await ctx.addInitScript((t) => { try { localStorage.setItem('ed_last_result_v1', t); } catch (e) { /* なし */ } }, token);
    const p = await ctx.newPage();
    await p.goto(base + url);
    await p.locator('.sample-return-top [data-sample-return]').click();
    await p.waitForURL((u) => ok(u));
    await ctx.close();
  }
});

test('320・390・1280px：「申し込みに戻る」が横にはみ出さない・押せる大きさ（44px 以上）・動きを減らす設定でも動く', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(base + '/complete-sample?from=report');
    for (const sel of ['.sample-return-top [data-sample-return]', '.sample-cta [data-sample-return]']) {
      const b = await p.locator(sel).boundingBox();
      assert.ok(b.height >= 44, `${sel} ${width}`);
      assert.ok(b.x >= 0 && b.x + b.width <= width + 0.5, `${sel} ${width}`);
    }
    await p.locator('.sample-cta [data-sample-return]').click();
    await p.waitForURL((u) => u.pathname === '/purchase-complete');
    await ctx.close();
  }
});
