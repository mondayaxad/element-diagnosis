// 【実PGの試験】邪眼診断 jagan_01 の SQL Editor 手順（jagan_00 → jagan_01 → jagan_02）を、Preview 相当の使い捨てDBで通す。
//   実行: E2E_PG=1 node --test tests/pg/jagan_01.pg.test.js（docs/TESTING_PG.md）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const pg = require('./pg_env');
const { dropDb } = require('./db_setup');
const SKIP = pg.enabled() ? false : 'E2E_PG=1 が無いため skip（実PGの試験）';
const SQL = (f) => path.join(__dirname, '..', '..', 'docs', 'sql', f);
const PRE = SQL('jagan_00_preflight_READONLY.sql'), APPLY = SQL('20261102120000_jagan_01_results_shares.sql'), POST = SQL('jagan_02_postcheck_READONLY.sql');
const { createDb, rows, run, fingerprint } = require('./jagan_fixture');
const createPreviewLikeDb = () => createDb('preview');
const createProdLikeDb = () => createDb('production');

test('jagan_00 → jagan_01 → jagan_02：未適用の Preview 相当で、確認がすべて ok になる', { skip: SKIP }, () => {
  const db = createPreviewLikeDb();
  try {
    const pre = rows(run(db, PRE));
    for (const [k, v, expect] of pre) if (!expect.startsWith('（参考') && k !== '02 database') assert.equal(v, expect, `preflight ${k}`);
    run(db, APPLY);
    const post = rows(run(db, POST));
    assert.ok(post.length >= 30, 'postcheck rows');
    for (const [k, ok, v, expect] of post) assert.equal(ok, 't', `${k}: got ${v} / expect ${expect}`);
  } finally { dropDb(db); }
});

test('jagan_01 を二度目に実行すると、何も変えずに止まる', { skip: SKIP }, () => {
  const db = createPreviewLikeDb();
  try {
    run(db, APPLY);
    const before = fingerprint(db);
    assert.throws(() => run(db, APPLY), /jagan objects already exist/);
    assert.equal(fingerprint(db), before);
  } finally { dropDb(db); }
});

test('既存の jagan_* 表があれば、上書き・削除せずに止まる（行も残る）', { skip: SKIP }, () => {
  const db = createPreviewLikeDb();
  try {
    pg.sql(db, "create table public.jagan_results (result_id uuid primary key, note text); insert into public.jagan_results values (gen_random_uuid(), 'keep')");
    const before = fingerprint(db);
    assert.throws(() => run(db, APPLY), /jagan objects already exist/);
    assert.equal(fingerprint(db), before);
    assert.equal(pg.sql(db, "select note from public.jagan_results"), 'keep');
    assert.equal(pg.sql(db, "select count(*) from supabase_migrations.schema_migrations where version='20261102120000'"), '0');
    // 適用前の確認でも見つかる
    assert.ok(rows(run(db, PRE)).some(([k, v, e]) => k.includes('table jagan_results') && v !== e));
  } finally { dropDb(db); }
});

test('Preview 以外（本番相当）では jagan_01 が止まる', { skip: SKIP }, () => {
  const db = createProdLikeDb();
  try {
    assert.throws(() => run(db, APPLY), /not a preview database/);
    assert.equal(pg.sql(db, "select to_regclass('public.jagan_results') is null"), 't');
  } finally { dropDb(db); }
});

test('適用後の RLS：本人は自分の行だけ読める・消せる。他人の行・共有の表・anon は読めない。ブラウザ側からは書けない', { skip: SKIP }, () => {
  const db = createPreviewLikeDb();
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const RA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', RB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  try {
    run(db, APPLY);
    pg.sql(db, `insert into auth.users values ('${A}'), ('${B}');
      insert into public.jagan_results (result_id, user_id, schema_version, engine_version, item_set_version, scoring_version, interpretation_version, character_model_version, dti_code, naming_version, answers, snapshot, headline)
      select r, u, 'jagan-result-3', 'e', 'i', 's', 'p', 'c', 'HYDP', 'n', '{}', '{}', '{}' from (values ('${RA}'::uuid, '${A}'::uuid), ('${RB}'::uuid, '${B}'::uuid)) v(r, u);
      insert into public.jagan_shares (public_id, result_key, summary, item_set_version) values (repeat('a', 22), repeat('0', 64), '{"kind":"jagan-public-summary-3"}', 'i');
      insert into public.jagan_entitlements (user_id, result_id, product_key, status) values ('${A}', '${RA}', 'jagan_report_v1', 'active');`);
    const one = (role, sub, q) => pg.sql(db, `begin; set local role ${role}; set local request.jwt.claim.sub = '${sub}'; ${q}; rollback;`).split('\n').filter((l) => /^\d+$/.test(l)).pop();
    assert.equal(one('authenticated', A, 'select count(*) from public.jagan_results'), '1');
    assert.equal(one('authenticated', A, `select count(*) from public.jagan_results where result_id = '${RB}'`), '0');
    assert.equal(one('authenticated', A, 'select count(*) from public.jagan_entitlements'), '1');
    assert.equal(one('authenticated', B, 'select count(*) from public.jagan_entitlements'), '0');
    assert.equal(one('authenticated', A, `with d as (delete from public.jagan_results where result_id = '${RB}' returning 1) select count(*) from d`), '0');
    assert.throws(() => one('authenticated', A, 'select count(*) from public.jagan_shares'), /permission denied/);
    assert.throws(() => one('anon', '', 'select count(*) from public.jagan_results'), /permission denied/);
    assert.throws(() => one('authenticated', A, `insert into public.jagan_entitlements (user_id, result_id, product_key, status) values ('${A}', '${RA}', 'jagan_report_v1', 'refunded')`), /permission denied/);
    assert.throws(() => one('authenticated', A, `update public.jagan_results set dti_code = 'XXXX'`), /permission denied/);
  } finally { dropDb(db); }
});
