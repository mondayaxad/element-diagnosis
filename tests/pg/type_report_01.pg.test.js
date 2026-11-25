// 【実PGの試験】タイプ別レポートの注文（type_report_01）：適用・二重適用の防止・Preview 以外での停止、
//   注文 → 決済画面 → 支払い → 再送は noop → 金額・環境の不一致 → 返金・異議申し立て → 期限切れ、権限（ブラウザのロールは触れない）、戻しの草案。
//   実行: E2E_PG=1 node --test tests/pg/type_report_01.pg.test.js（docs/TESTING_PG.md）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('./pg_env');
const { SQL, createDb, run, fingerprint, dropDb } = require('./jagan_fixture');
const SKIP = pg.enabled() ? false : 'E2E_PG=1 が無いため skip（実PGの試験）';
const APPLY = SQL('20261125120000_type_report_01_orders.sql');
const ROLLBACK = SQL('type_report_99_rollback_01_DRAFT_DO_NOT_RUN.sql');
const CODE = '0123456789abcdefghijklmnopqrstuvwxyz012345678';
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64), H3 = 'c'.repeat(64);
const K = (n) => 'to_' + String(n).repeat(40).slice(0, 40);
const CS = (n) => `cs_test_${String(n).repeat(12)}`;
const one = (db, q) => pg.sql(db, q).split('\n').filter(Boolean).pop();
// service_role として実行（API と同じ権限）
const svc = (db, q) => pg.sql(db, `begin; set local role service_role; ${q}; commit;`).split('\n').filter((l) => l && !/^(BEGIN|SET|COMMIT)$/.test(l)).pop();
const order = (db, type, key, hash) => svc(db, `select order_id || ',' || created from public.type_report_create_order('${type}', 'ETI-ITEM-2.0.0', '${CODE}', 'test', '${key}', '${hash}')`).split(',');
const pay = (db, id, cs, extra = {}) => svc(db, `select public.type_report_apply_payment('${id}', '${cs}', 'pi_${'x'.repeat(10)}', ${extra.amount ?? 1000}, '${extra.currency ?? 'jpy'}', '${extra.status ?? 'paid'}', ${extra.live ?? false})`);
const status = (db, id) => one(db, `select status from public.type_report_orders where id='${id}'`);

test('type_report_01：Preview の DB に適用できる。二度目は何も変えずに止まる。Preview 以外では何も作らずに止まる', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, APPLY);
    assert.equal(one(db, "select count(*) from supabase_migrations.schema_migrations where version='20261125120000'"), '1');
    const before = fingerprint(db);
    assert.throws(() => run(db, APPLY), /type_report_01 objects already exist/);
    assert.equal(fingerprint(db), before);
  } finally { dropDb(db); }
  const prod = createDb('production');
  try {
    assert.throws(() => run(prod, APPLY), /not a preview database/);
    assert.equal(one(prod, "select to_regclass('public.type_report_orders') is null"), 't');
  } finally { dropDb(prod); }
});

test('注文 → 決済画面 → 支払い → 再送は noop → 返金 → 異議申し立ての勝ちは返金を戻さない', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, APPLY);
    const [id, created] = order(db, 'PYSW', K(1), H1);
    assert.equal(created, 'true');
    // 同じ購入操作の再送：同じ注文
    assert.deepEqual(order(db, 'PYSW', K(1), H1), [id, 'false']);
    // 同じ冪等キーで別のタイプ：止める
    assert.throws(() => order(db, 'CRSW', K(1), H2), /type_report_idempotency_conflict/);
    assert.equal(one(db, `select product_key || ',' || amount || ',' || currency || ',' || diagnosis_code from public.type_report_orders where id='${id}'`), `eti_type_report_v1,1000,jpy,${CODE}`);
    assert.equal(svc(db, `select public.type_report_mark_checkout_open('${id}', '${CS(1)}')`), 'opened');
    assert.equal(svc(db, `select public.type_report_mark_checkout_open('${id}', '${CS(1)}')`), 'noop');
    assert.equal(pay(db, id, CS(1)), 'applied');
    assert.equal(status(db, id), 'paid');
    assert.equal(pay(db, id, CS(1)), 'noop');
    assert.equal(svc(db, `select public.type_report_apply_reversal('${id}', 'refunded')`), 'applied');
    assert.equal(status(db, id), 'refunded');
    assert.equal(svc(db, `select public.type_report_apply_reversal('${id}', 'dispute_won')`), 'noop');
    assert.equal(status(db, id), 'refunded');
  } finally { dropDb(db); }
});

test('支払いの照合：未払い・金額・通貨・環境（live）・別の決済画面は反映しない。異議申し立て → 勝ちで paid に戻る', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, APPLY);
    const [a] = order(db, 'ELSW', K(2), H1);
    svc(db, `select public.type_report_mark_checkout_open('${a}', '${CS(2)}')`);
    assert.equal(pay(db, a, CS(2), { status: 'unpaid' }), 'ignored:payment_not_paid');
    assert.equal(status(db, a), 'checkout_open');
    assert.equal(pay(db, a, CS(2), { amount: 999 }), 'ignored:amount_mismatch');
    assert.equal(status(db, a), 'failed');
    const [b] = order(db, 'ELSW', K(3), H2);
    svc(db, `select public.type_report_mark_checkout_open('${b}', '${CS(3)}')`);
    assert.equal(pay(db, b, CS(3), { live: true }), 'ignored:livemode_mismatch');
    const [c] = order(db, 'ANSW', K(4), H3);
    svc(db, `select public.type_report_mark_checkout_open('${c}', '${CS(4)}')`);
    assert.equal(pay(db, c, CS(5)), 'ignored:checkout_session_mismatch');
    const [d] = order(db, 'GEBW', K(5), 'd'.repeat(64));
    svc(db, `select public.type_report_mark_checkout_open('${d}', '${CS(6)}')`);
    assert.equal(pay(db, d, CS(6), { currency: 'usd' }), 'ignored:currency_mismatch');
    const [e] = order(db, 'DECT', K(6), 'e'.repeat(64));
    svc(db, `select public.type_report_mark_checkout_open('${e}', '${CS(7)}')`);
    assert.equal(pay(db, e, CS(7)), 'applied');
    assert.equal(svc(db, `select public.type_report_apply_reversal('${e}', 'disputed')`), 'applied');
    assert.equal(status(db, e), 'disputed');
    assert.equal(svc(db, `select public.type_report_apply_reversal('${e}', 'dispute_won')`), 'applied');
    assert.equal(status(db, e), 'paid');
  } finally { dropDb(db); }
});

test('期限切れ・中止：未払いの注文だけ閉じる。期限切れの後に支払われた決済は納品する。支払い済みは閉じない', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, APPLY);
    const [a] = order(db, 'HYPL', K(7), H1);
    svc(db, `select public.type_report_mark_checkout_open('${a}', '${CS(8)}')`);
    assert.equal(svc(db, `select public.type_report_close_order('${a}', 'expired', 'checkout_expired')`), 'closed');
    assert.equal(pay(db, a, CS(8)), 'applied');
    assert.equal(status(db, a), 'paid');
    assert.equal(svc(db, `select public.type_report_close_order('${a}', 'canceled', 'rate_limited')`), 'noop');
    assert.throws(() => svc(db, `select public.type_report_close_order('${a}', 'paid', null)`), /type_report_invalid_request/);
  } finally { dropDb(db); }
});

test('権限：ブラウザのロール（anon・authenticated）は表も関数も使えない。RLS が有効', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, APPLY);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(one(db, `select has_table_privilege('${role}', 'public.type_report_orders', 'SELECT')`), 'f');
      assert.equal(one(db, `select has_function_privilege('${role}', 'public.type_report_apply_payment(uuid, text, text, integer, text, text, boolean)', 'EXECUTE')`), 'f');
      assert.throws(() => pg.sql(db, `begin; set local role ${role}; select public.type_report_create_order('PYSW', 'i', '${CODE}', 'test', '${K(8)}', '${H1}'); commit;`), /permission denied/);
    }
    assert.equal(one(db, "select relrowsecurity from pg_class where oid='public.type_report_orders'::regclass"), 't');
    // 形の違う値は表の制約で止まる
    assert.throws(() => svc(db, `select public.type_report_create_order('XXSW', 'i', '${CODE}', 'test', '${K(9)}', '${H1}')`), /type_report_orders_type_code_check|violates check constraint/);
  } finally { dropDb(db); }
});

test('戻しの草案：支払い済みの注文があれば止まる。無ければ表・関数・履歴を消す', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, APPLY);
    const [a] = order(db, 'PYCM', K(1), H1);
    svc(db, `select public.type_report_mark_checkout_open('${a}', '${CS(1)}')`);
    pay(db, a, CS(1));
    assert.throws(() => run(db, ROLLBACK), /paid type report orders exist/);
    pg.sql(db, `delete from public.type_report_orders`);
    run(db, ROLLBACK);
    assert.equal(one(db, "select to_regclass('public.type_report_orders') is null"), 't');
    assert.equal(one(db, "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'type\\_report\\_%'"), '0');
    assert.equal(one(db, "select count(*) from supabase_migrations.schema_migrations where version='20261125120000'"), '0');
  } finally { dropDb(db); }
});
