// complete_16：新規の登録完了で受け付ける同意は、新しい組（2026-10-21 ＋ 2026-10-21）だけ（PG の実機。PGT_HOST と PQ〔psql のコマンド〕が無ければ skip）。
//   旧版の組・新旧の混在・未定義・空・NULL・お知らせメールの未定義版は断る。完了済みの利用者の記録は書き換えない。
//   実行: PGT_HOST=<socket dir> PQ="psql -h <dir> -U postgres -X -q" node --test tests/consent_pairs_db.test.js
//   （PGT_TEMPLATE の DB〔既定 tmpl〕は complete_16 まで適用済みであること）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const PQ = process.env.PQ;
const skip = process.env.PGT_HOST && PQ ? false : 'PGT_HOST と PQ（PG17 の psql）が無いため skip';
const TEMPLATE = process.env.PGT_TEMPLATE || 'tmpl';
const UID = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function psql(db, sql) {
  const [bin, ...args] = PQ.split(/\s+/);
  const r = spawnSync(bin, [...args, '-At', '-d', db], { input: sql, encoding: 'utf8' });
  return { out: r.stdout.trim(), err: r.stderr, status: r.status };
}
// 新しい利用者（onboarding required）で RPC を呼び、ロールバックする。結果の文字列を返す
const lit = (v) => (v === null ? 'null::text' : `'${v}'`);
function call(db, terms, privacy, news, n = 1) {
  const r = psql(db, `begin;
insert into auth.users(id) values ('${UID(n)}') on conflict do nothing;
update public.profiles set onboarding_status='required' where id='${UID(n)}';
select set_config('request.jwt.claim.sub','${UID(n)}',true);
select public.complete_registration_onboarding(${lit(terms)},${lit(privacy)},${lit(news)});
select 'row='||coalesce(terms_version,'-')||'/'||coalesce(privacy_version,'-')||'/'||onboarding_status from public.profiles where id='${UID(n)}';
rollback;`);
  return `${r.out}\n${r.err}`;
}
const ok = (s) => /"onboarding_status": ?"completed"/.test(s);
const rejected = (s) => /unsupported_consent_version/.test(s) && !/"completed"/.test(s);

test('complete_16 の同意の組', { skip }, async (t) => {
  const db = `t_${crypto.randomBytes(5).toString('hex')}`;
  assert.equal(psql('postgres', `create database ${db} template ${TEMPLATE}`).status, 0);
  t.after(() => { psql('postgres', `drop database ${db}`); });
  const N = '2026-10-07-v1';

  await t.test('1 新規約＋新プライバシー：成功', () => { const s = call(db, '2026-10-21', '2026-10-21', N); assert.ok(ok(s), s); assert.match(s, /row=2026-10-21\/2026-10-21\/completed/); });
  await t.test('2 旧規約＋旧プライバシー：拒否', () => { const s = call(db, '2026-10-07', '2026-10-13', N); assert.ok(rejected(s), s); assert.doesNotMatch(s, /row=2026/); });
  await t.test('3 新旧の混在：拒否', () => {
    assert.ok(rejected(call(db, '2026-10-07', '2026-10-21', N)));
    assert.ok(rejected(call(db, '2026-10-21', '2026-10-13', N)));
    assert.ok(rejected(call(db, '2026-10-07', '2026-10-07', N)));
  });
  await t.test('4 未定義の版：拒否', () => {
    assert.ok(rejected(call(db, '2026-10-99', '2026-10-21', N)));
    assert.ok(rejected(call(db, '2026-10-21', '2026-10-99', N)));
    assert.ok(rejected(call(db, '2026-10-99', '2026-10-99', N)));
  });
  await t.test('5 空・NULL：拒否', () => {
    assert.ok(rejected(call(db, '', '', N)));
    assert.ok(rejected(call(db, null, null, N)));
    assert.ok(rejected(call(db, '2026-10-21', null, N)));
    assert.ok(rejected(call(db, null, '2026-10-21', N)));
    assert.ok(rejected(call(db, '2026-10-21', '2026-10-21', null)));
    assert.ok(rejected(call(db, '2026-10-21', '2026-10-21', '')));
  });
  await t.test('6 お知らせメールの未定義版：拒否（正規の組でも）', () => {
    assert.ok(rejected(call(db, '2026-10-21', '2026-10-21', '2026-10-21-v1')));
    assert.ok(rejected(call(db, '2026-10-21', '2026-10-21', 'x')));
  });
  await t.test('7 拒否のときは同意を記録しない（未登録のまま）', () => {
    call(db, '2026-10-07', '2026-10-13', N, 5);
    const r = psql(db, `select coalesce(terms_version,'-')||'/'||onboarding_status from public.profiles where id='${UID(5)}'`);
    assert.ok(r.out === '' || r.out === '-/required', r.out);
  });
  await t.test('8 登録完了済みの利用者の同意記録は、どの組で呼んでも書き換わらない（過去の旧版の記録は履歴として残る）', () => {
    const setup = psql(db, `insert into auth.users(id) values ('${UID(9)}') on conflict do nothing;
update public.profiles set onboarding_status='completed', onboarding_completed_at='2026-10-07 09:00:00+00', terms_accepted_at='2026-10-07 09:00:00+00', privacy_accepted_at='2026-10-07 09:00:00+00',
  terms_version='2026-10-07', privacy_version='2026-10-13', newsletter_opted_in=true, newsletter_opted_in_at='2026-10-07 09:00:00+00',
  newsletter_consent_source='registration_onboarding', newsletter_consent_version='2026-10-07-v1', newsletter_sync_status='pending' where id='${UID(9)}'`);
    assert.equal(setup.status, 0, setup.err);
    const snap = () => psql(db, `select terms_version||'/'||privacy_version||'/'||onboarding_status||'/'||terms_accepted_at||'/'||updated_at from public.profiles where id='${UID(9)}'`).out;
    const before = snap();
    assert.match(before, /^2026-10-07\/2026-10-13\/completed\//);
    for (const [tv, pv] of [['2026-10-21', '2026-10-21'], ['2026-10-07', '2026-10-13'], ['2026-10-07', '2026-10-21']]) {
      const r = psql(db, `select set_config('request.jwt.claim.sub','${UID(9)}',false);\nselect public.complete_registration_onboarding('${tv}','${pv}','2026-10-07-v1')`);
      if (tv === '2026-10-21' && pv === '2026-10-21') assert.match(r.out, /"onboarding_status": ?"completed"/, r.out + r.err); // 呼べるが、書き換えない
      else assert.match(r.err, /unsupported_consent_version/);
      assert.equal(snap(), before, `${tv}/${pv}`);
    }
  });
  await t.test('権限と定義：anon 不可・authenticated 可・security definer・search_path 空', () => {
    const r = psql(db, `select has_function_privilege('anon',p.oid,'EXECUTE')::text||','||has_function_privilege('authenticated',p.oid,'EXECUTE')||','||p.prosecdef||','||p.proconfig::text from pg_proc p where p.proname='complete_registration_onboarding'`);
    assert.equal(r.out, 'false,true,true,{"search_path=\\"\\""}');
  });
});
