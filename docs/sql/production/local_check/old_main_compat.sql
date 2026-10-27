-- 旧 main（現在の Production）のDB操作が、各段階の後でも動くこと（全体を最後に取り消す）
--   test.stage = 0（適用前）・1〜3（prod_01〜03）・4（prod_04a）・5（prod_04b）。出力：PASS／FAIL の行だけ
\set QUIET on
\set ON_ERROR_STOP on
begin;
create temp table r(ok boolean, item text);
select set_config('test.stage', :'stage', true) \g /dev/null
grant all on r to public;
-- 新規登録（Supabase Auth が auth.users に作る → handle_new_user が profiles を作る）
set local role supabase_auth_admin;
insert into auth.users(id) values ('00000000-0000-4000-8000-0000000000aa');
reset role;
do $$ begin
  insert into r values ((select count(*) = 1 from public.profiles where id = '00000000-0000-4000-8000-0000000000aa'), 'signup creates profile (handle_new_user)');
  if current_setting('test.stage')::int between 1 and 5 then
    insert into r values ((select onboarding_status from public.profiles where id = '00000000-0000-4000-8000-0000000000aa')
                          = case when current_setting('test.stage')::int >= 4 then 'required' else 'legacy_exempt' end,
                          'new signup status is ' || case when current_setting('test.stage')::int >= 4 then 'required (prod_04a)' else 'legacy_exempt (before prod_04a)' end);
  end if;
end $$;
-- 旧 main の保存（save_diagnosis_session・ログイン中の本人）：既存利用者
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true) \g /dev/null
do $$ declare v uuid; begin
  v := public.save_diagnosis_session('element', 'v1', 's1', gen_random_uuid(), now(), '{"q1":3}', 'enc', '{"t":"x"}', '{"a":1}', '[]', 'OLDMAINCODE1');
  insert into r values (v is not null, 'old save_diagnosis_session works for an existing user');
exception when others then insert into r values (false, 'old save_diagnosis_session works for an existing user: ' || sqlerrm); end $$;
-- 旧 main の保存：新規登録した人
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000aa', true) \g /dev/null
do $$ declare v uuid; begin
  v := public.save_diagnosis_session('element', 'v1', 's1', gen_random_uuid(), now(), '{"q1":3}', 'enc', '{"t":"x"}', '{"a":1}', '[]', 'OLDMAINCODE2');
  insert into r values (current_setting('test.stage')::int < 5, 'new signup save via old code ' || case when current_setting('test.stage')::int < 5 then 'works (no enforcement until prod_04b)' else 'unexpectedly works after prod_04b' end);
exception when others then
  insert into r values (current_setting('test.stage')::int = 5 and sqlerrm = 'onboarding_required', 'new signup save via old code ' || case when current_setting('test.stage')::int = 5 then 'rejected after prod_04b (onboarding_required)' else 'failed: ' || sqlerrm end);
end $$;
-- ブラウザ（authenticated）から同意・お知らせメールの列を直接書き換えられない（prod_01 以降）
do $$ begin
  update public.profiles set newsletter_opted_in = not coalesce(newsletter_opted_in, false) where id = auth.uid();
  insert into r values (current_setting('test.stage')::int = 0, 'direct update of newsletter_opted_in ' || case when current_setting('test.stage')::int = 0 then 'allowed before prod_01 (baseline)' else 'unexpectedly allowed' end);
exception when others then insert into r values (current_setting('test.stage')::int >= 1 and sqlerrm = 'consent_columns_read_only', 'direct update of consent columns rejected (' || sqlerrm || ')'); end $$;
reset role;
-- 旧 main の /api/verify（service_role で purchase_entitlements へ INSERT）と /api/report-data（ハッシュで SELECT）
set local role service_role;
do $$ begin
  insert into public.purchase_entitlements(diagnosis_code_hash, stripe_checkout_session_id, stripe_payment_intent_id, product_type, amount, currency)
  values (encode(sha256(convert_to('OLDMAINCODE1', 'UTF8')), 'hex'), 'cs_live_OLDMAINSYNTH0001', 'pi_OLDMAINSYNTH0001', 'core1', 1000, 'jpy');
  insert into r values ((select count(*) = 1 from public.purchase_entitlements where stripe_checkout_session_id = 'cs_live_OLDMAINSYNTH0001' and status = 'active'),
                        'old /api/verify insert into purchase_entitlements works');
  insert into r values ((select count(*) >= 1 from public.purchase_entitlements where diagnosis_code_hash = encode(sha256(convert_to('SYNTHCODE1', 'UTF8')), 'hex')),
                        'old /api/report-data lookup by code hash works');
exception when others then insert into r values (false, 'old verify/report-data: ' || sqlerrm); end $$;
reset role;
select case when ok then 'PASS ' else 'FAIL ' end || item from r order by item;
rollback;
