-- ============================================================
-- complete_95：complete_11（20261014180000_complete_11_refund_rebuy_double_purchase）の戻し【実行禁止・草案】2026-10-14。Preview 専用。
-- 使う時：complete_11 を当てた後に、アプリを complete_11 より前の commit へ戻す時だけ（先にアプリを戻してから実行する）。
-- 戻すもの：関数7つ（complete_10・08・07・04 の本文）・目標の固定を外す関数の削除・生成物の重複防止の索引（失効も数える元の索引）。
--   返金の後に買い直した生成物（失効の行と同じ材料の行）があると、元の索引を作れずに全体が取り消される
--   （その時は件数を控えて運営者が判断する。この SQL では行を消さない）。
-- 読み取りの確認：select count(*) from public.complete_reports group by diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256 having count(*) > 1;
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
    when p_livemode is distinct from false or v_order.stripe_mode <> 'test' then 'livemode_mismatch'
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

drop function if exists public.complete_release_mentor_goal_lock(uuid, uuid);

drop index if exists public.complete_reports_same_version_uq;
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256);

delete from supabase_migrations.schema_migrations where version = '20261014180000';

commit;
