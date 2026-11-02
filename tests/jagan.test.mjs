// 邪眼診断：参照実装との一致・データの同期・保存/共有 API の権限と入力検査・表示の境界。
//   実行: node --test tests/jagan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDiagnosis, publicSummary } from '../jagan/engine/runtime.mjs';
import { BUNDLE, COPY } from '../jagan/engine/data.mjs';
import { recompute, headlineOf, ogParams, renderSharePage, createSaveHandler, createShareHandler, createReportHandler, createSharePageHandler, jaganEnabled } from '../lib/jagan-api.mjs';
import { renderResult, renderReport, shareTextFromSummary } from '../jagan/view.mjs';
import { parseOg } from '../lib/jagan-og-params.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'docs/jagan/spec_v1_0_rc1');
const RID = '3f2b8c1e-7a4d-4e9b-9c2f-1a2b3c4d5e6f';
const RID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const UID = '11111111-2222-4333-8444-555555555555';
const UID2 = '66666666-7777-4888-9999-000000000000';
const all = (v) => Object.fromEntries(BUNDLE.items.items.map((i) => [i.id, v]));
const run = (a, id = RID) => computeDiagnosis({ answers: a, resultId: id, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);

// ---- 仕様パッケージとの一致 ----
test('engine files are byte-identical to the spec package and data.mjs is regenerated', () => {
  for (const f of ['math.mjs', 'runtime.mjs']) {
    assert.equal(fs.readFileSync(path.join(ROOT, 'jagan/engine', f), 'utf8'), fs.readFileSync(path.join(SPEC, f), 'utf8'), f);
  }
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/jagan-data.mjs'), '--check']);
  for (const [k, f] of [['items', 'items.json'], ['interpretation', 'interpretation.json'], ['characters', 'characters.json'], ['product', 'product.json']]) {
    assert.deepEqual(BUNDLE[k], JSON.parse(fs.readFileSync(path.join(SPEC, 'data', f), 'utf8')));
  }
});

test('the spec reference tests pass unchanged', () => {
  execFileSync(process.execPath, ['--test', path.join(SPEC, 'tests/runtime.test.mjs')], { stdio: 'pipe' });
});

test('every fictional example reproduces the spec results through the site bundle', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(SPEC, 'examples.json'), 'utf8'));
  for (const e of ex) {
    const r = computeDiagnosis({ answers: e.input.answers, resultId: e.input.resultId, itemSetVersion: e.input.itemSetVersion || BUNDLE.items.item_set_version }, BUNDLE);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), e.result, e.name);
    if (e.publicSummary) assert.deepEqual(publicSummary(r), e.publicSummary, e.name);
  }
});

test('product stays one closed 1,000 JPY one-time item', () => {
  assert.equal(BUNDLE.product.price, 1000);
  assert.equal(BUNDLE.product.sales_open, false);
  assert.equal(BUNDLE.product.billing, 'one_time');
  assert.equal(BUNDLE.product.existing_eti_entitlement_grants_access, false);
});

// ---- サーバーの入力検査 ----
test('recompute rejects bad ids, versions, unknown items and invalid values; accepts null as missing', () => {
  const v = BUNDLE.items.item_set_version;
  assert.equal(recompute({ resultId: 'not-a-uuid', itemSetVersion: v, answers: all(3) }).error, 'invalid_result_id');
  assert.equal(recompute({ resultId: RID, itemSetVersion: 'old', answers: all(3) }).error, 'item_set_version_mismatch');
  assert.equal(recompute({ resultId: RID, itemSetVersion: v, answers: { ...all(3), OLD1: 3 } }).error, 'unknown_item_id');
  assert.equal(recompute({ resultId: RID, itemSetVersion: v, answers: { ...all(3), JG001: 6 } }).error, 'invalid_answer');
  assert.equal(recompute({ resultId: RID, itemSetVersion: v, answers: [] }).error, 'invalid_answers');
  const ok = recompute({ resultId: RID, itemSetVersion: v, answers: { ...all(4), JG001: null } });
  assert.ok(ok.ok);
  assert.equal(ok.result.answers.JG001, null);
  assert.equal(ok.result.domains.AUT_S.status, 'partial');
});

// ---- 保存・共有 API（Supabase を模した fetch） ----
function fakeEnv() {
  return {
    VERCEL_ENV: 'preview',
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst',
    SUPABASE_PREVIEW_PROJECT_REF: 'abcdefghijklmnopqrst',
    SUPABASE_PRODUCTION_PROJECT_REF: 'zyxwvutsrqponmlkjihg',
    SUPABASE_ANON_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
  };
}
function fakeDb({ registered = true } = {}) {
  const db = { jagan_results: [], jagan_shares: [], jagan_entitlements: [] };
  const tokens = { 'tok-a': UID, 'tok-b': UID2 };
  const parse = (u) => {
    const url = new URL(u);
    const table = url.pathname.split('/').pop();
    const filters = [];
    for (const [k, v] of url.searchParams) if (k !== 'select') filters.push([k, v]);
    const match = (row) => filters.every(([k, v]) => (v === 'is.null' ? row[k] == null : String(row[k]) === v.replace(/^eq\./, '')));
    return { table, match };
  };
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetchImpl = async (u, opts = {}) => {
    if (u.endsWith('/auth/v1/user')) {
      const t = (opts.headers.Authorization || '').slice(7);
      return tokens[t] ? json(200, { id: tokens[t] }) : json(401, {});
    }
    assert.ok(!opts.headers.Authorization || opts.headers.Authorization.includes('sb_secret') === false);
    const { table, match } = parse(u);
    if (table === 'profiles') return json(200, [{ onboarding_status: registered ? 'completed' : 'required' }]);
    const rows = db[table];
    const method = opts.method || 'GET';
    if (method === 'GET') return json(200, rows.filter(match));
    if (method === 'POST') {
      const row = JSON.parse(opts.body);
      const key = table === 'jagan_results' ? 'result_id' : 'public_id';
      if (rows.some((r) => r[key] === row[key] || (table === 'jagan_shares' && r.result_key === row.result_key))) return json(409, {});
      rows.push({ ...row, created_at: new Date().toISOString(), revoked_at: null });
      return json(201, null);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, patch));
      return json(200, hit);
    }
    throw new Error('unexpected');
  };
  return { db, fetchImpl };
}
function call(handler, { method = 'POST', token, body, url = '/api/x' } = {}) {
  return new Promise((resolve) => {
    const headers = { host: 'element-diagnosis-git-jagan-preview.vercel.app' };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = { method, headers, body, url };
    const h = {};
    const res = {
      statusCode: 200, setHeader: (k, v) => { h[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; }, json(o) { this.end(JSON.stringify(o)); },
      end(s) { let parsed = s; try { parsed = JSON.parse(s); } catch { /* html */ } resolve({ status: this.statusCode, body: parsed, headers: h }); },
    };
    handler(req, res);
  });
}
const saveBody = (a = all(4), id = RID) => ({ resultId: id, itemSetVersion: BUNDLE.items.item_set_version, answers: a });

test('save requires auth, registration and stores the server recomputation; retries are idempotent; other owners get 409', async () => {
  const { db, fetchImpl } = fakeDb();
  const h = createSaveHandler({ env: fakeEnv(), fetchImpl });
  assert.equal((await call(h, { body: saveBody() })).status, 401);
  assert.equal((await call(h, { token: 'bad', body: saveBody() })).status, 401);
  // ブラウザが送った所有者・人物・一致率は使わない
  const forged = { ...saveBody(), user_id: UID2, characters: { primary: 'pierro' }, purchased: true };
  const r1 = await call(h, { token: 'tok-a', body: forged });
  assert.equal(r1.status, 200);
  assert.equal(db.jagan_results.length, 1);
  const row = db.jagan_results[0];
  assert.equal(row.user_id, UID);
  assert.deepEqual(row.snapshot, JSON.parse(JSON.stringify(run(all(4)))));
  assert.deepEqual(row.headline, headlineOf(run(all(4))));
  assert.equal(row.interpretation_version, BUNDLE.interpretation.version);
  const r2 = await call(h, { token: 'tok-a', body: saveBody() });
  assert.equal(r2.status, 200); assert.equal(r2.body.duplicate, true);
  assert.equal(db.jagan_results.length, 1);
  assert.equal((await call(h, { token: 'tok-b', body: saveBody() })).status, 409);
  assert.equal(db.jagan_results[0].user_id, UID);
  assert.equal((await call(h, { token: 'tok-a', body: { ...saveBody(), answers: { ...all(3), JG001: 9 } } })).status, 400);
  assert.equal((await call(h, { method: 'GET', token: 'tok-a' })).status, 405);
});

test('save is refused before registration completes', async () => {
  const { db, fetchImpl } = fakeDb({ registered: false });
  const r = await call(createSaveHandler({ env: fakeEnv(), fetchImpl }), { token: 'tok-a', body: saveBody() });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'registration_required');
  assert.equal(db.jagan_results.length, 0);
});

test('production refuses jagan APIs unless explicitly enabled', async () => {
  assert.equal(jaganEnabled({}, 'production'), false);
  assert.equal(jaganEnabled({ JAGAN_PRODUCTION_ENABLED: 'true' }, 'production'), true);
  assert.equal(jaganEnabled({}, 'preview'), true);
  const env = { ...fakeEnv(), VERCEL_ENV: 'production', SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co', SUPABASE_EXPECTED_PROJECT_REF: 'zyxwvutsrqponmlkjihg' };
  const { fetchImpl } = fakeDb();
  const r = await call(createSaveHandler({ env, fetchImpl }), { token: 'tok-a', body: saveBody() });
  assert.equal(r.status, 503);
});

test('share stores only the public summary, separates the public id from the result id, is idempotent and revocable', async () => {
  const { db, fetchImpl } = fakeDb();
  const h = createShareHandler({ env: fakeEnv(), fetchImpl });
  const r1 = await call(h, { body: saveBody(all(4)) });
  assert.equal(r1.status, 200);
  assert.match(r1.body.publicId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(r1.body.revokeToken, /^[A-Za-z0-9_-]{43}$/);
  const row = db.jagan_shares[0];
  const stored = JSON.stringify(row);
  assert.ok(!stored.includes(RID), 'result id must not be stored in shares');
  assert.ok(!stored.includes('"answers"') && !stored.includes('"domains"'));
  assert.deepEqual(row.summary, publicSummary(run(all(4))));
  assert.equal(row.user_id, null);
  const r2 = await call(h, { body: saveBody(all(4)) });
  assert.equal(r2.body.publicId, r1.body.publicId); assert.equal(r2.body.revokeToken, undefined);
  assert.equal(db.jagan_shares.length, 1);
  // 公開 ID だけでは取り消せない。別のアカウントも不可。取消用の値で取り消せる
  assert.equal((await call(h, { method: 'DELETE', body: { publicId: r1.body.publicId } })).status, 403);
  assert.equal((await call(h, { method: 'DELETE', token: 'tok-b', body: { publicId: r1.body.publicId } })).status, 403);
  assert.equal((await call(h, { method: 'DELETE', body: { publicId: r1.body.publicId, revokeToken: 'x'.repeat(43) } })).status, 403);
  assert.equal((await call(h, { method: 'DELETE', body: { publicId: r1.body.publicId, revokeToken: r1.body.revokeToken } })).status, 200);
  assert.ok(db.jagan_shares[0].revoked_at);
  // 取り消した後の再共有は新しい公開 ID
  const r3 = await call(h, { body: saveBody(all(4)) });
  assert.notEqual(r3.body.publicId, r1.body.publicId);
});

test('share of a saved result uses the saved snapshot and owner; another account cannot share it; insufficient is 422', async () => {
  const { db, fetchImpl } = fakeDb();
  await call(createSaveHandler({ env: fakeEnv(), fetchImpl }), { token: 'tok-a', body: saveBody(all(2)) });
  const h = createShareHandler({ env: fakeEnv(), fetchImpl });
  // 送られた回答が違っても、保存時のスナップショットを使う
  const r = await call(h, { token: 'tok-a', body: saveBody(all(5)) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.summary, publicSummary(run(all(2))));
  assert.equal(r.body.revokeToken, null);
  assert.equal(db.jagan_shares[0].user_id, UID);
  assert.equal((await call(h, { token: 'tok-b', body: saveBody(all(2)) })).status, 409);
  assert.equal((await call(h, { body: saveBody({}, RID2) })).status, 422);
  assert.equal((await call(h, { method: 'DELETE', token: 'tok-a', body: { publicId: r.body.publicId } })).status, 200);
});

test('share page returns only the summary and 404 for unknown/revoked ids', async () => {
  const { db, fetchImpl } = fakeDb();
  const share = await call(createShareHandler({ env: fakeEnv(), fetchImpl }), { body: saveBody(all(4)) });
  const page = createSharePageHandler({ env: fakeEnv(), fetchImpl });
  const ok = await call(page, { method: 'GET', url: `/api/jagan-share-page?id=${share.body.publicId}` });
  assert.equal(ok.status, 200);
  const s = publicSummary(run(all(4)));
  assert.ok(ok.body.includes(s.character.label) && ok.body.includes(`/api/jagan-og?${ogParams(s).replace(/&/g, '&amp;')}`));
  assert.ok(!ok.body.includes(RID));
  assert.equal((await call(page, { method: 'GET', url: '/api/jagan-share-page?id=AAAAAAAAAAAAAAAAAAAAAA' })).status, 404);
  assert.equal((await call(page, { method: 'GET', url: '/api/jagan-share-page?id=<script>' })).status, 404);
  db.jagan_shares[0].revoked_at = new Date().toISOString();
  const gone = await call(page, { method: 'GET', url: `/api/jagan-share-page?id=${share.body.publicId}` });
  assert.equal(gone.status, 404);
  assert.ok(!gone.body.includes(s.character.label));
});

test('report access is closed while sales are closed, and requires a jagan entitlement (not ETI) when open', async () => {
  const { db, fetchImpl } = fakeDb();
  await call(createSaveHandler({ env: fakeEnv(), fetchImpl }), { token: 'tok-a', body: saveBody() });
  const closed = createReportHandler({ env: fakeEnv(), fetchImpl });
  assert.equal((await call(closed, { method: 'GET', token: 'tok-a', url: `/api/jagan-report?resultId=${RID}` })).body.error, 'sales_closed');
  const openBundle = { ...BUNDLE, product: { ...BUNDLE.product, sales_open: true } };
  const open = createReportHandler({ env: { ...fakeEnv(), JAGAN_SALES_OPEN: 'true' }, fetchImpl, bundle: openBundle });
  assert.equal((await call(open, { method: 'GET', token: 'tok-a', url: `/api/jagan-report?resultId=${RID}` })).body.error, 'not_purchased');
  db.jagan_entitlements.push({ user_id: UID, result_id: RID, product_key: 'jagan_report_v1', status: 'active', id: 'e1' });
  assert.equal((await call(open, { method: 'GET', token: 'tok-b', url: `/api/jagan-report?resultId=${RID}` })).body.error, 'not_purchased');
  assert.equal((await call(open, { method: 'GET', token: 'tok-a', url: `/api/jagan-report?resultId=${RID}` })).status, 200);
});

// ---- 表示 ----
test('result view never fills deferred parts with example names or numbers', () => {
  const html = renderResult(run({}), BUNDLE, COPY);
  assert.ok(html.includes('判定保留'));
  for (const c of BUNDLE.characters.characters) assert.ok(!html.includes(c.name), c.name);
  assert.ok(!/\d+%一致/.test(html));
});

test('result view marks exact ties and the no-pattern type, and the report renders all twelve domains', () => {
  const mid = renderResult(run(all(3)), BUNDLE, COPY);
  assert.ok(mid.includes('計算上の同率候補があります'));
  assert.ok(mid.includes('型の偏りなし'));
  assert.ok(mid.includes(COPY.result.no_marked_pattern));
  const high = renderResult(run(all(5)), BUNDLE, COPY);
  assert.ok(high.includes('同率'));
  const rep = renderReport(run(all(4)), BUNDLE, COPY);
  for (const d of BUNDLE.items.domains) assert.ok(rep.includes(COPY.report.domains[d.id].label), d.id);
});

test('share text from the summary equals the runtime template; OG params round-trip through the image parser', () => {
  for (const v of [2, 3, 4, 5]) {
    const r = run(all(v));
    const s = publicSummary(r);
    const url = 'https://example.invalid/jagan/s/fixture_shared_0001';
    assert.equal(shareTextFromSummary(s, url), (/* runtime */ awaitMake(r, url)));
    const parsed = parseOg(new URLSearchParams(ogParams(s)));
    assert.equal(parsed.element, s.element.label);
    assert.equal(parsed.type, s.type.label);
    assert.equal(parsed.character, s.character.label);
    assert.equal(parsed.match, s.character.matchPercent);
  }
  assert.equal(parseOg(new URLSearchParams('e=XX&t=NONE&c=pierro&m=50')), null);
  assert.equal(parseOg(new URLSearchParams('e=PY&t=NONE&c=pierro&m=500')), null);
});
import { makeShareText } from '../jagan/engine/runtime.mjs';
function awaitMake(r, url) { return makeShareText(r, url, 'https://example.invalid'); }

test('share page escapes html in all fields', () => {
  const s = publicSummary(run(all(4)));
  const evil = { ...s, element: { ...s.element, label: '<img src=x onerror=alert(1)>' } };
  const html = renderSharePage({ origin: 'https://x.invalid', publicId: 'A'.repeat(22), summary: evil });
  assert.ok(!html.includes('<img src=x'));
});
