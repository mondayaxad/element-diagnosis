-- ============================================================
-- jagan_03：邪眼完全解析レポート「DIPPER」（¥3,000・買い切り）を、解析レポート（¥1,000）と並べて販売できるようにする
-- 2026-11-10。Preview（element-diagnosis-preview）専用。【本番では実行しない】
-- 変更：
--   ・jagan_orders：商品は jagan_report_v1（1,000円）か jagan_complete_v1（3,000円）。金額は商品で決まる。
--   ・jagan_entitlements：権利の商品に jagan_complete_v1 を足す。
--   ・jagan_create_order：商品（p_product_key）を受け取る。金額は DB が商品から決める。同じ冪等キーで商品が違えば拒否。
--   ・jagan_refresh_entitlement：商品ごとに、有効な注文から権利を作り直す（呼び出し側の関数は変えない）。
-- 既存の注文・権利の行は変えない（すべて jagan_report_v1 のまま）。
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261107120000') then
    raise exception 'jagan_02 (20261107120000) is not applied';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110120000') then
    raise exception 'jagan_03 is already recorded: stop and inspect (nothing was changed)';
  end if;
end
$$;

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

insert into supabase_migrations.schema_migrations (version, name)
values ('20261110120000', 'jagan_03_complete_product');

commit;
