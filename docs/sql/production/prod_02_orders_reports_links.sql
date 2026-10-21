-- ============================================================
-- prod_02：注文・権利・レポート・固有リンク・登録機能（本番）
-- 【本番（element-diagnosis-test / akivoob）専用】SQL Editor で、このファイル全体を1回だけ実行する。
-- 【Preview・その他では実行しない】冒頭の確認で、本番の基準と違えば何も変えずに止まる。
-- 生成元：docs/sql/production/build_production_sql.py（Preview migration から機械的に組み立て。手で編集しない）
-- 前提：prod_01 適用済み（element_release.migration_ledger に stage 1）
-- 戻し：docs/sql/production/prod_92_rollback_02_DRAFT_DO_NOT_RUN.sql（DRAFT_DO_NOT_RUN）
-- 二度目の実行：冒頭で stage_already_applied として止まる（何も変更しない）。
-- 旧購入者保護（S0）：purchase_entitlements・旧購入・既存6表の既存列・主要3関数・既存 RLS／policy／権限は変更しない。
-- ============================================================
--
-- 内容（Preview の complete_01〜13 を順に。同じ順序・同じ本文で、次だけを本番向けに変える）
--   ・complete_orders は Live だけ（stripe_mode = 'live'）。stripe_webhook_events も livemode = true だけ
--   ・注文作成 RPC が記録する stripe_mode は 'live'。Webhook の照合も Live 前提
--   ・Preview 専用の制約（*_preview_test_*）は作らない。Test の Price ID・Webhook 値は SQL に含まない
--   ・既存表への変更は diagnosis_sessions だけ：user_id の NOT NULL を外す（ゲストの記録用。既存8行は値を持つまま）・
--     guest_created_at 列・所有者か ゲストかの制約・所有者固定トリガーの追加。既存行・既存列の値は変えない
--   ・purchase_entitlements には何もしない（cs_test_ の8行があるため Live 限定制約も付けない）。旧購入を新しい表へ移さない

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
  -- 段階の順序：prod_01 まで適用済みで、prod_02 は未適用
  if to_regclass('element_release.migration_ledger') is null then
    raise exception 'prod_01 is not applied (ledger missing)';
  end if;
  if exists (select 1 from element_release.migration_ledger where stage = 2) then
    raise exception 'stage_already_applied: prod_02 は適用済みです（何も変更していません）';
  end if;
  if (select array_agg(stage order by stage) from element_release.migration_ledger) is distinct from array[1] then
    raise exception 'ledger does not show the previous stages in order';
  end if;
  -- complete 系の表がまだ無いこと（部分適用・別系統の作成の検出）
  if to_regclass('public.complete_orders') is not null or to_regclass('public.record_entitlements') is not null
     or to_regclass('public.report_deliveries') is not null or to_regclass('public.account_report_registrations') is not null
     or to_regclass('public.complete_legacy_bindings') is not null or to_regclass('public.legacy_access_blocks') is not null
     or to_regclass('public.stripe_webhook_events') is not null or to_regclass('public.complete_reports') is not null then
    raise exception 'complete tables already exist before prod_02 (partial or foreign state)';
  end if;
end
$guard$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261007111306_complete_01_orders_entitlements_reports.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 生成側（COMPLETE-RC1）が受け付ける版。保存済みの記録の版がこれと完全に一致する場合だけ販売・生成する。
--    版を変えるときは、この関数の差し替え（別 migration・別承認）で行う。
create or replace function public.complete_rc1_required_versions()
  returns table (diagnosis_version text, item_set_version text, scoring_version text,
                 translation_model_version text, character_profile_version text, mirror_model_version text)
  language sql immutable
  set search_path = ''
as $$
  select 'ETI-2.0'::text, 'ETI-ITEM-2.0.0'::text, 'ETI-SCORE-2.0.0'::text,
         'ETI-TRANS-2.0.0'::text, 'ETI-CHAR-2.1.0'::text, 'ETI-MIRROR-2.1.0'::text
$$;

-- 2. MENTOR の目標（記録ごとに1つ）。利用者が確認済みの5目標（CORE1-MENTOR-GOALS-1.0.0）から選ぶ。
--    支払い（注文の paid）で locked_at を入れ、以後は変更できない。結果から自動で選ばない。
create table public.record_mentor_goals (
  diagnosis_session_id  uuid primary key references public.diagnosis_sessions(id) on delete restrict,
  user_id               uuid not null references public.profiles(id) on delete restrict,
  goal_catalog_version  text not null,
  goal_id               text not null,
  selected_at           timestamptz not null default now(),
  locked_at             timestamptz,
  updated_at            timestamptz not null default now(),
  constraint record_mentor_goals_catalog_goal check (
    goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
    and goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01'))
);

create or replace function public.record_mentor_goals_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- 支払い後（locked_at あり）は目標・版・日時・所有者を変えない（ロック自体の解除もしない）
  if old.locked_at is not null and (
       new.goal_id is distinct from old.goal_id
    or new.goal_catalog_version is distinct from old.goal_catalog_version
    or new.selected_at is distinct from old.selected_at
    or new.user_id is distinct from old.user_id
    or new.locked_at is distinct from old.locked_at) then
    raise exception 'mentor_goal_locked' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger record_mentor_goals_guard
  before update on public.record_mentor_goals
  for each row execute function public.record_mentor_goals_guard();

-- 3. 注文（購入 intent）。Checkout Session を作る前にサーバーが1行作り、その id を Stripe の metadata に入れる。
--    支払いの確定は Webhook だけが行う（ブラウザの戻り先・verify では付与しない）。
create table public.complete_orders (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id        uuid not null references public.diagnosis_sessions(id) on delete restrict,
  offer                       text not null check (offer in ('direct_complete', 'analysis_upgrade')),
  amount                      integer not null check (amount > 0),
  currency                    text not null default 'jpy' check (currency = 'jpy'),
  stripe_mode                 text not null check (stripe_mode in ('test', 'live')),
  status                      text not null default 'created'
    check (status in ('created', 'checkout_open', 'paid', 'expired', 'failed', 'canceled', 'refunded', 'disputed')),
  -- 注文時点の MENTOR 目標を写して固定する（以後の生成はこの値を使う）
  mentor_goal_catalog_version text not null,
  mentor_goal_id              text not null,
  mentor_goal_selected_at     timestamptz not null,
  -- upgrade の根拠（既存 ¥1,000 の権利）。どこで確認したかだけを持つ（既存データは移さない）
  analysis_basis              text check (analysis_basis in ('legacy_purchase_entitlement', 'record_entitlement')),
  idempotency_key             text not null,              -- サーバーが決める（user・記録・offer・試行枠）。クライアント値は使わない
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text unique,
  last_stripe_event_id        text,
  last_event_created          timestamptz,                -- 到着順に依存しないため、イベントの作成時刻で新旧を判定する
  failure_code                text,
  created_at                  timestamptz not null default now(),
  checkout_expires_at         timestamptz,
  paid_at                     timestamptz,
  refunded_at                 timestamptz,
  updated_at                  timestamptz not null default now(),
  -- 現在の価格だけを正とする（旧 ¥2,500／¥1,500 を受け付けない）
  constraint complete_orders_amount_matches_offer check (
    (offer = 'direct_complete' and amount = 3000) or (offer = 'analysis_upgrade' and amount = 2000)),
  constraint complete_orders_upgrade_has_basis check (
    (offer = 'analysis_upgrade' and analysis_basis is not null) or (offer = 'direct_complete' and analysis_basis is null)),
  constraint complete_orders_mentor_goal check (
    mentor_goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
    and mentor_goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')),
  -- 本番の DB には Live の決済だけを入れる
  constraint complete_orders_production_live_mode_only check (stripe_mode = 'live'),
  constraint complete_orders_checkout_prefix check (
    stripe_checkout_session_id is null or stripe_checkout_session_id like 'cs\_live\_%')
);
create unique index complete_orders_idempotency_key_uq on public.complete_orders (idempotency_key);
-- 同じ記録に、決済待ち・支払済みの注文は1つだけ（連打・別タブ・direct と upgrade の並行購入を防ぐ）
create unique index complete_orders_one_live_per_session
  on public.complete_orders (diagnosis_session_id)
  where status in ('created', 'checkout_open', 'paid', 'disputed');
create index complete_orders_user_idx on public.complete_orders (user_id, created_at desc);

-- 注文を作る前提を DB 側でも確かめる（API の確認に重ねる二層目）：
--   本人の記録・ETI v2 の保存済み結果があり版が RC1 と完全一致・登録完了済み・MENTOR 目標が選択済みで注文の値と一致
create or replace function public.complete_orders_require_eligibility()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_owner uuid;
  v_onboarding text;
  v_goal record;
begin
  select s.user_id into v_owner from public.diagnosis_sessions s where s.id = new.diagnosis_session_id;
  if v_owner is distinct from new.user_id then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = new.user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.diagnosis_results r, public.complete_rc1_required_versions() v
     where r.session_id = new.diagnosis_session_id
       and r.diagnosis_version         is not distinct from v.diagnosis_version
       and r.item_set_version          is not distinct from v.item_set_version
       and r.scoring_version           is not distinct from v.scoring_version
       and r.translation_model_version is not distinct from v.translation_model_version
       and r.character_profile_version is not distinct from v.character_profile_version
       and r.mirror_model_version      is not distinct from v.mirror_model_version) then
    raise exception 'complete_version_not_eligible' using errcode = '42501';
  end if;
  select g.goal_id, g.goal_catalog_version, g.selected_at into v_goal
    from public.record_mentor_goals g
   where g.diagnosis_session_id = new.diagnosis_session_id and g.user_id = new.user_id;
  if not found then
    raise exception 'complete_mentor_goal_required' using errcode = '42501';
  end if;
  if v_goal.goal_id is distinct from new.mentor_goal_id
     or v_goal.goal_catalog_version is distinct from new.mentor_goal_catalog_version
     or v_goal.selected_at is distinct from new.mentor_goal_selected_at then
    raise exception 'complete_mentor_goal_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger complete_orders_require_eligibility
  before insert on public.complete_orders
  for each row execute function public.complete_orders_require_eligibility();

-- 4. 記録単位の権利（正本）。analysis＝解析レポート、complete＝完全解析。
--    direct ¥3,000 は analysis と complete の2行、upgrade ¥2,000 は complete の1行。
--    既存 ¥1,000（purchase_entitlements の core1・旧 complete）は写さず、読み取り時に導出する（設計書 §4-3）。
--    状態：active（閲覧可）／suspended（dispute 中の一時停止。閲覧不可）／revoked（失効。閲覧不可）。
--    suspended → active（勝訴）または revoked（敗訴・返金確定）。revoked からは戻さない（再購入は新しい注文）。
create table public.record_entitlements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id   uuid not null references public.diagnosis_sessions(id) on delete restrict,
  right_type             text not null check (right_type in ('analysis', 'complete')),
  source_order_id        uuid not null references public.complete_orders(id) on delete restrict,
  status                 text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  suspend_reason         text check (suspend_reason is null or suspend_reason in ('dispute_open')),
  suspended_at           timestamptz,
  revoke_reason          text check (revoke_reason is null or revoke_reason in ('refund', 'dispute_lost', 'manual', 'mistaken_purchase')),
  created_at             timestamptz not null default now(),
  revoked_at             timestamptz,
  constraint record_entitlements_state_consistency check (
    (status = 'active'    and revoked_at is null and revoke_reason is null and suspended_at is null and suspend_reason is null)
    or (status = 'suspended' and revoked_at is null and revoke_reason is null and suspended_at is not null and suspend_reason is not null)
    or (status = 'revoked'   and revoked_at is not null and revoke_reason is not null))
);
-- 同じ利用者・同じ記録・同じ権利の「失効していない」行（active／suspended）は1つだけ
create unique index record_entitlements_one_active
  on public.record_entitlements (user_id, diagnosis_session_id, right_type) where status in ('active', 'suspended');

-- 失効（revoked）は最終状態。revoked から active／suspended へ戻さない
create or replace function public.record_entitlements_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status = 'revoked' and new.status is distinct from 'revoked' then
    raise exception 'entitlement_revoked_is_final' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger record_entitlements_guard
  before update on public.record_entitlements
  for each row execute function public.record_entitlements_guard();
create unique index record_entitlements_order_right_uq on public.record_entitlements (source_order_id, right_type);

-- 5. Stripe Webhook の受信記録（重複配送の冪等化）。本文（payload）は保存しない。
create table public.stripe_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  livemode      boolean not null,
  event_created timestamptz not null,
  order_id      uuid references public.complete_orders(id) on delete set null,
  status        text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_code    text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  constraint stripe_webhook_events_production_live_only check (livemode = true)
);

-- 6. 完全解析の生成物（記録ごと・版ごと）。購入（権利）と生成完了は別の事実として持つ。
--    行が無い＝none。購入後に queued で作り、ジョブが generating → ready／failed へ進める。
--    失効（revoked）では閲覧を直ちに止め、生成物は非公開のまま隔離する（quarantined_at）。保持期間は本番前に別途決める。
--    dispute 中の一時停止は権利（record_entitlements.suspended）で表す。生成物は ready のまま（閲覧 API が権利で止める）。
--    生成 HTML には実名・user_id・diagnosis_session_id を入れない。表示名は「あなた」、識別子が要るならこの表の id（推測困難な乱数）だけ。
create table public.complete_reports (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id        uuid not null references public.diagnosis_sessions(id) on delete restrict,
  source_order_id             uuid not null references public.complete_orders(id) on delete restrict,
  status                      text not null default 'queued'
    check (status in ('queued', 'generating', 'ready', 'failed', 'revoked')),
  output_format               text not null default 'html' check (output_format = 'html'),   -- 非公開 HTML だけ（PDF なし）
  attempts                    integer not null default 0 check (attempts >= 0),
  max_attempts                integer not null default 5 check (max_attempts between 1 and 20),
  last_error_code             text,
  next_retry_at               timestamptz,
  lease_token                 uuid,
  lease_expires_at            timestamptz,
  -- 凍結する版（購入確定時に記録から写す。生成側の版と一致するものだけ。キャラクター座標の更新後も差し替えない）
  generator_release           text not null default 'COMPLETE-RC1' check (generator_release = 'COMPLETE-RC1'),
  content_version             text not null,
  template_version            text not null,
  content_sha256              text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),   -- 本文素材（content JSON）の内容ハッシュ
  template_sha256             text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),  -- テンプレート・CSS・画像の内容ハッシュ
  diagnosis_version           text not null,
  item_set_version            text not null,
  scoring_version             text not null,
  translation_model_version   text not null,
  character_profile_version   text not null,
  mirror_model_version        text not null,
  mentor_goal_catalog_version text not null,
  mentor_goal_id              text not null,
  input_sha256                text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path                text,                       -- 非公開バケット内のパス。API の応答・ログに出さない
  output_sha256               text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  created_at                  timestamptz not null default now(),
  generating_at               timestamptz,
  ready_at                    timestamptz,
  failed_at                   timestamptz,
  revoked_at                  timestamptz,
  quarantined_at              timestamptz,
  updated_at                  timestamptz not null default now(),
  constraint complete_reports_versions_rc1 check (
    diagnosis_version = 'ETI-2.0' and item_set_version = 'ETI-ITEM-2.0.0' and scoring_version = 'ETI-SCORE-2.0.0'
    and translation_model_version = 'ETI-TRANS-2.0.0' and character_profile_version = 'ETI-CHAR-2.1.0'
    and mirror_model_version = 'ETI-MIRROR-2.1.0'),
  constraint complete_reports_mentor_goal check (
    mentor_goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
    and mentor_goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')),
  constraint complete_reports_ready_has_output check (status <> 'ready' or (storage_path is not null and output_sha256 is not null and ready_at is not null)),
  -- 失効：日時が必須。生成物がある（storage_path あり）なら隔離日時も必須
  constraint complete_reports_revoked_quarantine check (
    status <> 'revoked' or (revoked_at is not null and (storage_path is null or quarantined_at is not null)))
);
create unique index complete_reports_one_active_per_session
  on public.complete_reports (diagnosis_session_id) where status <> 'revoked';
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256);
create index complete_reports_due_idx on public.complete_reports (status, next_retry_at) where status in ('queued', 'failed');

-- 7. 権限：anon・authenticated には何も与えない（GRANT なし）。RLS も有効にしてポリシーを作らない（二層）。
revoke all on table public.complete_orders, public.record_entitlements, public.stripe_webhook_events,
                    public.complete_reports, public.record_mentor_goals
  from public, anon, authenticated;
grant select, insert, update on table public.complete_orders, public.record_entitlements, public.stripe_webhook_events,
                                      public.complete_reports, public.record_mentor_goals
  to service_role;
alter table public.complete_orders       enable row level security;
alter table public.record_entitlements   enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.complete_reports      enable row level security;
alter table public.record_mentor_goals   enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。DELETE は与えない：記録は消さず状態で表す）

-- 8. 生成ジョブの貸出し（多重実行を防ぐ）。service_role だけが実行できる。
--    queued、再試行時刻を過ぎた failed、貸出し期限切れの generating のうち1件を、期限付きで generating にして返す。
create or replace function public.claim_complete_report_job(p_lease_seconds integer default 120)
  returns table (report_id uuid, diagnosis_session_id uuid, lease_token uuid)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
begin
  select r.id into v_id
    from public.complete_reports r
   where (r.status = 'queued'
          or (r.status = 'failed' and r.attempts < r.max_attempts and r.next_retry_at <= now())
          or (r.status = 'generating' and r.lease_expires_at < now()))
   order by r.created_at
   limit 1
   for update skip locked;
  if v_id is null then return; end if;
  update public.complete_reports
     set status = 'generating', attempts = attempts + 1, lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
         generating_at = now(), updated_at = now()
   where id = v_id;
  return query select v_id, (select r2.diagnosis_session_id from public.complete_reports r2 where r2.id = v_id), v_token;
end;
$$;

revoke all on function public.claim_complete_report_job(integer) from public, anon, authenticated;
revoke all on function public.complete_rc1_required_versions() from public, anon, authenticated;
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_guard() from public, anon, authenticated;
revoke all on function public.record_entitlements_guard() from public, anon, authenticated;
grant execute on function public.claim_complete_report_job(integer) to service_role;
grant execute on function public.complete_rc1_required_versions() to service_role;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261007113230_complete_02_service_role_privileges.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. service_role から余分な権限を外す
revoke truncate, references, trigger, maintain
  on table public.complete_orders, public.record_entitlements, public.stripe_webhook_events,
           public.complete_reports, public.record_mentor_goals
  from service_role;

-- 2. 結果を確かめる（変更はしない。期待と違えば全体を取り消す）
--    service_role：SELECT・INSERT・UPDATE あり／DELETE・TRUNCATE・REFERENCES・TRIGGER・MAINTAIN なし
--    anon・authenticated：どの権限もなし
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', t, p) then
        raise exception 'service_role lacks % on %', p, t;
      end if;
    end loop;
    foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then
        raise exception 'service_role still has % on %', p, t;
      end if;
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('anon', t, p) or has_table_privilege('authenticated', t, p) then
        raise exception 'anon or authenticated has % on %', p, t;
      end if;
    end loop;
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261007205700_complete_03_mentor_goal_ownership.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 所有者・決済中の変更・同じ目標の再送を扱うトリガー関数
create or replace function public.record_mentor_goals_ownership()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  -- 所有者：INSERT・UPDATE のたびに確かめる（変更された列に関係なく。同じ目標の再送でも先に確かめる）
  if new.user_id is null or new.diagnosis_session_id is null or not exists (
    select 1 from public.diagnosis_sessions s
     where s.id = new.diagnosis_session_id and s.user_id = new.user_id) then
    raise exception 'mentor_goal_record_not_found' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.goal_id is not distinct from old.goal_id
       and new.goal_catalog_version is not distinct from old.goal_catalog_version then
      -- 同じ目標の再送（所有者確認を通った後だけ）：選択日時を動かさない（冪等）
      new.selected_at := old.selected_at;
    elsif old.locked_at is null then
      -- 支払い前の選び直し：決済待ち・支払済みの注文がある間は変えない
      if exists (select 1 from public.complete_orders o
                  where o.diagnosis_session_id = old.diagnosis_session_id
                    and o.status in ('created', 'checkout_open', 'paid', 'disputed')) then
        raise exception 'mentor_goal_checkout_in_progress' using errcode = '42501';
      end if;
    end if;
    -- 支払後（locked_at あり）の変更は、続く record_mentor_goals_guard が mentor_goal_locked で拒否する
  end if;
  return new;
end;
$$;

revoke all on function public.record_mentor_goals_ownership() from public, anon, authenticated;

create or replace trigger record_mentor_goals_0_ownership
  before insert or update on public.record_mentor_goals
  for each row execute function public.record_mentor_goals_ownership();

-- 2. 記録（diagnosis_sessions）の所有者を固定する
create or replace function public.diagnosis_sessions_owner_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'diagnosis_session_owner_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.diagnosis_sessions_owner_immutable() from public, anon, authenticated;

create or replace trigger diagnosis_sessions_owner_immutable
  before update of user_id on public.diagnosis_sessions
  for each row execute function public.diagnosis_sessions_owner_immutable();

-- 3. 既存の行が所有者の規則を満たすことを確かめ、権限・トリガーの順序を確認する（変更はしない）
do $$
declare
  t text;
  p text;
begin
  if exists (select 1 from public.record_mentor_goals g
              where not exists (select 1 from public.diagnosis_sessions s
                                 where s.id = g.diagnosis_session_id and s.user_id = g.user_id)) then
    raise exception 'existing record_mentor_goals rows violate ownership';
  end if;
  if (select array_agg(tgname::text order by tgname) from pg_trigger
       where tgrelid = 'public.record_mentor_goals'::regclass and not tgisinternal)
     is distinct from array['record_mentor_goals_0_ownership', 'record_mentor_goals_guard'] then
    raise exception 'unexpected triggers on record_mentor_goals';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.diagnosis_sessions'::regclass
                  and tgname = 'diagnosis_sessions_owner_immutable' and not tgisinternal) then
    raise exception 'diagnosis_sessions_owner_immutable trigger missing';
  end if;
  if has_function_privilege('anon', 'public.record_mentor_goals_ownership()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_mentor_goals_ownership()', 'EXECUTE')
     or has_function_privilege('anon', 'public.diagnosis_sessions_owner_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.diagnosis_sessions_owner_immutable()', 'EXECUTE') then
    raise exception 'anon or authenticated can execute complete_03 trigger functions';
  end if;
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', t, p) then
        raise exception 'service_role lacks % on %', p, t;
      end if;
    end loop;
    foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then
        raise exception 'service_role has % on %', p, t;
      end if;
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('anon', t, p) or has_table_privilege('authenticated', t, p) then
        raise exception 'anon or authenticated has % on %', p, t;
      end if;
    end loop;
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261007213147_complete_04_payment_transactions.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 旧 ¥1,000 購入権の結び付け（旧購入権1件 → 1人・1記録。一度だけ。更新・削除しない）
create table if not exists public.complete_legacy_bindings (
  id                     uuid primary key default gen_random_uuid(),
  legacy_entitlement_id  uuid not null references public.purchase_entitlements(id) on delete restrict,
  user_id                uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id   uuid not null references public.diagnosis_sessions(id) on delete restrict,
  match_method           text not null check (match_method in ('stripe_email_verified', 'operator_verified')),
  bound_at               timestamptz not null default now()
);
create unique index if not exists complete_legacy_bindings_entitlement_uq on public.complete_legacy_bindings (legacy_entitlement_id);
create unique index if not exists complete_legacy_bindings_session_uq on public.complete_legacy_bindings (diagnosis_session_id);

revoke all on table public.complete_legacy_bindings from public, anon, authenticated;
revoke all on table public.complete_legacy_bindings from service_role;
grant select, insert on table public.complete_legacy_bindings to service_role;
alter table public.complete_legacy_bindings enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する）

-- 結び付けの前提（関数を通さない直接の INSERT でも確かめる）：
--   本人の記録・旧購入権が有効（active・core1／complete）・旧購入権の診断コードのハッシュが記録の診断コードと一致
create or replace function public.complete_legacy_bindings_check()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_ref text;
begin
  select case when s.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end
    into v_ref
    from public.diagnosis_sessions s
    join public.diagnosis_answers a on a.session_id = s.id
   where s.id = new.diagnosis_session_id and s.user_id = new.user_id;
  if v_ref is null then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.purchase_entitlements e
     where e.id = new.legacy_entitlement_id
       and e.status = 'active'
       and e.product_type in ('core1', 'complete')
       and e.diagnosis_code_hash = encode(sha256(convert_to(v_ref, 'UTF8')), 'hex')) then
    raise exception 'complete_legacy_not_matched' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.complete_legacy_bindings_check() from public, anon, authenticated;
create or replace trigger complete_legacy_bindings_check
  before insert on public.complete_legacy_bindings
  for each row execute function public.complete_legacy_bindings_check();

-- 2. 同じ記録の再購入を禁止する（注文作成の前提に加える）
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = new.diagnosis_session_id
                and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;
create or replace trigger complete_orders_no_repurchase
  before insert on public.complete_orders
  for each row execute function public.complete_orders_no_repurchase();

-- 3. 注文の状態を後戻りさせない
create or replace function public.complete_orders_state_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if (old.status = 'created'       and new.status in ('checkout_open', 'failed', 'canceled', 'expired', 'paid', 'refunded'))
  or (old.status = 'checkout_open' and new.status in ('expired', 'failed', 'canceled', 'paid', 'refunded'))
  or (old.status = 'expired'       and new.status in ('paid', 'refunded'))
  or (old.status = 'canceled'      and new.status in ('paid', 'refunded'))
  or (old.status = 'failed'        and new.status in ('refunded'))
  or (old.status = 'paid'          and new.status in ('disputed', 'refunded'))
  or (old.status = 'disputed'      and new.status in ('paid', 'refunded')) then
    return new;
  end if;
  raise exception 'complete_order_invalid_transition' using errcode = '42501';
end;
$$;
revoke all on function public.complete_orders_state_guard() from public, anon, authenticated;
create or replace trigger complete_orders_state_guard
  before update of status on public.complete_orders
  for each row execute function public.complete_orders_state_guard();

-- 4. Webhook イベントの受付（内部用）。処理済み・無視済みなら false（二度処理しない）。received・failed は処理し直す。
--    同じイベントの同時配送は行ロックで直列にする。
create or replace function public.complete_webhook_gate(p_event_id text, p_event_type text, p_livemode boolean, p_event_created timestamptz)
  returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_status text;
begin
  insert into public.stripe_webhook_events (event_id, event_type, livemode, event_created)
  values (p_event_id, p_event_type, p_livemode, p_event_created)
  on conflict (event_id) do nothing;
  select e.status into v_status from public.stripe_webhook_events e where e.event_id = p_event_id for update;
  return v_status in ('received', 'failed');
end;
$$;

-- イベントの結果を記録する（内部用・API からも使う）。processed のイベントは変えない。
create or replace function public.complete_webhook_finish(p_event_id text, p_event_type text, p_livemode boolean,
                                                          p_event_created timestamptz, p_status text, p_error_code text,
                                                          p_order_id uuid default null)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'complete_invalid_event_status' using errcode = '22023';
  end if;
  insert into public.stripe_webhook_events (event_id, event_type, livemode, event_created)
  values (p_event_id, p_event_type, p_livemode, p_event_created)
  on conflict (event_id) do nothing;
  select e.status into v_status from public.stripe_webhook_events e where e.event_id = p_event_id for update;
  if v_status = 'processed' or (v_status = 'ignored' and p_status = 'failed') then
    return v_status;
  end if;
  update public.stripe_webhook_events
     set status = p_status, error_code = p_error_code, order_id = coalesce(p_order_id, order_id),
         processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end
   where event_id = p_event_id;
  return p_status;
end;
$$;

-- 5. 注文の作成（Checkout Session を作る前）。同じ記録の処理は直列にする。
--    既存の決済待ち注文（created／checkout_open）があればそれを返す（created = false）。
create or replace function public.complete_create_order(p_user_id uuid, p_diagnosis_session_id uuid,
                                                        p_offer text, p_idempotency_key text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_has_record_analysis boolean;
  v_has_legacy_binding boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
begin
  if p_offer not in ('direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  if not exists (select 1 from public.diagnosis_sessions s where s.id = p_diagnosis_session_id and s.user_id = p_user_id) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  -- 同じ Idempotency-Key の再送：同じ内容なら同じ注文を返す
  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  -- 再購入の禁止（トリガーでも確かめる）
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  -- 決済待ちの注文があればそれを返す
  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  -- 解析権の根拠：記録単位の analysis 権（active）、または一度だけ固定した旧 ¥1,000 購入権。診断コードのハッシュ一致だけでは認めない。
  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.user_id = p_user_id and e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  v_has_legacy_binding := exists (select 1 from public.complete_legacy_bindings b
                                   join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                                  where b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id
                                    and pe.status = 'active');
  if p_offer = 'direct_complete' then
    if v_has_record_analysis or v_has_legacy_binding then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    -- 旧 ¥1,000 の購入（診断コードのハッシュが一致）があるのに結び付けが未完了：¥3,000 へ誘導しない（「既存の購入を確認中」）
    if exists (
      select 1
        from public.diagnosis_sessions s
        join public.diagnosis_answers a on a.session_id = s.id
        join public.purchase_entitlements pe
          on pe.diagnosis_code_hash = encode(sha256(convert_to(
               case when s.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end, 'UTF8')), 'hex')
       where s.id = p_diagnosis_session_id and pe.status = 'active' and pe.product_type in ('core1', 'complete')) then
      raise exception 'complete_legacy_purchase_pending' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 3000;
  else
    if v_has_record_analysis then
      v_basis := 'record_entitlement';
    elsif v_has_legacy_binding then
      v_basis := 'legacy_purchase_entitlement';
    else
      raise exception 'complete_upgrade_requires_analysis' using errcode = '42501';
    end if;
    v_amount := 2000;
  end if;

  select * into v_goal from public.record_mentor_goals g
   where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id = p_user_id;
  if not found then
    raise exception 'complete_mentor_goal_required' using errcode = '42501';
  end if;

  insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                      mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at)
  values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', v_basis, p_idempotency_key,
          v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at)
  returning id into v_id;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

-- 6. Checkout Session を作った後：created → checkout_open（同じ Session なら冪等）
create or replace function public.complete_mark_checkout_open(p_order_id uuid, p_checkout_session_id text, p_expires_at timestamptz)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then
    raise exception 'complete_checkout_session_mismatch' using errcode = '42501';
  end if;
  if v_order.status = 'checkout_open' then
    return 'noop';
  end if;
  if v_order.status <> 'created' then
    raise exception 'complete_order_not_open' using errcode = '42501';
  end if;
  update public.complete_orders
     set status = 'checkout_open', stripe_checkout_session_id = p_checkout_session_id,
         checkout_expires_at = p_expires_at, updated_at = now()
   where id = p_order_id;
  return 'applied';
end;
$$;

-- 7. Checkout Session を作れなかった・古い created を片付ける：created → failed／canceled
create or replace function public.complete_close_unopened_order(p_order_id uuid, p_status text, p_failure_code text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  if p_status not in ('failed', 'canceled') then
    raise exception 'complete_invalid_order_status' using errcode = '22023';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.status = p_status then
    return 'noop';
  end if;
  if v_order.status <> 'created' then
    raise exception 'complete_order_not_open' using errcode = '42501';
  end if;
  update public.complete_orders set status = p_status, failure_code = p_failure_code, updated_at = now() where id = p_order_id;
  return 'applied';
end;
$$;

-- 8. 支払い確定（checkout.session.completed・payment_status = paid）：
--    注文 paid・MENTOR ロック・権利付与・生成物 queued・イベント processed を1トランザクションで行う。
--    生成物の本文素材・テンプレート・入力のハッシュは API（生成器）が計算して渡す。版は保存済みの結果から写す。
create or replace function public.complete_apply_payment(
    p_event_id text, p_event_created timestamptz, p_livemode boolean,
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text,
    p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.completed';
  v_order public.complete_orders%rowtype;
  v_res public.diagnosis_results%rowtype;
  v_code text;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;

  -- 支払い内容の完全照合（恒久的な不一致は ignored。決済待ちの注文は failed にして権利を与えない）
  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from true or v_order.stripe_mode <> 'live' then 'livemode_mismatch'
    when p_currency is distinct from 'jpy' then 'currency_mismatch'
    when p_amount_total is distinct from v_order.amount then 'amount_mismatch'
    when v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', v_code, v_order.id);
    return 'ignored:' || v_code;
  end if;

  -- 既に支払い確定以降（重複・順序逆転）：状態を変えない
  if v_order.status in ('paid', 'disputed', 'refunded') then
    update public.complete_orders set last_stripe_event_id = p_event_id, last_event_created = greatest(last_event_created, p_event_created)
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  -- 期限切れ・片付け済みの注文に支払いが届いた：同じ記録に別の有効な注文があれば運営者確認
  if v_order.status in ('expired', 'canceled') and exists (
       select 1 from public.complete_orders o2
        where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
          and o2.status in ('created', 'checkout_open', 'paid', 'disputed', 'refunded')) then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'live_order_conflict', v_order.id);
    return 'ignored:live_order_conflict';
  end if;

  -- MENTOR：注文に写した目標で記録をロックする（支払い前に記録へ戻す）
  update public.record_mentor_goals
     set goal_id = v_order.mentor_goal_id, goal_catalog_version = v_order.mentor_goal_catalog_version,
         selected_at = v_order.mentor_goal_selected_at, locked_at = coalesce(locked_at, now())
   where diagnosis_session_id = v_order.diagnosis_session_id and user_id = v_order.user_id;
  if not found then
    raise exception 'complete_mentor_goal_missing' using errcode = '42501';
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  -- 権利：direct は analysis（既に有効な analysis 権が無い場合）と complete、upgrade は complete
  if v_order.offer = 'direct_complete' and not exists (
       select 1 from public.record_entitlements e
        where e.user_id = v_order.user_id and e.diagnosis_session_id = v_order.diagnosis_session_id
          and e.right_type = 'analysis' and e.status in ('active', 'suspended')) then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'analysis', v_order.id)
    on conflict (source_order_id, right_type) do nothing;
  end if;
  insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
  values (v_order.user_id, v_order.diagnosis_session_id, 'complete', v_order.id)
  on conflict (source_order_id, right_type) do nothing;

  -- 生成物：queued（同じ注文で既にあれば作らない）
  if not exists (select 1 from public.complete_reports r where r.source_order_id = v_order.id) then
    select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
    if not found then
      raise exception 'complete_result_missing' using errcode = '42501';
    end if;
    insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                         content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                         translation_model_version, character_profile_version, mirror_model_version,
                                         mentor_goal_catalog_version, mentor_goal_id, input_sha256)
    values (v_order.user_id, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
            p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
            v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
            v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256);
  end if;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 9. Checkout の期限切れ（checkout.session.expired）：決済待ちの注文だけ expired。支払い後は状態を戻さない。
create or replace function public.complete_apply_checkout_expired(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid, p_checkout_session_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.expired';
  v_order public.complete_orders%rowtype;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'checkout_session_mismatch', v_order.id);
    return 'ignored:checkout_session_mismatch';
  end if;
  if v_order.status in ('created', 'checkout_open') then
    update public.complete_orders
       set status = 'expired', last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
    return 'applied';
  end if;
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
  return 'noop';
end;
$$;

-- 10. 返金（charge.refunded）：全額なら注文 refunded・権利 revoked（refund）・生成物 revoked＋隔離。一部返金は記録だけ。
--     支払い確定より先に届いた場合も refunded を優先する（後から届く支払い確定は noop）。
create or replace function public.complete_apply_refund(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid,
    p_payment_intent_id text, p_amount_refunded integer)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'charge.refunded';
  v_order public.complete_orders%rowtype;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'payment_intent_mismatch', v_order.id);
    return 'ignored:payment_intent_mismatch';
  end if;
  if p_amount_refunded is null or p_amount_refunded < v_order.amount then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'partial_refund_recorded', v_order.id);
    return 'partial';
  end if;
  if v_order.status = 'refunded' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  update public.complete_orders
     set status = 'refunded', refunded_at = now(), stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         last_stripe_event_id = p_event_id, last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created),
         updated_at = now()
   where id = v_order.id;
  update public.record_entitlements
     set status = 'revoked', revoked_at = now(), revoke_reason = 'refund'
   where source_order_id = v_order.id and status <> 'revoked';
  update public.complete_reports
     set status = 'revoked', revoked_at = now(), quarantined_at = coalesce(quarantined_at, now()),
         lease_token = null, lease_expires_at = null, updated_at = now()
   where source_order_id = v_order.id and status <> 'revoked';
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 11. dispute（charge.dispute.created／closed）：
--     opened：paid → disputed・権利 suspended（dispute_open）。支払い確定前に届いた場合は complete_retry_later（API は 500 で再送させる）。
--             既に後のイベント（勝訴・敗訴など）を適用済みなら古い opened は無視する。
--     won   ：disputed → paid・suspended の権利を active に戻す。
--     lost  ：権利 revoked（dispute_lost）・生成物 revoked＋隔離。注文は disputed のまま（再購入不可）。
create or replace function public.complete_apply_dispute(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid,
    p_payment_intent_id text, p_action text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type text;
  v_order public.complete_orders%rowtype;
begin
  if p_action not in ('opened', 'won', 'lost') then
    raise exception 'complete_invalid_dispute_action' using errcode = '22023';
  end if;
  v_type := case when p_action = 'opened' then 'charge.dispute.created' else 'charge.dispute.closed' end;
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'payment_intent_mismatch', v_order.id);
    return 'ignored:payment_intent_mismatch';
  end if;
  if v_order.status = 'refunded' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  if v_order.status not in ('paid', 'disputed') then
    raise exception 'complete_retry_later' using errcode = '55000';
  end if;

  if p_action = 'opened' then
    if v_order.last_event_created is not null and p_event_created < v_order.last_event_created then
      perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'stale', v_order.id);
      return 'stale';
    end if;
    if v_order.status = 'disputed' then
      perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
      return 'noop';
    end if;
    update public.complete_orders
       set status = 'disputed', last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'suspended', suspended_at = now(), suspend_reason = 'dispute_open'
     where source_order_id = v_order.id and status = 'active';
  elsif p_action = 'won' then
    update public.complete_orders
       set status = 'paid', last_stripe_event_id = p_event_id,
           last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created), updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'active', suspended_at = null, suspend_reason = null
     where source_order_id = v_order.id and status = 'suspended';
  else
    update public.complete_orders
       set status = 'disputed', last_stripe_event_id = p_event_id,
           last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created), updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'revoked', revoked_at = now(), revoke_reason = 'dispute_lost'
     where source_order_id = v_order.id and status <> 'revoked';
    update public.complete_reports
       set status = 'revoked', revoked_at = now(), quarantined_at = coalesce(quarantined_at, now()),
           lease_token = null, lease_expires_at = null, updated_at = now()
     where source_order_id = v_order.id and status <> 'revoked';
  end if;
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 12. 旧 ¥1,000 購入権の結び付け（API が Stripe の購入時メールと Auth の本人メールの一致を確かめた後に呼ぶ）。
--     同じ旧購入権・同じ記録の再呼び出しは冪等。別の人・別の記録へは結び付けない。
create or replace function public.complete_bind_legacy_purchase(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                p_legacy_entitlement_id uuid, p_match_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_binding public.complete_legacy_bindings%rowtype;
begin
  if p_match_method not in ('stripe_email_verified', 'operator_verified') then
    raise exception 'complete_invalid_match_method' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_legacy:' || p_legacy_entitlement_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_binding from public.complete_legacy_bindings b where b.legacy_entitlement_id = p_legacy_entitlement_id;
  if found then
    if v_binding.user_id = p_user_id and v_binding.diagnosis_session_id = p_diagnosis_session_id then
      return 'noop';
    end if;
    raise exception 'complete_legacy_already_bound' using errcode = '42501';
  end if;
  if exists (select 1 from public.complete_legacy_bindings b where b.diagnosis_session_id = p_diagnosis_session_id) then
    raise exception 'complete_legacy_record_already_bound' using errcode = '42501';
  end if;
  insert into public.complete_legacy_bindings (legacy_entitlement_id, user_id, diagnosis_session_id, match_method)
  values (p_legacy_entitlement_id, p_user_id, p_diagnosis_session_id, p_match_method);
  return 'applied';
end;
$$;

-- 13. 関数の権限：EXECUTE は service_role だけ（トリガー関数はどのロールにも与えない）
revoke all on function public.complete_webhook_gate(text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_webhook_finish(text, text, boolean, timestamptz, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_create_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_mark_checkout_open(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_close_unopened_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_apply_checkout_expired(text, timestamptz, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_apply_refund(text, timestamptz, boolean, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_webhook_gate(text, text, boolean, timestamptz) to service_role;
grant execute on function public.complete_webhook_finish(text, text, boolean, timestamptz, text, text, uuid) to service_role;
grant execute on function public.complete_create_order(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_mark_checkout_open(uuid, text, timestamptz) to service_role;
grant execute on function public.complete_close_unopened_order(uuid, text, text) to service_role;
grant execute on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;
grant execute on function public.complete_apply_checkout_expired(text, timestamptz, boolean, uuid, text) to service_role;
grant execute on function public.complete_apply_refund(text, timestamptz, boolean, uuid, text, integer) to service_role;
grant execute on function public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text) to service_role;
grant execute on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) to service_role;

-- 14. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  t text;
  p text;
  f text;
begin
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', t, p) then raise exception 'service_role lacks % on %', p, t; end if;
    end loop;
    foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then raise exception 'service_role has % on %', p, t; end if;
    end loop;
  end loop;
  foreach p in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('service_role', 'public.complete_legacy_bindings', p) then
      raise exception 'service_role lacks % on complete_legacy_bindings', p;
    end if;
  end loop;
  foreach p in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
    if has_table_privilege('service_role', 'public.complete_legacy_bindings', p) then
      raise exception 'service_role has % on complete_legacy_bindings', p;
    end if;
  end loop;
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals', 'public.complete_legacy_bindings'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('anon', t, p) or has_table_privilege('authenticated', t, p) then
        raise exception 'anon or authenticated has % on %', p, t;
      end if;
    end loop;
  end loop;
  foreach f in array array['public.complete_webhook_gate(text, text, boolean, timestamptz)',
                           'public.complete_webhook_finish(text, text, boolean, timestamptz, text, text, uuid)',
                           'public.complete_create_order(uuid, uuid, text, text)',
                           'public.complete_mark_checkout_open(uuid, text, timestamptz)',
                           'public.complete_close_unopened_order(uuid, text, text)',
                           'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)',
                           'public.complete_apply_checkout_expired(text, timestamptz, boolean, uuid, text)',
                           'public.complete_apply_refund(text, timestamptz, boolean, uuid, text, integer)',
                           'public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text)',
                           'public.complete_bind_legacy_purchase(uuid, uuid, uuid, text)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  foreach f in array array['public.complete_legacy_bindings_check()', 'public.complete_orders_no_repurchase()',
                           'public.complete_orders_state_guard()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'trigger function % is executable by an API role', f;
    end if;
  end loop;
  -- complete_04 が作る関数はすべて SECURITY INVOKER・search_path 空（onboarding_01 の complete_registration_onboarding は対象外）
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_legacy_bindings_check', 'complete_orders_no_repurchase', 'complete_orders_state_guard',
                                'complete_webhook_gate', 'complete_webhook_finish', 'complete_create_order',
                                'complete_mark_checkout_open', 'complete_close_unopened_order', 'complete_apply_payment',
                                'complete_apply_checkout_expired', 'complete_apply_refund', 'complete_apply_dispute',
                                'complete_bind_legacy_purchase')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_04 function is not security invoker with empty search_path';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261007234325_complete_05_admin_audit_log.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 運営者操作の監査ログ（追記だけ・固定項目だけ）
create table if not exists public.complete_admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid not null,                     -- API が JWT と COMPLETE_ADMIN_USER_ID で確認した運営者（外部キーにしない）
  action         text not null check (action in ('legacy_binding_approve', 'legacy_binding_reject')),
  target_type    text not null check (target_type = 'legacy_entitlement'),
  target_id      uuid not null,
  outcome        text not null check (outcome in ('applied', 'noop', 'rejected', 'failed')),
  reason_code    text not null,
  incident_id    text not null check (incident_id ~ '^[0-9a-f]{12}$'),
  created_at     timestamptz not null default now(),
  constraint complete_admin_audit_log_incident_unique unique (incident_id),
  -- 理由コードは操作・結果ごとに意味を固定する（自由記述・未認証・未認可は入れない）
  constraint complete_admin_audit_log_reason_code check (
    (action = 'legacy_binding_approve' and outcome = 'applied' and reason_code = 'operator_verified')
    or (action = 'legacy_binding_approve' and outcome = 'noop' and reason_code = 'already_bound')
    or (action = 'legacy_binding_reject' and outcome = 'rejected'
        and reason_code in ('email_mismatch', 'auth_email_missing', 'stripe_session_unavailable',
                            'purchase_not_eligible', 'identity_unverified'))
    or (outcome = 'failed'
        and reason_code in ('invalid_request', 'record_not_found', 'legacy_purchase_not_found', 'binding_conflict',
                            'purchase_hash_mismatch', 'database_error', 'internal_error')))
);
create index if not exists complete_admin_audit_log_target_idx on public.complete_admin_audit_log (target_type, target_id, created_at desc);
create index if not exists complete_admin_audit_log_created_idx on public.complete_admin_audit_log (created_at desc);

revoke all on table public.complete_admin_audit_log from public, anon, authenticated;
revoke all on table public.complete_admin_audit_log from service_role;
grant select, insert on table public.complete_admin_audit_log to service_role;
alter table public.complete_admin_audit_log enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する）

-- 追記だけ：UPDATE・DELETE・TRUNCATE を拒否する（権限を持つ所有者による操作も止める）
create or replace function public.complete_admin_audit_log_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'complete_admin_audit_log_immutable' using errcode = '42501';
end;
$$;
revoke all on function public.complete_admin_audit_log_immutable() from public, anon, authenticated, service_role;
create or replace trigger complete_admin_audit_log_no_update
  before update or delete on public.complete_admin_audit_log
  for each row execute function public.complete_admin_audit_log_immutable();
create or replace trigger complete_admin_audit_log_no_truncate
  before truncate on public.complete_admin_audit_log
  for each statement execute function public.complete_admin_audit_log_immutable();

-- 2. 旧 ¥1,000 購入権の手動承認：結び付け（complete_04 の検査）と監査ログを1トランザクションで
--    戻り値：applied（新しく固定）／noop（同じ購入権・同じ記録へ固定済み）。
--    同じ照合 ID の再送は行を増やさず前回の結果（applied／noop／failed）を返す。内容が違えば complete_admin_incident_conflict。
--    例外（API が failed の理由コードへ対応付ける）：
--      complete_admin_invalid_request → invalid_request ／ complete_record_not_found → record_not_found ／
--      complete_legacy_purchase_not_found → legacy_purchase_not_found ／ complete_legacy_not_matched → purchase_hash_mismatch ／
--      complete_legacy_already_bound・complete_legacy_record_already_bound → binding_conflict
create or replace function public.complete_admin_approve_legacy_binding(
    p_actor_user_id uuid, p_user_id uuid, p_diagnosis_session_id uuid, p_legacy_entitlement_id uuid, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_admin_audit_log%rowtype;
  v_result text;
begin
  if p_actor_user_id is null or p_user_id is null or p_diagnosis_session_id is null or p_legacy_entitlement_id is null
     or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_admin_incident:' || p_incident_id, 0));
  select * into v_prev from public.complete_admin_audit_log a where a.incident_id = p_incident_id;
  if found then
    if v_prev.actor_user_id <> p_actor_user_id or v_prev.action <> 'legacy_binding_approve'
       or v_prev.target_id <> p_legacy_entitlement_id then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    if v_prev.outcome in ('applied', 'noop') and not exists (
         select 1 from public.complete_legacy_bindings b
          where b.legacy_entitlement_id = p_legacy_entitlement_id
            and b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id) then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.outcome;
  end if;
  if not exists (select 1 from public.purchase_entitlements e where e.id = p_legacy_entitlement_id) then
    raise exception 'complete_legacy_purchase_not_found' using errcode = '42501';
  end if;
  v_result := public.complete_bind_legacy_purchase(p_user_id, p_diagnosis_session_id, p_legacy_entitlement_id, 'operator_verified');
  insert into public.complete_admin_audit_log (actor_user_id, action, target_type, target_id, outcome, reason_code, incident_id)
  values (p_actor_user_id, 'legacy_binding_approve', 'legacy_entitlement', p_legacy_entitlement_id, v_result,
          case when v_result = 'applied' then 'operator_verified' else 'already_bound' end, p_incident_id);
  return v_result;
end;
$$;

-- 3. 旧 ¥1,000 購入権の手動却下：結び付けは作らず、却下の理由コードだけを記録する。戻り値：rejected
--    同じ照合 ID の再送は行を増やさず前回の結果を返す。内容（運営者・操作・対象・理由コード）が違えば complete_admin_incident_conflict。
--    例外：complete_admin_invalid_request・complete_admin_invalid_reason → invalid_request ／
--          complete_legacy_purchase_not_found → legacy_purchase_not_found ／ complete_legacy_already_bound → binding_conflict
create or replace function public.complete_admin_reject_legacy_binding(
    p_actor_user_id uuid, p_legacy_entitlement_id uuid, p_reason_code text, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_admin_audit_log%rowtype;
begin
  if p_actor_user_id is null or p_legacy_entitlement_id is null
     or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('email_mismatch', 'auth_email_missing', 'stripe_session_unavailable',
                                                   'purchase_not_eligible', 'identity_unverified') then
    raise exception 'complete_admin_invalid_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_admin_incident:' || p_incident_id, 0));
  select * into v_prev from public.complete_admin_audit_log a where a.incident_id = p_incident_id;
  if found then
    if v_prev.actor_user_id <> p_actor_user_id or v_prev.action <> 'legacy_binding_reject'
       or v_prev.target_id <> p_legacy_entitlement_id
       or (v_prev.outcome = 'rejected' and v_prev.reason_code <> p_reason_code) then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.outcome;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_legacy:' || p_legacy_entitlement_id::text, 0));
  if not exists (select 1 from public.purchase_entitlements e where e.id = p_legacy_entitlement_id) then
    raise exception 'complete_legacy_purchase_not_found' using errcode = '42501';
  end if;
  if exists (select 1 from public.complete_legacy_bindings b where b.legacy_entitlement_id = p_legacy_entitlement_id) then
    raise exception 'complete_legacy_already_bound' using errcode = '42501';
  end if;
  insert into public.complete_admin_audit_log (actor_user_id, action, target_type, target_id, outcome, reason_code, incident_id)
  values (p_actor_user_id, 'legacy_binding_reject', 'legacy_entitlement', p_legacy_entitlement_id, 'rejected', p_reason_code, p_incident_id);
  return 'rejected';
end;
$$;

-- 4. 失敗の記録（操作のトランザクションが取り消された後に、API が同じ照合 ID で別に呼ぶ）。戻り値：failed
--    理由コードは失敗用の一覧だけ（CHECK）。同じ照合 ID・同じ内容の再送は行を増やさない。内容が違えば complete_admin_incident_conflict。
create or replace function public.complete_admin_record_failure(
    p_actor_user_id uuid, p_action text, p_target_id uuid, p_reason_code text, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_admin_audit_log%rowtype;
begin
  if p_actor_user_id is null or p_target_id is null or p_incident_id is null then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_admin_incident:' || p_incident_id, 0));
  select * into v_prev from public.complete_admin_audit_log a where a.incident_id = p_incident_id;
  if found then
    if v_prev.actor_user_id <> p_actor_user_id or v_prev.action is distinct from p_action
       or v_prev.target_id <> p_target_id or v_prev.outcome <> 'failed' or v_prev.reason_code is distinct from p_reason_code then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return 'failed';
  end if;
  insert into public.complete_admin_audit_log (actor_user_id, action, target_type, target_id, outcome, reason_code, incident_id)
  values (p_actor_user_id, p_action, 'legacy_entitlement', p_target_id, 'failed', p_reason_code, p_incident_id);
  return 'failed';
end;
$$;

-- 5. 関数の権限：呼び出し関数の EXECUTE は service_role だけ
revoke all on function public.complete_admin_approve_legacy_binding(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_admin_reject_legacy_binding(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_admin_record_failure(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_admin_approve_legacy_binding(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_admin_reject_legacy_binding(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_admin_record_failure(uuid, text, uuid, text, text) to service_role;

-- 6. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  p text;
  f text;
begin
  foreach p in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('service_role', 'public.complete_admin_audit_log', p) then
      raise exception 'service_role lacks % on complete_admin_audit_log', p;
    end if;
  end loop;
  foreach p in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
    if has_table_privilege('service_role', 'public.complete_admin_audit_log', p) then
      raise exception 'service_role has % on complete_admin_audit_log', p;
    end if;
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
    if has_table_privilege('anon', 'public.complete_admin_audit_log', p) or has_table_privilege('authenticated', 'public.complete_admin_audit_log', p) then
      raise exception 'anon or authenticated has % on complete_admin_audit_log', p;
    end if;
  end loop;
  foreach f in array array['public.complete_admin_approve_legacy_binding(uuid, uuid, uuid, uuid, text)',
                           'public.complete_admin_reject_legacy_binding(uuid, uuid, text, text)',
                           'public.complete_admin_record_failure(uuid, text, uuid, text, text)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.complete_admin_audit_log_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_admin_audit_log_immutable()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.complete_admin_audit_log_immutable()', 'EXECUTE') then
    raise exception 'trigger function is executable by an API role';
  end if;
  if exists (select 1 from pg_proc p2 where p2.pronamespace = 'public'::regnamespace
              and p2.proname in ('complete_admin_audit_log_immutable', 'complete_admin_approve_legacy_binding',
                                 'complete_admin_reject_legacy_binding', 'complete_admin_record_failure')
              and (p2.prosecdef or p2.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_05 function is not security invoker with empty search_path';
  end if;
  if (select count(*) from pg_proc p3 where p3.pronamespace = 'public'::regnamespace and p3.proname like 'complete\_admin\_%') <> 4 then
    raise exception 'unexpected complete_admin functions';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.complete_admin_audit_log'::regclass and not tgisinternal) <> 2 then
    raise exception 'unexpected triggers on complete_admin_audit_log';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261008101348_complete_06_report_storage.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 保存先の形式（reports/<自分の report_id>/<試行回数>-<乱数32桁>.html だけ）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'complete_reports_storage_path_format'
                   and conrelid = 'public.complete_reports'::regclass) then
    alter table public.complete_reports add constraint complete_reports_storage_path_format check (
      storage_path is null or storage_path ~ ('^reports/' || id::text || '/[0-9]{1,2}-[0-9a-f]{32}\.html$'));
  end if;
end
$$;

-- 2. 生成ジョブの取得：p_report_id を指定すればその行だけ、null なら期限の来た最も古い行。取れなければ0行。
create or replace function public.complete_claim_report(p_report_id uuid, p_lease_seconds integer default 120)
  returns table (report_id uuid, lease_token uuid, attempt integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
  v_attempt integer;
begin
  select r.id into v_id
    from public.complete_reports r
   where (p_report_id is null or r.id = p_report_id)
     and (r.status = 'queued'
          or (r.status = 'failed' and r.attempts < r.max_attempts and r.next_retry_at <= now())
          or (r.status = 'generating' and r.lease_expires_at < now() and r.attempts < r.max_attempts))
   order by r.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  update public.complete_reports
     set status = 'generating', attempts = attempts + 1, lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
         generating_at = now(), updated_at = now()
   where id = v_id
  returning attempts into v_attempt;
  return query select v_id, v_token, v_attempt;
end;
$$;

-- 3. 生成の完了：lease を持ったまま generating の時だけ ready にする。戻り値：ready／lost_lease／revoked
create or replace function public.complete_finish_report(p_report_id uuid, p_lease_token uuid, p_storage_path text, p_output_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
begin
  if p_output_sha256 is null or p_output_sha256 !~ '^[0-9a-f]{64}$'
     or p_storage_path is null or p_storage_path !~ ('^reports/' || p_report_id::text || '/[0-9]{1,2}-[0-9a-f]{32}\.html$') then
    raise exception 'complete_invalid_report_output' using errcode = '22023';
  end if;
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'complete_report_not_found' using errcode = '42501';
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null then
    return 'revoked';
  end if;
  if v_report.status <> 'generating' or v_report.lease_token is distinct from p_lease_token then
    return 'lost_lease';
  end if;
  update public.complete_reports
     set status = 'ready', storage_path = p_storage_path, output_sha256 = p_output_sha256, ready_at = now(),
         lease_token = null, lease_expires_at = null, last_error_code = null, next_retry_at = null, updated_at = now()
   where id = p_report_id;
  return 'ready';
end;
$$;

-- 4. 生成の失敗：lease を持ったまま generating の時だけ failed にする。戻り値：failed／stopped／lost_lease／revoked
create or replace function public.complete_fail_report(p_report_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_stop boolean;
begin
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'complete_invalid_error_code' using errcode = '22023';
  end if;
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'complete_report_not_found' using errcode = '42501';
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null then
    return 'revoked';
  end if;
  if v_report.status <> 'generating' or v_report.lease_token is distinct from p_lease_token then
    return 'lost_lease';
  end if;
  v_stop := not coalesce(p_retryable, false) or v_report.attempts >= v_report.max_attempts;
  update public.complete_reports
     set status = 'failed', failed_at = now(), last_error_code = p_error_code,
         attempts = case when v_stop then greatest(v_report.attempts, v_report.max_attempts) else v_report.attempts end,
         next_retry_at = case when v_stop then null
                              else now() + make_interval(secs => least(3600, 60 * power(2, greatest(v_report.attempts - 1, 0))::integer)) end,
         lease_token = null, lease_expires_at = null, updated_at = now()
   where id = p_report_id;
  return case when v_stop then 'stopped' else 'failed' end;
end;
$$;

-- 5. 閲覧の権限確認：本人の記録・生成物 ready（失効・隔離なし）・注文 paid・完全解析権 active の時だけ保存先を返す。
--    state：ok／not_found（本人の生成物が無い）／not_entitled（権利が active でない・注文が paid でない）／not_ready（生成中・失敗）
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order_status text;
  v_entitled boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id = p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select o.status into v_order_status from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id = p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id = p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order_status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;

-- 6. 関数の権限：EXECUTE は service_role だけ
revoke all on function public.complete_claim_report(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_finish_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_fail_report(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.complete_report_for_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_claim_report(uuid, integer) to service_role;
grant execute on function public.complete_finish_report(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_fail_report(uuid, uuid, text, boolean) to service_role;
grant execute on function public.complete_report_for_view(uuid, uuid) to service_role;

-- 7. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  f text;
begin
  foreach f in array array['public.complete_claim_report(uuid, integer)', 'public.complete_finish_report(uuid, uuid, text, text)',
                           'public.complete_fail_report(uuid, uuid, text, boolean)', 'public.complete_report_for_view(uuid, uuid)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_claim_report', 'complete_finish_report', 'complete_fail_report', 'complete_report_for_view')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_06 function is not security invoker with empty search_path';
  end if;
  if has_table_privilege('service_role', 'public.complete_reports', 'DELETE') or has_table_privilege('service_role', 'public.complete_reports', 'TRUNCATE')
     or has_table_privilege('anon', 'public.complete_reports', 'SELECT') or has_table_privilege('authenticated', 'public.complete_reports', 'SELECT') then
    raise exception 'unexpected privileges on complete_reports';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261009120000_complete_07_guest_checkout_claim.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 記録：ゲスト購入の記録（所有者 NULL）を許す
alter table public.diagnosis_sessions alter column user_id drop not null;
alter table public.diagnosis_sessions add column if not exists guest_created_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diagnosis_sessions_owner_or_guest'
                   and conrelid = 'public.diagnosis_sessions'::regclass) then
    alter table public.diagnosis_sessions add constraint diagnosis_sessions_owner_or_guest
      check (user_id is not null or guest_created_at is not null) not valid;
    alter table public.diagnosis_sessions validate constraint diagnosis_sessions_owner_or_guest;
  end if;
end
$$;
comment on column public.diagnosis_sessions.user_id is
  'NULL はゲスト購入の記録（サーバーだけが作る。RLS で誰からも見えない）。引き継ぎ（complete_claim_guest_record）で1度だけ本人を入れる';
comment on column public.diagnosis_sessions.guest_created_at is
  'ゲスト購入の記録を作った日時（サーバーが作った記録の目印。引き継ぎ後も残す）';

-- 記録の所有者の固定：引き継ぎ関数の中で NULL → 本人の時だけ許す
create or replace function public.diagnosis_sessions_owner_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    if old.user_id is null and new.user_id is not null and old.guest_created_at is not null
       and current_setting('app.complete_claim', true) = 'on' then
      return new;
    end if;
    raise exception 'diagnosis_session_owner_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2. 注文
alter table public.complete_orders alter column user_id drop not null;
alter table public.complete_orders alter column mentor_goal_catalog_version drop not null;
alter table public.complete_orders alter column mentor_goal_id drop not null;
alter table public.complete_orders alter column mentor_goal_selected_at drop not null;
alter table public.complete_orders add column if not exists buyer text not null default 'user';
alter table public.complete_orders add column if not exists claim_secret_hash text;
alter table public.complete_orders add column if not exists claim_expires_at timestamptz;
alter table public.complete_orders add column if not exists claimed_by uuid references public.profiles(id) on delete restrict;
alter table public.complete_orders add column if not exists claimed_at timestamptz;
alter table public.complete_orders add column if not exists claim_method text;
alter table public.complete_orders add column if not exists purchase_email_hmac text;

alter table public.complete_orders drop constraint if exists complete_orders_offer_check;
alter table public.complete_orders drop constraint if exists complete_orders_amount_matches_offer;
alter table public.complete_orders drop constraint if exists complete_orders_upgrade_has_basis;
alter table public.complete_orders drop constraint if exists complete_orders_mentor_goal;
alter table public.complete_orders drop constraint if exists complete_orders_buyer_check;
alter table public.complete_orders drop constraint if exists complete_orders_claim_method_check;
alter table public.complete_orders drop constraint if exists complete_orders_hash_format;
alter table public.complete_orders drop constraint if exists complete_orders_buyer_consistency;
alter table public.complete_orders add constraint complete_orders_offer_check
  check (offer in ('analysis', 'direct_complete', 'analysis_upgrade'));
alter table public.complete_orders add constraint complete_orders_amount_matches_offer check (
  (offer = 'analysis' and amount = 1000) or (offer = 'direct_complete' and amount = 3000) or (offer = 'analysis_upgrade' and amount = 2000));
alter table public.complete_orders add constraint complete_orders_upgrade_has_basis check (
  (offer = 'analysis_upgrade' and analysis_basis is not null) or (offer in ('analysis', 'direct_complete') and analysis_basis is null));
-- MENTOR 目標：完全解析（direct・upgrade）は必須、解析レポート（analysis）は持たない
alter table public.complete_orders add constraint complete_orders_mentor_goal check (
  (offer = 'analysis' and mentor_goal_catalog_version is null and mentor_goal_id is null and mentor_goal_selected_at is null)
  or (offer in ('direct_complete', 'analysis_upgrade')
      and mentor_goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
      and mentor_goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')
      and mentor_goal_selected_at is not null));
alter table public.complete_orders add constraint complete_orders_buyer_check check (buyer in ('user', 'guest'));
alter table public.complete_orders add constraint complete_orders_claim_method_check check (claim_method is null or claim_method in ('cookie', 'email_otp'));
alter table public.complete_orders add constraint complete_orders_hash_format check (
  (claim_secret_hash is null or claim_secret_hash ~ '^[0-9a-f]{64}$') and (purchase_email_hmac is null or purchase_email_hmac ~ '^[0-9a-f]{64}$'));
-- 本人の注文：秘密値なし・所有者あり。ゲストの注文：秘密値と期限あり。引き継ぎ前は所有者 NULL、引き継ぎ後は所有者＝引き継いだ人
alter table public.complete_orders add constraint complete_orders_buyer_consistency check (
  (buyer = 'user' and user_id is not null and claim_secret_hash is null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null)
  or (buyer = 'guest' and claim_secret_hash is not null and claim_expires_at is not null
      and ((user_id is null and claimed_by is null and claimed_at is null and claim_method is null)
           or (user_id is not null and claimed_by = user_id and claimed_at is not null and claim_method is not null))));
create unique index if not exists complete_orders_claim_secret_uq on public.complete_orders (claim_secret_hash) where claim_secret_hash is not null;
create index if not exists complete_orders_unclaimed_email_idx on public.complete_orders (purchase_email_hmac)
  where buyer = 'guest' and user_id is null and purchase_email_hmac is not null;

-- 同じ記録の注文の重なり：決済待ちは1つ、支払済みは解析・完全解析それぞれ1つ
--  （旧索引は「決済待ち・支払済みを合わせて1つ」で、¥1,000 の支払い後の ¥2,000 を作れないため置き換える）
drop index if exists public.complete_orders_one_live_per_session;
create unique index if not exists complete_orders_one_open_per_session
  on public.complete_orders (diagnosis_session_id) where status in ('created', 'checkout_open');
create unique index if not exists complete_orders_one_paid_analysis_per_session
  on public.complete_orders (diagnosis_session_id) where offer = 'analysis' and status in ('paid', 'disputed');
create unique index if not exists complete_orders_one_paid_complete_per_session
  on public.complete_orders (diagnosis_session_id) where offer in ('direct_complete', 'analysis_upgrade') and status in ('paid', 'disputed');

-- 3. 権利・生成物・MENTOR 目標：ゲスト（所有者 NULL）を許す。権利の重複は記録単位で防ぐ
alter table public.record_entitlements alter column user_id drop not null;
create unique index if not exists record_entitlements_one_active_per_session
  on public.record_entitlements (diagnosis_session_id, right_type) where status in ('active', 'suspended');
alter table public.complete_reports alter column user_id drop not null;
alter table public.record_mentor_goals alter column user_id drop not null;

-- 4. 注文の前提（トリガー）：所有者が記録と一致・本人の注文は登録完了済み・ゲストの注文はゲスト記録だけ・
--    解析レポートは ETI v2 の記録・完全解析は RC1 の版と一致し、MENTOR 目標が注文の値と一致
create or replace function public.complete_orders_require_eligibility()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_owner uuid;
  v_guest timestamptz;
  v_found boolean;
  v_onboarding text;
  v_goal record;
begin
  select s.user_id, s.guest_created_at, true into v_owner, v_guest, v_found
    from public.diagnosis_sessions s where s.id = new.diagnosis_session_id;
  if v_found is null or v_owner is distinct from new.user_id then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  if new.buyer = 'guest' then
    if new.user_id is not null or v_guest is null then
      raise exception 'complete_not_owner' using errcode = '42501';
    end if;
  else
    select p.onboarding_status into v_onboarding from public.profiles p where p.id = new.user_id;
    if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
      raise exception 'complete_onboarding_required' using errcode = '42501';
    end if;
  end if;
  if new.offer = 'analysis' then
    if not exists (select 1 from public.diagnosis_results r
                    where r.session_id = new.diagnosis_session_id and r.diagnosis_version = 'ETI-2.0') then
      raise exception 'complete_version_not_eligible' using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.diagnosis_results r, public.complete_rc1_required_versions() v
     where r.session_id = new.diagnosis_session_id
       and r.diagnosis_version         is not distinct from v.diagnosis_version
       and r.item_set_version          is not distinct from v.item_set_version
       and r.scoring_version           is not distinct from v.scoring_version
       and r.translation_model_version is not distinct from v.translation_model_version
       and r.character_profile_version is not distinct from v.character_profile_version
       and r.mirror_model_version      is not distinct from v.mirror_model_version) then
    raise exception 'complete_version_not_eligible' using errcode = '42501';
  end if;
  select g.goal_id, g.goal_catalog_version, g.selected_at into v_goal
    from public.record_mentor_goals g
   where g.diagnosis_session_id = new.diagnosis_session_id and g.user_id is not distinct from new.user_id;
  if not found then
    raise exception 'complete_mentor_goal_required' using errcode = '42501';
  end if;
  if v_goal.goal_id is distinct from new.mentor_goal_id
     or v_goal.goal_catalog_version is distinct from new.mentor_goal_catalog_version
     or v_goal.selected_at is distinct from new.mentor_goal_selected_at then
    raise exception 'complete_mentor_goal_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 再購入の禁止：解析レポートは解析権（状態を問わない）・支払済みの解析／完全解析の注文がある記録では作らない。
--             完全解析は完全解析権（状態を問わない）・支払済みの完全解析の注文がある記録では作らない。
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = new.diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = new.diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- MENTOR 目標の所有者：記録の所有者と一致（ゲスト記録は NULL どうし）。決済待ち・支払済みの「完全解析の」注文がある間は変えない
create or replace function public.record_mentor_goals_ownership()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.diagnosis_session_id is null or not exists (
    select 1 from public.diagnosis_sessions s
     where s.id = new.diagnosis_session_id and s.user_id is not distinct from new.user_id
       and (s.user_id is not null or s.guest_created_at is not null)) then
    raise exception 'mentor_goal_record_not_found' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.goal_id is not distinct from old.goal_id
       and new.goal_catalog_version is not distinct from old.goal_catalog_version then
      new.selected_at := old.selected_at;
    elsif old.locked_at is null then
      if exists (select 1 from public.complete_orders o
                  where o.diagnosis_session_id = old.diagnosis_session_id
                    and o.offer in ('direct_complete', 'analysis_upgrade')
                    and o.status in ('created', 'checkout_open', 'paid', 'disputed')) then
        raise exception 'mentor_goal_checkout_in_progress' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 支払い後（locked_at あり）の目標は変えない。所有者は引き継ぎ（NULL → 本人）の時だけ変えられる
create or replace function public.record_mentor_goals_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.locked_at is not null and (
       new.goal_id is distinct from old.goal_id
    or new.goal_catalog_version is distinct from old.goal_catalog_version
    or new.selected_at is distinct from old.selected_at
    or new.locked_at is distinct from old.locked_at
    or (new.user_id is distinct from old.user_id
        and not (old.user_id is null and new.user_id is not null and current_setting('app.complete_claim', true) = 'on'))) then
    raise exception 'mentor_goal_locked' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 5. ゲスト購入の記録を作る（サーバーが回答から算出し直した保存値だけを渡す。保存 RPC の v2 と同じ形）
create or replace function public.complete_create_guest_record(
    p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb,
    p_item_set_version text, p_scoring_version text, p_translation_model_version text,
    p_character_profile_version text, p_mirror_model_version text)
  returns uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
begin
  if p_encoded_answers is null or p_encoded_answers !~ '^[0-9a-z]+$' or length(p_encoded_answers) not between 8 and 400 or jsonb_typeof(p_answers_v2) <> 'object'
     or jsonb_typeof(p_v2_scores) <> 'object' or jsonb_typeof(p_v2_rankings) <> 'object' or jsonb_typeof(p_mirror_snapshot) is null then
    raise exception 'complete_invalid_guest_record' using errcode = '22023';
  end if;
  insert into public.diagnosis_sessions (user_id, diagnosis_type, diagnosis_version, item_set_version, scoring_version,
                                         client_session_id, completed_at, guest_created_at)
  values (null, 'element', 'ETI-2.0', p_item_set_version, p_scoring_version, gen_random_uuid(), v_now, v_now)
  returning id into v_id;
  insert into public.diagnosis_answers (session_id, answers, answers_v2, encoded_answers)
  values (v_id, '{}'::jsonb, p_answers_v2, p_encoded_answers);
  insert into public.diagnosis_results (session_id, primary_result, scores, character_matches, diagnosis_code,
                                        diagnosis_version, item_set_version, scoring_version, translation_model_version,
                                        character_profile_version, mirror_model_version, v2_scores, v2_rankings, mirror_snapshot)
  values (v_id, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, p_encoded_answers,
          'ETI-2.0', p_item_set_version, p_scoring_version, p_translation_model_version,
          p_character_profile_version, p_mirror_model_version, p_v2_scores, p_v2_rankings, p_mirror_snapshot);
  return v_id;
end;
$$;

-- 6. 注文の作成（本人・ゲスト共通の内部処理）。金額・根拠・MENTOR 目標は DB が記録から決める（ブラウザの値は使わない）。
--    同じ記録の決済待ちの注文があれば、それを返す（offer が違えば API が Stripe の Session を閉じてから作り直す）。
create or replace function public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                 p_offer text, p_idempotency_key text, p_claim_secret_hash text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_session public.diagnosis_sessions%rowtype;
  v_has_record_analysis boolean;
  v_has_legacy_binding boolean;
  v_has_legacy_purchase boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
  v_guest boolean := p_user_id is null;
begin
  if p_offer not in ('analysis', 'direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_guest and (p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'complete_invalid_claim_secret' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id;
  if not found or v_session.user_id is distinct from p_user_id or (v_guest and v_session.guest_created_at is null) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id
       or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  v_has_legacy_binding := not v_guest and exists (select 1 from public.complete_legacy_bindings b
                                   join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                                  where b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id
                                    and pe.status = 'active');
  v_has_legacy_purchase := exists (
      select 1
        from public.diagnosis_answers a
        join public.purchase_entitlements pe
          on pe.diagnosis_code_hash = encode(sha256(convert_to(
               case when v_session.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end, 'UTF8')), 'hex')
       where a.session_id = p_diagnosis_session_id and pe.status = 'active' and pe.product_type in ('core1', 'complete'));

  -- 再購入の禁止（トリガーでも確かめる）
  if p_offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = p_diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  if p_offer = 'analysis' then
    -- 旧 ¥1,000（診断コードのハッシュが一致）を購入済みなら、解析レポートは購入済み（重ねて売らない）
    if v_has_legacy_purchase or v_has_legacy_binding then
      raise exception 'complete_analysis_already_purchased' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 1000;
  elsif p_offer = 'direct_complete' then
    if v_has_record_analysis or v_has_legacy_binding then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    if v_has_legacy_purchase then
      raise exception 'complete_legacy_purchase_pending' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 3000;
  else
    if v_has_record_analysis then
      v_basis := 'record_entitlement';
    elsif v_has_legacy_binding then
      v_basis := 'legacy_purchase_entitlement';
    else
      raise exception 'complete_upgrade_requires_analysis' using errcode = '42501';
    end if;
    v_amount := 2000;
  end if;

  if p_offer = 'analysis' then
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', null, p_idempotency_key,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  else
    select * into v_goal from public.record_mentor_goals g
     where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id is not distinct from p_user_id;
    if not found then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', v_basis, p_idempotency_key,
            v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  end if;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

-- 本人の注文（従来の関数名・引数のまま。analysis を受け付けるようになった）
create or replace function public.complete_create_order(p_user_id uuid, p_diagnosis_session_id uuid,
                                                        p_offer text, p_idempotency_key text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;
  return query select * from public.complete_create_order_internal(p_user_id, p_diagnosis_session_id, p_offer, p_idempotency_key, null);
end;
$$;

-- ゲストの注文。完全解析は MENTOR 目標を同じトランザクションで記録へ入れてから作る（支払い前なら選び直せる）
create or replace function public.complete_create_guest_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text,
                                                              p_claim_secret_hash text, p_goal_id text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_offer in ('direct_complete', 'analysis_upgrade') then
    if p_goal_id is null or p_goal_id not in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01') then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
    if not exists (select 1 from public.diagnosis_sessions s
                    where s.id = p_diagnosis_session_id and s.user_id is null and s.guest_created_at is not null) then
      raise exception 'complete_record_not_found' using errcode = '42501';
    end if;
    -- 完全解析を購入済みの記録では、目標に触れる前に断る（ロック済みの目標の書き換えを試みない）
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    insert into public.record_mentor_goals (diagnosis_session_id, user_id, goal_catalog_version, goal_id, selected_at)
    values (p_diagnosis_session_id, null, 'CORE1-MENTOR-GOALS-1.0.0', p_goal_id, now())
    on conflict (diagnosis_session_id) do update
      set goal_id = excluded.goal_id, goal_catalog_version = excluded.goal_catalog_version, selected_at = excluded.selected_at;
  elsif p_goal_id is not null then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  return query select * from public.complete_create_order_internal(null, p_diagnosis_session_id, p_offer, p_idempotency_key, p_claim_secret_hash);
end;
$$;

-- 決済待ちの注文を閉じる（offer を変えて買い直す時。API が Stripe の Session を閉じた後に呼ぶ）。支払済みは変えない
create or replace function public.complete_cancel_open_order(p_order_id uuid, p_checkout_session_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.status = 'canceled' then
    return 'noop';
  end if;
  if v_order.status not in ('created', 'checkout_open') then
    raise exception 'complete_order_not_open' using errcode = '42501';
  end if;
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id is distinct from p_checkout_session_id then
    raise exception 'complete_checkout_session_mismatch' using errcode = '42501';
  end if;
  update public.complete_orders set status = 'canceled', failure_code = 'replaced', updated_at = now() where id = p_order_id;
  return 'applied';
end;
$$;

-- 7. 支払い確定（checkout.session.completed、または戻り先での Stripe への問い合わせ）：
--    注文 paid・（完全解析は MENTOR ロックと生成物 queued）・権利付与・イベント processed を1トランザクションで行う。
create or replace function public.complete_apply_payment(
    p_event_id text, p_event_created timestamptz, p_livemode boolean,
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text,
    p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.completed';
  v_order public.complete_orders%rowtype;
  v_res public.diagnosis_results%rowtype;
  v_code text;
  v_kinds text[];
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || v_order.diagnosis_session_id::text, 0));

  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from true or v_order.stripe_mode <> 'live' then 'livemode_mismatch'
    when p_currency is distinct from 'jpy' then 'currency_mismatch'
    when p_amount_total is distinct from v_order.amount then 'amount_mismatch'
    when v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', v_code, v_order.id);
    return 'ignored:' || v_code;
  end if;

  if v_order.status in ('paid', 'disputed', 'refunded') then
    update public.complete_orders set last_stripe_event_id = p_event_id, last_event_created = greatest(last_event_created, p_event_created)
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  -- 期限切れ・片付け済みの注文に支払いが届いた：同じ記録に同じ種類（解析／完全解析）の別の有効な注文があれば運営者確認
  v_kinds := case when v_order.offer = 'analysis' then array['analysis', 'direct_complete']
                  else array['direct_complete', 'analysis_upgrade'] end;
  if v_order.status in ('expired', 'canceled') and (
       exists (select 1 from public.complete_orders o2
                where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
                  and (o2.status in ('created', 'checkout_open')
                       or (o2.offer = any (v_kinds) and o2.status in ('paid', 'disputed', 'refunded'))))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = v_order.diagnosis_session_id
                     and e.right_type = case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)) then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'live_order_conflict', v_order.id);
    return 'ignored:live_order_conflict';
  end if;

  if v_order.offer <> 'analysis' then
    update public.record_mentor_goals
       set goal_id = v_order.mentor_goal_id, goal_catalog_version = v_order.mentor_goal_catalog_version,
           selected_at = v_order.mentor_goal_selected_at, locked_at = coalesce(locked_at, now())
     where diagnosis_session_id = v_order.diagnosis_session_id and user_id is not distinct from v_order.user_id;
    if not found then
      raise exception 'complete_mentor_goal_missing' using errcode = '42501';
    end if;
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  -- 権利：analysis は analysis、direct は analysis（記録に有効な analysis 権が無い場合）と complete、upgrade は complete
  if v_order.offer in ('analysis', 'direct_complete') and not exists (
       select 1 from public.record_entitlements e
        where e.diagnosis_session_id = v_order.diagnosis_session_id
          and e.right_type = 'analysis' and e.status in ('active', 'suspended')) then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'analysis', v_order.id)
    on conflict (source_order_id, right_type) do nothing;
  end if;
  if v_order.offer in ('direct_complete', 'analysis_upgrade') then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'complete', v_order.id)
    on conflict (source_order_id, right_type) do nothing;

    if not exists (select 1 from public.complete_reports r where r.source_order_id = v_order.id) then
      select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
      if not found then
        raise exception 'complete_result_missing' using errcode = '42501';
      end if;
      insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                           content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                           translation_model_version, character_profile_version, mirror_model_version,
                                           mentor_goal_catalog_version, mentor_goal_id, input_sha256)
      values (v_order.user_id, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
              p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
              v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
              v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256);
    end if;
  end if;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 購入時メールの HMAC（ゲストの注文・支払済みだけ。最初の値を変えない）。API が支払い確定の後に呼ぶ（冪等）
create or replace function public.complete_set_purchase_email(p_order_id uuid, p_purchase_email_hmac text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  if p_purchase_email_hmac is null or p_purchase_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_email_hmac' using errcode = '22023';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.buyer <> 'guest' or v_order.status not in ('paid', 'disputed', 'refunded') then
    return 'skipped';
  end if;
  if v_order.purchase_email_hmac is not null then
    return 'noop';
  end if;
  update public.complete_orders set purchase_email_hmac = p_purchase_email_hmac, updated_at = now() where id = p_order_id;
  return 'applied';
end;
$$;

-- 8. 閲覧の権限確認（本人：p_user_id、ゲスト：p_user_id NULL ＝ 所有者 NULL の記録だけ。ゲストの確認は API が Cookie で行う）
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order_status text;
  v_entitled boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select o.status into v_order_status from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id is not distinct from p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order_status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;

-- 9. 解析レポートの閲覧権（診断コードのハッシュ単位。/api/report-data が旧 purchase_entitlements と合わせて確かめる）
--    記録単位の analysis 権（active）がある記録の診断コードのハッシュと一致すれば true
create or replace function public.complete_analysis_active_for_code_hash(p_code_hash text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_code_hash ~ '^[0-9a-f]{64}$' and exists (
    select 1
      from public.record_entitlements e
      join public.diagnosis_answers a on a.session_id = e.diagnosis_session_id
      join public.diagnosis_sessions s on s.id = e.diagnosis_session_id
     where e.right_type = 'analysis' and e.status = 'active' and s.diagnosis_version = 'ETI-2.0'
       and encode(sha256(convert_to('v2_' || a.encoded_answers, 'UTF8')), 'hex') = p_code_hash)
$$;

-- 10. 引き継ぎ：ゲスト記録の所有者を NULL → 本人へ（記録・回答・結果は記録の所有者に従う。注文・権利・目標・生成物を写す）
create or replace function public.complete_transfer_guest_record(p_user_id uuid, p_diagnosis_session_id uuid, p_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_session public.diagnosis_sessions%rowtype;
  v_onboarding text;
begin
  if p_user_id is null or p_method not in ('cookie', 'email_otp') then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id for update;
  if not found or v_session.guest_created_at is null then
    raise exception 'complete_claim_invalid' using errcode = '42501';
  end if;
  if v_session.user_id = p_user_id then
    return 'noop';
  end if;
  if v_session.user_id is not null then
    raise exception 'complete_claim_conflict' using errcode = '42501';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  -- 決済待ちの注文がある間は引き継がない（支払いと引き継ぎの順序を1つに決める）
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open')) then
    raise exception 'complete_claim_checkout_open' using errcode = '42501';
  end if;
  perform set_config('app.complete_claim', 'on', true);
  update public.diagnosis_sessions set user_id = p_user_id where id = p_diagnosis_session_id;
  update public.complete_orders
     set user_id = p_user_id, claimed_by = p_user_id, claimed_at = now(), claim_method = p_method, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_entitlements set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_mentor_goals set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.complete_reports set user_id = p_user_id, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  perform set_config('app.complete_claim', 'off', true);
  return 'applied';
end;
$$;

-- 引き継ぎ（Cookie の秘密値）：支払済みのゲスト注文・秘密値のハッシュが一致・期限内。
--   同じ人の再実行は noop（冪等）。別の人が引き継ぎ済みなら complete_claim_conflict。秘密値の不一致・注文なしは complete_claim_invalid。
create or replace function public.complete_claim_guest_record(p_user_id uuid, p_order_id uuid, p_claim_secret_hash text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  if p_user_id is null or p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id;
  if not found or v_order.buyer <> 'guest' or v_order.claim_secret_hash is distinct from p_claim_secret_hash then
    raise exception 'complete_claim_invalid' using errcode = '42501';
  end if;
  if v_order.user_id is not null then
    if v_order.user_id = p_user_id then
      return 'noop';
    end if;
    raise exception 'complete_claim_conflict' using errcode = '42501';
  end if;
  if v_order.claim_expires_at < now() then
    raise exception 'complete_claim_expired' using errcode = '42501';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'complete_claim_not_paid' using errcode = '42501';
  end if;
  return public.complete_transfer_guest_record(p_user_id, v_order.diagnosis_session_id, 'cookie');
end;
$$;

-- 引き継ぎ（Cookie を失った時）：API が「Supabase のメール OTP で確認した本人のメール」から作った HMAC と、
--   Stripe の購入時メールの HMAC が一致する、支払済み・未引き継ぎのゲスト記録をすべて本人へ。件数を返す。
create or replace function public.complete_claim_guest_by_email(p_user_id uuid, p_purchase_email_hmac text)
  returns table (claimed integer, skipped integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_sid uuid;
  v_claimed integer := 0;
  v_skipped integer := 0;
begin
  if p_user_id is null or p_purchase_email_hmac is null or p_purchase_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  for v_sid in
    select distinct o.diagnosis_session_id from public.complete_orders o
     where o.buyer = 'guest' and o.user_id is null and o.status = 'paid' and o.purchase_email_hmac = p_purchase_email_hmac
  loop
    begin
      if public.complete_transfer_guest_record(p_user_id, v_sid, 'email_otp') = 'applied' then
        v_claimed := v_claimed + 1;
      end if;
    exception when others then
      if sqlerrm in ('complete_claim_conflict', 'complete_claim_checkout_open') then
        v_skipped := v_skipped + 1;
      else
        raise;
      end if;
    end;
  end loop;
  return query select v_claimed, v_skipped;
end;
$$;

-- 11. 関数の権限：EXECUTE は service_role だけ
revoke all on function public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_create_order_internal(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_create_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_create_guest_order(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_cancel_open_order(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_set_purchase_email(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_report_for_view(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_analysis_active_for_code_hash(text) from public, anon, authenticated;
revoke all on function public.complete_transfer_guest_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_claim_guest_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_claim_guest_by_email(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_ownership() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_guard() from public, anon, authenticated;
revoke all on function public.diagnosis_sessions_owner_immutable() from public, anon, authenticated;
grant execute on function public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) to service_role;
grant execute on function public.complete_create_order_internal(uuid, uuid, text, text, text) to service_role;
grant execute on function public.complete_create_order(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_create_guest_order(uuid, text, text, text, text) to service_role;
grant execute on function public.complete_cancel_open_order(uuid, text) to service_role;
grant execute on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;
grant execute on function public.complete_set_purchase_email(uuid, text) to service_role;
grant execute on function public.complete_report_for_view(uuid, uuid) to service_role;
grant execute on function public.complete_analysis_active_for_code_hash(text) to service_role;
grant execute on function public.complete_transfer_guest_record(uuid, uuid, text) to service_role;
grant execute on function public.complete_claim_guest_record(uuid, uuid, text) to service_role;
grant execute on function public.complete_claim_guest_by_email(uuid, text) to service_role;

-- 12. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  f text;
begin
  if exists (select 1 from public.diagnosis_sessions where user_id is null and guest_created_at is null) then
    raise exception 'diagnosis_sessions without owner or guest marker';
  end if;
  foreach f in array array[
      'public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)',
      'public.complete_create_order_internal(uuid, uuid, text, text, text)',
      'public.complete_create_order(uuid, uuid, text, text)',
      'public.complete_create_guest_order(uuid, text, text, text, text)',
      'public.complete_cancel_open_order(uuid, text)',
      'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)',
      'public.complete_set_purchase_email(uuid, text)',
      'public.complete_report_for_view(uuid, uuid)',
      'public.complete_analysis_active_for_code_hash(text)',
      'public.complete_transfer_guest_record(uuid, uuid, text)',
      'public.complete_claim_guest_record(uuid, uuid, text)',
      'public.complete_claim_guest_by_email(uuid, text)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_create_guest_record', 'complete_create_order_internal', 'complete_create_order',
                                'complete_create_guest_order', 'complete_cancel_open_order', 'complete_apply_payment',
                                'complete_set_purchase_email', 'complete_report_for_view', 'complete_analysis_active_for_code_hash',
                                'complete_transfer_guest_record', 'complete_claim_guest_record', 'complete_claim_guest_by_email',
                                'complete_orders_no_repurchase', 'record_mentor_goals_ownership', 'diagnosis_sessions_owner_immutable')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_07 function is not security invoker with empty search_path';
  end if;
  if to_regclass('public.complete_orders_one_live_per_session') is not null then
    raise exception 'old live order index still exists';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261013120000_complete_08_purchase_integrity.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- ============================================================
-- §2（表）旧 ¥1,000 の停止・取消（関数が参照するため、先に作る）
-- ============================================================
create table if not exists public.legacy_access_blocks (
  diagnosis_code_hash  text primary key check (diagnosis_code_hash ~ '^[0-9a-f]{64}$'),
  status               text not null check (status in ('suspended', 'revoked', 'lifted')),
  reason_code          text not null check (reason_code in ('refund', 'chargeback', 'fraud', 'customer_request', 'operator_error')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create table if not exists public.legacy_access_events (
  id                   uuid primary key default gen_random_uuid(),
  diagnosis_code_hash  text not null check (diagnosis_code_hash ~ '^[0-9a-f]{64}$'),
  action               text not null check (action in ('suspend', 'revoke', 'restore')),
  result_status        text not null check (result_status in ('suspended', 'revoked', 'lifted', 'noop')),
  reason_code          text not null check (reason_code in ('refund', 'chargeback', 'fraud', 'customer_request', 'operator_error')),
  incident_id          text not null unique check (incident_id ~ '^[0-9a-f]{12}$'),
  created_at           timestamptz not null default now()
);
revoke all on table public.legacy_access_blocks, public.legacy_access_events from public, anon, authenticated, service_role;
grant select on table public.legacy_access_blocks to service_role;
alter table public.legacy_access_blocks enable row level security;
alter table public.legacy_access_events enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。書き込みは運営者の関数だけ）

create or replace function public.legacy_access_events_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'legacy_access_events_immutable' using errcode = '42501';
end;
$$;
revoke all on function public.legacy_access_events_immutable() from public, anon, authenticated, service_role;
create or replace trigger legacy_access_events_no_update
  before update or delete on public.legacy_access_events
  for each row execute function public.legacy_access_events_immutable();
create or replace trigger legacy_access_events_no_truncate
  before truncate on public.legacy_access_events
  for each statement execute function public.legacy_access_events_immutable();

-- 診断コードのハッシュの旧 ¥1,000 が停止・取消されているか
create or replace function public.complete_legacy_blocked(p_diagnosis_code_hash text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (select 1 from public.legacy_access_blocks k
                  where k.diagnosis_code_hash = p_diagnosis_code_hash and k.status in ('suspended', 'revoked'))
$$;

-- ============================================================
-- §1 同じ診断結果の二重購入の防止（D1）
-- ============================================================

-- 記録の診断結果の鍵（ETI v2 は 'v2_' 付きの診断コード、旧版は診断コードの SHA-256。回答が無ければ NULL）
create or replace function public.complete_result_key(p_diagnosis_session_id uuid)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select encode(sha256(convert_to(case when s.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers
                                        else a.encoded_answers end, 'UTF8')), 'hex')
    from public.diagnosis_sessions s
    join public.diagnosis_answers a on a.session_id = s.id
   where s.id = p_diagnosis_session_id and a.encoded_answers is not null and a.encoded_answers <> ''
   limit 1
$$;

-- 結果グループ：同じ本人の、同じ診断結果の記録（指定した記録を含む）。本人が NULL・鍵が無い時は指定した記録だけ
create or replace function public.complete_result_group(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (diagnosis_session_id uuid)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_diagnosis_session_id
  union
  select s.id
    from public.diagnosis_sessions s
   where p_user_id is not null
     and s.user_id = p_user_id
     and public.complete_result_key(s.id) = public.complete_result_key(p_diagnosis_session_id)
$$;

-- 結果グループの直列化（本人の注文・引き継ぎ）。記録のロックより先に取る
create or replace function public.complete_lock_result_group(p_user_id uuid, p_diagnosis_session_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_key text;
begin
  if p_user_id is null then
    return;
  end if;
  v_key := public.complete_result_key(p_diagnosis_session_id);
  if v_key is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_result:' || p_user_id::text || ':' || v_key, 0));
end;
$$;

-- 結果グループの別の記録で、同じ物（解析レポート／完全解析）を購入済み・決済中か（本人の注文だけ。ゲストは false）
--   p_kind：'analysis'（解析レポート）／'complete'（完全解析）／'analysis_active'（有効・一時停止中の解析権か有効な結び付け）
create or replace function public.complete_result_group_has(p_user_id uuid, p_diagnosis_session_id uuid, p_kind text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
      from public.complete_result_group(p_user_id, p_diagnosis_session_id) g
     where g.diagnosis_session_id <> p_diagnosis_session_id
       and (
         (p_kind = 'open' and exists (
            select 1 from public.complete_orders o
             where o.diagnosis_session_id = g.diagnosis_session_id and o.status in ('created', 'checkout_open')))
         or (p_kind = 'analysis' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis')
            or exists (select 1 from public.complete_legacy_bindings b
                         join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                        where b.diagnosis_session_id = g.diagnosis_session_id and b.user_id = p_user_id and pe.status = 'active'
                          and not public.complete_legacy_blocked(pe.diagnosis_code_hash))))
         or (p_kind = 'complete' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'complete')))
         or (p_kind = 'analysis_active' and (
            exists (select 1 from public.record_entitlements e
                     where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis'
                       and e.status in ('active', 'suspended'))
            or exists (select 1 from public.complete_legacy_bindings b
                         join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                        where b.diagnosis_session_id = g.diagnosis_session_id and b.user_id = p_user_id and pe.status = 'active'
                          and not public.complete_legacy_blocked(pe.diagnosis_code_hash))))
       ))
$$;

-- 注文の作成（complete_07 の本文に、結果グループの直列化・確認と、解析権の一時停止中の ¥3,000 の拒否を加えたもの）
create or replace function public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                 p_offer text, p_idempotency_key text, p_claim_secret_hash text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_session public.diagnosis_sessions%rowtype;
  v_has_record_analysis boolean;
  v_has_legacy_binding boolean;
  v_has_legacy_purchase boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
  v_guest boolean := p_user_id is null;
begin
  if p_offer not in ('analysis', 'direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_guest and (p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'complete_invalid_claim_secret' using errcode = '22023';
  end if;
  -- ロックの順：結果グループ → 記録
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id;
  if not found or v_session.user_id is distinct from p_user_id or (v_guest and v_session.guest_created_at is null) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id
       or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  -- 旧 ¥1,000：運営者が停止・取消したもの（§2 legacy_access_blocks）は権利に数えない
  v_has_legacy_binding := not v_guest and exists (select 1 from public.complete_legacy_bindings b
                                   join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                                  where b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id
                                    and pe.status = 'active' and not public.complete_legacy_blocked(pe.diagnosis_code_hash));
  v_has_legacy_purchase := exists (
      select 1
        from public.diagnosis_answers a
        join public.purchase_entitlements pe
          on pe.diagnosis_code_hash = encode(sha256(convert_to(
               case when v_session.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end, 'UTF8')), 'hex')
       where a.session_id = p_diagnosis_session_id and pe.status = 'active' and pe.product_type in ('core1', 'complete')
         and not public.complete_legacy_blocked(pe.diagnosis_code_hash));

  -- 再購入の禁止（トリガーでも確かめる）
  if p_offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = p_diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  -- 同じ本人・同じ診断結果の別の記録（D1）：決済中なら作らない。購入済みの物は重ねて売らない
  if not v_guest then
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, case when p_offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    if p_offer = 'direct_complete' and public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'analysis_active') then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
  end if;
  -- 解析権が一時停止中（dispute 中）の記録では ¥3,000 を作らない（解析権を重ねて作らない）
  if p_offer = 'direct_complete' and exists (select 1 from public.record_entitlements e
                                              where e.diagnosis_session_id = p_diagnosis_session_id
                                                and e.right_type = 'analysis' and e.status = 'suspended') then
    raise exception 'complete_rights_suspended' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  if p_offer = 'analysis' then
    -- 旧 ¥1,000（診断コードのハッシュが一致）を購入済みなら、解析レポートは購入済み（重ねて売らない）
    if v_has_legacy_purchase or v_has_legacy_binding then
      raise exception 'complete_analysis_already_purchased' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 1000;
  elsif p_offer = 'direct_complete' then
    if v_has_record_analysis or v_has_legacy_binding then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    if v_has_legacy_purchase then
      raise exception 'complete_legacy_purchase_pending' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 3000;
  else
    if v_has_record_analysis then
      v_basis := 'record_entitlement';
    elsif v_has_legacy_binding then
      v_basis := 'legacy_purchase_entitlement';
    else
      raise exception 'complete_upgrade_requires_analysis' using errcode = '42501';
    end if;
    v_amount := 2000;
  end if;

  if p_offer = 'analysis' then
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', null, p_idempotency_key,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  else
    select * into v_goal from public.record_mentor_goals g
     where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id is not distinct from p_user_id;
    if not found then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', v_basis, p_idempotency_key,
            v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  end if;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

-- 再購入の禁止（トリガー）：complete_07 の記録単位の確認に、結果グループの確認を加えたもの
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = new.diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = new.diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  if new.user_id is not null then
    perform public.complete_lock_result_group(new.user_id, new.diagnosis_session_id);
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id,
                                        case when new.offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- 支払い確定（complete_07 の本文に、期限切れ後の支払いの確認を結果グループへ広げ、ロックの順を
--   結果グループ → 記録 → 注文の行 に揃えたもの。complete_create_order_internal・complete_transfer_guest_record と同じ順）
create or replace function public.complete_apply_payment(
    p_event_id text, p_event_created timestamptz, p_livemode boolean,
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text,
    p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.completed';
  v_order public.complete_orders%rowtype;
  v_res public.diagnosis_results%rowtype;
  v_code text;
  v_kinds text[];
  v_sid uuid;
  v_uid uuid;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  -- ロックの順（全関数で共通）：結果グループ → 記録（complete_order:<記録>）→ 行（注文 → 記録 → 権利・生成物）。
  -- 注文の行を先に取ると、記録のロックを持って注文の行を待つ引き継ぎ・注文の作成と循環する（デッドロック）
  select o.diagnosis_session_id, o.user_id into v_sid, v_uid from public.complete_orders o where o.id = p_order_id;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  perform public.complete_lock_result_group(v_uid, v_sid);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || v_sid::text, 0));
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  -- ロックを待つ間に引き継がれた（注文の本人が変わった）：取り直しのため一時的な失敗にする（Webhook の再送・次の確認で反映）
  if v_order.user_id is distinct from v_uid then
    raise exception 'complete_retry_later' using errcode = '40001';
  end if;

  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from true or v_order.stripe_mode <> 'live' then 'livemode_mismatch'
    when p_currency is distinct from 'jpy' then 'currency_mismatch'
    when p_amount_total is distinct from v_order.amount then 'amount_mismatch'
    when v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', v_code, v_order.id);
    return 'ignored:' || v_code;
  end if;

  if v_order.status in ('paid', 'disputed', 'refunded') then
    update public.complete_orders set last_stripe_event_id = p_event_id, last_event_created = greatest(last_event_created, p_event_created)
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  -- 期限切れ・片付け済みの注文に支払いが届いた：同じ記録（本人の注文は同じ診断結果の記録も）に、
  -- 同じ種類（解析／完全解析）の別の有効な注文・権利があれば運営者確認
  v_kinds := case when v_order.offer = 'analysis' then array['analysis', 'direct_complete']
                  else array['direct_complete', 'analysis_upgrade'] end;
  if v_order.status in ('expired', 'canceled') and (
       exists (select 1 from public.complete_orders o2
                where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
                  and (o2.status in ('created', 'checkout_open')
                       or (o2.offer = any (v_kinds) and o2.status in ('paid', 'disputed', 'refunded'))))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = v_order.diagnosis_session_id
                     and e.right_type = case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)
       or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id, 'open')
       or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id,
                                           case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)) then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'live_order_conflict', v_order.id);
    return 'ignored:live_order_conflict';
  end if;

  if v_order.offer <> 'analysis' then
    update public.record_mentor_goals
       set goal_id = v_order.mentor_goal_id, goal_catalog_version = v_order.mentor_goal_catalog_version,
           selected_at = v_order.mentor_goal_selected_at, locked_at = coalesce(locked_at, now())
     where diagnosis_session_id = v_order.diagnosis_session_id and user_id is not distinct from v_order.user_id;
    if not found then
      raise exception 'complete_mentor_goal_missing' using errcode = '42501';
    end if;
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  -- 権利：analysis は analysis、direct は analysis（記録に有効な analysis 権が無い場合）と complete、upgrade は complete
  if v_order.offer in ('analysis', 'direct_complete') and not exists (
       select 1 from public.record_entitlements e
        where e.diagnosis_session_id = v_order.diagnosis_session_id
          and e.right_type = 'analysis' and e.status in ('active', 'suspended')) then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'analysis', v_order.id)
    on conflict (source_order_id, right_type) do nothing;
  end if;
  if v_order.offer in ('direct_complete', 'analysis_upgrade') then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'complete', v_order.id)
    on conflict (source_order_id, right_type) do nothing;

    if not exists (select 1 from public.complete_reports r where r.source_order_id = v_order.id) then
      select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
      if not found then
        raise exception 'complete_result_missing' using errcode = '42501';
      end if;
      insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                           content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                           translation_model_version, character_profile_version, mirror_model_version,
                                           mentor_goal_catalog_version, mentor_goal_id, input_sha256)
      values (v_order.user_id, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
              p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
              v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
              v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256);
    end if;
  end if;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 引き継ぎ（complete_07 の本文に、結果グループのロックを記録のロックより先に取る処理を加えたもの）
create or replace function public.complete_transfer_guest_record(p_user_id uuid, p_diagnosis_session_id uuid, p_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_session public.diagnosis_sessions%rowtype;
  v_onboarding text;
begin
  if p_user_id is null or p_method not in ('cookie', 'email_otp') then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id for update;
  if not found or v_session.guest_created_at is null then
    raise exception 'complete_claim_invalid' using errcode = '42501';
  end if;
  if v_session.user_id = p_user_id then
    return 'noop';
  end if;
  if v_session.user_id is not null then
    raise exception 'complete_claim_conflict' using errcode = '42501';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  -- 決済待ちの注文がある間は引き継がない（API が Stripe の状態を確かめて片付けてから呼ぶ）
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open')) then
    raise exception 'complete_claim_checkout_open' using errcode = '42501';
  end if;
  perform set_config('app.complete_claim', 'on', true);
  update public.diagnosis_sessions set user_id = p_user_id where id = p_diagnosis_session_id;
  update public.complete_orders
     set user_id = p_user_id, claimed_by = p_user_id, claimed_at = now(), claim_method = p_method, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_entitlements set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_mentor_goals set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.complete_reports set user_id = p_user_id, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  perform set_config('app.complete_claim', 'off', true);
  return 'applied';
end;
$$;

revoke all on function public.complete_result_key(uuid) from public, anon, authenticated;
revoke all on function public.complete_result_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_lock_result_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_result_group_has(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_result_key(uuid) to service_role;
grant execute on function public.complete_result_group(uuid, uuid) to service_role;
grant execute on function public.complete_lock_result_group(uuid, uuid) to service_role;
grant execute on function public.complete_result_group_has(uuid, uuid, text) to service_role;

-- ============================================================
-- §2 閲覧権の確認（D5・D6）
-- ============================================================

-- 完全解析の閲覧の権限確認（complete_07 の本文に、¥2,000 の根拠の確認を加えたもの）
--   state：ok／not_found／not_entitled／not_ready／basis_inactive（¥2,000 の根拠の解析レポートの購入が取消・停止中）
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order public.complete_orders%rowtype;
  v_entitled boolean;
  v_basis_ok boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select * into v_order from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id is not distinct from p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order.status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_order.offer = 'analysis_upgrade' then
    if v_order.analysis_basis = 'legacy_purchase_entitlement' then
      v_basis_ok := exists (select 1 from public.complete_legacy_bindings b
                              join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                             where b.diagnosis_session_id = p_diagnosis_session_id and b.user_id is not distinct from p_user_id
                               and pe.status = 'active' and not public.complete_legacy_blocked(pe.diagnosis_code_hash));
    else
      v_basis_ok := exists (select 1 from public.record_entitlements e
                             where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis' and e.status = 'active');
    end if;
    if not v_basis_ok then
      return query select 'basis_inactive'::text, null::uuid, null::text, null::text;
      return;
    end if;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;

-- 運営者の操作：旧 ¥1,000 の閲覧の停止（suspend）・取消（revoke・最終）・復帰（restore：停止だけを戻す）。
--   対象は診断コードのハッシュ、または旧購入の Checkout Session ID（どちらか）。同じ照合 ID の再送は前回の結果を返す。
--   SQL Editor で運営者が実行する（API のロールは実行できない）。戻り値：suspended／revoked／lifted／noop
create or replace function public.complete_admin_legacy_access(p_diagnosis_code_hash text, p_stripe_checkout_session_id text,
                                                               p_action text, p_reason_code text, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_hash text := p_diagnosis_code_hash;
  v_prev public.legacy_access_events%rowtype;
  v_cur public.legacy_access_blocks%rowtype;
  v_result text;
begin
  if p_action is null or p_action not in ('suspend', 'revoke', 'restore')
     or p_reason_code is null or p_reason_code not in ('refund', 'chargeback', 'fraud', 'customer_request', 'operator_error')
     or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  if v_hash is null and p_stripe_checkout_session_id is not null then
    select pe.diagnosis_code_hash into v_hash from public.purchase_entitlements pe
     where pe.stripe_checkout_session_id = p_stripe_checkout_session_id;
  end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('legacy_access:' || v_hash, 0));
  select * into v_prev from public.legacy_access_events e where e.incident_id = p_incident_id;
  if found then
    if v_prev.diagnosis_code_hash <> v_hash or v_prev.action <> p_action then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.result_status;
  end if;
  select * into v_cur from public.legacy_access_blocks k where k.diagnosis_code_hash = v_hash;
  if found and v_cur.status = 'revoked' and p_action <> 'revoke' then
    raise exception 'legacy_access_revoked_is_final' using errcode = '42501';
  end if;
  if p_action = 'restore' then
    if not found or v_cur.status = 'lifted' then
      v_result := 'noop';
    else
      update public.legacy_access_blocks set status = 'lifted', reason_code = p_reason_code, updated_at = now() where diagnosis_code_hash = v_hash;
      v_result := 'lifted';
    end if;
  else
    v_result := case when p_action = 'suspend' then 'suspended' else 'revoked' end;
    insert into public.legacy_access_blocks (diagnosis_code_hash, status, reason_code)
    values (v_hash, v_result, p_reason_code)
    on conflict (diagnosis_code_hash) do update set status = excluded.status, reason_code = excluded.reason_code, updated_at = now();
  end if;
  insert into public.legacy_access_events (diagnosis_code_hash, action, result_status, reason_code, incident_id)
  values (v_hash, p_action, v_result, p_reason_code, p_incident_id);
  return v_result;
end;
$$;

revoke all on function public.complete_legacy_blocked(text) from public, anon, authenticated;
grant execute on function public.complete_legacy_blocked(text) to service_role;
revoke all on function public.complete_admin_legacy_access(text, text, text, text, text) from public, anon, authenticated, service_role;

-- ============================================================
-- §3 完全解析の生成の失敗からの回復（C6）
-- ============================================================
alter table public.complete_reports add column if not exists manual_retries integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'complete_reports_manual_retries_range'
                   and conrelid = 'public.complete_reports'::regclass) then
    alter table public.complete_reports add constraint complete_reports_manual_retries_range check (manual_retries between 0 and 20);
  end if;
end
$$;

create table if not exists public.complete_report_admin_events (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.complete_reports(id),
  action       text not null check (action in ('regenerate')),
  result       text not null check (result in ('requeued', 'noop')),
  incident_id  text not null unique check (incident_id ~ '^[0-9a-f]{12}$'),
  created_at   timestamptz not null default now()
);
revoke all on table public.complete_report_admin_events from public, anon, authenticated, service_role;
alter table public.complete_report_admin_events enable row level security;
create or replace trigger complete_report_admin_events_no_update
  before update or delete on public.complete_report_admin_events
  for each row execute function public.legacy_access_events_immutable();
create or replace trigger complete_report_admin_events_no_truncate
  before truncate on public.complete_report_admin_events
  for each statement execute function public.legacy_access_events_immutable();

-- 最終の失敗か（自動の再試行が残っていない）。lib/complete-report-job.js の finalFailure と同じ規則
create or replace function public.complete_report_final_failure(p_status text, p_attempts integer, p_max_attempts integer,
                                                                p_next_retry_at timestamptz, p_lease_expires_at timestamptz)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select (p_status = 'failed' and (p_next_retry_at is null or p_attempts >= p_max_attempts))
      or (p_status = 'generating' and p_attempts >= p_max_attempts and p_lease_expires_at < now())
$$;

-- 本人（p_user_id）またはゲスト記録（p_user_id = null。API がゲストの秘密値を確かめてから呼ぶ）の作り直しの依頼。
--   戻り値：requeued／in_progress（生成中・自動の再試行待ち）／ready／limit_reached／operator_required／not_entitled／not_found
create or replace function public.complete_regenerate_report(p_user_id uuid, p_diagnosis_session_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_report public.complete_reports%rowtype;
begin
  select r.id into v_id from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if v_id is null then
    return 'not_found';
  end if;
  select * into v_report from public.complete_reports r where r.id = v_id for update;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not exists (select 1 from public.complete_orders o where o.id = v_report.source_order_id and o.status = 'paid')
     or not exists (select 1 from public.record_entitlements e
                     where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                       and e.right_type = 'complete' and e.status = 'active') then
    return 'not_entitled';
  end if;
  if v_report.status = 'ready' then
    return 'ready';
  end if;
  if not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                              v_report.next_retry_at, v_report.lease_expires_at) then
    return 'in_progress';
  end if;
  -- 作り直しても同じ結果になる失敗（入力・素材・固定値の不一致）は運営者が原因を確かめる
  if v_report.last_error_code in ('materials_changed', 'input_mismatch', 'frozen_versions_mismatch', 'frozen_goal_mismatch',
                                  'record_data_missing', 'report_not_found') then
    return 'operator_required';
  end if;
  if v_report.manual_retries >= 2 then
    return 'limit_reached';
  end if;
  update public.complete_reports
     set status = 'queued', attempts = 0, next_retry_at = null, lease_token = null, lease_expires_at = null,
         manual_retries = manual_retries + 1, updated_at = now()
   where id = v_id;
  return 'requeued';
end;
$$;

-- 運営者の操作：原因を直した後に、最終の失敗の生成物を queued に戻す（回数の上限・失敗の種類に関係なく）。
--   同じ照合 ID の再送は前回の結果。SQL Editor で実行する（API のロールは実行できない）。戻り値：requeued／noop
create or replace function public.complete_admin_regenerate_report(p_report_id uuid, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_report_admin_events%rowtype;
  v_report public.complete_reports%rowtype;
  v_result text;
begin
  if p_report_id is null or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'complete_report_not_found' using errcode = '42501';
  end if;
  select * into v_prev from public.complete_report_admin_events e where e.incident_id = p_incident_id;
  if found then
    if v_prev.report_id <> p_report_id then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.result;
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                                 v_report.next_retry_at, v_report.lease_expires_at) then
    v_result := 'noop';
  else
    update public.complete_reports
       set status = 'queued', attempts = 0, next_retry_at = null, lease_token = null, lease_expires_at = null, updated_at = now()
     where id = p_report_id;
    v_result := 'requeued';
  end if;
  insert into public.complete_report_admin_events (report_id, action, result, incident_id)
  values (p_report_id, 'regenerate', v_result, p_incident_id);
  return v_result;
end;
$$;

revoke all on function public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz) to service_role;
revoke all on function public.complete_regenerate_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_report(uuid, uuid) to service_role;
revoke all on function public.complete_admin_regenerate_report(uuid, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
declare
  f text;
begin
  foreach f in array array[
      'public.complete_result_key(uuid)',
      'public.complete_result_group(uuid, uuid)',
      'public.complete_lock_result_group(uuid, uuid)',
      'public.complete_result_group_has(uuid, uuid, text)',
      'public.complete_create_order_internal(uuid, uuid, text, text, text)',
      'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)',
      'public.complete_transfer_guest_record(uuid, uuid, text)',
      'public.complete_legacy_blocked(text)',
      'public.complete_report_for_view(uuid, uuid)',
      'public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz)',
      'public.complete_regenerate_report(uuid, uuid)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_result_key', 'complete_result_group', 'complete_lock_result_group', 'complete_result_group_has',
                                'complete_create_order_internal', 'complete_orders_no_repurchase', 'complete_apply_payment',
                                'complete_transfer_guest_record')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_08 function is not security invoker with empty search_path';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'complete_orders_no_repurchase' and not tgisinternal) then
    raise exception 'complete_orders_no_repurchase trigger is missing';
  end if;
  -- §2：停止・取消の表は API から読むだけ。運営者の関数は API のロールから実行できない
  if not has_table_privilege('service_role', 'public.legacy_access_blocks', 'SELECT')
     or has_table_privilege('service_role', 'public.legacy_access_blocks', 'INSERT')
     or has_table_privilege('service_role', 'public.legacy_access_blocks', 'UPDATE')
     or has_table_privilege('service_role', 'public.legacy_access_events', 'SELECT')
     or has_table_privilege('anon', 'public.legacy_access_blocks', 'SELECT')
     or has_table_privilege('authenticated', 'public.legacy_access_blocks', 'SELECT') then
    raise exception 'unexpected privileges on legacy_access tables';
  end if;
  -- §3
  if has_function_privilege('service_role', 'public.complete_admin_regenerate_report(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_regenerate_report(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_regenerate_report(uuid, uuid)', 'EXECUTE')
     or has_table_privilege('service_role', 'public.complete_report_admin_events', 'SELECT')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'complete_reports'
                     and column_name = 'manual_retries') then
    raise exception 'complete_08 §3 objects or privileges are unexpected';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_report_final_failure', 'complete_regenerate_report', 'complete_admin_regenerate_report')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_08 §3 function is not security invoker with empty search_path';
  end if;
  if has_function_privilege('service_role', 'public.complete_admin_legacy_access(text, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_admin_legacy_access(text, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_admin_legacy_access(text, text, text, text, text)', 'EXECUTE') then
    raise exception 'complete_admin_legacy_access must be operator only';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_legacy_blocked', 'complete_admin_legacy_access', 'complete_report_for_view',
                                'legacy_access_events_immutable')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_08 §2 function is not security invoker with empty search_path';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261013180000_complete_09_result_resume_links.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 固有リンク（秘密値のハッシュ → ゲストの診断記録）
create table if not exists public.result_resume_links (
  token_hash            text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  diagnosis_session_id  uuid not null unique references public.diagnosis_sessions(id) on delete cascade,
  created_at            timestamptz not null default now(),
  last_opened_at        timestamptz,
  expires_at            timestamptz not null
);
create index if not exists result_resume_links_expires_idx on public.result_resume_links (expires_at);
revoke all on table public.result_resume_links from public, anon, authenticated, service_role;
grant select, insert, update on table public.result_resume_links to service_role;
alter table public.result_resume_links enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。anon・authenticated は権限なし）

-- 1b. 作成の回数（接続元の鍵付きハッシュ × 1 分の区切り）。24 時間を過ぎた行は作成の時に消す
create table if not exists public.result_link_rate (
  rate_key  text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  bucket    timestamptz not null,
  n         integer not null check (n > 0),
  primary key (rate_key, bucket)
);
create index if not exists result_link_rate_bucket_idx on public.result_link_rate (bucket);
revoke all on table public.result_link_rate from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.result_link_rate to service_role;
alter table public.result_link_rate enable row level security;

-- 2. 作成：診断完了の時。無料結果の保存値でゲストの診断記録を作り、秘密値のハッシュを結び付ける
--    同じ秘密値の再送は、同じ診断結果なら 'existing' を返すだけ（記録・リンク・回数を増やさない）。違う診断結果なら拒否する。
--    新しく作る時だけ回数を数え、上限を超えたら complete_result_link_rate_limited（記録もリンクも作らない）。
drop function if exists public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text);
create or replace function public.complete_create_result_link(
    p_token_hash text, p_rate_key text,
    p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb,
    p_item_set_version text, p_scoring_version text, p_translation_model_version text,
    p_character_profile_version text, p_mirror_model_version text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_sid uuid;
  v_expires timestamptz;
  v_short integer;
  v_day integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$'
     or p_encoded_answers is null or p_encoded_answers !~ '^[0-9a-z]+$' or length(p_encoded_answers) not between 8 and 400 then
    raise exception 'complete_invalid_result_link' using errcode = '22023';
  end if;
  -- 同じ秘密値の同時の作成を1つずつ処理する（二重に記録を作らない）
  perform pg_advisory_xact_lock(hashtextextended('complete_result_link:' || p_token_hash, 0));
  select l.diagnosis_session_id, l.expires_at into v_sid, v_expires
    from public.result_resume_links l where l.token_hash = p_token_hash;
  if v_sid is not null then
    if v_expires > now() and exists (select 1 from public.diagnosis_answers a
                                       where a.session_id = v_sid and a.encoded_answers = p_encoded_answers) then
      return 'existing';
    end if;
    raise exception 'complete_result_link_conflict' using errcode = '23505';
  end if;

  -- 回数（同じ接続元の同時の作成を1つずつ数える）
  perform pg_advisory_xact_lock(hashtextextended('complete_result_link_rate:' || p_rate_key, 0));
  delete from public.result_link_rate r where r.bucket < now() - interval '24 hours';
  select coalesce(sum(r.n) filter (where r.bucket >= now() - interval '10 minutes'), 0), coalesce(sum(r.n), 0)
    into v_short, v_day
    from public.result_link_rate r where r.rate_key = p_rate_key;
  if v_short >= 10 or v_day >= 100 then
    raise exception 'complete_result_link_rate_limited' using errcode = '54000';
  end if;
  insert into public.result_link_rate as r (rate_key, bucket, n)
  values (p_rate_key, date_trunc('minute', now()), 1)
  on conflict (rate_key, bucket) do update set n = r.n + 1;

  v_id := public.complete_create_guest_record(p_answers_v2, p_encoded_answers, p_v2_scores, p_v2_rankings, p_mirror_snapshot,
                                              p_item_set_version, p_scoring_version, p_translation_model_version,
                                              p_character_profile_version, p_mirror_model_version);
  insert into public.result_resume_links (token_hash, diagnosis_session_id, expires_at)
  values (p_token_hash, v_id, now() + interval '180 days');
  return 'created';
end;
$$;

-- 3. 照会：期限内のリンクだけ。開くたびに期限を延ばす。返すのは無料結果の表示に必要な保存値だけ（権利・注文は返さない）
create or replace function public.complete_open_result_link(p_token_hash text)
  returns table (diagnosis_session_id uuid, guest boolean, encoded_answers text, diagnosis_version text,
                 item_set_version text, scoring_version text, translation_model_version text,
                 character_profile_version text, mirror_model_version text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_sid uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  update public.result_resume_links l
     set last_opened_at = now(), expires_at = greatest(l.expires_at, now() + interval '180 days')
   where l.token_hash = p_token_hash and l.expires_at > now()
  returning l.diagnosis_session_id into v_sid;
  if v_sid is null then
    return;
  end if;
  return query
    select s.id, s.user_id is null, a.encoded_answers, r.diagnosis_version,
           r.item_set_version, r.scoring_version, r.translation_model_version,
           r.character_profile_version, r.mirror_model_version
      from public.diagnosis_sessions s
      join public.diagnosis_answers a on a.session_id = s.id
      join public.diagnosis_results r on r.session_id = s.id
     where s.id = v_sid;
end;
$$;

-- 4. 運営者の整理（SQL Editor）：期限切れのリンクを消し、購入の無い・リンクの無い古いゲストの診断記録を消す。
--    購入（注文・権利・生成物・旧購入の結び付け）のある記録は消さない。戻り値：消したリンク・記録の数
create or replace function public.complete_purge_result_links()
  returns table (links_deleted integer, records_deleted integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_links integer;
  v_records integer;
begin
  delete from public.result_resume_links l where l.expires_at <= now();
  get diagnostics v_links = row_count;
  delete from public.result_link_rate r where r.bucket < now() - interval '24 hours';
  with doomed as (
    select s.id from public.diagnosis_sessions s
     where s.user_id is null and s.guest_created_at is not null and s.guest_created_at < now() - interval '180 days'
       and not exists (select 1 from public.result_resume_links l where l.diagnosis_session_id = s.id)
       and not exists (select 1 from public.complete_orders o where o.diagnosis_session_id = s.id)
       and not exists (select 1 from public.record_entitlements e where e.diagnosis_session_id = s.id)
       and not exists (select 1 from public.complete_reports r where r.diagnosis_session_id = s.id)
       and not exists (select 1 from public.complete_legacy_bindings b where b.diagnosis_session_id = s.id)
  ), goals as (
    delete from public.record_mentor_goals g using doomed d where g.diagnosis_session_id = d.id
  )
  delete from public.diagnosis_sessions s using doomed d where s.id = d.id;
  get diagnostics v_records = row_count;
  return query select v_links, v_records;
end;
$$;

revoke all on function public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) to service_role;
revoke all on function public.complete_open_result_link(text) from public, anon, authenticated;
grant execute on function public.complete_open_result_link(text) to service_role;
revoke all on function public.complete_purge_result_links() from public, anon, authenticated, service_role;

-- 5. （本番では省略）同意版の途中版への置き換えはしない。prod_01 の最終版（2026-10-21 の組だけ）を保つ。

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.result_resume_links'::regclass) then
    raise exception 'result_resume_links must have row level security';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'result_resume_links') then
    raise exception 'result_resume_links must not have policies';
  end if;
  if has_table_privilege('anon', 'public.result_resume_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.result_resume_links', 'SELECT')
     or has_table_privilege('service_role', 'public.result_resume_links', 'DELETE')
     or not has_table_privilege('service_role', 'public.result_resume_links', 'INSERT') then
    raise exception 'unexpected privileges on result_resume_links';
  end if;
  if has_function_privilege('service_role', 'public.complete_purge_result_links()', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_open_result_link(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_open_result_link(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_open_result_link(text)', 'EXECUTE') then
    raise exception 'unexpected privileges on complete_09 functions';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.result_link_rate'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'result_link_rate')
     or has_table_privilege('anon', 'public.result_link_rate', 'SELECT')
     or has_table_privilege('authenticated', 'public.result_link_rate', 'SELECT') then
    raise exception 'unexpected security on result_link_rate';
  end if;
  if to_regprocedure('public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)') is not null then
    raise exception 'old complete_create_result_link remains';
  end if;
  if has_function_privilege('anon', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE')
     or position('2026-10-21' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) = 0
     or pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure) ~ '2026-10-13' then
    raise exception 'unexpected complete_registration_onboarding';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_create_result_link', 'complete_open_result_link', 'complete_purge_result_links')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_09 function is not security invoker with empty search_path';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261014120000_complete_10_entitlement_owner_isolation.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 結果グループ：同じ本人の新 Checkout の購入・権利だけ（旧購入の結び付けを数えない）
create or replace function public.complete_result_group_has(p_user_id uuid, p_diagnosis_session_id uuid, p_kind text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
      from public.complete_result_group(p_user_id, p_diagnosis_session_id) g
     where g.diagnosis_session_id <> p_diagnosis_session_id
       and (
         (p_kind = 'open' and exists (
            select 1 from public.complete_orders o
             where o.diagnosis_session_id = g.diagnosis_session_id and o.status in ('created', 'checkout_open')))
         or (p_kind = 'analysis' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis')))
         or (p_kind = 'complete' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'complete')))
         or (p_kind = 'analysis_active' and (
            exists (select 1 from public.record_entitlements e
                     where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis'
                       and e.status in ('active', 'suspended'))))
       ))
$$;

-- 2. 注文の作成：旧 Payment Link を判断に使わない。追加 ¥2,000 はこの記録の有効な解析権だけ
create or replace function public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                 p_offer text, p_idempotency_key text, p_claim_secret_hash text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_session public.diagnosis_sessions%rowtype;
  v_has_record_analysis boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
  v_guest boolean := p_user_id is null;
begin
  if p_offer not in ('analysis', 'direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_guest and (p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'complete_invalid_claim_secret' using errcode = '22023';
  end if;
  -- ロックの順：結果グループ → 記録
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id;
  if not found or v_session.user_id is distinct from p_user_id or (v_guest and v_session.guest_created_at is null) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id
       or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  -- 再購入の禁止（トリガーでも確かめる）
  if p_offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = p_diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  -- 同じ本人・同じ診断結果の別の記録（D1）：決済中なら作らない。購入済みの物は重ねて売らない
  if not v_guest then
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, case when p_offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    if p_offer = 'direct_complete' and public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'analysis_active') then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
  end if;
  -- 解析権が一時停止中（dispute 中）の記録では ¥3,000 を作らない（解析権を重ねて作らない）
  if p_offer = 'direct_complete' and exists (select 1 from public.record_entitlements e
                                              where e.diagnosis_session_id = p_diagnosis_session_id
                                                and e.right_type = 'analysis' and e.status = 'suspended') then
    raise exception 'complete_rights_suspended' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  -- 旧 Payment Link（purchase_entitlements・complete_legacy_bindings）は、新 Checkout の判断に使わない（complete_10）
  if p_offer = 'analysis' then
    v_basis := null;
    v_amount := 1000;
  elsif p_offer = 'direct_complete' then
    if v_has_record_analysis then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 3000;
  else
    -- 追加 ¥2,000 の根拠は、この記録の有効な新 Checkout の解析権だけ（ゲスト・ログイン中とも同じ）
    if not v_has_record_analysis then
      raise exception 'complete_upgrade_requires_analysis' using errcode = '42501';
    end if;
    v_basis := 'record_entitlement';
    v_amount := 2000;
  end if;

  if p_offer = 'analysis' then
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', null, p_idempotency_key,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  else
    select * into v_goal from public.record_mentor_goals g
     where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id is not distinct from p_user_id;
    if not found then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', v_basis, p_idempotency_key,
            v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  end if;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

-- 3. 権限（置き換えでも保たれるが、明示する）。診断コードのハッシュだけで判定する関数は API のロールから外す
revoke all on function public.complete_result_group_has(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_result_group_has(uuid, uuid, text) to service_role;
revoke all on function public.complete_create_order_internal(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_order_internal(uuid, uuid, text, text, text) to service_role;
revoke all on function public.complete_analysis_active_for_code_hash(text) from public, anon, authenticated, service_role;

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
declare
  v_body text;
begin
  v_body := pg_get_functiondef('public.complete_create_order_internal(uuid, uuid, text, text, text)'::regprocedure);
  if position('public.purchase_entitlements pe' in v_body) > 0 or position('v_has_legacy' in v_body) > 0
     or position('public.complete_legacy_bindings b' in v_body) > 0 then
    raise exception 'complete_create_order_internal still uses legacy purchases';
  end if;
  v_body := pg_get_functiondef('public.complete_result_group_has(uuid, uuid, text)'::regprocedure);
  if position('public.purchase_entitlements pe' in v_body) > 0 or position('public.complete_legacy_bindings b' in v_body) > 0 then
    raise exception 'complete_result_group_has still uses legacy purchases';
  end if;
  if position('p_user_id is not null' in pg_get_functiondef('public.complete_result_group(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'complete_result_group must stay per user';
  end if;
  if has_function_privilege('service_role', 'public.complete_analysis_active_for_code_hash(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_create_order_internal(uuid, uuid, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_result_group_has(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_result_group_has(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_order_internal(uuid, uuid, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_order(uuid, uuid, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_guest_order(uuid, text, text, text, text)', 'EXECUTE') then
    raise exception 'unexpected privileges after complete_10';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_result_group_has', 'complete_create_order_internal')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_10 function is not security invoker with empty search_path';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261014180000_complete_11_refund_rebuy_double_purchase.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
create or replace function public.complete_result_group_has(p_user_id uuid, p_diagnosis_session_id uuid, p_kind text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
      from public.complete_result_group(p_user_id, p_diagnosis_session_id) g
     where g.diagnosis_session_id <> p_diagnosis_session_id
       and (
         (p_kind = 'open' and exists (
            select 1 from public.complete_orders o
             where o.diagnosis_session_id = g.diagnosis_session_id and o.status in ('created', 'checkout_open')))
         or (p_kind = 'analysis' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis'
                          and e.status in ('active', 'suspended'))))
         or (p_kind = 'complete' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'complete'
                          and e.status in ('active', 'suspended'))))
         or (p_kind = 'analysis_active' and (
            exists (select 1 from public.record_entitlements e
                     where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis'
                       and e.status in ('active', 'suspended'))))
       ))
$$;

create or replace function public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                 p_offer text, p_idempotency_key text, p_claim_secret_hash text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_session public.diagnosis_sessions%rowtype;
  v_has_record_analysis boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
  v_guest boolean := p_user_id is null;
begin
  if p_offer not in ('analysis', 'direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_guest and (p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'complete_invalid_claim_secret' using errcode = '22023';
  end if;
  -- ロックの順：結果グループ → 記録
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id;
  if not found or v_session.user_id is distinct from p_user_id or (v_guest and v_session.guest_created_at is null) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id
       or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  -- 再購入の禁止（トリガーでも確かめる）
  if p_offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis'
                     and e.status in ('active', 'suspended')) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = p_diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete'
                     and e.status in ('active', 'suspended')) then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  -- 同じ本人・同じ診断結果の別の記録（D1）：決済中なら作らない。購入済みの物は重ねて売らない
  if not v_guest then
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, case when p_offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    if p_offer = 'direct_complete' and public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'analysis_active') then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
  end if;
  -- 解析レポートの支払いで異議申し立てに負けた（または申し立て中の）記録では ¥3,000 を売らない（complete_11）
  if p_offer = 'direct_complete' and exists (select 1 from public.complete_orders o
                                              where o.diagnosis_session_id = p_diagnosis_session_id
                                                and o.offer = 'analysis' and o.status = 'disputed') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  -- 解析権が一時停止中（dispute 中）の記録では ¥3,000 を作らない（解析権を重ねて作らない）
  if p_offer = 'direct_complete' and exists (select 1 from public.record_entitlements e
                                              where e.diagnosis_session_id = p_diagnosis_session_id
                                                and e.right_type = 'analysis' and e.status = 'suspended') then
    raise exception 'complete_rights_suspended' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  -- 旧 Payment Link（purchase_entitlements・complete_legacy_bindings）は、新 Checkout の判断に使わない（complete_10）
  if p_offer = 'analysis' then
    v_basis := null;
    v_amount := 1000;
  elsif p_offer = 'direct_complete' then
    if v_has_record_analysis then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 3000;
  else
    -- 追加 ¥2,000 の根拠は、この記録の有効な新 Checkout の解析権だけ（ゲスト・ログイン中とも同じ）
    if not v_has_record_analysis then
      raise exception 'complete_upgrade_requires_analysis' using errcode = '42501';
    end if;
    v_basis := 'record_entitlement';
    v_amount := 2000;
  end if;

  if p_offer = 'analysis' then
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', null, p_idempotency_key,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  else
    select * into v_goal from public.record_mentor_goals g
     where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id is not distinct from p_user_id;
    if not found then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'live', v_basis, p_idempotency_key,
            v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  end if;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = new.diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'analysis'
                     and e.status in ('active', 'suspended')) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = new.diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete'
                     and e.status in ('active', 'suspended')) then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  if new.user_id is not null then
    perform public.complete_lock_result_group(new.user_id, new.diagnosis_session_id);
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id,
                                        case when new.offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.complete_apply_payment(
    p_event_id text, p_event_created timestamptz, p_livemode boolean,
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text,
    p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.completed';
  v_order public.complete_orders%rowtype;
  v_res public.diagnosis_results%rowtype;
  v_code text;
  v_kinds text[];
  v_sid uuid;
  v_uid uuid;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  -- ロックの順（全関数で共通）：結果グループ → 記録（complete_order:<記録>）→ 行（注文 → 記録 → 権利・生成物）。
  -- 注文の行を先に取ると、記録のロックを持って注文の行を待つ引き継ぎ・注文の作成と循環する（デッドロック）
  select o.diagnosis_session_id, o.user_id into v_sid, v_uid from public.complete_orders o where o.id = p_order_id;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  perform public.complete_lock_result_group(v_uid, v_sid);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || v_sid::text, 0));
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  -- ロックを待つ間に引き継がれた（注文の本人が変わった）：取り直しのため一時的な失敗にする（Webhook の再送・次の確認で反映）
  if v_order.user_id is distinct from v_uid then
    raise exception 'complete_retry_later' using errcode = '40001';
  end if;

  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from true or v_order.stripe_mode <> 'live' then 'livemode_mismatch'
    when p_currency is distinct from 'jpy' then 'currency_mismatch'
    when p_amount_total is distinct from v_order.amount then 'amount_mismatch'
    when v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', v_code, v_order.id);
    return 'ignored:' || v_code;
  end if;

  if v_order.status in ('paid', 'disputed', 'refunded') then
    update public.complete_orders set last_stripe_event_id = p_event_id, last_event_created = greatest(last_event_created, p_event_created)
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  -- 支払いを反映すると二重の購入になる時は反映せず、運営者確認（返金）にする（complete_11）：
  --   ・同じ記録（本人の注文は同じ診断結果の記録も）に、同じ種類（解析／完全解析）の有効な注文・権利がある
  --     （期限切れ・片付け済みの注文への遅れた支払い、引き継ぎで同じ結果の購入が入った後の支払い）
  --   ・期限切れ・片付け済みの注文で、同じ記録・同じ結果に別の決済待ちがある
  --   ・¥3,000 なのに、同じ記録・同じ結果に有効な解析権がある（¥2,000 で足りる）
  v_kinds := case when v_order.offer = 'analysis' then array['analysis', 'direct_complete']
                  else array['direct_complete', 'analysis_upgrade'] end;
  if exists (select 1 from public.complete_orders o2
              where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
                and o2.offer = any (v_kinds) and o2.status in ('paid', 'disputed'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = v_order.diagnosis_session_id and e.source_order_id is distinct from v_order.id
                   and e.right_type = case when v_order.offer = 'analysis' then 'analysis' else 'complete' end
                   and e.status in ('active', 'suspended'))
     or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id,
                                         case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)
     or (v_order.status in ('expired', 'canceled') and (
           exists (select 1 from public.complete_orders o2
                    where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
                      and o2.status in ('created', 'checkout_open'))
           or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id, 'open')))
     or (v_order.offer = 'direct_complete' and (
           exists (select 1 from public.record_entitlements e
                    where e.diagnosis_session_id = v_order.diagnosis_session_id and e.right_type = 'analysis'
                      and e.status in ('active', 'suspended'))
           or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id, 'analysis_active'))) then
    -- 決済中の注文のまま残さない（その記録の次の申込・引き継ぎを止めない。運営者の返金は failed からも記録できる）
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = 'live_order_conflict', updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'live_order_conflict', v_order.id);
    return 'ignored:live_order_conflict';
  end if;
  -- ¥2,000：根拠（この記録の有効な解析権）が支払いの時点で無い（決済中に ¥1,000 が返金・停止された）：反映せず運営者確認
  if v_order.offer = 'analysis_upgrade' and not exists (
       select 1 from public.record_entitlements e
        where e.diagnosis_session_id = v_order.diagnosis_session_id and e.right_type = 'analysis' and e.status = 'active') then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = 'basis_inactive', updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'basis_inactive', v_order.id);
    return 'ignored:basis_inactive';
  end if;

  if v_order.offer <> 'analysis' then
    update public.record_mentor_goals
       set goal_id = v_order.mentor_goal_id, goal_catalog_version = v_order.mentor_goal_catalog_version,
           selected_at = v_order.mentor_goal_selected_at, locked_at = coalesce(locked_at, now())
     where diagnosis_session_id = v_order.diagnosis_session_id and user_id is not distinct from v_order.user_id;
    if not found then
      raise exception 'complete_mentor_goal_missing' using errcode = '42501';
    end if;
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  -- 権利：analysis は analysis、direct は analysis（記録に有効な analysis 権が無い場合）と complete、upgrade は complete
  if v_order.offer in ('analysis', 'direct_complete') and not exists (
       select 1 from public.record_entitlements e
        where e.diagnosis_session_id = v_order.diagnosis_session_id
          and e.right_type = 'analysis' and e.status in ('active', 'suspended')) then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'analysis', v_order.id)
    on conflict (source_order_id, right_type) do nothing;
  end if;
  if v_order.offer in ('direct_complete', 'analysis_upgrade') then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'complete', v_order.id)
    on conflict (source_order_id, right_type) do nothing;

    if not exists (select 1 from public.complete_reports r where r.source_order_id = v_order.id) then
      select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
      if not found then
        raise exception 'complete_result_missing' using errcode = '42501';
      end if;
      insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                           content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                           translation_model_version, character_profile_version, mirror_model_version,
                                           mentor_goal_catalog_version, mentor_goal_id, input_sha256)
      values (v_order.user_id, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
              p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
              v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
              v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256);
    end if;
  end if;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

create or replace function public.complete_apply_dispute(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid,
    p_payment_intent_id text, p_action text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type text;
  v_order public.complete_orders%rowtype;
begin
  if p_action not in ('opened', 'won', 'lost') then
    raise exception 'complete_invalid_dispute_action' using errcode = '22023';
  end if;
  v_type := case when p_action = 'opened' then 'charge.dispute.created' else 'charge.dispute.closed' end;
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'payment_intent_mismatch', v_order.id);
    return 'ignored:payment_intent_mismatch';
  end if;
  if v_order.status = 'refunded' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  -- 支払いを反映しなかった注文（期限切れ・片付け済みへの遅れた支払い・二重の購入として運営者確認）への異議申し立て：
  --   権利は無いため記録だけ残す（Webhook を失敗させ続けない。complete_11）。決済中（created・checkout_open）は従来どおり後で再試行
  if v_order.status in ('expired', 'canceled') then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_applied', v_order.id);
    return 'ignored:order_not_applied';
  end if;
  if v_order.status not in ('paid', 'disputed') then
    raise exception 'complete_retry_later' using errcode = '55000';
  end if;

  if p_action = 'opened' then
    if v_order.last_event_created is not null and p_event_created < v_order.last_event_created then
      perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'stale', v_order.id);
      return 'stale';
    end if;
    if v_order.status = 'disputed' then
      perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
      return 'noop';
    end if;
    update public.complete_orders
       set status = 'disputed', last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'suspended', suspended_at = now(), suspend_reason = 'dispute_open'
     where source_order_id = v_order.id and status = 'active';
  elsif p_action = 'won' then
    update public.complete_orders
       set status = 'paid', last_stripe_event_id = p_event_id,
           last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created), updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'active', suspended_at = null, suspend_reason = null
     where source_order_id = v_order.id and status = 'suspended';
  else
    update public.complete_orders
       set status = 'disputed', last_stripe_event_id = p_event_id,
           last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created), updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'revoked', revoked_at = now(), revoke_reason = 'dispute_lost'
     where source_order_id = v_order.id and status <> 'revoked';
    update public.complete_reports
       set status = 'revoked', revoked_at = now(), quarantined_at = coalesce(quarantined_at, now()),
           lease_token = null, lease_expires_at = null, updated_at = now()
     where source_order_id = v_order.id and status <> 'revoked';
  end if;
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;


create or replace function public.record_mentor_goals_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- 目標の固定を外す（complete_release_mentor_goal_lock だけが、同じトランザクションの中で印を立てて行う。complete_11）
  if current_setting('app.complete_goal_release', true) = 'on' and old.locked_at is not null and new.locked_at is null
     and new.goal_id is not distinct from old.goal_id and new.user_id is not distinct from old.user_id then
    new.updated_at := now();
    return new;
  end if;
  if old.locked_at is not null and (
       new.goal_id is distinct from old.goal_id
    or new.goal_catalog_version is distinct from old.goal_catalog_version
    or new.selected_at is distinct from old.selected_at
    or new.locked_at is distinct from old.locked_at
    or (new.user_id is distinct from old.user_id
        and not (old.user_id is null and new.user_id is not null and current_setting('app.complete_claim', true) = 'on'))) then
    raise exception 'mentor_goal_locked' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 目標の固定を外す（complete_11）：返金・取消で、その記録に有効な完全解析の権利も、決済待ち・支払済み・異議申し立て中の
--   完全解析の注文も無い時だけ。外した時 true。同じ記録のロック（complete_order:<記録>）の中で行う
create or replace function public.complete_release_mentor_goal_lock(p_user_id uuid, p_diagnosis_session_id uuid)
  returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_done boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  if exists (select 1 from public.record_entitlements e
              where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status in ('active', 'suspended'))
     or exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = p_diagnosis_session_id and o.offer in ('direct_complete', 'analysis_upgrade')
                   and o.status in ('created', 'checkout_open', 'paid', 'disputed')) then
    return false;
  end if;
  perform set_config('app.complete_goal_release', 'on', true);
  update public.record_mentor_goals g set locked_at = null
   where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id is not distinct from p_user_id and g.locked_at is not null;
  v_done := found;
  perform set_config('app.complete_goal_release', 'off', true);
  return v_done;
end;
$$;

create or replace function public.complete_create_guest_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text,
                                                              p_claim_secret_hash text, p_goal_id text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_offer in ('direct_complete', 'analysis_upgrade') then
    if p_goal_id is null or p_goal_id not in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01') then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
    if not exists (select 1 from public.diagnosis_sessions s
                    where s.id = p_diagnosis_session_id and s.user_id is null and s.guest_created_at is not null) then
      raise exception 'complete_record_not_found' using errcode = '42501';
    end if;
    -- 完全解析を購入済みの記録では、目標に触れる前に断る（ロック済みの目標の書き換えを試みない）
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete'
                     and e.status in ('active', 'suspended')) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    -- 返金の後の買い直し：前回の支払いで固定した目標の固定を外してから選び直す（complete_11）
    perform public.complete_release_mentor_goal_lock(null, p_diagnosis_session_id);
    insert into public.record_mentor_goals (diagnosis_session_id, user_id, goal_catalog_version, goal_id, selected_at)
    values (p_diagnosis_session_id, null, 'CORE1-MENTOR-GOALS-1.0.0', p_goal_id, now())
    on conflict (diagnosis_session_id) do update
      set goal_id = excluded.goal_id, goal_catalog_version = excluded.goal_catalog_version, selected_at = excluded.selected_at;
  elsif p_goal_id is not null then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  return query select * from public.complete_create_order_internal(null, p_diagnosis_session_id, p_offer, p_idempotency_key, p_claim_secret_hash);
end;
$$;

-- 生成物の重複防止：失効した生成物は数えない（返金の後の買い直し）
drop index if exists public.complete_reports_same_version_uq;
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256)
  where status <> 'revoked';

-- 権限（置き換えでも保たれるが、明示する）
revoke all on function public.complete_result_group_has(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_result_group_has(uuid, uuid, text) to service_role;
revoke all on function public.complete_create_order_internal(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_order_internal(uuid, uuid, text, text, text) to service_role;
revoke all on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;
revoke all on function public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text) to service_role;
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_guard() from public, anon, authenticated;
revoke all on function public.complete_release_mentor_goal_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_release_mentor_goal_lock(uuid, uuid) to service_role;
revoke all on function public.complete_create_guest_order(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_guest_order(uuid, text, text, text, text) to service_role;

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
declare
  v_body text;
begin
  foreach v_body in array array[
    pg_get_functiondef('public.complete_result_group_has(uuid, uuid, text)'::regprocedure),
    pg_get_functiondef('public.complete_create_order_internal(uuid, uuid, text, text, text)'::regprocedure),
    pg_get_functiondef('public.complete_orders_no_repurchase()'::regprocedure),
    pg_get_functiondef('public.complete_create_guest_order(uuid, text, text, text, text)'::regprocedure)] loop
    if position($q$'paid', 'disputed', 'refunded'$q$ in v_body) > 0 then
      raise exception 'refunded orders still count as purchased';
    end if;
  end loop;
  v_body := pg_get_functiondef('public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)'::regprocedure);
  if position('basis_inactive' in v_body) = 0 or position('analysis_active' in v_body) = 0 then
    raise exception 'complete_apply_payment conflict checks missing';
  end if;
  if position('complete_release_mentor_goal_lock' in pg_get_functiondef('public.complete_create_guest_order(uuid, text, text, text, text)'::regprocedure)) = 0
     or position('complete_goal_release' in pg_get_functiondef('public.record_mentor_goals_guard()'::regprocedure)) = 0
     or not has_function_privilege('service_role', 'public.complete_release_mentor_goal_lock(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_release_mentor_goal_lock(uuid, uuid)', 'EXECUTE') then
    raise exception 'mentor goal release not installed';
  end if;
  if position('order_not_applied' in pg_get_functiondef('public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text)'::regprocedure)) = 0 then
    raise exception 'complete_apply_dispute not updated';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'complete_reports_same_version_uq'
                  and indexdef like '%WHERE%revoked%') then
    raise exception 'complete_reports_same_version_uq not partial';
  end if;
  if has_function_privilege('anon', 'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_create_order_internal(uuid, uuid, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_order(uuid, uuid, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_guest_order(uuid, text, text, text, text)', 'EXECUTE') then
    raise exception 'unexpected privileges after complete_11';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_result_group_has', 'complete_create_order_internal', 'complete_orders_no_repurchase',
                                'complete_apply_payment', 'complete_apply_dispute', 'complete_create_guest_order', 'complete_release_mentor_goal_lock')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_11 function is not security invoker with empty search_path';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261015120000_complete_12_single_purchase_email_claim.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
create or replace function public.complete_transfer_guest_record(p_user_id uuid, p_diagnosis_session_id uuid, p_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_session public.diagnosis_sessions%rowtype;
  v_onboarding text;
begin
  if p_user_id is null or p_method not in ('cookie', 'email_otp') then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id for update;
  if not found or v_session.guest_created_at is null then
    raise exception 'complete_claim_invalid' using errcode = '42501';
  end if;
  if v_session.user_id = p_user_id then
    return 'noop';
  end if;
  if v_session.user_id is not null then
    raise exception 'complete_claim_conflict' using errcode = '42501';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  -- 決済待ちの注文がある間は引き継がない（API が Stripe の状態を確かめて片付けてから呼ぶ）
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open')) then
    raise exception 'complete_claim_checkout_open' using errcode = '42501';
  end if;
  -- 支払いの購入時メールが1つに揃っている記録だけを移す（complete_12）。
  --   支払済み・異議申し立て中の注文のどれかに購入時メールが無い（まだ記録していない）・2つ以上のメールに分かれている時は移さない
  --   （¥1,000 を B、¥2,000 を C のメールで払った記録を、B のアカウントへ丸ごと移さない）。呼び出し側がメールの一致を確かめる
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('paid', 'disputed') and o.purchase_email_hmac is null) then
    raise exception 'complete_claim_email_unknown' using errcode = '42501';
  end if;
  if (select count(distinct o.purchase_email_hmac) from public.complete_orders o
       where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('paid', 'disputed')) > 1 then
    raise exception 'complete_claim_mixed_email' using errcode = '42501';
  end if;
  perform set_config('app.complete_claim', 'on', true);
  update public.diagnosis_sessions set user_id = p_user_id where id = p_diagnosis_session_id;
  update public.complete_orders
     set user_id = p_user_id, claimed_by = p_user_id, claimed_at = now(), claim_method = p_method, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_entitlements set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_mentor_goals set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.complete_reports set user_id = p_user_id, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  perform set_config('app.complete_claim', 'off', true);
  return 'applied';
end;
$$;

create or replace function public.complete_claim_guest_by_email(p_user_id uuid, p_purchase_email_hmac text)
  returns table (claimed integer, skipped integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_sid uuid;
  v_claimed integer := 0;
  v_skipped integer := 0;
begin
  if p_user_id is null or p_purchase_email_hmac is null or p_purchase_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  for v_sid in
    select distinct o.diagnosis_session_id from public.complete_orders o
     where o.buyer = 'guest' and o.user_id is null and o.status = 'paid' and o.purchase_email_hmac = p_purchase_email_hmac
  loop
    begin
      if public.complete_transfer_guest_record(p_user_id, v_sid, 'email_otp') = 'applied' then
        v_claimed := v_claimed + 1;
      end if;
    exception when others then
      if sqlerrm in ('complete_claim_conflict', 'complete_claim_checkout_open', 'complete_claim_mixed_email', 'complete_claim_email_unknown') then
        v_skipped := v_skipped + 1;
      else
        raise;
      end if;
    end;
  end loop;
  return query select v_claimed, v_skipped;
end;
$$;

revoke all on function public.complete_transfer_guest_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_claim_guest_by_email(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_transfer_guest_record(uuid, uuid, text) to service_role;
grant execute on function public.complete_claim_guest_by_email(uuid, text) to service_role;

-- 確認（変更はしない。期待と違えば全体を取り消す）
do $$
begin
  if position('complete_claim_mixed_email' in pg_get_functiondef('public.complete_transfer_guest_record(uuid, uuid, text)'::regprocedure)) = 0
     or position('complete_claim_mixed_email' in pg_get_functiondef('public.complete_claim_guest_by_email(uuid, text)'::regprocedure)) = 0 then
    raise exception 'complete_12 functions are not replaced';
  end if;
  if has_function_privilege('anon', 'public.complete_transfer_guest_record(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_claim_guest_by_email(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_transfer_guest_record(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_claim_guest_by_email(uuid, text)', 'EXECUTE') then
    raise exception 'unexpected privileges after complete_12';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_transfer_guest_record', 'complete_claim_guest_by_email')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_12 function is not security invoker with empty search_path';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261020120000_complete_13_report_links_and_registrations.sql（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）
-- ------------------------------------------------------------
-- 1. 注文の種類 buyer = 'link'（レポート固有リンクで納品する購入）
alter table public.complete_orders drop constraint if exists complete_orders_buyer_check;
alter table public.complete_orders add constraint complete_orders_buyer_check check (buyer in ('user', 'guest', 'link'));
alter table public.complete_orders drop constraint if exists complete_orders_buyer_consistency;
alter table public.complete_orders add constraint complete_orders_buyer_consistency check (
  (buyer = 'user' and user_id is not null and claim_secret_hash is null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null)
  or (buyer = 'guest' and claim_secret_hash is not null and claim_expires_at is not null
     and ((user_id is null and claimed_by is null and claimed_at is null and claim_method is null)
          or (user_id is not null and claimed_by = user_id and claimed_at is not null and claim_method is not null)))
  or (buyer = 'link' and user_id is null and claim_secret_hash is not null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null and purchase_email_hmac is null
     and offer in ('analysis', 'direct_complete'))
);

-- 2. 1つの記録あたり1件の決済待ち・支払いの一意索引は、従来の注文（user・guest）だけに掛ける（新しい購入は再購入を断らない）
drop index if exists public.complete_orders_one_open_per_session;
create unique index complete_orders_one_open_per_session on public.complete_orders (diagnosis_session_id)
  where status in ('created', 'checkout_open') and buyer <> 'link';
drop index if exists public.complete_orders_one_paid_analysis_per_session;
create unique index complete_orders_one_paid_analysis_per_session on public.complete_orders (diagnosis_session_id)
  where offer = 'analysis' and status in ('paid', 'disputed') and buyer <> 'link';
drop index if exists public.complete_orders_one_paid_complete_per_session;
create unique index complete_orders_one_paid_complete_per_session on public.complete_orders (diagnosis_session_id)
  where offer in ('direct_complete', 'analysis_upgrade') and status in ('paid', 'disputed') and buyer <> 'link';

-- 3. 完全解析の生成物：新しい購入の生成物（via_link）は注文ごとに1件。従来の生成物は記録ごとに1件のまま
alter table public.complete_reports add column if not exists via_link boolean not null default false;
drop index if exists public.complete_reports_one_active_per_session;
create unique index complete_reports_one_active_per_session on public.complete_reports (diagnosis_session_id)
  where status <> 'revoked' and not via_link;
drop index if exists public.complete_reports_same_version_uq;
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256)
  where status <> 'revoked' and not via_link;
create unique index if not exists complete_reports_one_per_order on public.complete_reports (source_order_id)
  where status <> 'revoked';

-- 4. 納品（支払済みの注文ごとに1件。レポート固有リンクの秘密値のハッシュを持つ）
create table if not exists public.report_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null unique references public.complete_orders(id) on delete restrict,
  diagnosis_session_id  uuid not null references public.diagnosis_sessions(id) on delete restrict,
  product               text not null check (product in ('analysis', 'complete')),
  report_id             uuid references public.complete_reports(id) on delete restrict,
  link_token_hash       text not null unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  status                text not null default 'active' check (status in ('active', 'revoked')),
  revoke_reason         text check (revoke_reason is null or revoke_reason in ('operator', 'mistaken_purchase', 'abuse')),
  issued_at             timestamptz not null default now(),
  reissue_count         integer not null default 0 check (reissue_count >= 0),
  reissued_at           timestamptz,
  revoked_at            timestamptz,
  updated_at            timestamptz not null default now(),
  constraint report_deliveries_state check (
    (status = 'active' and revoked_at is null and revoke_reason is null)
    or (status = 'revoked' and revoked_at is not null and revoke_reason is not null)),
  constraint report_deliveries_report_matches_product check (
    (product = 'analysis' and report_id is null) or product = 'complete')
);
create index if not exists report_deliveries_session_idx on public.report_deliveries (diagnosis_session_id);
alter table public.report_deliveries enable row level security;
revoke all on table public.report_deliveries from public, anon, authenticated;
grant select, insert, update on table public.report_deliveries to service_role;

-- 5. アカウントへの閲覧の登録（購入の移転ではない。同じ納品を複数のアカウントに登録できる）
create table if not exists public.account_report_registrations (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  delivery_id    uuid not null references public.report_deliveries(id) on delete restrict,
  registered_at  timestamptz not null default now(),
  primary key (user_id, delivery_id)
);
create index if not exists account_report_registrations_delivery_idx on public.account_report_registrations (delivery_id);
alter table public.account_report_registrations enable row level security;
revoke all on table public.account_report_registrations from public, anon, authenticated;
grant select, insert on table public.account_report_registrations to service_role;

-- 6. 注文の作成の規則：追加 ¥2,000 は新しく作らない。新しい購入（link）は再購入・決済待ちを理由に断らない
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.offer = 'analysis_upgrade' then
    raise exception 'complete_offer_retired' using errcode = '42501';
  end if;
  if new.buyer = 'link' then
    return new;
  end if;
  if new.offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = new.diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed') and o.buyer <> 'link')
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'analysis'
                     and e.status in ('active', 'suspended')) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = new.diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed') and o.buyer <> 'link')
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete'
                     and e.status in ('active', 'suspended')) then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  if new.user_id is not null then
    perform public.complete_lock_result_group(new.user_id, new.diagnosis_session_id);
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id,
                                        case when new.offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;

-- 7. 注文の作成の前提：新しい購入（link）は、記録の持ち主・ログイン・record_mentor_goals を見ない（版と目標だけを確かめる）
create or replace function public.complete_orders_require_eligibility()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_owner uuid;
  v_guest timestamptz;
  v_found boolean;
  v_onboarding text;
  v_goal record;
begin
  select s.user_id, s.guest_created_at, true into v_owner, v_guest, v_found
    from public.diagnosis_sessions s where s.id = new.diagnosis_session_id;
  if v_found is null then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  if new.buyer = 'link' then
    if new.offer = 'analysis' then
      if not exists (select 1 from public.diagnosis_results r
                      where r.session_id = new.diagnosis_session_id and r.diagnosis_version = 'ETI-2.0') then
        raise exception 'complete_version_not_eligible' using errcode = '42501';
      end if;
      return new;
    end if;
    if not exists (
      select 1 from public.diagnosis_results r, public.complete_rc1_required_versions() v
       where r.session_id = new.diagnosis_session_id
         and r.diagnosis_version         is not distinct from v.diagnosis_version
         and r.item_set_version          is not distinct from v.item_set_version
         and r.scoring_version           is not distinct from v.scoring_version
         and r.translation_model_version is not distinct from v.translation_model_version
         and r.character_profile_version is not distinct from v.character_profile_version
         and r.mirror_model_version      is not distinct from v.mirror_model_version) then
      raise exception 'complete_version_not_eligible' using errcode = '42501';
    end if;
    if new.mentor_goal_id is null or new.mentor_goal_selected_at is null then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_owner is distinct from new.user_id then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  if new.buyer = 'guest' then
    if new.user_id is not null or v_guest is null then
      raise exception 'complete_not_owner' using errcode = '42501';
    end if;
  else
    select p.onboarding_status into v_onboarding from public.profiles p where p.id = new.user_id;
    if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
      raise exception 'complete_onboarding_required' using errcode = '42501';
    end if;
  end if;
  if new.offer = 'analysis' then
    if not exists (select 1 from public.diagnosis_results r
                    where r.session_id = new.diagnosis_session_id and r.diagnosis_version = 'ETI-2.0') then
      raise exception 'complete_version_not_eligible' using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from public.diagnosis_results r, public.complete_rc1_required_versions() v
     where r.session_id = new.diagnosis_session_id
       and r.diagnosis_version         is not distinct from v.diagnosis_version
       and r.item_set_version          is not distinct from v.item_set_version
       and r.scoring_version           is not distinct from v.scoring_version
       and r.translation_model_version is not distinct from v.translation_model_version
       and r.character_profile_version is not distinct from v.character_profile_version
       and r.mirror_model_version      is not distinct from v.mirror_model_version) then
    raise exception 'complete_version_not_eligible' using errcode = '42501';
  end if;
  select g.goal_id, g.goal_catalog_version, g.selected_at into v_goal
    from public.record_mentor_goals g
   where g.diagnosis_session_id = new.diagnosis_session_id and g.user_id is not distinct from new.user_id;
  if not found then
    raise exception 'complete_mentor_goal_required' using errcode = '42501';
  end if;
  if v_goal.goal_id is distinct from new.mentor_goal_id
     or v_goal.goal_catalog_version is distinct from new.mentor_goal_catalog_version
     or v_goal.selected_at is distinct from new.mentor_goal_selected_at then
    raise exception 'complete_mentor_goal_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;

-- 8. 新しい購入の注文を作る。同じ購入操作（p_idempotency_key）の再送は同じ注文を返す（連打・再試行で注文を増やさない）
create or replace function public.complete_create_link_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text,
                                                             p_link_token_hash text, p_goal_id text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_id uuid;
begin
  if p_offer = 'analysis_upgrade' then
    raise exception 'complete_offer_retired' using errcode = '42501';
  end if;
  if p_offer is null or p_offer not in ('analysis', 'direct_complete') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^lk_[A-Za-z0-9_-]{22,64}$'
     or p_link_token_hash is null or p_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  if p_offer = 'direct_complete' then
    if p_goal_id is null or p_goal_id not in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01') then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
  elsif p_goal_id is not null then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_link_attempt:' || p_idempotency_key, 0));
  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.buyer <> 'link' or v_existing.diagnosis_session_id <> p_diagnosis_session_id or v_existing.offer <> p_offer
       or v_existing.mentor_goal_id is distinct from p_goal_id then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;
  if not exists (select 1 from public.diagnosis_sessions s where s.id = p_diagnosis_session_id) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;
  insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                      mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                      buyer, claim_secret_hash, claim_expires_at)
  values (null, p_diagnosis_session_id, p_offer, case when p_offer = 'analysis' then 1000 else 3000 end, 'live', null, p_idempotency_key,
          case when p_offer = 'direct_complete' then 'CORE1-MENTOR-GOALS-1.0.0' end, p_goal_id,
          case when p_offer = 'direct_complete' then now() end,
          'link', p_link_token_hash, null)
  returning id into v_id;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;
revoke all on function public.complete_create_link_order(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_link_order(uuid, text, text, text, text) to service_role;

-- 9. 新しい購入の支払いの反映：注文を paid にし、納品を1件、完全解析は生成物を1件作る（Webhook・購入完了ページの再処理とも冪等）。
--    期限切れ・中止の後に支払われた古い決済も、別の支払済みの注文として納品する（再購入を断らない）
create or replace function public.complete_apply_link_payment(
    p_event_id text, p_event_created timestamptz, p_livemode boolean,
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text,
    p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.completed';
  v_order public.complete_orders%rowtype;
  v_res public.diagnosis_results%rowtype;
  v_code text;
  v_report uuid;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found or v_order.buyer <> 'link' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from true or v_order.stripe_mode <> 'live' then 'livemode_mismatch'
    when p_currency is distinct from 'jpy' then 'currency_mismatch'
    when p_amount_total is distinct from v_order.amount then 'amount_mismatch'
    when v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', v_code, v_order.id);
    return 'ignored:' || v_code;
  end if;
  if v_order.status in ('paid', 'disputed', 'refunded') then
    update public.complete_orders set last_stripe_event_id = p_event_id, last_event_created = greatest(last_event_created, p_event_created)
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  if v_order.offer = 'direct_complete' then
    select r.id into v_report from public.complete_reports r where r.source_order_id = v_order.id and r.status <> 'revoked';
    if v_report is null then
      select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
      if not found then
        raise exception 'complete_result_missing' using errcode = '42501';
      end if;
      insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                           content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                           translation_model_version, character_profile_version, mirror_model_version,
                                           mentor_goal_catalog_version, mentor_goal_id, input_sha256, via_link)
      values (null, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
              p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
              v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
              v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256, true)
      returning id into v_report;
    end if;
  end if;
  insert into public.report_deliveries (order_id, diagnosis_session_id, product, report_id, link_token_hash)
  values (v_order.id, v_order.diagnosis_session_id, case when v_order.offer = 'analysis' then 'analysis' else 'complete' end,
          v_report, v_order.claim_secret_hash)
  on conflict (order_id) do nothing;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;
revoke all on function public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;

-- 10. アカウントへの閲覧の登録（有効な納品だけ。同じアカウント・同じ納品は1件）
create or replace function public.complete_register_delivery(p_user_id uuid, p_link_token_hash text)
  returns table (reg_result text, reg_delivery uuid)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_delivery public.report_deliveries%rowtype;
  v_status text;
  v_onboarding text;
  v_count integer;
begin
  if p_user_id is null or p_link_token_hash is null or p_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  select * into v_delivery from public.report_deliveries d where d.link_token_hash = p_link_token_hash;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  select o.status into v_status from public.complete_orders o where o.id = v_delivery.order_id;
  if v_delivery.status <> 'active' or v_status is distinct from 'paid' then
    return query select 'inactive'::text, null::uuid;
    return;
  end if;
  insert into public.account_report_registrations (user_id, delivery_id) values (p_user_id, v_delivery.id)
  on conflict (user_id, delivery_id) do nothing;
  get diagnostics v_count = row_count;
  return query select case when v_count > 0 then 'registered' else 'already' end, v_delivery.id;
end;
$$;
revoke all on function public.complete_register_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_register_delivery(uuid, text) to service_role;

-- 11. 新しい購入の完全解析の作り直し（固有リンク・登録で確かめた後に API が呼ぶ。手動の作り直しは2回まで）
create or replace function public.complete_regenerate_link_report(p_report_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
begin
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found or not v_report.via_link then
    return 'not_found';
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not exists (select 1 from public.complete_orders o where o.id = v_report.source_order_id and o.status = 'paid')
     or not exists (select 1 from public.report_deliveries d where d.report_id = v_report.id and d.status = 'active') then
    return 'not_entitled';
  end if;
  if v_report.status = 'ready' then
    return 'ready';
  end if;
  if not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                              v_report.next_retry_at, v_report.lease_expires_at) then
    return 'in_progress';
  end if;
  if v_report.last_error_code in ('materials_changed', 'input_mismatch', 'frozen_versions_mismatch', 'frozen_goal_mismatch',
                                  'record_data_missing', 'report_not_found') then
    return 'operator_required';
  end if;
  if v_report.manual_retries >= 2 then
    return 'limit_reached';
  end if;
  update public.complete_reports
     set status = 'queued', attempts = 0, next_retry_at = null, lease_token = null, lease_expires_at = null,
         manual_retries = manual_retries + 1, updated_at = now()
   where id = v_report.id;
  return 'requeued';
end;
$$;
revoke all on function public.complete_regenerate_link_report(uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_link_report(uuid) to service_role;

-- 12. 従来の閲覧・作り直し（本人・ゲストの記録ごと）は、新しい購入の生成物（via_link）を見ない
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order public.complete_orders%rowtype;
  v_entitled boolean;
  v_basis_ok boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id and not r.via_link
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select * into v_order from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id is not distinct from p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order.status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_order.offer = 'analysis_upgrade' then
    if v_order.analysis_basis = 'legacy_purchase_entitlement' then
      v_basis_ok := exists (select 1 from public.complete_legacy_bindings b
                              join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                             where b.diagnosis_session_id = p_diagnosis_session_id and b.user_id is not distinct from p_user_id
                               and pe.status = 'active' and not public.complete_legacy_blocked(pe.diagnosis_code_hash));
    else
      v_basis_ok := exists (select 1 from public.record_entitlements e
                             where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis' and e.status = 'active');
    end if;
    if not v_basis_ok then
      return query select 'basis_inactive'::text, null::uuid, null::text, null::text;
      return;
    end if;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;
revoke all on function public.complete_report_for_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_report_for_view(uuid, uuid) to service_role;

create or replace function public.complete_regenerate_report(p_user_id uuid, p_diagnosis_session_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_report public.complete_reports%rowtype;
begin
  select r.id into v_id from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id and not r.via_link
   order by r.created_at desc
   limit 1;
  if v_id is null then
    return 'not_found';
  end if;
  select * into v_report from public.complete_reports r where r.id = v_id for update;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not exists (select 1 from public.complete_orders o where o.id = v_report.source_order_id and o.status = 'paid')
     or not exists (select 1 from public.record_entitlements e
                     where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                       and e.right_type = 'complete' and e.status = 'active') then
    return 'not_entitled';
  end if;
  if v_report.status = 'ready' then
    return 'ready';
  end if;
  if not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                              v_report.next_retry_at, v_report.lease_expires_at) then
    return 'in_progress';
  end if;
  if v_report.last_error_code in ('materials_changed', 'input_mismatch', 'frozen_versions_mismatch', 'frozen_goal_mismatch',
                                  'record_data_missing', 'report_not_found') then
    return 'operator_required';
  end if;
  if v_report.manual_retries >= 2 then
    return 'limit_reached';
  end if;
  update public.complete_reports
     set status = 'queued', attempts = 0, next_retry_at = null, lease_token = null, lease_expires_at = null,
         manual_retries = manual_retries + 1, updated_at = now()
   where id = v_id;
  return 'requeued';
end;
$$;
revoke all on function public.complete_regenerate_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_report(uuid, uuid) to service_role;

-- 13. 運営者の停止・再発行（SQL Editor 専用。API のロールは実行できない）。秘密値は SQL・ログに出さない（ハッシュだけを渡す）
create or replace function public.complete_admin_revoke_delivery(p_delivery_id uuid, p_reason text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('operator', 'mistaken_purchase', 'abuse') then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  update public.report_deliveries
     set status = 'revoked', revoked_at = now(), revoke_reason = p_reason, updated_at = now()
   where id = p_delivery_id and status = 'active';
  return case when found then 'revoked' else 'noop' end;
end;
$$;
revoke all on function public.complete_admin_revoke_delivery(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.complete_admin_reissue_delivery(p_delivery_id uuid, p_new_link_token_hash text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_new_link_token_hash is null or p_new_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  update public.report_deliveries
     set link_token_hash = p_new_link_token_hash, reissue_count = reissue_count + 1, reissued_at = now(),
         status = 'active', revoked_at = null, revoke_reason = null, updated_at = now()
   where id = p_delivery_id;
  return case when found then 'reissued' else 'not_found' end;
end;
$$;
revoke all on function public.complete_admin_reissue_delivery(uuid, text) from public, anon, authenticated, service_role;

-- 14. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
begin
  if to_regclass('public.report_deliveries') is null or to_regclass('public.account_report_registrations') is null
     or not (select relrowsecurity from pg_class where oid = 'public.report_deliveries'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.account_report_registrations'::regclass) then
    raise exception 'complete_13 tables are missing or without row level security';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('report_deliveries', 'account_report_registrations')) then
    raise exception 'complete_13 tables must not have policies';
  end if;
  if has_table_privilege('anon', 'public.report_deliveries', 'SELECT') or has_table_privilege('authenticated', 'public.report_deliveries', 'SELECT')
     or has_table_privilege('anon', 'public.account_report_registrations', 'SELECT')
     or has_table_privilege('authenticated', 'public.account_report_registrations', 'SELECT')
     or has_table_privilege('service_role', 'public.report_deliveries', 'DELETE')
     or has_table_privilege('service_role', 'public.account_report_registrations', 'DELETE')
     or not has_table_privilege('service_role', 'public.report_deliveries', 'SELECT')
     or not has_table_privilege('service_role', 'public.account_report_registrations', 'INSERT') then
    raise exception 'unexpected table privileges after complete_13';
  end if;
  if has_function_privilege('service_role', 'public.complete_admin_revoke_delivery(uuid, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.complete_admin_reissue_delivery(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_create_link_order(uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_register_delivery(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_link_order(uuid, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_register_delivery(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_regenerate_link_report(uuid)', 'EXECUTE') then
    raise exception 'unexpected function privileges after complete_13';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_create_link_order', 'complete_apply_link_payment', 'complete_register_delivery',
                                'complete_regenerate_link_report', 'complete_admin_revoke_delivery', 'complete_admin_reissue_delivery',
                                'complete_orders_no_repurchase', 'complete_report_for_view', 'complete_regenerate_report')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_13 function is not security invoker with empty search_path';
  end if;
  if exists (select 1 from public.complete_reports where via_link) and not exists (select 1 from public.report_deliveries) then
    raise exception 'unexpected via_link reports';
  end if;
end
$$;

notify pgrst, 'reload schema';

-- ============================================================
-- 適用後の確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $post$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and (pg_get_functiondef(p.oid) ~ $re$stripe_mode <> 'test'$re$ or pg_get_functiondef(p.oid) ~ $re$v_amount, 'test',$re$
                   or pg_get_functiondef(p.oid) ~ $re$end, 'test', null$re$ or pg_get_functiondef(p.oid) ~ 'p_livemode is distinct from false')) then
    raise exception 'a function still assumes Stripe test mode';
  end if;
  if exists (select 1 from pg_constraint c where c.connamespace = 'public'::regnamespace
              and (pg_get_constraintdef(c.oid) ~ 'cs\\_test' or pg_get_constraintdef(c.oid) ~ 'livemode = false'
                   or pg_get_constraintdef(c.oid) ~ $re$stripe_mode = 'test'$re$)
              and c.conrelid <> 'public.purchase_entitlements'::regclass) then
    raise exception 'a constraint still assumes Stripe test mode';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'complete_orders_production_live_mode_only')
     or not exists (select 1 from pg_constraint where conname = 'stripe_webhook_events_production_live_only') then
    raise exception 'live-only constraints are missing';
  end if;
  if (select count(*) from public.complete_orders) <> 0 or (select count(*) from public.record_entitlements) <> 0
     or (select count(*) from public.complete_legacy_bindings) <> 0 or (select count(*) from public.report_deliveries) <> 0
     or (select count(*) from public.account_report_registrations) <> 0 or (select count(*) from public.legacy_access_blocks) <> 0 then
    raise exception 'new tables must be empty right after the migration (no automatic migration of old purchases)';
  end if;
  if exists (select 1 from public.diagnosis_sessions where user_id is null) then
    raise exception 'existing diagnosis_sessions must keep their owner';
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
insert into element_release.migration_ledger (stage, name) values (2, 'prod_02_orders_reports_links');

notify pgrst, 'reload schema';

commit;
