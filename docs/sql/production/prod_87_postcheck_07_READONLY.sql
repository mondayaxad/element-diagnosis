-- ============================================================
-- prod_87：prod_07（タイプ別レポート）の状態の確認【読み取りのみ】
-- 本番の SQL Editor で、このファイル全体を実行する（最後は rollback。何も変更しない）。
-- 生成元：docs/sql/production/build_production_sql.py（手で編集しない）
-- ============================================================
begin;
set transaction read only;

select k, v from (values
  ('ledger.stages', (select coalesce(string_agg(stage::text || ':' || name, ', ' order by stage), '(なし)') from element_release.migration_ledger)),
  ('type_report.table', (select coalesce(string_agg(relname || (case when relrowsecurity then '(RLS)' else '(RLS無し)' end), ', ' order by relname), '(なし)') from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'type\_report\_%')),
  ('type_report.functions', (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'type\_report\_%') || ' (5 であること)'),
  ('type_report.browser_exec', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'type\_report\_%'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) || ' (0 であること)'),
  ('type_report.orders_live_only', (select count(*)::text from pg_constraint where conname = 'type_report_orders_live_only') || ' (1 であること)'),
  ('type_report.rows', case when to_regclass('public.type_report_orders') is null then '(なし)'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.type_report_orders', false, true, '')))[1]::text end)
) v(k, v) order by k;

rollback;
