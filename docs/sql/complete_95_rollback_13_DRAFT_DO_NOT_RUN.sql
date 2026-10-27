-- ============================================================
-- 【実行禁止の草案】complete_13 の戻し（2026-10-20）。Preview 専用。
-- 新しい購入（buyer = 'link'）・納品・登録が1件でもあれば止める（その購入の記録を消さないため。戻せるのは使う前だけ）。
-- 戻す内容：
--   ・complete_orders_no_repurchase を complete_11、complete_orders_require_eligibility を complete_07、
--     complete_report_for_view・complete_regenerate_report を complete_08 の定義へ戻す
--   ・complete_orders の制約（buyer・buyer_consistency）と一意索引、complete_reports の一意索引を complete_12 の時点の形へ戻す
--   ・complete_13 で足した関数・表（report_deliveries・account_report_registrations。空であることを確かめてから）・列（via_link）を外す
--   ・migration 履歴の complete_13 の1行を外す
-- 既存の注文・記録・権利・生成物の行は変えない。
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if exists (select 1 from public.complete_orders where buyer = 'link')
     or exists (select 1 from public.report_deliveries)
     or exists (select 1 from public.account_report_registrations)
     or exists (select 1 from public.complete_reports where via_link) then
    raise exception 'complete_13 is in use: link orders, deliveries or registrations exist';
  end if;
end
$$;

drop function if exists public.complete_admin_reissue_delivery(uuid, text);
drop function if exists public.complete_admin_revoke_delivery(uuid, text);
drop function if exists public.complete_regenerate_link_report(uuid);
drop function if exists public.complete_register_delivery(uuid, text);
drop function if exists public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text);
drop function if exists public.complete_create_link_order(uuid, text, text, text, text);
drop table if exists public.account_report_registrations;
drop table if exists public.report_deliveries;

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
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;

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
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;

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
revoke all on function public.complete_regenerate_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_report(uuid, uuid) to service_role;

drop index if exists public.complete_reports_one_per_order;
drop index if exists public.complete_reports_same_version_uq;
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256)
  where status <> 'revoked';
drop index if exists public.complete_reports_one_active_per_session;
create unique index complete_reports_one_active_per_session on public.complete_reports (diagnosis_session_id)
  where status <> 'revoked';
alter table public.complete_reports drop column if exists via_link;

drop index if exists public.complete_orders_one_open_per_session;
create unique index complete_orders_one_open_per_session on public.complete_orders (diagnosis_session_id)
  where status in ('created', 'checkout_open');
drop index if exists public.complete_orders_one_paid_analysis_per_session;
create unique index complete_orders_one_paid_analysis_per_session on public.complete_orders (diagnosis_session_id)
  where offer = 'analysis' and status in ('paid', 'disputed');
drop index if exists public.complete_orders_one_paid_complete_per_session;
create unique index complete_orders_one_paid_complete_per_session on public.complete_orders (diagnosis_session_id)
  where offer in ('direct_complete', 'analysis_upgrade') and status in ('paid', 'disputed');

alter table public.complete_orders drop constraint if exists complete_orders_buyer_consistency;
alter table public.complete_orders add constraint complete_orders_buyer_consistency check (
  (buyer = 'user' and user_id is not null and claim_secret_hash is null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null)
  or (buyer = 'guest' and claim_secret_hash is not null and claim_expires_at is not null
     and ((user_id is null and claimed_by is null and claimed_at is null and claim_method is null)
          or (user_id is not null and claimed_by = user_id and claimed_at is not null and claim_method is not null)))
);
alter table public.complete_orders drop constraint if exists complete_orders_buyer_check;
alter table public.complete_orders add constraint complete_orders_buyer_check check (buyer in ('user', 'guest'));

notify pgrst, 'reload schema';

delete from supabase_migrations.schema_migrations where version = '20261020120000';

commit;
