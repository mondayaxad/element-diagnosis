-- ============================================================
-- 完全解析（記録単位の権利）・メール配信同意 — migration 草案（設計案・レビュー用）
-- 【実行禁止】承認前。本番DBへは適用しない。Previewへの適用も、00_preflight の結果を
-- 確認して内容を確定し、別途承認を得てから行う。
--
-- 方針：
--   ・既存の purchase_entitlements と product_type = 'complete'（¥2,500・CORE1＋CORE2セット、
--     権限 core_analysis_access + journey_report_access）には一切手を加えない。
--   ・新しい完全解析は別テーブルで「診断記録（diagnosis_session_id）単位」に権利を持つ。
--     仮商品ID：core_complete_analysis（直接 ¥3,000）／core_complete_analysis_upgrade（追加 ¥2,000）。
--     どちらの経路でも、同じ記録へ core_analysis_access = true / core_complete_access = true が成立する。
--   ・RLS のポリシーは、実スキーマ（C3）を確認するまで確定しない。下のポリシーは案。
-- ============================================================

-- ---------- Part A: メール配信の同意記録（profiles） ----------
-- 前提確認（C1〜C4）：
--   ・newsletter_opted_in / newsletter_opted_in_at は既存列として使う。型が boolean / timestamptz でない、
--     または NOT NULL・既定値 false 等が付いている場合はここで止める（null＝未確認 を表せないため）。
--   ・下の列が既に存在する場合、型・制約が一致するかを確認してから進める（IF NOT EXISTS は型を検査しない）。
begin;
alter table public.profiles
  add column if not exists newsletter_consent_source  text,
  add column if not exists newsletter_consent_version text,
  add column if not exists newsletter_sync_status     text,
  add column if not exists newsletter_synced_at       timestamptz,
  add column if not exists newsletter_sync_error_code text;

-- 値の範囲。同名の制約が既にある場合は追加しない（草案を再実行しても失敗しないようにする）。
-- 既に別定義の同名制約がある場合は、C2 の結果で定義を照合してから扱いを決める（ここでは置き換えない）。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_newsletter_sync_status_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_newsletter_sync_status_chk
      check (newsletter_sync_status is null or newsletter_sync_status in ('pending', 'synced', 'failed'));
  end if;
end
$$;

comment on column public.profiles.newsletter_opted_in is
  'メール配信の同意。null=未確認 / true=本人が受信を選択 / false=本人が選択しなかった。ログイン・保存だけでは変えない';
comment on column public.profiles.newsletter_consent_source is '同意を取得した画面（例：mypage_signup）';
comment on column public.profiles.newsletter_consent_version is '同意文言の版（例：2026-10-06-v1）';
commit;

-- RLS（案・C3 の結果で確定）：本人だけが自分の行の同意列を更新・参照できること。
-- 既に同等のポリシーがある場合は追加しない。列単位で UPDATE 権限を絞っている場合（C4）は、
-- 新しい列を authenticated の UPDATE 対象へ加える必要がある。
-- grant update (newsletter_opted_in, newsletter_opted_in_at, newsletter_consent_source, newsletter_consent_version)
--   on public.profiles to authenticated;
-- newsletter_sync_* はサーバー（service role）だけが書く想定のため、authenticated へは付与しない。


-- ---------- Part B: 完全解析の権利（記録単位・新テーブル） ----------
-- 前提確認（E1〜E3）：diagnosis_sessions.id / user_id の型が uuid であること。
begin;
create table if not exists public.complete_analysis_entitlements (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  diagnosis_session_id        uuid not null references public.diagnosis_sessions(id) on delete cascade,
  product_type                text not null
    check (product_type in ('core_complete_analysis', 'core_complete_analysis_upgrade')),
  stripe_checkout_session_id  text not null unique,
  stripe_payment_intent_id    text,
  amount                      integer not null,
  currency                    text not null default 'jpy',
  status                      text not null default 'active' check (status in ('active', 'revoked')),
  complete_status             text not null default 'purchased'
    check (complete_status in ('purchased', 'generating', 'ready', 'failed')),
  complete_report_path        text,         -- 生成物の保存先（公開URLではない。閲覧時に短命URLを発行する）
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
-- 1つの記録に有効な完全解析権は1つだけ（重複購入の防止）
create unique index if not exists complete_analysis_entitlements_one_active_per_session
  on public.complete_analysis_entitlements (diagnosis_session_id) where status = 'active';
create index if not exists complete_analysis_entitlements_user_idx
  on public.complete_analysis_entitlements (user_id);

-- 権利の正本はサーバー（service role）だけが書き込む。ブラウザからは直接読ませない（案）。
alter table public.complete_analysis_entitlements enable row level security;
-- ポリシーは作らない（anon/authenticated からは不可視）。閲覧は /api/my-entitlements（拡張）経由で、
-- 本人の記録・状態だけを返す。C3 の方針と合わせて確定する。
commit;

-- 権限の導出（コード側の対応表・案）：
--   core_complete_analysis          → core_analysis_access, core_complete_access
--   core_complete_analysis_upgrade  → core_analysis_access, core_complete_access
--     （upgrade は同じ記録に有効な core1 があることを決済前にサーバーで確認する）
--   既存 complete（¥2,500）         → core_analysis_access, journey_report_access（変更しない）
--
-- 既存 API への影響（実装時に別途レビュー）：
--   ・/api/report-data.js：解析レポートは診断コード（ハッシュ）で権利を引くため、
--     完全解析の購入者にも同じ記録の解析レポートを見せるには、記録→コードの対応で
--     このテーブルも参照する必要がある。既存 complete の行の扱いは変えない。
--   ・/api/verify.js：新しい Price ID を新しい product_type へ対応付ける。client_reference_id には
--     診断コードではなく diagnosis_session_id を入れる（Checkout Session をサーバーで作成し、
--     本人所有の記録であることを確認してから発行する）。
