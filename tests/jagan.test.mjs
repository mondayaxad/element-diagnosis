// 邪眼診断：仕様 v0.3 の判定との一致・データの同期・保存/共有 API の権限と入力検査・表示の境界。
//   実行: node --test tests/jagan.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeDiagnosis, publicSummary, makeShareText, shareTextFromSummary, shareUrl, explainCharacter, SHARE_CHAR_CODES, SHARE_VERSIONS, shareKey, parseShareKey } from '../jagan/engine/runtime.mjs';
import { judge, characterRanking, scoreAnswers } from '../jagan/engine/judge.mjs';
import { BUNDLE } from '../jagan/engine/data.mjs';
import { judge as specJudge } from '../docs/jagan/spec_v0_3_balanced/runtime.mjs';
import { recompute, headlineOf, ogParams, sharePagePath, renderSharePage, createSaveHandler, createShareHandler, createReportHandler, createSharePageHandler, jaganEnabled } from '../lib/jagan-api.mjs';
import { renderResultPage, renderReport, renderMethod, PREVIEW_SCORES, PREVIEW_MATCH } from '../jagan/view.mjs';
import { GROUPS, ISOU_TEXT, ISOU_SHORT, ELEMENT_TEXT, ELEMENT_STORY, TRAIT_COPY, CHARACTER_COPY, traitBandText, TRAIT_BAND, bandOf } from '../jagan/site-copy.mjs';
import { fnv1a32, normalizedAnswers, selectIsou } from '../jagan/engine/dti.mjs';
import { buildCardTree } from '../lib/jagan-og-card.mjs';
import * as ETI from '../api/_og-data.mjs';
import { parseOg } from '../lib/jagan-og-params.mjs';
import { SAMPLE_ANSWERS, sampleResult } from '../jagan/sample.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'docs/jagan/spec_v0_3_balanced');
const RID = '3f2b8c1e-7a4d-4e9b-9c2f-1a2b3c4d5e6f';
const RID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const UID = '11111111-2222-4333-8444-555555555555';
const UID2 = '66666666-7777-4888-9999-000000000000';
const VERSION = BUNDLE.items.item_set_version;
const all = (v) => Object.fromEntries(BUNDLE.items.items.map((i) => [i.id, v]));
// 特性ごとの回答（指定しない特性は 2）。仕様の check.mjs の profile と同じ
const profile = (p) => Object.fromEntries(BUNDLE.items.items.map((i) => [i.id, p[i.trait] ?? 2]));
const run = (a, id = RID) => computeDiagnosis({ answers: a, resultId: id, itemSetVersion: VERSION }, BUNDLE);
const VARIED = () => profile({ HOS: 5, SUS: 4, MAN: 3, CAL: 3, RSK: 1, ANX: 4 }); // 人物が出る回答
const rand = (i) => Object.fromEntries(BUNDLE.items.items.map((x, k) => [x.id, 1 + ((i * 31 + k * 17 + (i >> 2) * k + (i % 7) * (k % 3)) % 5)]));

// ---- 仕様 v0.3 との一致 ----
test('data.mjs is regenerated from the spec package and matches its JSON', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/jagan-data.mjs'), '--check']);
  for (const [k, f] of [['items', 'items.json'], ['core', 'core-model.json'], ['characters', 'characters.json']]) {
    assert.deepEqual(BUNDLE[k], JSON.parse(fs.readFileSync(path.join(SPEC, f), 'utf8')), f);
  }
});

test('the spec check.mjs (18 checks) passes unchanged', () => {
  const out = execFileSync(process.execPath, [path.join(SPEC, 'check.mjs')], { encoding: 'utf8' });
  assert.match(out, /18 checks passed/);
});

test('the site engine returns exactly the spec runtime result for 2,000 varied answer sets and the fixtures', () => {
  for (let i = 0; i < 2000; i++) {
    const a = rand(i);
    assert.deepEqual(JSON.parse(JSON.stringify(judge(a, BUNDLE))), JSON.parse(JSON.stringify(specJudge(a))));
  }
  const fixtures = JSON.parse(fs.readFileSync(path.join(SPEC, 'parity-fixtures.json'), 'utf8'));
  for (const f of fixtures) {
    const got = characterRanking(f.scores, BUNDLE.characters);
    assert.equal(got[0].id, f.winner);
    for (const c of got) assert.ok(Math.abs(c.score - f.raw[c.id]) < 1e-8);
  }
});

test('product: 1,000 JPY one-time item. sales_open=true（実際に売るかは環境変数 JAGAN_SALES_OPEN・JAGAN_PRODUCTION_ENABLED で決める）', () => {
  assert.equal(BUNDLE.product.price, 1000);
  assert.equal(BUNDLE.product.sales_open, true);
  assert.equal(BUNDLE.product.billing, 'one_time');
  assert.equal(BUNDLE.product.existing_eti_entitlement_grants_access, false);
});

test('questions: fifty, five at a time, five options only, no skip and no intro', () => {
  assert.equal(BUNDLE.items.items.length, 50);
  assert.equal(BUNDLE.items.display_order.length, 50);
  assert.deepEqual([...BUNDLE.items.display_order].sort(), BUNDLE.items.items.map((i) => i.id).sort());
  assert.equal(BUNDLE.items.page_size, 5);
  assert.equal(BUNDLE.items.options.length, 5);
  assert.equal(BUNDLE.items.allow_skip, false);
  assert.equal(BUNDLE.items.intro_screen, false);
  assert.deepEqual(GROUPS.flatMap((g) => g.traits).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  assert.equal(GROUPS.reduce((n, g) => n + g.traits.reduce((m, t) => m + BUNDLE.items.traits.find((x) => x.id === t).item_count, 0), 0), 50);
});

test('every trait, element, isou and character has display copy', () => {
  for (const t of BUNDLE.items.traits) { assert.ok(TRAIT_COPY[t.id].meaning && TRAIT_COPY[t.id].limit && TRAIT_COPY[t.id].reflection, t.id); assert.ok(ISOU_TEXT[t.id].body, t.id); }
  for (const e of BUNDLE.core.elements) assert.ok(ELEMENT_TEXT[e.id].body, e.id);
  for (const t of BUNDLE.items.traits) assert.ok(ISOU_SHORT[t.id], t.id);
  for (const e of BUNDLE.core.elements) assert.ok(ELEMENT_STORY[e.id].startsWith(`邪眼（${e.label}）は、`), e.id);
  for (const c of BUNDLE.characters.characters) assert.ok(CHARACTER_COPY[c.id].story_context && CHARACTER_COPY[c.id].limit && CHARACTER_COPY[c.id].reflection, c.id);
});

test('results are deterministic: key order, repeat calls and result id do not change the outcome', () => {
  const a = VARIED();
  const r1 = run(a, RID), r2 = run(Object.fromEntries(Object.entries(a).reverse()), RID2);
  assert.deepEqual({ ...r1, resultId: null }, { ...r2, resultId: null });
  assert.deepEqual(run(a), run(a));
});

test('every answer set gets exactly one element and one isou with a code and name; flat answers still defer only the character', () => {
  for (const v of [1, 2, 3, 4, 5]) {
    const r = run(all(v));
    assert.equal(r.character.status, 'insufficient');
    assert.equal(r.element.status, 'available'); assert.equal(r.isou.status, 'marked');
    assert.match(r.dti.code, /^[A-Z]{4}$/); assert.match(r.dti.name, /^\p{Script=Han}{3}$/u);
    assert.equal(r.dti.code, r.element.id + r.isou.code);
  }
  // 最高の特性が60点未満でも通常の結果を返す
  const low = run(profile({ ANX: 3 }));
  assert.ok(low.traits[low.isou.id].score < 60); assert.equal(low.isou.id, 'ANX');
  for (const label of ['未顕', '複合', '未分化']) assert.ok(!JSON.stringify(run(all(3))).includes(label));
  assert.equal(run(profile({ SEP: 5 })).character.status, 'insufficient');
  assert.equal(run(profile({ MAN: 5, CAL: 5 })).character.id, 'dottore');
});

test('displayed match is the ranking value (similarity + fixed balance offset, 0.6.0〜) so rank and match never disagree', () => {
  const r = run(profile({ MAN: 4, IMP: 3 }));
  const c = characterRanking(r.traits ? Object.fromEntries(Object.entries(r.traits).map(([k, v]) => [k, v.score])) : {}, BUNDLE.characters).find((x) => x.id === r.character.id);
  assert.equal(r.character.match, Math.max(0, Math.min(100, Math.round(c.selectionScore))));
  assert.equal(c.selectionScore, c.score + c.selectionOffset);
  assert.deepEqual(Object.fromEntries(Object.entries(r.traits).map(([k, v]) => [k, v.score])), scoreAnswers(profile({ MAN: 4, IMP: 3 }), BUNDLE.items));
});

// ---- サーバーの入力検査 ----
test('recompute requires all fifty answers as integers 1-5 and rejects unknown ids, versions and null', () => {
  assert.equal(recompute({ resultId: 'not-a-uuid', itemSetVersion: VERSION, answers: all(3) }).error, 'invalid_result_id');
  assert.equal(recompute({ resultId: RID, itemSetVersion: 'old', answers: all(3) }).error, 'item_set_version_mismatch');
  assert.equal(recompute({ resultId: RID, itemSetVersion: VERSION, answers: { ...all(3), OLD1: 3 } }).error, 'unknown_item_id');
  assert.equal(recompute({ resultId: RID, itemSetVersion: VERSION, answers: { ...all(3), ANX01: 6 } }).error, 'invalid_answer');
  assert.equal(recompute({ resultId: RID, itemSetVersion: VERSION, answers: { ...all(3), ANX01: null } }).error, 'invalid_answer');
  const missing = all(3); delete missing.ANX01;
  assert.equal(recompute({ resultId: RID, itemSetVersion: VERSION, answers: missing }).error, 'invalid_answer');
  assert.equal(recompute({ resultId: RID, itemSetVersion: VERSION, answers: [] }).error, 'invalid_answers');
  assert.ok(recompute({ resultId: RID, itemSetVersion: VERSION, answers: all(4) }).ok);
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

const saveBody = (a = VARIED(), id = RID) => ({ resultId: id, itemSetVersion: VERSION, answers: a });

test('save requires auth, registration and stores the server recomputation; retries are idempotent; other owners get 409', async () => {
  const { db, fetchImpl } = fakeDb();
  const h = createSaveHandler({ env: fakeEnv(), fetchImpl });
  assert.equal((await call(h, { body: saveBody() })).status, 401);
  assert.equal((await call(h, { token: 'bad', body: saveBody() })).status, 401);
  // ブラウザが送った所有者・人物・一致率は使わない
  const forged = { ...saveBody(), user_id: UID2, character: { id: 'pierro' }, purchased: true };
  const r1 = await call(h, { token: 'tok-a', body: forged });
  assert.equal(r1.status, 200);
  assert.equal(db.jagan_results.length, 1);
  const row = db.jagan_results[0];
  assert.equal(row.user_id, UID);
  assert.deepEqual(row.snapshot, JSON.parse(JSON.stringify(run(VARIED()))));
  assert.deepEqual(row.headline, headlineOf(run(VARIED())));
  assert.equal(row.schema_version, 'jagan-result-3');
  assert.equal(row.dti_code, run(VARIED()).dti.code);
  assert.equal(row.naming_version, BUNDLE.dti.version);
  assert.equal(row.headline.code, run(VARIED()).dti.code);
  assert.equal(row.headline.name, run(VARIED()).dti.name);
  assert.equal(row.interpretation_version, BUNDLE.core.version);
  assert.equal(row.character_model_version, BUNDLE.characters.version);
  const r2 = await call(h, { token: 'tok-a', body: saveBody() });
  assert.equal(r2.status, 200); assert.equal(r2.body.duplicate, true);
  assert.equal(db.jagan_results.length, 1);
  assert.equal((await call(h, { token: 'tok-b', body: saveBody() })).status, 409);
  assert.equal(db.jagan_results[0].user_id, UID);
  assert.equal((await call(h, { token: 'tok-a', body: { ...saveBody(), answers: { ...all(3), ANX01: 9 } } })).status, 400);
  assert.equal((await call(h, { token: 'tok-a', body: { ...saveBody(), answers: { ...all(3), ANX01: null } } })).status, 400);
  assert.equal((await call(h, { method: 'GET', token: 'tok-a' })).status, 405);
});

test('a flat answer set can be saved and shared; the character is omitted (no null or invented name)', async () => {
  const { db, fetchImpl } = fakeDb();
  const r = await call(createSaveHandler({ env: fakeEnv(), fetchImpl }), { token: 'tok-a', body: saveBody(all(3), RID2) });
  assert.equal(r.status, 200);
  assert.equal(db.jagan_results[0].headline.character, null);
  assert.match(db.jagan_results[0].dti_code, /^[A-Z]{4}$/);
  const sh = await call(createShareHandler({ env: fakeEnv(), fetchImpl }), { body: saveBody(all(3), RID2) });
  assert.equal(sh.status, 200);
  assert.equal(sh.body.summary.character, null);
  const page = await call(createSharePageHandler({ env: fakeEnv(), fetchImpl }), { method: 'GET', url: `/api/jagan-share-page?id=${sh.body.publicId}` });
  assert.equal(page.status, 200);
  assert.ok(!page.body.includes('あなたのファトゥス') && !page.body.includes('null') && !page.body.includes('undefined'));
  assert.ok(!page.body.includes('&amp;c=') && page.body.includes(sh.body.summary.dti.name));
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
  const r1 = await call(h, { body: saveBody() });
  assert.equal(r1.status, 200);
  assert.match(r1.body.publicId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(r1.body.revokeToken, /^[A-Za-z0-9_-]{43}$/);
  const row = db.jagan_shares[0];
  const stored = JSON.stringify(row);
  assert.ok(!stored.includes(RID), 'result id must not be stored in shares');
  assert.ok(!stored.includes('"answers"') && !stored.includes('"traits"') && !stored.includes('ANX01'));
  assert.deepEqual(row.summary, publicSummary(run(VARIED())));
  assert.deepEqual(Object.keys(row.summary).sort(), ['character', 'characterModelVersion', 'coreVersion', 'dti', 'element', 'isou', 'kind', 'namingVersion'].sort());
  assert.equal(row.user_id, null);
  const r2 = await call(h, { body: saveBody() });
  assert.equal(r2.body.publicId, r1.body.publicId); assert.equal(r2.body.revokeToken, undefined);
  assert.equal(db.jagan_shares.length, 1);
  assert.equal((await call(h, { method: 'DELETE', body: { publicId: r1.body.publicId } })).status, 403);
  assert.equal((await call(h, { method: 'DELETE', token: 'tok-b', body: { publicId: r1.body.publicId } })).status, 403);
  assert.equal((await call(h, { method: 'DELETE', body: { publicId: r1.body.publicId, revokeToken: 'x'.repeat(43) } })).status, 403);
  assert.equal((await call(h, { method: 'DELETE', body: { publicId: r1.body.publicId, revokeToken: r1.body.revokeToken } })).status, 200);
  assert.ok(db.jagan_shares[0].revoked_at);
  const r3 = await call(h, { body: saveBody() });
  assert.notEqual(r3.body.publicId, r1.body.publicId);
});

test('share of a saved result uses the saved snapshot and owner; another account cannot share it', async () => {
  const { db, fetchImpl } = fakeDb();
  await call(createSaveHandler({ env: fakeEnv(), fetchImpl }), { token: 'tok-a', body: saveBody(profile({ MAN: 5, CAL: 5 })) });
  const h = createShareHandler({ env: fakeEnv(), fetchImpl });
  const r = await call(h, { token: 'tok-a', body: saveBody(VARIED()) }); // 送られた回答が違っても、保存時のスナップショットを使う
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.summary, publicSummary(run(profile({ MAN: 5, CAL: 5 }))));
  assert.equal(r.body.summary.character.id, 'dottore');
  assert.equal(r.body.revokeToken, null);
  assert.equal(db.jagan_shares[0].user_id, UID);
  assert.equal((await call(h, { token: 'tok-b', body: saveBody(profile({ MAN: 5, CAL: 5 })) })).status, 409);
  assert.equal((await call(h, { method: 'DELETE', token: 'tok-a', body: { publicId: r.body.publicId } })).status, 200);
});

test('share page returns only the summary and 404 for unknown/revoked ids', async () => {
  const { db, fetchImpl } = fakeDb();
  const share = await call(createShareHandler({ env: fakeEnv(), fetchImpl }), { body: saveBody() });
  const page = createSharePageHandler({ env: fakeEnv(), fetchImpl });
  const ok = await call(page, { method: 'GET', url: `/api/jagan-share-page?id=${share.body.publicId}` });
  assert.equal(ok.status, 200);
  const s = publicSummary(run(VARIED()));
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
test('result page: deferred parts are not filled, no names leak, and the twelve scores are not shown for free', () => {
  const flat = renderResultPage(run(all(3)), BUNDLE);
  assert.ok(flat.includes('特定の人物を示せませんでした') && !flat.includes('未分化') && !flat.includes('未顕') && !flat.includes('複合'));
  for (const c of BUNDLE.characters.characters) assert.ok(!flat.includes(c.name), c.name);
  assert.ok(!/\d+%\s*<\/b><span>一致度/.test(flat));
  const r = run(VARIED());
  const html = renderResultPage(r, BUNDLE);
  const names = BUNDLE.characters.characters.filter((c) => html.includes(c.name)).map((c) => c.id);
  assert.deepEqual(names, [r.character.id]);
  // ロック解除の背景は実際のレポートのモザイク：読み上げ・操作の対象外にし、2位以下の人物名は伏せる
  assert.ok(html.includes('class="rx-mosaic" aria-hidden="true" inert'));
  assert.equal((html.match(/class="rx-mosaic"/g) || []).length, 4);
  // ファトゥスのカードに参照特性の説明は出さない（方法説明への導線だけ）
  assert.ok(!html.includes('参照した特性：'));
  assert.ok((html.match(/data-buy disabled/g) || []).length >= 9);
  assert.ok(!html.includes('邪眼解析レポート'));
  assert.ok(html.includes('¥1,000') && html.includes('全てのロックを解除する'));
  // 一致度・人物の選び方の説明（内部の計算・調整）は出さない。似ている理由は、あなたの回答と人物の描写で言う（2026-11-11）
  assert.ok(!html.includes('一致度と人物の選び方について') && !html.includes('3対1') && !html.includes('小さな調整'));
  assert.ok(html.includes('rx-why-list') && html.includes(`あなたと<b class="rx-grad"`));
  // 人物の特性の高低を言い切らない・「重ならない」などの否定は書かない
  assert.ok(!html.includes('重なりません') && !html.includes('人物として描かれています') && !html.includes('描写は'));
  // 各領域は一般論ではなく、あなたの回答で最も強く出ている特性から
  assert.ok(!html.includes('心理学では') && !html.includes('高いほど悪い'));
  assert.equal((html.match(/あなたの回答で、この4つのうち最も強く出ているのは|あなたの回答では、[^<]*4つはいずれも控えめ/g) || []).length, 3);
  // 元素診断の完了ページと同じ順（2026-11-10）：深淵（コード・呼び名）→ファトゥス→渇望する邪眼→画像・X→人物像→欲求が導くあなたの影→
  //   一部分→全てを解放（金額）→診断記録への保存
  const order = ['あなたの深淵', `${r.dti.code}</b>`, 'あなたのファトゥス', 'あなたの渇望する邪眼', 'imageBtn', 'shareBtn', 'なぜあなたは似ているか', '欲求が導くあなたの影', 'あなたの欲求特性', 'あなたの一部分に過ぎません', 'UNLOCK EVERYTHING', 'rx-all-price', 'saveBtn'];
  const pos = order.map((k) => html.indexOf(k));
  assert.ok(pos.every((p) => p >= 0), JSON.stringify(order.filter((k, i) => pos[i] < 0)));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
  assert.ok(html.includes(`<span class="rx-dti-name">${r.dti.name}</span>`));
  // 近い候補・次点の行は出さない
  assert.ok(!html.includes('近い候補') && !html.includes('次に近しい') && !html.includes('2位'));
  // 鍵マークの言葉は単語一語（特性名、または各領域で足す類似語・控えめな側の言葉）
  const words = [...html.matchAll(/class="rx-lock-word">([^<]+)</g)].map((m) => m[1]);
  assert.ok(words.length > 0 && words.every((w) => w.length <= 8 && !/[、。]/.test(w)), words.join(','));
});

const result4 = () => ({ ANX: 50, SEP: 50, SUS: 50, WDR: 50 });
test('各領域の鍵：全員同じ4特性ではなく、回答で目立つ特性だけ。足りない分は類似語で4つに', async () => {
  const { groupLockWords, prominentTraits } = await import('../jagan/view.mjs');
  const inner = GROUPS.find((g) => g.id === 'inner');
  // 撤退と依存だけが高い回答：撤退・依存の2つ＋類似語2つ（不安・猜疑は出さない）
  const r = run(profile({ WDR: 5, SEP: 5, ANX: 2, SUS: 2 }));
  const w = groupLockWords(r, BUNDLE, inner);
  assert.equal(w.length, 4);
  assert.deepEqual(w.filter((x) => !x.related).map((x) => x.word).sort(), ['依存', '撤退'].sort());
  assert.ok(!w.some((x) => x.word === '不安' || x.word === '猜疑'));
  assert.equal(w.filter((x) => x.related).length, 2);
  // 回答が違えば並びも違う（全員が同じにならない）
  const r2 = run(profile({ ANX: 5, SUS: 5, WDR: 1, SEP: 1 }));
  assert.notDeepEqual(groupLockWords(r2, BUNDLE, inner).map((x) => x.word), w.map((x) => x.word));
  // 上位2つが同じくらい（1位だけ高め・2位はわずかに下）：2つ＋それぞれの言葉を1つずつ
  const near = { ...result4(), WDR: 64, SEP: 57, ANX: 30, SUS: 25 };
  const pn = prominentTraits({ traits: Object.fromEntries(Object.entries(near).map(([k, v]) => [k, { score: v }])) }, inner).map((x) => x.id);
  assert.deepEqual(pn, ['WDR', 'SEP']);
  const wn = groupLockWords({ traits: Object.fromEntries(Object.entries(near).map(([k, v]) => [k, { score: v }])) }, BUNDLE, inner);
  assert.deepEqual(wn.map((x) => x.word), ['撤退', '依存', '孤高', '愛着']);
  // 差が大きい時は1つ＋その言葉
  const far = { ...near, SEP: 45 };
  assert.deepEqual(prominentTraits({ traits: Object.fromEntries(Object.entries(far).map(([k, v]) => [k, { score: v }])) }, inner).map((x) => x.id), ['WDR']);
  // 4つとも控えめ：控えめな側の言葉
  const r3 = run(profile({ ANX: 1, SUS: 1, WDR: 1, SEP: 1 }));
  assert.equal(prominentTraits(r3, inner).length, 1);
  assert.ok(groupLockWords(r3, BUNDLE, inner).every((x) => /^[\u4e00-\u9fff]{2,3}$/.test(x.word)), '控えめな側も漢字2〜3字');
  // 足す言葉は漢字2〜3字（言い換えの長い言葉にしない）
  assert.ok(w.filter((x) => x.related).every((x) => /^[\u4e00-\u9fff]{2,3}$/.test(x.word)));
});

test('the report renders all twelve traits, three groups, the character section and the balance caveat; the sample is fictional', () => {
  const result = sampleResult();
  const rep = renderReport(result, BUNDLE);
  // 12特性：今回の得点の区分に応じた説明と問い（2026-11-10）。各項目の病名・「判定するものではありません」は出さない
  for (const t of BUNDLE.items.traits) { const bt = traitBandText(t.id, result.traits[t.id].score); assert.ok(rep.includes(bt.text) && rep.includes(bt.question), t.id); }
  for (const t of BUNDLE.items.traits) assert.ok(!rep.includes(TRAIT_COPY[t.id].limit), `${t.id} の注意書きが残っています`);
  for (const g of GROUPS) assert.ok(rep.includes(g.en), g.id);
  assert.ok(rep.includes('順位は一致度の高い順です'));
  // 近しいファトゥス：あなたの回答を軸に物語の姿を重ねる。守りの注記（測っていない・同一視しない・参照の説明）は書かない（2026-11-11）
  assert.ok(rep.includes('物語の中で彼らが見せる姿に、あなた自身の反応を重ねて'));
  for (const w of ['未対応の特性は、中立値で補わず', '差のある特性', '測っていません', '同一視しません', '15点・20点は説明のための設計値']) assert.ok(!rep.includes(w), w);
  for (const c of Object.values(CHARACTER_COPY)) assert.ok(!rep.includes(c.limit));
  assert.ok(rep.includes('姿と、同じ向きに表れています'));
  const flat = renderReport(run(all(3)), BUNDLE);
  assert.ok(flat.includes('人物の判定を保留'));
  assert.ok(rep.includes(sampleResult().dti.code) && rep.includes(sampleResult().dti.name));
  assert.deepEqual(Object.keys(SAMPLE_ANSWERS).sort(), BUNDLE.items.items.map((i) => i.id).sort());
});

test('share text equals the template; OG params round-trip through the image parser', () => {
  for (const a of [VARIED(), profile({ MAN: 5, CAL: 5 }), profile({ RSK: 5, IMP: 3 }), profile({ HOS: 4, SUS: 5, WDR: 1 })]) {
    const r = run(a);
    const s = publicSummary(r);
    // 元素診断と同じ形の共有文。URL は公開の値だけを載せた /jagan/share?…（OGP が出る）
    const url = shareUrl('https://example.invalid', s);
    // 投稿に載る URL は最短の形 /j/<4文字>（番号3文字＋版1文字）。内部の版名（dti-naming…・og-3）は出さない
    assert.match(url, /^https:\/\/example\.invalid\/j\/[0-9A-Za-z]{3}[1-9]$/);
    assert.ok(!url.includes('naming') && !url.includes('og-'));
    // 全員に、重ならない1字がある（以前の投稿の URL を読み替えないよう、字は変えない）
    assert.deepEqual(Object.keys(SHARE_CHAR_CODES).sort(), BUNDLE.characters.characters.map((c) => c.id).sort());
    assert.equal(new Set(Object.values(SHARE_CHAR_CODES)).size, Object.keys(SHARE_CHAR_CODES).length);
    assert.equal(parseShareKey('PYHOg2s1').character.match, 100, '旧い8文字の形も読める');
    // 全84通り×（11名＋保留）×一致度0〜100 が、4文字で往復できる（重なりなし）
    const seen = new Set();
    for (const code of SHARE_VERSIONS[1].codes) for (const ch of [...SHARE_VERSIONS[1].chars, null]) for (const m of ch ? [0, 1, 57, 99, 100] : [0]) {
      const k = shareKey({ dti: { code }, character: ch ? { id: ch, matchPercent: m } : null, namingVersion: SHARE_VERSIONS[1].naming });
      assert.match(k, /^[0-9A-Za-z]{3}1$/); assert.ok(!seen.has(k)); seen.add(k);
      const back = parseShareKey(k);
      assert.deepEqual([back.code, back.character && back.character.id, back.character && back.character.match], [code, ch, ch ? m : null]);
    }
    // 版1の表は凍結：組み合わせ・人物の並びは、今のデータと同じ集合（並べ替え・追加は新しい版で）
    assert.deepEqual([...SHARE_VERSIONS[1].codes].sort(), BUNDLE.dti.patterns.map((p) => p.code).sort());
    assert.deepEqual([...SHARE_VERSIONS[1].chars].sort(), BUNDLE.characters.characters.map((c) => c.id).sort());
    for (const bad of ['zzz1', '0001x', '00a0', 'ZZZ9']) assert.equal(parseShareKey(bad), null, bad);
    // 短い形も、画像の形も、同じ結果に読める
    const viaKey = parseOg(new URLSearchParams({ k: url.split('/').pop() }));
    assert.deepEqual([viaKey.code, viaKey.character.id, viaKey.character.match], [s.dti.code, s.character.id, s.character.matchPercent]);
    assert.ok(!url.includes('ANX01') && !url.includes('score'));
    assert.equal(shareTextFromSummary(s, url), makeShareText(r, url, 'https://example.invalid'));
    const text = makeShareText(r, url, 'https://example.invalid');
    assert.equal(text, `邪眼診断をやってみました。\n\n私の結果は【${s.element.label} × ${s.isou.label}】\nあなたのファトゥス：${s.character.label}（${s.character.matchPercent}%一致）\n\n${url}\n\n#邪眼診断 #${s.dti.code} #${s.character.label}`);
    // 共有文の URL は、その結果と一致するものだけ（他人の値・他のサイト・余計な値は拒否）
    assert.throws(() => makeShareText(r, url.replace(/.(\d)$/, (x, v) => (x[0] === '0' ? '1' : '0') + v), 'https://example.invalid'), /invalid_share_url/);
    assert.throws(() => makeShareText(r, `${url}&answers=1`, 'https://example.invalid'), /invalid_share_url/);
    const parsed = parseOg(new URLSearchParams(ogParams(s)));
    assert.equal(parsed.element, s.element.label);
    assert.equal(parsed.isou, s.isou.label);
    assert.equal(parsed.code, s.dti.code); assert.equal(parsed.name, s.dti.name);
    assert.equal(parsed.character.name, s.character.label);
    assert.equal(parsed.character.match, s.character.matchPercent);
    assert.match(ogParams(s), /&v=dti-naming-v1-20261104\.dti-og-3$/);
  }
  // 人物を保留した結果は人物の行を省く
  const flat = run(all(3));
  const ft = makeShareText(flat, shareUrl('https://example.invalid', publicSummary(flat)), 'https://example.invalid');
  assert.ok(!ft.includes('ファトゥス') && ft.includes(`#${flat.dti.code}`) && ft.endsWith(`#邪眼診断 #${flat.dti.code}`));
  assert.ok(!shareUrl('https://example.invalid', publicSummary(flat)).includes('&c='));
  assert.equal(parseOg(new URLSearchParams(ogParams(publicSummary(flat)))).character, null);
  assert.equal(parseOg(new URLSearchParams('e=XX&t=ANX&c=pierro&m=50')), null);
  assert.equal(parseOg(new URLSearchParams('e=PY&t=AX')), null);
  assert.equal(parseOg(new URLSearchParams('e=PY&t=ANX&c=pierro&m=500')), null);
  assert.equal(parseOg(new URLSearchParams('e=PY&t=ANX&c=<script>&m=50')), null);
  assert.throws(() => makeShareText(run(VARIED()), 'https://other.invalid/jagan/s/fixture_shared_0001', 'https://example.invalid'), /invalid_share_url/);
});

test('public summary is a strict projection without answers, trait scores or the private result id', () => {
  const r = run(VARIED(), 'private-result-uuid');
  const enc = JSON.stringify(publicSummary(r));
  assert.ok(!enc.includes('private-result-uuid') && !enc.includes('"answers"') && !enc.includes('"traits"') && !enc.includes('score'));
});

test('explainCharacter compares only the anchored traits and never imputes unknown ones', () => {
  const r = run(profile({ MAN: 5, CAL: 5 }));
  const ex = explainCharacter(r, BUNDLE, 'dottore');
  assert.deepEqual(ex.rows.map((x) => x.axis).sort(), ['CAL', 'MAN']);
  assert.equal(ex.unknownAxes.length, 10);
});

test('share page and method text are escaped and carry the required disclosure', () => {
  const s = publicSummary(run(VARIED()));
  const evil = { ...s, element: { ...s.element, label: '<img src=x onerror=alert(1)>' } };
  const html = renderSharePage({ origin: 'https://x.invalid', publicId: 'A'.repeat(22), summary: evil });
  assert.ok(!html.includes('<img src=x'));
  const m = renderMethod();
  assert.ok(m.includes('固定の補正') && m.includes('PID-5'));
  assert.ok(m.includes('Krueger'));
});

test('every character region is shown as a nation name', () => {
  const nations = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ', 'カーンルイア'];
  for (const c of BUNDLE.characters.characters) assert.ok(nations.includes(c.region_label), `${c.id}: ${c.region_label}`);
});

// ---- DTI（2026-11-04 指示書） ----
test('DTI: 84 unique four-letter codes and three-kanji names ending in 者, built from element + aspect codes', () => {
  const d = BUNDLE.dti;
  assert.equal(d.patterns.length, 84);
  assert.equal(new Set(d.patterns.map((p) => p.code)).size, 84);
  assert.equal(new Set(d.patterns.map((p) => p.name)).size, 84);
  for (const p of d.patterns) {
    assert.match(p.code, /^[A-Z]{4}$/); assert.match(p.name, /^\p{Script=Han}{2}者$/u);
    assert.equal(p.code, p.element_id + p.aspect_code);
  }
  for (const e of BUNDLE.core.elements) for (const t of BUNDLE.items.traits) assert.ok(d.patterns.some((p) => p.element_id === e.id && p.trait_id === t.id), e.id + t.id);
  assert.deepEqual(d.aspects.map((a) => a.code), ['AX', 'DP', 'SU', 'WD', 'IM', 'PE', 'PF', 'HO', 'AT', 'MN', 'RK', 'CL']);
});

test('DTI names and codes never collide with the current ETI definitions in this repository (case-insensitive)', () => {
  const etiNames = Object.values(ETI.TYPE_NAME).flatMap((w) => Object.values(w));
  const etiCodes = Object.entries(ETI.TYPE_NAME).flatMap(([el, w]) => Object.keys(w).map((wp) => (ETI.ELEMENT_CODE[el] + ETI.WEAPON_CODE[wp]).toUpperCase()));
  assert.equal(etiNames.length, 35); assert.equal(new Set(etiCodes).size, 35);
  for (const p of BUNDLE.dti.patterns) {
    assert.ok(!etiNames.includes(p.name), p.name);
    assert.ok(!etiCodes.includes(p.code.toUpperCase()), p.code);
  }
  const weaponCodes = Object.values(ETI.WEAPON_CODE);
  for (const a of BUNDLE.dti.aspects) assert.ok(!weaponCodes.includes(a.code), a.code);
});

test('FNV-1a 32bit matches the standard test vectors and the normalized answer string is key-order independent', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  const a = rand(7);
  assert.equal(normalizedAnswers(a, BUNDLE.items), normalizedAnswers(Object.fromEntries(Object.entries(a).reverse()), BUNDLE.items));
  assert.ok(normalizedAnswers(a, BUNDLE.items).startsWith('ANX01:'));
});

// 特性ごとに回答を並べて作る（同点処理の検査用）
const byTrait = (spec, fill = 1) => {
  const idx = {};
  return Object.fromEntries(BUNDLE.items.items.map((i) => { idx[i.trait] = idx[i.trait] || 0; const v = spec[i.trait]; return [i.id, v ? v[idx[i.trait]++] : fill]; }));
};

test('isou tie-break: mean, then share of 5s, then share of 4s, then the fixed hash; 4-item and 5-item traits compared by mean', () => {
  // 平均が最高の一つ
  assert.equal(selectIsou(byTrait({ ANX: [4, 4, 4, 4], SEP: [4, 4, 4, 4, 3] }), BUNDLE.items).id, 'ANX');
  // 4問と5問で平均が同じ（3.0）なら合計ではなく平均で同点→5の割合（ANX 1/4 > SEP 1/5）
  let r = selectIsou(byTrait({ ANX: [5, 3, 2, 2], SEP: [5, 3, 3, 2, 2] }), BUNDLE.items);
  assert.equal(r.id, 'ANX'); assert.equal(r.tieBreak, 'ratio5');
  // 平均・5の割合が同じ→4の割合
  r = selectIsou(byTrait({ ANX: [4, 4, 1, 3], WDR: [4, 3, 3, 2] }), BUNDLE.items);
  assert.equal(r.id, 'ANX'); assert.equal(r.tieBreak, 'ratio4');
  // 三軸以上が完全に同じ→固定ハッシュ（最小値。決定的）
  const a3 = byTrait({ ANX: [4, 4, 3, 3], SUS: [4, 4, 3, 3], WDR: [4, 3, 4, 3] });
  r = selectIsou(a3, BUNDLE.items);
  assert.equal(r.tieBreak, 'hash');
  const base = normalizedAnswers(a3, BUNDLE.items);
  const expect = ['ANX', 'SUS', 'WDR'].sort((x, y) => fnv1a32(`${base}|isou:${x}`) - fnv1a32(`${base}|isou:${y}`) || (x < y ? -1 : 1))[0];
  assert.equal(r.id, expect);
  // 全軸同点（全問同じ値）でも一つに決まり、キー順・繰り返しで変わらない
  for (const v of [1, 3, 5]) {
    const x = selectIsou(all(v), BUNDLE.items);
    assert.equal(x.tieBreak, 'hash');
    assert.deepEqual(x, selectIsou(Object.fromEntries(Object.entries(all(v)).reverse()), BUNDLE.items));
  }
});

test('element: base ranking is kept; only exact ties use the fixed hash, and the top-3 order follows the same rule', () => {
  const r = run(VARIED());
  const scores = r.element.ranking.map((e) => e.score);
  assert.deepEqual([...scores].sort((a, b) => b - a), scores);
  assert.equal(r.element.id, r.element.ranking[0].id);
  const flat = run(all(2));
  assert.equal(flat.element.tieBreak, 'hash');
  assert.deepEqual(flat.element.top3, flat.element.ranking.slice(0, 3).map((e) => e.id));
});

test('character judgement, raw match and fixed balance offsets are unchanged from the base v0.3 for DTI results', () => {
  for (let i = 0; i < 400; i++) {
    const a = rand(i);
    const spec = specJudge(a);
    const r = run(a);
    if (spec.character) { assert.equal(r.character.id, spec.character.id); assert.equal(r.character.match, spec.character.match); }
    else assert.equal(r.character.status, 'insufficient');
  }
  const base = JSON.parse(fs.readFileSync(path.join(SPEC, 'characters.json'), 'utf8'));
  for (const c of base.characters) assert.equal(BUNDLE.characters.characters.find((x) => x.id === c.id).selection_offset, c.selection_offset);
});

test('OG card: names come only from whitelisted ids, the character frame is omitted when deferred, long names fit the layout', () => {
  const text = (node) => (node == null ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node.props && node.props.children));
  const v = parseOg(new URLSearchParams('e=EL&t=RSK&c=arlecchino&m=86'));
  const t1 = text(buildCardTree(v));
  for (const k of ['邪眼診断 — MY RESULT', 'DTI', '雷', '危険志向', 'ELRK', '踏雷者', 'あなたのファトゥス', 'アルレッキーノ', '86', '%一致']) assert.ok(t1.includes(k), k);
  const t2 = text(buildCardTree(parseOg(new URLSearchParams('e=CR&t=WDR'))));
  assert.ok(t2.includes('CRWD') && !t2.includes('ファトゥス') && !t2.includes('null'));
  assert.ok(text(buildCardTree(null)).includes('Delusion Type Indicator'));
});

test('share HTML (no JS) carries absolute og:image, og:title, og:description, og:url and summary_large_image', async () => {
  const { fetchImpl } = fakeDb();
  const share = await call(createShareHandler({ env: fakeEnv(), fetchImpl }), { body: saveBody() });
  const page = await call(createSharePageHandler({ env: fakeEnv(), fetchImpl }), { method: 'GET', url: `/api/jagan-share-page?id=${share.body.publicId}` });
  const html = page.body;
  const meta = (k) => (html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`)) || [])[1];
  const s = share.body.summary;
  assert.match(meta('og:image'), /^https:\/\/[^/]+\/api\/jagan-og\?e=/);
  assert.ok(meta('og:title').includes(s.dti.code) && meta('og:title').includes(s.dti.name));
  assert.ok(meta('og:description').length > 0);
  assert.equal(meta('og:url'), `https://element-diagnosis-git-jagan-preview.vercel.app/jagan/s/${share.body.publicId}`);
  assert.equal(meta('twitter:card'), 'summary_large_image');
  // 元素診断と同じく X 用の title・description・image も明示（og と同じ値）
  assert.equal(meta('twitter:image'), meta('og:image'));
  assert.equal(meta('twitter:title'), meta('og:title'));
  assert.equal(meta('twitter:description'), meta('og:description'));
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
});

test('stateless share page (/jagan/share?…) needs no DB: summary from whitelisted ids, absolute OGP, og:url, 404 for bad values', async () => {
  const page = createSharePageHandler({ env: {}, fetchImpl: async () => { throw new Error('no db'); } });
  const s = publicSummary(run(VARIED()));
  const q = ogParams(s);
  // 以前に投稿された従来の形（e・t・c・m・v）も開ける。正規の URL（og:url）は短い形
  const legacy = await call(page, { method: 'GET', url: `/api/jagan-share-page?${q}` });
  assert.equal(legacy.status, 200);
  const key = sharePagePath(s).split('/').pop();
  const ok = await call(page, { method: 'GET', url: `/api/jagan-share-page?k=${key}` });
  assert.equal(ok.status, 200);
  const meta = (k) => (ok.body.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)"`)) || [])[1];
  assert.equal(meta('og:image'), `https://element-diagnosis-git-jagan-preview.vercel.app/api/jagan-og?${q.replace(/&/g, '&amp;')}`.replace(/&amp;/g, '&amp;'));
  assert.equal(meta('og:url'), `https://element-diagnosis-git-jagan-preview.vercel.app/j/${key}`);
  assert.match(key, /^[0-9A-Za-z]{3}1$/);
  // 以前の8文字の形（Preview で作られた ?k=）も開ける
  const old = await call(page, { method: 'GET', url: `/api/jagan-share-page?k=${s.dti.code}${SHARE_CHAR_CODES[s.character.id]}${s.character.matchPercent.toString(36).padStart(2, '0')}1` });
  assert.equal(old.status, 200);
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.ok(ok.body.includes(s.dti.code) && ok.body.includes(s.dti.name) && ok.body.includes(s.character.label));
  for (const bad of ['e=XX&t=ANX', 'e=PY&t=ANX&c=pierro&m=500', 'e=PY&t=ANX&c=%3Cscript%3E&m=50', '', 'k=ZZZZ1', 'k=PYHOz2c1', 'k=PYHOg2t1', 'k=PYHOg2c9', 'k=PYHO%3Cs%3E1']) {
    const r = await call(page, { method: 'GET', url: `/api/jagan-share-page?${bad}` });
    assert.equal(r.status, 404, bad);
    assert.ok(!r.body.includes('<script>'));
  }
  // 人物を保留した結果の共有は、人物の行を出さない
  const flat = await call(page, { method: 'GET', url: `/api/jagan-share-page?${ogParams(publicSummary(run(all(3))))}` });
  assert.equal(flat.status, 200);
  assert.ok(!flat.body.includes('あなたのファトゥス'));
});

test('unlock mosaics show fixed sample values, not the user\'s real scores', () => {
  const mosaics = (html) => [...html.matchAll(/<div class="rx-mosaic"[^>]*>([\s\S]*?)<\/div>\s*<button type="button" class="rx-preview-btn"/g)].map((m) => m[1]);
  const a = run(VARIED()), b = run(all(5));
  const ma = mosaics(renderResultPage(a, BUNDLE)), mb = mosaics(renderResultPage(b, BUNDLE));
  assert.equal(ma.length, 4);
  // 人物の欄を除く 3 つの土台は、結果が違っても同じ見本の中身
  assert.deepEqual(ma.slice(-3), mb.slice(-3));
  for (const g of GROUPS) for (const id of g.traits) assert.ok(ma.join('').includes(`<b>${PREVIEW_SCORES[id]}</b>`), id);
  assert.ok(ma[0].includes(`<em>${PREVIEW_MATCH}%</em>`) && !ma[0].includes(`<em>${a.character.match}%</em>`) || a.character.match === PREVIEW_MATCH);
});

test('mypage emblems (pre-awakening / awakened): every element has both images, named by the element label (mypage.html)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'mypage.html'), 'utf8');
  const m = /const MP_JAGAN_EMBLEM = (\{[^}]+\});/.exec(html);
  assert.ok(m, 'MP_JAGAN_EMBLEM');
  const map = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepEqual(Object.keys(map).sort(), BUNDLE.core.elements.map((e) => e.label).sort(), 'every element label is mapped');
  assert.equal(new Set(Object.values(map)).size, 7);
  for (const f of Object.values(map)) {
    for (const kind of ['record', 'awakened']) {
      const b = fs.readFileSync(path.join(ROOT, 'assets/emblems/jagan', kind, `${f}.png`));
      assert.equal(b.subarray(1, 4).toString(), 'PNG', `${kind}/${f}`);
      assert.ok(b.length < 400 * 1024, `${kind}/${f} is small enough (${b.length})`);
      assert.equal(b.readUInt32BE(16), 360); assert.equal(b.readUInt32BE(20), 360);
    }
    const [r, a] = ['record', 'awakened'].map((k) => fs.readFileSync(path.join(ROOT, 'assets/emblems/jagan', k, `${f}.png`)));
    assert.ok(!r.equals(a), `${f}: the awakened image differs from the pre-awakening one`);
  }
  // ETI の証は上書きしない
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/emblems/2026-autumn/record/pyro.png')));
});

// js/jagan-mypage.js を、模擬の Supabase で読み込む
function loadJaganMypage({ rows, ent, token = 'tok' }) {
  const js = fs.readFileSync(path.join(ROOT, 'js/jagan-mypage.js'), 'utf8');
  const win = { __ED_PUBLIC_CONFIG__: { appEnv: 'preview', jaganSalesOpen: true }, localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, sessionStorage: { getItem: () => null, removeItem() {}, setItem() {} } };
  const supa = { auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
    from: (t) => (t === 'jagan_results' ? { select: () => ({ order: async () => ({ data: rows, error: null }) }) } : { select: () => ({ eq: async () => ent }) }) };
  const doc = { addEventListener() {}, getElementById: () => null };
  new Function('window', 'document', 'supabaseClient', 'location', 'fetch', js)(win, doc, supa, { origin: 'https://example.test' }, async () => ({ ok: false, status: 500, json: async () => ({}) }));
  return win.JaganMypage;
}
test('mypage (js/jagan-mypage.js)：権利が active の記録だけ購入済み。権利を読めなければ「未確認」（購入済みと見せない）。共有の URL は結果ページと同じ', async () => {
  const r1 = run(VARIED()), r2 = run(all(2));
  const rows = [r1, r2].map((r, i) => ({ result_id: `0000000${i}-0000-4000-8000-000000000000`, created_at: '2026-11-0' + (i + 1), headline: headlineOf(r), snapshot: r }));
  let jm = loadJaganMypage({ rows, ent: { data: [{ result_id: rows[1].result_id, status: 'active' }, { result_id: rows[0].result_id, status: 'refunded' }], error: null } });
  let out = await jm.load();
  assert.equal(out.ok, true);
  assert.deepEqual(out.sessions.map((s) => [s.purchased, s.entKnown]), [[false, true], [true, true]]);
  assert.equal(out.sessions[0].top3.length, 3);
  assert.deepEqual(out.sessions[0].top3.map((t) => t.id), r1.traitRanking.slice(0, 3).map((t) => t.id));
  // 共有：結果ページ（runtime の shareUrl）と同じ URL・同じ文
  const s0 = out.sessions[0];
  assert.equal(jm.shareUrlOf(s0), shareUrl('https://example.test', publicSummary(r1)));
  assert.equal(jm.shareTextOf(s0, 'U'), shareTextFromSummary(publicSummary(r1), 'U'));
  jm = loadJaganMypage({ rows, ent: { data: null, error: { message: 'x' } } });
  out = await jm.load();
  assert.deepEqual(out.sessions.map((s) => [s.purchased, s.entKnown]), [[false, false], [false, false]]);
  // ログインしていなければ何も読まない
  jm = loadJaganMypage({ rows, ent: { data: [], error: null }, token: null });
  assert.deepEqual((await jm.load()).sessions, []);
});

test('mypage の色（js/jagan-mypage.js）：異相・元素の色は jagan/site-copy.mjs と同じ。ファトゥスはオーナー指定の組み合わせで、課金前は1つ目の色、課金後は黒寄りのグラデーション', async () => {
  const jm = loadJaganMypage({ rows: [], ent: { data: [], error: null } });
  const SC = await import('../jagan/site-copy.mjs');
  assert.deepEqual(jm.COLORS.ISOU_COLOR, SC.ISOU_COLOR);
  assert.deepEqual(jm.COLORS.ELEMENT_MAIN, Object.fromEntries(Object.entries(SC.ELEMENT_COLOR).map(([k, v]) => [k, v.main])));
  assert.deepEqual(Object.keys(jm.COLORS.FATUI_TONE).sort(), BUNDLE.characters.characters.map((c) => c.id).sort(), '11人すべて');
  assert.deepEqual(jm.COLORS.FATUI_TONE, { pierro: ['EL', 'CR'], scaramouche: ['EL', 'AN'], capitano: ['CR', 'WHITE'], sandrone: ['CR', 'GE'], tartaglia: ['HY', 'EL'],
    columbina: ['HY', 'WHITE'], dottore: ['PY', 'DE'], signora: ['CR', 'PY'], pantalone: ['DE', 'EL'], arlecchino: ['PY', 'BLACK'], pulcinella: ['CR', 'HY'] });
  assert.deepEqual(jm.COLORS.FATUI_TONE, SC.FATUI_TONE, 'マイページと完全解析で同じ組み合わせ（正本は site-copy）');
  assert.equal(jm.COLORS.WHITE.toLowerCase(), SC.FATUI_TONE_EXTRA.WHITE.toLowerCase());
  assert.equal(jm.COLORS.BLACK, SC.FATUI_TONE_EXTRA.BLACK);
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
  for (const [id, [a]] of Object.entries(jm.COLORS.FATUI_TONE)) {
    const t = jm.fatuiTone(id);
    assert.equal(t.base, SC.ELEMENT_COLOR[a].main, `${id}: 課金前は1つ目の元素の色`);
    assert.ok(lum(t.ring[0]) < lum(t.base) || lum(t.ring[1]) < lum(t.base) / 3, `${id}: 黒寄りのグラデーション`);
    for (const c of t.ring.concat(t.text)) assert.match(c, /^#[0-9a-f]{6}$/);
  }
});

test('mypage の開示（購入済みだけ）：三つの土台の上位2特性と数値・ファトゥス上位4名。未購入・権利が読めない記録には作らない', async () => {
  const SC = await import('../jagan/site-copy.mjs');
  const r1 = run(VARIED()), r2 = run(all(2));
  const rows = [r1, r2].map((r, i) => ({ result_id: `0000000${i}-0000-4000-8000-000000000000`, created_at: '2026-11-0' + (i + 1), headline: headlineOf(r), snapshot: r }));
  let jm = loadJaganMypage({ rows, ent: { data: [{ result_id: rows[0].result_id, status: 'active' }], error: null } });
  assert.deepEqual(jm.GROUPS.map((g) => [g.id, g.short, g.color, g.traits]), SC.GROUPS.map((g) => [g.id, g.short, g.color, g.traits]));
  const out = await jm.load();
  const ins = out.sessions[0].insight;
  assert.ok(ins && ins.groups.length === 3 && ins.fatui.length === 4);
  for (const g of ins.groups) {
    const want = SC.GROUPS.find((x) => x.id === g.id).traits.map((id) => ({ id, s: Math.round(r1.traits[id].score) })).sort((a, b) => b.s - a.s)[0];
    assert.equal(g.top[0].score, want.s, g.id);
  }
  assert.equal(ins.fatui[0].id, r1.character.id);
  assert.equal(ins.fatui[0].match, r1.character.match, '1位は結果ページと同じ一致度');
  assert.deepEqual(ins.fatui.map((f) => f.id), r1.characterOrder.slice(0, 4).map((c) => c.id), '並びは結果・レポートと同じ（補正後の順）');
  assert.equal(out.sessions[1].insight, null, '未購入には開示を作らない');
  jm = loadJaganMypage({ rows, ent: { data: null, error: { message: 'x' } } });
  assert.ok((await jm.load()).sessions.every((s) => s.insight === null), '権利を読めなければ作らない');
});

// ---- 邪眼完全解析 DIPPER（叩き台）
test('完全解析 DIPPER：23ページ・指示の順。順位（邪眼7・異相12・ファトゥス11＝6＋5）は結果と同じ規則で、1位は結果と一致。どの結果でも空欄・未定義を出さない', async () => {
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { renderComplete, PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { orderIsou, selectIsou } = await import('../jagan/engine/dti.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.equal(PAGE_TITLES.length, 23);
  assert.deepEqual(PAGE_TITLES.slice(0, 8), ['表紙', 'このレポートの読み方', 'あなたの影', '邪眼（特性）の全体順位', '異相の全体順位', 'ファトゥス TOP11',
    '上位の邪眼との付き合い方', '上位の異相を読み解く']);
  assert.deepEqual(PAGE_TITLES.slice(-6), ['あなたの反応領域', 'あなたの影に、次の一手を', '再読 — あなたの影を読み直す', '邪眼辞典（7邪眼）', '異相辞典 I（不安と対人警戒・衝動と刺激）', '異相辞典 II（固執と基準・他者への働きかけ）']);
  const codes = new Set();
  for (let seed = 0; seed < 400; seed++) {
    const { result, html } = sampleComplete(seed);
    codes.add(result.dti.code);
    const m = buildComplete(result, BUNDLE);
    assert.equal(m.elements.length, 7); assert.equal(m.isous.length, 12); assert.equal(m.fatui.length, 11);
    assert.equal(m.fatuiTop.length, 6); assert.equal(m.fatuiRest.length, 5);
    assert.equal(m.element.id, result.element.id); assert.equal(m.isou.id, result.isou.id);
    assert.equal(orderIsou(result.answers, BUNDLE.items)[0].id, selectIsou(result.answers, BUNDLE.items).id);
    if (m.character) { assert.equal(m.character.id, result.character.id); assert.equal(m.character.match, result.character.match); }
    assert.equal((html.match(/class="dp-page /g) || []).length, 23, `seed ${seed}`);
    assert.ok(!/undefined|NaN|\[object/.test(html), `seed ${seed}`);
    assert.ok(html.includes(result.dti.code) && html.includes(result.dti.name));
    // 06 ファトゥス TOP11：11名すべて・下に TOP3 の説明
    const p6 = html.split('id="dp06"')[1].split('<section')[0];
    assert.equal((p6.match(/class="dp-fcard/g) || []).length, 11);
    assert.equal((p6.match(/class="dp-t3"/g) || []).length, 3);
    // 05 異相の全体順位：12項目
    assert.equal((html.split('id="dp05"')[1].split('<section')[0].match(/class="dp-rcard/g) || []).length, 12);
  }
  assert.ok(codes.size >= 60, `いろいろな DTI で確かめた（${codes.size}）`);
});

test('完全解析 DIPPER：文章の辞書が、邪眼7・異相12・ファトゥス11・ドメイン3のすべてをそろえている', async () => {
  const C = await import('../jagan/complete/copy.mjs');
  const SC = await import('../jagan/site-copy.mjs');
  assert.deepEqual(Object.keys(C.ELEMENT_DEEP).sort(), BUNDLE.core.elements.map((e) => e.id).sort());
  assert.deepEqual(Object.keys(C.TRAIT_DEEP).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  assert.deepEqual(Object.keys(C.FATUI_DEEP).sort(), BUNDLE.characters.characters.map((c) => c.id).sort());
  assert.deepEqual(Object.keys(C.DOMAIN_DEEP).sort(), SC.GROUPS.map((g) => g.id).sort());
  for (const v of Object.values(C.ELEMENT_DEEP)) for (const k of ['strength', 'use', 'low', 'dict']) assert.ok(v[k] && v[k].length > 10, k);
  for (const v of Object.values(C.TRAIT_DEEP)) for (const k of ['strength', 'use', 'weak', 'low', 'exp', 'recheck']) assert.ok(v[k] && v[k].length > 8, k);
  // 病名を断定しない（「判定するものではありません」の否定の言い方だけ）
  const all = JSON.stringify(C);
  for (const w of ['障害です', '病気です', 'サイコパスです']) assert.ok(!all.includes(w), w);
});

test('完全解析 DIPPER 10・11：上位の邪眼との付き合い方（5観点）・上位の異相を読み解く（6観点）。全7邪眼・全12異相の文がそろい、才能への読み替えをしない', async () => {
  const C = await import('../jagan/complete/copy.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.deepEqual(C.LIVE_ROWS.map((r) => r[1]), ['表れやすい反応', '負担になる場面', '自分を理解する問い', '付き合い方', '受け止めるための一文']);
  assert.deepEqual(C.READ_ROWS.map((r) => r[1]), ['この特性が示すこと', '日常での表れ方', '負担を感じるとき', '混同しないこと', '自分を理解する問い', '付き合い方']);
  assert.deepEqual(Object.keys(C.ELEMENT_LIVE).sort(), BUNDLE.core.elements.map((e) => e.id).sort());
  assert.deepEqual(Object.keys(C.TRAIT_READ).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  for (const v of Object.values(C.ELEMENT_LIVE)) for (const [k] of C.LIVE_ROWS) { assert.ok(v[k] && v[k].length > 10, k); assert.ok(!v[k].includes('才能')); }
  for (const v of Object.values(C.TRAIT_READ)) for (const [k] of C.READ_ROWS) { assert.ok(v[k] && v[k].length > 10, k); assert.ok(!v[k].includes('才能')); }
  // オーナー案の文をそのまま使う（水・依存の例）
  assert.equal(C.ELEMENT_LIVE.HY.accept, '不安があることと、関係が壊れていることは、同じではありません。');
  assert.equal(C.TRAIT_READ.SEP.notSame, '人に頼ることや、関係を望むこと自体とは区別する。');
  for (let seed = 0; seed < 60; seed++) {
    const { result, html } = sampleComplete(seed);
    const p10 = html.split('id="dp07"')[1].split('<section')[0], p11 = html.split('id="dp08"')[1].split('<section')[0];
    assert.ok(p10.includes('上位の邪眼との付き合い方') && p11.includes('上位の異相を読み解く'));
    assert.equal((p10.match(/class="dp-mx-cell/g) || []).length, 15);
    assert.equal((p11.match(/class="dp-mx-cell/g) || []).length, 18);
    assert.ok(p10.includes(C.ELEMENT_LIVE[result.element.id].accept.replace(/、/g, '、')), '1位の邪眼の一文');
  }
});

test('完全解析 DIPPER 12–17：上位3つの邪眼・異相の個別ページ（元素診断と同じ組み立て）。「あなたの場合」は今回の得点から組み立て、弱いときの一般論・強みへの読み替えを置かない', async () => {
  const C = await import('../jagan/complete/copy.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { renderComplete } = await import('../jagan/complete/view.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.deepEqual(Object.keys(C.ELEMENT_DETAIL).sort(), BUNDLE.core.elements.map((e) => e.id).sort());
  assert.deepEqual(Object.keys(C.TRAIT_DETAIL).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  assert.deepEqual(Object.keys(C.TRAIT_PHRASE).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  for (const v of Object.values(C.ELEMENT_DETAIL)) for (const k of ['head', 'tagline', 'loop', 'scenes', 'inner', 'signs', 'coexist', 'day', 'accept']) { assert.ok(v[k] && v[k].length > 3, k); assert.ok(!v[k].includes('才能')); }
  for (const v of Object.values(C.TRAIT_DETAIL)) for (const k of ['tagline', 'means', 'read', 'scenes', 'inner', 'signs', 'coexist', 'day', 'accept']) { assert.ok(v[k] && v[k].length > 3, k); assert.ok(!v[k].includes('才能')); }
  // 見本の回答（HYDP 縋望者）では、オーナー案の文になる
  const { result } = sampleComplete(0);
  const m = buildComplete(result, BUNDLE);
  assert.equal(m.topE[0].detail.you[0], '今回の水を形づくっているのは、主に依存と不安です。大切な相手と離れることへの不安と、悪い展開を予想する心配が、近い得点で表れています。');
  assert.equal(m.topE[0].detail.you[1], '一方、猜疑の得点は二つより低く、今回の水を「相手を強く疑う傾向」だけで説明することはできません。');
  assert.match(m.topE[1].detail.you[0], /構成特性の中で完璧の得点が比較的高く出ています.*「まだ十分ではない」という感覚が、確認を続ける一因になっていないか/);
  assert.match(m.topI[2].detail.you[0], /草と岩を形づくる特性でもあります。複数の結果に同じ特性が現れています。/);
  for (let s = 0; s < 200; s++) {
    const r = sampleComplete(s); const mm = buildComplete(r.result, BUNDLE);
    const pages = renderComplete(mm).split('<section').slice(1);
    for (const p of pages.slice(8, 14)) {
      assert.ok(!p.includes('弱いとき') && !p.includes('強みとしての顔'));
      for (const k of ['あなたの場合', 'この反応が表れうる場面', '自分の内側と、相手への伝わり方', '負担に気づくサイン', 'この傾向との付き合い方', 'ある日の場面', '自分を受け止めるための一文']) assert.ok(p.includes(k), k);
      assert.ok(!/undefined|NaN/.test(p));
    }
  }
});

test('完全解析 DIPPER 18：邪眼×異相――計算上の関係（異相が邪眼の構成特性に含まれるか）で文を分け、因果を決めない', async () => {
  const C = await import('../jagan/complete/copy.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.deepEqual(Object.keys(C.ELEMENT_COMBO).sort(), BUNDLE.core.elements.map((e) => e.id).sort());
  assert.deepEqual(Object.keys(C.TRAIT_COMBO).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  const m = buildComplete(sampleComplete(0).result, BUNDLE);
  assert.equal(m.combo.inc, true); assert.equal(m.combo.tag, '構成特性の重なり');
  assert.match(m.combo.you[0], /^今回の水は、依存70・不安69・猜疑44からなります。その中で依存は、12特性の中でも最も高く出ています。/);
  assert.match(m.combo.you[2], /親しい相手との距離が気になった場面で重なりえます/);
  let seen = { inc: 0, sep: 0 };
  for (let s = 0; s < 300; s++) {
    const r = sampleComplete(s), c = buildComplete(r.result, BUNDLE).combo;
    const inParts = BUNDLE.core.elements.find((e) => e.id === r.result.element.id).weights[r.result.isou.id] != null;
    assert.equal(c.inc, inParts);
    seen[c.inc ? 'inc' : 'sep']++;
    if (!c.inc) { assert.match(c.you[1], /同じ場面で重なることも、別々の場面で表れることもあります/); assert.match(c.q, /それとも、別々の場面で起きているか。$/); }
    assert.ok(r.html.includes('邪眼×異相――あなたの影はどう表れるか'));
  }
  assert.ok(seen.inc > 0 && seen.sep > 0);
});

test('完全解析 DIPPER 19：上位3名のファトゥスとの交わり（重なる特性・異なる特性・邪眼／異相との関係・比較から見えるあなた）。二層統合は削除', async () => {
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.ok(!PAGE_TITLES.some((t) => t.includes('二層統合')));
  assert.equal(PAGE_TITLES[15], '上位3名のファトゥスとの交わり');
  const m = buildComplete(sampleComplete(0).result, BUNDLE);
  const cap = m.mirror.people[0];
  assert.equal(cap.f.name, 'カピターノ');
  assert.match(cap.aligned, /^衝動はあなた20／参照25、敵意はあなた19／参照25です。今回の近さは、これらがいずれも低めの値で近づいている/);
  assert.match(cap.different, /^比較している三特性に、20点以上離れているものはありません。ただし、冷淡は差が19点あり/);
  assert.match(cap.main, /カピターノとの比較には依存・不安・猜疑を使用していません/);
  for (let s = 0; s < 300; s++) {
    const r = sampleComplete(s), mm = buildComplete(r.result, BUNDLE);
    assert.equal(mm.mirror.people.length, 3);
    for (const p of mm.mirror.people) {
      for (const t of [p.aligned, p.different, p.main, p.you]) { assert.ok(t.length > 20); assert.ok(!/献身|責任感|優しい|共感力が高い/.test(t)); }
      assert.ok(p.rows.every((x) => p.f.rows.includes(x)));
    }
    const p19 = r.html.split('id="dp16"')[1].split('<section')[0];
    assert.equal((p19.match(/class="dp-mcard"/g) || []).length, 3);
    assert.ok(p19.includes('三人との比較から見えるあなた') && p19.includes('比較から見えるあなた'));
  }
});

test('完全解析 DIPPER：四つの反応領域（12特性を4領域に・重複なし）とあなたの反応領域（内訳と解釈。平均の順位・判定を出さない）', async () => {
  const C = await import('../jagan/complete/copy.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  const all = C.RESPONSE_DOMAINS.list.flatMap((d) => d.traits);
  assert.deepEqual([...all].sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  assert.deepEqual(C.RESPONSE_DOMAINS.list.map((d) => d.label), ['不安と対人警戒', '衝動と刺激', '固執と基準', '他者への働きかけ']);
  assert.ok(PAGE_TITLES.includes('四つの反応領域') && PAGE_TITLES.includes('あなたの反応領域'));
  assert.ok(!PAGE_TITLES.some((t) => t.includes('ドメイン')));
  const m = buildComplete(sampleComplete(0).result, BUNDLE);
  assert.equal(m.rdom.list[0].you[0], '今回は、離れることへの不安と、先行きへの心配が目立っています。相手を疑うことや関わりを控えることよりも、依存と不安をめぐる反応から、自分の経験を振り返れます。');
  assert.match(m.rdom.list[3].you[0], /^四特性の中では操作が高いものの、今回の上位特性ではありません。領域内で最も高いという理由だけで、他者を強く操作する人とは判断しません。/);
  assert.match(m.rdom.think, /依存や不安への当てはまりと、衝動や敵意への当てはまりに違いがあります/);
  assert.equal(m.next.example.title, '返事が来ないと、何度も確かめたくなるあなたへ');
  assert.deepEqual(Object.keys(C.NEXT_EXAMPLE).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  assert.ok(!PAGE_TITLES.some((t) => /強みとは何か|下位の|受け止めるか/.test(t)));
  for (let s = 0; s < 300; s++) {
    const r = sampleComplete(s), mm = buildComplete(r.result, BUNDLE);
    for (const d of mm.rdom.list) {
      assert.ok(d.you.length >= 1 && d.you.every((t) => t.length > 10));
      if (Math.max(...d.ts.map((t) => t.score)) <= 35) assert.ok(!d.you.join('').includes('が目立っています'));
    }
    assert.ok(!/最も問題|ドメイン平均|弱点をどう活かすか|強みとしての顔/.test(r.html));
    assert.ok(r.html.includes('同じ気持ちが生まれても、次の行動まで同じである必要はありません。'));
  }
});

test('完全解析 DIPPER：再読 — あなたの影を読み直す（結果の要点・経験に照らす4つの問い・書き換え・読み返すページの番号は構成から）', async () => {
  const C = await import('../jagan/complete/copy.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.deepEqual(Object.keys(C.REREAD_EXAMPLE).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  for (const [, t] of C.REREAD_PAGE.links) assert.ok(PAGE_TITLES.includes(t), t);
  const { result, html } = sampleComplete(0);
  const r = buildComplete(result, BUNDLE).reread;
  assert.equal(r.r1, '水は、依存70・不安69・猜疑44を組み合わせた結果です。今回は、相手を疑うことよりも、離れることへの不安や先行きへの心配への当てはまりが目立ちました。');
  assert.match(r.r2, /依存は、水を形づくる特性の一つです。/);
  assert.equal(r.more.label, '完璧'); assert.equal(r.more.score, 56);
  assert.match(r.lowText, /測っていない長所を示すものではありません/);
  const p = html.split(`id="dp${String(PAGE_TITLES.indexOf('再読 — あなたの影を読み直す') + 1).padStart(2, '0')}"`)[1].split('<section')[0];
  assert.ok(p.includes(`href="#dp${String(PAGE_TITLES.indexOf('異相を読む（1）') + 1).padStart(2, '0')}"`));
  assert.ok(!p.includes('実際に試せたか'));
});

test('完全解析 DIPPER：観察実験を削除。辞典は邪眼7（あなたの順位の順・得点・構成特性）と異相12（四領域の順・得点・印）', async () => {
  const { PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.ok(!PAGE_TITLES.some((t) => t.includes('観察実験')));
  const { result, html } = sampleComplete(0);
  const m = buildComplete(result, BUNDLE);
  assert.equal(m.dict.groups.flat().flatMap((d) => d.items).length, 12);
  const pe = html.split(`id="dp${String(PAGE_TITLES.indexOf('邪眼辞典（7邪眼）') + 1).padStart(2, '0')}"`)[1].split('<section')[0];
  assert.equal((pe.match(/class="dp-edc"/g) || []).length, 7);
  assert.ok(pe.indexOf('>水<') < pe.indexOf('>草<'));
  const p1 = html.split(`id="dp${String(PAGE_TITLES.length - 1).padStart(2, '0')}"`)[1].split('<section')[0];
  const p2 = html.split(`id="dp${String(PAGE_TITLES.length).padStart(2, '0')}"`)[1];
  assert.equal((p1.match(/class="dp-idc"/g) || []).length + (p2.match(/class="dp-idc"/g) || []).length, 12);
  assert.ok(p1.includes('>依存</b><em>70</em>'));
  const C = await import('../jagan/complete/copy.mjs');
  assert.deepEqual(Object.keys(C.TRAIT_DICT_HL).sort(), BUNDLE.items.traits.map((t) => t.id).sort());
  for (const v of Object.values(C.TRAIT_DICT_HL)) { assert.ok(!/力|才能|強み/.test(v.hi + v.lo)); assert.match(v.lo, /少ない。$/); }
  assert.ok(!(p1 + p2).includes('先に動く力') && !(p1 + p2).includes('立ち止まる力'));
});

test('完全解析 DIPPER：03・04・06 の下部（根拠 → 意味 → 経験で確かめる視点）。7・8・9・人物から得るものを削除。個別ページの目次は結果の名前、順位表記なし', async () => {
  const { PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  assert.ok(!PAGE_TITLES.some((t) => /あなたの深層|ファトゥスはなぜ|影の正体|人物から得るもの/.test(t)));
  const { result, html } = sampleComplete(0);
  const m = buildComplete(result, BUNDLE);
  assert.deepEqual(m.ov.three, ['依存70・不安69が、12特性の中で目立っています。', '水64は、その二特性に猜疑44が組み合わさった結果です。', '危険志向6・冷淡6への当てはまりは少なく、すべての特性が同じ強さで表れている配置ではありません。']);
  assert.match(m.ov.check, /一方、完璧56が表す「「まだ不十分」という感覚」は、別の場面に現れる可能性もあります。/);
  assert.match(m.ov.eRead[0], /^水64は、依存・不安・猜疑の組み合わせです。/);
  assert.match(m.ov.eGap, /^水64と草47の差は17です。/);
  const p2 = html.split('id="dp02"')[1].split('<section')[0];
  assert.ok(p2.includes('邪眼を読む — 水（関係の揺れ）') && !p2.includes('邪眼 1位'));
  for (let s = 0; s < 200; s++) {
    const r = sampleComplete(s);
    const head = r.html.split('id="dp03"')[1].split('id="dp07"')[0];
    assert.ok(!/寄り添|慎重な足取り|すでに使っている強み|過剰使用|活かし方/.test(head), `seed ${s}`);
    const det = r.html.split('id="dp09"')[1].split('id="dp15"')[0];
    assert.ok(!/RANK|位 —/.test(det));
  }
});

test('完全解析 DIPPER：06＝比較の要点（近さに寄与した特性・主な違い・16へのリンク）、16＝人物の描写／重なる／異なる／邪眼・異相／自分に戻す問い。表記は「算出の重み」', async () => {
  const { PAGE_TITLES } = await import('../jagan/complete/view.mjs');
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  const n16 = PAGE_TITLES.indexOf('上位3名のファトゥスとの交わり') + 1;
  for (let s = 0; s < 200; s++) {
    const { result, html } = sampleComplete(s);
    const p6 = html.split('id="dp06"')[1].split('<section')[0];
    assert.ok(p6.includes(`href="#dp${String(n16).padStart(2, '0')}"`));
    assert.ok(!/あなた\d|参照\d|class="dp-chips"><i style/.test(p6), '06 は文章で、人物の元素の札を出さない');
    assert.ok(!p6.includes('あなたの結果との関係') && !p6.includes('重なる反応を拾う'));
    const p16 = html.split(`id="dp${String(n16).padStart(2, '0')}"`)[1].split('<section')[0];
    for (const k of ['あなたと重なるところ', 'その重なりが見える人物の姿', '自分に重ねて読むなら']) assert.ok(p16.includes(k), k);
    assert.ok(!/あなた\d|参照\s?\d|dp-mvals/.test(p16), '16 は数値ではなく文章で');
    // 一覧は表示する一致度の順（丸め前の値で降順）、あなたのファトゥスは最も近い人物から 5 ポイント以内
    // 順位と一致度は同じ値（0.6.0）。1位＝あなたのファトゥス
    const fl = buildComplete(result, BUNDLE).fatui;
    if (result.character.status === 'available') { assert.ok(fl[0].selected); assert.equal(fl[0].id, result.character.id); }
    for (let i = 1; i < fl.length; i++) { assert.ok(fl[i - 1].adj >= fl[i].adj - 1e-9); assert.ok(fl[i - 1].match >= fl[i].match, '順位が上の人物ほど一致度が高い（同じ値を含む）'); }
    assert.ok(!/寄与 \d|[>（]重み ?\d|計算上の重み/.test(html));
    const m = buildComplete(result, BUNDLE);
    const qs = m.mirror.people.map((p) => p.question);
    assert.ok(qs.every((q) => q.length > 10));
  }
});

test('完全解析 DIPPER：回答パターン（全体に低い・高い・中央・一特性突出・僅差・同点・同じ邪眼×異相で配置違い）で、本文の「特性名＋得点」が実際の得点と一致し、強さを誇張しない', async () => {
  const { buildComplete } = await import('../jagan/complete/model.mjs');
  const { renderComplete } = await import('../jagan/complete/view.mjs');
  const traits = BUNDLE.items.traits;
  const make = (f) => Object.fromEntries(BUNDLE.items.items.map((it, k) => [it.id, f(it.trait, k)]));
  const pats = {
    全体に低い: make(() => 1), 全体に低い2: make((t, k) => (k % 3 ? 1 : 2)), 全体に高い: make((t, k) => (k % 4 ? 5 : 4)), 中央: make((t, k) => 3 + ((k % 3) - 1) * (k % 2)),
    一特性突出: make((t) => (t === 'HOS' ? 5 : 2)), 僅差: make((t, k) => (t === 'SEP' ? 5 : t === 'ANX' ? (k % 5 ? 5 : 4) : 2)),
    同点: make((t) => (t === 'SEP' || t === 'ANX' ? 5 : 2)), 水依存A: make((t) => ({ SEP: 5, ANX: 4, SUS: 2 }[t] || 2)), 水依存B: make((t) => ({ SEP: 5, ANX: 2, SUS: 4 }[t] || 2)),
  };
  for (const [name, answers] of Object.entries(pats)) {
    const result = computeDiagnosis({ answers, resultId: `pat-${name}`, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
    const m = buildComplete(result, BUNDLE);
    const html = renderComplete(m);
    assert.ok(!/undefined|NaN|\[object/.test(html), name);
    const text = html.replace(/<[^>]+>/g, ' ');
    for (const t of traits) {
      const s = Math.round(result.traits[t.id].score);
      for (const mm of text.matchAll(new RegExp(`${t.label}(\\d{1,3})(?![\\d%％])`, 'g'))) assert.equal(+mm[1], s, `${name}: ${t.label}${mm[1]} と実際の ${s}`);
    }
    for (const e of m.elements) for (const mm of text.matchAll(new RegExp(`(?<![一-龯])${e.label}(\\d{1,3})(?![\\d%％])`, 'g'))) assert.equal(+mm[1], e.score, `${name}: ${e.label}${mm[1]}`);
    assert.ok(!/圧倒的|非常に強い|相乗効果|増幅/.test(text), name);
    const fl = m.fatui; for (let i = 1; i < fl.length; i++) assert.ok(fl[i - 1].match >= fl[i].match, name);
  }
  // 同じ邪眼×異相でも、他の特性の配置が違えば「あなたの場合」の文が変わる
  const a = buildComplete(computeDiagnosis({ answers: pats.水依存A, resultId: 'a', itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE), BUNDLE);
  const b = buildComplete(computeDiagnosis({ answers: pats.水依存B, resultId: 'b', itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE), BUNDLE);
  if (a.dti.code === b.dti.code) assert.notEqual(a.combo.you.join(''), b.combo.you.join(''));
});

test('人物の一致度は、照合外の特性の小さな変化で急変しない（0.7.0：目立つ特性の割合をなだらかに）', () => {
  const traitsOf = (o) => Object.fromEntries(BUNDLE.items.traits.map((t) => [t.id, o[t.id] ?? 50]));
  // GPT の再現例：全特性50（衝動だけ40）から、照合に使われない不安だけを55へ
  const a = characterRanking(traitsOf({ IMP: 40 }), BUNDLE.characters), b = characterRanking(traitsOf({ IMP: 40, ANX: 55 }), BUNDLE.characters);
  for (const x of a) { const y = b.find((c) => c.id === x.id); assert.ok(Math.abs(x.score - y.score) <= 3, `${x.id}: ${x.score.toFixed(1)} → ${y.score.toFixed(1)}`); }
  // 照合外の特性を 50→51 にしても、どの人物も 1 ポイント未満の変化
  for (const id of ['ANX', 'SEP', 'PRF', 'ATT']) {
    const p = characterRanking(traitsOf({ IMP: 40 }), BUNDLE.characters), q = characterRanking(traitsOf({ IMP: 40, [id]: 51 }), BUNDLE.characters);
    for (const x of p) assert.ok(Math.abs(x.score - q.find((c) => c.id === x.id).score) < 1, id);
  }
});

test('読者向け表示（DIPPER・結果ページ・解析レポート）に、重み・寄与・算出の重み・補正値などの計算説明を出さない', async () => {
  const { sampleComplete } = await import('../jagan/complete-sample.mjs');
  for (let s = 0; s < 60; s++) {
    const { result, html } = sampleComplete(s);
    const texts = [html, renderResultPage(result, BUNDLE, {}), renderReport(result, BUNDLE)].map((h) => h.replace(/<[^>]+>/g, ' '));
    for (const t of texts) assert.ok(!/重み|寄与|算出の重み|補正値|±\d|計算上の関係|の計算に/.test(t), `seed ${s}: ${(t.match(/.{20}(重み|寄与|算出の重み|補正値|±\d|計算上の関係|の計算に).{20}/) || [''])[0]}`);
  }
});

test('12特性の説明：高め・中程度・控えめで別の文。低い得点に高い傾向の文が出ない（区分は60以上・40以下）', () => {
  for (const id of Object.keys(TRAIT_BAND)) {
    const [hi, mid, lo] = [75, 50, 20].map((v) => traitBandText(id, v));
    assert.notEqual(hi.text, mid.text); assert.notEqual(mid.text, lo.text); assert.notEqual(hi.question, lo.question);
    assert.match(hi.text, /傾向が出ています/); assert.match(mid.text, /ある程度当てはまる/); assert.match(lo.text, /当てはまりが少ない/);
    assert.equal(bandOf(60), 'hi'); assert.equal(bandOf(59), 'mid'); assert.equal(bandOf(41), 'mid'); assert.equal(bandOf(40), 'lo');
    assert.doesNotMatch(hi.text + mid.text + lo.text, /判定するもの|否定するもの|障害|ADHD|サイコパス|強み|才能|冷静|優しい|自立/);
  }
});

test('理論のページ（/jagan/about）：基にした理論・邪眼とは・異相とは・各邪眼の中核だけ。判定の内部（重み・補正・同点の処理）は書かない', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../jagan/about.html', import.meta.url), 'utf8');
  for (const h of ['基にした理論', '邪眼とは', '異相とは', 'elementCores']) assert.ok(html.includes(h), h);
  for (const w of ['補正', '小さな調整', '重みで', '固定の値', '中間の値', 'renderMethod']) assert.ok(!html.includes(w), w);
  const { renderElementCores } = await import('../jagan/view.mjs');
  const cores = renderElementCores(BUNDLE);
  assert.equal((cores.match(/<li /g) || []).length, 7);
  assert.ok(!/0\.\d/.test(cores), '重みの値は出さない');
});

test('近しいファトゥス：11名の比較する特性すべてに、物語の姿の一文がある', async () => {
  const { FATUI_PORTRAIT } = await import('../jagan/site-copy.mjs');
  for (const c of BUNDLE.characters.characters) for (const axis of Object.keys(c.anchors)) assert.ok(FATUI_PORTRAIT[c.id] && FATUI_PORTRAIT[c.id][axis], `${c.id}.${axis}`);
});
