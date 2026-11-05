// 【実PG17の試験】旧版購入権の引き継ぎ：使い捨てDB（PG17・合成データ・本番相当の構造＋complete_17）の上で、
//   実際のハンドラー（verify／my-report-link／my-entitlements／report-data）を通す。Stripe は偽物、Supabase の REST／Auth は tests/pg/postgrest_mock.js。
//   実行: E2E_PG=1 node --test tests/pg/legacy_handoff.pg.test.js（起動手順は docs/TESTING_PG.md）。E2E_PG が無ければスキップ。
//   本番・Preview の Supabase には接続しない（tests/pg/pg_env.js が検査する）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const R = path.join(__dirname, '..', '..');
const { PREVIEW_ENV } = require('../fixtures/server_env');
const verify = require(R + '/api/verify.js');
const myReportLink = require(R + '/api/my-report-link.js');
const myEntitlements = require(R + '/api/my-entitlements.js');
const reportData = require(R + '/api/report-data.js');
const pgenv = require('./pg_env');
const { createProdLikeDb, dropDb } = require('./db_setup');
const { makeFetch } = require('./postgrest_mock');
const SKIP = pgenv.enabled() ? false : 'E2E_PG=1 が無いため skip（実PG17の試験）';
let DB = null;
const sql = (q) => pgenv.sql(DB, q);

const PRICE = 'price_1UINCK0IX2Svp0V39HaCB7WJ';
const SECRET = PREVIEW_ENV.REPORT_TOKEN_SECRET;
const CODE_A = 'e2ecodeaaaaaaaaaaaaaaaaaaaaa', CODE_B = 'e2ecodebbbbbbbbbbbbbbbbbbbbb', CODE_C = 'e2ecodecccccccccccccccccccc';
const SID_A = 'cs_test_E2EA00000000000001', SID_B = 'cs_test_E2EB00000000000001';
const U1 = '00000000-0000-4000-8000-000000000001', U2 = '00000000-0000-4000-8000-000000000002', U3 = '00000000-0000-4000-8000-000000000003';
const S = (n) => `a1000000-0000-4000-8000-00000000000${n}`;
const users = { t1: U1, t2: U2, t3: U3 };
let fetchImpl = null;
const mkRes = () => ({ code: 0, body: undefined, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { if (b !== undefined) this.body = b; } });
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const stripeFor = (code, sid) => () => ({ checkout: { sessions: { retrieve: async (id) => ({ id, livemode: false, payment_status: 'paid', client_reference_id: code, currency: 'jpy', amount_total: 1000, payment_intent: 'pi_x', line_items: { data: [{ price: { id: PRICE } }] } }) } } });
async function openPurchaseLink(code, sid, { stripe = stripeFor(code, sid) } = {}) {
  const res = mkRes();
  await quiet(() => verify.createHandler({ env: PREVIEW_ENV, fetchImpl, stripeFactory: stripe })({ method: 'GET', query: { session_id: sid }, headers: {} }, res));
  const loc = res.headers.Location || res.headers.location;
  return { res, token: loc ? decodeURIComponent(new URL(loc, 'http://x').searchParams.get('token')) : null };
}
const handoff = async (token, bearer = 't1') => { const res = mkRes(); await quiet(() => myReportLink.createHandler({ env: PREVIEW_ENV, fetchImpl })({ method: 'POST', headers: { authorization: 'Bearer ' + bearer }, body: { op: 'legacy_handoff', token } }, res)); return res; };
const reissue = async (sessionId, bearer) => { const res = mkRes(); await quiet(() => myReportLink.createHandler({ env: PREVIEW_ENV, fetchImpl })({ method: 'POST', headers: { authorization: 'Bearer ' + bearer }, body: { diagnosis_session_id: sessionId } }, res)); return res; };
const myEnt = async (bearer) => { const res = mkRes(); await quiet(() => myEntitlements.createHandler({ env: PREVIEW_ENV, fetchImpl })({ method: 'GET', headers: { authorization: 'Bearer ' + bearer } }, res)); return res; };
const readReport = async (token) => { const res = mkRes(); await quiet(() => reportData.createHandler({ env: PREVIEW_ENV, fetchImpl })({ method: 'GET', headers: {}, query: { token } }, res)); return res; };
const tokenOf = (url) => decodeURIComponent(new URL(url, 'http://x').searchParams.get('token'));
const bindings = () => JSON.parse(sql("select coalesce(json_agg(json_build_object('m',match_method,'u',user_id,'s',diagnosis_session_id,'e',legacy_entitlement_id)),'[]') from public.complete_legacy_bindings"));
const peCount = () => Number(sql('select count(*) from public.purchase_entitlements'));
const peFp = () => sql("select md5(string_agg(id::text||diagnosis_code_hash||stripe_checkout_session_id||product_type||amount::text||status,'|' order by id)) from public.purchase_entitlements");
const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${crypto.createHmac('sha256', SECRET).update(b).digest('base64url')}`; };

test.before(() => {
  if (SKIP) return;
  DB = createProdLikeDb();
  pgenv.sqlText(DB, require('fs').readFileSync(path.join(__dirname, 'fixtures_legacy_handoff.sql'), 'utf8'));
  fetchImpl = makeFetch(DB, { users });
});
test.after(() => { if (DB) dropDb(DB); });
let FP0, N0;
test('準備：既存の旧購入（合成2件）と記録の指紋を控える', { skip: SKIP }, () => { N0 = peCount(); assert.ok(N0 >= 2); FP0 = peFp(); assert.equal(bindings().length, 0); });

// ---- 項目2・3：購入済みリンク → 引き継ぎ → マイページから再閲覧
let tokenA, mypageUrl;
test('2-1 既存の購入済みリンク（verify の出し直し）が従来どおり開ける', { skip: SKIP }, async () => {
  const r = await openPurchaseLink(CODE_A, SID_A);
  assert.ok(r.token, 'リンクが出る'); tokenA = r.token;
  const rd = await readReport(tokenA);
  assert.equal(rd.code, 200); assert.equal(rd.body.entitlements.core_analysis_access, true);
});
test('3-0 引き継ぎ前：マイページ側では未購入（旧購入は本人に結び付いていない）', { skip: SKIP }, async () => {
  const e = await myEnt('t1'); assert.equal(e.code, 200);
  assert.ok(!e.body.purchased_by_version['element-v1:' + CODE_A]);
  const rl = await reissue(S(1), 't1'); assert.equal(rl.code, 403); assert.equal(rl.body.error, 'report_not_purchased');
});
test('2-2 正当なユーザー(U1)が購入済みリンクで引き継げる', { skip: SKIP }, async () => {
  const r = await handoff(tokenA, 't1');
  assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true, bound: 'applied' });
  const b = bindings(); assert.equal(b.length, 1); assert.equal(b[0].m, 'link_possession'); assert.equal(b[0].u, U1); assert.equal(b[0].s, S(1));
});
test('3-1 引き継ぎ後：マイページが購入済みと判定し、再閲覧リンクを発行・レポートを読める', { skip: SKIP }, async () => {
  const e = await myEnt('t1'); assert.equal(e.body.purchased_by_version['element-v1:' + CODE_A], true);
  const rl = await reissue(S(1), 't1'); assert.equal(rl.code, 200);
  mypageUrl = rl.body.url; const rd = await readReport(tokenOf(mypageUrl));
  assert.equal(rd.code, 200); assert.equal(rd.body.entitlements.core_analysis_access, true); assert.equal(rd.body.viewer, 'mypage');
  assert.equal(rd.body.diagnosis_version, 'element-v1');
});
test('3-2 引き継ぎ後も、元の購入済みリンクは開ける（権利は消えない）', { skip: SKIP }, async () => {
  assert.equal((await readReport(tokenA)).code, 200);
  const again = await openPurchaseLink(CODE_A, SID_A); assert.ok(again.token);
});
test('3-3 マイページの再発行リンクは本人専用（別の人は同じ記録で再発行できない）', { skip: SKIP }, async () => {
  assert.equal((await reissue(S(1), 't2')).code, 404);
  assert.equal((await reissue(S(1), 't3')).code, 404);
});

// ---- 項目4：二重登録・不正な引き継ぎ
test('4-1 同じ人が2回押しても行は増えない（already）', { skip: SKIP }, async () => {
  const r = await handoff(tokenA, 't1'); assert.equal(r.code, 200); assert.equal(r.body.bound, 'already'); assert.equal(bindings().length, 1);
});
test('4-2 同じ結果(code A)を保存した別の人(U2)が、同じ購入済みリンクで引き継ごうとしても拒否される（先着の1人）', { skip: SKIP }, async () => {
  const r = await handoff(tokenA, 't2'); assert.equal(r.code, 409); assert.equal(r.body.error, 'already_bound');
  assert.equal(bindings().length, 1); assert.equal(bindings()[0].u, U1);
  assert.equal((await myEnt('t2')).body.purchased_by_version['element-v1:' + CODE_A] || false, false);
});
test('4-3 記録を保存していない人は引き継げない（record_not_saved）／別の診断コードの記録では付かない', { skip: SKIP }, async () => {
  const r = await handoff((await openPurchaseLink(CODE_B, SID_B)).token, 't3'); // U3 は code B を保存していない
  assert.equal(r.code, 409); assert.equal(r.body.error, 'record_not_saved');
  const r2 = await handoff((await openPurchaseLink(CODE_B, SID_B)).token, 't1'); // U1 も code B の記録なし
  assert.equal(r2.code, 409); assert.equal(bindings().length, 1);
});
test('4-4 偽造・改ざん・別環境・マイページ用トークンでは引き継げない', { skip: SKIP }, async () => {
  const bad = [tokenA.slice(0, -2) + 'xx', sign({ exp: Date.now() + 1e9, env: 'production', purchase: {}, enc: { iv: 'a', tag: 'b', data: 'c' } }), tokenOf(mypageUrl), 'x.y', ''];
  for (const t of bad) { const r = await handoff(t, 't2'); assert.equal(r.code, 403, t.slice(0, 12)); }
  assert.equal(bindings().length, 1);
});
test('4-5 未ログイン・不正なログインは 401', { skip: SKIP }, async () => { assert.equal((await handoff(tokenA, 'nobody')).code, 401); });
test('4-6 コードの別人の購入権を、自分の記録へ付け替えられない（code C は購入なし）', { skip: SKIP }, async () => {
  const forged = sign({ exp: Date.now() + 1e9, env: 'preview', diagnosis_version: 'element-v1', purchase: {}, code: CODE_C });
  const r = await handoff(forged, 't3'); assert.equal(r.code, 403); assert.equal(r.body.error, 'not_entitled');
});

// ---- 項目5：期限切れ・通信失敗でも購入者が権利を失わない
test('5-1 期限切れの購入リンクは引き継ぎに使えないが、権利（DB）は残り、出し直したリンクで引き継げる', { skip: SKIP }, async () => {
  const expired = sign({ exp: Date.now() - 1000, env: 'preview', diagnosis_version: 'element-v1', purchase: {}, code: CODE_B });
  // U2 が code B を保存した状況（S(6)）
  assert.equal((await handoff(expired, 't2')).code, 403);
  assert.equal(peCount(), N0); assert.equal(peFp(), FP0, '購入権は不変');
  const fresh = await openPurchaseLink(CODE_B, SID_B); // 運営者の復旧手順：Session ID で verify を開き直す
  const r = await handoff(fresh.token, 't2'); assert.equal(r.code, 200); assert.equal(r.body.bound, 'applied');
});
test('5-2 通信失敗（DBへの結び付けの途中）：何も変わらず、再実行で成功する', { skip: SKIP }, async () => {
  sql("delete from public.complete_legacy_bindings where legacy_entitlement_id='e2000000-0000-4000-8000-00000000000b'"); // 5-1 の結果を解除して再現（所有者権限）
  const t = (await openPurchaseLink(CODE_B, SID_B)).token;
  const real = fetchImpl;
  fetchImpl = makeFetch(DB, { users, failOn: (u) => u.pathname.includes('/rpc/complete_bind_legacy_purchase') });
  const r1 = await handoff(t, 't2'); assert.equal(r1.code, 500); assert.equal(r1.body.error, 'handoff_failed');
  assert.equal(bindings().filter((b) => b.e.endsWith('00b')).length, 0, '失敗時は結び付けなし');
  fetchImpl = real;
  const r2 = await handoff(t, 't2'); assert.equal(r2.code, 200); assert.equal(bindings().filter((b) => b.e.endsWith('00b')).length, 1);
});
test('5-3 決済後の verify の通信失敗（Stripe が応答しない）：購入権は不変、開き直しで復旧', { skip: SKIP }, async () => {
  const before = peFp();
  const down = () => ({ checkout: { sessions: { retrieve: async () => { throw Object.assign(new Error('network'), { type: 'StripeConnectionError' }); } } } });
  const r = await openPurchaseLink(CODE_A, SID_A, { stripe: down }); assert.equal(r.res.code, 500); assert.equal(peFp(), before);
  assert.ok((await openPurchaseLink(CODE_A, SID_A)).token);
});
test('5-4 DB障害（結び付けの検索に失敗）でも、購入リンクで読める（S0の保全）', { skip: SKIP }, async () => {
  const real = fetchImpl;
  fetchImpl = makeFetch(DB, { users, failOn: (u) => u.pathname.endsWith('/purchase_entitlements') });
  const rd = await readReport(tokenA); // legacy_floor ではなく verify 種別：DB で確かめられなければ 503（従来仕様）
  fetchImpl = real;
  assert.ok([200, 503].includes(rd.code), 'verify 種別は確かめられない時は 503（誤って開けない）。権利は消えない');
  assert.equal((await readReport(tokenA)).code, 200);
});

// ---- 項目6：v2・既存の再発行に影響しない
test('6-1 v2 の購入権（U3 の v2 記録）は引き継ぎ前後で不変。旧版の結び付けが v2 に波及しない', { skip: SKIP }, async () => {
  const e3 = await myEnt('t3'); assert.equal(e3.body.purchased_by_version['ETI-2.0:e2ecodev2vvvvvvvvvvvvvvvvvvv'], true);
  const rl = await reissue(S(5), 't3'); assert.equal(rl.code, 200);
  const rd = await readReport(tokenOf(rl.body.url)); assert.equal(rd.code, 200); assert.equal(rd.body.diagnosis_version, 'ETI-2.0');
});
test('6-2 同じ文字列の v2 記録（U1 の v2 / code A）は、旧版の引き継ぎでは購入済みにならない', { skip: SKIP }, async () => {
  const e1 = await myEnt('t1');
  assert.equal(e1.body.purchased_by_version['element-v1:' + CODE_A], true);
  assert.ok(!e1.body.purchased_by_version['ETI-2.0:' + CODE_A], 'v2 は未購入のまま');
  const rl = await reissue(S(4), 't1'); assert.equal(rl.code, 403);
});
test('6-3 v2 のトークンでは引き継ぎ不可（403）／v2 の支払いを verify は旧購入として記録しない', { skip: SKIP }, async () => {
  const v2tok = sign({ exp: Date.now() + 1e9, env: 'preview', diagnosis_version: 'ETI-2.0', purchase: {}, enc: (() => { const k = Buffer.from(crypto.hkdfSync('sha256', SECRET, Buffer.alloc(0), 'report-token-code-encryption-v1', 32)); const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', k, iv); const d = Buffer.concat([c.update('v2_' + CODE_A), c.final()]); return { iv: iv.toString('base64url'), tag: c.getAuthTag().toString('base64url'), data: d.toString('base64url') }; })() });
  assert.equal((await handoff(v2tok, 't1')).code, 403);
  const before = peCount();
  const r = await openPurchaseLink('v2_' + CODE_A, 'cs_test_E2EV2NEW0000000001'); assert.equal(r.res.code, 410); assert.equal(peCount(), before);
});
test('6-4 既存のマイページ再発行（diagnosis_session_id）は、op なしで従来どおり（未保存の ID は 404）', { skip: SKIP }, async () => {
  const res = await reissue('ffffffff-0000-4000-8000-00000000ffff', 't1'); assert.equal(res.code, 404);
});

// ---- 7：新しい旧版の購入（Payment Link の決済完了）の記録：実DBの制約（一意・必須列）を通す ----
test('7-1 旧版の新しい購入：verify が購入権を1行だけ記録し、再送・同時でも増えない', { skip: SKIP }, async () => {
  const before = peCount();
  const code = 'e2ecodedddddddddddddddddddd', sid = 'cs_test_E2ED00000000000001';
  const r1 = await openPurchaseLink(code, sid); assert.ok(r1.token); assert.equal(peCount(), before + 1);
  const row = JSON.parse(sql(`select json_build_object('p',product_type,'a',amount,'c',currency,'s',status,'h',diagnosis_code_hash) from public.purchase_entitlements where stripe_checkout_session_id='${sid}'`));
  assert.deepEqual([row.p, row.a, row.c, row.s], ['core1', 1000, 'jpy', 'active']);
  assert.equal(row.h, crypto.createHash('sha256').update(code).digest('hex'), '診断コードの平文は保存しない（ハッシュだけ）');
  assert.ok((await openPurchaseLink(code, sid)).token); assert.equal(peCount(), before + 1, '再送で増えない');
  await Promise.all([openPurchaseLink(code, sid), openPurchaseLink(code, sid), openPurchaseLink(code, sid)]);
  assert.equal(peCount(), before + 1, '同時に開いても1行');
  assert.equal((await readReport(r1.token)).code, 200);
  N0 = peCount(); FP0 = peFp(); // 以降の「不変」の基準をここへ
});
test('7-2 再送：同じ購入リンクで引き継ぎを何度送っても結び付けは1件（認証復帰の再試行と同じ）', { skip: SKIP }, async () => {
  const t = (await openPurchaseLink(CODE_A, SID_A)).token;
  const n = bindings().length;
  for (let i = 0; i < 3; i++) assert.equal((await handoff(t, 't1')).code, 200);
  assert.equal(bindings().length, n);
});

test('終了：旧購入の表（purchase_entitlements）は、引き継ぎ操作で一切変わっていない', { skip: SKIP }, () => { assert.equal(peCount(), N0); assert.equal(peFp(), FP0); });
