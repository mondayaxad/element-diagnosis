// lib/server-env.js（環境ガード）の判定表のテスト。外部へは接続しない。
//   実行: node --test tests/server_env.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  parseSupabaseUrl, stripeModeFromKey, checkSupabaseEnv, checkStripeEnv, checkAnonKey,
  resolveServerKey, buildAdminHeaders, buildUserHeaders, requireServerEnv, logEnvDenied, tail,
} = require(path.join(__dirname, '..', 'lib', 'server-env.js'));
const { PROD_REF, PREVIEW_REF, PROD_ENV, PREVIEW_ENV, fakeJwt } = require('./fixtures/server_env');

const withEnv = (base, over) => {
  const e = { ...base, ...over };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
};

test('stripeModeFromKey：sk_／rk_ の live・test を判定する（rk_live_ を test と誤判定しない）', () => {
  assert.equal(stripeModeFromKey('sk_live_x'), 'live');
  assert.equal(stripeModeFromKey('rk_live_x'), 'live');
  assert.equal(stripeModeFromKey('sk_test_x'), 'test');
  assert.equal(stripeModeFromKey('rk_test_x'), 'test');
  for (const bad of ['pk_live_x', 'pk_test_x', 'live', '', undefined, null, 'xsk_live_']) {
    assert.equal(stripeModeFromKey(bad), null, String(bad));
  }
});

test('parseSupabaseUrl：https://<20文字>.supabase.co だけを認める', () => {
  assert.deepEqual(parseSupabaseUrl(`https://${PREVIEW_REF}.supabase.co`), { supabaseUrl: `https://${PREVIEW_REF}.supabase.co`, projectRef: PREVIEW_REF });
  assert.equal(parseSupabaseUrl(`https://${PREVIEW_REF}.supabase.co/`).projectRef, PREVIEW_REF);
  for (const bad of [
    `http://${PREVIEW_REF}.supabase.co`, `https://${PREVIEW_REF}.supabase.co.evil.test`,
    `https://${PREVIEW_REF}.supabase.co/rest/v1`, `https://evil.test/?${PREVIEW_REF}.supabase.co`,
    'https://short.supabase.co', `https://${PREVIEW_REF.toUpperCase()}.supabase.co`, '', undefined,
  ]) {
    assert.equal(parseSupabaseUrl(bad), null, String(bad));
  }
});

test('正しい設定：Production は本番 Ref、Preview は Preview Ref で通る', () => {
  const p = checkSupabaseEnv(PROD_ENV);
  assert.equal(p.ok, true);
  assert.equal(p.appEnv, 'production');
  assert.equal(p.projectRef, PROD_REF);
  const v = checkSupabaseEnv(PREVIEW_ENV);
  assert.equal(v.ok, true);
  assert.equal(v.appEnv, 'preview');
  assert.equal(v.supabaseUrl, `https://${PREVIEW_REF}.supabase.co`);
});

test('VERCEL_ENV=preview で本番 Ref へ接続しようとしたら止める（期待 Ref も本番に誤設定した場合を含む）', () => {
  const urlOnly = checkSupabaseEnv(withEnv(PREVIEW_ENV, { SUPABASE_URL: PROD_ENV.SUPABASE_URL }));
  assert.equal(urlOnly.ok, false);
  assert.ok(urlOnly.reasons.includes('production_ref_in_preview'));
  assert.ok(urlOnly.reasons.includes('project_ref_mismatch'));
  assert.equal(urlOnly.supabaseUrl, null);
  const both = checkSupabaseEnv(withEnv(PREVIEW_ENV, { SUPABASE_URL: PROD_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PROD_REF }));
  assert.equal(both.ok, false);
  assert.ok(both.reasons.includes('production_ref_in_preview'));
  assert.ok(both.reasons.includes('expected_ref_not_preview'));
});

test('VERCEL_ENV=production で Preview Ref へ接続しようとしたら止める', () => {
  const urlOnly = checkSupabaseEnv(withEnv(PROD_ENV, { SUPABASE_URL: PREVIEW_ENV.SUPABASE_URL }));
  assert.equal(urlOnly.ok, false);
  assert.ok(urlOnly.reasons.includes('preview_ref_in_production'));
  const both = checkSupabaseEnv(withEnv(PROD_ENV, { SUPABASE_URL: PREVIEW_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PREVIEW_REF }));
  assert.equal(both.ok, false);
  assert.ok(both.reasons.includes('preview_ref_in_production'));
  assert.ok(both.reasons.includes('expected_ref_not_production'));
});

test('環境不明（未設定・想定外の値・development の許可なし）は止める', () => {
  for (const v of [undefined, '', 'staging', 'Production', 'test']) {
    const r = checkSupabaseEnv(withEnv(PREVIEW_ENV, { VERCEL_ENV: v }));
    assert.equal(r.ok, false, String(v));
    assert.ok(r.reasons.includes('env_unknown'), String(v));
  }
  const dev = withEnv(PREVIEW_ENV, { VERCEL_ENV: 'development' });
  assert.ok(checkSupabaseEnv(dev, { host: 'localhost:3000' }).reasons.includes('env_unknown'), 'ALLOW_LOCAL_DEVELOPMENT なし');
  const devAllowed = { ...dev, ALLOW_LOCAL_DEVELOPMENT: '1' };
  assert.ok(checkSupabaseEnv(devAllowed, { host: 'preview.example.test' }).reasons.includes('env_unknown'), 'localhost 以外');
  assert.ok(checkSupabaseEnv(devAllowed).reasons.includes('env_unknown'), 'Host なし');
  const ok = checkSupabaseEnv(devAllowed, { host: 'localhost:3000' });
  assert.equal(ok.ok, true);
  assert.equal(ok.appEnv, 'development');
  assert.equal(checkSupabaseEnv(devAllowed, { host: '127.0.0.1:5173' }).ok, true);
  // development は Preview と同じ規則：本番 Ref には接続しない
  const devProd = checkSupabaseEnv({ ...devAllowed, SUPABASE_URL: PROD_ENV.SUPABASE_URL, SUPABASE_EXPECTED_PROJECT_REF: PROD_REF }, { host: 'localhost' });
  assert.equal(devProd.ok, false);
  assert.ok(devProd.reasons.includes('production_ref_in_preview'));
});

test('期待 Ref・本番 Ref・Preview Ref・URL の未設定や形式不正は止める', () => {
  for (const [name, code] of [
    ['SUPABASE_EXPECTED_PROJECT_REF', 'expected_ref'],
    ['SUPABASE_PRODUCTION_PROJECT_REF', 'production_ref'],
    ['SUPABASE_PREVIEW_PROJECT_REF', 'preview_ref'],
  ]) {
    for (const base of [PROD_ENV, PREVIEW_ENV]) {
      const missing = checkSupabaseEnv(withEnv(base, { [name]: undefined }));
      assert.equal(missing.ok, false);
      assert.ok(missing.reasons.includes(`${code}_missing`), `${name} ${base.VERCEL_ENV}`);
      const invalid = checkSupabaseEnv(withEnv(base, { [name]: 'not-a-ref' }));
      assert.ok(invalid.reasons.includes(`${code}_invalid`));
    }
  }
  assert.ok(checkSupabaseEnv(withEnv(PREVIEW_ENV, { SUPABASE_URL: undefined })).reasons.includes('supabase_url_missing'));
  assert.ok(checkSupabaseEnv(withEnv(PREVIEW_ENV, { SUPABASE_URL: 'https://supabase.test' })).reasons.includes('supabase_url_invalid'));
});

test('URL の Ref と期待 Ref の不一致・本番 Ref と Preview Ref が同じ値は止める', () => {
  const other = 'otherref000000000000';
  const r = checkSupabaseEnv(withEnv(PREVIEW_ENV, { SUPABASE_URL: `https://${other}.supabase.co` }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('project_ref_mismatch'));
  assert.ok(r.reasons.includes('preview_ref_mismatch'));
  const same = checkSupabaseEnv(withEnv(PREVIEW_ENV, { SUPABASE_PRODUCTION_PROJECT_REF: PREVIEW_REF }));
  assert.equal(same.ok, false);
  assert.ok(same.reasons.includes('ref_config_conflict'));
});

test('Stripe：Preview＝Test、Production＝Live を STRIPE_MODE とキーの両方で確かめる', () => {
  assert.deepEqual(checkStripeEnv(PREVIEW_ENV, 'preview'), { ok: true, mode: 'test', reasons: [] });
  assert.deepEqual(checkStripeEnv(PROD_ENV, 'production'), { ok: true, mode: 'live', reasons: [] });
  assert.equal(checkStripeEnv({ ...PREVIEW_ENV, STRIPE_SECRET_KEY: 'rk_test_x' }, 'preview').ok, true);
  assert.equal(checkStripeEnv({ ...PROD_ENV, STRIPE_SECRET_KEY: 'rk_live_x' }, 'production').mode, 'live');

  const cases = [
    [{ ...PREVIEW_ENV, STRIPE_SECRET_KEY: 'rk_live_x' }, 'preview', 'stripe_key_env_mismatch'],
    [{ ...PREVIEW_ENV, STRIPE_SECRET_KEY: 'sk_live_x' }, 'preview', 'stripe_key_mode_mismatch'],
    [{ ...PREVIEW_ENV, STRIPE_MODE: 'live' }, 'preview', 'stripe_mode_env_mismatch'],
    [{ ...PROD_ENV, STRIPE_SECRET_KEY: 'sk_test_x' }, 'production', 'stripe_key_env_mismatch'],
    [{ ...PROD_ENV, STRIPE_MODE: 'test' }, 'production', 'stripe_mode_env_mismatch'],
    [withEnv(PROD_ENV, { STRIPE_MODE: undefined }), 'production', 'stripe_mode_missing'],
    [{ ...PROD_ENV, STRIPE_MODE: 'LIVE' }, 'production', 'stripe_mode_invalid'],
    [withEnv(PROD_ENV, { STRIPE_SECRET_KEY: undefined }), 'production', 'stripe_key_missing'],
    [{ ...PROD_ENV, STRIPE_SECRET_KEY: 'pk_live_x' }, 'production', 'stripe_key_invalid'],
    [PROD_ENV, null, 'env_unknown'],
  ];
  for (const [env, appEnv, reason] of cases) {
    const r = checkStripeEnv(env, appEnv);
    assert.equal(r.ok, false, reason);
    assert.equal(r.mode, null);
    assert.ok(r.reasons.includes(reason), `${reason}: ${r.reasons}`);
  }
});

test('公開キー：sb_publishable_ と role=anon の JWT だけ。秘密キー・service_role は拒否', () => {
  assert.deepEqual(checkAnonKey('sb_publishable_x', PREVIEW_REF), []);
  assert.deepEqual(checkAnonKey(fakeJwt({ role: 'anon', ref: PREVIEW_REF }), PREVIEW_REF), []);
  assert.deepEqual(checkAnonKey('sb_secret_x', PREVIEW_REF), ['anon_key_is_secret']);
  assert.deepEqual(checkAnonKey(fakeJwt({ role: 'service_role', ref: PREVIEW_REF }), PREVIEW_REF), ['anon_key_not_anon_role']);
  assert.deepEqual(checkAnonKey(fakeJwt({ role: 'anon', ref: PROD_REF }), PREVIEW_REF), ['anon_key_ref_mismatch']);
  assert.deepEqual(checkAnonKey('', PREVIEW_REF), ['anon_key_missing']);
  assert.deepEqual(checkAnonKey('garbage', PREVIEW_REF), ['anon_key_invalid']);
});

const LEGACY_PREVIEW = fakeJwt({ iss: 'supabase', ref: PREVIEW_REF, role: 'service_role' });

test('サーバー用キーの選択：SUPABASE_SECRET_KEY → SUPABASE_SERVICE_ROLE_KEY の順', () => {
  const both = resolveServerKey({ SUPABASE_SECRET_KEY: 'sb_secret_new', SUPABASE_SERVICE_ROLE_KEY: LEGACY_PREVIEW }, PREVIEW_REF);
  assert.equal(both.kind, 'secret');
  assert.equal(both.key, 'sb_secret_new');
  const legacy = resolveServerKey({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_PREVIEW }, PREVIEW_REF);
  assert.equal(legacy.kind, 'legacy_jwt');
  assert.equal(legacy.key, LEGACY_PREVIEW);
  // 旧変数名に新形式のキーが入っていても、形式で判定する
  assert.equal(resolveServerKey({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' }, PREVIEW_REF).kind, 'secret');
});

test('サーバー用キー：不明な形式・公開キー・anon・別プロジェクトの JWT・未設定は拒否', () => {
  const cases = [
    [{ SUPABASE_SECRET_KEY: LEGACY_PREVIEW }, 'server_key_invalid'], // 新変数には sb_secret_ だけ
    [{ SUPABASE_SECRET_KEY: 'sb_publishable_x' }, 'server_key_invalid'],
    [{ SUPABASE_SECRET_KEY: 'something_else' }, 'server_key_invalid'],
    [{ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_x' }, 'server_key_is_publishable'],
    [{ SUPABASE_SERVICE_ROLE_KEY: 'svc_plain_text' }, 'server_key_invalid'],
    [{ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'anon', ref: PREVIEW_REF }) }, 'server_key_wrong_role'],
    [{ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: PROD_REF }) }, 'server_key_ref_mismatch'],
    [{}, 'server_key_missing'],
  ];
  for (const [env, reason] of cases) {
    const r = resolveServerKey(env, PREVIEW_REF);
    assert.equal(r.kind, null, reason);
    assert.equal(r.key, null);
    assert.deepEqual(r.reasons, [reason]);
  }
});

test('管理者ヘッダー：sb_secret_ は apikey だけ（Authorization なし）、旧 service_role JWT は両方', () => {
  assert.deepEqual(buildAdminHeaders({ kind: 'secret', key: 'sb_secret_x' }), { apikey: 'sb_secret_x' });
  assert.deepEqual(buildAdminHeaders({ kind: 'legacy_jwt', key: LEGACY_PREVIEW }),
    { apikey: LEGACY_PREVIEW, Authorization: `Bearer ${LEGACY_PREVIEW}` });
  assert.throws(() => buildAdminHeaders({ kind: null, key: null }));
});

test('ログインユーザーのヘッダー：公開キー＋ユーザーの access token', () => {
  assert.deepEqual(buildUserHeaders('sb_publishable_x', 'user-jwt'), { apikey: 'sb_publishable_x', Authorization: 'Bearer user-jwt' });
});

test('requireServerEnv：Preview（新キー）・Production（旧キー）のヘッダーを返す。不合格ならヘッダー関数を返さない', () => {
  const v = requireServerEnv(PREVIEW_ENV, { admin: true, user: true });
  assert.equal(v.ok, true);
  assert.deepEqual(v.adminHeaders(), { apikey: PREVIEW_ENV.SUPABASE_SECRET_KEY });
  assert.deepEqual(v.userHeaders('tok'), { apikey: PREVIEW_ENV.SUPABASE_ANON_KEY, Authorization: 'Bearer tok' });
  const p = requireServerEnv(PROD_ENV, { admin: true, user: true });
  assert.deepEqual(p.adminHeaders(), { apikey: PROD_ENV.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${PROD_ENV.SUPABASE_SERVICE_ROLE_KEY}` });
  // ユーザー確認が必要な API で公開キーが無ければ止める
  const noAnon = requireServerEnv(withEnv(PREVIEW_ENV, { SUPABASE_ANON_KEY: undefined }), { admin: true, user: true });
  assert.equal(noAnon.ok, false);
  assert.ok(noAnon.reasons.includes('anon_key_missing'));
  assert.equal(noAnon.adminHeaders, undefined);
  assert.equal(noAnon.userHeaders, undefined);
  // 公開キーの欄にサーバー用キーを入れた場合も止める
  const secretAsAnon = requireServerEnv({ ...PREVIEW_ENV, SUPABASE_ANON_KEY: PREVIEW_ENV.SUPABASE_SECRET_KEY }, { admin: true, user: true });
  assert.ok(secretAsAnon.reasons.includes('anon_key_is_secret'));
  // 結果オブジェクトを JSON にしてもキーは出ない（ヘッダーは関数の中にだけある）
  assert.ok(!JSON.stringify(v).includes(PREVIEW_ENV.SUPABASE_SECRET_KEY));
  assert.ok(!JSON.stringify(p).includes(PROD_ENV.SUPABASE_SERVICE_ROLE_KEY));
});

test('requireServerEnv：必要な検査をまとめ、REPORT_TOKEN_SECRET の未設定も止める', () => {
  assert.equal(requireServerEnv(PREVIEW_ENV, { stripe: true, reportSecret: true }).ok, true);
  assert.equal(requireServerEnv(PREVIEW_ENV, { stripe: true }).stripeMode, 'test');
  const noSecret = requireServerEnv(withEnv(PROD_ENV, { REPORT_TOKEN_SECRET: undefined }), { reportSecret: true });
  assert.equal(noSecret.ok, false);
  assert.ok(noSecret.reasons.includes('report_token_secret_missing'));
  const wrongStripe = requireServerEnv({ ...PREVIEW_ENV, STRIPE_SECRET_KEY: 'rk_live_x' }, { stripe: true });
  assert.equal(wrongStripe.ok, false);
  assert.equal(wrongStripe.supabaseUrl, null, '一部でも通らなければ接続先を返さない');
});

test('拒否ログ：理由コード・環境名・Ref 末尾4文字・照合IDだけ（URL・キー・Ref 全文を出さない）', () => {
  const lines = [];
  const env = withEnv(PREVIEW_ENV, { SUPABASE_URL: PROD_ENV.SUPABASE_URL, SUPABASE_SECRET_KEY: 'sb_secret_SHOULD_NOT_LEAK', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_ALSO_NOT' });
  const r = requireServerEnv(env, { stripe: true, reportSecret: true });
  const id = logEnvDenied('test-api', r, { error: (s) => lines.push(s) });
  assert.equal(lines.length, 1);
  const log = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(log).sort(), ['api', 'env', 'event', 'incident_id', 'reasons', 'ref_tail']);
  assert.equal(log.event, 'env_guard_denied');
  assert.equal(log.incident_id, id);
  assert.equal(log.ref_tail, PROD_REF.slice(-4));
  for (const secret of [PROD_REF, PROD_ENV.SUPABASE_URL, 'sb_secret_', PREVIEW_ENV.STRIPE_SECRET_KEY,
    PREVIEW_ENV.REPORT_TOKEN_SECRET, PREVIEW_ENV.SUPABASE_ANON_KEY]) {
    assert.ok(!lines[0].includes(secret), secret);
  }
  assert.equal(tail('cs_test_abcdefghijklmnop'), '…klmnop');
  assert.equal(tail('abc'), '***');
});
