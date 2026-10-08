// 完全解析の生成・非公開保存・閲覧（lib/complete-report-job.js・api/complete-status.js・api/stripe-webhook.js の後段起動）のテスト。
// 外部へは接続しない（偽の Supabase・偽の Storage・偽の Stripe）。
//   実行: node --test tests/complete_report_job.test.js
//   本物の SQL 関数（complete_01〜06）で試す場合は COMPLETE_DB_BACKEND を指定する（tests/complete_payment_api.test.js と同じ）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { PREVIEW_ENV, PROD_ENV } = require('./fixtures/server_env');
const { fakeStripe, eventRequest } = require('./fixtures/fake_stripe');
const { createMemoryBackend } = require('./fixtures/fake_supabase');
const { createFakeStorage } = require('./fixtures/fake_storage');
const { variantAnswers, SAMPLE_ANSWERS } = require('./fixtures/report_data');
const RJ = require('../lib/complete-report-job');
const CP = require('../lib/complete-payment');
const G = require('../api/_complete/generate-report');
const Checkout = require(path.join(__dirname, '..', 'api', 'complete-checkout.js'));
const Webhook = require(path.join(__dirname, '..', 'api', 'stripe-webhook.js'));
const Status = require(path.join(__dirname, '..', 'api', 'complete-status.js'));

const createBackend = process.env.COMPLETE_DB_BACKEND ? require(process.env.COMPLETE_DB_BACKEND).createBackend : createMemoryBackend;
const SECRET = 'whsec_test_fake_secret_for_unit_tests';
// 試験ごとに作る乱数（32バイト・base64url）。値は出力しない
const VIEW_SECRET = crypto.randomBytes(32).toString('base64url');
const ENV = {
  ...PREVIEW_ENV,
  COMPLETE_SALES_OPEN: 'true',
  COMPLETE_CHECKOUT_ORIGIN: 'https://element-diagnosis-git-release-c-preview-nmkw0322-4497s-projects.vercel.app',
  STRIPE_COMPLETE_PRICE_DIRECT: 'price_test_direct3000',
  STRIPE_COMPLETE_PRICE_UPGRADE: 'price_test_upgrade2000',
  STRIPE_COMPLETE_WEBHOOK_SECRET: SECRET,
  COMPLETE_VIEW_TOKEN_SECRET: VIEW_SECRET,
};
const PRICES = {
  price_test_direct3000: { id: 'price_test_direct3000', active: true, livemode: false, currency: 'jpy', unit_amount: 3000, type: 'one_time' },
  price_test_upgrade2000: { id: 'price_test_upgrade2000', active: true, livemode: false, currency: 'jpy', unit_amount: 2000, type: 'one_time' },
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function makeRes() {
  return {
    code: 0, body: undefined, raw: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.raw = Buffer.isBuffer(b) ? b : Buffer.from(String(b)); return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  };
}
function makeLogger() {
  const lines = [];
  const push = (...a) => lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return { lines, error: push, warn: push, log: push, info: push };
}

async function setup({ env = {} } = {}) {
  const db = await createBackend();
  const storage = createFakeStorage();
  const baseFetch = storage.wrap(db.fetchImpl);
  // 後段の生成は waitUntil に渡した時点で始まる。「生成の前」を確かめる試験では、取得（claim）の手前で止めておく
  let gate = null;
  const fetchImpl = async (url, opts) => {
    if (gate && String(url).includes('/rest/v1/rpc/complete_claim_report')) await gate.promise;
    return baseFetch(url, opts);
  };
  const stripe = fakeStripe({ prices: JSON.parse(JSON.stringify(PRICES)) });
  const logger = makeLogger();
  const pending = [];
  const waitUntil = (p) => { pending.push(p); };
  const fullEnv = { ...ENV, ...env };
  let clock = null;
  const now = () => (clock === null ? Date.now() : clock);
  const deps = { env: fullEnv, fetchImpl, stripeFactory: stripe.factory, logger, waitUntil, now };
  const checkoutH = Checkout.createHandler(deps);
  const webhookH = Webhook.createHandler(deps);
  // 後段起動が失われた場合（waitUntil が使えない・関数が止まった）を作るための Webhook
  const webhookNoBg = Webhook.createHandler({ ...deps, waitUntil: null });
  const statusH = Status.createHandler(deps);
  // 試験の終わりに、後段の生成を全て終えてから DB を閉じる（次の試験へ持ち越さない）
  const closeDb = db.close.bind(db);
  db.close = async () => {
    if (gate) { gate.release(); gate = null; }
    while (pending.length) await pending.shift();
    await closeDb();
  };
  const conn = { supabaseUrl: fullEnv.SUPABASE_URL, adminHeaders: () => ({ apikey: fullEnv.SUPABASE_SECRET_KEY }) };
  const ctx = {
    db, storage, stripe, logger, pending, env: fullEnv, conn, fetchImpl,
    setClock(ms) { clock = ms; },
    holdClaims() { let release; gate = { promise: new Promise((r) => { release = r; }) }; gate.release = release; },
    releaseClaims() { const g = gate; gate = null; if (g) g.release(); },
    async drain() { while (pending.length) await pending.shift(); },
    async person({ email = 'buyer@example.test', answers = SAMPLE_ANSWERS, goal = 'GOAL_PACE_01' } = {}) {
      const token = `tok-${crypto.randomBytes(6).toString('hex')}`;
      const userId = await db.user({ email, token });
      const sessionId = await db.record({ userId, answers, goal });
      return { token, userId, sessionId };
    },
    async checkout(p) {
      const res = makeRes();
      await checkoutH({ method: 'POST', headers: { authorization: `Bearer ${p.token}` }, body: { diagnosisSessionId: p.sessionId } }, res);
      return res;
    },
    async webhook(opts, { background = true } = {}) {
      const { req, event } = eventRequest({ secret: SECRET, ...opts });
      const res = makeRes();
      await (background ? webhookH : webhookNoBg)(req, res);
      res.event = event;
      return res;
    },
    async status(p, { method = 'GET', sessionId = p.sessionId } = {}) {
      const res = makeRes();
      const req = method === 'GET'
        ? { method, headers: { authorization: `Bearer ${p.token}` }, query: { diagnosisSessionId: sessionId } }
        : { method, headers: { authorization: `Bearer ${p.token}` }, body: { diagnosisSessionId: sessionId } };
      await statusH(req, res);
      return res;
    },
    async view(urlOrToken) {
      const token = urlOrToken.startsWith('/api/') ? new URL(urlOrToken, 'https://x').searchParams.get('view') : urlOrToken;
      const res = makeRes();
      await statusH({ method: 'GET', headers: {}, query: { view: token } }, res);
      return res;
    },
    async reports() { return db.rows('complete_reports'); },
    process(opts = {}) { return RJ.processReport({ conn, fetchImpl, logger, ...opts }); },
  };
  return ctx;
}

// 支払いまで進める（Checkout → Stripe で支払い → Webhook 支払い確定）。生成は waitUntil に積まれる（まだ実行しない）
async function paid(ctx, p, { background = true } = {}) {
  const r = await ctx.checkout(p);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const csId = r.body.checkoutUrl.split('/').pop();
  const pay = ctx.stripe.pay(csId);
  const w = await ctx.webhook({ type: 'checkout.session.completed', objectId: csId }, { background });
  assert.deepEqual([w.code, w.body], [200, { received: true, result: 'processed' }]);
  return { csId, ...pay };
}
const reportOf = async (ctx, p) => (await ctx.reports()).find((r) => r.diagnosis_session_id === p.sessionId);

// ================= 後段起動・生成・保存
test('Webhook は生成の完了を待たずに応答し、応答の後で生成する（queued → ready・非公開 Storage に1つだけ保存）', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  ctx.holdClaims();
  await paid(ctx, p);
  // 応答の時点ではまだ queued（生成は waitUntil に渡されただけで、応答はそれを待たない）
  assert.equal((await reportOf(ctx, p)).status, 'queued');
  assert.equal(ctx.pending.length, 1);
  assert.equal(ctx.storage.objects.size, 0);
  ctx.releaseClaims();
  await ctx.drain();
  const rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'ready');
  assert.equal(rep.attempts, 1);
  assert.match(rep.storage_path, new RegExp(`^reports/${rep.id}/1-[0-9a-f]{32}\\.html$`));
  assert.deepEqual([...ctx.storage.objects.keys()], [rep.storage_path]);
  const obj = ctx.storage.objects.get(rep.storage_path);
  // Storage 上の MIME は bucket の許可と同じ text/html（charset は閲覧の応答だけ）
  assert.equal(obj.contentType, 'text/html');
  assert.equal(RJ.UPLOAD_CONTENT_TYPE, 'text/html');
  assert.equal(sha(obj.body), rep.output_sha256);
  // 保存物は生成器の出力と同じ（DB の保存値だけから作る）
  const { input } = await RJ.loadGenerationInput(ctx.fetchImpl, ctx.conn, rep.id);
  const out = G.generateCompleteReport(input);
  assert.equal(out.sha256, rep.output_sha256);
  assert.equal(out.inputSha256, rep.input_sha256);
  assert.equal(rep.lease_token, null);
  await ctx.db.close();
});

test('同時生成：同じ生成物を2つ同時に処理しても生成は1回だけ（lease）。ready の後の再実行は何もしない', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false });
  const rep0 = await reportOf(ctx, p);
  const results = await Promise.all([ctx.process({ reportId: rep0.id }), ctx.process({ reportId: rep0.id }), ctx.process({ reportId: null })]);
  assert.deepEqual(results.filter((r) => r === 'ready').length, 1, JSON.stringify(results));
  assert.ok(results.every((r) => r === 'ready' || r === 'none'));
  const rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'ready');
  assert.equal(rep.attempts, 1);
  assert.equal(ctx.storage.objects.size, 1);
  assert.equal(await ctx.process({ reportId: rep.id }), 'none');
  assert.equal(await ctx.process(), 'none');
  assert.equal(ctx.storage.objects.size, 1);
  assert.equal((await reportOf(ctx, p)).storage_path, rep.storage_path);
  await ctx.db.close();
});

test('途中失敗：保存の失敗は failed（再試行時刻あり）で中途半端な物を残さない。時刻が来れば再実行で ready', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false });
  const id = (await reportOf(ctx, p)).id;
  ctx.storage.failNext('upload');
  assert.equal(await ctx.process({ reportId: id }), 'failed');
  let rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'failed');
  assert.equal(rep.last_error_code, 'storage_unavailable');
  assert.ok(Date.parse(rep.next_retry_at) > Date.now());
  assert.equal(ctx.storage.objects.size, 0);
  assert.equal(await ctx.process({ reportId: id }), 'none', '再試行時刻の前は取得しない');
  // 保存の後に DB の完了記録が失敗：保存した物を消して failed
  await ctx.db.patch('complete_reports', id, { next_retry_at: new Date(Date.now() - 1000).toISOString() });
  ctx.db.failNext('rpc:complete_finish_report');
  assert.equal(await ctx.process({ reportId: id }), 'failed');
  assert.equal(ctx.storage.objects.size, 0, '完了の記録に失敗した保存物は消す');
  rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'failed');
  assert.equal(rep.attempts, 2);
  await ctx.db.patch('complete_reports', id, { next_retry_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await ctx.process({ reportId: id }), 'ready');
  rep = await reportOf(ctx, p);
  assert.equal(rep.attempts, 3);
  assert.deepEqual([...ctx.storage.objects.keys()], [rep.storage_path]);
  assert.match(rep.storage_path, new RegExp(`^reports/${id}/3-`));
  await ctx.db.close();
});

test('中断した試行の残り（lease の切れた generating・保存物あり）は、次の取得で消してから作り直す', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false });
  const id = (await reportOf(ctx, p)).id;
  // 1回目：保存の直後に処理が止まった（完了を記録しないまま）
  let crashed = false;
  await assert.rejects(ctx.process({ reportId: id, hooks: { afterUpload: async () => { crashed = true; throw Object.assign(new Error('crash'), { hard: true }); } } })
    .then((r) => { if (r === 'failed') throw new Error('handled'); return r; }), /handled/);
  assert.ok(crashed);
  // 上の経路は例外を捕まえて保存物を消す。ここでは「消す前に処理ごと止まった」状態を直接作る
  const stale = `reports/${id}/1-${'a'.repeat(32)}.html`;
  ctx.storage.objects.set(stale, { body: Buffer.from('<html>partial'), contentType: 'text/html' });
  await ctx.db.patch('complete_reports', id, { status: 'generating', lease_token: crypto.randomUUID(), lease_expires_at: new Date(Date.now() - 1000).toISOString(), next_retry_at: null });
  assert.equal(await ctx.process({ reportId: id }), 'ready');
  const rep = await reportOf(ctx, p);
  assert.deepEqual([...ctx.storage.objects.keys()], [rep.storage_path]);
  assert.ok(!ctx.storage.objects.has(stale));
  await ctx.db.close();
});

test('生成中に lease が切れて別の処理が完了した：遅れた側は ready にせず、自分の保存物を消す', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false });
  const id = (await reportOf(ctx, p)).id;
  let resultB = null;
  assert.equal(ctx.pending.length, 0);
  const resultA = await ctx.process({ reportId: id, hooks: { afterUpload: async () => {
    await ctx.db.patch('complete_reports', id, { lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    resultB = await ctx.process({ reportId: id });
  } } });
  assert.equal(resultB, 'ready');
  assert.equal(resultA, 'lost_lease');
  const rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'ready');
  assert.deepEqual([...ctx.storage.objects.keys()], [rep.storage_path]);
  await ctx.db.close();
});

test('生成中に返金で失効：ready にせず保存物を消す（revoked のまま）', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  const { chargeId } = await paid(ctx, p, { background: false });
  const id = (await reportOf(ctx, p)).id;
  const r = await ctx.process({ reportId: id, hooks: { afterUpload: async () => {
    ctx.stripe.refund(chargeId, 3000);
    assert.equal((await ctx.webhook({ type: 'charge.refunded', objectId: chargeId })).code, 200);
  } } });
  assert.equal(r, 'revoked');
  const rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'revoked');
  assert.equal(rep.storage_path, null);
  assert.equal(ctx.storage.objects.size, 0);
  assert.equal(await ctx.process({ reportId: id }), 'none');
  await ctx.db.close();
});

test('再試行しない失敗：素材・入力のハッシュが凍結値と違えば stopped（attempts を上限にして止める）', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false });
  const id = (await reportOf(ctx, p)).id;
  await ctx.db.patch('complete_reports', id, { input_sha256: 'f'.repeat(64) });
  assert.equal(await ctx.process({ reportId: id }), 'stopped');
  let rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'failed');
  assert.equal(rep.last_error_code, 'input_mismatch');
  assert.equal(rep.attempts, rep.max_attempts);
  assert.equal(rep.next_retry_at, null);
  assert.equal(ctx.storage.objects.size, 0);
  assert.equal(await ctx.process({ reportId: id }), 'none');
  // 素材の版が違う
  const q = await ctx.person({ email: 'q@example.test', answers: variantAnswers(1) });
  await paid(ctx, q, { background: false });
  const qid = (await reportOf(ctx, q)).id;
  await ctx.db.patch('complete_reports', qid, { template_sha256: '0'.repeat(64) });
  assert.equal(await ctx.process({ reportId: qid }), 'stopped');
  rep = await reportOf(ctx, q);
  assert.equal(rep.last_error_code, 'materials_changed');
  await ctx.db.close();
});

test('一時的な失敗を max_attempts 回くり返すと止まる（それ以上取得しない）', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false });
  const id = (await reportOf(ctx, p)).id;
  const results = [];
  for (let i = 0; i < 5; i++) {
    ctx.storage.failNext('upload');
    results.push(await ctx.process({ reportId: id }));
    await ctx.db.patch('complete_reports', id, { next_retry_at: new Date(Date.now() - 1000).toISOString() });
  }
  assert.deepEqual(results, ['failed', 'failed', 'failed', 'failed', 'stopped']);
  assert.equal(await ctx.process({ reportId: id }), 'none');
  assert.equal(ctx.storage.objects.size, 0);
  await ctx.db.close();
});

// ================= 状態確認での取り残しの回収
test('状態確認（GET）で取り残し（queued）を見つけたら、応答の後で生成する。ready なら何もしない', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p, { background: false }); // Webhook の後段起動が失われた
  let r = await ctx.status(p);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.report, { status: 'queued' });
  assert.equal(ctx.pending.length, 1);
  await ctx.drain();
  assert.equal((await reportOf(ctx, p)).status, 'ready');
  r = await ctx.status(p);
  assert.deepEqual(r.body.report, { status: 'ready' });
  assert.equal(ctx.pending.length, 0, 'ready なら回収しない');
  // lease の切れた generating も回収する
  const q = await ctx.person({ email: 'q@example.test', answers: variantAnswers(2) });
  await paid(ctx, q, { background: false });
  const qid = (await reportOf(ctx, q)).id;
  await ctx.db.patch('complete_reports', qid, { status: 'generating', attempts: 1, lease_token: crypto.randomUUID(), lease_expires_at: new Date(Date.now() - 1000).toISOString() });
  await ctx.status(q);
  assert.equal(ctx.pending.length, 1);
  await ctx.drain();
  assert.equal((await reportOf(ctx, q)).status, 'ready');
  // 他人・未認証の状態確認では回収を始めない（本人の記録を確かめた後だけ）
  const o = await ctx.person({ email: 'o@example.test', answers: variantAnswers(6) });
  await paid(ctx, o, { background: false });
  const stranger = await ctx.person({ email: 'stranger@example.test', answers: variantAnswers(7) });
  const sr = await ctx.status(stranger, { sessionId: o.sessionId });
  assert.deepEqual([sr.code, sr.body], [404, { error: 'record_not_found' }]);
  const anon = makeRes();
  await Status.createHandler({ env: ctx.env, fetchImpl: ctx.fetchImpl, logger: ctx.logger, waitUntil: (pp) => ctx.pending.push(pp) })({ method: 'GET', headers: {}, query: { diagnosisSessionId: o.sessionId } }, anon);
  assert.equal(anon.code, 401);
  assert.equal(ctx.pending.length, 0);
  assert.equal((await reportOf(ctx, o)).status, 'queued');
  await ctx.status(o);
  assert.equal(ctx.pending.length, 1);
  await ctx.drain();
  // 再試行時刻の前の failed は回収しない
  const s = await ctx.person({ email: 's@example.test', answers: variantAnswers(3) });
  await paid(ctx, s, { background: false });
  ctx.storage.failNext('upload');
  await ctx.process({ reportId: (await reportOf(ctx, s)).id });
  await ctx.status(s);
  assert.equal(ctx.pending.length, 0);
  await ctx.db.close();
});

// ================= 閲覧 URL の発行（POST）と閲覧（GET ?view=）
test('閲覧 URL：本人確認の後に発行（300秒）。応答に保存先・注文 ID・user ID・report ID を出さない。開くと保存物そのものを返す', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  ctx.holdClaims();
  await paid(ctx, p);
  // 生成前：409 report_not_ready（取り残しの回収も始める）
  let r = await ctx.status(p, { method: 'POST' });
  assert.deepEqual([r.code, r.body], [409, { error: 'report_not_ready' }]);
  ctx.releaseClaims();
  await ctx.drain();
  r = await ctx.status(p, { method: 'POST' });
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['expiresIn', 'viewUrl']);
  assert.equal(r.body.expiresIn, 300);
  assert.match(r.body.viewUrl, /^\/api\/complete-status\?view=[A-Za-z0-9_-]+$/);
  const rep = await reportOf(ctx, p);
  const order = (await ctx.db.rows('complete_orders')).find((o) => o.diagnosis_session_id === p.sessionId);
  for (const secret of [rep.storage_path, rep.id, order.id, p.userId, p.sessionId, 'reports/', 'complete-reports']) {
    assert.ok(!JSON.stringify(r.body).includes(secret), secret);
  }
  // トークンの中身は読めない（base64url を開いても ID が出ない）
  const token = new URL(r.body.viewUrl, 'https://x').searchParams.get('view');
  const opened = Buffer.from(token, 'base64url').toString('latin1');
  for (const s of [rep.id, p.userId, p.sessionId]) assert.ok(!opened.includes(s));
  const v = await ctx.view(r.body.viewUrl);
  assert.equal(v.code, 200);
  assert.equal(Buffer.compare(v.raw, ctx.storage.objects.get(rep.storage_path).body), 0);
  assert.equal(v.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(v.headers['content-security-policy'], /default-src 'none'.*script-src 'none'.*frame-ancestors 'none'; sandbox/);
  assert.equal(v.headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(v.headers['referrer-policy'], 'no-referrer');
  assert.equal(v.headers['x-content-type-options'], 'nosniff');
  assert.match(v.headers['cache-control'], /^private, no-store/);
  // 生成 HTML の CSP の指示を全て含み、さらに frame-ancestors・sandbox を加える
  for (const d of G.CSP.split(';').map((x) => x.trim()).filter(Boolean)) assert.ok(v.headers['content-security-policy'].split('; ').includes(d), d);
  assert.equal(v.headers['x-frame-options'], 'DENY');
  assert.match(v.headers['x-robots-tag'], /noindex/);
  // 発行のたびに別のトークン
  const r2 = await ctx.status(p, { method: 'POST' });
  assert.notEqual(r2.body.viewUrl, r.body.viewUrl);
  await ctx.db.close();
});

test('期限切れ（300秒後）・改ざん・形式違反のトークンは開けない（DB・Storage へ接続しない）', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p);
  await ctx.drain();
  const t0 = Date.now();
  ctx.setClock(t0);
  const r = await ctx.status(p, { method: 'POST' });
  const token = new URL(r.body.viewUrl, 'https://x').searchParams.get('view');
  ctx.setClock(t0 + 299 * 1000);
  assert.equal((await ctx.view(token)).code, 200);
  ctx.setClock(t0 + 301 * 1000);
  const expired = await ctx.view(token);
  assert.deepEqual([expired.code, expired.body.error], [410, 'view_link_expired']);
  // エラー応答・照合 ID・ログにトークンを含めない
  assert.deepEqual(Object.keys(expired.body).sort(), ['error', 'incident_id']);
  assert.ok(!JSON.stringify(expired.body).includes(token.slice(0, 16)));
  assert.ok(!ctx.logger.lines.some((l) => l.includes(token.slice(0, 16))));
  ctx.setClock(t0);
  const buf = Buffer.from(token, 'base64url');
  buf[20] ^= 1;
  const before = ctx.storage.calls.length;
  for (const bad of [buf.toString('base64url'), `${token}x`, 'short', '', 'a'.repeat(500), token.slice(0, -2)]) {
    const v = await ctx.view(bad);
    assert.equal(v.code, 403, bad.slice(0, 10));
    assert.equal(v.body.error, 'view_link_invalid');
  }
  assert.equal(ctx.storage.calls.length, before);
  // 別の秘密値で作ったトークンは開けない
  const other = RJ.issueViewToken(crypto.randomBytes(32).toString('base64url'), { reportId: crypto.randomUUID(), userId: p.userId, sessionId: p.sessionId });
  assert.equal((await ctx.view(other.token)).code, 403);
  await ctx.db.close();
});

test('別ユーザー：他人の記録の URL は発行できず、自分のトークンで他人の生成物は開けない', async () => {
  const ctx = await setup();
  const a = await ctx.person();
  const b = await ctx.person({ email: 'b@example.test', answers: variantAnswers(4) });
  await paid(ctx, a);
  await paid(ctx, b);
  await ctx.drain();
  const r = await ctx.status(b, { method: 'POST', sessionId: a.sessionId });
  assert.deepEqual([r.code, r.body], [404, { error: 'record_not_found' }]);
  // b のトークンに a の report を入れても開けない（DB の確認は b の記録で行う）
  const aRep = await reportOf(ctx, a);
  const forged = RJ.issueViewToken(VIEW_SECRET, { reportId: aRep.id, userId: b.userId, sessionId: b.sessionId });
  assert.equal((await ctx.view(forged.token)).code, 403);
  const forged2 = RJ.issueViewToken(VIEW_SECRET, { reportId: aRep.id, userId: b.userId, sessionId: a.sessionId });
  assert.equal((await ctx.view(forged2.token)).code, 403);
  // 未認証・権利なし
  const c = await ctx.person({ email: 'c@example.test', answers: variantAnswers(5) });
  assert.deepEqual((await ctx.status(c, { method: 'POST' })).body, { error: 'not_entitled' });
  const res = makeRes();
  await Status.createHandler({ env: ctx.env, fetchImpl: ctx.fetchImpl, logger: ctx.logger, waitUntil: () => {} })({ method: 'POST', headers: {}, body: { diagnosisSessionId: a.sessionId } }, res);
  assert.equal(res.code, 401);
  await ctx.db.close();
});

test('権利失効の直後：発行済みの URL でも、返金・dispute 中・敗訴では開けない（勝訴で戻れば開ける）。発行もしない', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  const { chargeId } = await paid(ctx, p);
  await ctx.drain();
  const url = (await ctx.status(p, { method: 'POST' })).body.viewUrl;
  assert.equal((await ctx.view(url)).code, 200);
  // dispute 開始（suspended）
  const du = ctx.stripe.dispute(chargeId);
  const t0 = Math.floor(Date.now() / 1000);
  assert.equal((await ctx.webhook({ type: 'charge.dispute.created', objectId: du, created: t0 + 10 })).code, 200);
  assert.deepEqual([(await ctx.view(url)).code, (await ctx.view(url)).body.error], [403, 'not_entitled']);
  assert.deepEqual((await ctx.status(p, { method: 'POST' })).body, { error: 'not_entitled' });
  // 勝訴：開ける
  ctx.stripe.setDispute(du, 'won');
  await ctx.webhook({ type: 'charge.dispute.closed', objectId: du, created: t0 + 20 });
  assert.equal((await ctx.view(url)).code, 200);
  // 返金：開けない
  ctx.stripe.refund(chargeId, 3000);
  await ctx.webhook({ type: 'charge.refunded', objectId: chargeId });
  assert.equal((await ctx.view(url)).code, 403);
  assert.deepEqual((await ctx.status(p, { method: 'POST' })).body, { error: 'not_entitled' });
  // ready の後の返金：保存物は消さずに隔離（quarantined_at）。アクセスはできない。物理削除は保持期間の決定後
  const rep = await reportOf(ctx, p);
  assert.ok(rep.revoked_at && rep.quarantined_at);
  assert.ok(ctx.storage.objects.has(rep.storage_path));
  assert.equal(RJ.isDue(rep), false);
  // 敗訴
  const q = await ctx.person({ email: 'q@example.test', answers: variantAnswers(6) });
  const qp = await paid(ctx, q);
  await ctx.drain();
  const qurl = (await ctx.status(q, { method: 'POST' })).body.viewUrl;
  const du2 = ctx.stripe.dispute(qp.chargeId);
  await ctx.webhook({ type: 'charge.dispute.created', objectId: du2, created: t0 + 30 });
  ctx.stripe.setDispute(du2, 'lost');
  await ctx.webhook({ type: 'charge.dispute.closed', objectId: du2, created: t0 + 40 });
  assert.equal((await ctx.view(qurl)).code, 403);
  assert.ok((await reportOf(ctx, q)).quarantined_at);
  await ctx.db.close();
});

test('保存物が記録の SHA-256 と違う（改ざん・取り違え）なら出さない。Storage の一時的な失敗は 503', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  await paid(ctx, p);
  await ctx.drain();
  const url = (await ctx.status(p, { method: 'POST' })).body.viewUrl;
  ctx.storage.failNext('download');
  assert.equal((await ctx.view(url)).code, 503);
  const rep = await reportOf(ctx, p);
  ctx.storage.objects.get(rep.storage_path).body = Buffer.from('<html>tampered</html>');
  const v = await ctx.view(url);
  assert.deepEqual([v.code, v.body.error], [500, 'report_unavailable']);
  assert.equal(v.raw, undefined);
  await ctx.db.close();
});

test('設定不足・Production：閲覧の秘密値が無ければ 503、Production では発行も閲覧も 404', async () => {
  const ctx = await setup({ env: { COMPLETE_VIEW_TOKEN_SECRET: undefined } });
  const p = await ctx.person();
  await paid(ctx, p);
  await ctx.drain();
  assert.equal((await ctx.status(p, { method: 'POST' })).code, 503);
  assert.equal((await ctx.view('a'.repeat(80))).code, 503);
  // 32文字の文字列（32バイトの乱数ではない）は不可。発行も閲覧も 503（fail-closed）
  const short = await setup({ env: { COMPLETE_VIEW_TOKEN_SECRET: 'too-short-secret-0123456789abcde' } });
  const q = await short.person();
  await paid(short, q);
  await short.drain();
  assert.equal((await short.status(q, { method: 'POST' })).code, 503);
  assert.equal((await short.view('a'.repeat(80))).code, 503);
  for (const env of [{ ...PROD_ENV, COMPLETE_VIEW_TOKEN_SECRET: VIEW_SECRET }, { ...ENV, VERCEL_ENV: undefined }]) {
    const calls = [];
    const h = Status.createHandler({ env, fetchImpl: async (u) => { calls.push(u); throw new Error('no network'); }, logger: makeLogger(), waitUntil: () => {} });
    for (const req of [{ method: 'POST', headers: { authorization: 'Bearer x' }, body: { diagnosisSessionId: p.sessionId } }, { method: 'GET', headers: {}, query: { view: 'a'.repeat(80) } }]) {
      const res = makeRes();
      await h(req, res);
      assert.deepEqual([res.code, res.body], [404, { error: 'not_available' }]);
    }
    assert.deepEqual(calls, []);
  }
  await ctx.db.close();
  await short.db.close();
});

test('ログ・応答：保存先・注文 ID・user ID・report ID・記録 ID・トークンを出さない（生成・失敗・閲覧の一連の後）', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  const { chargeId } = await paid(ctx, p);
  ctx.storage.failNext('upload');
  await ctx.drain();
  const id = (await reportOf(ctx, p)).id;
  await ctx.db.patch('complete_reports', id, { next_retry_at: new Date(Date.now() - 1000).toISOString() });
  const responses = [(await ctx.status(p)).body];
  await ctx.drain();
  const issued = await ctx.status(p, { method: 'POST' });
  responses.push(issued.body);
  responses.push((await ctx.view('bad-token-' + 'x'.repeat(60))).body);
  ctx.stripe.refund(chargeId, 3000);
  await ctx.webhook({ type: 'charge.refunded', objectId: chargeId });
  responses.push((await ctx.view(issued.body.viewUrl)).body);
  responses.push((await ctx.status(p)).body);
  const rep = await reportOf(ctx, p);
  const order = (await ctx.db.rows('complete_orders')).find((o) => o.diagnosis_session_id === p.sessionId);
  const token = new URL(issued.body.viewUrl, 'https://x').searchParams.get('view');
  const logs = ctx.logger.lines.join('\n');
  assert.ok(ctx.logger.lines.length > 0);
  for (const line of ctx.logger.lines) assert.match(line, /^(complete-status|complete-report|stripe-webhook|complete-checkout) error: [a-z_]+ [0-9a-f]{12}$/, line);
  for (const s of [rep.storage_path || `reports/${rep.id}`, rep.id, order.id, p.userId, p.sessionId, token, 'reports/', '@']) {
    assert.ok(!logs.includes(s), `ログに ${s}`);
  }
  const bodies = JSON.stringify(responses.slice(0, 1).concat(responses.slice(2)));
  for (const s of [rep.id, order.id, p.userId, p.sessionId, 'reports/']) assert.ok(!bodies.includes(s), `応答に ${s}`);
  await ctx.db.close();
});

// ================= 単体
test('閲覧トークン：期限は300秒・中身は暗号化・改ざんは拒否・秘密値ごとに別', () => {
  const ids = { reportId: crypto.randomUUID(), userId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const t0 = 1_800_000_000;
  const { token, expiresAt } = RJ.issueViewToken(VIEW_SECRET, ids, t0);
  assert.equal(expiresAt, t0 + 300);
  assert.deepEqual(RJ.readViewToken(VIEW_SECRET, token, t0), { ok: true, ...ids, expiresAt: t0 + 300 });
  assert.equal(RJ.readViewToken(VIEW_SECRET, token, t0 + 300).ok, true);
  assert.equal(RJ.readViewToken(VIEW_SECRET, token, t0 + 301).reason, 'token_expired');
  assert.equal(RJ.readViewToken(crypto.randomBytes(32).toString('base64url'), token, t0).reason, 'token_invalid');
  assert.equal(RJ.readViewToken(VIEW_SECRET, token, t0 - 10).reason, 'token_invalid', '未来の発行時刻（時計のずれ以上）は拒否');
  const raw = Buffer.from(token, 'base64url').toString('latin1');
  for (const v of Object.values(ids)) assert.ok(!raw.includes(v));
  // 秘密値：32バイト以上の base64url（43文字以上）だけ。32文字の文字列・パディング・base64url 以外の文字は不可
  assert.equal(RJ.viewSecretOk(crypto.randomBytes(32).toString('base64url')), true);
  assert.equal(RJ.viewSecretOk(crypto.randomBytes(48).toString('base64url')), true);
  assert.equal(RJ.viewSecretOk(crypto.randomBytes(31).toString('base64url')), false);
  assert.equal(RJ.viewSecretOk(crypto.randomBytes(32).toString('base64url').slice(0, 42)), false);
  assert.equal(RJ.viewSecretOk('x'.repeat(32)), false);
  assert.equal(RJ.viewSecretOk(crypto.randomBytes(32).toString('base64')), false);
  assert.equal(RJ.viewSecretOk(`${crypto.randomBytes(32).toString('base64url')}!`), false);
  assert.equal(RJ.viewSecretOk(undefined), false);
  assert.equal(RJ.isDue({ status: 'ready' }), false);
  assert.equal(RJ.isDue({ status: 'revoked' }), false);
  assert.equal(RJ.isDue({ status: 'queued' }), true);
  assert.equal(RJ.isDue({ status: 'failed', attempts: 5, max_attempts: 5, next_retry_at: new Date(0).toISOString() }), false);
  assert.match(RJ.objectKey(ids.reportId, 2), new RegExp(`^reports/${ids.reportId}/2-[0-9a-f]{32}\\.html$`));
  assert.ok(RJ.OBJECT_KEY_RE.test(RJ.objectKey(ids.reportId, 12)));
});

test('Webhook の応答は生成を待たない：後段起動が失敗しても 200 で、状態確認で回収できる', async () => {
  const ctx = await setup();
  const p = await ctx.person();
  ctx.storage.failNext('list');
  await paid(ctx, p);
  await ctx.drain();
  let rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'failed');
  await ctx.db.patch('complete_reports', rep.id, { next_retry_at: new Date(Date.now() - 1000).toISOString() });
  await ctx.status(p);
  await ctx.drain();
  rep = await reportOf(ctx, p);
  assert.equal(rep.status, 'ready');
  await ctx.db.close();
});
