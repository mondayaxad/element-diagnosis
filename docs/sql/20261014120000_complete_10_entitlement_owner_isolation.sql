-- ============================================================
-- complete_10：購入権の所有者の分離（同じ診断結果の別人・旧 Payment Link を新 Checkout の判断から外す）
-- 2026-10-14。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】関数の置き換えと権限の変更を含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴（supabase_migrations.schema_migrations）へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイルで行う。
-- 前提：complete_01〜09 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない（関数2つの置き換えと、診断コードのハッシュだけで判定する関数の実行権限の取り消しだけ）。
-- 戻し：complete_96_rollback_10_DRAFT_DO_NOT_RUN.sql（実行禁止の草案）。
-- ============================================================
--
-- 方針
--   ・診断コード・encoded_answers・result_key・そのハッシュは所有者を示さない。完全に同じ回答の別人がいる。
--   ・結果グループは「同じ user_id ＋ 同じ result_key」だけ（complete_result_group は変えない）。ゲストはグループを作らない。
--   ・旧 Payment Link（purchase_entitlements・complete_legacy_bindings）は、新 Checkout の購入済みの判定・再購入の禁止・
--     追加 ¥2,000 の根拠・¥3,000 の禁止に使わない：
--       complete_create_order_internal から、診断コードのハッシュの一致（v_has_legacy_purchase）と旧購入の結び付け
--       （v_has_legacy_binding）による判断を外す。追加 ¥2,000 の根拠は、この記録の有効な新 Checkout の解析権だけ。
--       complete_result_group_has から、旧購入の結び付けを外す（同じ本人の新 Checkout の購入・権利だけを数える）。
--       complete_analysis_active_for_code_hash（診断コードのハッシュだけで解析権の有無を返す）の実行権限を API のロールから外す。
--   ・旧購入の閲覧（report-data の署名済みリンク・verify）と、既に結び付けた旧購入の ¥2,000 の閲覧（complete_report_for_view）は変えない。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜09 の適用済みを確かめる
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
  if to_regprocedure('public.complete_result_group_has(uuid, uuid, text)') is null
     or to_regprocedure('public.complete_create_order_internal(uuid, uuid, text, text, text)') is null
     or to_regclass('public.legacy_access_blocks') is null
     or to_regclass('public.result_resume_links') is null
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261013180000') then
    raise exception 'complete_01..09 are not applied';
  end if;
end
$$;

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

-- migration 履歴（SQL Editor で実行するため、ここで1行だけ追加する。二度当てしても増えない）
insert into supabase_migrations.schema_migrations (version, name)
values ('20261014120000', 'complete_10_entitlement_owner_isolation')
on conflict (version) do nothing;

commit;
