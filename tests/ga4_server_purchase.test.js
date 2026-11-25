'use strict';
// GA4 の purchase をサーバー（Stripe の Webhook）から送る（lib/ga4-mp.js・api/stripe-webhook.js・api/public-config.js・ブラウザの切り替え）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const GA = require('../lib/ga4-mp');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const REF = '0123456789abcdef0123';
const SECRET = 'abcDEF_123-xyz';

test('purchase の本文：商品ごとの診断・product_id・既存の item_id。注文 ID・Stripe の ID・メールは含めない', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  for (const [pid, diag, itemId, value] of [['eti_analysis_v1', 'eti', 'analysis', 1000], ['eti_complete_v1', 'eti', 'complete', 3000],
    ['jagan_report_v1', 'jagan', 'jagan_report_v1', 1000], ['jagan_complete_v1', 'jagan', 'jagan_complete_v1', 3000]]) {
    const b = GA.purchasePayload({ transactionId: REF, value, productId: pid, paidAtMs: now - 60000, nowMs: now });
    assert.equal(b.client_id, GA.serverClientId(REF));
    assert.equal(b.timestamp_micros, (now - 60000) * 1000);
    const e = b.events[0];
    assert.equal(e.name, 'purchase');
    assert.deepEqual({ ...e.params, items: undefined }, { transaction_id: REF, currency: 'JPY', value, diagnosis_type: diag, product_id: pid, source: 'server_webhook', sent_by: 'server', items: undefined });
    assert.deepEqual(e.params.items.map((i) => [i.item_id, i.price, i.quantity]), [[itemId, value, 1]]);
  }
  // 同じ取引は同じ client_id（再送は GA4 が重複を除く）
  assert.equal(GA.purchasePayload({ transactionId: REF, value: 1000, productId: 'eti_analysis_v1' }).client_id, GA.serverClientId(REF));
  // 72時間より古い支払い・未知の商品・不正な値は送らない（過去分を補完しない）
  assert.equal(GA.purchasePayload({ transactionId: REF, value: 1000, productId: 'eti_analysis_v1', paidAtMs: now - 73 * 3600e3, nowMs: now }), null);
  for (const bad of [{ productId: 'constructor' }, { productId: 'core1' }, { transactionId: 'x' }, { value: 0 }, { value: '1000' }]) {
    assert.equal(GA.purchasePayload({ transactionId: REF, value: 1000, productId: 'eti_analysis_v1', ...bad }), null, JSON.stringify(bad));
  }
});

test('sendPurchase：本番（Live）で秘密値がある時だけ。失敗しても投げない', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { status: 204 }; };
  const args = { env: { GA4_API_SECRET: SECRET }, fetchImpl: ok, livemode: true, transactionId: REF, value: 1000, productId: 'jagan_report_v1', logger: { error() {} } };
  assert.equal(await GA.sendPurchase(args), 'sent');
  assert.match(calls[0][0], /^https:\/\/www\.google-analytics\.com\/mp\/collect\?measurement_id=G-FDN7NYZW9D&api_secret=/);
  assert.equal(calls[0][1].events[0].name, 'purchase');
  assert.equal(await GA.sendPurchase({ ...args, livemode: false }), 'disabled');
  assert.equal(await GA.sendPurchase({ ...args, env: {} }), 'disabled');
  assert.equal(await GA.sendPurchase({ ...args, fetchImpl: async () => { throw new Error('net'); } }), 'failed');
  assert.equal(await GA.sendPurchase({ ...args, fetchImpl: async () => ({ status: 400 }) }), 'rejected');
  // 返金にも商品を付けられる（付けなければ従来どおり）
  assert.deepEqual(GA.refundPayload(REF, 1000, 'jagan_report_v1').events[0].params, { transaction_id: REF, currency: 'JPY', value: 1000, diagnosis_type: 'jagan', product_id: 'jagan_report_v1' });
  assert.deepEqual(GA.refundPayload(REF, 1000).events[0].params, { transaction_id: REF, currency: 'JPY', value: 1000 });
});

test('Webhook：元素診断は支払い済みの注文だけ（applied・noop・duplicate）を、purchase と同じ参照で送る。邪眼は onApplied から送る', () => {
  const src = read('api/stripe-webhook.js');
  assert.match(src, /if \(result === 'applied' \|\| result === 'noop' \|\| result === 'duplicate'\) await etiPurchaseGa4\(conn, found\.orderId, found\.session\.client_reference_id\);/);
  assert.match(src, /o\.status !== 'paid'/);
  assert.match(src, /transactionId: GP\.refOf\(env, orderId\)/, '元素診断の purchase（固有リンクの conversion）と同じ参照');
  assert.match(src, /onApplied: \(a\) => jaganGa4\(conn, JP, a\)/);
  assert.match(src, /JP\.ga4TransactionId\(env, o\.idempotency_key\)/);
  assert.match(src, /analysis: 'eti_analysis_v1', direct_complete: 'eti_complete_v1', analysis_upgrade: 'eti_complete_v1'/);
});

test('ブラウザ：サーバー送信中（ga4ServerPurchase）は purchase を送らず purchase_client だけ（同じ購入を二重に数えない）', () => {
  const link = read('report-link.html');
  assert.match(link, /ga4ServerPurchase === true/);
  assert.match(link, /if \(serverSends\) \{ window\.gtag\('event', 'purchase_client'/);
  const dti = read('jagan/client.mjs');
  assert.match(dti, /ga4ServerPurchase === true/);
  assert.match(dti, /if \(serverSends\) \{\n\s+window\.gtag\('event', 'purchase_client'/);
});

test('public-config：ga4ServerPurchase は本番で GA4_API_SECRET が正しい形の時だけ true（値そのものは返さない）', () => {
  const src = read('api/public-config.js');
  assert.match(src, /ga4ServerPurchase: sb\.appEnv === 'production' && typeof env\.GA4_API_SECRET === 'string' && \/\^\[A-Za-z0-9_-\]\{8,100\}\$\/\.test\(env\.GA4_API_SECRET\)/);
});

// ---- 振る舞いの試験：本番（Live）の Webhook が、支払い済みの注文で GA4 の purchase を1回送る（偽の Stripe・偽の DB・GA4 へは送らない）
const crypto = require('node:crypto');
const { PROD_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const CA = require('../lib/complete-apply');
const GP = require('../lib/guest-purchase');
const PROD_HOST = 'element-diagnosis-five.vercel.app';
const WH = 'whsec_live_fake_secret_for_ga4_tests';
const VIEW = crypto.randomBytes(32).toString('base64url');
const LIVE_ENV = { ...PROD_ENV, STRIPE_COMPLETE_WEBHOOK_SECRET: WH, COMPLETE_VIEW_TOKEN_SECRET: VIEW, GA4_API_SECRET: SECRET, JAGAN_PRODUCTION_ENABLED: 'true' };

async function runWebhook({ app, rows, rpcResult, env = LIVE_ENV }) {
  const stripe = fakeStripe({ livemode: true });
  const orderId = crypto.randomUUID();
  const s = await stripe.client.checkout.sessions.create({ mode: 'payment', line_items: [{ price_data: { currency: 'jpy', unit_amount: rows[0].amount }, quantity: 1 }],
    metadata: { order_id: orderId, app, env: 'production' } });
  stripe.pay(s.id);
  const mp = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === 'www.google-analytics.com') { mp.push(JSON.parse(init.body)); return { ok: true, status: 204, json: async () => ({}) }; }
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (/\/rest\/v1\/rpc\//.test(u.pathname)) return json(rpcResult);
    if (/\/rest\/v1\/(complete_orders|jagan_orders)$/.test(u.pathname)) return json(rows.map((r) => ({ ...r, id: orderId })));
    return json([]);
  };
  const pending = [];
  const Webhook = require('../api/stripe-webhook.js');
  const wh = Webhook.createHandler({ env, fetchImpl, stripeFactory: stripe.factory, logger: { error() {} }, waitUntil: (p) => pending.push(p) });
  const { req } = eventRequest({ type: 'checkout.session.completed', objectId: s.id, secret: WH, livemode: true });
  req.headers.host = PROD_HOST;
  const out = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  await wh(req, out);
  await Promise.all(pending);
  return { out, mp, orderId };
}

test('振る舞い（元素診断）：支払いの反映（applied・noop）で purchase を1回、固有リンクの conversion と同じ transaction_id で送る。返金済み・未払いは送らない', async () => {
  const orig = CA.applyPaidSession;
  try {
    for (const result of ['applied', 'noop', 'duplicate']) {
      CA.applyPaidSession = async () => result;
      const paidAt = new Date(Date.now() - 60000).toISOString();
      const { out, mp, orderId } = await runWebhook({ app: 'element-diagnosis-complete', rows: [{ offer: 'direct_complete', amount: 3000, status: 'paid', paid_at: paidAt }] });
      assert.equal(out.code, 200, result);
      assert.equal(mp.length, 1, result);
      const p = mp[0].events[0].params;
      assert.equal(p.transaction_id, GP.refOf(LIVE_ENV, orderId), 'report-link の conversion と同じ参照');
      assert.deepEqual([p.diagnosis_type, p.product_id, p.value, p.items[0].item_id], ['eti', 'eti_complete_v1', 3000, 'complete']);
      assert.ok(!JSON.stringify(mp).includes(orderId), '注文 ID を送らない');
    }
    CA.applyPaidSession = async () => 'applied';
    assert.equal((await runWebhook({ app: 'element-diagnosis-complete', rows: [{ offer: 'analysis', amount: 1000, status: 'refunded', paid_at: new Date().toISOString() }] })).mp.length, 0, '返金済みは送らない');
    CA.applyPaidSession = async () => 'ignored:amount_mismatch';
    assert.equal((await runWebhook({ app: 'element-diagnosis-complete', rows: [{ offer: 'analysis', amount: 1000, status: 'paid', paid_at: new Date().toISOString() }] })).mp.length, 0, '反映されなかった支払いは送らない');
    CA.applyPaidSession = async () => 'applied';
    const noSecret = { ...LIVE_ENV }; delete noSecret.GA4_API_SECRET;
    assert.equal((await runWebhook({ app: 'element-diagnosis-complete', rows: [{ offer: 'analysis', amount: 1000, status: 'paid', paid_at: new Date().toISOString() }], env: noSecret })).mp.length, 0, '秘密値が無ければ送らない');
  } finally { CA.applyPaidSession = orig; }
});

test('振る舞い（邪眼）：支払いの反映で purchase を1回、ブラウザと同じ transaction_id（固有リンクの秘密値から）で送る', async () => {
  const JP = await import('../lib/jagan-purchase.mjs');
  const idem = 'idem-' + crypto.randomBytes(8).toString('hex');
  const rows = [{ product_key: 'jagan_report_v1', amount: 1000, status: 'paid', paid_at: new Date(Date.now() - 60000).toISOString(), idempotency_key: idem }];
  const { out, mp } = await runWebhook({ app: JP.APP, rows, rpcResult: 'applied' });
  assert.equal(out.code, 200);
  assert.equal(mp.length, 1);
  const p = mp[0].events[0].params;
  const token = JP.linkSecretOf(JP.linkKey(LIVE_ENV), idem);
  assert.equal(p.transaction_id, crypto.createHash('sha256').update(`jagan-ga4|${token}`).digest('hex').slice(0, 20));
  assert.deepEqual([p.diagnosis_type, p.product_id, p.value, p.items[0].item_id], ['jagan', 'jagan_report_v1', 1000, 'jagan_report_v1']);
  // 反映されなかった（ignored）支払いは送らない
  assert.equal((await runWebhook({ app: JP.APP, rows, rpcResult: 'ignored:amount_mismatch' })).mp.length, 0);
});


// ---- 申込の時点の GA4 の参照（client_reference_id）：購入を、同じ利用者・セッション・申込元に結ぶ ----
const GR = require('../lib/ga-ref');
test('GA4 の参照：形を確かめ、client_id・session_id・内部の印・申込元に分ける。違う形は使わない', () => {
  assert.deepEqual(GR.parse('ga1-123456789-1700000000-1731700000-0-result'), { clientId: '123456789.1700000000', sessionId: 1731700000, internal: false, source: 'result' });
  assert.deepEqual(GR.parse('ga1-1-2--1-'), { clientId: '1.2', sessionId: null, internal: true, source: null });
  for (const bad of ['', 'ga1-a-2-3-0-x', 'ga2-1-2-3-0-x', 'ga1-1-2-3-2-x', 'ga1-1-2-3-0-Result', 'ga1-1-2-3-0-x;drop', 'cs_live_123', null, 5]) assert.equal(GR.valid(bad), false, String(bad));
});
test('purchase の本文：参照があれば、その利用者・セッション・申込元・内部の印で送る', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const b = GA.purchasePayload({ transactionId: REF, value: 1000, productId: 'jagan_report_v1', paidAtMs: now - 1000, nowMs: now, gaRef: 'ga1-111-222-1731700000-1-mypage_latest' });
  assert.equal(b.client_id, '111.222');
  const p = b.events[0].params;
  assert.equal(p.session_id, 1731700000); assert.equal(p.engagement_time_msec, 1);
  assert.equal(p.source, 'mypage_latest'); assert.equal(p.traffic_type, 'internal'); assert.equal(p.sent_by, 'server');
  // 参照が無い・壊れている時は合成の利用者
  assert.equal(GA.purchasePayload({ transactionId: REF, value: 1000, productId: 'jagan_report_v1', gaRef: 'x' }).client_id, GA.serverClientId(REF));
});
test('振る舞い：Webhook は Stripe の client_reference_id から参照を読み、その利用者で purchase を送る（元素診断・邪眼）', async () => {
  const orig = CA.applyPaidSession;
  try {
    CA.applyPaidSession = async () => 'applied';
    const ref = 'ga1-555-666-1731700001-0-result';
    // runWebhook は create の metadata だけを渡すため、ここでは client_reference_id 付きで直接作る
    const run = async (app, rows, rpcResult) => {
      const stripe = fakeStripe({ livemode: true });
      const orderId = crypto.randomUUID();
      const s = await stripe.client.checkout.sessions.create({ mode: 'payment', line_items: [{ price_data: { currency: 'jpy', unit_amount: rows[0].amount }, quantity: 1 }], metadata: { order_id: orderId, app, env: 'production' } });
      stripe.st.sessions[s.id].client_reference_id = ref;
      stripe.pay(s.id);
      const mp = [];
      const fetchImpl = async (url, init = {}) => {
        const u = new URL(url);
        if (u.host === 'www.google-analytics.com') { mp.push(JSON.parse(init.body)); return { ok: true, status: 204, json: async () => ({}) }; }
        const json = (b2) => ({ ok: true, status: 200, json: async () => b2, text: async () => JSON.stringify(b2) });
        if (/\/rest\/v1\/rpc\//.test(u.pathname)) return json(rpcResult);
        if (/\/rest\/v1\/(complete_orders|jagan_orders)$/.test(u.pathname)) return json(rows.map((r) => ({ ...r, id: orderId })));
        return json([]);
      };
      const pending = [];
      const wh = require('../api/stripe-webhook.js').createHandler({ env: LIVE_ENV, fetchImpl, stripeFactory: stripe.factory, logger: { error() {} }, waitUntil: (p) => pending.push(p) });
      const { req } = eventRequest({ type: 'checkout.session.completed', objectId: s.id, secret: WH, livemode: true });
      req.headers.host = PROD_HOST;
      const out = { code: 0, status(c) { this.code = c; return this; }, json() { return this; }, setHeader() {} };
      await wh(req, out); await Promise.all(pending);
      return mp;
    };
    const eti = await run('element-diagnosis-complete', [{ offer: 'analysis', amount: 1000, status: 'paid', paid_at: new Date(Date.now() - 1000).toISOString() }]);
    assert.equal(eti.length, 1); assert.equal(eti[0].client_id, '555.666'); assert.equal(eti[0].events[0].params.session_id, 1731700001);
    const JP = await import('../lib/jagan-purchase.mjs');
    const dti = await run(JP.APP, [{ product_key: 'jagan_complete_v1', amount: 3000, status: 'paid', paid_at: new Date(Date.now() - 1000).toISOString(), idempotency_key: 'idem-x' }], 'applied');
    assert.equal(dti.length, 1); assert.equal(dti[0].client_id, '555.666'); assert.equal(dti[0].events[0].params.source, 'result');
  } finally { CA.applyPaidSession = orig; }
});
test('ブラウザ：申込の本文に GA4 の参照を付ける（元素診断・邪眼・マイページ）。決済・ログインの戻りは流入元にしない', () => {
  assert.match(read('js/report-purchase.js'), /checkoutRef\(o\.source\)[\s\S]{0,40}if \(gaRef\) body\.ga = gaRef;/);
  assert.match(read('jagan/client.mjs'), /checkoutRef\(source\)[\s\S]{0,40}if \(gaRef\) body\.ga = gaRef;/);
  assert.match(read('js/jagan-mypage.js'), /checkoutRef\(body\.source\)[\s\S]{0,40}if \(gaRef\) body\.ga = gaRef;/);
  assert.match(read('lib/link-purchase.js'), /\.\.\.\(gaRef \? \{ client_reference_id: gaRef \} : \{\}\)/);
  assert.match(read('lib/jagan-purchase.mjs'), /\.\.\.\(gaRef \? \{ client_reference_id: gaRef \} : \{\}\)/);
});
