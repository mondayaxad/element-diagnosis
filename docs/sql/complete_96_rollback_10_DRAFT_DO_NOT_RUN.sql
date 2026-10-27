-- ============================================================
-- complete_96：complete_10（20261014120000_complete_10_entitlement_owner_isolation）の戻し【実行禁止・草案】2026-10-14。Preview 専用。未適用。
-- 使う時：complete_10 を当てた後に、アプリを complete_10 より前の commit へ戻す時だけ。
-- 戻すもの：complete_result_group_has・complete_create_order_internal を complete_08 の本文へ戻し、
--           complete_analysis_active_for_code_hash の service_role の実行権限を戻す。
-- 注意：戻すと、診断コードのハッシュが一致する旧 Payment Link の購入が、別人の新 Checkout（¥1,000・¥3,000）を再び止める。
-- 既存の行は書き換えない（関数と権限だけ）。
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
end
$$;

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
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'test', null, p_idempotency_key,
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
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'test', v_basis, p_idempotency_key,
            v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  end if;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

revoke all on function public.complete_result_group_has(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_result_group_has(uuid, uuid, text) to service_role;
revoke all on function public.complete_create_order_internal(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_order_internal(uuid, uuid, text, text, text) to service_role;
revoke all on function public.complete_analysis_active_for_code_hash(text) from public, anon, authenticated;
grant execute on function public.complete_analysis_active_for_code_hash(text) to service_role;

delete from supabase_migrations.schema_migrations where version = '20261014120000';

commit;
