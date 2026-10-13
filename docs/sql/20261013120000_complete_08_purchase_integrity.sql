-- ============================================================
-- complete_08：購入・権利・閲覧の整合（リリース前監査 C1〜C9・D1〜D6 の DB 側）
-- 2026-10-13。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】本文に制約の削除・追加を含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴（supabase_migrations.schema_migrations）へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイル（Stripe Live・Preview の確認なし）で行う。
-- 前提：complete_01〜07 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない（関数・トリガー関数の置き換えと、新しい表・列・関数の追加だけ）。
-- 戻し：本文の各節の「戻し」を参照（置き換えた関数は complete_07 の本文を再実行すると元に戻る）。
-- ============================================================
--
-- §1 同じ診断結果の二重購入の防止（D1）
--   ・同じ本人（user_id）・同じ不変の診断結果（診断コードのハッシュ。旧購入権の参照値と同じ規則）の記録を「結果グループ」とし、
--     グループのどれかで購入済みなら、別の記録で同じ物を作らない（注文の作成・注文のトリガー・期限切れ後の支払いの3か所）。
--   ・ゲスト（user_id NULL）の記録はグループを作らない（診断コードの文字列だけで別の人の権利を共有しない）。
--   ・ロックの順：結果グループ（complete_result:<user>:<鍵>）→ 記録（complete_order:<記録>）→ 行。
--     注文の作成と引き継ぎ（complete_transfer_guest_record）が同じ順で取る。
--   ・API（lib/purchase-state.js）も同じ規則で offer を決める。ここは最終の防御。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜07 の適用済みを確かめる
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  if to_regprocedure('public.complete_claim_guest_record(uuid, uuid, text)') is null
     or to_regprocedure('public.complete_create_order_internal(uuid, uuid, text, text, text)') is null
     or to_regprocedure('public.complete_report_for_view(uuid, uuid)') is null then
    raise exception 'complete_01..07 are not applied';
  end if;
end
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
                        where b.diagnosis_session_id = g.diagnosis_session_id and b.user_id = p_user_id and pe.status = 'active')))
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
                        where b.diagnosis_session_id = g.diagnosis_session_id and b.user_id = p_user_id and pe.status = 'active')))
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

-- 支払い確定（complete_07 の本文に、期限切れ後の支払いの確認を結果グループへ広げたもの）
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
      'public.complete_transfer_guest_record(uuid, uuid, text)'] loop
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
end
$$;

-- migration 履歴（SQL Editor で実行するため、ここで1行だけ追加する。二度当てしても増えない）
insert into supabase_migrations.schema_migrations (version, name)
values ('20261013120000', 'complete_08_purchase_integrity')
on conflict (version) do nothing;

commit;
