-- ============================================================
-- jagan_02 の適用前の確認（READ ONLY。何も変更しない）
-- 【Preview（element-diagnosis-preview）の SQL Editor で実行する】
-- 結果は 1 つの表（k, ok, v, expect）。ok が false の行が 1 つでもあれば、jagan_02 を実行せずに止めて報告する。
-- ============================================================
begin read only;
select k, (v is not distinct from expect) as ok, v, expect from (values
  ('01 environment',
     case when to_regprocedure('public.deployment_environment()') is null then '(関数なし)' else (select public.deployment_environment()) end, 'preview'),
  ('02 jagan_01 recorded', (select count(*)::text from supabase_migrations.schema_migrations where version = '20261102120000'), '1'),
  ('03 jagan_02 recorded', (select count(*)::text from supabase_migrations.schema_migrations where version = '20261107120000'), '0'),
  ('04 table jagan_orders', coalesce(to_regclass('public.jagan_orders')::text, '(なし)'), '(なし)'),
  ('05 table jagan_order_registrations', coalesce(to_regclass('public.jagan_order_registrations')::text, '(なし)'), '(なし)'),
  ('06 jagan_entitlements.order_id',
     (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'jagan_entitlements' and column_name = 'order_id'), '0'),
  ('07 jagan_* functions', (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'jagan\_%'), '0'),
  ('08 table jagan_results', coalesce(to_regclass('public.jagan_results')::text, '(なし)'), 'jagan_results'),
  ('09 table jagan_entitlements', coalesce(to_regclass('public.jagan_entitlements')::text, '(なし)'), 'jagan_entitlements'),
  ('10 table profiles.onboarding_status',
     (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status'), '1'),
  ('11 jagan_entitlements rows', (select count(*)::text from public.jagan_entitlements), '0')
) t(k, v, expect)
order by k;
rollback;
