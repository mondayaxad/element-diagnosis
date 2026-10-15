-- ============================================================
-- 【実行禁止の草案】complete_12 の戻し（2026-10-15）。Preview 専用。
-- complete_transfer_guest_record を complete_08 の定義へ、complete_claim_guest_by_email を complete_07 の定義へ戻し、
-- migration 履歴の complete_12 の1行を外す。既存の注文・記録の行は変えない。
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

create or replace function public.complete_claim_guest_by_email(p_user_id uuid, p_purchase_email_hmac text)
  returns table (claimed integer, skipped integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_sid uuid;
  v_claimed integer := 0;
  v_skipped integer := 0;
begin
  if p_user_id is null or p_purchase_email_hmac is null or p_purchase_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  for v_sid in
    select distinct o.diagnosis_session_id from public.complete_orders o
     where o.buyer = 'guest' and o.user_id is null and o.status = 'paid' and o.purchase_email_hmac = p_purchase_email_hmac
  loop
    begin
      if public.complete_transfer_guest_record(p_user_id, v_sid, 'email_otp') = 'applied' then
        v_claimed := v_claimed + 1;
      end if;
    exception when others then
      if sqlerrm in ('complete_claim_conflict', 'complete_claim_checkout_open') then
        v_skipped := v_skipped + 1;
      else
        raise;
      end if;
    end;
  end loop;
  return query select v_claimed, v_skipped;
end;
$$;

revoke all on function public.complete_transfer_guest_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_claim_guest_by_email(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_transfer_guest_record(uuid, uuid, text) to service_role;
grant execute on function public.complete_claim_guest_by_email(uuid, text) to service_role;

delete from supabase_migrations.schema_migrations where version = '20261015120000';

commit;
