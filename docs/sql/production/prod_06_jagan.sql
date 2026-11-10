-- ============================================================
-- prod_06：邪眼診断（DTI）の保存・共有・解析レポート（¥1,000）・完全解析「DIPPER」（¥3,000）
-- 【本番（element-diagnosis-test / akivoob）専用】SQL Editor で、このファイル全体を1回だけ実行する。
-- 【Preview・その他では実行しない】冒頭の確認で、本番の基準と違えば何も変えずに止まる。
-- 生成元：docs/sql/production/build_production_sql.py（Preview migration から機械的に組み立て。手で編集しない）
-- 前提：prod_04b まで適用済み（element_release.migration_ledger に stage 1〜5）。邪眼の新コードを Production に出す直前に適用する
-- 戻し：docs/sql/production/prod_96_rollback_06_DRAFT_DO_NOT_RUN.sql（DRAFT_DO_NOT_RUN）
-- 二度目の実行：冒頭で stage_already_applied として止まる（何も変更しない）。
-- 旧購入者保護（S0）：purchase_entitlements・旧購入・既存6表の既存列・主要3関数・既存 RLS／policy／権限は変更しない。
-- ============================================================
--
-- 内容（Preview の jagan_01〜03 と同じ。Preview で適用・検証済み）
--   ・jagan_results（本人の保存結果）・jagan_shares（共有）・jagan_entitlements（閲覧権。商品ごと）
--   ・jagan_orders（注文。商品は jagan_report_v1 ¥1,000／jagan_complete_v1 ¥3,000）・jagan_order_registrations（固有リンクからのマイページ登録）
--   ・関数 jagan_*（注文の作成・決済画面・支払いの反映・返金／異議申し立て・登録・権利の作り直し）。service_role だけが実行できる
--   ・すべて RLS 有効。ブラウザのロールは、本人の行の jagan_results（SELECT・DELETE）と jagan_entitlements（SELECT）だけ（マイページ）
-- 本番だけの置き換え
--   ・Preview 判定と migration 履歴（supabase_migrations）の行は除き、台帳 element_release.migration_ledger に stage 6 を記録
--   ・注文は Stripe Live だけ（jagan_orders.stripe_mode = 'live' の制約を足す）
-- 既存の表・関数・権限（既存6表・purchase_entitlements・complete_* など）には触れない

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
  -- 段階の順序：prod_04b まで適用済みで、prod_06 は未適用
  if to_regclass('element_release.migration_ledger') is null then
    raise exception 'prod_01 is not applied (ledger missing)';
  end if;
  if exists (select 1 from element_release.migration_ledger where stage = 6) then
    raise exception 'stage_already_applied: prod_06 は適用済みです（何も変更していません）';
  end if;
  if (select array_agg(stage order by stage) from element_release.migration_ledger) is distinct from array[1, 2, 3, 4, 5] then
    raise exception 'ledger does not show the previous stages in order';
  end if;
end
$guard$;

do $pre6$
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'jagan\_%')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'jagan\_%') then
    raise exception 'jagan objects already exist before prod_06 (partial or foreign state)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status') then
    raise exception 'profiles.onboarding_status is missing (prod_01 required)';
  end if;
end
$pre6$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261102120000_jagan_01_results_shares.sql（Preview 判定・履歴行を除いたもの）
-- ------------------------------------------------------------
-- 1. 本人の保存結果
create table public.jagan_results (
  result_id                uuid primary key,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  schema_version           text not null check (schema_version = 'jagan-result-3'),
  engine_version           text not null check (length(engine_version) between 1 and 64),
  item_set_version         text not null check (length(item_set_version) between 1 and 64),
  scoring_version          text not null check (length(scoring_version) between 1 and 64),
  interpretation_version   text not null check (length(interpretation_version) between 1 and 64),
  character_model_version  text not null check (length(character_model_version) between 1 and 64),
  dti_code                 text not null check (dti_code ~ '^[A-Z]{4}$'),
  naming_version           text not null check (length(naming_version) between 1 and 64),
  answers                  jsonb not null check (jsonb_typeof(answers) = 'object'),
  snapshot                 jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  headline                 jsonb not null check (jsonb_typeof(headline) = 'object'),
  created_at               timestamptz not null default now()
);
create index jagan_results_user_created_idx on public.jagan_results (user_id, created_at desc);
revoke all on table public.jagan_results from public, anon, authenticated, service_role;
grant select, delete on table public.jagan_results to authenticated;
grant select, insert, delete on table public.jagan_results to service_role;
alter table public.jagan_results enable row level security;
create policy jagan_results_select_own on public.jagan_results
  for select to authenticated using ((select auth.uid()) = user_id);
create policy jagan_results_delete_own on public.jagan_results
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 2. 公開共有（公開要約だけ）
create table public.jagan_shares (
  public_id                text primary key check (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  result_key               text not null unique check (result_key ~ '^[0-9a-f]{64}$'),
  user_id                  uuid references auth.users(id) on delete cascade,
  summary                  jsonb not null check (jsonb_typeof(summary) = 'object' and summary->>'kind' = 'jagan-public-summary-3'),
  item_set_version         text not null check (length(item_set_version) between 1 and 64),
  revoke_token_hash        text check (revoke_token_hash is null or revoke_token_hash ~ '^[0-9a-f]{64}$'),
  created_at               timestamptz not null default now(),
  revoked_at               timestamptz
);
create index jagan_shares_user_idx on public.jagan_shares (user_id) where user_id is not null;
revoke all on table public.jagan_shares from public, anon, authenticated, service_role;
grant select, insert, update on table public.jagan_shares to service_role;
alter table public.jagan_shares enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。anon・authenticated は権限なし）

-- 3. 邪眼解析レポートの購入権限（土台。販売開始まで行は作らない）
create table public.jagan_entitlements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete restrict,
  result_id     uuid not null references public.jagan_results(result_id) on delete restrict,
  product_key   text not null check (product_key = 'jagan_report_v1'),
  status        text not null check (status in ('active', 'refunded')),
  created_at    timestamptz not null default now(),
  unique (user_id, result_id, product_key)
);
revoke all on table public.jagan_entitlements from public, anon, authenticated, service_role;
grant select on table public.jagan_entitlements to authenticated;
grant select, insert, update on table public.jagan_entitlements to service_role;
alter table public.jagan_entitlements enable row level security;
create policy jagan_entitlements_select_own on public.jagan_entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

-- 4. 確認
do $$
begin
  if has_table_privilege('anon', 'public.jagan_results', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_results', 'INSERT')
     or has_table_privilege('authenticated', 'public.jagan_results', 'UPDATE')
     or has_table_privilege('anon', 'public.jagan_shares', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_shares', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_entitlements', 'INSERT')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jagan_shares') then
    raise exception 'unexpected privileges on jagan tables';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.jagan_results'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.jagan_shares'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.jagan_entitlements'::regclass) then
    raise exception 'rls is not enabled on jagan tables';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261107120000_jagan_02_orders_links_registrations.sql（Preview 判定・履歴行を除いたもの）
-- ------------------------------------------------------------
-- 1. 注文（1つの決済画面＝1つの注文。固有リンクの秘密値のハッシュを持つ）
create table public.jagan_orders (
  id                          uuid primary key default gen_random_uuid(),
  result_id                   uuid not null,
  item_set_version            text not null check (length(item_set_version) between 1 and 64),
  answers                     jsonb not null check (jsonb_typeof(answers) = 'object'),
  dti_code                    text not null check (dti_code ~ '^[A-Z]{4}$'),
  headline                    jsonb not null check (jsonb_typeof(headline) = 'object'),
  buyer_user_id               uuid references auth.users(id) on delete set null,
  product_key                 text not null check (product_key = 'jagan_report_v1'),
  amount                      integer not null check (amount = 1000),
  currency                    text not null check (currency = 'jpy'),
  stripe_mode                 text not null check (stripe_mode in ('test', 'live')),
  status                      text not null default 'created'
                                check (status in ('created', 'checkout_open', 'paid', 'expired', 'canceled', 'failed', 'refunded', 'disputed')),
  idempotency_key             text not null unique check (idempotency_key ~ '^jo_[0-9a-f]{40}$'),
  link_token_hash             text not null unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  link_status                 text not null default 'active' check (link_status in ('active', 'revoked')),
  stripe_checkout_session_id  text unique check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{8,200}$'),
  stripe_payment_intent_id    text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]{8,200}$'),
  failure_code                text check (failure_code is null or failure_code ~ '^[a-z_]{1,64}$'),
  created_at                  timestamptz not null default now(),
  paid_at                     timestamptz,
  updated_at                  timestamptz not null default now(),
  constraint jagan_orders_paid_state check ((status in ('paid', 'refunded', 'disputed')) = (paid_at is not null))
);
create index jagan_orders_result_idx on public.jagan_orders (result_id);
create index jagan_orders_buyer_idx on public.jagan_orders (buyer_user_id) where buyer_user_id is not null;
revoke all on table public.jagan_orders from public, anon, authenticated, service_role;
grant select on table public.jagan_orders to service_role;
alter table public.jagan_orders enable row level security;

-- 2. マイページへの登録（アカウント × 注文。登録先の記録 result_id は、そのアカウントの jagan_results の行）
create table public.jagan_order_registrations (
  user_id        uuid not null references auth.users(id) on delete cascade,
  order_id       uuid not null references public.jagan_orders(id) on delete restrict,
  result_id      uuid not null references public.jagan_results(result_id) on delete restrict,
  registered_at  timestamptz not null default now(),
  primary key (user_id, order_id)
);
create index jagan_order_registrations_order_idx on public.jagan_order_registrations (order_id);
revoke all on table public.jagan_order_registrations from public, anon, authenticated, service_role;
grant select on table public.jagan_order_registrations to service_role;
alter table public.jagan_order_registrations enable row level security;

-- 3. 権利（jagan_01 の表）に、根拠の注文を足す
alter table public.jagan_entitlements add column order_id uuid references public.jagan_orders(id) on delete restrict;

-- 4. 内部：ある利用者・記録の権利を、登録した注文の状態から作り直す（有効な注文が1つでもあれば active、なければ refunded）
create function public.jagan_refresh_entitlement(p_user_id uuid, p_result_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order uuid;
begin
  select r.order_id into v_order
    from public.jagan_order_registrations r join public.jagan_orders o on o.id = r.order_id
   where r.user_id = p_user_id and r.result_id = p_result_id and o.status = 'paid' and o.link_status = 'active'
   order by o.paid_at asc limit 1;
  if v_order is not null then
    insert into public.jagan_entitlements (user_id, result_id, product_key, status, order_id)
    values (p_user_id, p_result_id, 'jagan_report_v1', 'active', v_order)
    on conflict (user_id, result_id, product_key) do update set status = 'active', order_id = excluded.order_id;
  else
    update public.jagan_entitlements set status = 'refunded'
     where user_id = p_user_id and result_id = p_result_id and product_key = 'jagan_report_v1' and status <> 'refunded';
  end if;
end;
$$;

-- 5. 注文の作成（同じ購入操作の再送は同じ注文を返す）
create function public.jagan_create_order(
    p_result_id uuid, p_item_set_version text, p_answers jsonb, p_dti_code text, p_headline jsonb,
    p_buyer_user_id uuid, p_stripe_mode text, p_idempotency_key text, p_link_token_hash text)
  returns table (order_id uuid, order_status text, created boolean, checkout_session_id text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.jagan_orders%rowtype;
begin
  if p_result_id is null or p_idempotency_key is null or p_link_token_hash is null then
    raise exception 'jagan_invalid_request' using errcode = '22023';
  end if;
  select * into v from public.jagan_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v.result_id <> p_result_id or v.buyer_user_id is distinct from p_buyer_user_id then
      raise exception 'jagan_idempotency_conflict' using errcode = '23505';
    end if;
    return query select v.id, v.status, false, v.stripe_checkout_session_id;
    return;
  end if;
  insert into public.jagan_orders (result_id, item_set_version, answers, dti_code, headline, buyer_user_id, product_key, amount, currency,
                                   stripe_mode, idempotency_key, link_token_hash)
  values (p_result_id, p_item_set_version, p_answers, p_dti_code, p_headline, p_buyer_user_id, 'jagan_report_v1', 1000, 'jpy',
          p_stripe_mode, p_idempotency_key, p_link_token_hash)
  returning * into v;
  return query select v.id, v.status, true, v.stripe_checkout_session_id;
end;
$$;

-- 6. 決済画面を開いた記録（作成直後の注文だけ）
create function public.jagan_mark_checkout_open(p_order_id uuid, p_checkout_session_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.jagan_orders set status = 'checkout_open', stripe_checkout_session_id = p_checkout_session_id, updated_at = now()
   where id = p_order_id and status = 'created' and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_checkout_session_id);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    if exists (select 1 from public.jagan_orders o where o.id = p_order_id and o.status = 'checkout_open' and o.stripe_checkout_session_id = p_checkout_session_id) then
      return 'noop';
    end if;
    raise exception 'jagan_order_not_open' using errcode = '55000';
  end if;
  return 'opened';
end;
$$;

-- 7. 支払いの反映（Webhook・購入完了ページの問い合わせで共通。何度呼ばれても同じ結果）
create function public.jagan_apply_payment(
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text, p_livemode boolean)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.jagan_orders%rowtype;
  v_code text;
  v_owner uuid;
begin
  select * into v from public.jagan_orders o where o.id = p_order_id for update;
  if not found then
    return 'ignored:order_not_found';
  end if;
  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from (v.stripe_mode = 'live') then 'livemode_mismatch'
    when p_currency is distinct from v.currency then 'currency_mismatch'
    when p_amount_total is distinct from v.amount then 'amount_mismatch'
    when v.stripe_checkout_session_id is not null and v.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v.stripe_payment_intent_id is not null and v.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_code <> 'payment_not_paid' and v.status in ('created', 'checkout_open') then
      update public.jagan_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v.id;
    end if;
    return 'ignored:' || v_code;
  end if;
  if v.status in ('paid', 'refunded', 'disputed') then
    return 'noop';
  end if;
  if v.status = 'failed' then
    return 'ignored:order_failed';
  end if;
  -- 期限切れ・中止の後に支払われた決済も、支払い済みとして納品する（受け取ったお金に対して必ずレポートを渡す）
  update public.jagan_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null, updated_at = now()
   where id = v.id;
  -- ログインして自分の保存した結果から買った：その本人のマイページに登録する
  if v.buyer_user_id is not null then
    select r.user_id into v_owner from public.jagan_results r where r.result_id = v.result_id;
    if v_owner = v.buyer_user_id then
      insert into public.jagan_order_registrations (user_id, order_id, result_id) values (v.buyer_user_id, v.id, v.result_id)
      on conflict (user_id, order_id) do nothing;
      perform public.jagan_refresh_entitlement(v.buyer_user_id, v.result_id);
    end if;
  end if;
  return 'applied';
end;
$$;

-- 8. 決済画面が閉じた（期限切れ・中止・失敗）。支払い済みの注文は変えない
create function public.jagan_close_order(p_order_id uuid, p_status text, p_failure_code text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_status not in ('expired', 'canceled', 'failed') then
    raise exception 'jagan_invalid_request' using errcode = '22023';
  end if;
  update public.jagan_orders set status = p_status, failure_code = p_failure_code, updated_at = now()
   where id = p_order_id and status in ('created', 'checkout_open');
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'closed' else 'noop' end;
end;
$$;

-- 9. 返金・異議申し立て（refunded・disputed）と、異議申し立ての勝ち（paid に戻す）。登録した全員の権利を作り直す
create function public.jagan_apply_reversal(p_order_id uuid, p_kind text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.jagan_orders%rowtype;
  v_reg record;
  v_next text;
begin
  if p_kind not in ('refunded', 'disputed', 'dispute_won') then
    raise exception 'jagan_invalid_request' using errcode = '22023';
  end if;
  select * into v from public.jagan_orders o where o.id = p_order_id for update;
  if not found then
    return 'ignored:order_not_found';
  end if;
  if v.status not in ('paid', 'refunded', 'disputed') then
    return 'ignored:order_not_paid';
  end if;
  v_next := case
    when p_kind = 'refunded' then 'refunded'
    when p_kind = 'disputed' then case when v.status = 'refunded' then 'refunded' else 'disputed' end
    else case when v.status = 'disputed' then 'paid' else v.status end end;
  if v_next = v.status then
    return 'noop';
  end if;
  update public.jagan_orders set status = v_next, updated_at = now() where id = v.id;
  for v_reg in select r.user_id, r.result_id from public.jagan_order_registrations r where r.order_id = v.id loop
    perform public.jagan_refresh_entitlement(v_reg.user_id, v_reg.result_id);
  end loop;
  return 'applied';
end;
$$;

-- 10. マイページへの登録（固有リンクの秘密値のハッシュで。登録完了の利用者だけ。支払い済み・有効なリンクだけ）
--   記録：同じ結果 ID の行がこの利用者にあればそれを使う。無ければ、その結果 ID で作る（別の利用者が同じ ID を持っている時は
--   p_fallback_result_id で作る）。snapshot・見出し・版は、API が注文の回答から同じ版で計算した値。
create function public.jagan_register_order(
    p_user_id uuid, p_link_token_hash text, p_fallback_result_id uuid,
    p_schema_version text, p_engine_version text, p_scoring_version text, p_interpretation_version text,
    p_character_model_version text, p_naming_version text, p_snapshot jsonb)
  returns table (reg_result text, reg_result_id uuid)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.jagan_orders%rowtype;
  v_onboarding text;
  v_owner uuid;
  v_rid uuid;
  v_count integer;
begin
  if p_user_id is null or p_link_token_hash is null or p_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'jagan_invalid_request' using errcode = '22023';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'jagan_onboarding_required' using errcode = '42501';
  end if;
  select * into v from public.jagan_orders o where o.link_token_hash = p_link_token_hash;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v.status <> 'paid' or v.link_status <> 'active' then
    return query select 'inactive'::text, null::uuid;
    return;
  end if;
  -- すでに登録済み（同じアカウント・同じ注文）
  select r.result_id into v_rid from public.jagan_order_registrations r where r.user_id = p_user_id and r.order_id = v.id;
  if v_rid is not null then
    perform public.jagan_refresh_entitlement(p_user_id, v_rid);
    return query select 'already'::text, v_rid;
    return;
  end if;
  select r.user_id into v_owner from public.jagan_results r where r.result_id = v.result_id;
  if v_owner = p_user_id then
    v_rid := v.result_id;
  else
    v_rid := case when v_owner is null then v.result_id else p_fallback_result_id end;
    if v_rid is null then
      raise exception 'jagan_invalid_request' using errcode = '22023';
    end if;
    insert into public.jagan_results (result_id, user_id, schema_version, engine_version, item_set_version, scoring_version,
                                      interpretation_version, character_model_version, dti_code, naming_version, answers, snapshot, headline)
    values (v_rid, p_user_id, p_schema_version, p_engine_version, v.item_set_version, p_scoring_version,
            p_interpretation_version, p_character_model_version, v.dti_code, p_naming_version, v.answers, p_snapshot, v.headline);
  end if;
  insert into public.jagan_order_registrations (user_id, order_id, result_id) values (p_user_id, v.id, v_rid)
  on conflict (user_id, order_id) do nothing;
  get diagnostics v_count = row_count;
  perform public.jagan_refresh_entitlement(p_user_id, v_rid);
  return query select case when v_count > 0 then 'registered' else 'already' end, v_rid;
end;
$$;

-- 11. 関数の権限：サーバー（service_role）だけ
revoke all on function public.jagan_refresh_entitlement(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.jagan_mark_checkout_open(uuid, text) from public, anon, authenticated;
revoke all on function public.jagan_apply_payment(uuid, text, text, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.jagan_close_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.jagan_apply_reversal(uuid, text) from public, anon, authenticated;
revoke all on function public.jagan_register_order(uuid, text, uuid, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text) to service_role;
grant execute on function public.jagan_mark_checkout_open(uuid, text) to service_role;
grant execute on function public.jagan_apply_payment(uuid, text, text, integer, text, text, boolean) to service_role;
grant execute on function public.jagan_close_order(uuid, text, text) to service_role;
grant execute on function public.jagan_apply_reversal(uuid, text) to service_role;
grant execute on function public.jagan_register_order(uuid, text, uuid, text, text, text, text, text, text, jsonb) to service_role;
-- 内部の関数を呼ぶ関数は security invoker のため、service_role が中で呼べるよう内部関数にも実行権限を与える
grant execute on function public.jagan_refresh_entitlement(uuid, uuid) to service_role;

-- 12. 表の書き込みは関数の中だけで行う。security invoker のため、service_role には関数が使う書き込みの権限を与える
grant insert, update on table public.jagan_orders to service_role;
grant insert on table public.jagan_order_registrations to service_role;
grant insert on table public.jagan_results to service_role;
grant update on table public.jagan_entitlements to service_role;

-- 13. 確認（ブラウザのロールに権限が無い・RLS が有効）
do $$
begin
  if has_table_privilege('anon', 'public.jagan_orders', 'SELECT') or has_table_privilege('authenticated', 'public.jagan_orders', 'SELECT')
     or has_table_privilege('anon', 'public.jagan_order_registrations', 'SELECT') or has_table_privilege('authenticated', 'public.jagan_order_registrations', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_entitlements', 'INSERT') or has_table_privilege('authenticated', 'public.jagan_entitlements', 'UPDATE')
     or has_function_privilege('anon', 'public.jagan_register_order(uuid, text, uuid, text, text, text, text, text, text, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.jagan_apply_payment(uuid, text, text, integer, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.jagan_refresh_entitlement(uuid, uuid)', 'EXECUTE') then
    raise exception 'unexpected privileges on jagan_02 objects';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.jagan_orders'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.jagan_order_registrations'::regclass) then
    raise exception 'rls is not enabled on jagan_02 tables';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261110120000_jagan_03_complete_product.sql（Preview 判定・履歴行を除いたもの）
-- ------------------------------------------------------------
-- 1. 商品と金額
alter table public.jagan_orders drop constraint jagan_orders_product_key_check;
alter table public.jagan_orders drop constraint jagan_orders_amount_check;
alter table public.jagan_orders add constraint jagan_orders_product_amount_check
  check ((product_key = 'jagan_report_v1' and amount = 1000) or (product_key = 'jagan_complete_v1' and amount = 3000));
alter table public.jagan_entitlements drop constraint jagan_entitlements_product_key_check;
alter table public.jagan_entitlements add constraint jagan_entitlements_product_key_check
  check (product_key in ('jagan_report_v1', 'jagan_complete_v1'));

-- 2. 権利の作り直し（商品ごと）
create or replace function public.jagan_refresh_entitlement(p_user_id uuid, p_result_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_product text;
  v_order uuid;
begin
  foreach v_product in array array['jagan_report_v1', 'jagan_complete_v1'] loop
    select r.order_id into v_order
      from public.jagan_order_registrations r join public.jagan_orders o on o.id = r.order_id
     where r.user_id = p_user_id and r.result_id = p_result_id and o.product_key = v_product
       and o.status = 'paid' and o.link_status = 'active'
     order by o.paid_at asc limit 1;
    if v_order is not null then
      insert into public.jagan_entitlements (user_id, result_id, product_key, status, order_id)
      values (p_user_id, p_result_id, v_product, 'active', v_order)
      on conflict (user_id, result_id, product_key) do update set status = 'active', order_id = excluded.order_id;
    else
      update public.jagan_entitlements set status = 'refunded'
       where user_id = p_user_id and result_id = p_result_id and product_key = v_product and status <> 'refunded';
    end if;
  end loop;
end;
$$;

-- 3. 注文の作成（商品つき）。旧い署名は削除する（API は同じ変更で新しい署名を使う）
drop function public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text);
create function public.jagan_create_order(
    p_result_id uuid, p_item_set_version text, p_answers jsonb, p_dti_code text, p_headline jsonb,
    p_buyer_user_id uuid, p_stripe_mode text, p_idempotency_key text, p_link_token_hash text, p_product_key text)
  returns table (order_id uuid, order_status text, created boolean, checkout_session_id text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.jagan_orders%rowtype;
  v_amount integer;
begin
  if p_result_id is null or p_idempotency_key is null or p_link_token_hash is null then
    raise exception 'jagan_invalid_request' using errcode = '22023';
  end if;
  v_amount := case p_product_key when 'jagan_report_v1' then 1000 when 'jagan_complete_v1' then 3000 end;
  if v_amount is null then
    raise exception 'jagan_invalid_request' using errcode = '22023';
  end if;
  select * into v from public.jagan_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v.result_id <> p_result_id or v.buyer_user_id is distinct from p_buyer_user_id or v.product_key <> p_product_key then
      raise exception 'jagan_idempotency_conflict' using errcode = '23505';
    end if;
    return query select v.id, v.status, false, v.stripe_checkout_session_id;
    return;
  end if;
  insert into public.jagan_orders (result_id, item_set_version, answers, dti_code, headline, buyer_user_id, product_key, amount, currency,
                                   stripe_mode, idempotency_key, link_token_hash)
  values (p_result_id, p_item_set_version, p_answers, p_dti_code, p_headline, p_buyer_user_id, p_product_key, v_amount, 'jpy',
          p_stripe_mode, p_idempotency_key, p_link_token_hash)
  returning * into v;
  return query select v.id, v.status, true, v.stripe_checkout_session_id;
end;
$$;
revoke all on function public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text, text) to service_role;
revoke all on function public.jagan_refresh_entitlement(uuid, uuid) from public, anon, authenticated;

-- 4. 確認（ブラウザのロールに実行権限がない）
do $$
begin
  if has_function_privilege('anon', 'public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.jagan_create_order(uuid, text, jsonb, text, jsonb, uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.jagan_refresh_entitlement(uuid, uuid)', 'EXECUTE') then
    raise exception 'unexpected privileges';
  end if;
end
$$;

-- 本番だけ：注文は Stripe Live だけ
alter table public.jagan_orders add constraint jagan_orders_live_only check (stripe_mode = 'live');

do $post6$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any(array['jagan_results', 'jagan_shares', 'jagan_entitlements', 'jagan_orders', 'jagan_order_registrations'])) <> 5 then
    raise exception 'jagan tables are not all present';
  end if;
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'jagan\_%' and not relrowsecurity) then
    raise exception 'row level security is off on a jagan table';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jagan\_%'
              and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception 'browser roles can execute a jagan function';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'jagan\_%'
              and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))) then
    raise exception 'anon can access a jagan table';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'jagan\_%' and c.relname not in ('jagan_results', 'jagan_entitlements')
              and has_table_privilege('authenticated', c.oid, 'SELECT')) then
    raise exception 'authenticated can read a jagan table other than jagan_results / jagan_entitlements (own rows by RLS)';
  end if;
end
$post6$;

-- 台帳：段階 6 を記録できるようにする（prod_01 で作った台帳の段階の範囲は 1〜5）
alter table element_release.migration_ledger drop constraint migration_ledger_stage_check;
alter table element_release.migration_ledger add constraint migration_ledger_stage_check check (stage between 1 and 6);
comment on schema element_release is '元素診断 本番 migration の台帳（1=prod_01・2=prod_02・3=prod_03・4=prod_04a・5=prod_04b・6=prod_06 邪眼診断）。アプリ・API からは使わない';
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
insert into element_release.migration_ledger (stage, name) values (6, 'prod_06_jagan');

notify pgrst, 'reload schema';

commit;
