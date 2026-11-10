-- ============================================================
-- prod_86：prod_06（邪眼診断）の状態の確認【読み取りのみ】
-- 本番の SQL Editor で、このファイル全体を実行する（最後は rollback。何も変更しない）。
-- 生成元：docs/sql/production/build_production_sql.py（手で編集しない）
-- ============================================================
begin;
set transaction read only;

select k, v from (values
  ('ledger.stages', (select coalesce(string_agg(stage::text || ':' || name, ', ' order by stage), '(なし)') from element_release.migration_ledger)),
  ('jagan.tables', (select coalesce(string_agg(relname || (case when relrowsecurity then '(RLS)' else '(RLS無し)' end), ', ' order by relname), '(なし)') from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'jagan\_%')),
  ('jagan.functions', (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'jagan\_%') || ' (7 であること)'),
  ('jagan.browser_exec', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'jagan\_%'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) || ' (0 であること)'),
  ('jagan.orders_live_only', (select count(*)::text from pg_constraint where conname = 'jagan_orders_live_only') || ' (1 であること)'),
  ('jagan.product_amounts', coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname = 'jagan_orders_product_amount_check'), '(なし)')),
  ('jagan.rows', (select coalesce(string_agg(t || '=' || case when to_regclass('public.' || t) is null then '(なし)'
       else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text end, ',' order by t), '')
       from unnest(array['jagan_results', 'jagan_shares', 'jagan_entitlements', 'jagan_orders', 'jagan_order_registrations']) t))
) v(k, v) order by k;

rollback;
