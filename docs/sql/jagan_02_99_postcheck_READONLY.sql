-- ============================================================
-- jagan_02 の適用後の確認（READ ONLY。何も変更しない）
-- 【Preview（element-diagnosis-preview）の SQL Editor で実行する】jagan_02 の直後に実行する。
-- 結果は 1 つの表（k, ok, v, expect）。ok が false の行が 1 つでもあれば、アプリの確認に進まずに止めて報告する。
-- ============================================================
begin read only;
with
t(tbl) as (values ('jagan_orders'), ('jagan_order_registrations'), ('jagan_entitlements'), ('jagan_results')),
privs as (
  select t.tbl, r.role,
    coalesce((select string_agg(p, ',' order by p collate "C")
       from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p
       where to_regclass('public.' || t.tbl) is not null and has_table_privilege(r.role, ('public.' || t.tbl)::regclass, p)), '') v
  from t cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
),
priv_expect(tbl, role, expect) as (values
  ('jagan_orders', 'anon', ''), ('jagan_orders', 'authenticated', ''), ('jagan_orders', 'service_role', 'INSERT,SELECT,UPDATE'),
  ('jagan_order_registrations', 'anon', ''), ('jagan_order_registrations', 'authenticated', ''), ('jagan_order_registrations', 'service_role', 'INSERT,SELECT'),
  ('jagan_entitlements', 'anon', ''), ('jagan_entitlements', 'authenticated', 'SELECT'), ('jagan_entitlements', 'service_role', 'INSERT,SELECT,UPDATE'),
  ('jagan_results', 'anon', ''), ('jagan_results', 'authenticated', 'DELETE,SELECT'), ('jagan_results', 'service_role', 'DELETE,INSERT,SELECT')
),
fn(sig) as (values
  ('jagan_apply_payment(uuid,text,text,integer,text,text,boolean)'),
  ('jagan_apply_reversal(uuid,text)'),
  ('jagan_close_order(uuid,text,text)'),
  ('jagan_create_order(uuid,text,jsonb,text,jsonb,uuid,text,text,text)'),
  ('jagan_mark_checkout_open(uuid,text)'),
  ('jagan_refresh_entitlement(uuid,uuid)'),
  ('jagan_register_order(uuid,text,uuid,text,text,text,text,text,text,jsonb)')
),
fninfo as (
  select f.sig, to_regprocedure('public.' || f.sig) as oid from fn f
),
rows(k, v, expect) as (
  select '01 environment', (select public.deployment_environment()), 'preview'
  union all select '02 table ' || tbl, coalesce(to_regclass('public.' || tbl)::text, '(なし)'), tbl from t
  union all select '03 rls ' || tbl, (select relrowsecurity::text from pg_class where oid = to_regclass('public.' || tbl)), 'true' from t
  union all select '04 privileges ' || p.tbl || ' / ' || p.role, p.v, e.expect from privs p join priv_expect e using (tbl, role)
  union all select '05 policies on jagan_orders/registrations',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('jagan_orders', 'jagan_order_registrations')), '0'
  union all select '06 jagan_entitlements.order_id',
    (select data_type || ' fk:' || coalesce((select c.confrelid::regclass::text || ':' || c.confdeltype::text from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.conrelid = 'public.jagan_entitlements'::regclass and c.contype = 'f' and a.attname = 'order_id'), '-')
     from information_schema.columns where table_schema = 'public' and table_name = 'jagan_entitlements' and column_name = 'order_id'),
    'uuid fk:jagan_orders:r'
  union all select '07 function ' || f.sig,
    case when f.oid is null then '(なし)' else (select (case when p.prosecdef then 'definer' else 'invoker' end) || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
      from pg_proc p where p.oid = f.oid) end,
    'invoker search_path=""' from fninfo f
  union all select '08 execute anon/authenticated ' || f.sig,
    case when f.oid is null then '(なし)' else (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE'))::text end,
    'false' from fninfo f
  union all select '09 execute service_role ' || f.sig,
    case when f.oid is null then '(なし)' else has_function_privilege('service_role', f.oid, 'EXECUTE')::text end, 'true' from fninfo f
  union all select '10 migration 20261107120000',
    (select string_agg(version || ' ' || coalesce(name, ''), ',') from supabase_migrations.schema_migrations where version = '20261107120000'),
    '20261107120000 jagan_02_orders_links_registrations'
  union all select '11 rows jagan_orders', (select count(*)::text from public.jagan_orders where to_regclass('public.jagan_orders') is not null), '0'
)
select k, (v is not distinct from expect) as ok, v, expect from rows order by k;
rollback;
