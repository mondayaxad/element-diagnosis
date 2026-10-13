-- ============================================================
-- complete_97：complete_09（20261013180000_complete_09_result_resume_links）の戻し【実行禁止・草案】2026-10-13。Preview 専用。未適用。
-- 使う時：complete_09 を当てた後に、アプリを固有リンクより前の commit へ戻す時だけ。
--         アプリ（固有リンクの commit）は complete_09 の関数を使うため、DB だけを戻すと固有リンクの作成・照会が 503 になる
--         （診断結果の表示・購入は固有リンクが無くても動く）。先にアプリを戻してから、この SQL を実行する。
-- 消えるもの：固有リンクの表（秘密値のハッシュ）と作成の回数の表。発行済みの /result#r=… はすべて開けなくなる（戻せない）。
-- 戻すもの：登録完了の関数が受け付けるプライバシーポリシーの版を 2026-10-07 に戻す（onboarding_01 と同じ本文）。
--           戻した後は、2026-10-13 を送る画面（固有リンクの commit 以降）からの登録完了は失敗するため、アプリを先に戻す。
--           complete_09 の後に 2026-10-13 で記録された同意の行は書き換えない（その時に表示していた版の記録として残す）。
-- 残るもの：固有リンクの作成の時に作ったゲストの診断記録（diagnosis_sessions・answers・results）。
--           購入のある記録は購入の記録として残す必要があるため、ここでは消さない。
--           購入の無い記録を消す時は、運営者が件数を控えてから別に判断する（この SQL では行わない）。
-- 手順：(1) 下の「読み取りの確認」を実行し、件数を控える → (2) この SQL を SQL Editor で実行 → (3) もう一度「読み取りの確認」
--   select count(*) as links, count(*) filter (where expires_at > now()) as active from public.result_resume_links;
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

drop function if exists public.complete_purge_result_links();
drop function if exists public.complete_open_result_link(text);
drop function if exists public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text);
drop function if exists public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text);
drop table if exists public.result_resume_links;
drop table if exists public.result_link_rate;

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
     or p_privacy_version is distinct from '2026-10-07'
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

delete from supabase_migrations.schema_migrations where version = '20261013180000';

commit;
