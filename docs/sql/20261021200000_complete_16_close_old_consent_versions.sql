-- complete_16：新規の登録完了で受け付ける同意の版を、新しい組（2026-10-21）だけにする（Preview 専用）
--
--   ・complete_registration_onboarding(text, text, text) の置き換えだけ。表・列・既存の行は変えない。
--     登録が完了している（completed）利用者の過去の同意の記録は、これまでどおり書き換えない
--     （更新するのは、登録が未完了〔required〕の人が登録を完了する時だけ）。旧版（2026-10-07／2026-10-13）で登録した
--     利用者の記録は、履歴としてそのまま残す。
--   ・新規の登録完了で受け付けるのは、次の組だけ：
--       利用規約 '2026-10-21' ＋ プライバシーポリシー '2026-10-21' ＋ お知らせメール '2026-10-07-v1'
--     旧版の組（'2026-10-07' ＋ '2026-10-13'）・新旧の混在・未定義の版・空・NULL は、unsupported_consent_version で断る。
--   ・理由：画面の切り替え（新しい画面が 2026-10-21 の組を送る）が済み、Preview の実機で確かめた。
--     旧い画面（開いたままのタブなど）が旧版の組で登録を完了して、実在しない同意の状態を増やさないようにする。
--     断られた旧い画面には、「ページを再読み込みして、もう一度お手続きください」と案内する（同意は代行しない）。
--   ・権限は complete_15 と同じ（authenticated だけが実行できる。security definer・search_path = ''）。
--   ・適用の条件（満たさなければ全体を取り消す）：Preview の DB・PostgreSQL 17・complete_15 が適用済み。
--   ・二度適用できる（履歴の行は1行のまま）。
--   ・rollback：docs/sql/complete_95_rollback_16_DRAFT_DO_NOT_RUN.sql

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::int < 170000 or current_setting('server_version_num')::int >= 180000 then
    raise exception 'not a PostgreSQL 17 server';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261021180000')
     or to_regprocedure('public.complete_registration_onboarding(text, text, text)') is null
     or position('2026-10-21' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) = 0 then
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
  -- 同意の版：新規の登録完了で受け付けるのは、新しい組だけ（旧版・新旧の混在・未定義・空・NULL は断る）
  if p_terms_version is distinct from '2026-10-21'
     or p_privacy_version is distinct from '2026-10-21'
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
  if position('2026-10-21' in v_src) = 0 or position('2026-10-07-v1' in v_src) = 0
     or v_src ~ '2026-10-13' or v_src ~ '2026-10-07([^-]|$)' then
    raise exception 'complete_registration_onboarding does not accept only the new consent versions';
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
values ('20261021200000', 'complete_16_close_old_consent_versions')
on conflict (version) do nothing;

commit;
