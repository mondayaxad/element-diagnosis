// 旧版（element-v1）の解析レポート ¥1,000 の販売再開（2026-10-29）：/api/verify が購入権を1行だけ記録する。
//   現在の診断（v2_）・形の不正な診断コードでは記録しない。外部へは接続しない（Stripe・Supabase は差し替え）。
//   実行: node --test tests/legacy_report_sales_api.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { PREVIEW_ENV } = require('./fixtures/server_env');
const verify = require(path.join(__dirname, '..', 'api', 'verify.js'));

const TEST_CORE1_PRICE = 'price_1UINCK0IX2Svp0V39HaCB7WJ';
const CODE = 'psyya13lbcplrkxvj9cbhmxc0h5o4e30zdg12h9o8ngo8';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { if (b !== undefined) this.body = b; },
  };
}
// 状態を持つ偽の Supabase：POST した行を、あとの検索で返す（on_conflict の ignore-duplicates も再現）
function statefulSupabase({ failPost = false } = {}) {
  const rows = [], posts = [];
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('/rest/v1/purchase_entitlements') && opts.method === 'POST') {
      posts.push({ url, prefer: opts.headers.Prefer, row: JSON.parse(opts.body)[0] });
      if (failPost) return json(500, {});
      const row = JSON.parse(opts.body)[0];
      if (!rows.some((r) => r.stripe_checkout_session_id === row.stripe_checkout_session_id)) rows.push({ id: 'ent-' + rows.length, ...row });
      return json(201, []);
    }
    if (url.includes('/rest/v1/purchase_entitlements')) {
      const sid = decodeURIComponent((url.match(/stripe_checkout_session_id=eq\.([^&]+)/) || [])[1] || '');
      return json(200, rows.filter((r) => r.stripe_checkout_session_id === sid));
    }
    if (/\/rest\/v1\/(record_entitlements|complete_orders|record_mentor_goals|complete_reports|complete_legacy_bindings|legacy_access_blocks|diagnosis_sessions)\?/.test(url)) return json(200, []);
    throw new Error('unexpected fetch ' + url);
  };
  return { rows, posts, fetchImpl };
}
function stripeWith(reference, { amount = 1000, price = TEST_CORE1_PRICE } = {}) {
  return () => ({ checkout: { sessions: { retrieve: async (id) => ({
    id, livemode: false, payment_status: 'paid', client_reference_id: reference, currency: 'jpy', amount_total: amount,
    payment_intent: 'pi_fake', line_items: { data: [{ price: { id: price } }] },
  }) } } });
}
async function run(sb, reference, sid = 'cs_test_legacyflow000001') {
  const res = makeRes();
  const orig = console.error; console.error = () => {};
  try {
    await verify.createHandler({ env: PREVIEW_ENV, fetchImpl: sb.fetchImpl, stripeFactory: stripeWith(reference) })(
      { method: 'GET', query: { session_id: sid }, headers: {} }, res);
  } finally { console.error = orig; }
  return res;
}

test('旧版の支払い済み Session：購入権を1行記録し、レポートへ移動する（診断コードは平文でURLに出さない）', async () => {
  const sb = statefulSupabase();
  const res = await run(sb, CODE);
  assert.ok(res.code === 302 || res.code === 303 || res.headers.Location, `redirect: ${res.code}`);
  assert.equal(sb.posts.length, 1);
  const row = sb.posts[0].row;
  assert.equal(row.product_type, 'core1');
  assert.equal(row.amount, 1000);
  assert.equal(row.currency, 'jpy');
  assert.equal(row.status, 'active');
  assert.equal(row.stripe_checkout_session_id, 'cs_test_legacyflow000001');
  assert.equal(row.diagnosis_code_hash, crypto.createHash('sha256').update(CODE).digest('hex'));
  assert.match(sb.posts[0].url, /on_conflict=stripe_checkout_session_id/);
  assert.match(sb.posts[0].prefer, /ignore-duplicates/);
  assert.ok(!JSON.stringify(row).includes(CODE), '行に診断コードの平文を入れない');
  assert.ok(!String(res.headers.Location || '').includes(CODE));
});

test('同じ Session を再度開いても、行は増えない（冪等）。別の人が同じ URL を開いても、同じ結果', async () => {
  const sb = statefulSupabase();
  await run(sb, CODE);
  const again = await run(sb, CODE);
  assert.equal(sb.rows.length, 1);
  assert.equal(sb.posts.length, 1, '2回目は記録しない');
  assert.ok(again.code === 302 || again.code === 303 || again.headers.Location);
});

test('現在の診断（v2_）の支払いは、ここでは記録しない（410）', async () => {
  const sb = statefulSupabase();
  const res = await run(sb, 'v2_' + CODE);
  assert.equal(res.code, 410);
  assert.equal(sb.posts.length, 0);
});

test('診断コードの形が不正（記号・短すぎ・大文字）なら、記録せず 400', async () => {
  for (const bad of ['abc', 'A'.repeat(30), CODE + '!', '../' + CODE]) {
    const sb = statefulSupabase();
    const res = await run(sb, bad);
    assert.equal(res.code, 400, bad);
    assert.equal(sb.posts.length, 0, bad);
  }
});

test('記録に失敗したら 503（お支払いは完了している旨）。閲覧リンクは出さない', async () => {
  const sb = statefulSupabase({ failPost: true });
  const res = await run(sb, CODE);
  assert.equal(res.code, 503);
  assert.match(String(res.body), /お支払いは完了しています/);
  assert.equal(res.headers.Location, undefined);
});
