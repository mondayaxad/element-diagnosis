// api/subscribe.js（Kit 登録API）のテスト。Kit・Supabase への通信はすべて偽の fetch。
// 2026-10-07：登録完了で記録した同意（版・取得経路）だけを送り、同期状態の記録と再送条件（24時間以上・3回まで）を確かめる。
//   実行: node --test tests/subscribe_api.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createHandler, CONSENT_VERSION, syncDue } = require(path.join(__dirname, '..', 'api', 'subscribe.js'));

const KEY = 'kit_secret_for_test_only';
const USER = { id: 'user-1', email: 'owner@example.test' };
const { PROD_ENV, PREVIEW_ENV } = require('./fixtures/server_env');
const baseEnv = { ...PROD_ENV, KIT_API_KEY: KEY };
const NOW = Date.parse('2026-10-08T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// 登録完了で同意を記録した直後の行
function completedProfile(extra) {
  return Object.assign({
    onboarding_status: 'completed', newsletter_opted_in: true, newsletter_consent_version: CONSENT_VERSION,
    newsletter_consent_source: 'registration_onboarding', newsletter_sync_status: 'pending',
    newsletter_sync_attempts: 0, newsletter_sync_attempted_at: null,
  }, extra || {});
}

// profile: profiles 行（null で行なし。PATCH で書き換わる）／ profileStatus: 読み取りの HTTP ステータス
function harness({ env = {}, user = USER, profile = completedProfile(), profileStatus = 200, claimStatus = 200,
  kitLookup = { subscribers: [] }, kitLookupStatus = 200, kitCreateStatus = 201, now = NOW } = {}) {
  const calls = [];
  const row = profile ? { ...profile } : null;
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/auth/v1/user')) {
      const auth = opts.headers.Authorization;
      return auth === 'Bearer good-token' && user ? json(200, user) : json(401, { msg: 'invalid' });
    }
    if (url.includes('/rest/v1/profiles') && opts.method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const m = /newsletter_sync_attempts=eq\.(\d+)/.exec(url);
      if (m) {
        if (claimStatus !== 200) return json(claimStatus, { message: 'x' });
        if (!row || Number(row.newsletter_sync_attempts) !== Number(m[1])) return json(200, []);
        Object.assign(row, patch);
        return json(200, [{ ...row }]);
      }
      if (row) Object.assign(row, patch);
      return json(204, null);
    }
    if (url.includes('/rest/v1/profiles')) {
      if (profileStatus !== 200) return json(profileStatus, { message: 'column does not exist' });
      return json(200, row ? [{ ...row }] : []);
    }
    if (url.startsWith('https://api.kit.com/v4/subscribers?')) return json(kitLookupStatus, kitLookup);
    if (url === 'https://api.kit.com/v4/subscribers') return json(kitCreateStatus, { subscriber: { id: 1 } });
    throw new Error('unexpected fetch ' + url);
  };
  const handler = createHandler({ fetchImpl, env: { ...baseEnv, ...env }, now: () => now });
  async function call({ token = 'good-token', body = { consentVersion: CONSENT_VERSION }, method = 'POST' } = {}) {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await handler({ method, headers: token ? { authorization: 'Bearer ' + token } : {}, body }, res);
    return res;
  }
  const kitCalls = () => calls.filter((c) => c.url.startsWith('https://api.kit.com'));
  const kitCreates = () => calls.filter((c) => c.url === 'https://api.kit.com/v4/subscribers');
  return { call, calls, kitCalls, kitCreates, row };
}

function silenceErrors() {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  return { logs, restore: () => { console.error = orig; } };
}

test('未認証は 401、Kit を呼ばない', async () => {
  const h = harness();
  const r1 = await h.call({ token: null });
  assert.equal(r1.code, 401); assert.deepEqual(r1.body, { error: 'unauthorized' });
  const r2 = await h.call({ token: 'forged' });
  assert.equal(r2.code, 401);
  assert.equal(h.kitCalls().length, 0);
});

test('body に他人のメールを入れても、登録先は認証済み本人のメールだけ', async () => {
  const h = harness();
  const r = await h.call({ body: { consentVersion: CONSENT_VERSION, email: 'victim@example.test', email_address: 'victim@example.test' } });
  assert.equal(r.code, 200);
  const creates = h.kitCreates();
  assert.equal(creates.length, 1);
  assert.equal(JSON.parse(creates[0].opts.body).email_address, USER.email);
  assert.ok(!h.calls.some((c) => String(c.url).includes('victim') || String(c.opts.body || '').includes('victim')));
});

test('登録完了の同意（completed・true・版・取得経路）がそろわなければ 403、Kit を呼ばず同期状態も変えない', async () => {
  for (const profile of [
    completedProfile({ newsletter_opted_in: false }),
    completedProfile({ newsletter_opted_in: null }),
    completedProfile({ newsletter_opted_in: 'true' }),
    completedProfile({ newsletter_consent_version: '2026-10-06-v1' }),
    completedProfile({ newsletter_consent_source: 'mypage_signup' }),
    completedProfile({ onboarding_status: 'required' }),
    // 既存ユーザー（legacy_exempt）は、以前の値が true でも新しい登録の同意ではないため送らない
    { onboarding_status: 'legacy_exempt', newsletter_opted_in: true, newsletter_consent_version: null, newsletter_consent_source: null,
      newsletter_sync_status: null, newsletter_sync_attempts: 0, newsletter_sync_attempted_at: null },
    null,
  ]) {
    const h = harness({ profile });
    const r = await h.call();
    assert.equal(r.code, 403, JSON.stringify(profile)); assert.deepEqual(r.body, { error: 'consent_required' });
    assert.equal(h.kitCalls().length, 0);
    assert.ok(!h.calls.some((c) => c.opts.method === 'PATCH'), '同期状態を書き換えない');
  }
});

test('同意列を読めない（列が無い等）場合は fail-closed（403・Kit を呼ばない）', async () => {
  const h = harness({ profileStatus: 400 });
  const r = await h.call();
  assert.equal(r.code, 403);
  assert.equal(h.kitCalls().length, 0);
});

test('同意版が無い・旧い版・壊れた request は 400', async () => {
  const h = harness();
  assert.equal((await h.call({ body: {} })).code, 400);
  assert.equal((await h.call({ body: { consentVersion: '2026-10-06-v1' } })).code, 400);
  assert.equal((await h.call({ body: 'not json' })).code, 400);
  assert.equal(h.kitCalls().length, 0);
});

test('新規登録の同意・Kit 未登録なら、作成を1回だけ呼び synced を記録（API key はヘッダーだけ）', async () => {
  const h = harness();
  const r = await h.call();
  assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true });
  const creates = h.kitCreates();
  assert.equal(creates.length, 1);
  assert.equal(creates[0].opts.headers['X-Kit-Api-Key'], KEY);
  assert.deepEqual(JSON.parse(creates[0].opts.body), { email_address: USER.email, state: 'active' });
  assert.equal(h.row.newsletter_sync_status, 'synced');
  assert.equal(h.row.newsletter_sync_attempts, 1);
  assert.equal(h.row.newsletter_sync_attempted_at, new Date(NOW).toISOString());
});

test('synced なら Kit を呼ばない（再ログインのたびに再送しない）', async () => {
  const h = harness({ profile: completedProfile({ newsletter_sync_status: 'synced', newsletter_sync_attempts: 1 }) });
  assert.deepEqual((await h.call()).body, { ok: true, already: true });
  assert.equal(h.kitCalls().length, 0);
  assert.ok(!h.calls.some((c) => c.opts.method === 'PATCH'));
});

test('再送条件：失敗後は前回から24時間以上・3回未満のときだけ', async () => {
  const at = (msAgo) => new Date(NOW - msAgo).toISOString();
  // 1時間前に失敗 → 送らない
  const h1 = harness({ profile: completedProfile({ newsletter_sync_status: 'failed', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: at(HOUR) }) });
  assert.deepEqual((await h1.call()).body, { ok: true, skipped: 'not_due' });
  assert.equal(h1.kitCalls().length, 0);
  // 25時間前に失敗 → 送る（試行2回目）
  const h2 = harness({ profile: completedProfile({ newsletter_sync_status: 'failed', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: at(25 * HOUR) }) });
  assert.deepEqual((await h2.call()).body, { ok: true });
  assert.equal(h2.kitCreates().length, 1);
  assert.equal(h2.row.newsletter_sync_attempts, 2);
  assert.equal(h2.row.newsletter_sync_status, 'synced');
  // 3回失敗済み → 何日たっても送らない
  const h3 = harness({ profile: completedProfile({ newsletter_sync_status: 'failed', newsletter_sync_attempts: 3, newsletter_sync_attempted_at: at(30 * 24 * HOUR) }) });
  assert.deepEqual((await h3.call()).body, { ok: true, skipped: 'not_due' });
  assert.equal(h3.kitCalls().length, 0);
});

test('syncDue：判定表', () => {
  const p = (x) => completedProfile(x);
  assert.equal(syncDue(p({}), NOW), true);
  assert.equal(syncDue(p({ newsletter_sync_status: 'synced', newsletter_sync_attempts: 1 }), NOW), false);
  assert.equal(syncDue(p({ newsletter_sync_attempts: 1, newsletter_sync_attempted_at: new Date(NOW - 23 * HOUR).toISOString() }), NOW), false);
  assert.equal(syncDue(p({ newsletter_sync_attempts: 2, newsletter_sync_attempted_at: new Date(NOW - 24 * HOUR).toISOString() }), NOW), true);
  assert.equal(syncDue(p({ newsletter_sync_attempts: 3, newsletter_sync_attempted_at: null }), NOW), false);
  assert.equal(syncDue(p({ newsletter_sync_attempts: 1, newsletter_sync_attempted_at: null }), NOW), true);
});

test('同時に2回呼ばれても Kit 作成は1回（試行の権利を条件付き更新で取る）', async () => {
  const h = harness();
  const [a, b] = await Promise.all([h.call(), h.call()]);
  const bodies = [a.body, b.body];
  assert.equal(h.kitCreates().length, 1);
  assert.ok(bodies.some((x) => x && x.ok === true && !x.skipped));
  assert.ok(bodies.some((x) => x && x.skipped === 'in_progress'));
  assert.equal(h.row.newsletter_sync_attempts, 1);
});

test('試行の権利を記録できなければ Kit を呼ばない（500）', async () => {
  const s = silenceErrors();
  try {
    const h = harness({ claimStatus: 500 });
    const r = await h.call();
    assert.equal(r.code, 500);
    assert.equal(h.kitCalls().length, 0);
  } finally { s.restore(); }
});

test('KIT_API_KEY 未設定なら Kit を呼ばず failed を記録し、秘密を漏らさない', async () => {
  const s = silenceErrors();
  let h, r;
  try {
    h = harness({ env: { KIT_API_KEY: '' } });
    r = await h.call();
  } finally { s.restore(); }
  assert.equal(r.code, 503); assert.deepEqual(r.body, { error: 'kit_not_configured' });
  assert.equal(h.kitCalls().length, 0);
  assert.equal(h.row.newsletter_sync_status, 'failed');
  assert.equal(h.row.newsletter_sync_attempts, 1);
  assert.ok(!s.logs.join('\n').includes(PROD_ENV.SUPABASE_SERVICE_ROLE_KEY));
});

test('Kit 4xx/5xx は 502・failed を記録。レスポンス・ログにメール・秘密・Kit本文を出さない', async () => {
  for (const opts of [{ kitCreateStatus: 422 }, { kitCreateStatus: 500 }, { kitLookupStatus: 503 }]) {
    const s = silenceErrors();
    let h, r;
    try { h = harness(opts); r = await h.call(); } finally { s.restore(); }
    assert.equal(r.code, 502); assert.deepEqual(r.body, { error: 'kit_error' });
    assert.equal(h.row.newsletter_sync_status, 'failed');
    const all = s.logs.join('\n') + JSON.stringify(r.body);
    for (const secret of [USER.email, KEY, PROD_ENV.SUPABASE_SERVICE_ROLE_KEY, 'good-token']) assert.ok(!all.includes(secret), secret);
  }
});

test('配信停止済み（active 以外）は再登録せず skipped', async () => {
  for (const state of ['cancelled', 'inactive', 'bounced', 'complained']) {
    const h = harness({ kitLookup: { subscribers: [{ id: 9, email_address: USER.email, state }] } });
    const r = await h.call();
    assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true, skipped: 'not_reactivated' });
    assert.equal(h.kitCreates().length, 0, state);
    assert.equal(h.row.newsletter_sync_status, 'skipped');
  }
});

test('既に active なら作り直さず synced。2回目は Kit も呼ばない', async () => {
  const h = harness({ kitLookup: { subscribers: [{ id: 9, email_address: USER.email, state: 'active' }] } });
  assert.deepEqual((await h.call()).body, { ok: true, already: true });
  assert.equal(h.row.newsletter_sync_status, 'synced');
  const before = h.kitCalls().length;
  assert.deepEqual((await h.call()).body, { ok: true, already: true });
  assert.equal(h.kitCalls().length, before);
  assert.equal(h.kitCreates().length, 0);
});

test('メールアドレスを取得できない（X など）なら Kit を呼ばず skipped', async () => {
  const h = harness({ user: { id: 'user-1' } });
  const r = await h.call();
  assert.equal(r.code, 200); assert.deepEqual(r.body, { ok: true, skipped: 'email_unavailable' });
  assert.equal(h.kitCalls().length, 0);
  assert.equal(h.row.newsletter_sync_status, 'skipped');
});

test('Preview ガード：許可リストに無いメールは Kit を呼ばず skipped／許可したテスト用メールだけ送る', async () => {
  const h1 = harness({ env: { ...PREVIEW_ENV, KIT_PREVIEW_ALLOWED_EMAILS: '' } });
  const r1 = await h1.call();
  assert.deepEqual(r1.body, { ok: true, skipped: 'preview_guard' });
  assert.equal(h1.kitCalls().length, 0);
  assert.equal(h1.row.newsletter_sync_status, 'skipped');
  // 環境不明は環境ガードで止める（503）。Supabase・Kit のどちらにも接続しない
  const s = silenceErrors();
  let r2, h2;
  try { h2 = harness({ env: { VERCEL_ENV: undefined } }); r2 = await h2.call(); } finally { s.restore(); }
  assert.equal(r2.code, 503);
  assert.equal(r2.body.error, 'service_unavailable');
  assert.equal(h2.calls.length, 0);
  const h3 = harness({ env: { ...PREVIEW_ENV, KIT_PREVIEW_ALLOWED_EMAILS: 'someone@x.test, OWNER@example.test' } });
  assert.deepEqual((await h3.call()).body, { ok: true });
  assert.equal(h3.kitCreates().length, 1);
});

test('POST 以外は 405', async () => {
  assert.equal((await harness().call({ method: 'GET' })).code, 405);
});
