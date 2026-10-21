-- complete_15：登録完了の同意の版に、法務ページを改めた版 2026-10-21 を加える（Preview 専用）
--
--   ・complete_registration_onboarding(text, text, text) の置き換えだけ。表・列・既存の行は変えない。
--     既存の利用者の同意の記録（profiles の terms_version・privacy_version など）は書き換えない
--     （更新するのは、これまでどおり、登録が未完了〔required〕の人が登録を完了する時だけ）。
--   ・受け付ける版：利用規約 '2026-10-07' または '2026-10-21'、プライバシーポリシー '2026-10-13' または '2026-10-21'、
--     お知らせメール '2026-10-07-v1'（文面は変えないので据え置き）。それ以外は unsupported_consent_version で断る。
--   ・内部の同意版（2026-10-21）と、公開ページの制定日・施行日（実際に Production へ公開する日）は別のもの。
--     公開日が決まっても、この migration は作り直さない。
--   ・権限は complete_09 と同じ（authenticated だけが実行できる。security definer・search_path = ''）。
--   ・二度適用できる。Preview 以外では止まる。
--   ・rollback：docs/sql/complete_94_rollback_15_DRAFT_DO_NOT_RUN.sql

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261013180000')
     or to_regprocedure('public.complete_registration_onboarding(text, text, text)') is null then
    raise exception 'complete_09 is not applied';
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
  -- 同意の版：公開前の版（2026-10-07・2026-10-13）と、法務ページを改めた版（2026-10-21）の両方を受け付ける
  --   （SQL を先に適用し、その後にコードを出す順序でも、既存の画面の登録が止まらない）。それ以外の版は断る
  if p_terms_version not in ('2026-10-07', '2026-10-21')
     or p_privacy_version not in ('2026-10-13', '2026-10-21')
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

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
declare
  v_src text := pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure);
begin
  if has_function_privilege('anon', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE') then
    raise exception 'unexpected privileges on complete_registration_onboarding';
  end if;
  if position('2026-10-21' in v_src) = 0 or position('2026-10-07' in v_src) = 0 or position('2026-10-13' in v_src) = 0
     or position('2026-10-07-v1' in v_src) = 0 then
    raise exception 'complete_registration_onboarding does not accept the expected consent versions';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'complete_registration_onboarding'
              and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_registration_onboarding must be security definer with an empty search_path';
  end if;
end
$$;

notify pgrst, 'reload schema';

-- migration 履歴（SQL Editor で実行するため、ここで1行だけ追加する。二度当てしても増えない）
insert into supabase_migrations.schema_migrations (version, name)
values ('20261021180000', 'complete_15_consent_versions')
on conflict (version) do nothing;

commit;
