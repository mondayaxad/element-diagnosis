-- ============================================================
-- complete_12：購入時メールが1つに揃った記録だけを引き継ぐ（2026-10-15）。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】関数の置き換えを含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイルで行う。
-- 前提：complete_01〜11 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない（関数の置き換えだけ。すでに引き継がれた記録はそのまま）。
-- 戻し：complete_96_rollback_12_DRAFT_DO_NOT_RUN.sql（実行禁止の草案）。
-- ============================================================
--
-- 方針
--   ・ゲストの記録をアカウントへ移す（complete_transfer_guest_record：Cookie・購入時メールの両方の入口）のは、
--     その記録の支払済み・異議申し立て中の注文の購入時メールが、すべて記録済みで1つに揃っている時だけ。
--     2つ以上のメールに分かれている記録は complete_claim_mixed_email、まだ記録していない注文がある記録は
--     complete_claim_email_unknown で断る（サーバーが Stripe から取り直してから呼ぶ）。
--   ・どのメールのアカウントへ移すか（ログイン中の確認済みメールとの一致）は、これまでどおり呼び出し側が確かめる。
--     メールが1つに揃っていれば「どれか1つの一致」＝「すべての一致」になる。
--   ・購入時メールでの引き継ぎ（complete_claim_guest_by_email）は、上の2つで断られた記録を飛ばして数える（skipped）。
--   ・確かめてから移すまでの間に別のメールの支払いが入らないよう、記録の行の鍵を取った後（移す処理の中）で確かめる。

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261014180000')
     or to_regprocedure('public.complete_transfer_guest_record(uuid, uuid, text)') is null
     or to_regprocedure('public.complete_claim_guest_by_email(uuid, text)') is null then
    raise exception 'complete_01..11 are not applied';
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
  -- 支払いの購入時メールが1つに揃っている記録だけを移す（complete_12）。
  --   支払済み・異議申し立て中の注文のどれかに購入時メールが無い（まだ記録していない）・2つ以上のメールに分かれている時は移さない
  --   （¥1,000 を B、¥2,000 を C のメールで払った記録を、B のアカウントへ丸ごと移さない）。呼び出し側がメールの一致を確かめる
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('paid', 'disputed') and o.purchase_email_hmac is null) then
    raise exception 'complete_claim_email_unknown' using errcode = '42501';
  end if;
  if (select count(distinct o.purchase_email_hmac) from public.complete_orders o
       where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('paid', 'disputed')) > 1 then
    raise exception 'complete_claim_mixed_email' using errcode = '42501';
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
      if sqlerrm in ('complete_claim_conflict', 'complete_claim_checkout_open', 'complete_claim_mixed_email', 'complete_claim_email_unknown') then
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

-- 確認（変更はしない。期待と違えば全体を取り消す）
do $$
begin
  if position('complete_claim_mixed_email' in pg_get_functiondef('public.complete_transfer_guest_record(uuid, uuid, text)'::regprocedure)) = 0
     or position('complete_claim_mixed_email' in pg_get_functiondef('public.complete_claim_guest_by_email(uuid, text)'::regprocedure)) = 0 then
    raise exception 'complete_12 functions are not replaced';
  end if;
  if has_function_privilege('anon', 'public.complete_transfer_guest_record(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_claim_guest_by_email(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_transfer_guest_record(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_claim_guest_by_email(uuid, text)', 'EXECUTE') then
    raise exception 'unexpected privileges after complete_12';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_transfer_guest_record', 'complete_claim_guest_by_email')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_12 function is not security invoker with empty search_path';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261015120000', 'complete_12_single_purchase_email_claim')
on conflict (version) do nothing;

commit;
