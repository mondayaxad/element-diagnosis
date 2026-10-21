-- ============================================================
-- prod_01：登録・同意・既存利用者の互換層（本番）
-- 【本番（element-diagnosis-test / akivoob）専用】SQL Editor で、このファイル全体を1回だけ実行する。
-- 【Preview・その他では実行しない】冒頭の確認で、本番の基準と違えば何も変えずに止まる。
-- 生成元：docs/sql/production/build_production_sql.py（Preview migration から機械的に組み立て。手で編集しない）
-- 前提：prod_00_preflight_READONLY.sql の全項目が OK。バックアップ取得・復元試験が合格済み
-- 戻し：docs/sql/production/prod_91_rollback_01_DRAFT_DO_NOT_RUN.sql（DRAFT_DO_NOT_RUN）
-- 二度目の実行：冒頭で stage_already_applied として止まる（何も変更しない）。
-- 旧購入者保護（S0）：purchase_entitlements・旧購入・既存6表の既存列・主要3関数・既存 RLS／policy／権限は変更しない。
-- ============================================================
--
-- 内容
--   ・本番専用の migration 台帳 element_release.migration_ledger（外部 API から見えない別スキーマ）
--   ・profiles に登録完了・同意・お知らせメール同期の列を追加（既存3人は legacy_exempt。既存の値は変えない）
--   ・同意列のブラウザ直接書き換え防止トリガー、登録完了 RPC（同意版は 2026-10-21 の組だけ）
--   ・新規登録の既定値は、prod_04 までの間は legacy_exempt（旧画面からの登録は新しい同意をしていないため）
--   ・旧 main のコード（save_diagnosis_session・/api/verify・/api/report-data）の動きは変わらない

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

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
  -- 段階の順序：1 は最初。台帳がある＝既に何かが適用済み
  if to_regclass('element_release.migration_ledger') is not null then
    if exists (select 1 from element_release.migration_ledger where stage = 1) then
      raise exception 'stage_already_applied: prod_01 は適用済みです（何も変更していません）';
    end if;
    raise exception 'unexpected ledger state before prod_01';
  end if;
  if to_regnamespace('element_release') is not null then
    raise exception 'schema element_release already exists (unexpected)';
  end if;
  -- 追加する列・表がまだ無いこと（部分適用の検出）
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status')
     or to_regclass('public.complete_orders') is not null
     or to_regprocedure('public.complete_registration_onboarding(text, text, text)') is not null then
    raise exception 'registration/complete objects already exist (partial or foreign state)';
  end if;
end
$guard$;

-- ============================================================
-- 0. 本番専用の migration 台帳（Supabase CLI の supabase_migrations とは別物・名前も重ねない）
-- ============================================================
create schema element_release;
revoke all on schema element_release from public, anon, authenticated, service_role;
create table element_release.migration_ledger (
  stage       integer primary key check (stage between 1 and 4),
  name        text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user
);
revoke all on table element_release.migration_ledger from public, anon, authenticated, service_role;
comment on schema element_release is '元素診断 本番 migration の台帳（prod_01〜04）。アプリ・API からは使わない';

-- ------------------------------------------------------------
-- 由来：docs/sql/20261006225744_onboarding_01_registration_onboarding.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 列の追加（既存行に既定値を入れないよう、まず NULL 可・既定値なしで追加する）
alter table public.profiles
  add column onboarding_status            text not null default 'legacy_exempt',
  add column onboarding_completed_at      timestamptz,
  add column terms_accepted_at            timestamptz,
  add column terms_version                text,
  add column privacy_accepted_at          timestamptz,
  add column privacy_version              text,
  add column newsletter_consent_source    text,
  add column newsletter_consent_version   text,
  add column newsletter_sync_status       text,
  add column newsletter_sync_attempted_at timestamptz,
  add column newsletter_sync_attempts     integer not null default 0;

-- 2. 既存行の区分（本番）：列の追加時の既定値 'legacy_exempt' で埋まっている（UPDATE はしない）。
--    同意日時・版・お知らせメールの値は入れない・変えない。

-- 3. 新しい行は 'required'。値の範囲と整合性
alter table public.profiles
  add constraint profiles_onboarding_status_check
    check (onboarding_status in ('required', 'completed', 'legacy_exempt')),
  add constraint profiles_onboarding_completed_check
    check (onboarding_status <> 'completed' or (
      onboarding_completed_at is not null and terms_accepted_at is not null and terms_version is not null
      and privacy_accepted_at is not null and privacy_version is not null)),
  add constraint profiles_newsletter_sync_status_check
    check (newsletter_sync_status is null or newsletter_sync_status in ('pending', 'synced', 'failed', 'skipped')),
  add constraint profiles_newsletter_sync_attempts_check
    check (newsletter_sync_attempts >= 0);

-- 読み取り用（onboarding_status から自動で決まる。直接は書けない）
alter table public.profiles
  add column onboarding_required boolean generated always as (onboarding_status = 'required') stored;

comment on column public.profiles.onboarding_status is
  'required＝登録完了（規約同意）前／completed＝同意済み／legacy_exempt＝この仕組み以前からの利用者（同意は記録していない）';
comment on column public.profiles.newsletter_sync_status is
  'Kit 同期：pending／synced／failed／skipped（Preview の許可リスト外・Kit 未設定など）。/api/subscribe だけが更新する';

-- 4. 同意・配信関連列をブラウザから直接書き換えさせない
--    SECURITY DEFINER の RPC 内では current_user が関数の所有者になるため、RPC からの更新は通る。
--    service_role（サーバー）も通る。
create or replace function public.profiles_guard_consent_columns()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.onboarding_status            is distinct from old.onboarding_status
    or new.onboarding_completed_at      is distinct from old.onboarding_completed_at
    or new.terms_accepted_at            is distinct from old.terms_accepted_at
    or new.terms_version                is distinct from old.terms_version
    or new.privacy_accepted_at          is distinct from old.privacy_accepted_at
    or new.privacy_version              is distinct from old.privacy_version
    or new.newsletter_opted_in          is distinct from old.newsletter_opted_in
    or new.newsletter_opted_in_at       is distinct from old.newsletter_opted_in_at
    or new.newsletter_consent_source    is distinct from old.newsletter_consent_source
    or new.newsletter_consent_version   is distinct from old.newsletter_consent_version
    or new.newsletter_sync_status       is distinct from old.newsletter_sync_status
    or new.newsletter_sync_attempted_at is distinct from old.newsletter_sync_attempted_at
    or new.newsletter_sync_attempts     is distinct from old.newsletter_sync_attempts
  ) then
    raise exception 'consent_columns_read_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_consent_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_consent_columns();

-- 5. 登録完了 RPC（ログイン中の本人だけ）
--    版はサーバー側の固定値と一致しなければ拒否する（古い画面からの記録を防ぐ）。日時はすべて now()。
--    既に completed なら何も変えずに同じ結果を返す（二重クリック・再読込・OAuth 復帰の重複に備える）。
--    legacy_exempt の人は対象外（既存ユーザーの配信設定を変えない）。
create or replace function public.complete_registration_onboarding(
  p_terms_version text,
  p_privacy_version text,
  p_newsletter_consent_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_terms_version is distinct from '2026-10-07'
     or p_privacy_version is distinct from '2026-10-07'
     or p_newsletter_consent_version is distinct from '2026-10-07-v1' then
    raise exception 'unsupported_consent_version' using errcode = '22023';
  end if;

  select onboarding_status into v_status from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'required' then
    update public.profiles
       set onboarding_status          = 'completed',
           onboarding_completed_at    = now(),
           terms_accepted_at          = now(),
           terms_version              = p_terms_version,
           privacy_accepted_at        = now(),
           privacy_version            = p_privacy_version,
           newsletter_opted_in        = true,
           newsletter_opted_in_at     = now(),
           newsletter_consent_source  = 'registration_onboarding',
           newsletter_consent_version = p_newsletter_consent_version,
           newsletter_sync_status     = 'pending',
           updated_at                 = now()
     where id = v_uid;
  elsif v_status <> 'completed' then
    raise exception 'onboarding_not_required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'onboarding_status', onboarding_status,
      'newsletter_sync_status', newsletter_sync_status)
      from public.profiles where id = v_uid);
end;
$$;

-- 6. 登録完了前（required）のユーザーの診断保存を拒否する（v1・v2 の保存 RPC と直接 INSERT の両方）
--    legacy_exempt・completed は従来どおり保存できる。profiles が無い場合は外部キーで失敗する（従来どおり）。
create or replace function public.diagnosis_sessions_require_onboarding()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.onboarding_status = 'required') then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- トリガーの作成は prod_04（切り替え）で行う。ここでは関数だけを用意する。

revoke all on function public.diagnosis_sessions_require_onboarding() from public, anon, authenticated;
revoke all on function public.complete_registration_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_registration_onboarding(text, text, text) to authenticated;
revoke all on function public.profiles_guard_consent_columns() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261021200000_complete_16_close_old_consent_versions.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
create or replace function public.complete_registration_onboarding(
  p_terms_version text,
  p_privacy_version text,
  p_newsletter_consent_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- 同意の版：新規の登録完了で受け付けるのは、新しい組だけ（旧版・新旧の混在・未定義・空・NULL は断る）
  if p_terms_version is distinct from '2026-10-21'
     or p_privacy_version is distinct from '2026-10-21'
     or p_newsletter_consent_version is distinct from '2026-10-07-v1' then
    raise exception 'unsupported_consent_version' using errcode = '22023';
  end if;

  select onboarding_status into v_status from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'required' then
    update public.profiles
       set onboarding_status          = 'completed',
           onboarding_completed_at    = now(),
           terms_accepted_at          = now(),
           terms_version              = p_terms_version,
           privacy_accepted_at        = now(),
           privacy_version            = p_privacy_version,
           newsletter_opted_in        = true,
           newsletter_opted_in_at     = now(),
           newsletter_consent_source  = 'registration_onboarding',
           newsletter_consent_version = p_newsletter_consent_version,
           newsletter_sync_status     = 'pending',
           updated_at                 = now()
     where id = v_uid;
  elsif v_status <> 'completed' then
    raise exception 'onboarding_not_required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'onboarding_status', onboarding_status,
      'newsletter_sync_status', newsletter_sync_status)
      from public.profiles where id = v_uid);
end;
$$;
revoke all on function public.complete_registration_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_registration_onboarding(text, text, text) to authenticated;

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
declare
  v_src text := pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure);
begin
  if has_function_privilege('anon', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE') then
    raise exception 'unexpected privileges on complete_registration_onboarding';
  end if;
  if position('2026-10-21' in v_src) = 0 or position('2026-10-07-v1' in v_src) = 0
     or v_src ~ '2026-10-13' or v_src ~ '2026-10-07([^-]|$)' then
    raise exception 'complete_registration_onboarding does not accept only the new consent versions';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'complete_registration_onboarding'
              and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_registration_onboarding must be security definer with an empty search_path';
  end if;
end
$$;

notify pgrst, 'reload schema';

-- ============================================================
-- 適用後の確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $post$
begin
  if (select count(*) from public.profiles where onboarding_status is distinct from 'legacy_exempt') <> 0 then
    raise exception 'existing profiles must all be legacy_exempt';
  end if;
  if exists (select 1 from public.profiles where terms_version is not null or privacy_version is not null or newsletter_consent_version is not null
              or onboarding_completed_at is not null or newsletter_sync_status is not null) then
    raise exception 'consent values must not be recorded for existing profiles';
  end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status')
     is distinct from '''legacy_exempt''::text' then
    raise exception 'onboarding_status default must be legacy_exempt until prod_04';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'diagnosis_sessions_require_onboarding') then
    raise exception 'require_onboarding trigger must not exist before prod_04';
  end if;
  if has_schema_privilege('anon', 'element_release', 'USAGE') or has_schema_privilege('authenticated', 'element_release', 'USAGE')
     or has_schema_privilege('service_role', 'element_release', 'USAGE') then
    raise exception 'element_release must not be reachable from the API roles';
  end if;
end
$post$;
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
insert into element_release.migration_ledger (stage, name) values (1, 'prod_01_registration_compat');

notify pgrst, 'reload schema';

commit;
