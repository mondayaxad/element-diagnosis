-- ============================================================
-- prod_92：prod_02（注文・権利・レポート・固有リンク・登録）の戻し草案
-- 【DRAFT_DO_NOT_RUN】本番では実行しない。障害時に、別途の承認を得てから使う草案。
-- 生成元：docs/sql/production/build_production_sql.py（手で編集しない）
-- 使える条件：prod_02 が最新（prod_03 を先に戻してある）。新しい注文・レポート・リンク・登録・ゲスト記録が 0 件
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
  --    比べるのは prod_01 を適用した時点より前の行（基準の9件）。prod_01 の後に旧 main（/api/verify）が記録した
  --    正規の Live の購入は、基準と別に「全て cs_live_・active・core1 ¥1,000」であることだけを確かめる（止めない）
  v_cut := 'infinity';
  if to_regclass('element_release.migration_ledger') is not null then
    execute 'select applied_at from element_release.migration_ledger where stage = 1' into v_cut;
    v_cut := coalesce(v_cut, 'infinity');
  end if;
  if v_cut = 'infinity' and nullif(current_setting('element.prod01_applied_at', true), '') is not null then
    v_cut := current_setting('element.prod01_applied_at', true)::timestamptz;  -- prod_91（台帳を外した後の確認）用
  end if;
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
  if (select max(stage) from element_release.migration_ledger) is distinct from 2 then
    raise exception 'rollback must be done from the latest stage: latest is %, this file rolls back 2', (select max(stage) from element_release.migration_ledger);
  end if;
end
$rb$;
do $nodata$
declare
  t text; n bigint;
begin
  foreach t in array array['account_report_registrations', 'report_deliveries', 'complete_report_admin_events', 'stripe_webhook_events', 'record_entitlements', 'complete_reports', 'complete_orders', 'complete_legacy_bindings', 'record_mentor_goals', 'result_resume_links', 'result_link_rate', 'legacy_access_events', 'legacy_access_blocks', 'complete_admin_audit_log'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then
      raise exception 'new data exists in % (% rows): do not roll back; handle it as a forward fix', t, n;
    end if;
  end loop;
  if exists (select 1 from public.diagnosis_sessions where user_id is null or guest_created_at is not null) then
    raise exception 'guest diagnosis records exist: do not roll back';
  end if;
end
$nodata$;

-- 1. diagnosis_sessions に加えたものを外す（既存8行は user_id を持つまま。値は変えない）
drop trigger diagnosis_sessions_owner_immutable on public.diagnosis_sessions;
alter table public.diagnosis_sessions drop constraint diagnosis_sessions_owner_or_guest;
alter table public.diagnosis_sessions drop column guest_created_at;
alter table public.diagnosis_sessions alter column user_id set not null;
comment on column public.diagnosis_sessions.user_id is null;  -- prod_02 が付けた説明を外す（元は説明なし）

-- 2. 新しい表（参照される側を後に。CASCADE は使わない＝想定外の依存があれば止まる）
drop table public.account_report_registrations;
drop table public.report_deliveries;
drop table public.complete_report_admin_events;
drop table public.stripe_webhook_events;
drop table public.record_entitlements;
drop table public.complete_reports;
drop table public.complete_orders;
drop table public.complete_legacy_bindings;
drop table public.record_mentor_goals;
drop table public.result_resume_links;
drop table public.result_link_rate;
drop table public.legacy_access_events;
drop table public.legacy_access_blocks;
drop table public.complete_admin_audit_log;

-- 3. 新しい関数
drop function public.claim_complete_report_job(p_lease_seconds integer);
drop function public.complete_admin_approve_legacy_binding(p_actor_user_id uuid, p_user_id uuid, p_diagnosis_session_id uuid, p_legacy_entitlement_id uuid, p_incident_id text);
drop function public.complete_admin_audit_log_immutable();
drop function public.complete_admin_legacy_access(p_diagnosis_code_hash text, p_stripe_checkout_session_id text, p_action text, p_reason_code text, p_incident_id text);
drop function public.complete_admin_record_failure(p_actor_user_id uuid, p_action text, p_target_id uuid, p_reason_code text, p_incident_id text);
drop function public.complete_admin_regenerate_report(p_report_id uuid, p_incident_id text);
drop function public.complete_admin_reissue_delivery(p_delivery_id uuid, p_new_link_token_hash text);
drop function public.complete_admin_reject_legacy_binding(p_actor_user_id uuid, p_legacy_entitlement_id uuid, p_reason_code text, p_incident_id text);
drop function public.complete_admin_revoke_delivery(p_delivery_id uuid, p_reason text);
drop function public.complete_analysis_active_for_code_hash(p_code_hash text);
drop function public.complete_apply_checkout_expired(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_checkout_session_id text);
drop function public.complete_apply_dispute(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_payment_intent_id text, p_action text);
drop function public.complete_apply_link_payment(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text, p_amount_total integer, p_currency text, p_payment_status text, p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text);
drop function public.complete_apply_payment(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text, p_amount_total integer, p_currency text, p_payment_status text, p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text);
drop function public.complete_apply_refund(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_payment_intent_id text, p_amount_refunded integer);
drop function public.complete_bind_legacy_purchase(p_user_id uuid, p_diagnosis_session_id uuid, p_legacy_entitlement_id uuid, p_match_method text);
drop function public.complete_cancel_open_order(p_order_id uuid, p_checkout_session_id text);
drop function public.complete_claim_guest_by_email(p_user_id uuid, p_purchase_email_hmac text);
drop function public.complete_claim_guest_record(p_user_id uuid, p_order_id uuid, p_claim_secret_hash text);
drop function public.complete_claim_report(p_report_id uuid, p_lease_seconds integer);
drop function public.complete_close_unopened_order(p_order_id uuid, p_status text, p_failure_code text);
drop function public.complete_create_guest_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text, p_claim_secret_hash text, p_goal_id text);
drop function public.complete_create_guest_record(p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb, p_item_set_version text, p_scoring_version text, p_translation_model_version text, p_character_profile_version text, p_mirror_model_version text);
drop function public.complete_create_link_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text, p_link_token_hash text, p_goal_id text);
drop function public.complete_create_order(p_user_id uuid, p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text);
drop function public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text, p_claim_secret_hash text);
drop function public.complete_create_result_link(p_token_hash text, p_rate_key text, p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb, p_item_set_version text, p_scoring_version text, p_translation_model_version text, p_character_profile_version text, p_mirror_model_version text);
drop function public.complete_fail_report(p_report_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean);
drop function public.complete_finish_report(p_report_id uuid, p_lease_token uuid, p_storage_path text, p_output_sha256 text);
drop function public.complete_legacy_bindings_check();
drop function public.complete_legacy_blocked(p_diagnosis_code_hash text);
drop function public.complete_lock_result_group(p_user_id uuid, p_diagnosis_session_id uuid);
drop function public.complete_mark_checkout_open(p_order_id uuid, p_checkout_session_id text, p_expires_at timestamp with time zone);
drop function public.complete_open_result_link(p_token_hash text);
drop function public.complete_orders_no_repurchase();
drop function public.complete_orders_require_eligibility();
drop function public.complete_orders_state_guard();
drop function public.complete_purge_result_links();
drop function public.complete_rc1_required_versions();
drop function public.complete_regenerate_link_report(p_report_id uuid);
drop function public.complete_regenerate_report(p_user_id uuid, p_diagnosis_session_id uuid);
drop function public.complete_register_delivery(p_user_id uuid, p_link_token_hash text);
drop function public.complete_release_mentor_goal_lock(p_user_id uuid, p_diagnosis_session_id uuid);
drop function public.complete_report_final_failure(p_status text, p_attempts integer, p_max_attempts integer, p_next_retry_at timestamp with time zone, p_lease_expires_at timestamp with time zone);
drop function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid);
drop function public.complete_result_group(p_user_id uuid, p_diagnosis_session_id uuid);
drop function public.complete_result_group_has(p_user_id uuid, p_diagnosis_session_id uuid, p_kind text);
drop function public.complete_result_key(p_diagnosis_session_id uuid);
drop function public.complete_set_purchase_email(p_order_id uuid, p_purchase_email_hmac text);
drop function public.complete_transfer_guest_record(p_user_id uuid, p_diagnosis_session_id uuid, p_method text);
drop function public.complete_webhook_finish(p_event_id text, p_event_type text, p_livemode boolean, p_event_created timestamp with time zone, p_status text, p_error_code text, p_order_id uuid);
drop function public.complete_webhook_gate(p_event_id text, p_event_type text, p_livemode boolean, p_event_created timestamp with time zone);
drop function public.diagnosis_sessions_owner_immutable();
drop function public.legacy_access_events_immutable();
drop function public.record_entitlements_guard();
drop function public.record_mentor_goals_guard();
drop function public.record_mentor_goals_ownership();

delete from element_release.migration_ledger where stage = 2;
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
  --    比べるのは prod_01 を適用した時点より前の行（基準の9件）。prod_01 の後に旧 main（/api/verify）が記録した
  --    正規の Live の購入は、基準と別に「全て cs_live_・active・core1 ¥1,000」であることだけを確かめる（止めない）
  v_cut := 'infinity';
  if to_regclass('element_release.migration_ledger') is not null then
    execute 'select applied_at from element_release.migration_ledger where stage = 1' into v_cut;
    v_cut := coalesce(v_cut, 'infinity');
  end if;
  if v_cut = 'infinity' and nullif(current_setting('element.prod01_applied_at', true), '') is not null then
    v_cut := current_setting('element.prod01_applied_at', true)::timestamptz;  -- prod_91（台帳を外した後の確認）用
  end if;
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

do $post$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in
              ('handle_new_user', 'save_diagnosis_session', 'save_diagnosis_session_v2',
               'complete_registration_onboarding', 'diagnosis_sessions_require_onboarding', 'profiles_guard_consent_columns')) then
    raise exception 'unexpected functions remain after rollback';
  end if;
end
$post$;

notify pgrst, 'reload schema';

commit;
