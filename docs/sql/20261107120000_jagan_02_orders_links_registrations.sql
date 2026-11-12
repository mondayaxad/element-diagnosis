-- ============================================================
-- jagan_02：邪眼解析レポート（¥1,000・買い切り）の注文・レポート固有リンク・マイページへの登録・権利
-- 2026-11-07。Preview（element-diagnosis-preview）専用。
-- 【SQL Editor で実行する】実行順：jagan_02_00_preflight_READONLY.sql → この SQL → jagan_02_99_postcheck_READONLY.sql。
-- 【既存の表は上書き・削除しない】この版の表・関数・履歴のどれかが既にあれば、何も変更せずにエラーで止まる（1つのトランザクション）。
-- 【本番では実行しない】
-- 既存の表（ETI の complete_orders・report_deliveries・purchase_entitlements など）は読まない・書き換えない・消さない。
-- 変更する既存の表は jagan_entitlements（jagan_01）だけ：列 order_id を足す（既存の行は null のまま）。
-- ============================================================
--
-- 方針（ETI の complete_13 と同じ考え方）
--   ・購入はログイン不要。買う対象は「どの邪眼の結果（回答）か」。注文に、サーバーが検査した回答・DTI コード・見出しを固定する。
--     レポートの本文は、固定した回答から同じ版の計算で作る（注文の後に内容が変わらない）。
--   ・注文ごとに、期限なしのレポート固有リンクの秘密値（256bit）を作る。DB にはハッシュ（SHA-256）だけ。
--   ・支払いの反映（Webhook・購入完了ページの問い合わせ）は同じ関数 jagan_apply_payment。金額・通貨・決済の状態・Stripe の環境を照合する。
--     何度呼ばれても同じ結果（paid の後は noop）。返金・異議申し立ては jagan_apply_reversal。
--   ・マイページへの登録：固有リンクの秘密値を知っている人が、ログインして明示的に行う（購入の移転ではない。別のアカウントにも登録できる）。
--     登録すると、そのアカウントに邪眼の記録（jagan_results）と権利（jagan_entitlements・active）を作る。
--     ログインして自分の保存した結果から買った場合は、支払いの反映の時に、その本人に自動で登録する。
--   ・権利は「登録した注文のうち、支払い済み（paid）で固有リンクが有効なもの」がある時だけ active。返金・異議申し立てで止まる。
--   ・すべての表は RLS を有効にし、ブラウザのロール（anon・authenticated）には権限を与えない（サーバーの service_role だけ）。
--     ただし jagan_entitlements は jagan_01 のまま、本人が自分の行を SELECT できる（マイページの INSIGHT の表示）。

begin;

-- 0. 前提と、二重適用の防止
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261102120000') then
    raise exception 'jagan_01 (20261102120000) is not applied';
  end if;
  if to_regclass('public.jagan_results') is null or to_regclass('public.jagan_entitlements') is null or to_regclass('public.profiles') is null then
    raise exception 'required tables are missing';
  end if;
  if to_regclass('public.jagan_orders') is not null or to_regclass('public.jagan_order_registrations') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jagan_entitlements' and column_name = 'order_id')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'jagan\_%') then
    raise exception 'jagan_02 objects already exist: stop and inspect (nothing was changed)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261107120000') then
    raise exception 'migration 20261107120000 is already recorded: stop and inspect (nothing was changed)';
  end if;
end
$$;

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20261107120000', 'jagan_02_orders_links_registrations');

commit;
