-- 【草案・実行しない】complete_15 の取り消し：登録完了の同意の版を、complete_09 の状態（利用規約 2026-10-07・プライバシー 2026-10-13）へ戻す
--
--   ・complete_registration_onboarding(text, text, text) を complete_09 の本文に戻すだけ。表・既存の行は変えない。
--   ・既存の利用者の同意の記録は、戻しても書き換わらない。ただし、戻した後は、2026-10-21 の版を送るコードの登録は
--     unsupported_consent_version で断られる。戻す前に、コードを 2026-10-07・2026-10-13 の版へ戻して deploy すること。
--   ・本番では実行しない（Preview 用）。実行の前に、運営者が内容を確認する。

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
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
  if p_terms_version is distinct from '2026-10-07'
     or p_privacy_version is distinct from '2026-10-13'
     or p_newsletter_consent_version is distinct from '2026-10-07-v1' then
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

do $$
begin
  if position('2026-10-21' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) <> 0
     or position('2026-10-13' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) = 0 then
    raise exception 'rollback of complete_15 did not restore the complete_09 function';
  end if;
end
$$;

delete from supabase_migrations.schema_migrations where version = '20261021180000';
notify pgrst, 'reload schema';

commit;
