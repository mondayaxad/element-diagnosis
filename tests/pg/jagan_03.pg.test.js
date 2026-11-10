// 【実PGの試験】邪眼完全解析（jagan_03）：解析レポート（¥1,000）と完全解析（¥3,000）を同じ注文の仕組みで扱う。
//   jagan_01 → jagan_02 → jagan_03 を使い捨てDBに適用し、商品ごとの金額・権利・二重適用の停止・権限を確かめる。
//   実行: E2E_PG=1 node --test tests/pg/jagan_03.pg.test.js（docs/TESTING_PG.md）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('./pg_env');
const { SQL, createDb, run, fingerprint, dropDb } = require('./jagan_fixture');
const SKIP = pg.enabled() ? false : 'E2E_PG=1 が無いため skip（実PGの試験）';
const J1 = SQL('20261102120000_jagan_01_results_shares.sql');
const J2 = SQL('20261107120000_jagan_02_orders_links_registrations.sql');
const J3 = SQL('20261110120000_jagan_03_complete_product.sql');

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', RF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const K = (n) => 'jo_' + String(n).repeat(40).slice(0, 40);
const H = (n) => String(n).repeat(64).slice(0, 64);
const one = (db, q) => pg.sql(db, q).split('\n').filter(Boolean).pop();
const svc = (db, q) => pg.sql(db, `begin; set local role service_role; ${q}; commit;`).split('\n').filter((l) => l && !/^(BEGIN|SET|COMMIT)$/.test(l)).pop();

function ready() {
  const db = createDb('preview');
  run(db, J1);
  pg.sql(db, `insert into auth.users values ('${A}'), ('${B}');
    insert into public.profiles values ('${A}', 'completed'), ('${B}', 'completed');
    insert into public.jagan_results (result_id, user_id, schema_version, engine_version, item_set_version, scoring_version, interpretation_version,
      character_model_version, dti_code, naming_version, answers, snapshot, headline)
    values ('${R1}', '${A}', 'jagan-result-3', 'e', 'i', 's', 'p', 'c', 'ANWD', 'n', '{"q":1}', '{}', '{"element":"風"}');`);
  run(db, J2);
  return db;
}
const order = (db, buyer, key, hash, product) => svc(db, `select order_id from public.jagan_create_order('${R1}', 'i', '{"q":1}', 'ANWD', '{"element":"風"}', ${buyer ? `'${buyer}'` : 'null'}, 'test', '${key}', '${hash}', '${product}')`);
const open = (db, o, n) => svc(db, `select public.jagan_mark_checkout_open('${o}', 'cs_test_${String(n).repeat(20)}')`);
const pay = (db, o, n, amount) => svc(db, `select public.jagan_apply_payment('${o}', 'cs_test_${String(n).repeat(20)}', 'pi_${'x'.repeat(10)}', ${amount}, 'jpy', 'paid', false)`);
const ents = (db, u, r) => one(db, `select coalesce(string_agg(product_key||'='||status, ',' order by product_key), '-') from public.jagan_entitlements where user_id='${u}' and result_id='${r}'`);

test('jagan_03：jagan_02 の上に適用でき、二度目・Preview 以外では何も変えずに止まる', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, J3);
    assert.equal(one(db, "select count(*) from supabase_migrations.schema_migrations where version='20261110120000'"), '1');
    const before = fingerprint(db);
    assert.throws(() => run(db, J3), /jagan_03 is already recorded/);
    assert.equal(fingerprint(db), before);
  } finally { dropDb(db); }
  const p = createDb('production');
  try { assert.throws(() => run(p, J3), /not a preview database/); } finally { dropDb(p); }
});

test('商品ごとの金額：完全解析は 3,000円、解析レポートは 1,000円。違う金額の支払いは反映しない。知らない商品は断る', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, J3);
    const c = order(db, A, K(1), H(1), 'jagan_complete_v1');
    assert.equal(one(db, `select product_key||':'||amount from public.jagan_orders where id='${c}'`), 'jagan_complete_v1:3000');
    open(db, c, 1);
    assert.equal(pay(db, c, 1, 1000), 'ignored:amount_mismatch');
    const c2 = order(db, A, K(2), H(2), 'jagan_complete_v1');
    open(db, c2, 2);
    assert.equal(pay(db, c2, 2, 3000), 'applied');
    assert.equal(ents(db, A, R1), 'jagan_complete_v1=active', '完全解析だけ（解析レポートの権利は無い）');
    const r = order(db, A, K(3), H(3), 'jagan_report_v1');
    open(db, r, 3);
    assert.equal(pay(db, r, 3, 1000), 'applied');
    assert.equal(ents(db, A, R1), 'jagan_complete_v1=active,jagan_report_v1=active', '両方の権利（COMPLETE）');
    // 同じ冪等キーで別の商品は拒否
    assert.throws(() => order(db, A, K(3), H(3), 'jagan_complete_v1'), /jagan_idempotency_conflict/);
    assert.throws(() => order(db, A, K(4), H(4), 'gold'), /jagan_invalid_request/);
    // 完全解析の返金は、完全解析の権利だけを止める
    svc(db, `select public.jagan_apply_reversal('${c2}', 'refunded')`);
    assert.equal(ents(db, A, R1), 'jagan_complete_v1=refunded,jagan_report_v1=active');
  } finally { dropDb(db); }
});

test('固有リンクからの登録（別のアカウント）は、その注文の商品の権利だけを作る。既存の解析レポートの注文はそのまま', { skip: SKIP }, () => {
  const db = ready();
  try {
    // jagan_03 の前に作った解析レポートの注文（旧い署名）
    const old = svc(db, `select order_id from public.jagan_create_order('${R1}', 'i', '{"q":1}', 'ANWD', '{"element":"風"}', null, 'test', '${K(5)}', '${H(5)}')`);
    run(db, J3);
    assert.equal(one(db, `select product_key||':'||amount from public.jagan_orders where id='${old}'`), 'jagan_report_v1:1000');
    const c = order(db, null, K(6), H(6), 'jagan_complete_v1');
    open(db, c, 6);
    assert.equal(pay(db, c, 6, 3000), 'applied');
    const reg = svc(db, `select reg_result from public.jagan_register_order('${B}', '${H(6)}', '${RF}', 'jagan-result-3', 'e', 's', 'p', 'c', 'n', '{"k":1}')`);
    assert.equal(reg, 'registered');
    assert.equal(ents(db, B, RF), 'jagan_complete_v1=active');
  } finally { dropDb(db); }
});

test('ブラウザのロールは新しい注文の関数を実行できない', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, J3);
    assert.throws(() => pg.sql(db, `begin; set local role authenticated; select public.jagan_create_order('${R1}', 'i', '{}', 'ANWD', '{}', null, 'test', '${K(7)}', '${H(7)}', 'jagan_complete_v1'); rollback;`), /permission denied/);
    assert.throws(() => pg.sql(db, `begin; set local role anon; select public.jagan_refresh_entitlement('${A}', '${R1}'); rollback;`), /permission denied/);
  } finally { dropDb(db); }
});

test('支払い後の確定仕様：期限切れ・キャンセル・失敗は権利なし。決済通知の再処理で注文・権利が増えない。両方で2つの権利（COMPLETE）', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, J3);
    // 期限切れ（決済画面を閉じた）・キャンセル・決済の失敗：権利は作らない
    const e = order(db, A, K(8), H(8), 'jagan_complete_v1'); open(db, e, 8);
    assert.equal(svc(db, `select public.jagan_close_order('${e}', 'expired', 'checkout_expired')`), 'closed');
    const c = order(db, A, K(9), H(9), 'jagan_report_v1'); open(db, c, 9);
    assert.equal(svc(db, `select public.jagan_close_order('${c}', 'canceled', 'rate_limited')`), 'closed');
    const f = order(db, A, 'jo_' + 'a'.repeat(40), 'a'.repeat(64), 'jagan_report_v1'); open(db, f, 'a');
    assert.equal(svc(db, `select public.jagan_apply_payment('${f}', 'cs_test_${'a'.repeat(20)}', 'pi_${'x'.repeat(10)}', 1000, 'jpy', 'unpaid', false)`), 'ignored:payment_not_paid');
    assert.equal(ents(db, A, R1), '-', '期限切れ・キャンセル・未払いでは権利なし');
    // 1,000円を支払い → 決済通知を3回再処理しても、注文・権利は1つ
    const r = order(db, A, K(6), H(6), 'jagan_report_v1'); open(db, r, 6);
    assert.equal(pay(db, r, 6, 1000), 'applied');
    assert.equal(pay(db, r, 6, 1000), 'noop'); assert.equal(pay(db, r, 6, 1000), 'noop');
    assert.equal(ents(db, A, R1), 'jagan_report_v1=active');
    assert.equal(one(db, `select count(*) from public.jagan_entitlements where user_id='${A}'`), '1');
    assert.equal(one(db, `select count(*) from public.jagan_order_registrations where user_id='${A}'`), '1');
    // 3,000円も支払い → 2つの権利（両方＝COMPLETE）。再処理しても増えない
    const cp = order(db, A, K(7), H(7), 'jagan_complete_v1'); open(db, cp, 7);
    assert.equal(pay(db, cp, 7, 3000), 'applied'); assert.equal(pay(db, cp, 7, 3000), 'noop');
    assert.equal(ents(db, A, R1), 'jagan_complete_v1=active,jagan_report_v1=active');
    assert.equal(one(db, `select count(*) from public.jagan_entitlements where user_id='${A}'`), '2');
    assert.equal(one(db, `select count(*) from public.jagan_orders where status='paid'`), '2');
  } finally { dropDb(db); }
});
