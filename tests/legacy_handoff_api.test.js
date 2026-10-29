// 旧版（element-v1）の購入のマイページへの引き継ぎ（/api/my-report-link の op=legacy_handoff）の試験。外部へは接続しない。
//   実行: node --test tests/legacy_handoff_api.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { PREVIEW_ENV } = require('./fixtures/server_env');
const myReportLink = require(path.join(__dirname, '..', 'api', 'my-report-link.js'));

const SECRET = PREVIEW_ENV.REPORT_TOKEN_SECRET;
const CODE = 'psyya13lbcplrkxvj9cbhmxc0h5o4e30zdg12h9o8ngo8';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '44444444-4444-4444-8444-444444444444';
const SID = '22222222-2222-4222-8222-222222222222';
const ENT = '33333333-3333-4333-8333-333333333333';
const HASH = crypto.createHash('sha256').update(CODE).digest('hex');
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function enc(reference) {
  const key = Buffer.from(crypto.hkdfSync('sha256', SECRET, Buffer.alloc(0), 'report-token-code-encryption-v1', 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const d = Buffer.concat([c.update(reference, 'utf8'), c.final()]);
  return { iv: iv.toString('base64url'), tag: c.getAuthTag().toString('base64url'), data: d.toString('base64url') };
}
function sign(payload, secret = SECRET) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`;
}
const verifyToken = (over = {}) => sign({ exp: Date.now() + 1e9, env: 'preview', diagnosis_version: 'element-v1', purchase: { transaction_id: 'x' }, enc: enc(CODE), ...over });

function world(over = {}) {
  const w = Object.assign({
    ents: [{ id: ENT }], blocked: [], bindings: [],
    sessions: [{ id: SID, user_id: U1, diagnosis_version: 'element-v1', diagnosis_answers: [{ encoded_answers: CODE }] }],
    rpcStatus: 200, rpcText: '"applied"', rpcCalls: [],
  }, over);
  w.fetchImpl = async (url, opts = {}) => {
    if (url.endsWith('/auth/v1/user')) return opts.headers.Authorization === 'Bearer u1' ? json(200, { id: U1 }) : opts.headers.Authorization === 'Bearer u2' ? json(200, { id: U2 }) : json(401, {});
    if (url.includes('/rpc/complete_bind_legacy_purchase')) { w.rpcCalls.push(JSON.parse(opts.body)); return { ok: w.rpcStatus < 300, status: w.rpcStatus, json: async () => ({}), text: async () => w.rpcText }; }
    if (url.includes('/rest/v1/legacy_access_blocks')) return json(200, w.blocked);
    if (url.includes('/rest/v1/purchase_entitlements')) return json(200, url.includes(`diagnosis_code_hash=eq.${HASH}`) ? w.ents : []);
    if (url.includes('/rest/v1/diagnosis_sessions')) { const uid = (url.match(/user_id=eq\.([^&]+)/) || [])[1]; return json(200, w.sessions.filter((s) => s.user_id === uid)); }
    if (url.includes('/rest/v1/complete_legacy_bindings')) return json(200, w.bindings);
    throw new Error('unexpected fetch ' + url);
  };
  return w;
}
async function call(w, { token = verifyToken(), auth = 'Bearer u1', body } = {}) {
  const res = { code: 0, body: undefined, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
  const orig = console.error; console.error = () => {};
  try {
    await myReportLink.createHandler({ env: PREVIEW_ENV, fetchImpl: w.fetchImpl })(
      { method: 'POST', headers: auth ? { authorization: auth } : {}, body: body || { op: 'legacy_handoff', token } }, res);
  } finally { console.error = orig; }
  return res;
}

test('引き継ぎ：購入時のリンク＋ログイン中の本人の同じ診断コードの記録 → link_possession で結び付ける', async () => {
  const w = world();
  const r = await call(w);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, bound: 'applied' });
  assert.deepEqual(w.rpcCalls, [{ p_user_id: U1, p_diagnosis_session_id: SID, p_legacy_entitlement_id: ENT, p_match_method: 'link_possession' }]);
  assert.ok(!JSON.stringify(r.body).includes(CODE) && !JSON.stringify(r.body).includes(ENT), '診断コード・購入の ID を応答に出さない');
});

test('旧版の記録の diagnosis_version が空（NULL）でも引き継げる', async () => {
  const w = world({ sessions: [{ id: SID, user_id: U1, diagnosis_version: null, diagnosis_answers: [{ encoded_answers: CODE }] }] });
  const r = await call(w);
  assert.equal(r.code, 200);
  assert.equal(w.rpcCalls.length, 1);
});

test('旧形式（legacy_floor）のリンクでも引き継げる', async () => {
  const w = world();
  const r = await call(w, { token: sign({ exp: Date.now() + 1e9, code: CODE }) });
  assert.equal(r.code, 200);
  assert.equal(w.rpcCalls.length, 1);
});

test('すでに本人のこの記録に結び付いていれば、そのまま成功（何度押しても同じ）', async () => {
  const w = world({ bindings: [{ legacy_entitlement_id: ENT, user_id: U1, diagnosis_session_id: SID }] });
  const r = await call(w);
  assert.equal(r.code, 200);
  assert.equal(r.body.bound, 'already');
  assert.equal(w.rpcCalls.length, 0);
});

test('先に別の人が引き継いでいれば 409（先着の1人）。結び付けを呼ばない', async () => {
  const w = world({ bindings: [{ legacy_entitlement_id: ENT, user_id: U2, diagnosis_session_id: '55555555-5555-4555-8555-555555555555' }] });
  const r = await call(w);
  assert.equal(r.code, 409);
  assert.equal(r.body.error, 'already_bound');
  assert.equal(w.rpcCalls.length, 0);
});

test('DB 側が already_bound で拒否した競合も 409', async () => {
  const w = world({ rpcStatus: 400, rpcText: '{"message":"complete_legacy_already_bound"}' });
  const r = await call(w);
  assert.equal(r.code, 409);
  assert.equal(r.body.error, 'already_bound');
});

test('記録が未保存なら 409 record_not_saved。他の人の記録・現在の診断（v2）の同じ文字列の記録は使わない', async () => {
  for (const sessions of [
    [],
    [{ id: SID, user_id: U2, diagnosis_version: 'element-v1', diagnosis_answers: [{ encoded_answers: CODE }] }],
    [{ id: SID, user_id: U1, diagnosis_version: 'ETI-2.0', diagnosis_answers: [{ encoded_answers: CODE }] }],
  ]) {
    const w = world({ sessions });
    const r = await call(w);
    assert.equal(r.code, 409);
    assert.equal(r.body.error, 'record_not_saved');
    assert.equal(w.rpcCalls.length, 0);
  }
});

test('有効な購入が無い・運営者が停止した購入は 403', async () => {
  for (const over of [{ ents: [] }, { blocked: [{ diagnosis_code_hash: HASH }] }]) {
    const w = world(over);
    const r = await call(w);
    assert.equal(r.code, 403);
    assert.equal(w.rpcCalls.length, 0);
  }
});

test('署名の不正・期限切れ・別環境・現在の診断（v2）・マイページの再発行トークンは受け付けない', async () => {
  const bad = [
    verifyToken().replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
    verifyToken({ exp: Date.now() - 1000 }),
    verifyToken({ env: 'production' }),
    verifyToken({ diagnosis_version: 'ETI-2.0', enc: enc('v2_' + CODE) }),
    sign({ exp: Date.now() + 1e9, env: 'preview', access_mode: 'mypage_entitlement_reissue', sid: SID, uid: U1, enc: enc(CODE) }),
    sign({ exp: Date.now() + 1e9, env: 'preview', access_mode: 'delivery', did: SID, sid: SID, enc: enc(CODE) }),
    sign({ exp: Date.now() + 1e9, env: 'preview', purchase: {}, enc: enc(CODE) }, 'another-secret'),
    'not-a-token', '',
  ];
  for (const token of bad) {
    const w = world();
    const r = await call(w, { token });
    assert.equal(r.code, 403, String(token).slice(0, 20));
    assert.equal(w.rpcCalls.length, 0);
  }
});

test('ログインしていない・不正なログインは 401。結び付けを呼ばない', async () => {
  for (const auth of [null, 'Bearer nobody']) {
    const w = world();
    const r = await call(w, { auth });
    assert.equal(r.code, 401);
    assert.equal(w.rpcCalls.length, 0);
  }
});

test('別の本人（U2）が同じリンクで押しても、U2 の記録が無ければ結び付かない（U1 の記録へ付けない）', async () => {
  const w = world();
  const r = await call(w, { auth: 'Bearer u2' });
  assert.equal(r.code, 409);
  assert.equal(w.rpcCalls.length, 0);
});

test('従来のレポート再発行（diagnosis_session_id）は op なしのまま動く（401／400 の入口が変わらない）', async () => {
  const w = world();
  const r = await call(w, { body: {} });
  assert.equal(r.code, 400);
});
