// テスト用の環境変数（すべて偽物）。実在の Project Ref・キーは使わない。
'use strict';

const PROD_REF = 'prodref0000000000000';
const PREVIEW_REF = 'prevref0000000000000';

// 旧形式（JWT）キーを作る。署名部分は形式だけ（検証しない値）。
function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.fakesignature`;
}

const REFS = {
  SUPABASE_PRODUCTION_PROJECT_REF: PROD_REF,
  SUPABASE_PREVIEW_PROJECT_REF: PREVIEW_REF,
};

// 本番（Vercel Production）の正しい設定。サーバー用キーは既存の旧形式（service_role JWT）を想定
const PROD_ENV = {
  VERCEL_ENV: 'production',
  SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  SUPABASE_EXPECTED_PROJECT_REF: PROD_REF,
  ...REFS,
  SUPABASE_ANON_KEY: 'sb_publishable_prod_fake_for_test',
  SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ iss: 'supabase', ref: PROD_REF, role: 'service_role' }),
  STRIPE_MODE: 'live',
  STRIPE_SECRET_KEY: 'sk_live_fake_for_test',
  REPORT_TOKEN_SECRET: 'report-secret-production-fake-for-test',
};

// Preview（release-c-preview）の正しい設定。サーバー用キーは新形式（SUPABASE_SECRET_KEY = sb_secret_）
const PREVIEW_ENV = {
  VERCEL_ENV: 'preview',
  SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
  SUPABASE_EXPECTED_PROJECT_REF: PREVIEW_REF,
  ...REFS,
  SUPABASE_ANON_KEY: 'sb_publishable_preview_fake_for_test',
  SUPABASE_SECRET_KEY: 'sb_secret_preview_fake_for_test',
  STRIPE_MODE: 'test',
  STRIPE_SECRET_KEY: 'sk_test_fake_for_test',
  REPORT_TOKEN_SECRET: 'report-secret-preview-fake-for-test',
};

// ブラウザテスト用：/api/public-config?format=js の応答（Preview 設定）
function previewPublicConfigJs() {
  return `window.__ED_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify({
    appEnv: 'preview',
    supabaseUrl: PREVIEW_ENV.SUPABASE_URL,
    supabaseAnonKey: PREVIEW_ENV.SUPABASE_ANON_KEY,
    projectRef: PREVIEW_REF,
  })});`;
}

module.exports = { PROD_REF, PREVIEW_REF, PROD_ENV, PREVIEW_ENV, fakeJwt, previewPublicConfigJs };
