// 実PG17の試験（tests/pg/*.pg.test.js）の接続設定と安全装置。
//   ・使うのは、使い捨ての PostgreSQL（ローカルの unix ソケット、または localhost のコンテナ）だけ。本番・Preview の Supabase には接続しない。
//   ・接続情報は環境変数 E2E_PG_*（リポジトリには秘密を置かない。CI のダミー値も workflow に書く）。
//   ・作るデータベース名は必ず e2e_ で始め、合成データだけを入れる。
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const enabled = () => process.env.E2E_PG === '1';
const cfg = () => ({
  host: process.env.E2E_PG_HOST || '/tmp/e2e-pg/s', // unix ソケットのディレクトリ、または localhost
  port: process.env.E2E_PG_PORT || '55440',
  user: process.env.E2E_PG_USER || 'postgres',      // ロールの作成・拡張の作成が要るため、使い捨てサーバーの superuser
  psql: process.env.E2E_PG_PSQL || 'psql',
  libPath: process.env.E2E_PG_LD_LIBRARY_PATH || '',
});

// 取り違え防止：本番・Preview の Supabase や、リモートのサーバーに向けない
function assertSafeTarget() {
  const c = cfg();
  const host = String(c.host);
  const local = host.startsWith('/') || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local) throw new Error(`E2E_PG_HOST must be a unix socket dir or localhost (got non-local host)`);
  if (/supabase\.(co|com)|pooler|amazonaws|neon\.tech/i.test(host)) throw new Error('E2E_PG_HOST must not be a hosted database');
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'REPORT_TOKEN_SECRET']) {
    if (process.env[k]) throw new Error(`${k} is set in the environment: run the PG tests in a clean environment (no app secrets)`);
  }
  return c;
}
function assertTestDb(name) {
  if (!/^e2e_[a-z0-9_]{4,40}$/.test(name)) throw new Error('database name must match ^e2e_[a-z0-9_]+$');
}

function psqlEnv(c) {
  const env = { ...process.env };
  if (c.libPath) env.LD_LIBRARY_PATH = c.libPath + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
  return env; // PGPASSWORD は呼び出し側の環境に任せる（ここでは作らない・記録しない）
}
function psqlArgs(c, db) {
  return ['-X', '-At', '-h', c.host, '-p', String(c.port), '-U', c.user, '-d', db, '-v', 'ON_ERROR_STOP=1'];
}
function sql(db, query) {
  const c = assertSafeTarget(); if (db !== 'postgres') assertTestDb(db);
  return execFileSync(c.psql, [...psqlArgs(c, db), '-c', query], { env: psqlEnv(c), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function sqlFile(db, file, { quiet = true } = {}) {
  const c = assertSafeTarget(); if (db !== 'postgres') assertTestDb(db);
  return execFileSync(c.psql, [...psqlArgs(c, db), ...(quiet ? ['-q'] : []), '-f', file], { env: psqlEnv(c), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function sqlText(db, text) {
  const c = assertSafeTarget(); assertTestDb(db);
  return execFileSync(c.psql, [...psqlArgs(c, db), '-q'], { env: psqlEnv(c), input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
const newDbName = () => 'e2e_' + crypto.randomBytes(5).toString('hex');

module.exports = { enabled, cfg, assertSafeTarget, assertTestDb, sql, sqlFile, sqlText, newDbName };
