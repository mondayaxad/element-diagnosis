// api/mentor-goal.js と api/my-entitlements.js（v2）のテスト。外部へは接続しない（偽の Supabase）。
//   実行: node --test tests/mentor_goal_api.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { PREVIEW_ENV, PROD_ENV } = require('./fixtures/server_env');
const CE = require('../lib/complete-eligibility');
const mentorGoal = require(path.join(__dirname, '..', 'api', 'mentor-goal.js'));
const myEntitlements = require(path.join(__dirname, '..', 'api', 'my-entitlements.js'));

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // 本人・RC1 対象
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // 他人の記録
const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // 存在しない
const RC1 = { ...CE.RC1_REQUIRED_VERSIONS };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function makeRes() {
  return {
    code: 0, body: undefined, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function makeLogger() {
  const lines = [];
  return { lines, error: (...a) => lines.push(a.map(String).join(' ')), warn: (...a) => lines.push(a.map(String).join(' ')), log: () => {} };
}

// 偽の DB（PostgREST の eq.・in. だけを解釈する）
function fakeDb(over = {}) {
  const db = {
    users: { 'good-token': { id: U1, email: 'owner@example.test' }, 'other-token': { id: U2 } },
    diagnosis_sessions: [
      { id: S1, user_id: U1, diagnosis_version: 'ETI-2.0', diagnosis_results: [{ ...RC1 }], diagnosis_answers: [{ encoded_answers: 'CODE1' }] },
      { id: S2, user_id: U2, diagnosis_version: 'ETI-2.0', diagnosis_results: [{ ...RC1 }], diagnosis_answers: [{ encoded_answers: 'CODE2' }] },
    ],
    profiles: [{ id: U1, onboarding_status: 'completed' }, { id: U2, onboarding_status: 'completed' }],
    record_mentor_goals: [],
    complete_orders: [],
    complete_legacy_bindings: [],
    purchase_entitlements: [],
    record_entitlements: [],
    complete_reports: [],
    failTables: [],
    writeError: null,
    ...over,
  };
  const calls = [];
  const writes = [];
  function filterRows(table, params) {
    let rows = db[table] || [];
    for (const [k, v] of params.entries()) {
      if (['select', 'order', 'on_conflict'].includes(k)) continue;
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(','); rows = rows.filter((r) => set.includes(String(r[k]))); }
    }
    return rows;
  }
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers });
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const tok = String((opts.headers && opts.headers.Authorization) || '').replace('Bearer ', '');
      return db.users[tok] ? json(200, db.users[tok]) : json(401, {});
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (db.failTables.includes(table)) return json(500, { message: 'boom' });
    if (opts.method === 'POST') {
      const row = JSON.parse(opts.body);
      writes.push({ table, row, prefer: opts.headers.Prefer });
      if (db.writeError) return json(db.writeError.status, db.writeError.body);
      const existing = db.record_mentor_goals.find((g) => g.diagnosis_session_id === row.diagnosis_session_id);
      if (existing) Object.assign(existing, row); else db.record_mentor_goals.push({ ...row, locked_at: null });
      return json(201, [db.record_mentor_goals.find((g) => g.diagnosis_session_id === row.diagnosis_session_id)]);
    }
    return json(200, filterRows(table, u.searchParams).map((r) => ({ ...r })));
  };
  return { db, calls, writes, fetchImpl };
}

async function call(handlerOpts, req) {
  const logger = makeLogger();
  const res = makeRes();
  const h = mentorGoal.createHandler({ env: PREVIEW_ENV, logger, ...handlerOpts });
  await h({ method: 'GET', headers: { host: 'x.vercel.app', authorization: 'Bearer good-token' }, ...req }, res);
  return { res, logger };
}
const get = (fake, sid = S1, extra = {}) => call({ fetchImpl: fake.fetchImpl, ...extra }, { query: { diagnosisSessionId: sid } });
const post = (fake, body, extra = {}, headers) => call({ fetchImpl: fake.fetchImpl, ...extra },
  { method: 'POST', body, headers: headers || { host: 'x.vercel.app', authorization: 'Bearer good-token' } });

// ---- 環境・入力 ----
test('Production：本番の Supabase だけを使う（Preview の Supabase へ接続しない）', async () => {
  const f = fakeDb();
  const urls = [];
  const fetchImpl = async (url, opts) => { urls.push(url); return f.fetchImpl(url.replace(PROD_ENV.SUPABASE_URL, PREVIEW_ENV.SUPABASE_URL), opts); };
  const res = makeRes();
  await mentorGoal.createHandler({ env: PROD_ENV, fetchImpl, logger: { error() {} } })({ method: 'GET', headers: { host: 'x', authorization: 'Bearer good-token' }, query: { diagnosisSessionId: S1 } }, res);
  assert.equal(res.code, 200);
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith(PROD_ENV.SUPABASE_URL + '/')));
});

test('環境不明（VERCEL_ENV なし）も 404・Preview の設定不足は 503', async () => {
  const f = fakeDb();
  const { VERCEL_ENV, ...noEnv } = PREVIEW_ENV;
  assert.equal((await get(f, S1, { env: noEnv })).res.code, 404);
  const bad = await get(f, S1, { env: { ...PREVIEW_ENV, SUPABASE_URL: 'https://prodref0000000000000.supabase.co', SUPABASE_EXPECTED_PROJECT_REF: 'prodref0000000000000' } });
  assert.equal(bad.res.code, 503);
  assert.equal(bad.res.body.error, 'service_unavailable');
  assert.equal(f.calls.length, 0);
});

test('応答ヘッダー：no-store・nosniff。GET・POST 以外は 405', async () => {
  const f = fakeDb();
  const { res } = await get(f);
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  const r405 = await call({ fetchImpl: f.fetchImpl }, { method: 'PUT' });
  assert.equal(r405.res.code, 405);
  assert.equal(r405.res.headers.Allow, 'GET, POST');
});

test('認証なし・無効なトークンは 401、記録 ID の形式違いは 400', async () => {
  const f = fakeDb();
  assert.equal((await call({ fetchImpl: f.fetchImpl }, { headers: { host: 'x' }, query: { diagnosisSessionId: S1 } })).res.code, 401);
  assert.equal((await call({ fetchImpl: f.fetchImpl }, { headers: { host: 'x', authorization: 'Bearer bad' }, query: { diagnosisSessionId: S1 } })).res.code, 401);
  assert.equal((await get(f, 'not-a-uuid')).res.code, 400);
  assert.equal((await post(f, { diagnosisSessionId: S1 })).res.code, 400);
  assert.equal((await post(f, '{broken')).res.code, 400);
  assert.equal((await post(f, { diagnosisSessionId: S1, goalId: 'x'.repeat(2000) })).res.code, 413);
});

test('他人の記録と存在しない記録は同じ 404 record_not_found', async () => {
  const f = fakeDb();
  const a = await get(f, S2);
  const b = await get(f, S3);
  assert.equal(a.res.code, 404); assert.equal(b.res.code, 404);
  assert.deepEqual(a.res.body, b.res.body);
  assert.deepEqual(a.res.body, { error: 'record_not_found' });
  const p = await post(f, { diagnosisSessionId: S2, goalId: 'GOAL_PACE_01' });
  assert.equal(p.res.code, 404);
  assert.equal(f.writes.length, 0);
});

// ---- GET ----
test('GET（新規）：5目標のカタログ（keep_phrase をそのまま）・未選択・RC1 対象・登録完了', async () => {
  const f = fakeDb();
  const { res } = await get(f);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.catalog, JSON.parse(JSON.stringify(CE.MENTOR_CATALOG)));
  assert.equal(res.body.catalog.goals.length, 5);
  assert.equal(res.body.selection, null);
  assert.equal(res.body.locked, false);
  assert.equal(res.body.checkoutInProgress, false);
  assert.equal(res.body.changeAllowed, true);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.ineligibleReason, null);
  assert.equal(res.body.onboardingCompleted, true);
  assert.equal(res.body.legacyPurchasePending, false);
  const txt = JSON.stringify(res.body);
  assert.ok(!txt.includes(S1) && !txt.includes(U1) && !txt.includes('deltas') && !txt.includes('borrow'));
});

test('GET（保存済み・ロック・決済中・旧購入権）', async () => {
  const f = fakeDb({ record_mentor_goals: [{ diagnosis_session_id: S1, user_id: U1, goal_id: 'GOAL_PACE_01', goal_catalog_version: CE.MENTOR_CATALOG_VERSION, selected_at: '2026-10-07T00:00:00Z', locked_at: null }] });
  let r = (await get(f)).res.body;
  assert.deepEqual(r.selection, { goalId: 'GOAL_PACE_01', goalCatalogVersion: CE.MENTOR_CATALOG_VERSION, selectedAt: '2026-10-07T00:00:00Z' });
  assert.equal(r.changeAllowed, true);
  for (const [status, inProgress] of [['created', true], ['checkout_open', true], ['paid', false], ['disputed', false]]) {
    f.db.complete_orders = [{ diagnosis_session_id: S1, status }];
    r = (await get(f)).res.body;
    assert.equal(r.checkoutInProgress, inProgress, status);
    assert.equal(r.changeAllowed, false, status);
  }
  for (const status of ['expired', 'failed', 'canceled']) {
    f.db.complete_orders = [{ diagnosis_session_id: S1, status }];
    assert.equal((await get(f)).res.body.changeAllowed, true, status);
  }
  f.db.complete_orders = [];
  f.db.record_mentor_goals[0].locked_at = '2026-10-07T01:00:00Z';
  r = (await get(f)).res.body;
  assert.equal(r.locked, true); assert.equal(r.changeAllowed, false);
  // 旧 ¥1,000：ハッシュが一致するだけなら確認中、本人の記録へ固定済みなら確認中ではない
  f.db.purchase_entitlements = [{ id: '9e000000-0000-4000-8000-000000000001', diagnosis_code_hash: sha('v2_CODE1'), status: 'active', product_type: 'core1' }];
  assert.equal((await get(f)).res.body.legacyPurchasePending, true);
  f.db.complete_legacy_bindings = [{ diagnosis_session_id: S1, user_id: U1, legacy_entitlement_id: '9e000000-0000-4000-8000-000000000001' }];
  assert.equal((await get(f)).res.body.legacyPurchasePending, false);
});

// ---- POST ----
test('POST（新規）：本人の user_id・サーバーが決めるカタログ版で upsert。同じ目標の再送は書かない（冪等）', async () => {
  const f = fakeDb();
  const { res } = await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_EXPLORE_01', userId: U2, goalCatalogVersion: 'X' });
  assert.equal(res.code, 200);
  assert.equal(res.body.unchanged, false);
  assert.equal(res.body.selection.goalId, 'GOAL_EXPLORE_01');
  assert.equal(f.writes.length, 1);
  const w = f.writes[0];
  assert.equal(w.table, 'record_mentor_goals?on_conflict=diagnosis_session_id'.split('?')[0]);
  assert.deepEqual(Object.keys(w.row).sort(), ['diagnosis_session_id', 'goal_catalog_version', 'goal_id', 'selected_at', 'user_id']);
  assert.equal(w.row.user_id, U1);
  assert.equal(w.row.goal_catalog_version, CE.MENTOR_CATALOG_VERSION);
  assert.match(w.prefer, /resolution=merge-duplicates/);
  const again = await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_EXPLORE_01' });
  assert.equal(again.res.code, 200);
  assert.equal(again.res.body.unchanged, true);
  assert.equal(f.writes.length, 1, '同じ目標の再送は書かない');
  const re = await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' });
  assert.equal(re.res.code, 200);
  assert.equal(re.res.body.selection.goalId, 'GOAL_PACE_01');
  assert.equal(f.writes.length, 2, '支払い前は選び直せる');
});

test('POST：登録未完了は 403、legacy_exempt は可', async () => {
  const f = fakeDb();
  f.db.profiles[0].onboarding_status = 'required';
  assert.equal((await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' })).res.code, 403);
  f.db.profiles[0].onboarding_status = 'legacy_exempt';
  assert.equal((await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' })).res.code, 200);
});

test('POST：旧版・結果なし・版違いは 422 not_eligible（理由つき）、カタログ外は 422 unknown_goal', async () => {
  const cases = [
    [{ diagnosis_version: null }, 'legacy_version'],
    [{ diagnosis_results: [] }, 'result_missing'],
    [{ diagnosis_results: [{ ...RC1, mirror_model_version: 'ETI-MIRROR-2.0.2' }] }, 'version_mismatch'],
  ];
  for (const [patch, reason] of cases) {
    const f = fakeDb();
    Object.assign(f.db.diagnosis_sessions[0], patch);
    const { res } = await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' });
    assert.equal(res.code, 422, reason);
    assert.deepEqual(res.body, { error: 'not_eligible', reason });
    assert.equal(f.writes.length, 0);
    assert.equal((await get(f)).res.body.ineligibleReason, reason);
  }
  const f = fakeDb();
  assert.deepEqual((await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_UNKNOWN_99' })).res.body, { error: 'unknown_goal' });
});

test('POST：支払後ロックは 409 mentor_goal_locked、created・checkout_open・paid・disputed は 409 checkout_in_progress', async () => {
  const base = { diagnosis_session_id: S1, user_id: U1, goal_id: 'GOAL_PACE_01', goal_catalog_version: CE.MENTOR_CATALOG_VERSION, selected_at: '2026-10-07T00:00:00Z', locked_at: null };
  const f = fakeDb({ record_mentor_goals: [{ ...base, locked_at: '2026-10-07T01:00:00Z' }] });
  assert.deepEqual((await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_VISIBLE_01' })).res.body, { error: 'mentor_goal_locked' });
  assert.equal((await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' })).res.code, 200, 'ロック後も同じ目標の再送は 200');
  for (const status of ['created', 'checkout_open', 'paid', 'disputed']) {
    const g = fakeDb({ record_mentor_goals: [{ ...base }], complete_orders: [{ diagnosis_session_id: S1, status }] });
    const { res } = await post(g, { diagnosisSessionId: S1, goalId: 'GOAL_VISIBLE_01' });
    assert.equal(res.code, 409, status);
    assert.deepEqual(res.body, { error: 'checkout_in_progress' });
    assert.equal(g.writes.length, 0);
  }
  for (const status of ['expired', 'failed', 'canceled']) {
    const g = fakeDb({ record_mentor_goals: [{ ...base }], complete_orders: [{ diagnosis_session_id: S1, status }] });
    assert.equal((await post(g, { diagnosis_session_id: S1, diagnosisSessionId: S1, goalId: 'GOAL_VISIBLE_01' })).res.code, 200, status);
  }
});

test('POST：DB トリガーの拒否（最終防御）を応答へ対応させる', async () => {
  const map = [
    [{ status: 403, body: { code: '42501', message: 'mentor_goal_checkout_in_progress' } }, 409, 'checkout_in_progress'],
    [{ status: 403, body: { code: '42501', message: 'mentor_goal_locked' } }, 409, 'mentor_goal_locked'],
    [{ status: 403, body: { code: '42501', message: 'mentor_goal_record_not_found' } }, 404, 'record_not_found'],
  ];
  for (const [writeError, code, err] of map) {
    const f = fakeDb({ writeError });
    const { res, logger } = await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' });
    assert.equal(res.code, code); assert.equal(res.body.error, err);
    assert.equal(logger.lines.length, 0);
  }
});

test('ログ：失敗時は理由コードと照合 ID だけ（記録 ID・目標・メールを出さない）', async () => {
  const f = fakeDb({ writeError: { status: 500, body: { message: 'internal detail ' + S1 } } });
  const { res, logger } = await post(f, { diagnosisSessionId: S1, goalId: 'GOAL_PACE_01' });
  assert.equal(res.code, 500);
  assert.equal(res.body.error, 'save_failed');
  assert.match(res.body.incident_id, /^[0-9a-f]{12}$/);
  const g = fakeDb({ failTables: ['record_mentor_goals'] });
  const l = await get(g);
  assert.equal(l.res.code, 500); assert.equal(l.res.body.error, 'lookup_failed');
  for (const line of [...logger.lines, ...l.logger.lines]) {
    assert.match(line, /^mentor-goal error: (save_failed|lookup_failed) [0-9a-f]{12}$/);
    for (const secret of [S1, U1, 'GOAL_PACE_01', 'owner@example.test', 'internal detail']) assert.ok(!line.includes(secret), line);
  }
});

// ---- my-entitlements v2 ----
async function entitlements(fake, env = PREVIEW_ENV) {
  const res = makeRes();
  const h = myEntitlements.createHandler({ env, fetchImpl: fake.fetchImpl });
  const orig = console.error; console.error = () => {};
  try { await h({ method: 'GET', headers: { host: 'x.vercel.app', authorization: 'Bearer good-token' } }, res); } finally { console.error = orig; }
  return res;
}

test('my-entitlements v2（Preview）：記録ごとの完全解析の状態', async () => {
  const S4 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const S5 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const S6 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const f = fakeDb();
  f.db.diagnosis_sessions.push(
    { id: S4, user_id: U1, diagnosis_version: 'ETI-2.0', diagnosis_results: [{ ...RC1 }], diagnosis_answers: [{ encoded_answers: 'CODE4' }] },
    { id: S5, user_id: U1, diagnosis_version: null, diagnosis_results: [{}], diagnosis_answers: [{ encoded_answers: 'CODE5' }] },
    { id: S6, user_id: U1, diagnosis_version: 'ETI-2.0', diagnosis_results: [{ ...RC1 }], diagnosis_answers: [{ encoded_answers: 'CODE6' }] },
  );
  f.db.purchase_entitlements = [
    { id: '9e000000-0000-4000-8000-000000000001', diagnosis_code_hash: sha('v2_CODE1'), status: 'active', product_type: 'core1' }, // S1：未確認の旧購入
    { id: '9e000000-0000-4000-8000-000000000004', diagnosis_code_hash: sha('v2_CODE4'), status: 'active', product_type: 'core1' }, // S4：固定済み
  ];
  f.db.complete_legacy_bindings = [{ diagnosis_session_id: S4, user_id: U1, legacy_entitlement_id: '9e000000-0000-4000-8000-000000000004' }];
  f.db.record_mentor_goals = [{ diagnosis_session_id: S4, user_id: U1, goal_id: 'GOAL_PACE_01', goal_catalog_version: CE.MENTOR_CATALOG_VERSION, selected_at: '2026-10-07T00:00:00Z', locked_at: null }];
  f.db.complete_orders = [{ user_id: U1, diagnosis_session_id: S4, status: 'checkout_open' }, { user_id: U1, diagnosis_session_id: S6, status: 'refunded' }];
  f.db.record_entitlements = [{ user_id: U1, diagnosis_session_id: S6, right_type: 'complete', status: 'revoked' }];
  const res = await entitlements(f);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.purchased_by_version, { 'ETI-2.0:CODE1': true, 'ETI-2.0:CODE4': true });
  assert.equal(res.body.completeLookup, 'ok');
  const r = res.body.records;
  assert.deepEqual(Object.keys(r[S1]).sort(), ['analysisSource', 'checkoutInProgress', 'completeEligible', 'completeEntitlement', 'completeStatus',
    'ineligibleReason', 'legacyPurchasePending', 'mentorGoal', 'mentorGoalLocked', 'repurchaseBlocked']);
  assert.equal(r[S1].completeEligible, true);
  assert.equal(r[S1].legacyPurchasePending, true, 'ハッシュ一致だけ：確認中');
  assert.equal(r[S1].analysisSource, null, 'ハッシュ一致だけでは ¥2,000 の根拠にしない');
  assert.equal(r[S4].legacyPurchasePending, false);
  assert.equal(r[S4].analysisSource, 'legacy_purchase_entitlement');
  assert.equal(r[S4].checkoutInProgress, true);
  assert.deepEqual(r[S4].mentorGoal, { goalId: 'GOAL_PACE_01', goalCatalogVersion: CE.MENTOR_CATALOG_VERSION, selectedAt: '2026-10-07T00:00:00Z' });
  assert.equal(r[S5].completeEligible, false);
  assert.equal(r[S5].ineligibleReason, 'legacy_version');
  assert.equal(r[S6].repurchaseBlocked, true);
  assert.equal(r[S6].completeEntitlement, 'revoked');
  // 固定済みでも旧購入権が無効になっていれば根拠にしない
  f.db.purchase_entitlements[1].status = 'revoked_for_test';
  assert.equal((await entitlements(f)).body.records[S4].analysisSource, null);
  // 記録単位の analysis 権
  f.db.record_entitlements.push({ user_id: U1, diagnosis_session_id: S1, right_type: 'analysis', status: 'active' });
  assert.equal((await entitlements(f)).body.records[S1].analysisSource, 'record_entitlement');
});

test('my-entitlements v2：記録単位の解析権（¥1,000・¥3,000・引き継いだゲスト購入）だけでも「解析レポート購入済み」', async () => {
  const S7 = '77777777-7777-4777-8777-777777777777';
  const f = fakeDb();
  f.db.diagnosis_sessions.push({ id: S7, user_id: U1, diagnosis_version: 'ETI-2.0', diagnosis_results: [{ ...RC1 }], diagnosis_answers: [{ encoded_answers: 'CODE7' }] });
  f.db.record_entitlements = [{ user_id: U1, diagnosis_session_id: S7, right_type: 'analysis', status: 'active' }];
  const res = await entitlements(f);
  assert.equal(res.code, 200);
  assert.equal(res.body.purchased_by_version['ETI-2.0:CODE7'], true);
  assert.equal(res.body.records[S7].analysisSource, 'record_entitlement');
  // 失効（返金）した解析権は数えない
  f.db.record_entitlements[0].status = 'revoked';
  assert.equal((await entitlements(f)).body.purchased_by_version['ETI-2.0:CODE7'], undefined);
});

test('my-entitlements v2：完全解析の読み取りに失敗しても ¥1,000 の購入状態は返す', async () => {
  const f = fakeDb({ failTables: ['record_entitlements'] });
  f.db.purchase_entitlements = [{ id: '9e000000-0000-4000-8000-000000000001', diagnosis_code_hash: sha('v2_CODE1'), status: 'active', product_type: 'core1' }];
  const res = await entitlements(f);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { purchased_by_version: { 'ETI-2.0:CODE1': true }, completeLookup: 'failed' });
});

test('my-entitlements v2：Production も記録ごとの状態を返す（購入済みの判定は従来どおり・本番の Supabase だけ）', async () => {
  const f = fakeDb();
  f.db.purchase_entitlements = [{ id: '9e000000-0000-4000-8000-000000000001', diagnosis_code_hash: sha('v2_CODE1'), status: 'active', product_type: 'core1' }];
  const env = { ...PROD_ENV };
  const res = makeRes();
  const fetchImpl = async (url, opts) => f.fetchImpl(url.replace(PROD_ENV.SUPABASE_URL, PREVIEW_ENV.SUPABASE_URL), opts);
  await myEntitlements.createHandler({ env, fetchImpl })({ method: 'GET', headers: { host: 'x', authorization: 'Bearer good-token' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.purchased_by_version, { 'ETI-2.0:CODE1': true });
  assert.ok(['ok', 'failed'].includes(res.body.completeLookup));
});
