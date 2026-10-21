-- 【草案・実行しない】complete_16 の取り消し：complete_15 の定義（旧正式の組＋新正式の組の2組を許可）へ戻す
--
--   ・complete_registration_onboarding(text, text, text) を complete_15 の本文に戻し、complete_16 の履歴の行を消すだけ。
--     表・既存の行は変えない（既存の利用者の同意の記録は書き換えない）。
--   ・戻した後は、旧い画面〔旧版 2026-10-07／2026-10-13 の組〕からの新規の登録完了も、再び受け付ける。
--   ・本番では実行しない（Preview 用）。実行の前に、運営者が内容を確認する。

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021180000') then
    raise exception 'complete_15 is not applied';
  end if;
end
$$;

create or replace function public.complete_registration_onboarding(
  p_terms_version text,
  p_privacy_version text,
  p_newsletter_consent_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- 同意の版：正規の組（旧画面の組・新画面の組）だけを受け付ける。混在した組を送る正規の経路は無い
  --   （SQL を先に適用し、その後にコードを出す順序でも、既存の画面の登録が止まらない）
  if (p_terms_version, p_privacy_version) is distinct from ('2026-10-07', '2026-10-13')
     and (p_terms_version, p_privacy_version) is distinct from ('2026-10-21', '2026-10-21') then
    raise exception 'unsupported_consent_version' using errcode = '22023';
  end if;
  if p_newsletter_consent_version is distinct from '2026-10-07-v1' then
    raise exception 'unsupported_consent_version' using errcode = '22023';
  end if;

  select onboarding_status into v_status from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'required' then
    update public.profiles
       set onboarding_status          = 'completed',
           onboarding_completed_at    = now(),
           terms_accepted_at          = now(),
           terms_version              = p_terms_version,
           privacy_accepted_at        = now(),
           privacy_version            = p_privacy_version,
           newsletter_opted_in        = true,
           newsletter_opted_in_at     = now(),
           newsletter_consent_source  = 'registration_onboarding',
           newsletter_consent_version = p_newsletter_consent_version,
           newsletter_sync_status     = 'pending',
           updated_at                 = now()
     where id = v_uid;
  elsif v_status <> 'completed' then
    raise exception 'onboarding_not_required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'onboarding_status', onboarding_status,
      'newsletter_sync_status', newsletter_sync_status)
      from public.profiles where id = v_uid);
end;
$$;
revoke all on function public.complete_registration_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_registration_onboarding(text, text, text) to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261021200000';
notify pgrst, 'reload schema';

commit;
