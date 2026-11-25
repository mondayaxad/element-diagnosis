// タイプ別レポートの購入 API（lib/type-report-purchase.mjs）・Webhook（api/stripe-webhook.js の分岐）・閲覧（api/report-data.js の type_report）。
//   DB はメモリ上の模型（関数の振る舞いは tests/pg/type_report_01.pg.test.js が実 PG で確かめる）、Stripe は偽物（tests/fixtures/fake_stripe.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createPurchaseHandler, sha256hex, salesOpen, standardOf, APP, PRODUCT_KEY } from '../lib/type-report-purchase.mjs';

const require = createRequire(import.meta.url);
const { PREVIEW_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const Webhook = require('../api/stripe-webhook.js');
const ReportData = require('../api/report-data.js');
const STD = JSON.parse(fs.readFileSync(new URL('../lib/type-standard-answers.json', import.meta.url), 'utf8'));

const ORIGIN = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const HOST = new URL(ORIGIN).host;
const WH = 'whsec_test_fake_secret_for_type_report_tests';
const ENV = { ...PREVIEW_ENV, TYPE_REPORT_SALES_OPEN: 'true', COMPLETE_CHECKOUT_ORIGIN: ORIGIN, COMPLETE_VIEW_TOKEN_SECRET: crypto.randomBytes(32).toString('base64url'), STRIPE_COMPLETE_WEBHOOK_SECRET: WH };
const attempt = () => crypto.randomBytes(18).toString('base64url');
const uuid = () => crypto.randomUUID();

// ---- メモリ上の DB（PostgREST の select と、type_report_01 の関数の振る舞い）
function fakeDb() {
  const t = { type_report_orders: [] };
  const rpc = {
    type_report_create_order(a) {
      const v = t.type_report_orders.find((o) => o.idempotency_key === a.p_idempotency_key);
      if (v) {
        if (v.type_code !== a.p_type_code) throw { message: 'type_report_idempotency_conflict' };
        return [{ order_id: v.id, order_status: v.status, created: false, checkout_session_id: v.stripe_checkout_session_id }];
      }
      const o = { id: uuid(), type_code: a.p_type_code, item_set_version: a.p_item_set_version, diagnosis_code: a.p_diagnosis_code, product_key: 'eti_type_report_v1',
        amount: 1000, currency: 'jpy', stripe_mode: a.p_stripe_mode, status: 'created', idempotency_key: a.p_idempotency_key, link_token_hash: a.p_link_token_hash,
        link_status: 'active', stripe_checkout_session_id: null, stripe_payment_intent_id: null, created_at: new Date().toISOString(), paid_at: null };
      t.type_report_orders.push(o);
      return [{ order_id: o.id, order_status: 'created', created: true, checkout_session_id: null }];
    },
    type_report_mark_checkout_open(a) {
      const o = t.type_report_orders.find((x) => x.id === a.p_order_id);
      if (o.status === 'created') { o.status = 'checkout_open'; o.stripe_checkout_session_id = a.p_checkout_session_id; return 'opened'; }
      if (o.status === 'checkout_open' && o.stripe_checkout_session_id === a.p_checkout_session_id) return 'noop';
      throw { message: 'type_report_order_not_open' };
    },
    type_report_apply_payment(a) {
      const o = t.type_report_orders.find((x) => x.id === a.p_order_id);
      if (!o) return 'ignored:order_not_found';
      if (a.p_payment_status !== 'paid') return 'ignored:payment_not_paid';
      if (a.p_amount_total !== o.amount) { o.status = 'failed'; return 'ignored:amount_mismatch'; }
      if (['paid', 'refunded', 'disputed'].includes(o.status)) return 'noop';
      Object.assign(o, { status: 'paid', paid_at: new Date().toISOString(), stripe_checkout_session_id: a.p_checkout_session_id, stripe_payment_intent_id: a.p_payment_intent_id });
      return 'applied';
    },
    type_report_close_order(a) { const o = t.type_report_orders.find((x) => x.id === a.p_order_id); if (['created', 'checkout_open'].includes(o.status)) { o.status = a.p_status; return 'closed'; } return 'noop'; },
    type_report_apply_reversal(a) {
      const o = t.type_report_orders.find((x) => x.id === a.p_order_id);
      const next = a.p_kind === 'refunded' ? 'refunded' : a.p_kind === 'disputed' ? (o.status === 'refunded' ? 'refunded' : 'disputed') : (o.status === 'disputed' ? 'paid' : o.status);
      if (next === o.status) return 'noop';
      o.status = next;
      return 'applied';
    },
  };
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      if (!rpc[m[1]]) return json(404, { message: 'not found' });
      try { return json(200, rpc[m[1]](JSON.parse(init.body))); } catch (e) { return json(400, { message: e.message || String(e) }); }
    }
    const tm = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (tm) {
      let list = t[tm[1]] || [];
      for (const [k, v] of u.searchParams) {
        if (k === 'select' || k === 'limit') continue;
        const [op, ...rest] = v.split('.');
        const val = rest.join('.');
        list = list.filter((r) => (op === 'eq' ? String(r[k]) === val : op === 'gt' ? String(r[k]) > val : true));
      }
      return json(200, JSON.parse(JSON.stringify(list)));
    }
    return json(404, {});
  }
  return { t, fetchImpl };
}

function req(op, body, { origin = ORIGIN, contentType = 'application/json' } = {}) {
  return { method: 'POST', url: `/api/type-report?op=${op}`, headers: { host: HOST, 'content-type': contentType, origin }, body: JSON.stringify(body) };
}
function res() {
  return { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; return this; } };
}
function setup(env = ENV, stripeOpts) {
  const db = fakeDb();
  const stripe = fakeStripe(stripeOpts);
  const h = createPurchaseHandler({ env, fetchImpl: db.fetchImpl, stripeFactory: stripe.factory, logger: { error() {} } });
  const call = async (op, body, opts) => { const r = res(); await h(req(op, body, opts), r, op); return { status: r.statusCode, body: r.body }; };
  return { db, stripe, call };
}
const secretOf = (stripe) => new URL(stripe.st.lastCreate.params.success_url).hash.replace('#t=', '');

test('標準の回答：35タイプ。タイプコード以外（形の違う値・存在しない組み合わせ）は受け付けない', () => {
  assert.equal(Object.keys(STD.types).length, 35);
  assert.equal(standardOf('PYSW').diagnosisCode, STD.types.PYSW.diagnosis_code);
  assert.equal(standardOf('PYSW').name, '殉愛者');
  for (const bad of ['pysw', 'XXSW', 'PYXX', '', null, 'PYSW ']) assert.equal(standardOf(bad), null, String(bad));
});

test('販売：TYPE_REPORT_SALES_OPEN=true のときだけ（Preview・本番とも）', async () => {
  assert.equal(salesOpen({ TYPE_REPORT_SALES_OPEN: 'true' }, 'preview'), true);
  assert.equal(salesOpen({ TYPE_REPORT_SALES_OPEN: 'true' }, 'production'), true);
  assert.equal(salesOpen({}, 'preview'), false);
  assert.equal(salesOpen({}, 'production'), false);
  const { call } = setup({ ...ENV, TYPE_REPORT_SALES_OPEN: 'false' });
  assert.deepEqual((await call('buy', { type: 'PYSW', attempt: attempt() })).body, { error: 'sales_closed' });
});

test('購入：金額・商品はサーバーが決め、注文に標準の回答の符号を固定。戻り先は固有リンク。同じ購入操作の再送は同じ決済画面', async () => {
  const { db, stripe, call } = setup();
  const body = { type: 'CRSW', attempt: attempt(), source: 'type_page' };
  const r1 = await call('buy', body);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.match(r1.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(r1.body.amount, 1000);
  const p = stripe.st.lastCreate.params;
  assert.deepEqual(p.line_items, [{ price_data: { currency: 'jpy', unit_amount: 1000, product_data: { name: 'タイプ別レポート' } }, quantity: 1 }]);
  const o = db.t.type_report_orders[0];
  assert.deepEqual(p.metadata, { order_id: o.id, app: APP, env: 'preview' });
  assert.match(p.success_url, new RegExp(`^${ORIGIN}/type-report#t=[A-Za-z0-9_-]{43}$`));
  assert.equal(p.cancel_url, `${ORIGIN}/type/crsw?checkout=canceled`);
  assert.match(p.custom_text.submit.message, /タイプ別レポート「宿縁者」（1,000円・税込）/);
  assert.match(p.custom_text.submit.message, /解析レポート」とは別の商品/);
  assert.equal(o.type_code, 'CRSW');
  assert.equal(o.diagnosis_code, STD.types.CRSW.diagnosis_code, '注文に標準の回答の符号を固定');
  assert.equal(o.link_token_hash, sha256hex(secretOf(stripe)), 'DB には秘密値のハッシュだけ');
  assert.equal(o.status, 'checkout_open');
  assert.ok(!JSON.stringify(r1.body).includes(o.id) && !JSON.stringify(r1.body).includes(secretOf(stripe)), '応答に注文 ID・秘密値を出さない');
  const r2 = await call('buy', body);
  assert.equal(r2.body.checkoutUrl, r1.body.checkoutUrl);
  assert.equal(db.t.type_report_orders.length, 1);
  assert.equal(stripe.st.calls.filter((c) => c === 'checkout.sessions.create').length, 1);
});

test('価格：STRIPE_PRICE_TYPE_REPORT があれば Stripe の Price を照合して使う。金額が違えば売らない。本番は Price が必須', async () => {
  const PRICE = 'price_typereport_test_0001';
  const ok = setup({ ...ENV, STRIPE_PRICE_TYPE_REPORT: PRICE }, { prices: { [PRICE]: { id: PRICE, active: true, livemode: false, currency: 'jpy', unit_amount: 1000, type: 'one_time' } } });
  assert.equal((await ok.call('buy', { type: 'PYSW', attempt: attempt() })).status, 200);
  assert.deepEqual(ok.stripe.st.lastCreate.params.line_items, [{ price: PRICE, quantity: 1 }]);
  const bad = setup({ ...ENV, STRIPE_PRICE_TYPE_REPORT: PRICE }, { prices: { [PRICE]: { id: PRICE, active: true, livemode: false, currency: 'jpy', unit_amount: 3000, type: 'one_time' } } });
  const r = await bad.call('buy', { type: 'PYSW', attempt: attempt() });
  assert.equal(r.status, 503);
  assert.equal(bad.db.t.type_report_orders.length, 0, '注文を作らない');
});

test('購入の入力：タイプ以外・余分な項目（金額・商品・符号）・短い ID・別サイトからの送信・JSON 以外は断る', async () => {
  const { db, call } = setup();
  assert.equal((await call('buy', { type: 'XXSW', attempt: attempt() })).status, 400);
  assert.equal((await call('buy', { type: 'PYSW', attempt: attempt(), amount: 1 })).status, 400);
  assert.equal((await call('buy', { type: 'PYSW', attempt: attempt(), code: 'x' })).status, 400);
  assert.equal((await call('buy', { type: 'PYSW', attempt: 'short' })).status, 400);
  assert.equal((await call('buy', { type: 'PYSW', attempt: attempt() }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('buy', { type: 'PYSW', attempt: attempt() }, { contentType: 'text/plain' })).status, 403);
  assert.equal((await call('nope', {})).status, 404);
  assert.equal(db.t.type_report_orders.length, 0);
});

test('固有リンク：支払い前は pending。支払うと（Webhook が無くても）Stripe に確かめて反映し、15 分の閲覧リンクを返す。閲覧 API はタイプ別レポートとして符号を返す', async () => {
  const { db, stripe, call } = setup();
  await call('buy', { type: 'PYSW', attempt: attempt() });
  const token = secretOf(stripe);
  assert.deepEqual((await call('link-open', { token })).body, { ok: true, state: 'pending' });
  stripe.pay(db.t.type_report_orders[0].stripe_checkout_session_id);
  const r = await call('link-open', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'paid');
  assert.equal(r.body.type, 'PYSW');
  assert.equal(r.body.typeName, '殉愛者');
  assert.match(r.body.reportUrl, /^\/report\.html\?token=/);
  assert.ok(!JSON.stringify(r.body).includes(STD.types.PYSW.diagnosis_code), '応答に符号を平文で出さない');
  // 閲覧 API（report.html が呼ぶ）
  const rt = decodeURIComponent(r.body.reportUrl.split('token=')[1]);
  const rd = ReportData.createHandler({ env: ENV, fetchImpl: db.fetchImpl });
  const view = async (tok) => {
    const out = { code: 0, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await rd({ method: 'GET', url: `/api/report-data?token=${encodeURIComponent(tok)}`, query: { token: tok }, headers: { host: HOST } }, out);
    return out;
  };
  const v = await view(rt);
  assert.equal(v.code, 200, JSON.stringify(v.body));
  assert.equal(v.body.report_kind, 'type');
  assert.equal(v.body.type_code, 'PYSW');
  assert.equal(v.body.code, STD.types.PYSW.diagnosis_code);
  assert.equal(v.body.entitlements.core_analysis_access, true);
  // 返金の後は、同じ閲覧トークンでも開けない（閲覧のたびに注文を確かめる）
  db.t.type_report_orders[0].status = 'refunded';
  assert.equal((await view(rt)).code, 403);
  assert.equal((await call('link-open', { token })).body.state, 'unavailable');
  assert.equal((await call('link-open', { token: 'x'.repeat(43) })).status, 404);
});

test('Webhook：タイプ別レポートの注文の支払い・返金を反映し、ETI（complete_）・邪眼（jagan_）の関数は呼ばない', async () => {
  const { db, stripe, call } = setup();
  await call('buy', { type: 'ELSW', attempt: attempt() });
  const o = db.t.type_report_orders[0];
  const { chargeId } = stripe.pay(o.stripe_checkout_session_id);
  const seen = [];
  const wfetch = async (url, init) => { seen.push(new URL(url).pathname); return db.fetchImpl(url, init); };
  const wh = Webhook.createHandler({ env: ENV, fetchImpl: wfetch, stripeFactory: stripe.factory, logger: { error() {} }, waitUntil: () => {} });
  const send = async (type, objectId) => {
    const { req: rq } = eventRequest({ type, objectId, secret: WH });
    rq.headers.host = HOST;
    const out = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
    await wh(rq, out);
    return out;
  };
  const r = await send('checkout.session.completed', o.stripe_checkout_session_id);
  assert.equal(r.code, 200);
  assert.equal(r.body.result, 'processed');
  assert.equal(o.status, 'paid');
  assert.ok(!seen.some((p) => /rpc\/(complete_|jagan_)/.test(p)), 'ETI・邪眼の関数は呼ばない');
  stripe.refund(chargeId, 1000);
  const r2 = await send('charge.refunded', chargeId);
  assert.equal(r2.body.result, 'processed');
  assert.equal(o.status, 'refunded');
});

test('商品の区別：商品キーは eti_type_report_v1、Stripe の metadata.app は解析レポート・邪眼と別', () => {
  assert.equal(PRODUCT_KEY, 'eti_type_report_v1');
  assert.equal(APP, 'element-diagnosis-type');
});
