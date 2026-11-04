-- ============================================================
-- jagan_01：邪眼診断の保存結果・公開共有・購入権限の土台
-- 2026-11-02。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】表・権限・RLS の追加。最後に migration 履歴へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は、Preview の確認後に Production 用の別ファイルで行う。
-- 既存の表（ETI の diagnosis_sessions・購入・権利）は読まない・書き換えない・消さない（新しい表の追加だけ）。
-- 仕様：docs/jagan/spec_v1_0_rc1/API_CONTRACT.md
-- ============================================================
--
-- 方針
--   ・jagan_results：本人の保存結果。書き込みはサーバー（/api/jagan-save、service_role）だけ。サーバーが固定の版で再計算した
--     スナップショット・版・回答・DTI コード（邪眼元素2文字＋異相2文字）と呼び名の版を保存する。ブラウザから送られた所有者・人物・一致率・購入済みは使わない。
--     本人（authenticated）は自分の行の SELECT・DELETE だけ（RLS）。他人の行は読めない・消せない。
--     result_id はブラウザが作る UUID（同率の代表を決める種にも使う）。同じ本人の再送は同じ行（重複しない）。
--     別の本人の result_id には上書きしない（API が 409）。
--   ・jagan_shares：公開共有。公開 ID（22文字の乱数）と、非公開の result_id を分ける（result_id は SHA-256 のハッシュだけを保存）。
--     公開してよい値は publicSummary の許可リストだけ（summary）。回答・12スコア・所有者は入れない。
--     anon・authenticated は権限なし（共有ページ・OGP はサーバーが summary だけを返す）。
--     ログインなしの共有の取消は、作成時にだけ返す取消用の秘密値（DB にはハッシュだけ）で行う。
--   ・jagan_entitlements：邪眼解析レポート（jagan_report_v1・1,000円・買い切り）の購入権限の土台。今回は販売しない（sales_open=false）。
--     ETI の購入（purchase_entitlements・record_entitlements）とは別の表。ETI の購入から自動付与しない。本人は SELECT だけ。
--
-- 戻し：jagan_99_rollback_01_DRAFT_DO_NOT_RUN.sql（実行禁止の草案。表を消すため保存結果・共有も消える）。

begin;

-- 0. Preview であることを確かめる
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
end
$$;

-- 1. 本人の保存結果
create table if not exists public.jagan_results (
  result_id                uuid primary key,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  schema_version           text not null check (schema_version = 'jagan-result-3'),
  engine_version           text not null check (length(engine_version) between 1 and 64),
  item_set_version         text not null check (length(item_set_version) between 1 and 64),
  scoring_version          text not null check (length(scoring_version) between 1 and 64),
  interpretation_version   text not null check (length(interpretation_version) between 1 and 64),
  character_model_version  text not null check (length(character_model_version) between 1 and 64),
  dti_code                 text not null check (dti_code ~ '^[A-Z]{4}$'),
  naming_version           text not null check (length(naming_version) between 1 and 64),
  answers                  jsonb not null check (jsonb_typeof(answers) = 'object'),
  snapshot                 jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  headline                 jsonb not null check (jsonb_typeof(headline) = 'object'),
  created_at               timestamptz not null default now()
);
create index if not exists jagan_results_user_created_idx on public.jagan_results (user_id, created_at desc);
revoke all on table public.jagan_results from public, anon, authenticated, service_role;
grant select, delete on table public.jagan_results to authenticated;
grant select, insert, delete on table public.jagan_results to service_role;
alter table public.jagan_results enable row level security;
drop policy if exists jagan_results_select_own on public.jagan_results;
create policy jagan_results_select_own on public.jagan_results
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists jagan_results_delete_own on public.jagan_results;
create policy jagan_results_delete_own on public.jagan_results
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 2. 公開共有（公開要約だけ）
create table if not exists public.jagan_shares (
  public_id                text primary key check (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  result_key               text not null unique check (result_key ~ '^[0-9a-f]{64}$'),
  user_id                  uuid references auth.users(id) on delete cascade,
  summary                  jsonb not null check (jsonb_typeof(summary) = 'object' and summary->>'kind' = 'jagan-public-summary-3'),
  item_set_version         text not null check (length(item_set_version) between 1 and 64),
  revoke_token_hash        text check (revoke_token_hash is null or revoke_token_hash ~ '^[0-9a-f]{64}$'),
  created_at               timestamptz not null default now(),
  revoked_at               timestamptz
);
create index if not exists jagan_shares_user_idx on public.jagan_shares (user_id) where user_id is not null;
revoke all on table public.jagan_shares from public, anon, authenticated, service_role;
grant select, insert, update on table public.jagan_shares to service_role;
alter table public.jagan_shares enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。anon・authenticated は権限なし）

-- 3. 邪眼解析レポートの購入権限（土台。販売開始まで行は作らない）
create table if not exists public.jagan_entitlements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete restrict,
  result_id     uuid not null references public.jagan_results(result_id) on delete restrict,
  product_key   text not null check (product_key = 'jagan_report_v1'),
  status        text not null check (status in ('active', 'refunded')),
  created_at    timestamptz not null default now(),
  unique (user_id, result_id, product_key)
);
revoke all on table public.jagan_entitlements from public, anon, authenticated, service_role;
grant select on table public.jagan_entitlements to authenticated;
grant select, insert, update on table public.jagan_entitlements to service_role;
alter table public.jagan_entitlements enable row level security;
drop policy if exists jagan_entitlements_select_own on public.jagan_entitlements;
create policy jagan_entitlements_select_own on public.jagan_entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

-- 4. 確認
do $$
begin
  if has_table_privilege('anon', 'public.jagan_results', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_results', 'INSERT')
     or has_table_privilege('authenticated', 'public.jagan_results', 'UPDATE')
     or has_table_privilege('anon', 'public.jagan_shares', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_shares', 'SELECT')
     or has_table_privilege('authenticated', 'public.jagan_entitlements', 'INSERT')
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jagan_shares') then
    raise exception 'unexpected privileges on jagan tables';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.jagan_results'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.jagan_shares'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.jagan_entitlements'::regclass) then
    raise exception 'rls is not enabled on jagan tables';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261102120000', 'jagan_01_results_shares')
on conflict (version) do nothing;

commit;
