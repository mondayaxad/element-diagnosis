// 【実PG17の試験】使い捨てDBの作成手順そのものの確認：本番相当・Preview 相当の構造が、段階ごとに最後まで適用できる。
//   実行: E2E_PG=1 node --test tests/pg/schema_smoke.pg.test.js（docs/TESTING_PG.md）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('./pg_env');
const { createProdLikeDb, createPreviewLikeDb, dropDb } = require('./db_setup');
const SKIP = pg.enabled() ? false : 'E2E_PG=1 が無いため skip（実PG17の試験）';
const has = (db, q) => pg.sql(db, `select ${q}`) === 't';

test('本番相当（baseline＋prod_01〜03＋complete_17）：構造・制約・権限', { skip: SKIP }, () => {
  const db = createProdLikeDb();
  try {
    assert.ok(has(db, "to_regclass('public.complete_legacy_bindings') is not null and to_regclass('public.legacy_access_blocks') is not null"));
    assert.match(pg.sql(db, "select pg_get_constraintdef(oid) from pg_constraint where conname='complete_legacy_bindings_match_method_check'"), /link_possession/);
    assert.ok(has(db, "has_function_privilege('service_role','public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)','EXECUTE')"));
    assert.ok(!has(db, "has_function_privilege('anon','public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)','EXECUTE')"));
    assert.ok(!has(db, "has_function_privilege('authenticated','public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)','EXECUTE')"));
    assert.ok(!has(db, "has_table_privilege('service_role','public.complete_legacy_bindings','DELETE')"), '結び付けは service_role から削除・更新できない');
    assert.ok(has(db, "(select count(*) from public.purchase_entitlements) = 9"), '合成データの旧購入は 9 件');
  } finally { dropDb(db); }
});

test('complete_17 は二度適用しても同じ（冪等）', { skip: SKIP }, () => {
  const db = createProdLikeDb();
  try {
    pg.sqlFile(db, require('path').join(__dirname, '..', '..', 'docs', 'sql', '20261029120000_complete_17_legacy_link_binding.sql'));
    assert.match(pg.sql(db, "select pg_get_constraintdef(oid) from pg_constraint where conname='complete_legacy_bindings_match_method_check'"), /link_possession/);
  } finally { dropDb(db); }
});

test('Preview 相当：complete_07・08・13・最新まで、それぞれ最後まで適用できる（既存のDB依存試験の前提の構造）', { skip: SKIP }, () => {
  for (const [upTo, table] of [[7, 'complete_orders'], [8, 'legacy_access_blocks'], [13, 'result_resume_links'], [99, 'complete_legacy_bindings']]) {
    const db = createPreviewLikeDb({ upTo });
    try { assert.ok(has(db, `to_regclass('public.${table}') is not null`), `upTo=${upTo}: ${table}`); } finally { dropDb(db); }
  }
});

test('Preview 相当（最新）にも complete_17 が入っている', { skip: SKIP }, () => {
  const db = createPreviewLikeDb({ upTo: 99 });
  try { assert.match(pg.sql(db, "select pg_get_constraintdef(oid) from pg_constraint where conname='complete_legacy_bindings_match_method_check'"), /link_possession/); } finally { dropDb(db); }
});
