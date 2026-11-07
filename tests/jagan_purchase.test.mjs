// 邪眼解析レポートの購入 API（lib/jagan-purchase.mjs・api/stripe-webhook.js の邪眼の分岐）。
//   DB はメモリ上の模型（関数の振る舞いは tests/pg/jagan_02.pg.test.js が実 PG で確かめる）、Stripe は偽物（tests/fixtures/fake_stripe.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createPurchaseHandler, handleWebhook, sha256hex, salesOpen, APP } from '../lib/jagan-purchase.mjs';
import { BUNDLE } from '../jagan/engine/data.mjs';
import { SAMPLE_ANSWERS } from '../jagan/sample.mjs';

const require = createRequire(import.meta.url);
const { PREVIEW_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const Webhook = require('../api/stripe-webhook.js');

const ORIGIN = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const HOST = new URL(ORIGIN).host;
const WH = 'whsec_test_fake_secret_for_jagan_tests';
const ENV = { ...PREVIEW_ENV, JAGAN_SALES_OPEN: 'true', COMPLETE_CHECKOUT_ORIGIN: ORIGIN, COMPLETE_VIEW_TOKEN_SECRET: crypto.randomBytes(32).toString('base64url'), STRIPE_COMPLETE_WEBHOOK_SECRET: WH };
const ISV = BUNDLE.items.item_set_version;
const U = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', c: '33333333-3333-4333-8333-333333333333' };
const TOKENS = { 'tok-a': U.a, 'tok-b': U.b, 'tok-c': U.c };
const uuid = () => crypto.randomUUID();
const attempt = () => crypto.randomBytes(18).toString('base64url');

// ---- メモリ上の DB（PostgREST の select と、jagan_02 の関数の振る舞い）
function fakeDb() {
  const t = { jagan_results: [], jagan_orders: [], jagan_order_registrations: [], jagan_entitlements: [], profiles: [
    { id: U.a, onboarding_status: 'completed' }, { id: U.b, onboarding_status: 'completed' }, { id: U.c, onboarding_status: 'required' }] };
  const refresh = (user, rid) => {
    const ok = t.jagan_order_registrations.filter((r) => r.user_id === user && r.result_id === rid)
      .map((r) => t.jagan_orders.find((o) => o.id === r.order_id)).find((o) => o.status === 'paid' && o.link_status === 'active');
    const e = t.jagan_entitlements.find((x) => x.user_id === user && x.result_id === rid);
    if (ok) { if (e) Object.assign(e, { status: 'active', order_id: ok.id }); else t.jagan_entitlements.push({ id: uuid(), user_id: user, result_id: rid, product_key: 'jagan_report_v1', status: 'active', order_id: ok.id }); }
    else if (e) e.status = 'refunded';
  };
  const rpc = {
    jagan_create_order(a) {
      const v = t.jagan_orders.find((o) => o.idempotency_key === a.p_idempotency_key);
      if (v) {
        if (v.result_id !== a.p_result_id || v.buyer_user_id !== a.p_buyer_user_id) throw { message: 'jagan_idempotency_conflict' };
        return [{ order_id: v.id, order_status: v.status, created: false, checkout_session_id: v.stripe_checkout_session_id }];
      }
      const o = { id: uuid(), result_id: a.p_result_id, item_set_version: a.p_item_set_version, answers: a.p_answers, dti_code: a.p_dti_code, headline: a.p_headline,
        buyer_user_id: a.p_buyer_user_id, status: 'created', idempotency_key: a.p_idempotency_key, link_token_hash: a.p_link_token_hash, link_status: 'active',
        stripe_checkout_session_id: null, stripe_payment_intent_id: null, stripe_mode: a.p_stripe_mode, amount: 1000, currency: 'jpy', created_at: new Date().toISOString(), paid_at: null };
      t.jagan_orders.push(o);
      return [{ order_id: o.id, order_status: 'created', created: true, checkout_session_id: null }];
    },
    jagan_mark_checkout_open(a) {
      const o = t.jagan_orders.find((x) => x.id === a.p_order_id);
      if (o.status === 'created') { o.status = 'checkout_open'; o.stripe_checkout_session_id = a.p_checkout_session_id; return 'opened'; }
      if (o.status === 'checkout_open' && o.stripe_checkout_session_id === a.p_checkout_session_id) return 'noop';
      throw { message: 'jagan_order_not_open' };
    },
    jagan_apply_payment(a) {
      const o = t.jagan_orders.find((x) => x.id === a.p_order_id);
      if (!o) return 'ignored:order_not_found';
      if (a.p_payment_status !== 'paid') return 'ignored:payment_not_paid';
      if (a.p_amount_total !== o.amount) { o.status = 'failed'; return 'ignored:amount_mismatch'; }
      if (['paid', 'refunded', 'disputed'].includes(o.status)) return 'noop';
      Object.assign(o, { status: 'paid', paid_at: new Date().toISOString(), stripe_checkout_session_id: a.p_checkout_session_id, stripe_payment_intent_id: a.p_payment_intent_id });
      const owner = t.jagan_results.find((r) => r.result_id === o.result_id);
      if (o.buyer_user_id && owner && owner.user_id === o.buyer_user_id) {
        t.jagan_order_registrations.push({ user_id: o.buyer_user_id, order_id: o.id, result_id: o.result_id });
        refresh(o.buyer_user_id, o.result_id);
      }
      return 'applied';
    },
    jagan_close_order(a) { const o = t.jagan_orders.find((x) => x.id === a.p_order_id); if (['created', 'checkout_open'].includes(o.status)) { o.status = a.p_status; return 'closed'; } return 'noop'; },
    jagan_apply_reversal(a) {
      const o = t.jagan_orders.find((x) => x.id === a.p_order_id);
      const next = a.p_kind === 'refunded' ? 'refunded' : a.p_kind === 'disputed' ? (o.status === 'refunded' ? 'refunded' : 'disputed') : (o.status === 'disputed' ? 'paid' : o.status);
      if (next === o.status) return 'noop';
      o.status = next;
      t.jagan_order_registrations.filter((r) => r.order_id === o.id).forEach((r) => refresh(r.user_id, r.result_id));
      return 'applied';
    },
    jagan_register_order(a) {
      const p = t.profiles.find((x) => x.id === a.p_user_id);
      if (!p || !['completed', 'legacy_exempt'].includes(p.onboarding_status)) throw { message: 'jagan_onboarding_required' };
      const o = t.jagan_orders.find((x) => x.link_token_hash === a.p_link_token_hash);
      if (!o) return [{ reg_result: 'not_found', reg_result_id: null }];
      if (o.status !== 'paid') return [{ reg_result: 'inactive', reg_result_id: null }];
      const done = t.jagan_order_registrations.find((r) => r.user_id === a.p_user_id && r.order_id === o.id);
      if (done) return [{ reg_result: 'already', reg_result_id: done.result_id }];
      const owner = t.jagan_results.find((r) => r.result_id === o.result_id);
      let rid = o.result_id;
      if (!owner || owner.user_id !== a.p_user_id) {
        rid = owner ? a.p_fallback_result_id : o.result_id;
        t.jagan_results.push({ result_id: rid, user_id: a.p_user_id, item_set_version: o.item_set_version, answers: o.answers, snapshot: a.p_snapshot, dti_code: o.dti_code });
      }
      t.jagan_order_registrations.push({ user_id: a.p_user_id, order_id: o.id, result_id: rid });
      refresh(a.p_user_id, rid);
      return [{ reg_result: 'registered', reg_result_id: rid }];
    },
  };
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const tok = String((init.headers || {}).Authorization || (init.headers || {}).authorization || '').replace('Bearer ', '');
      return TOKENS[tok] ? json(200, { id: TOKENS[tok], email: null }) : json(401, {});
    }
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (m) {
      try { return json(200, rpc[m[1]](JSON.parse(init.body))); } catch (e) { return json(400, { message: e.message || String(e) }); }
    }
    const tm = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (tm && t[tm[1]]) {
      let list = t[tm[1]];
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

function req(op, body, { token, origin = ORIGIN, contentType = 'application/json' } = {}) {
  const headers = { host: HOST, 'content-type': contentType, origin };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', url: `/api/jagan-report?op=${op}`, headers, body: JSON.stringify(body) };
}
function res() {
  return { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; return this; } };
}
function setup(env = ENV) {
  const db = fakeDb();
  const stripe = fakeStripe();
  const h = createPurchaseHandler({ env, fetchImpl: db.fetchImpl, stripeFactory: stripe.factory, logger: { error() {} } });
  const call = async (op, body, opts) => { const r = res(); await h(req(op, body, opts), r, op); return { status: r.statusCode, body: r.body }; };
  return { db, stripe, call };
}
const buyBody = (over = {}) => ({ resultId: uuid(), itemSetVersion: ISV, answers: { ...SAMPLE_ANSWERS }, attempt: attempt(), ...over });
const secretOf = (stripe) => new URL(stripe.st.lastCreate.params.success_url).hash.replace('#t=', '');

test('販売：Preview は JAGAN_SALES_OPEN=true のときだけ。本番は product.json の sales_open も必要', async () => {
  assert.equal(salesOpen({ JAGAN_SALES_OPEN: 'true' }, 'preview'), true);
  assert.equal(salesOpen({}, 'preview'), false);
  assert.equal(salesOpen({ JAGAN_SALES_OPEN: 'true' }, 'production'), BUNDLE.product.sales_open === true);
  const { call } = setup({ ...ENV, JAGAN_SALES_OPEN: 'false' });
  assert.deepEqual((await call('buy', buyBody())).body, { error: 'sales_closed' });
});

test('購入（ログインなし）：金額はサーバーが決め、決済の戻り先は固有リンク。同じ購入操作の再送は同じ決済画面', async () => {
  const { db, stripe, call } = setup();
  const body = buyBody();
  const r1 = await call('buy', body);
  assert.equal(r1.status, 200);
  assert.match(r1.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(r1.body.amount, 1000);
  const p = stripe.st.lastCreate.params;
  assert.deepEqual(p.line_items, [{ price_data: { currency: 'jpy', unit_amount: 1000, product_data: { name: '邪眼解析レポート' } }, quantity: 1 }]);
  assert.deepEqual(p.metadata, { order_id: db.t.jagan_orders[0].id, app: APP, env: 'preview' });
  assert.match(p.success_url, new RegExp(`^${ORIGIN}/jagan/report#t=[A-Za-z0-9_-]{43}$`));
  assert.equal(p.cancel_url, `${ORIGIN}/jagan/?checkout=canceled`);
  assert.match(p.custom_text.submit.message, /1,000円・税込/);
  const o = db.t.jagan_orders[0];
  assert.equal(o.link_token_hash, sha256hex(secretOf(stripe)), 'DB には秘密値のハッシュだけ');
  assert.equal(o.status, 'checkout_open');
  assert.equal(o.buyer_user_id, null);
  assert.ok(!JSON.stringify(r1.body).includes(o.id) && !JSON.stringify(r1.body).includes(secretOf(stripe)), '応答に注文 ID・秘密値を出さない');
  const r2 = await call('buy', body);
  assert.equal(r2.body.checkoutUrl, r1.body.checkoutUrl);
  assert.equal(db.t.jagan_orders.length, 1);
  assert.equal(stripe.st.calls.filter((c) => c === 'checkout.sessions.create').length, 1);
});

test('購入の入力：不正な回答・余分な項目・別サイトからの送信・JSON 以外は断る', async () => {
  const { call } = setup();
  assert.equal((await call('buy', buyBody({ answers: { ...SAMPLE_ANSWERS, ANX01: 6 } }))).status, 400);
  assert.equal((await call('buy', buyBody({ price: 1 }))).status, 400);
  assert.equal((await call('buy', buyBody({ attempt: 'short' }))).status, 400);
  assert.equal((await call('buy', buyBody(), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('buy', buyBody(), { contentType: 'text/plain' })).status, 403);
  assert.equal((await call('nope', {})).status, 404);
  // 回答を送らない購入は、ログインして自分の保存した結果からだけ
  assert.equal((await call('buy', { resultId: uuid(), attempt: attempt() })).status, 401);
});

test('固有リンク：支払い前は pending、支払うと（Webhook が無くても）Stripe に確かめて反映し、その回答を返す', async () => {
  const { db, stripe, call } = setup();
  const body = buyBody();
  await call('buy', body);
  const token = secretOf(stripe);
  assert.deepEqual((await call('link-open', { token })).body, { ok: true, state: 'pending' });
  const cs = db.t.jagan_orders[0].stripe_checkout_session_id;
  stripe.pay(cs);
  const r = await call('link-open', { token });
  assert.equal(r.body.state, 'paid');
  assert.deepEqual(r.body.report.answers, body.answers);
  assert.equal(r.body.report.resultId, body.resultId);
  assert.equal(db.t.jagan_orders[0].status, 'paid');
  assert.equal((await call('link-open', { token: 'x'.repeat(43) })).status, 404);
});

test('Webhook：邪眼の注文の支払い・返金を反映し、ETI の処理（complete_）は呼ばない', async () => {
  const { db, stripe, call } = setup();
  await call('buy', buyBody());
  const o = db.t.jagan_orders[0];
  const { chargeId } = stripe.pay(o.stripe_checkout_session_id);
  const seen = [];
  const wfetch = async (url, init) => { const p = new URL(url).pathname; seen.push(p); return db.fetchImpl(url, init); };
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
  assert.ok(!seen.some((p) => /rpc\/complete_/.test(p)), 'ETI の関数は呼ばない');
  stripe.refund(chargeId, 1000);
  const r2 = await send('charge.refunded', chargeId);
  assert.equal(r2.body.result, 'processed');
  assert.equal(o.status, 'refunded');
  assert.equal((await call('link-open', { token: secretOf(stripe) })).body.state, 'unavailable');
});

test('マイページへの登録：ログイン・登録完了が必要。登録すると記録と権利（active）ができ、マイページから開ける。返金で止まる', async () => {
  const { db, stripe, call } = setup();
  const body = buyBody();
  await call('buy', body);
  const token = secretOf(stripe);
  const { chargeId } = stripe.pay(db.t.jagan_orders[0].stripe_checkout_session_id);
  assert.equal((await call('link-register', { token })).status, 401);
  assert.equal((await call('link-register', { token }, { token: 'tok-c' })).status, 403, '登録未完了');
  const r = await call('link-register', { token }, { token: 'tok-b' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.result, 'registered');
  assert.equal(r.body.resultId, body.resultId);
  const row = db.t.jagan_results.find((x) => x.user_id === U.b);
  assert.equal(row.snapshot.dti.code, db.t.jagan_orders[0].dti_code, 'サーバーが同じ版で計算した記録');
  assert.equal(db.t.jagan_entitlements[0].status, 'active');
  assert.equal((await call('link-register', { token }, { token: 'tok-b' })).body.result, 'already');
  const open = await call('open', { resultId: body.resultId }, { token: 'tok-b' });
  assert.equal(open.status, 200);
  assert.deepEqual(open.body.report.answers, body.answers);
  assert.equal((await call('open', { resultId: body.resultId }, { token: 'tok-a' })).status, 403, '他の人は開けない');
  // 返金（Webhook）で止まる
  stripe.refund(chargeId, 1000);
  await handleWebhook({ fetchImpl: db.fetchImpl, conn: { appEnv: 'preview', stripeMode: 'test', supabaseUrl: ENV.SUPABASE_URL, adminHeaders: () => ({}) }, stripe: stripe.client, type: 'charge.refunded', obj: { id: chargeId } });
  assert.equal(db.t.jagan_entitlements[0].status, 'refunded');
  assert.equal((await call('open', { resultId: body.resultId }, { token: 'tok-b' })).status, 403);
});

test('マイページからの購入：回答を送らず本人の保存した結果から。支払うと本人のマイページに自動で登録（INSIGHT）', async () => {
  const { db, stripe, call } = setup();
  const rid = uuid();
  db.t.jagan_results.push({ result_id: rid, user_id: U.a, item_set_version: ISV, answers: { ...SAMPLE_ANSWERS } });
  assert.equal((await call('buy', { resultId: rid, attempt: attempt() }, { token: 'tok-b' })).status, 404, '他の人の記録からは買えない');
  const r = await call('buy', { resultId: rid, attempt: attempt(), source: 'mypage_latest' }, { token: 'tok-a' });
  assert.equal(r.status, 200);
  const o = db.t.jagan_orders.find((x) => x.buyer_user_id === U.a);
  stripe.pay(o.stripe_checkout_session_id);
  assert.equal((await call('link-open', { token: secretOf(stripe) })).body.state, 'paid');
  assert.deepEqual(db.t.jagan_entitlements.map((e) => [e.user_id, e.result_id, e.status]), [[U.a, rid, 'active']]);
});
