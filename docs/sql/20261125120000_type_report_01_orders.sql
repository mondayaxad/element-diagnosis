-- ============================================================
-- type_report_01：元素診断のタイプ別レポート（¥1,000・買い切り・35タイプ共通の読み物）の注文と、レポート固有リンク
-- 2026-11-25。Preview（element-diagnosis-preview）専用。
-- 【SQL Editor で実行する】1つのトランザクション。この版の表・関数・履歴のどれかが既にあれば、何も変更せずにエラーで止まる。
-- 【本番では実行しない】（本番は、Preview で決済から閲覧まで確かめた後、本番用の版を別に用意する）
-- 既存の表（complete_orders・report_deliveries・jagan_orders など）は読まない・書き換えない・消さない。
-- ============================================================
--
-- 方針（邪眼診断の jagan_02 と同じ考え方）
--   ・購入はログイン不要。買う対象は「どのタイプ（元素×武器種。例：PYSW）か」。注文に、サーバーが決めた標準の回答の符号
--     （lib/type-standard-answers.json。元素・武器種の設計値と代表国家の設計値から作った回答）を固定する。
--     レポートの本文は、固定した符号から既存の解析レポートと同じ計算で作る（注文の後に内容が変わらない）。
--   ・注文ごとに、期限なしのレポート固有リンクの秘密値（256bit）を作る。DB にはハッシュ（SHA-256）だけ。
--   ・支払いの反映（Webhook・固有リンクを開いた時の問い合わせ）は同じ関数 type_report_apply_payment。
--     金額・通貨・決済の状態・Stripe の環境を照合する。何度呼ばれても同じ結果（paid の後は noop）。返金・異議申し立ては type_report_apply_reversal。
--   ・表は RLS を有効にし、ブラウザのロール（anon・authenticated）には権限を与えない（サーバーの service_role だけ）。

begin;

-- 0. 前提と、二重適用の防止
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if to_regclass('public.type_report_orders') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'type\_report\_%') then
    raise exception 'type_report_01 objects already exist: stop and inspect (nothing was changed)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125120000') then
    raise exception 'migration 20261125120000 is already recorded: stop and inspect (nothing was changed)';
  end if;
end
$$;

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20261125120000', 'type_report_01_orders');

commit;
