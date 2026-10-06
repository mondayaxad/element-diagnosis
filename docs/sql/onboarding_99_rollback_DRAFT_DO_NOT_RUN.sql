-- ============================================================
-- onboarding_99：onboarding_01 の戻し【実行禁止・草案】Preview 専用
-- 【注意】同意の記録（日時・版・配信同意・Kit 同期状態）が消える。戻す前に、必要なら
--   id と onboarding_* / terms_* / privacy_* / newsletter_* の列を（メールアドレスなしで）退避すること。
-- newsletter_opted_in・newsletter_opted_in_at は onboarding_01 より前からある列なので残す
--   （値は onboarding_01 適用中に RPC が書いたままになる）。
-- ============================================================

begin;

drop trigger if exists diagnosis_sessions_require_onboarding on public.diagnosis_sessions;
drop function if exists public.diagnosis_sessions_require_onboarding();
drop trigger if exists profiles_guard_consent_columns on public.profiles;
drop function if exists public.profiles_guard_consent_columns();
drop function if exists public.complete_registration_onboarding(text, text, text);

alter table public.profiles
  drop constraint if exists profiles_onboarding_status_check,
  drop constraint if exists profiles_onboarding_completed_check,
  drop constraint if exists profiles_newsletter_sync_status_check,
  drop constraint if exists profiles_newsletter_sync_attempts_check,
  drop column if exists onboarding_required,
  drop column if exists onboarding_status,
  drop column if exists onboarding_completed_at,
  drop column if exists terms_accepted_at,
  drop column if exists terms_version,
  drop column if exists privacy_accepted_at,
  drop column if exists privacy_version,
  drop column if exists newsletter_consent_source,
  drop column if exists newsletter_consent_version,
  drop column if exists newsletter_sync_status,
  drop column if exists newsletter_sync_attempted_at,
  drop column if exists newsletter_sync_attempts;

commit;
