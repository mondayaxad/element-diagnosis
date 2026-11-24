// tests/support/run_full.sh・tests/pg/run_all.sh の安全装置の試験：拒否すべき接続先・環境では、psql を一度も起動せずに止まる。
//   ・本物の DB には接続しない。psql の代わりに「呼ばれたら記録して失敗する」偽物を、E2E_PG_PSQL と PATH の先頭の両方に置く。
//   ・対照として、許可される接続先（localhost）では偽の psql が実際に呼ばれる（＝この試験が呼び出しを検出できる）ことも確かめる。
//   ・外部 PG の指定（E2E_PG_EXTERNAL=1）だけを使う（ローカルの PG を起動しない）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let TMP, FAKE, LOG;
test.before(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-pg-guard-'));
  fs.mkdirSync(path.join(TMP, 'bin'));
  LOG = path.join(TMP, 'psql-calls.log');
  FAKE = path.join(TMP, 'bin', 'psql');
  fs.writeFileSync(FAKE, `#!/bin/sh\necho "$@" >> "${LOG}"\nexit 3\n`, { mode: 0o755 });
});
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// 実行用の最小の環境（本番の秘密・PG の接続先を変える変数は、各ケースで明示したものだけ）
function run(script, env) {
  try { fs.rmSync(LOG); } catch { /* なし */ }
  const base = { PATH: `${path.join(TMP, 'bin')}:${process.env.PATH}`, HOME: TMP, E2E_PG_PSQL: FAKE, PDF_LIBS_DIR: TMP, TESTS_OUT: path.join(TMP, 'out'), E2E_PG_EXTERNAL: '1', E2E_PG_PORT: '5432', E2E_PG_USER: 'postgres' };
  const r = spawnSync('bash', [script], { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8', timeout: 60000 });
  const calls = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, calls };
}

const REJECT = [
  { name: 'Supabase のホスト', env: { E2E_PG_HOST: 'db.abcdefghijklmnop.supabase.co' }, msg: /non-local host|hosted database/ },
  { name: 'プール（pooler）', env: { E2E_PG_HOST: 'aws-0-ap-northeast-1.pooler.supabase.com' }, msg: /non-local host|hosted database/ },
  { name: 'リモートの IP', env: { E2E_PG_HOST: '10.20.30.40' }, msg: /non-local host/ },
  { name: '任意のリモートのホスト', env: { E2E_PG_HOST: 'db.example.com' }, msg: /non-local host/ },
  { name: '接続先の指定なし', env: {}, msg: /E2E_PG_HOST is required/ },
  { name: 'localhost でも PGHOSTADDR がリモート', env: { E2E_PG_HOST: 'localhost', PGHOSTADDR: '10.20.30.40' }, msg: /PGHOSTADDR is set/ },
  { name: 'localhost でも PGSERVICE がある', env: { E2E_PG_HOST: 'localhost', PGSERVICE: 'prod' }, msg: /PGSERVICE is set/ },
  { name: '本番の秘密（SUPABASE_URL）がある', env: { E2E_PG_HOST: 'localhost', SUPABASE_URL: 'https://example.supabase.co' }, msg: /SUPABASE_URL is set/ },
  { name: '本番の秘密（STRIPE_SECRET_KEY）がある', env: { E2E_PG_HOST: 'localhost', STRIPE_SECRET_KEY: 'sk_live_dummy' }, msg: /STRIPE_SECRET_KEY is set/ },
];

for (const script of ['tests/support/run_full.sh', 'tests/pg/run_all.sh']) {
  for (const c of REJECT) {
    test(`${script}：拒否する接続先・環境（${c.name}）では psql を一度も起動せずに止まる`, () => {
      const r = run(script, c.env);
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, c.msg);
      assert.deepEqual(r.calls, [], `psql が呼ばれた: ${r.calls.join(' | ')}`);
    });
  }
  test(`${script}：対照（localhost）では検証を通り、偽の psql が実際に呼ばれる（呼び出しを検出できる）`, () => {
    const r = run(script, { E2E_PG_HOST: 'localhost' });
    assert.ok(r.calls.length >= 1, r.out);
    assert.match(r.calls[0], /-h localhost|localhost/);
  });
}
