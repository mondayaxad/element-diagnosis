-- ============================================================
-- prod_07：元素診断のタイプ別レポート（¥1,000・買い切り）の注文と、レポート固有リンク
-- 【本番（element-diagnosis-test / akivoob）専用】SQL Editor で、このファイル全体を1回だけ実行する。
-- 【Preview・その他では実行しない】冒頭の確認で、本番の基準と違えば何も変えずに止まる。
-- 生成元：docs/sql/production/build_production_sql.py（Preview migration から機械的に組み立て。手で編集しない）
-- 前提：prod_06 まで適用済み（element_release.migration_ledger に stage 1〜6）。タイプ別レポートの新コードを Production に出す直前に適用する
-- 戻し：docs/sql/production/prod_97_rollback_07_DRAFT_DO_NOT_RUN.sql（DRAFT_DO_NOT_RUN）
-- 二度目の実行：冒頭で stage_already_applied として止まる（何も変更しない）。
-- 旧購入者保護（S0）：purchase_entitlements・旧購入・既存6表の既存列・主要3関数・既存 RLS／policy／権限は変更しない。
-- ============================================================
--
-- 内容（Preview の type_report_01 と同じ。Preview で適用・決済から閲覧まで検証済み）
--   ・type_report_orders（注文。商品は eti_type_report_v1 ¥1,000。タイプコードと標準の回答の符号・固有リンクの秘密値のハッシュを持つ）
--   ・関数 type_report_*（注文の作成・決済画面・支払いの反映・注文を閉じる・返金／異議申し立て）。service_role だけが実行できる
--   ・RLS 有効。ブラウザのロール（anon・authenticated）には権限なし
-- 本番だけの置き換え
--   ・Preview 判定と migration 履歴（supabase_migrations）の行は除き、台帳 element_release.migration_ledger に stage 7 を記録
--   ・注文は Stripe Live だけ（type_report_orders.stripe_mode = 'live' の制約を足す）
-- 既存の表・関数・権限（既存6表・purchase_entitlements・complete_*・jagan_* など）には触れない

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
  -- 段階の順序：prod_06 まで適用済みで、prod_07 は未適用
  if to_regclass('element_release.migration_ledger') is null then
    raise exception 'prod_01 is not applied (ledger missing)';
  end if;
  if exists (select 1 from element_release.migration_ledger where stage = 7) then
    raise exception 'stage_already_applied: prod_07 は適用済みです（何も変更していません）';
  end if;
  if (select array_agg(stage order by stage) from element_release.migration_ledger) is distinct from array[1, 2, 3, 4, 5, 6] then
    raise exception 'ledger does not show the previous stages in order';
  end if;
end
$guard$;

do $pre7$
begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'type\_report\_%')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'type\_report\_%') then
    raise exception 'type_report objects already exist before prod_07 (partial or foreign state)';
  end if;
end
$pre7$;

-- ------------------------------------------------------------
-- 由来：docs/sql/20261125120000_type_report_01_orders.sql（Preview 判定・履歴行を除いたもの）
-- ------------------------------------------------------------
-- 1. 注文（1つの決済画面＝1つの注文。固有リンクの秘密値のハッシュを持つ）
create table public.type_report_orders (
  id                          uuid primary key default gen_random_uuid(),
  type_code                   text not null check (type_code ~ '^(PY|HY|CR|EL|AN|GE|DE)(SW|CM|PL|CT|BW)$'),
  diagnosis_version           text not null check (diagnosis_version = 'ETI-2.0'),
  item_set_version            text not null check (length(item_set_version) between 1 and 64),
  diagnosis_code              text not null check (diagnosis_code ~ '^[A-Za-z0-9_-]{8,200}$'),
  product_key                 text not null check (product_key = 'eti_type_report_v1'),
  amount                      integer not null check (amount = 1000),
  currency                    text not null check (currency = 'jpy'),
  stripe_mode                 text not null check (stripe_mode in ('test', 'live')),
  status                      text not null default 'created'
                                check (status in ('created', 'checkout_open', 'paid', 'expired', 'canceled', 'failed', 'refunded', 'disputed')),
  idempotency_key             text not null unique check (idempotency_key ~ '^to_[0-9a-f]{40}$'),
  link_token_hash             text not null unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  link_status                 text not null default 'active' check (link_status in ('active', 'revoked')),
  stripe_checkout_session_id  text unique check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{8,200}$'),
  stripe_payment_intent_id    text check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]{8,200}$'),
  failure_code                text check (failure_code is null or failure_code ~ '^[a-z_]{1,64}$'),
  created_at                  timestamptz not null default now(),
  paid_at                     timestamptz,
  updated_at                  timestamptz not null default now(),
  constraint type_report_orders_paid_state check ((status in ('paid', 'refunded', 'disputed')) = (paid_at is not null))
);
create index type_report_orders_type_created_idx on public.type_report_orders (type_code, created_at);
revoke all on table public.type_report_orders from public, anon, authenticated, service_role;
grant select on table public.type_report_orders to service_role;
alter table public.type_report_orders enable row level security;

-- 2. 注文の作成（同じ購入操作の再送は同じ注文を返す）
create function public.type_report_create_order(
    p_type_code text, p_item_set_version text, p_diagnosis_code text, p_stripe_mode text, p_idempotency_key text, p_link_token_hash text)
  returns table (order_id uuid, order_status text, created boolean, checkout_session_id text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.type_report_orders%rowtype;
begin
  if p_type_code is null or p_diagnosis_code is null or p_idempotency_key is null or p_link_token_hash is null then
    raise exception 'type_report_invalid_request' using errcode = '22023';
  end if;
  select * into v from public.type_report_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v.type_code <> p_type_code then
      raise exception 'type_report_idempotency_conflict' using errcode = '23505';
    end if;
    return query select v.id, v.status, false, v.stripe_checkout_session_id;
    return;
  end if;
  insert into public.type_report_orders (type_code, diagnosis_version, item_set_version, diagnosis_code, product_key, amount, currency,
                                         stripe_mode, idempotency_key, link_token_hash)
  values (p_type_code, 'ETI-2.0', p_item_set_version, p_diagnosis_code, 'eti_type_report_v1', 1000, 'jpy',
          p_stripe_mode, p_idempotency_key, p_link_token_hash)
  returning * into v;
  return query select v.id, v.status, true, v.stripe_checkout_session_id;
end;
$$;

-- 3. 決済画面を開いた記録（作成直後の注文だけ）
create function public.type_report_mark_checkout_open(p_order_id uuid, p_checkout_session_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.type_report_orders set status = 'checkout_open', stripe_checkout_session_id = p_checkout_session_id, updated_at = now()
   where id = p_order_id and status = 'created' and (stripe_checkout_session_id is null or stripe_checkout_session_id = p_checkout_session_id);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    if exists (select 1 from public.type_report_orders o where o.id = p_order_id and o.status = 'checkout_open' and o.stripe_checkout_session_id = p_checkout_session_id) then
      return 'noop';
    end if;
    raise exception 'type_report_order_not_open' using errcode = '55000';
  end if;
  return 'opened';
end;
$$;

-- 4. 支払いの反映（Webhook・固有リンクの問い合わせで共通。何度呼ばれても同じ結果）
create function public.type_report_apply_payment(
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text, p_livemode boolean)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.type_report_orders%rowtype;
  v_code text;
begin
  select * into v from public.type_report_orders o where o.id = p_order_id for update;
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
      update public.type_report_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v.id;
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
  update public.type_report_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null, updated_at = now()
   where id = v.id;
  return 'applied';
end;
$$;

-- 5. 決済画面が閉じた（期限切れ・中止・失敗）。支払い済みの注文は変えない
create function public.type_report_close_order(p_order_id uuid, p_status text, p_failure_code text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_status not in ('expired', 'canceled', 'failed') then
    raise exception 'type_report_invalid_request' using errcode = '22023';
  end if;
  update public.type_report_orders set status = p_status, failure_code = p_failure_code, updated_at = now()
   where id = p_order_id and status in ('created', 'checkout_open');
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'closed' else 'noop' end;
end;
$$;

-- 6. 返金・異議申し立て（refunded・disputed）と、異議申し立ての勝ち（paid に戻す）
create function public.type_report_apply_reversal(p_order_id uuid, p_kind text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v public.type_report_orders%rowtype;
  v_next text;
begin
  if p_kind not in ('refunded', 'disputed', 'dispute_won') then
    raise exception 'type_report_invalid_request' using errcode = '22023';
  end if;
  select * into v from public.type_report_orders o where o.id = p_order_id for update;
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
  update public.type_report_orders set status = v_next, updated_at = now() where id = v.id;
  return 'applied';
end;
$$;

-- 7. 関数の実行権限：サーバー（service_role）だけ
revoke all on function public.type_report_create_order(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.type_report_mark_checkout_open(uuid, text) from public, anon, authenticated;
revoke all on function public.type_report_apply_payment(uuid, text, text, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.type_report_close_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.type_report_apply_reversal(uuid, text) from public, anon, authenticated;
grant execute on function public.type_report_create_order(text, text, text, text, text, text) to service_role;
grant execute on function public.type_report_mark_checkout_open(uuid, text) to service_role;
grant execute on function public.type_report_apply_payment(uuid, text, text, integer, text, text, boolean) to service_role;
grant execute on function public.type_report_close_order(uuid, text, text) to service_role;
grant execute on function public.type_report_apply_reversal(uuid, text) to service_role;

-- 8. 表の書き込みは関数の中だけで行う。security invoker のため、service_role には関数が使う書き込みの権限を与える
grant insert, update on table public.type_report_orders to service_role;

-- 9. 確認（ブラウザのロールに権限が無い・RLS が有効）
do $$
begin
  if has_table_privilege('anon', 'public.type_report_orders', 'SELECT') or has_table_privilege('authenticated', 'public.type_report_orders', 'SELECT')
     or has_table_privilege('authenticated', 'public.type_report_orders', 'INSERT')
     or has_function_privilege('anon', 'public.type_report_apply_payment(uuid, text, text, integer, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.type_report_create_order(text, text, text, text, text, text)', 'EXECUTE') then
    raise exception 'unexpected privileges on type_report_01 objects';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.type_report_orders'::regclass) then
    raise exception 'rls is not enabled on type_report_orders';
  end if;
end
$$;

-- 本番だけ：注文は Stripe Live だけ
alter table public.type_report_orders add constraint type_report_orders_live_only check (stripe_mode = 'live');

do $post7$
begin
  if to_regclass('public.type_report_orders') is null then
    raise exception 'type_report_orders is missing';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = any(array['type_report_create_order', 'type_report_mark_checkout_open', 'type_report_apply_payment', 'type_report_close_order', 'type_report_apply_reversal'])) <> 5 then
    raise exception 'type_report functions are not all present';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.type_report_orders'::regclass) then
    raise exception 'row level security is off on type_report_orders';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'type\_report\_%'
              and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception 'browser roles can execute a type_report function';
  end if;
  if has_table_privilege('anon', 'public.type_report_orders', 'SELECT') or has_table_privilege('anon', 'public.type_report_orders', 'INSERT')
     or has_table_privilege('anon', 'public.type_report_orders', 'UPDATE') or has_table_privilege('anon', 'public.type_report_orders', 'DELETE')
     or has_table_privilege('authenticated', 'public.type_report_orders', 'SELECT') or has_table_privilege('authenticated', 'public.type_report_orders', 'INSERT')
     or has_table_privilege('authenticated', 'public.type_report_orders', 'UPDATE') or has_table_privilege('authenticated', 'public.type_report_orders', 'DELETE') then
    raise exception 'browser roles can access type_report_orders';
  end if;
end
$post7$;

-- 台帳：段階 7 を記録できるようにする（prod_06 までの台帳の段階の範囲は 1〜6）
alter table element_release.migration_ledger drop constraint migration_ledger_stage_check;
alter table element_release.migration_ledger add constraint migration_ledger_stage_check check (stage between 1 and 7);
comment on schema element_release is '元素診断 本番 migration の台帳（1=prod_01・2=prod_02・3=prod_03・4=prod_04a・5=prod_04b・6=prod_06 邪眼診断・7=prod_07 タイプ別レポート）。アプリ・API からは使わない';
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
insert into element_release.migration_ledger (stage, name) values (7, 'prod_07_type_report');

notify pgrst, 'reload schema';

commit;
