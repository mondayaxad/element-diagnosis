// iPhone での本人テスト用の配信（scripts/serve.js）：既定は 127.0.0.1・同じ Wi-Fi はアクセスキー必須・キーの無い端末には何も配信しない
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, parseArgs, newAccessKey } from '../scripts/serve.js';

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}
async function withServer(opts, fn) {
  const srv = createServer(opts);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { await fn(srv.address().port); } finally { srv.close(); }
}

test('起動オプション：既定は 127.0.0.1・キーなし。--lan は 0.0.0.0 で、キーが必ず有効', () => {
  assert.deepEqual({ ...parseArgs([]), accessKey: null }, { port: 4173, host: '127.0.0.1', lan: false, accessKey: null });
  assert.equal(parseArgs([]).accessKey, null);
  const lan = parseArgs(['5000', '--lan']);
  assert.equal(lan.host, '0.0.0.0');
  assert.equal(lan.port, 5000);
  assert.match(lan.accessKey, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(parseArgs(['--lan']).accessKey, parseArgs(['--lan']).accessKey); // 起動のたびに変わる
  const key = parseArgs(['--key']);
  assert.equal(key.host, '127.0.0.1');
  assert.ok(key.accessKey);
});

test('キーなし（既定）：画面のファイルだけを配信し、それ以外は 404', async () => {
  await withServer({}, async (port) => {
    assert.equal((await get(port, '/')).status, 200);
    assert.equal((await get(port, '/src/app.js')).status, 200);
    assert.equal((await get(port, '/assets/avatar-placeholder.svg')).status, 200);
    for (const p of ['/package.json', '/tests/helpers.js', '/scripts/serve.js', '/docs/PHASE3_REPORT.md', '/%2e%2e/%2e%2e/package.json']) assert.equal((await get(port, p)).status, 404, p);
    // 「..」は URL として正規化され、α の中から出られない（リポジトリ直下の index.html ではなく α の画面）
    for (const p of ['/../../index.html', '/%2e%2e/%2e%2e/index.html']) {
      const up = await get(port, p);
      assert.match(up.body, /Ideal Self/, p);
      assert.doesNotMatch(up.body, /元素診断/, p);
    }
  });
});

test('キーあり：キーの無い・違う端末には何も配信しない。正しいキーで Cookie を置き、キーを URL から消す', async () => {
  const k = newAccessKey();
  await withServer({ accessKey: k }, async (port) => {
    for (const p of ['/', '/index.html', '/src/app.js', '/fixtures/synthetic_eti.js']) {
      const r = await get(port, p);
      assert.equal(r.status, 403, p);
      assert.doesNotMatch(r.body, /Ideal Self|import /);
    }
    assert.equal((await get(port, `/?k=${k}x`)).status, 403);
    assert.equal((await get(port, '/', { cookie: `isa_k=${k.slice(1)}` })).status, 403);
    const first = await get(port, `/?k=${k}`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, '/');
    const cookie = first.headers['set-cookie'][0];
    assert.match(cookie, /^isa_k=[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    assert.ok(!first.headers.location.includes(k));
    const c = cookie.split(';')[0];
    const page = await get(port, '/', { cookie: c });
    assert.equal(page.status, 200);
    assert.match(page.body, /Ideal Self/);
    assert.equal((await get(port, '/src/app.js', { cookie: c })).status, 200);
    assert.equal((await get(port, '/package.json', { cookie: c })).status, 404);
    // HTTPS 経由（Tailscale の serve など）では Secure を付ける
    const viaHttps = await get(port, `/?k=${k}`, { 'x-forwarded-proto': 'https' });
    assert.match(viaHttps.headers['set-cookie'][0], /; Secure$/);
  });
});

test('配信の応答ヘッダー：検索避け・参照元を送らない・埋め込み不可・キャッシュしない', async () => {
  await withServer({}, async (port) => {
    const r = await get(port, '/');
    assert.equal(r.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
  });
});

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { /* skip */ }

test('ブラウザ（スマホ幅）：キー付き URL で開くと Cookie が置かれ、画面とモジュールが読み込まれる。キー無しの別の端末は 403', { skip: !chromium && 'Playwright が無い' }, async () => {
  const k = newAccessKey();
  await withServer({ accessKey: k }, async (port) => {
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(`http://127.0.0.1:${port}/?k=${k}`);
      assert.equal(new URL(page.url()).search, ''); // キーは URL に残らない
      await page.waitForSelector('[data-testid="consent-next"]');
      assert.deepEqual(errors, []);
      // 再読み込みしても Cookie で開ける
      await page.reload();
      await page.waitForSelector('[data-testid="consent-next"]');
      // 別の端末（Cookie の無い新しいコンテキスト）は開けない
      const other = await (await browser.newContext()).newPage();
      const r = await other.goto(`http://127.0.0.1:${port}/`);
      assert.equal(r.status(), 403);
    } finally { await browser.close(); }
  });
});
