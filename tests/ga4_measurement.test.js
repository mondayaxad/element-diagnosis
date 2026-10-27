// GA4 の計測の取りこぼし対策（2026-10-27 の最終監査）
//   ・返金（refund）を Measurement Protocol で送る（Stripe Live・秘密値がある時だけ。purchase と同じ参照）
//   ・purchase に items、申込に GA4 標準の begin_checkout
//   ・完全解析のサンプル・タイプ別ページでも GA4 を読み込む
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GA = require('../lib/ga4-mp');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const REF = '0123456789abcdef0123';
const SECRET = 'abcDEF123_-xyz';

test('返金の送信は Stripe Live で、秘密値がある時だけ', () => {
  assert.equal(GA.enabled({ GA4_API_SECRET: SECRET }, true), true);
  assert.equal(GA.enabled({ GA4_API_SECRET: SECRET }, false), false, 'Test（Preview）では送らない');
  assert.equal(GA.enabled({}, true), false, '秘密値が無ければ送らない');
  assert.equal(GA.enabled({ GA4_API_SECRET: 'bad value with space' }, true), false);
});

test('返金の本文：refund・JPY・purchase と同じ参照だけ（注文 ID・Stripe の ID・メールを含めない）', () => {
  const body = GA.refundPayload(REF, 3000);
  assert.deepEqual(body.events, [{ name: 'refund', params: { transaction_id: REF, currency: 'JPY', value: 3000 } }]);
  assert.match(body.client_id, /^srv\.\d+\.\d+$/);
  assert.equal(GA.refundPayload(REF, 3000).client_id, body.client_id, '同じ取引は同じ client_id');
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /cs_|pi_|ch_|@|[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.equal(GA.refundPayload('not-a-ref', 3000), null);
  assert.equal(GA.refundPayload(REF, 0), null);
  assert.equal(GA.refundPayload(REF, null), null);
});

test('返金の送信：成功・拒否・通信の失敗のどれでも例外を出さない（決済の処理を止めない）', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return { status: 204 }; };
  const logger = { error() {}, warn() {}, log() {} };
  assert.equal(await GA.sendRefund({ env: { GA4_API_SECRET: SECRET }, fetchImpl: ok, livemode: true, transactionId: REF, value: 1000, logger }), 'sent');
  assert.match(calls[0].url, /^https:\/\/www\.google-analytics\.com\/mp\/collect\?measurement_id=G-FDN7NYZW9D&api_secret=/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).events[0].params.value, 1000);
  assert.equal(await GA.sendRefund({ env: { GA4_API_SECRET: SECRET }, fetchImpl: async () => ({ status: 400 }), livemode: true, transactionId: REF, value: 1000, logger }), 'rejected');
  assert.equal(await GA.sendRefund({ env: { GA4_API_SECRET: SECRET }, fetchImpl: async () => { throw new Error('net'); }, livemode: true, transactionId: REF, value: 1000, logger }), 'failed');
  assert.equal(await GA.sendRefund({ env: {}, fetchImpl: ok, livemode: true, transactionId: REF, value: 1000, logger }), 'disabled');
  assert.equal(calls.length, 1, '無効の時は送らない');
});

test('返金の送信は応答の後（waitUntil）で、秘密値が無い時は予約もしない', async () => {
  const pending = [];
  const waitUntil = (p) => pending.push(p);
  const args = { env: { GA4_API_SECRET: SECRET }, fetchImpl: async () => ({ status: 204 }), livemode: true, transactionId: REF, value: 1000, logger: { error() {} } };
  assert.equal(GA.scheduleRefund(waitUntil, args), true);
  assert.equal(await pending[0], 'sent');
  assert.equal(GA.scheduleRefund(waitUntil, { ...args, env: {} }), false);
  assert.equal(GA.scheduleRefund(null, args), false);
});

test('Webhook：返金を初めて反映した時（applied）だけ GA4 へ送る。参照は purchase と同じ refOf', () => {
  const src = read('api/stripe-webhook.js');
  assert.match(src, /require\('\.\.\/lib\/ga4-mp'\)/);
  const i = src.indexOf("async function onRefund");
  const body = src.slice(i, src.indexOf('async function onDispute'));
  assert.match(body, /if \(result === 'applied'\) \{\s*GA\.scheduleRefund\(waitUntil, \{ env, fetchImpl, livemode: CP\.livemodeOf\(conn\), transactionId: GP\.refOf\(env, found\.orderId\)/);
  // purchase の参照（lib/link-purchase.js）も同じ refOf
  assert.match(read('lib/link-purchase.js'), /transactionId: GP\.refOf\(env, found\.order\.id\)/);
});

test('purchase に items（商品 ID・商品名・価格・数量）', () => {
  const src = read('report-link.html');
  assert.match(src, /var item = \{ item_id: b\.product, item_name: NAMES\[b\.product\] \|\| b\.product, price: c\.value, quantity: 1 \};/);
  assert.match(src, /window\.gtag\('event', 'purchase', \{ transaction_id: c\.transactionId, value: c\.value, currency: 'JPY', product: b\.product, items: \[item\] \}\);/);
});

test('申込：checkout_start と同時に GA4 標準の begin_checkout（金額・JPY・入口・items）', async () => {
  const sent = [];
  const sandbox = { window: {}, console, setTimeout, clearTimeout };
  sandbox.window.gtag = (kind, name, params) => sent.push([name, params]);
  sandbox.window.__ED_PUBLIC_CONFIG__ = { completeSalesOpen: true };
  sandbox.window.crypto = require('crypto').webcrypto;
  sandbox.window.sessionStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  sandbox.window.location = { origin: 'https://element-diagnosis-five.vercel.app', pathname: '/', search: '', hash: '', assign() {} };
  sandbox.window.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'service_unavailable' }) });
  sandbox.window.document = { readyState: 'loading', addEventListener() {}, head: { appendChild() {} }, createElement() { return {}; }, getElementById() { return null; }, body: { style: {} } };
  vm.createContext(sandbox);
  vm.runInContext(read('js/report-purchase.js'), sandbox);
  const B = sandbox.window.EdBuy;
  assert.ok(B, 'EdBuy');
  await B.start({ context: 'x'.repeat(80), product: 'analysis', source: 'result' }).catch(() => null);
  const names = sent.map((s) => s[0]);
  assert.ok(names.length > 0, '申込の計測が送られる');
  {
    assert.ok(names.includes('checkout_start'));
    const bc = sent.find((s) => s[0] === 'begin_checkout');
    assert.ok(bc, 'begin_checkout');
    assert.equal(bc[1].currency, 'JPY'); assert.equal(bc[1].value, 1000); assert.equal(bc[1].source, 'result');
    assert.deepEqual(JSON.parse(JSON.stringify(bc[1].items)), [{ item_id: 'analysis', item_name: '解析レポート', price: 1000, quantity: 1 }]);
  }
});

test('GA4 の読み込み：完全解析のサンプルと、タイプ別ページ35件にも js/ga.js', () => {
  assert.match(read('complete-sample.html'), /<script src="\/js\/ga\.js"><\/script>/);
  const types = fs.readdirSync(path.join(__dirname, '..', 'type')).filter((f) => f.endsWith('.html'));
  assert.equal(types.length, 35);
  for (const f of types) assert.match(read(`type/${f}`), /<script src="\/js\/ga\.js"><\/script>/, f);
});

test('ga.js の消毒：items（商品 ID・商品名・価格・数量）は残し、記録 ID や URL は落とす', () => {
  const sandbox = { window: {}, document: { referrer: '' }, location: { hostname: 'localhost' } };
  vm.createContext(sandbox);
  vm.runInContext(read('js/ga.js'), sandbox);
  const clean = sandbox.window.__edGaClean;
  const out = clean({ transaction_id: REF, value: 1000, currency: 'JPY', items: [{ item_id: 'complete', item_name: '完全解析', price: 3000, quantity: 1 }], order_id: 'x', url: 'https://example.com' });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { transaction_id: REF, value: 1000, currency: 'JPY', items: [{ item_id: 'complete', item_name: '完全解析', price: 3000, quantity: 1 }] });
});
