-- ============================================================
-- prod_91：prod_01（登録・同意・既存利用者の互換層）の戻し草案
-- 【DRAFT_DO_NOT_RUN】本番では実行しない。障害時に、別途の承認を得てから使う草案。
-- 生成元：docs/sql/production/build_production_sql.py（手で編集しない）
-- 使える条件：prod_01 が最新（prod_02 以降を先に戻してある）。登録完了・同意・お知らせメール同期の記録が 0 件
--   条件を満たさなければ、冒頭の確認で何も変えずに止まる。
-- 戻した後：旧 main（/api/verify・/api/report-data・save_diagnosis_session）の購入・旧レポート閲覧は動く。
-- 既存6表の既存列・既存行・旧購入（purchase_entitlements の9行）は変更・削除しない。
-- ============================================================

begin;

set local lock_timeout = '5s';

do $guard$
declare
  v_n integer; v_fp text; v_cut timestamptz;
begin
  -- 1. PostgreSQL 17 以上
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  -- 2. Preview ではないこと（Preview だけが deployment_environment() を持つ）
  if to_regprocedure('public.deployment_environment()') is not null then
    raise exception 'deployment_environment() exists: this is not the production database';
  end if;
  if exists (select 1 from pg_constraint where conname in ('complete_orders_preview_test_mode_only', 'stripe_webhook_events_preview_test_only')) then
    raise exception 'preview-only constraints exist: this is not the production database';
  end if;
  -- 3. Supabase の auth と既存6表
  if to_regclass('auth.users') is null then raise exception 'auth.users is missing'; end if;
  if to_regclass('public.profiles') is null or to_regclass('public.diagnosis_sessions') is null
     or to_regclass('public.diagnosis_answers') is null or to_regclass('public.diagnosis_results') is null
     or to_regclass('public.report_snapshots') is null or to_regclass('public.purchase_entitlements') is null then
    raise exception 'baseline tables are missing';
  end if;
  -- 4. 既存の主要3関数と auth.users のトリガー（棚卸し・バックアップ時の定義と一致）
  if md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) <> '965ca6d894f643c07e2db06b6dd83b29' then
    raise exception 'handle_new_user() differs from the inventoried definition';
  end if;
  select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by pg_get_function_identity_arguments(p.oid)) into v_fp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session';
  if v_fp is distinct from '9fd749fe0ebe2c595fa48e6e3f0b2ffd' then
    raise exception 'save_diagnosis_session differs from the inventoried definition';
  end if;
  select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by pg_get_function_identity_arguments(p.oid)) into v_fp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session_v2';
  if v_fp is distinct from '6ec1bde79f95610afe92ffce824f7997' then
    raise exception 'save_diagnosis_session_v2 differs from the inventoried definition';
  end if;
  select count(*), md5(string_agg(t.tgname || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname)) into v_n, v_fp
    from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
  if v_n <> 1 or v_fp <> 'ffa9bd9ac265fa1a7a3d53923f1df8e5' then
    raise exception 'auth.users triggers differ from the inventoried state';
  end if;
  -- 5. 既存6表の既存部分（追加列・追加制約を除いた部分）がバックアップ時と同じ
  select count(*), md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, ''), ',' order by table_name, column_name))
    into v_n, v_fp from information_schema.columns
   where table_schema = 'public' and (table_name || '.' || column_name) = any(array['diagnosis_answers.answers', 'diagnosis_answers.answers_v2', 'diagnosis_answers.created_at', 'diagnosis_answers.encoded_answers', 'diagnosis_answers.id', 'diagnosis_answers.session_id', 'diagnosis_results.character_db_version', 'diagnosis_results.character_matches', 'diagnosis_results.character_profile_version', 'diagnosis_results.created_at', 'diagnosis_results.diagnosis_code', 'diagnosis_results.diagnosis_version', 'diagnosis_results.ennea_sorted', 'diagnosis_results.id', 'diagnosis_results.item_set_version', 'diagnosis_results.mirror_model_version', 'diagnosis_results.mirror_snapshot', 'diagnosis_results.primary_result', 'diagnosis_results.report_logic_version', 'diagnosis_results.scores', 'diagnosis_results.scoring_version', 'diagnosis_results.session_id', 'diagnosis_results.template_version', 'diagnosis_results.translation_model_version', 'diagnosis_results.v2_rankings', 'diagnosis_results.v2_scores', 'diagnosis_sessions.client_session_id', 'diagnosis_sessions.completed_at', 'diagnosis_sessions.created_at', 'diagnosis_sessions.diagnosis_type', 'diagnosis_sessions.diagnosis_version', 'diagnosis_sessions.id', 'diagnosis_sessions.item_set_version', 'diagnosis_sessions.scoring_version', 'diagnosis_sessions.user_id', 'profiles.created_at', 'profiles.id', 'profiles.newsletter_opted_in', 'profiles.newsletter_opted_in_at', 'profiles.updated_at', 'purchase_entitlements.amount', 'purchase_entitlements.created_at', 'purchase_entitlements.currency', 'purchase_entitlements.diagnosis_code_hash', 'purchase_entitlements.id', 'purchase_entitlements.product_type', 'purchase_entitlements.purchased_at', 'purchase_entitlements.status', 'purchase_entitlements.stripe_checkout_session_id', 'purchase_entitlements.stripe_payment_intent_id', 'report_snapshots.character_matches', 'report_snapshots.created_at', 'report_snapshots.diagnosis_code', 'report_snapshots.id', 'report_snapshots.primary_result', 'report_snapshots.scores', 'report_snapshots.scoring_version']);
  if v_n <> 57 or v_fp <> '83c76ac577beace4c523c6ea25974331' then
    raise exception 'baseline columns differ (count %, type or default changed)', v_n;
  end if;
  select count(*), md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname))
    into v_n, v_fp from pg_policies where schemaname = 'public' and policyname = any(array['diagnosis_answers_insert_own', 'diagnosis_answers_select_own', 'diagnosis_results_insert_own', 'diagnosis_results_select_own', 'diagnosis_sessions_insert_own', 'diagnosis_sessions_select_own', 'profiles_select_own', 'profiles_update_own']);
  if v_n <> 8 or v_fp <> 'f6ebc1e867656e2dcfb8b2f6a0a897d5' then
    raise exception 'baseline policies differ';
  end if;
  select count(*), md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
    into v_n, v_fp from pg_constraint where connamespace = 'public'::regnamespace and conname = any(array['diagnosis_answers_pkey', 'diagnosis_answers_session_id_fkey', 'diagnosis_answers_session_id_key', 'diagnosis_results_pkey', 'diagnosis_results_session_id_fkey', 'diagnosis_results_session_id_key', 'diagnosis_sessions_client_session_id_unique', 'diagnosis_sessions_pkey', 'diagnosis_sessions_user_id_fkey', 'profiles_id_fkey', 'profiles_pkey', 'purchase_entitlements_amount_nonneg_check', 'purchase_entitlements_hash_format_check', 'purchase_entitlements_pkey', 'purchase_entitlements_product_type_check', 'purchase_entitlements_status_check', 'purchase_entitlements_stripe_checkout_session_id_key', 'report_snapshots_diagnosis_code_key', 'report_snapshots_pkey']);
  if v_n <> 19 or v_fp <> 'e86317025f947fae6e5cbb41786fa0c8' then
    raise exception 'baseline constraints differ';
  end if;
  select count(*), md5(string_agg(indexdef, ',' order by indexname)) into v_n, v_fp
    from pg_indexes where schemaname = 'public' and indexname = any(array['diagnosis_answers_pkey', 'diagnosis_answers_session_id_key', 'diagnosis_results_pkey', 'diagnosis_results_session_id_key', 'diagnosis_sessions_client_session_id_unique', 'diagnosis_sessions_pkey', 'idx_diagnosis_sessions_user_id_completed_at', 'idx_purchase_entitlements_code_hash', 'profiles_pkey', 'purchase_entitlements_pkey', 'purchase_entitlements_stripe_checkout_session_id_key', 'report_snapshots_diagnosis_code_key', 'report_snapshots_pkey']);
  if v_n <> 13 or v_fp <> '10cb608446bd505b5d21f716745fcc76' then
    raise exception 'baseline indexes differ';
  end if;
  select count(*), md5(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type))
    into v_n, v_fp from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     and table_name in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements');
  if v_n <> 126 or v_fp <> '6965208bc08c57e15bb54915ef77c7a9' then
    raise exception 'baseline table grants differ';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
              and c.relname in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements')
              and not c.relrowsecurity) then
    raise exception 'row level security is off on a baseline table';
  end if;
  -- 6. 旧購入（purchase_entitlements）が基準どおり：9件・live 1件 ¥1,000・test 8件 ¥8,000・全て active・集計指紋
  --    比べるのは固定の締め切り 2026-10-06 00:00Z より前の行（基準の9件）。それ以降に旧 main（/api/verify）が記録した
  --    正規の Live の購入（例：2026-10-26 の1件）は、基準と別に「全て cs_live_・active・core1 ¥1,000 JPY」であることを確かめる（違えば止める）
  v_cut := timestamptz '2026-10-06 00:00:00+00';  -- 基準取得日（固定）。基準の9件は 2026-10-05 08:10Z までに作成済み
  if (select count(*) from public.purchase_entitlements where created_at < v_cut) <> 9 then
    raise exception 'purchase_entitlements baseline is not 9 rows (stop and re-run the preflight)';
  end if;
  if exists (select 1 from public.purchase_entitlements where created_at >= v_cut
              and (stripe_checkout_session_id not like 'cs\_live\_%' or status <> 'active' or product_type <> 'core1' or amount <> 1000 or currency <> 'jpy')) then
    raise exception 'unexpected purchase_entitlements rows after prod_01 (not a live core1 purchase)';
  end if;
  if (select count(*) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_live\_%') <> 1
     or (select sum(amount) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_live\_%') <> 1000
     or (select count(*) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_test\_%') <> 8
     or (select sum(amount) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_test\_%') <> 8000
     or exists (select 1 from public.purchase_entitlements where created_at < v_cut and status <> 'active') then
    raise exception 'purchase_entitlements live/test counts, amounts or status differ from the baseline';
  end if;
  -- BEGIN EXPECTED PURCHASE FINGERPRINT（本番の基準値。ローカル試験だけが合成データ用の値に差し替える）
  if (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_live\_%') <> '30665072821e4cafb1fe85fc56f4dc96'
     or (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_test\_%') <> 'a5bc637c700f585024be751b912db9b6' then
    raise exception 'purchase_entitlements fingerprint differs from the baseline';
  end if;
  -- END EXPECTED PURCHASE FINGERPRINT
end
$guard$;
do $rb$
begin
  if to_regclass('element_release.migration_ledger') is null then
    raise exception 'ledger missing: nothing to roll back';
  end if;
  if (select max(stage) from element_release.migration_ledger) is distinct from 1 then
    raise exception 'rollback must be done from the latest stage: latest is %, this file rolls back 1', (select max(stage) from element_release.migration_ledger);
  end if;
end
$rb$;

do $nodata$
begin
  if exists (select 1 from public.profiles where onboarding_status <> 'legacy_exempt'
              or onboarding_completed_at is not null or terms_accepted_at is not null or terms_version is not null
              or privacy_accepted_at is not null or privacy_version is not null or newsletter_consent_source is not null
              or newsletter_consent_version is not null or newsletter_sync_status is not null
              or newsletter_sync_attempted_at is not null or newsletter_sync_attempts <> 0) then
    raise exception 'registration or consent records exist: do not roll back';
  end if;
end
$nodata$;

select set_config('element.prod01_applied_at', (select applied_at::text from element_release.migration_ledger where stage = 1), true);

drop trigger profiles_guard_consent_columns on public.profiles;
drop function public.profiles_guard_consent_columns();
drop function public.complete_registration_onboarding(text, text, text);
drop function public.diagnosis_sessions_require_onboarding();
alter table public.profiles
  drop constraint profiles_onboarding_status_check,
  drop constraint profiles_onboarding_completed_check,
  drop constraint profiles_newsletter_sync_status_check,
  drop constraint profiles_newsletter_sync_attempts_check;
alter table public.profiles
  drop column onboarding_required,
  drop column onboarding_status,
  drop column onboarding_completed_at,
  drop column terms_accepted_at,
  drop column terms_version,
  drop column privacy_accepted_at,
  drop column privacy_version,
  drop column newsletter_consent_source,
  drop column newsletter_consent_version,
  drop column newsletter_sync_status,
  drop column newsletter_sync_attempted_at,
  drop column newsletter_sync_attempts;

-- 台帳：stage 1 の行だけを消し、空になった台帳と専用スキーマを外す
delete from element_release.migration_ledger where stage = 1;
do $empty$
begin
  if exists (select 1 from element_release.migration_ledger) then
    raise exception 'ledger is not empty after removing stage 1';
  end if;
end
$empty$;
drop table element_release.migration_ledger;
drop schema element_release;
do $guard$
declare
  v_n integer; v_fp text; v_cut timestamptz;
begin
  -- 1. PostgreSQL 17 以上
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  -- 2. Preview ではないこと（Preview だけが deployment_environment() を持つ）
  if to_regprocedure('public.deployment_environment()') is not null then
    raise exception 'deployment_environment() exists: this is not the production database';
  end if;
  if exists (select 1 from pg_constraint where conname in ('complete_orders_preview_test_mode_only', 'stripe_webhook_events_preview_test_only')) then
    raise exception 'preview-only constraints exist: this is not the production database';
  end if;
  -- 3. Supabase の auth と既存6表
  if to_regclass('auth.users') is null then raise exception 'auth.users is missing'; end if;
  if to_regclass('public.profiles') is null or to_regclass('public.diagnosis_sessions') is null
     or to_regclass('public.diagnosis_answers') is null or to_regclass('public.diagnosis_results') is null
     or to_regclass('public.report_snapshots') is null or to_regclass('public.purchase_entitlements') is null then
    raise exception 'baseline tables are missing';
  end if;
  -- 4. 既存の主要3関数と auth.users のトリガー（棚卸し・バックアップ時の定義と一致）
  if md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) <> '965ca6d894f643c07e2db06b6dd83b29' then
    raise exception 'handle_new_user() differs from the inventoried definition';
  end if;
  select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by pg_get_function_identity_arguments(p.oid)) into v_fp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session';
  if v_fp is distinct from '9fd749fe0ebe2c595fa48e6e3f0b2ffd' then
    raise exception 'save_diagnosis_session differs from the inventoried definition';
  end if;
  select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by pg_get_function_identity_arguments(p.oid)) into v_fp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session_v2';
  if v_fp is distinct from '6ec1bde79f95610afe92ffce824f7997' then
    raise exception 'save_diagnosis_session_v2 differs from the inventoried definition';
  end if;
  select count(*), md5(string_agg(t.tgname || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname)) into v_n, v_fp
    from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
  if v_n <> 1 or v_fp <> 'ffa9bd9ac265fa1a7a3d53923f1df8e5' then
    raise exception 'auth.users triggers differ from the inventoried state';
  end if;
  -- 5. 既存6表の既存部分（追加列・追加制約を除いた部分）がバックアップ時と同じ
  select count(*), md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, ''), ',' order by table_name, column_name))
    into v_n, v_fp from information_schema.columns
   where table_schema = 'public' and (table_name || '.' || column_name) = any(array['diagnosis_answers.answers', 'diagnosis_answers.answers_v2', 'diagnosis_answers.created_at', 'diagnosis_answers.encoded_answers', 'diagnosis_answers.id', 'diagnosis_answers.session_id', 'diagnosis_results.character_db_version', 'diagnosis_results.character_matches', 'diagnosis_results.character_profile_version', 'diagnosis_results.created_at', 'diagnosis_results.diagnosis_code', 'diagnosis_results.diagnosis_version', 'diagnosis_results.ennea_sorted', 'diagnosis_results.id', 'diagnosis_results.item_set_version', 'diagnosis_results.mirror_model_version', 'diagnosis_results.mirror_snapshot', 'diagnosis_results.primary_result', 'diagnosis_results.report_logic_version', 'diagnosis_results.scores', 'diagnosis_results.scoring_version', 'diagnosis_results.session_id', 'diagnosis_results.template_version', 'diagnosis_results.translation_model_version', 'diagnosis_results.v2_rankings', 'diagnosis_results.v2_scores', 'diagnosis_sessions.client_session_id', 'diagnosis_sessions.completed_at', 'diagnosis_sessions.created_at', 'diagnosis_sessions.diagnosis_type', 'diagnosis_sessions.diagnosis_version', 'diagnosis_sessions.id', 'diagnosis_sessions.item_set_version', 'diagnosis_sessions.scoring_version', 'diagnosis_sessions.user_id', 'profiles.created_at', 'profiles.id', 'profiles.newsletter_opted_in', 'profiles.newsletter_opted_in_at', 'profiles.updated_at', 'purchase_entitlements.amount', 'purchase_entitlements.created_at', 'purchase_entitlements.currency', 'purchase_entitlements.diagnosis_code_hash', 'purchase_entitlements.id', 'purchase_entitlements.product_type', 'purchase_entitlements.purchased_at', 'purchase_entitlements.status', 'purchase_entitlements.stripe_checkout_session_id', 'purchase_entitlements.stripe_payment_intent_id', 'report_snapshots.character_matches', 'report_snapshots.created_at', 'report_snapshots.diagnosis_code', 'report_snapshots.id', 'report_snapshots.primary_result', 'report_snapshots.scores', 'report_snapshots.scoring_version']);
  if v_n <> 57 or v_fp <> '83c76ac577beace4c523c6ea25974331' then
    raise exception 'baseline columns differ (count %, type or default changed)', v_n;
  end if;
  select count(*), md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname))
    into v_n, v_fp from pg_policies where schemaname = 'public' and policyname = any(array['diagnosis_answers_insert_own', 'diagnosis_answers_select_own', 'diagnosis_results_insert_own', 'diagnosis_results_select_own', 'diagnosis_sessions_insert_own', 'diagnosis_sessions_select_own', 'profiles_select_own', 'profiles_update_own']);
  if v_n <> 8 or v_fp <> 'f6ebc1e867656e2dcfb8b2f6a0a897d5' then
    raise exception 'baseline policies differ';
  end if;
  select count(*), md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
    into v_n, v_fp from pg_constraint where connamespace = 'public'::regnamespace and conname = any(array['diagnosis_answers_pkey', 'diagnosis_answers_session_id_fkey', 'diagnosis_answers_session_id_key', 'diagnosis_results_pkey', 'diagnosis_results_session_id_fkey', 'diagnosis_results_session_id_key', 'diagnosis_sessions_client_session_id_unique', 'diagnosis_sessions_pkey', 'diagnosis_sessions_user_id_fkey', 'profiles_id_fkey', 'profiles_pkey', 'purchase_entitlements_amount_nonneg_check', 'purchase_entitlements_hash_format_check', 'purchase_entitlements_pkey', 'purchase_entitlements_product_type_check', 'purchase_entitlements_status_check', 'purchase_entitlements_stripe_checkout_session_id_key', 'report_snapshots_diagnosis_code_key', 'report_snapshots_pkey']);
  if v_n <> 19 or v_fp <> 'e86317025f947fae6e5cbb41786fa0c8' then
    raise exception 'baseline constraints differ';
  end if;
  select count(*), md5(string_agg(indexdef, ',' order by indexname)) into v_n, v_fp
    from pg_indexes where schemaname = 'public' and indexname = any(array['diagnosis_answers_pkey', 'diagnosis_answers_session_id_key', 'diagnosis_results_pkey', 'diagnosis_results_session_id_key', 'diagnosis_sessions_client_session_id_unique', 'diagnosis_sessions_pkey', 'idx_diagnosis_sessions_user_id_completed_at', 'idx_purchase_entitlements_code_hash', 'profiles_pkey', 'purchase_entitlements_pkey', 'purchase_entitlements_stripe_checkout_session_id_key', 'report_snapshots_diagnosis_code_key', 'report_snapshots_pkey']);
  if v_n <> 13 or v_fp <> '10cb608446bd505b5d21f716745fcc76' then
    raise exception 'baseline indexes differ';
  end if;
  select count(*), md5(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type))
    into v_n, v_fp from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     and table_name in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements');
  if v_n <> 126 or v_fp <> '6965208bc08c57e15bb54915ef77c7a9' then
    raise exception 'baseline table grants differ';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
              and c.relname in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements')
              and not c.relrowsecurity) then
    raise exception 'row level security is off on a baseline table';
  end if;
  -- 6. 旧購入（purchase_entitlements）が基準どおり：9件・live 1件 ¥1,000・test 8件 ¥8,000・全て active・集計指紋
  --    比べるのは固定の締め切り 2026-10-06 00:00Z より前の行（基準の9件）。それ以降に旧 main（/api/verify）が記録した
  --    正規の Live の購入（例：2026-10-26 の1件）は、基準と別に「全て cs_live_・active・core1 ¥1,000 JPY」であることを確かめる（違えば止める）
  v_cut := timestamptz '2026-10-06 00:00:00+00';  -- 基準取得日（固定）。基準の9件は 2026-10-05 08:10Z までに作成済み
  if (select count(*) from public.purchase_entitlements where created_at < v_cut) <> 9 then
    raise exception 'purchase_entitlements baseline is not 9 rows (stop and re-run the preflight)';
  end if;
  if exists (select 1 from public.purchase_entitlements where created_at >= v_cut
              and (stripe_checkout_session_id not like 'cs\_live\_%' or status <> 'active' or product_type <> 'core1' or amount <> 1000 or currency <> 'jpy')) then
    raise exception 'unexpected purchase_entitlements rows after prod_01 (not a live core1 purchase)';
  end if;
  if (select count(*) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_live\_%') <> 1
     or (select sum(amount) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_live\_%') <> 1000
     or (select count(*) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_test\_%') <> 8
     or (select sum(amount) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_test\_%') <> 8000
     or exists (select 1 from public.purchase_entitlements where created_at < v_cut and status <> 'active') then
    raise exception 'purchase_entitlements live/test counts, amounts or status differ from the baseline';
  end if;
  -- BEGIN EXPECTED PURCHASE FINGERPRINT（本番の基準値。ローカル試験だけが合成データ用の値に差し替える）
  if (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_live\_%') <> '30665072821e4cafb1fe85fc56f4dc96'
     or (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\_test\_%') <> 'a5bc637c700f585024be751b912db9b6' then
    raise exception 'purchase_entitlements fingerprint differs from the baseline';
  end if;
  -- END EXPECTED PURCHASE FINGERPRINT
end
$guard$;

notify pgrst, 'reload schema';

commit;
