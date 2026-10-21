-- ============================================================
-- prod_80：旧購入者保護（S0）の不変項目（読み取り専用・本番でも実行してよい）
-- migration の適用前と適用後（各段階の後）に実行し、出力が完全に一致することを確かめる。
-- 出力は件数・金額・ハッシュだけ。個別の ID・メール・決済 ID・診断コード・回答は出さない。
-- 既存6表は「既存の列だけ」で比較する（追加列があっても既存部分の一致を確かめられる）。
-- 旧購入（purchase_entitlements）は prod_01 の適用時刻より前の行（基準の9件）で比べる。
--   prod_01 の後に旧 main（/api/verify）が記録した正規の購入は info.pe.after_prod01 に件数だけ出す。
--   比較では info. で始まる行を除く（grep -v '^info\.'）。
-- ============================================================
-- SQL Editor でもそのまま実行できる（psql のコマンドは使わない）。psql では -At で実行すると比較しやすい。
begin read only;
with cut(c) as (select case when to_regclass('element_release.migration_ledger') is null then 'infinity'::timestamptz
                 else coalesce((xpath('/row/c/text()', query_to_xml('select applied_at as c from element_release.migration_ledger where stage = 1', false, true, '')))[1]::text::timestamptz, 'infinity') end),
t(k, v) as (values
  ('rows.profiles',              (select count(*)::text from public.profiles)),
  ('rows.diagnosis_sessions',    (select count(*)::text from public.diagnosis_sessions)),
  ('rows.diagnosis_answers',     (select count(*)::text from public.diagnosis_answers)),
  ('rows.diagnosis_results',     (select count(*)::text from public.diagnosis_results)),
  ('rows.report_snapshots',      (select count(*)::text from public.report_snapshots)),
  ('rows.purchase_entitlements', (select count(*)::text from public.purchase_entitlements where created_at < (select c from cut))),
  ('info.pe.after_prod01', (select count(*) || ' live=' || count(*) filter (where stripe_checkout_session_id like 'cs\_live\_%' and status = 'active') from public.purchase_entitlements where created_at >= (select c from cut)) || '（参考：比較しない）'),
  ('rows.auth.users',            (select count(*)::text from auth.users)),
  ('rows.auth.identities',       (select count(*)::text from auth.identities)),
  -- 既存行の内容（既存の列だけ）のハッシュ
  ('data.profiles',           (select md5(coalesce(string_agg(concat_ws('|', id, created_at, updated_at, newsletter_opted_in, newsletter_opted_in_at), ',' order by id), '')) from public.profiles)),
  ('data.diagnosis_sessions', (select md5(coalesce(string_agg(concat_ws('|', id, user_id, diagnosis_type, diagnosis_version, scoring_version, client_session_id, completed_at, created_at, item_set_version), ',' order by id), '')) from public.diagnosis_sessions)),
  ('data.diagnosis_answers',  (select md5(coalesce(string_agg(concat_ws('|', id, session_id, answers::text, answers_v2::text, encoded_answers, created_at), ',' order by id), '')) from public.diagnosis_answers)),
  ('data.diagnosis_results',  (select md5(coalesce(string_agg(concat_ws('|', id, session_id, primary_result::text, scores::text, character_matches::text, diagnosis_code, created_at, ennea_sorted::text, character_db_version, report_logic_version, template_version, diagnosis_version, item_set_version, scoring_version, translation_model_version, character_profile_version, mirror_model_version, mirror_snapshot::text, v2_scores::text, v2_rankings::text), ',' order by id), '')) from public.diagnosis_results)),
  ('data.report_snapshots',   (select md5(coalesce(string_agg(concat_ws('|', id, diagnosis_code, scoring_version, primary_result::text, scores::text, character_matches::text, created_at), ',' order by id), '')) from public.report_snapshots)),
  ('data.purchase_entitlements', (select md5(coalesce(string_agg(concat_ws('|', id, diagnosis_code_hash, stripe_checkout_session_id, stripe_payment_intent_id, product_type, amount, currency, purchased_at, status, created_at), ',' order by id), '')) from public.purchase_entitlements where created_at < (select c from cut))),
  ('data.owner_links',        (select md5(coalesce(string_agg(concat_ws('|', s.id, s.user_id, a.id, r.id), ',' order by s.id), '')) from public.diagnosis_sessions s left join public.diagnosis_answers a on a.session_id = s.id left join public.diagnosis_results r on r.session_id = s.id)),
  ('data.auth.users',         (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from auth.users)),
  -- 旧購入の集計
  ('pe.live',  (select count(*) || ' sum=' || coalesce(sum(amount), 0) from public.purchase_entitlements where created_at < (select c from cut) and stripe_checkout_session_id like 'cs\_live\_%')),
  ('pe.test',  (select count(*) || ' sum=' || coalesce(sum(amount), 0) from public.purchase_entitlements where created_at < (select c from cut) and stripe_checkout_session_id like 'cs\_test\_%')),
  ('pe.status', (select string_agg(distinct status, '|') from public.purchase_entitlements where created_at < (select c from cut))),
  ('pe.types',  (select string_agg(distinct product_type, '|') from public.purchase_entitlements where created_at < (select c from cut))),
  ('pe.hashfp.live', (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < (select c from cut) and stripe_checkout_session_id like 'cs\_live\_%')),
  ('pe.hashfp.test', (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < (select c from cut) and stripe_checkout_session_id like 'cs\_test\_%')),
  -- 既存の関数・トリガー・RLS・policy・制約・索引・権限（既存部分だけ）
  ('fn.handle_new_user', md5(pg_get_functiondef('public.handle_new_user()'::regprocedure))),
  ('fn.save_diagnosis_session', (select string_agg(md5(pg_get_functiondef(p.oid)), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session')),
  ('fn.save_diagnosis_session_v2', (select string_agg(md5(pg_get_functiondef(p.oid)), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session_v2')),
  ('fn.grants', (select string_agg(p.proname || ':' || coalesce(p.proacl::text, 'default'), ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('handle_new_user', 'save_diagnosis_session', 'save_diagnosis_session_v2'))),
  ('trg.auth.users', (select count(*) || ' ' || md5(string_agg(t.tgname || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal)),
  ('rls', (select string_agg(c.relname || ':' || c.relrowsecurity || '/' || c.relforcerowsecurity, ',' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements'))),
  ('policies.baseline', (select count(*) || ' ' || md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)) from pg_policies where schemaname = 'public' and tablename in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements'))),
  ('grants.baseline', (select count(*) || ' ' || md5(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type)) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') and table_name in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements'))),
  ('constraints.purchase_entitlements', (select count(*) || ' ' || md5(string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname)) from pg_constraint where conrelid = 'public.purchase_entitlements'::regclass)),
  ('columns.purchase_entitlements', (select count(*) || ' ' || md5(string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by column_name)) from information_schema.columns where table_schema = 'public' and table_name = 'purchase_entitlements')),
  ('triggers.purchase_entitlements', (select count(*)::text from pg_trigger where tgrelid = 'public.purchase_entitlements'::regclass and not tgisinternal))
)
select k, v from t order by k;

rollback;
