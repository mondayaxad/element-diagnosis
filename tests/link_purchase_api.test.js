// 新しい購入の経路（complete_13）：解析レポート ¥1,000・完全解析 ¥3,000・期限なしのレポート固有リンク・マイページへの登録。
//   本物の SQL 関数（complete_01〜13）が必要：COMPLETE_DB_BACKEND=<createBackend を返すモジュール> と PGT_HOST を指定して実行する。
//   指定が無い時は skip する。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PREVIEW_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const { createFakeStorage } = require('./fixtures/fake_storage');
const { savedRecord, variantAnswers } = require('./fixtures/report_data');
const LP = require('../lib/link-purchase');

const BACKEND = process.env.COMPLETE_DB_BACKEND;
const skip = BACKEND ? false : 'COMPLETE_DB_BACKEND（PG17・complete_01〜13）が無いため skip';
const Checkout = require('../api/complete-checkout.js');
const Webhook = require('../api/stripe-webhook.js');
const ReportData = require('../api/report-data.js');
const Status = require('../api/complete-status.js');

const SECRET = 'whsec_test_fake_secret_for_unit_tests';
const ORIGIN = 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app';
const VIEW_SECRET = crypto.randomBytes(32).toString('base64url');
const ENV = {
  ...PREVIEW_ENV,
  COMPLETE_SALES_OPEN: 'true',
  COMPLETE_CHECKOUT_ORIGIN: ORIGIN,
  STRIPE_PRICE_ANALYSIS: 'price_test_analysis1000',
  STRIPE_COMPLETE_PRICE_DIRECT: 'price_test_direct3000',
  STRIPE_COMPLETE_PRICE_UPGRADE: 'price_test_upgrade2000',
  STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET,
  COMPLETE_VIEW_TOKEN_SECRET: VIEW_SECRET,
};
const PRICES = {
  price_test_analysis1000: { id: 'price_test_analysis1000', active: true, livemode: false, currency: 'jpy', unit_amount: 1000, type: 'one_time' },
  price_test_direct3000: { id: 'price_test_direct3000', active: true, livemode: false, currency: 'jpy', unit_amount: 3000, type: 'one_time' },
  price_test_upgrade2000: { id: 'price_test_upgrade2000', active: true, livemode: false, currency: 'jpy', unit_amount: 2000, type: 'one_time' },
};
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CODE_A = savedRecord().encoded_answers;
const CODE_B = savedRecord(variantAnswers(1)).encoded_answers;
const attemptId = () => crypto.randomBytes(18).toString('base64url');

function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end() { return this; },
  };
}
function makeLogger() {
  const lines = [];
  const push = (...a) => lines.push(a.map(String).join(' '));
  return { lines, error: push, warn: push, log: push, info: push };
}

const OPEN = [];
test.afterEach(async () => {
  while (OPEN.length) {
    const db = OPEN.pop();
    if (!db.__closed) await db.close().catch(() => {});
  }
});

async function setup({ env = {} } = {}) {
  const db = await require(BACKEND).createBackend();
  const close0 = db.close.bind(db);
  db.close = async () => { if (db.__closed) return; db.__closed = true; await close0(); };
  OPEN.push(db);
  const storage = createFakeStorage();
  const fetchImpl = storage.wrap(db.fetchImpl);
  const stripe = fakeStripe({ prices: JSON.parse(JSON.stringify(PRICES)) });
  const logger = makeLogger();
  const pending = [];
  const fullEnv = { ...ENV, ...env };
  const deps = { env: fullEnv, fetchImpl, stripeFactory: stripe.factory, logger, waitUntil: (p) => { pending.push(p); } };
  const checkoutH = Checkout.createHandler(deps);
  const webhookH = Webhook.createHandler(deps);
  const statusH = Status.createHandler(deps);
  const bodies = [];
  const ctx = {
    db, stripe, logger, env: fullEnv, bodies, cookie: '', pending, storage,
    // ブラウザ（Cookie を保持する）として呼ぶ
    async op(op, body, { token, cookie } = {}) {
      const res = makeRes();
      const headers = { host: 'evil.example' };
      const jar = cookie !== undefined ? cookie : ctx.cookie;
      if (jar) headers.cookie = jar;
      if (token) headers.authorization = `Bearer ${token}`;
      await checkoutH({ method: 'POST', headers, query: { op }, body }, res);
      const set = res.headers['set-cookie'];
      if (set && cookie === undefined) ctx.cookie = mergeCookie(ctx.cookie, set.split(';')[0]);
      bodies.push(JSON.stringify(res.body));
      return res;
    },
    async webhook(opts) {
      const { req } = eventRequest({ secret: SECRET, ...opts });
      const res = makeRes();
      await webhookH(req, res);
      return res;
    },
    async reportData(url) {
      const token = decodeURIComponent(url.split('token=')[1]);
      const res = makeRes();
      await ReportData.createHandler({ env: fullEnv, fetchImpl })({ method: 'GET', headers: {}, query: { token } }, res);
      return res;
    },
    async view(url) {
      const res = makeRes();
      await statusH({ method: 'GET', headers: { host: 'evil.example' }, query: { view: url.split('view=')[1] } }, res);
      return res;
    },
    async drain() { while (pending.length) await pending.shift(); },
    csIdOf(url) { return url.split('/').pop(); },
    async rows(t) { return db.rows(t); },
  };
  return ctx;
}
// Cookie：同じ名前の値だけ置き換える（旧経路の Cookie と新しい購入の Cookie を別々に持つ）
function mergeCookie(jar, pair) {
  const name = pair.split('=')[0];
  const rest = (jar || '').split('; ').filter((p) => p && p.split('=')[0] !== name);
  return rest.concat([pair]).join('; ');
}

// 診断結果ページの記録（ゲストの記録と診断結果の固有リンク）を作り、購入対象トークンを得る
async function resultContext(ctx, code = CODE_A) {
  const resume = crypto.randomBytes(32).toString('base64url');
  const r = await ctx.op('result-link', { code, token: resume }, { cookie: '' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const c = await ctx.op('buy-context', { resume }, { cookie: '' });
  assert.equal(c.code, 200, JSON.stringify(c.body));
  return { resume, context: c.body.context, summary: c.body.summary };
}
async function buyAndPay(ctx, context, product, { goal, attempt = attemptId(), pay = true } = {}) {
  const body = { context, product, attempt, source: 'result' };
  if (goal) body.goal = goal;
  const r = await ctx.op('buy', body);
  assert.equal(r.code, 200, JSON.stringify(r.body) + ctx.logger.lines.join('|'));
  const cs = ctx.csIdOf(r.body.checkoutUrl);
  if (pay) ctx.stripe.pay(cs, { customer_details: { email: 'buyer@example.test' } });
  return { r, cs, attempt };
}
async function purchases(ctx) {
  const d = await ctx.op('deliveries', {});
  assert.equal(d.code, 200, JSON.stringify(d.body));
  return d.body.purchases;
}

test('A ¥1,000：診断結果の記録で購入→支払い→購入完了ページで固有リンク→開くと解析レポートだけ（完全解析は開けない）。秘密値は DB にハッシュだけ', { skip }, async () => {
  const ctx = await setup();
  const { context, summary } = await resultContext(ctx);
  assert.ok(summary.element && summary.weapon && summary.nation && summary.mirror && /^\d{4}-\d{2}-\d{2}$/.test(summary.diagnosedOn));
  assert.doesNotMatch(context, UUID_RE, '購入対象トークンに記録 ID を平文で入れない');
  await buyAndPay(ctx, context, 'analysis');
  const list = await purchases(ctx);
  assert.equal(list.length, 1);
  const p = list[0];
  assert.deepEqual([p.product, p.state], ['analysis', 'active']);
  assert.match(p.link, /^[A-Za-z0-9_-]{43}$/, '256bit の秘密値');
  assert.equal(Buffer.from(p.link, 'base64url').length, 32);
  const [delivery] = await ctx.rows('report_deliveries');
  assert.equal(delivery.link_token_hash, LP.tokenHash(p.link));
  const raw = await ctx.db.sql('select count(*)::int n from public.report_deliveries where link_token_hash = $1', [p.link]);
  assert.equal((raw.rows || raw)[0].n, 0, '生の秘密値は保存しない');
  const orders = await ctx.rows('complete_orders');
  assert.deepEqual(orders.map((o) => `${o.buyer}:${o.offer}:${o.amount}:${o.status}:${o.user_id}`), ['link:analysis:1000:paid:null']);
  assert.equal(ctx.stripe.st.lastCreate.params.customer_email, undefined, '購入時メールを入れない（本人の判定に使わない）');
  // 決済の後は、購入したレポートの固有リンクへそのまま戻る。同じリンクを Stripe の請求書（購入者へのメール）にも載せる
  const created = ctx.stripe.st.lastCreate.params;
  assert.match(created.success_url, new RegExp(`^https://[^/]+/report-link#t=${p.link}$`));
  assert.equal(created.invoice_creation.enabled, true);
  assert.ok(created.invoice_creation.invoice_data.description.includes(created.success_url));
  assert.match(created.invoice_creation.invoice_data.description, /^解析レポートのURL（期限なし）/);
  assert.match(ctx.stripe.st.lastCreate.params.custom_text.submit.message, /^解析レポート（1,000円・税込）。.*すぐにお読みいただけます。.*返品・返金はお受けしていません/, '決済画面（最終確認画面）に価格・提供の時期・返品の決まり');
  // 固有リンクを開く（Cookie の無いブラウザでも開ける）
  const o = await ctx.op('link-open', { token: p.link, open: true }, { cookie: '' });
  assert.equal(o.code, 200, JSON.stringify(o.body));
  assert.deepEqual([o.body.product, o.body.state], ['analysis', 'active']);
  assert.match(o.body.url, /^\/report\.html\?token=/);
  assert.ok(o.body.context, '解析レポートの最下部の完全解析の申込に使う購入対象トークン');
  const rd = await ctx.reportData(o.body.url);
  assert.equal(rd.code, 200, JSON.stringify(rd.body));
  assert.equal(rd.body.entitlements.core_analysis_access, true);
  assert.equal(rd.body.viewer, 'delivery');
  assert.equal(rd.body.code, `${CODE_A}`.replace(/^v2_/, ''));
  // 解析レポートの固有リンクで完全解析は開けない（商品は独立）
  assert.equal(o.body.report, undefined);
  assert.deepEqual(await ctx.rows('complete_reports'), []);
  await ctx.db.close();
});

test('購入完了ページへ戻った時（cs=今の決済）：今の購入だけ current とリンク（支払いの確認の前でも）。途中でやめた決済にはリンクを出さない', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  // 途中でやめた決済画面（支払わない）→ 新しい購入操作で支払う
  const left = await buyAndPay(ctx, context, 'complete', { goal: 'GOAL_EXPLORE_01', pay: false });
  const paid = await buyAndPay(ctx, context, 'complete', { goal: 'GOAL_EXPLORE_01', pay: false });
  // 支払いの確認の前（Webhook の前）でも、今の購入のリンクを返す
  let d = await ctx.op('deliveries', { session: paid.cs });
  assert.equal(d.code, 200, JSON.stringify(d.body));
  let cur = d.body.purchases.filter((x) => x.current);
  assert.equal(cur.length, 1);
  assert.equal(cur[0].state, 'pending');
  assert.match(cur[0].link, /^[A-Za-z0-9_-]{43}$/);
  const other = d.body.purchases.filter((x) => !x.current);
  assert.ok(other.every((x) => x.link === undefined), '途中でやめた決済にはリンクを出さない');
  ctx.stripe.pay(paid.cs, { customer_details: { email: 'buyer@example.test' } });
  d = await ctx.op('deliveries', { session: paid.cs });
  cur = d.body.purchases.filter((x) => x.current);
  assert.deepEqual([cur[0].state, cur[0].product], ['active', 'complete']);
  // 他人の決済の ID（この端末の Cookie の注文でない）・形の違う ID
  const stranger = await ctx.op('deliveries', { session: 'cs_test_' + 'z'.repeat(40) });
  assert.equal(stranger.body.purchases.filter((x) => x.current).length, 0);
  assert.equal((await ctx.op('deliveries', { session: 'not-a-session' })).code, 400);
  assert.ok(left.cs !== paid.cs);
  await ctx.db.close();
});

test('B ¥3,000：MENTOR 目標が必須・注文に固定。支払い→生成→固有リンクで完全解析だけ（解析レポートは開けない）', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  assert.deepEqual((await ctx.op('buy', { context, product: 'complete', attempt: attemptId() })).body, { error: 'mentor_goal_required' });
  assert.deepEqual((await ctx.op('buy', { context, product: 'analysis', goal: 'GOAL_PACE_01', attempt: attemptId() })).body, { error: 'invalid_request' });
  await buyAndPay(ctx, context, 'complete', { goal: 'GOAL_EXPLORE_01' });
  assert.match(ctx.stripe.st.lastCreate.params.custom_text.submit.message, /^完全解析（3,000円・税込）。解析レポートとは別の商品.*MENTOR の目標は、お支払いの後は変更できません。.*返品・返金はお受けしていません/);
  const [order] = await ctx.rows('complete_orders');
  assert.deepEqual([order.offer, order.amount, order.mentor_goal_id], ['direct_complete', 3000, 'GOAL_EXPLORE_01']);
  assert.deepEqual(await ctx.rows('record_mentor_goals'), [], '記録の目標の表は使わない（注文に固定）');
  const [p] = await purchases(ctx);
  assert.deepEqual([p.product, p.state, p.report.status], ['complete', 'active', 'generating']);
  await ctx.drain();
  const [report] = await ctx.rows('complete_reports');
  assert.deepEqual([report.status, report.via_link, report.user_id, report.mentor_goal_id], ['ready', true, null, 'GOAL_EXPLORE_01']);
  const o = await ctx.op('link-open', { token: p.link, open: true }, { cookie: '' });
  assert.equal(o.body.report.status, 'ready');
  assert.match(o.body.url, /^\/api\/complete-status\?view=/);
  const v = await ctx.view(o.body.url);
  assert.equal(v.code, 200);
  assert.match(String(v.body), /マイページに登録する/);
  assert.match(String(v.body), /PDF/);
  assert.doesNotMatch(String(v.body), new RegExp(p.link), '完全解析の HTML に固有リンクの秘密値を入れない');
  // 完全解析の固有リンクから解析レポート（report.html）のトークンは出ない
  assert.doesNotMatch(o.body.url, /report\.html/);
  await ctx.db.close();
});

test('¥2,000 は UI・API・DB で新しく作れない（既存の行は残す）', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  for (const product of ['upgrade', 'analysis_upgrade']) {
    const r = await ctx.op('buy', { context, product, goal: 'GOAL_PACE_01', attempt: attemptId() });
    assert.deepEqual([r.code, r.body], [400, { error: 'offer_retired' }]);
  }
  const [session] = await ctx.rows('diagnosis_sessions');
  await assert.rejects(ctx.db.sql(`insert into public.complete_orders (diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
      mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at, buyer, claim_secret_hash)
    values ($1, 'analysis_upgrade', 2000, 'test', 'record_entitlement', 'x_${attemptId()}', 'CORE1-MENTOR-GOALS-1.0.0', 'GOAL_PACE_01', now(), 'link', $2)`,
  [session.id, crypto.randomBytes(32).toString('hex')]), /complete_offer_retired|check constraint/);
  await assert.rejects(ctx.db.sql(`select * from public.complete_create_link_order($1, 'analysis_upgrade', $2, $3, 'GOAL_PACE_01')`,
    [session.id, `lk_${attemptId()}`, crypto.randomBytes(32).toString('hex')]), /complete_offer_retired/);
  // 旧経路の申込は廃止（410）
  assert.equal((await ctx.op('guest-checkout', { offer: 'analysis', code: CODE_A })).code, 410);
  await ctx.db.close();
});

test('再購入：同じ記録・同じ商品でも新しい購入操作なら別の注文・別の固有リンク。A と B は別々に買える', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  await buyAndPay(ctx, context, 'analysis');
  await buyAndPay(ctx, context, 'analysis');
  await buyAndPay(ctx, context, 'complete', { goal: 'GOAL_PACE_01' });
  await buyAndPay(ctx, context, 'complete', { goal: 'GOAL_VISIBLE_01' });
  const list = await purchases(ctx);
  assert.equal(list.length, 4);
  assert.ok(list.every((p) => p.state === 'active' && p.link));
  assert.equal(new Set(list.map((p) => p.link)).size, 4);
  await ctx.drain();
  const reports = await ctx.rows('complete_reports');
  assert.deepEqual(reports.map((r) => r.mentor_goal_id).sort(), ['GOAL_PACE_01', 'GOAL_VISIBLE_01'], '注文ごとに生成物（目標は注文のもの）');
  assert.equal((await ctx.rows('report_deliveries')).length, 4);
  await ctx.db.close();
});

test('Checkout の技術的な二重処理：同じ購入操作の再送・連打は1件。古い決済画面は新しい購入を妨げず、後から払っても別の注文として納品', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  const attempt = attemptId();
  const burst = await Promise.all([1, 2, 3].map(() => ctx.op('buy', { context, product: 'analysis', attempt })));
  const urls = burst.filter((r) => r.code === 200).map((r) => r.body.checkoutUrl);
  assert.ok(urls.length >= 1);
  assert.equal(new Set(urls).size, 1, '同じ購入操作は同じ決済画面');
  assert.equal((await ctx.rows('complete_orders')).length, 1);
  const again = await ctx.op('buy', { context, product: 'analysis', attempt });
  assert.equal(again.body.checkoutUrl, urls[0]);
  // 決済画面を閉じたまま（払わずに）次の購入：妨げない
  const second = await buyAndPay(ctx, context, 'analysis', { pay: false });
  assert.notEqual(second.cs, ctx.csIdOf(urls[0]));
  // 古い決済画面を後から払う → 別の支払済みの注文として納品
  ctx.stripe.pay(ctx.csIdOf(urls[0]), { customer_details: { email: 'x@example.test' } });
  ctx.stripe.pay(second.cs, { customer_details: { email: 'x@example.test' } });
  const list = await purchases(ctx);
  assert.deepEqual(list.map((p) => p.state).sort(), ['active', 'active']);
  // Webhook の再送でも、納品は注文ごとに1件
  const orders = await ctx.rows('complete_orders');
  for (const o of orders) {
    for (let i = 0; i < 2; i++) {
      const w = await ctx.webhook({ type: 'checkout.session.completed', id: 'evt_dup_' + o.id.slice(0, 8), objectId: o.stripe_checkout_session_id });
      assert.equal(w.code, 200);
    }
  }
  assert.equal((await ctx.rows('report_deliveries')).length, 2);
  await ctx.db.close();
});

test('キャンセル（期限切れ）の直後に買い直せる', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  const first = await buyAndPay(ctx, context, 'analysis', { pay: false });
  ctx.stripe.expire(first.cs);
  const w = await ctx.webhook({ type: 'checkout.session.expired', objectId: first.cs });
  assert.equal(w.code, 200);
  await buyAndPay(ctx, context, 'analysis');
  const list = await purchases(ctx);
  assert.deepEqual(list.map((p) => p.state), ['active', 'closed']);
  await ctx.db.close();
});

test('固有リンク：未払いでは開けない（支払い待ち）。返金・異議申し立て・運営者の停止で開けない。再発行すると古いリンクは無効', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  const unpaid = await buyAndPay(ctx, context, 'analysis', { pay: false });
  const [pending] = await purchases(ctx);
  assert.deepEqual([pending.state, pending.link], ['pending', undefined], '未払いでは固有リンクを示さない');
  ctx.stripe.pay(unpaid.cs, { customer_details: { email: 'x@example.test' } });
  const [p] = await purchases(ctx);
  assert.equal(p.state, 'active');
  const open = async (token) => (await ctx.op('link-open', { token, open: true }, { cookie: '' })).body;
  // 異議申し立て → 停止中
  const [order] = await ctx.rows('complete_orders');
  const charge = Object.keys(ctx.stripe.st.charges)[0];
  const du = ctx.stripe.dispute(charge);
  await ctx.webhook({ type: 'charge.dispute.created', objectId: du });
  let b = await open(p.link);
  assert.deepEqual([b.state, b.url], ['suspended', null]);
  ctx.stripe.st.disputes[du].status = 'won';
  await ctx.webhook({ type: 'charge.dispute.closed', objectId: du });
  b = await open(p.link);
  assert.equal(b.state, 'active');
  // 運営者の停止 → 再発行（新しい秘密値のハッシュ）
  const [delivery] = await ctx.rows('report_deliveries');
  await ctx.db.sql(`select public.complete_admin_revoke_delivery($1, 'operator')`, [delivery.id]);
  b = await open(p.link);
  assert.deepEqual([b.state, b.url], ['revoked', null]);
  const fresh = crypto.randomBytes(32).toString('base64url');
  await ctx.db.sql(`select public.complete_admin_reissue_delivery($1, $2)`, [delivery.id, LP.tokenHash(fresh)]);
  assert.equal((await ctx.op('link-open', { token: p.link }, { cookie: '' })).code, 404, '古いリンクは無効');
  b = await open(fresh);
  assert.equal(b.state, 'active');
  const issuedBefore = b.url;
  assert.equal((await ctx.reportData(issuedBefore)).code, 200);
  // 返金 → 開けない
  ctx.stripe.refund(charge, order.amount);
  await ctx.webhook({ type: 'charge.refunded', objectId: charge });
  b = await open(fresh);
  assert.deepEqual([b.state, b.url], ['refunded', null]);
  // 返金の後は、発行済みの閲覧トークン（15 分）でも report-data が断る（開くたびに DB で確かめる）
  assert.equal((await ctx.reportData(issuedBefore)).code, 403);
  await ctx.db.close();
});

test('マイページへの登録：ログイン必須・同じアカウントは1件・別のアカウントにも登録できる・元の登録は消えない・記録の持ち主は変わらない', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  await buyAndPay(ctx, context, 'analysis');
  const [p] = await purchases(ctx);
  assert.equal((await ctx.op('link-register', { token: p.link }, { cookie: '' })).code, 401);
  const tok1 = 'tok-reg-1';
  const tok2 = 'tok-reg-2';
  const u1 = await ctx.db.user({ email: 'one@example.test', token: tok1 });
  const u2 = await ctx.db.user({ email: 'two@example.test', token: tok2, provider: 'x' });
  const r1 = await ctx.op('link-register', { token: p.link }, { token: tok1, cookie: '' });
  assert.deepEqual(r1.body, { result: 'registered', product: 'analysis' });
  assert.deepEqual((await ctx.op('link-register', { token: p.link }, { token: tok1, cookie: '' })).body, { result: 'already', product: 'analysis' });
  assert.deepEqual((await ctx.op('link-register', { token: p.link }, { token: tok2, cookie: '' })).body, { result: 'registered', product: 'analysis' });
  const regs = await ctx.rows('account_report_registrations');
  assert.deepEqual(regs.map((r) => r.user_id).sort(), [u1, u2].sort());
  const [session] = await ctx.rows('diagnosis_sessions');
  assert.equal(session.user_id, null, '記録の持ち主は付け替えない');
  assert.equal((await ctx.rows('complete_orders')).length, 1, '注文を複製しない');
  // マイページ：両方のアカウントで、登録した解析レポートだけ（記録の形の行も返る）
  for (const tok of [tok1, tok2]) {
    const m = await ctx.op('my-reports', {}, { token: tok, cookie: '' });
    assert.equal(m.code, 200);
    assert.deepEqual(m.body.reports.map((r) => `${r.product}:${r.state}`), ['analysis:active']);
    assert.equal(m.body.records.length, 1);
    assert.equal(m.body.records[0].diagnosis_answers[0].encoded_answers, CODE_A);
    const o = await ctx.op('my-report-open', { delivery: m.body.reports[0].delivery }, { token: tok, cookie: '' });
    assert.match(o.body.url, /^\/report\.html\?token=/);
    assert.equal((await ctx.reportData(o.body.url)).code, 200);
  }
  // 登録していないアカウントは開けない
  const tok3 = 'tok-reg-3';
  await ctx.db.user({ email: 'three@example.test', token: tok3 });
  const m1 = await ctx.op('my-reports', {}, { token: tok1, cookie: '' });
  assert.equal((await ctx.op('my-report-open', { delivery: m1.body.reports[0].delivery }, { token: tok3, cookie: '' })).code, 404);
  // 返金すると、その納品から登録した両方のアカウントで開けない
  const charge = Object.keys(ctx.stripe.st.charges)[0];
  ctx.stripe.refund(charge, 1000);
  await ctx.webhook({ type: 'charge.refunded', objectId: charge });
  for (const tok of [tok1, tok2]) {
    const m = await ctx.op('my-reports', {}, { token: tok, cookie: '' });
    assert.equal(m.body.reports[0].state, 'refunded');
    const o = await ctx.op('my-report-open', { delivery: m.body.reports[0].delivery }, { token: tok, cookie: '' });
    assert.equal(o.body.url, null);
  }
  await ctx.db.close();
});

test('同じ 100 問の回答の別人（別の記録）：記録 A の購入は記録 B に伝わらない。購入対象トークンは記録ごと', { skip }, async () => {
  const ctx = await setup();
  const a = await resultContext(ctx, CODE_A);
  const b = await resultContext(ctx, CODE_A);
  const sessions = await ctx.rows('diagnosis_sessions');
  assert.equal(sessions.length, 2);
  await buyAndPay(ctx, a.context, 'analysis');
  await purchases(ctx);
  const [delivery] = await ctx.rows('report_deliveries');
  assert.equal(delivery.diagnosis_session_id, LP.readContext(ctx.env, a.context, Math.floor(Date.now() / 1000)));
  assert.notEqual(delivery.diagnosis_session_id, LP.readContext(ctx.env, b.context, Math.floor(Date.now() / 1000)));
  // 記録 B のマイページ（記録 B の持ち主として保存した人）には購入済みが出ない
  const tok = 'tok-same-answers';
  const owner = await ctx.db.user({ email: 'b@example.test', token: tok });
  const rec = await ctx.db.record({ userId: owner, code: CODE_A });
  const m = await ctx.op('my-reports', {}, { token: tok, cookie: '' });
  assert.deepEqual(m.body.reports, []);
  const c = await ctx.op('buy-context', { record: rec }, { token: tok, cookie: '' });
  assert.equal(c.code, 200);
  await ctx.db.close();
});

test('購入対象トークン：改ざん・期限切れは使えない。マイページの記録は本人の記録（または登録した記録）だけ', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  const tampered = context.slice(0, -2) + (context.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await ctx.op('buy', { context: tampered, product: 'analysis', attempt: attemptId() })).code, 410);
  const old = LP.issueContext(ctx.env, crypto.randomUUID(), Math.floor(Date.now() / 1000) - LP.CONTEXT_TTL_SEC - 60);
  assert.equal((await ctx.op('buy-summary', { context: old })).code, 410);
  const tok = 'tok-ctx-owner';
  const owner = await ctx.db.user({ email: 'o@example.test', token: tok });
  const rec = await ctx.db.record({ userId: owner, code: CODE_B });
  const other = 'tok-ctx-other';
  await ctx.db.user({ email: 'p@example.test', token: other });
  assert.equal((await ctx.op('buy-context', { record: rec }, { token: other, cookie: '' })).code, 404);
  assert.equal((await ctx.op('buy-context', { record: rec }, { cookie: '' })).code, 401);
  const mine = await ctx.op('buy-context', { record: rec }, { token: tok, cookie: '' });
  assert.equal(mine.code, 200);
  // マイページの記録で買っても、マイページへは自動で登録しない
  await buyAndPay(ctx, mine.body.context, 'analysis');
  await purchases(ctx);
  assert.deepEqual((await ctx.op('my-reports', {}, { token: tok, cookie: '' })).body.reports, []);
  const [d] = await ctx.rows('report_deliveries');
  assert.equal(d.diagnosis_session_id, rec);
  await ctx.db.close();
});

test('応答・ログ：固有リンクの秘密値は購入完了ページ（Cookie の持ち主）の応答だけ。注文 ID・Stripe ID・メール・診断コードを出さない', { skip }, async () => {
  const ctx = await setup();
  const { context } = await resultContext(ctx);
  await buyAndPay(ctx, context, 'analysis');
  const [p] = await purchases(ctx);
  const [order] = await ctx.rows('complete_orders');
  const all = ctx.bodies.filter((b) => !b.includes('"checkoutUrl"')).join('\n');
  assert.doesNotMatch(all, new RegExp(order.id));
  assert.doesNotMatch(all, /cs_test_|pi_|buyer@example/);
  assert.doesNotMatch(all, new RegExp(CODE_A.slice(0, 24)));
  const leaks = ctx.bodies.filter((b) => b.includes(p.link));
  assert.ok(leaks.every((b) => b.includes('"purchases"')), '秘密値は購入完了ページの応答だけ');
  assert.doesNotMatch(ctx.logger.lines.join('\n'), new RegExp(p.link));
  await ctx.db.close();
});
