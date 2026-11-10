// 【実PGの試験】邪眼解析レポートの購入（jagan_02）：SQL Editor 手順（preflight → 適用 → postcheck）と、
//   注文 → 決済画面 → 支払い（自動の登録・権利）→ 返金・異議申し立て → 固有リンクからの登録（別のアカウント）を、使い捨てDBで通す。
//   実行: E2E_PG=1 node --test tests/pg/jagan_02.pg.test.js（docs/TESTING_PG.md）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('./pg_env');
const { SQL, createDb, rows, run, fingerprint, dropDb } = require('./jagan_fixture');
const SKIP = pg.enabled() ? false : 'E2E_PG=1 が無いため skip（実PGの試験）';
const J1 = SQL('20261102120000_jagan_01_results_shares.sql');
const PRE = SQL('jagan_02_00_preflight_READONLY.sql'), APPLY = SQL('20261107120000_jagan_02_orders_links_registrations.sql'), POST = SQL('jagan_02_99_postcheck_READONLY.sql');

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', RF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
const K = (n) => 'jo_' + String(n).repeat(40).slice(0, 40);
const one = (db, q) => pg.sql(db, q).split('\n').filter(Boolean).pop();
// service_role として実行（API と同じ権限）
const svc = (db, q) => pg.sql(db, `begin; set local role service_role; ${q}; commit;`).split('\n').filter((l) => l && !/^(BEGIN|SET|COMMIT)$/.test(l)).pop();

function ready() {
  const db = createDb('preview');
  run(db, J1);
  pg.sql(db, `insert into auth.users values ('${A}'), ('${B}'), ('${C}');
    insert into public.profiles values ('${A}', 'completed'), ('${B}', 'completed'), ('${C}', 'required');
    insert into public.jagan_results (result_id, user_id, schema_version, engine_version, item_set_version, scoring_version, interpretation_version,
      character_model_version, dti_code, naming_version, answers, snapshot, headline)
    values ('${R1}', '${A}', 'jagan-result-3', 'e', 'i', 's', 'p', 'c', 'ANWD', 'n', '{"q":1}', '{}', '{"element":"風"}');`);
  return db;
}
const order = (db, rid, buyer, key, hash) => svc(db, `select order_id from public.jagan_create_order('${rid}', 'i', '{"q":1}', 'ANWD', '{"element":"風","type":"撤退"}', ${buyer ? `'${buyer}'` : 'null'}, 'test', '${key}', '${hash}')`);
const pay = (db, id, cs, extra = {}) => svc(db, `select public.jagan_apply_payment('${id}', '${cs}', 'pi_${'x'.repeat(10)}', ${extra.amount ?? 1000}, '${extra.currency ?? 'jpy'}', '${extra.status ?? 'paid'}', ${extra.live ?? false})`);
const ent = (db, u, r) => one(db, `select coalesce((select status from public.jagan_entitlements where user_id='${u}' and result_id='${r}'), '-')`);

test('jagan_02：preflight → 適用 → postcheck がすべて ok。二度目は何も変えずに止まる', { skip: SKIP }, () => {
  const db = createDb('preview');
  try {
    run(db, J1);
    for (const [k, ok, v, e] of rows(run(db, PRE))) assert.equal(ok, 't', `preflight ${k}: ${v} / ${e}`);
    run(db, APPLY);
    const post = rows(run(db, POST));
    assert.ok(post.length >= 30, 'postcheck rows');
    for (const [k, ok, v, e] of post) assert.equal(ok, 't', `${k}: got ${v} / expect ${e}`);
    const before = fingerprint(db);
    assert.throws(() => run(db, APPLY), /jagan_02 objects already exist/);
    assert.equal(fingerprint(db), before);
  } finally { dropDb(db); }
});

test('jagan_02：jagan_01 が無い・Preview でない DB では何も作らずに止まる', { skip: SKIP }, () => {
  const a = createDb('preview');
  try { assert.throws(() => run(a, APPLY), /jagan_01 \(20261102120000\) is not applied/); } finally { dropDb(a); }
  const c = createDb('production');
  try { assert.throws(() => run(c, APPLY), /not a preview database/); assert.equal(one(c, "select to_regclass('public.jagan_orders') is null"), 't'); } finally { dropDb(c); }
});

test('購入：注文 → 決済画面 → 支払い（本人の保存した結果は自動で登録・権利 active）→ 再送は noop → 返金で止まる → 異議申し立ての勝ちは返金を戻さない', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, APPLY);
    const o = order(db, R1, A, K(1), H1);
    assert.match(o, /^[0-9a-f-]{36}$/);
    assert.equal(order(db, R1, A, K(1), H1), o, '同じ購入操作の再送は同じ注文');
    assert.throws(() => order(db, R2, A, K(1), H2), /jagan_idempotency_conflict/);
    const cs = 'cs_test_' + 'a'.repeat(20);
    assert.equal(svc(db, `select public.jagan_mark_checkout_open('${o}', '${cs}')`), 'opened');
    assert.equal(svc(db, `select public.jagan_mark_checkout_open('${o}', '${cs}')`), 'noop');
    // 金額・通貨・環境・状態の不一致は反映しない
    assert.equal(pay(db, o, cs, { status: 'unpaid' }), 'ignored:payment_not_paid');
    assert.equal(ent(db, A, R1), '-');
    assert.equal(pay(db, o, cs), 'applied');
    assert.equal(ent(db, A, R1), 'active');
    assert.equal(pay(db, o, cs), 'noop');
    assert.equal(svc(db, `select public.jagan_apply_reversal('${o}', 'disputed')`), 'applied');
    assert.equal(ent(db, A, R1), 'refunded');
    assert.equal(svc(db, `select public.jagan_apply_reversal('${o}', 'dispute_won')`), 'applied');
    assert.equal(ent(db, A, R1), 'active');
    assert.equal(svc(db, `select public.jagan_apply_reversal('${o}', 'refunded')`), 'applied');
    assert.equal(ent(db, A, R1), 'refunded');
    assert.equal(svc(db, `select public.jagan_apply_reversal('${o}', 'dispute_won')`), 'noop', '返金は戻さない');
    assert.equal(one(db, `select status from public.jagan_orders where id='${o}'`), 'refunded');
  } finally { dropDb(db); }
});

test('支払いの照合：金額・通貨・Live・別の決済画面は failed にして権利を作らない', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, APPLY);
    for (const [n, extra, code] of [[2, { amount: 999 }, 'amount_mismatch'], [3, { currency: 'usd' }, 'currency_mismatch'], [4, { live: true }, 'livemode_mismatch']]) {
      const o = order(db, R1, A, K(n), String(n).repeat(64));
      const cs = 'cs_test_' + String(n).repeat(20);
      svc(db, `select public.jagan_mark_checkout_open('${o}', '${cs}')`);
      assert.equal(pay(db, o, cs, extra), 'ignored:' + code);
      assert.equal(one(db, `select status||':'||failure_code from public.jagan_orders where id='${o}'`), 'failed:' + code);
    }
    const o = order(db, R1, A, K(5), '5'.repeat(64));
    svc(db, `select public.jagan_mark_checkout_open('${o}', 'cs_test_${'5'.repeat(20)}')`);
    assert.equal(pay(db, o, 'cs_test_' + '6'.repeat(20)), 'ignored:checkout_session_mismatch');
    assert.equal(ent(db, A, R1), '-');
  } finally { dropDb(db); }
});

test('ログインなしの購入 → 固有リンクで別のアカウントに登録（記録を作る）・同じ結果 ID を持つ人には別の ID で作る・登録未完了は断る', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, APPLY);
    const o = order(db, R1, null, K(7), H1);
    const cs = 'cs_test_' + '7'.repeat(20);
    svc(db, `select public.jagan_mark_checkout_open('${o}', '${cs}')`);
    assert.equal(pay(db, o, cs), 'applied');
    assert.equal(one(db, 'select count(*) from public.jagan_order_registrations'), '0', 'ログインなしの購入は自動で登録しない');
    const reg = (u, h, fb) => svc(db, `select reg_result||':'||coalesce(reg_result_id::text,'-') from public.jagan_register_order('${u}', '${h}', ${fb ? `'${fb}'` : 'null'}, 'jagan-result-3', 'e', 's', 'p', 'c', 'n', '{"k":1}')`);
    // A は R1 の持ち主：その記録に登録
    assert.equal(reg(A, H1, RF), `registered:${R1}`);
    assert.equal(ent(db, A, R1), 'active');
    assert.equal(reg(A, H1, RF), `already:${R1}`);
    // B は R1 を持っていない（R1 は A の行）：別の ID（RF）で B の記録を作る
    assert.equal(reg(B, H1, RF), `registered:${RF}`);
    assert.equal(one(db, `select user_id||':'||dti_code from public.jagan_results where result_id='${RF}'`), `${B}:ANWD`);
    assert.equal(ent(db, B, RF), 'active');
    // 登録未完了（C）は断る。知らない・止まったリンクは登録しない
    assert.throws(() => reg(C, H1, RC()), /jagan_onboarding_required/);
    assert.equal(reg(A, 'f'.repeat(64), RF), 'not_found:-');
    svc(db, `select public.jagan_apply_reversal('${o}', 'refunded')`);
    assert.equal(ent(db, A, R1), 'refunded');
    assert.equal(ent(db, B, RF), 'refunded', '返金は登録した全員の権利を止める');
    assert.equal(reg(B, H1, RF), 'inactive:-');
  } finally { dropDb(db); }
  function RC() { return 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; }
});

test('ブラウザのロールは注文・登録を読めず、関数も実行できない。本人は自分の権利だけ読める', { skip: SKIP }, () => {
  const db = ready();
  try {
    run(db, APPLY);
    const o = order(db, R1, A, K(8), H1);
    svc(db, `select public.jagan_mark_checkout_open('${o}', 'cs_test_${'8'.repeat(20)}')`);
    pay(db, o, 'cs_test_' + '8'.repeat(20));
    const as = (role, sub, q) => pg.sql(db, `begin; set local role ${role}; set local request.jwt.claim.sub = '${sub}'; ${q}; rollback;`).split('\n').filter((l) => /^\d+$/.test(l)).pop();
    assert.throws(() => as('authenticated', A, 'select count(*) from public.jagan_orders'), /permission denied/);
    assert.throws(() => as('anon', '', 'select count(*) from public.jagan_order_registrations'), /permission denied/);
    assert.throws(() => as('authenticated', A, `select public.jagan_apply_payment('${o}', 'cs_test_x', 'pi_x', 1000, 'jpy', 'paid', false)`), /permission denied/);
    assert.throws(() => as('authenticated', A, `select * from public.jagan_register_order('${A}', '${H1}', null, 'a','b','c','d','e','f','{}')`), /permission denied/);
    assert.equal(as('authenticated', A, "select count(*) from public.jagan_entitlements where status='active'"), '1');
    assert.equal(as('authenticated', B, 'select count(*) from public.jagan_entitlements'), '0');
  } finally { dropDb(db); }
});
