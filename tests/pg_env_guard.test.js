// 実PG17の試験（tests/pg/）の安全装置の試験：本番・ホスト型DB・アプリの秘密情報が見える環境では動かない。PG が無くても実行できる。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('./pg/pg_env');

function withEnv(over, fn) {
  const saved = {};
  for (const k of Object.keys(over)) { saved[k] = process.env[k]; if (over[k] === undefined) delete process.env[k]; else process.env[k] = over[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const clean = { SUPABASE_URL: undefined, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, STRIPE_SECRET_KEY: undefined, REPORT_TOKEN_SECRET: undefined };

test('接続先：unix ソケットと localhost だけ許す', () => {
  for (const host of ['/tmp/e2e-pg/s', 'localhost', '127.0.0.1']) withEnv({ ...clean, E2E_PG_HOST: host }, () => assert.doesNotThrow(() => pg.assertSafeTarget(), host));
});
test('接続先：リモート・Supabase・ホスト型DBは拒否', () => {
  for (const host of ['db.akivoobkqcnqvdumxtmg.supabase.co', 'aws-0-ap-northeast-1.pooler.supabase.com', '10.0.0.5', 'example.neon.tech', 'prod.rds.amazonaws.com'])
    withEnv({ ...clean, E2E_PG_HOST: host }, () => assert.throws(() => pg.assertSafeTarget(), /host/i, host));
});
test('アプリの秘密情報（Supabase・Stripe・署名鍵）が環境にあれば拒否（取り違え防止）', () => {
  for (const k of Object.keys(clean)) withEnv({ ...clean, E2E_PG_HOST: '/tmp/x', [k]: 'dummy' }, () => assert.throws(() => pg.assertSafeTarget(), new RegExp(k)));
});
test('データベース名：e2e_ で始まるものだけ。本番らしい名前・SQL注入に見える名前は拒否', () => {
  assert.doesNotThrow(() => pg.assertTestDb('e2e_abcdef0123'));
  for (const n of ['postgres', 'akivoobkqcnqvdumxtmg', 'e2e_x', 'e2e_ok; drop database postgres', 'E2E_ABCDEF', 'prod_e2e_abc']) assert.throws(() => pg.assertTestDb(n), /database name/, n);
});
test('E2E_PG=1 でなければ無効（既定では PG に触れない）', () => {
  withEnv({ E2E_PG: undefined }, () => assert.equal(pg.enabled(), false));
  withEnv({ E2E_PG: '1' }, () => assert.equal(pg.enabled(), true));
});
test('リポジトリの tests/pg に、接続文字列・鍵・パスワードの実値を置いていない', () => {
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, 'pg');
  for (const f of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(text, /postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]+@/i, f + ': 接続文字列（パスワード付き）');
    assert.doesNotMatch(text, /sk_(live|test)_[A-Za-z0-9]{10,}|sb_secret_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, f + ': 鍵らしい値');
    assert.doesNotMatch(text, /akivoobkqcnqvdumxtmg/, f + ': 本番プロジェクトの識別子');
  }
});
