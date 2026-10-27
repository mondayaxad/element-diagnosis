// 旧購入者保護（S0）：DB 障害時の旧形式リンク（legacy_floor）。
//   ・legacy_floor だけは、DB への接続・照合が一時的に失敗しても表示する（現行 main と同じ。DB 由来の権限は付けない）
//   ・DB に届いて停止・取消・返金が確かめられた時は表示しない（もう一方の照合が失敗していても）
//   ・verify・マイページ／ゲストの再発行・固有リンクは、DB 障害時に 503
//   ・署名・期限・復号・環境の不一致は DB に関係なく 403
//   ・ログ・応答に URL・トークン・診断コード・ハッシュ・利用者 ID を出さない
// すべて偽物（偽の鍵・偽の Supabase）。外部へは接続しない。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { PROD_ENV } = require('./fixtures/server_env');
const reportData = require('../api/report-data.js');

const SECRET = PROD_ENV.REPORT_TOKEN_SECRET;
const DAY = 86400000;

function sign(payload, secret = SECRET) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`;
}
// /api/verify.js の encryptDiagnosisCode と同じ形式（HKDF → AES-256-GCM）
function enc(code, secret = SECRET) {
  const key = Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'report-token-code-encryption-v1', 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(code, 'utf8'), c.final()]);
  return { iv: iv.toString('base64url'), tag: c.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}
const hashOf = (ref) => crypto.createHash('sha256').update(ref).digest('hex');

// 旧形式（2026-08-09〜：有効期限100年・平文の診断コード・purchase なし）
const legacyFloorToken = (code, over = {}) => sign({ exp: Date.now() + 100 * 365 * DAY, code, ...over });
// 新形式の旧購入（2026-09-22〜：purchase ブロック・enc）
const verifyToken = (ref) => sign({ exp: Date.now() + 100 * 365 * DAY, env: 'production', diagnosis_version: 'ETI-2.0',
  purchase: { transaction_id: 'abcdef0123456789', product_id: 'core1', value: 1000, currency: 'jpy' }, enc: enc(ref) });
const UID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const DID = '33333333-3333-4333-8333-333333333333';

// 偽の Supabase：表ごとに応答を決める。'down'＝接続失敗（例外）、数値＝その HTTP ステータス、配列＝行
function fakeDb(plan = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    calls.push(table);
    const p = Object.prototype.hasOwnProperty.call(plan, table) ? plan[table] : (plan.default !== undefined ? plan.default : []);
    if (p === 'down') throw new TypeError('fetch failed');
    if (typeof p === 'number') return { ok: false, status: p, json: async () => ({ message: 'unavailable' }) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(p)) };
  };
  return { calls, fetchImpl };
}

async function open(token, db) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(' '));
  try {
    const res = { code: 0, body: undefined, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
    await reportData.createHandler({ env: PROD_ENV, fetchImpl: db.fetchImpl })({ method: 'GET', query: { token }, headers: {} }, res);
    return { res, logs: logs.join('\n') };
  } finally {
    console.error = orig;
  }
}

function assertNoLeak(text, ...secrets) {
  for (const s of secrets) assert.ok(!text.includes(s), `leaked: ${s.slice(0, 12)}…`);
}

test('legacy_floor：DB が正常で旧購入の行が無い → 表示（従来どおり）', async () => {
  const { res } = await open(legacyFloorToken('OLDCODE1'), fakeDb());
  assert.equal(res.code, 200);
  assert.equal(res.body.code, 'OLDCODE1');
  assert.deepEqual(res.body.entitlements, { core_analysis_access: true, journey_report_access: false });
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

for (const [name, plan] of [
  ['DB へ接続できない（全体が down）', { default: 'down' }],
  ['DB が 503 を返す', { default: 503 }],
  ['旧購入の照合だけ失敗（停止の照合は「停止なし」）', { purchase_entitlements: 'down', legacy_access_blocks: [] }],
  ['停止の照合だけ失敗（旧購入の行は無い）', { purchase_entitlements: [], legacy_access_blocks: 500 }],
  ['停止の照合だけ失敗（有効な旧購入あり）', { purchase_entitlements: [{ product_type: 'core1', status: 'active' }], legacy_access_blocks: 'down' }],
]) {
  test(`S0 legacy_floor：${name} → CORE1 だけ表示（DB 由来の権限は付けない）。ログに秘密値を出さない`, async () => {
    const token = legacyFloorToken('OLDCODE2');
    const { res, logs } = await open(token, fakeDb(plan));
    assert.equal(res.code, 200);
    assert.equal(res.body.code, 'OLDCODE2');
    assert.deepEqual(res.body.entitlements, { core_analysis_access: true, journey_report_access: false });
    assert.equal(res.body.viewer, 'legacy');
    assert.match(logs, /legacy_floor served without DB confirmation/);
    assertNoLeak(logs + JSON.stringify(res.headers), token, 'OLDCODE2', hashOf('OLDCODE2'));
  });
}

for (const [name, plan] of [
  ['DB に届いて運営者の停止を確認（旧購入の照合は失敗）', { purchase_entitlements: 'down', legacy_access_blocks: [{ diagnosis_code_hash: hashOf('OLDCODE3') }] }],
  ['DB に届いて運営者の停止を確認（旧購入の照合も成功）', { purchase_entitlements: [{ product_type: 'core1', status: 'active' }], legacy_access_blocks: [{ diagnosis_code_hash: hashOf('OLDCODE3') }] }],
  ['DB に届いて返金済み（有効な行が無い）を確認（停止の照合は失敗）', { purchase_entitlements: [{ product_type: 'core1', status: 'revoked' }], legacy_access_blocks: 'down' }],
]) {
  test(`S0 legacy_floor：${name} → 表示しない（403）`, async () => {
    const { res } = await open(legacyFloorToken('OLDCODE3'), fakeDb(plan));
    assert.equal(res.code, 403);
    assert.equal(res.body.code, undefined);
  });
}

test('legacy_floor：DB が正常なら DB 由来の権限（journey）も従来どおり付く', async () => {
  const { res } = await open(legacyFloorToken('OLDCODE4'), fakeDb({ purchase_entitlements: [{ product_type: 'complete', status: 'active' }], legacy_access_blocks: [] }));
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.entitlements, { core_analysis_access: true, journey_report_access: true });
});

test('verify（新形式の旧購入）：DB に有効な行があれば表示・無ければ 403・DB 障害時は 503（S0 の例外を使わない）', async () => {
  const ref = 'v2_NEWOLD1';
  const ok = await open(verifyToken(ref), fakeDb({ purchase_entitlements: [{ product_type: 'core1', status: 'active' }], legacy_access_blocks: [] }));
  assert.equal(ok.res.code, 200);
  assert.equal(ok.res.body.code, 'NEWOLD1');
  assert.equal((await open(verifyToken(ref), fakeDb({ purchase_entitlements: [], legacy_access_blocks: [] }))).res.code, 403);
  for (const plan of [{ default: 'down' }, { default: 503 }, { purchase_entitlements: [{ product_type: 'core1', status: 'active' }], legacy_access_blocks: 'down' }]) {
    const r = await open(verifyToken(ref), fakeDb(plan));
    assert.equal(r.res.code, 503, JSON.stringify(plan));
    assert.equal(r.res.body.code, undefined);
  }
});

test('マイページ・ゲストの再発行、固有リンク（delivery）：DB 障害時は 503（DB の権利を必要とする購入）', async () => {
  const tokens = [
    sign({ exp: Date.now() + DAY, env: 'production', diagnosis_version: 'ETI-2.0', access_mode: 'mypage_entitlement_reissue', sid: SID, uid: UID, enc: enc('v2_ABC') }),
    sign({ exp: Date.now() + DAY, env: 'production', diagnosis_version: 'ETI-2.0', access_mode: 'guest_entitlement_reissue', sid: SID, enc: enc('v2_ABC') }),
    sign({ exp: Date.now() + DAY, env: 'production', diagnosis_version: 'ETI-2.0', access_mode: 'delivery', did: DID, sid: SID, enc: enc('v2_ABC') }),
  ];
  for (const t of tokens) {
    for (const plan of [{ default: 'down' }, { default: 503 }]) {
      const r = await open(t, fakeDb(plan));
      assert.equal(r.res.code, 503);
      assert.equal(r.res.body.code, undefined);
    }
  }
});

test('署名・期限・復号・環境の不一致は、DB の状態に関係なく表示しない（DB へ問い合わせない）', async () => {
  const cases = [
    legacyFloorToken('OLDCODE5').slice(0, -2) + 'xx', // 署名の改ざん
    sign({ exp: Date.now() + DAY, code: 'OLDCODE5' }, 'another-secret-not-the-production-one'), // 別の鍵
    sign({ exp: Date.now() - 1000, code: 'OLDCODE5' }), // 期限切れ
    sign({ exp: Date.now() + DAY, env: 'production', diagnosis_version: 'ETI-2.0', purchase: { transaction_id: 'x' }, enc: enc('v2_X', 'wrong-key') }), // 復号失敗
    sign({ exp: Date.now() + DAY, env: 'preview', code: 'OLDCODE5' }), // 別環境
    sign({ exp: Date.now() + DAY, access_mode: 'unknown_mode', code: 'OLDCODE5' }), // 不明な種類
  ];
  for (const t of cases) {
    const db = fakeDb({ default: 'down' });
    const { res } = await open(t, db);
    assert.equal(res.code, 403);
    assert.equal(res.body.code, undefined);
    assert.deepEqual(db.calls, []);
  }
});

test('2026-07-25〜08-08 の24時間トークン（期限切れ）は従来どおり開けない／08-09 以降の100年トークンは開ける', async () => {
  assert.equal((await open(sign({ exp: Date.now() - DAY, code: 'OLD24H' }), fakeDb())).res.code, 403);
  assert.equal((await open(sign({ exp: Date.now() + 100 * 365 * DAY, code: 'OLD100Y' }), fakeDb())).res.code, 200);
});
