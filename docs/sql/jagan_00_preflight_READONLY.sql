-- ============================================================
-- jagan_00：邪眼診断（jagan_01）適用前の確認（READ ONLY。何も変更しない）
-- 【Preview（element-diagnosis-preview）の SQL Editor で実行する】本番では実行しない。
-- 結果は 1 つの表（k, v, expect）で返る。expect と違う行が 1 つでもあれば、jagan_01 を実行せずに止めて報告する。
-- ============================================================
begin read only;
select k, v, expect from (values
  -- 1. 対象の環境
  ('01 environment',
     case when to_regprocedure('public.deployment_environment()') is null then '(関数なし)'
          else (select public.deployment_environment()) end,
     'preview'),
  ('02 database', current_database(), 'postgres'),
  ('03 server_version', current_setting('server_version'), '（参考）'),
  -- 2. 対象の 3 テーブル（未適用なら 3 つとも存在しない）
  ('04 table jagan_results',      coalesce(to_regclass('public.jagan_results')::text, '(なし)'),      '(なし)'),
  ('05 table jagan_shares',       coalesce(to_regclass('public.jagan_shares')::text, '(なし)'),       '(なし)'),
  ('06 table jagan_entitlements', coalesce(to_regclass('public.jagan_entitlements')::text, '(なし)'), '(なし)'),
  ('07 other public.jagan_* objects',
     (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname like 'jagan\_%'),
     '0'),
  ('08 policies on jagan_*',
     (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'jagan\_%'),
     '0'),
  -- 3. マイグレーション履歴
  ('09 migration 20261102120000 recorded',
     (select count(*)::text from supabase_migrations.schema_migrations where version = '20261102120000'),
     '0'),
  ('10 latest migration',
     (select version || ' ' || coalesce(name, '') from supabase_migrations.schema_migrations order by version desc limit 1),
     '（参考：2026-11-05 の確認では 20261021200000）'),
  ('11 migration count',
     (select count(*)::text from supabase_migrations.schema_migrations),
     '（参考）'),
  -- 4. 前提（jagan_01 が参照するもの）
  ('12 auth.users exists', (to_regclass('auth.users') is not null)::text, 'true'),
  ('13 gen_random_uuid available', (to_regprocedure('gen_random_uuid()') is not null)::text, 'true'),
  ('14 roles anon/authenticated/service_role',
     (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
     '3')
) t(k, v, expect)
order by k;
rollback;
