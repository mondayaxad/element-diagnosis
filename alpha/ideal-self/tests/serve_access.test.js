// iPhone での本人テスト用の配信（scripts/serve.js）：既定は 127.0.0.1・同じ Wi-Fi はアクセスキー必須・キーの無い端末には何も配信しない
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, parseArgs, newAccessKey, cookieKey } from '../scripts/serve.js';
import net from 'node:net';

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


// 生の HTTP を送る（クライアント側の検証を通らない壊れた値も送れるように）
function raw(port, text) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(text));
    let buf = ''; sock.on('data', (d) => { buf += d; }); sock.on('end', () => resolve(buf)); sock.on('error', reject);
    sock.setTimeout(3000, () => { sock.destroy(); resolve(buf); });
  });
}
const status = (res) => Number((res.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]);

test('Cookie の読み取り：不正な形式はキーなしとして扱い、例外を出さない', () => {
  const r = (cookie) => cookieKey({ headers: { cookie } });
  assert.equal(r('isa_k=%E0%A4%A'), null);      // 壊れた %エンコード
  assert.equal(r('isa_k=%'), null);
  assert.equal(r('isa_k='), null);
  assert.equal(r(`isa_k=${'a'.repeat(300)}`), null); // 長すぎる
  assert.equal(r(undefined), null);
  assert.equal(r(['isa_k=%ZZ', 'x=1']), null);    // 配列で来ても
  assert.equal(r('other=1; isa_k=abc%2Ddef'), 'abc-def');
});

test('不正な Cookie・パスを受けてもサーバーは止まらず拒否し、その後も正規のアクセスが通る', async () => {
  const k = newAccessKey();
  await withServer({ accessKey: k }, async (port) => {
    const bad = [
      'isa_k=%E0%A4%A', 'isa_k=%', 'isa_k=', `isa_k=${'%'.repeat(400)}`, 'isa_k=%C0%AF; isa_k=%FF',
      `isa_k=${encodeURIComponent(k)}%`, '\u0000isa_k=x',
    ];
    for (const c of bad) {
      const res = await raw(port, `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: ${c.replace(/\u0000/g, '')}\r\nConnection: close\r\n\r\n`);
      assert.equal(status(res), 403, c.slice(0, 40));
    }
    // 壊れたパス（キーなし→403、キーあり→404）
    assert.equal(status(await raw(port, 'GET /%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')), 403);
    const first = await get(port, `/?k=${k}`);
    const c = first.headers['set-cookie'][0].split(';')[0];
    assert.equal(status(await raw(port, `GET /src/%E0%A4%A HTTP/1.1\r\nHost: x\r\nCookie: ${c}\r\nConnection: close\r\n\r\n`)), 404);
    assert.equal(status(await raw(port, `GET /?k=%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)), 403);
    // 拒否の後も、正規のアクセスは通る（サーバーは動き続けている）
    const ok = await get(port, '/', { cookie: c });
    assert.equal(ok.status, 200);
    assert.match(ok.body, /Ideal Self/);
    assert.equal((await get(port, '/src/app.js', { cookie: c })).status, 200);
  });
});
