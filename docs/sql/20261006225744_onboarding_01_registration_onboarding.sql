-- ============================================================
-- onboarding_01：登録完了（利用規約・プライバシーポリシーへの同意とお知らせメール）の記録
-- 【実行禁止・草案】Preview（element-diagnosis-preview）専用。承認後に1回だけ、1トランザクションで実行する。
-- 【本番では実行しない】本番へ入れる場合は別の承認・別のファイルで扱う。
-- 0010_newsletter_consent_DRAFT_DO_NOT_RUN.sql（newsletter_consent_source 等）を置き換える。0010 と両方は適用しない。
-- 行データ：既存行の onboarding_status を設定する UPDATE だけ（同意したとは記録しない）。
-- 戻し：onboarding_99_rollback_DRAFT_DO_NOT_RUN.sql
-- ============================================================
--
-- 設計
--   ・新しい profiles 行（handle_new_user が作る）は onboarding_status = 'required'（列の既定値）。
--   ・既存の行（Preview）：すべて 'required'（2026-10-07 決定。Preview に実ユーザーはいない。次回ログイン時に登録完了モーダルを出す）。
--     同意日時・版は入れない（同意したとは記録しない）。
--     ※本番へ入れる場合は別ファイル・別承認とし、「一度でもログインしたユーザー → 'legacy_exempt'」で区分する
--       （登録完了モーダルを出さず、新しい規約への同意も記録しない。newsletter の値も変えない）。
--   ・同意の記録は RPC complete_registration_onboarding() だけが行う（日時はサーバーの now()、版はサーバー側の固定値と照合）。
--   ・ブラウザ（anon・authenticated）からの同意・配信関連列の直接書き換えはトリガーで拒否する。
--     （本番どおりの権限で authenticated に UPDATE 権限があり、RLS の profiles_update_own だけでは列を守れないため）
--   ・newsletter_sync_* はサーバー（/api/subscribe、service_role）だけが更新する。
--   ・登録完了前（required）のユーザーの診断保存は、DB 側でも拒否する（6.）。
--     save_diagnosis_session（v1）・save_diagnosis_session_v2 はどちらも最初に diagnosis_sessions へ INSERT するため、
--     その INSERT を BEFORE INSERT トリガーで止める。RPC の本文は本番と同じまま変えない。
--     RPC を通らない直接 INSERT（RLS の diagnosis_sessions_insert_own で本人分は許されている）も同じく止まる。

begin;

-- 0. Preview であることを確かめる（0008 の deployment_environment() が 'preview' を返すこと）。
--    本番には関数が無いため、本番で誤って実行するとここで止まる。
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
end
$$;

-- 1. 列の追加（既存行に既定値を入れないよう、まず NULL 可・既定値なしで追加する）
alter table public.profiles
  add column onboarding_status            text,
  add column onboarding_completed_at      timestamptz,
  add column terms_accepted_at            timestamptz,
  add column terms_version                text,
  add column privacy_accepted_at          timestamptz,
  add column privacy_version              text,
  add column newsletter_consent_source    text,
  add column newsletter_consent_version   text,
  add column newsletter_sync_status       text,
  add column newsletter_sync_attempted_at timestamptz,
  add column newsletter_sync_attempts     integer not null default 0;

-- 2. 既存行の区分（Preview：すべて required。同意日時・版は入れない）
update public.profiles
   set onboarding_status = 'required'
 where onboarding_status is null;

-- 3. 新しい行は 'required'。値の範囲と整合性
alter table public.profiles
  alter column onboarding_status set default 'required',
  alter column onboarding_status set not null,
  add constraint profiles_onboarding_status_check
    check (onboarding_status in ('required', 'completed', 'legacy_exempt')),
  add constraint profiles_onboarding_completed_check
    check (onboarding_status <> 'completed' or (
      onboarding_completed_at is not null and terms_accepted_at is not null and terms_version is not null
      and privacy_accepted_at is not null and privacy_version is not null)),
  add constraint profiles_newsletter_sync_status_check
    check (newsletter_sync_status is null or newsletter_sync_status in ('pending', 'synced', 'failed', 'skipped')),
  add constraint profiles_newsletter_sync_attempts_check
    check (newsletter_sync_attempts >= 0);

-- 読み取り用（onboarding_status から自動で決まる。直接は書けない）
alter table public.profiles
  add column onboarding_required boolean generated always as (onboarding_status = 'required') stored;

comment on column public.profiles.onboarding_status is
  'required＝登録完了（規約同意）前／completed＝同意済み／legacy_exempt＝この仕組み以前からの利用者（同意は記録していない）';
comment on column public.profiles.newsletter_sync_status is
  'Kit 同期：pending／synced／failed／skipped（Preview の許可リスト外・Kit 未設定など）。/api/subscribe だけが更新する';

-- 4. 同意・配信関連列をブラウザから直接書き換えさせない
--    SECURITY DEFINER の RPC 内では current_user が関数の所有者になるため、RPC からの更新は通る。
--    service_role（サーバー）も通る。
create or replace function public.profiles_guard_consent_columns()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.onboarding_status            is distinct from old.onboarding_status
    or new.onboarding_completed_at      is distinct from old.onboarding_completed_at
    or new.terms_accepted_at            is distinct from old.terms_accepted_at
    or new.terms_version                is distinct from old.terms_version
    or new.privacy_accepted_at          is distinct from old.privacy_accepted_at
    or new.privacy_version              is distinct from old.privacy_version
    or new.newsletter_opted_in          is distinct from old.newsletter_opted_in
    or new.newsletter_opted_in_at       is distinct from old.newsletter_opted_in_at
    or new.newsletter_consent_source    is distinct from old.newsletter_consent_source
    or new.newsletter_consent_version   is distinct from old.newsletter_consent_version
    or new.newsletter_sync_status       is distinct from old.newsletter_sync_status
    or new.newsletter_sync_attempted_at is distinct from old.newsletter_sync_attempted_at
    or new.newsletter_sync_attempts     is distinct from old.newsletter_sync_attempts
  ) then
    raise exception 'consent_columns_read_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_consent_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_consent_columns();

-- 5. 登録完了 RPC（ログイン中の本人だけ）
--    版はサーバー側の固定値と一致しなければ拒否する（古い画面からの記録を防ぐ）。日時はすべて now()。
--    既に completed なら何も変えずに同じ結果を返す（二重クリック・再読込・OAuth 復帰の重複に備える）。
--    legacy_exempt の人は対象外（既存ユーザーの配信設定を変えない）。
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

-- 6. 登録完了前（required）のユーザーの診断保存を拒否する（v1・v2 の保存 RPC と直接 INSERT の両方）
--    legacy_exempt・completed は従来どおり保存できる。profiles が無い場合は外部キーで失敗する（従来どおり）。
create or replace function public.diagnosis_sessions_require_onboarding()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.onboarding_status = 'required') then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger diagnosis_sessions_require_onboarding
  before insert on public.diagnosis_sessions
  for each row execute function public.diagnosis_sessions_require_onboarding();

revoke all on function public.diagnosis_sessions_require_onboarding() from public, anon, authenticated;
revoke all on function public.complete_registration_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_registration_onboarding(text, text, text) to authenticated;
revoke all on function public.profiles_guard_consent_columns() from public, anon, authenticated;

commit;
