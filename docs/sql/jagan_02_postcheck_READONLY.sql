-- ============================================================
-- jagan_02：邪眼診断（jagan_01）適用後の確認（READ ONLY。何も変更しない）
-- 【Preview（element-diagnosis-preview）の SQL Editor で実行する】jagan_01 の直後に実行する。
-- 結果は 1 つの表（k, ok, v, expect）。ok が false の行が 1 つでもあれば、アプリの確認に進まずに止めて報告する。
--   ・テーブル／列数／制約（主キー・外部キーと削除時の動き・一意・CHECK）／インデックス
--   ・RLS の有効化／ポリシー（対象ロール・操作・条件）
--   ・アクセス権限（anon・authenticated・service_role × SELECT／INSERT／UPDATE／DELETE／TRUNCATE／REFERENCES／TRIGGER。PUBLIC 経由も含む）
--   ・migration 履歴への記録
-- ============================================================
begin read only;
with
t(tbl) as (values ('jagan_results'), ('jagan_shares'), ('jagan_entitlements')),
-- アクセス権限：表 × ロールごとに、実際に持っている権限（has_table_privilege は PUBLIC・継承も含めて判定する）
privs as (
  select t.tbl, r.role,
    coalesce((select string_agg(p, ',' order by p collate "C")
       from unnest(array['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']) p
       where to_regclass('public.' || t.tbl) is not null and has_table_privilege(r.role, ('public.' || t.tbl)::regclass, p)), '') v
  from t cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
),
priv_expect(tbl, role, expect) as (values
  ('jagan_results', 'anon', ''), ('jagan_results', 'authenticated', 'DELETE,SELECT'), ('jagan_results', 'service_role', 'DELETE,INSERT,SELECT'),
  ('jagan_shares', 'anon', ''), ('jagan_shares', 'authenticated', ''), ('jagan_shares', 'service_role', 'INSERT,SELECT,UPDATE'),
  ('jagan_entitlements', 'anon', ''), ('jagan_entitlements', 'authenticated', 'SELECT'), ('jagan_entitlements', 'service_role', 'INSERT,SELECT,UPDATE')
),
cons as (
  select t.tbl, coalesce((select string_agg(c.contype::text || ':' || c.conname, ' ' order by c.contype::text collate "C", c.conname::text collate "C")
    from pg_constraint c where c.conrelid = to_regclass('public.' || t.tbl)), '') v
  from t
),
cons_expect(tbl, expect) as (values
  ('jagan_results', 'c:jagan_results_answers_check c:jagan_results_character_model_version_check c:jagan_results_dti_code_check c:jagan_results_engine_version_check c:jagan_results_headline_check c:jagan_results_interpretation_version_check c:jagan_results_item_set_version_check c:jagan_results_naming_version_check c:jagan_results_schema_version_check c:jagan_results_scoring_version_check c:jagan_results_snapshot_check f:jagan_results_user_id_fkey p:jagan_results_pkey'),
  ('jagan_shares', 'c:jagan_shares_item_set_version_check c:jagan_shares_public_id_check c:jagan_shares_result_key_check c:jagan_shares_revoke_token_hash_check c:jagan_shares_summary_check f:jagan_shares_user_id_fkey p:jagan_shares_pkey u:jagan_shares_result_key_key'),
  ('jagan_entitlements', 'c:jagan_entitlements_product_key_check c:jagan_entitlements_status_check f:jagan_entitlements_result_id_fkey f:jagan_entitlements_user_id_fkey p:jagan_entitlements_pkey u:jagan_entitlements_user_id_result_id_product_key_key')
),
fks as (
  select coalesce(string_agg(c.conrelid::regclass::text || '.' || a.attname || '->' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ' ' order by c.conname::text collate "C"), '') v
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid in (select to_regclass('public.' || tbl) from t)
),
idx as (
  select t.tbl, coalesce((select string_agg(i.indexrelid::regclass::text, ' ' order by i.indexrelid::regclass::text collate "C")
    from pg_index i where i.indrelid = to_regclass('public.' || t.tbl)), '') v
  from t
),
idx_expect(tbl, expect) as (values
  ('jagan_results', 'jagan_results_pkey jagan_results_user_created_idx'),
  ('jagan_shares', 'jagan_shares_pkey jagan_shares_result_key_key jagan_shares_user_idx'),
  ('jagan_entitlements', 'jagan_entitlements_pkey jagan_entitlements_user_id_result_id_product_key_key')
),
pol as (
  select coalesce(string_agg(tablename || '.' || policyname || ':' || permissive || ':' || array_to_string(roles, ',') || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ' | ' order by tablename::text collate "C", policyname::text collate "C"), '') v
  from pg_policies where schemaname = 'public' and tablename like 'jagan\_%'
),
rows(k, v, expect) as (
  select '01 environment', (select public.deployment_environment()), 'preview'
  union all select '02 table ' || tbl, coalesce(to_regclass('public.' || tbl)::text, '(なし)'), tbl from t
  union all select '03 columns ' || tbl, (select count(*)::text from pg_attribute where attrelid = to_regclass('public.' || tbl) and attnum > 0 and not attisdropped),
                   case tbl when 'jagan_results' then '14' when 'jagan_shares' then '8' else '6' end from t
  union all select '04 constraints ' || c.tbl, c.v, e.expect from cons c join cons_expect e using (tbl)
  union all select '05 foreign keys (c=cascade r=restrict)', (select v from fks),
                   'jagan_entitlements.result_id->jagan_results:r jagan_entitlements.user_id->auth.users:r jagan_results.user_id->auth.users:c jagan_shares.user_id->auth.users:c'
  union all select '06 indexes ' || i.tbl, i.v, e.expect from idx i join idx_expect e using (tbl)
  union all select '07 rls enabled ' || tbl, (select relrowsecurity::text from pg_class where oid = to_regclass('public.' || tbl)), 'true' from t
  union all select '08 policies', (select v from pol),
                   'jagan_entitlements.jagan_entitlements_select_own:PERMISSIVE:authenticated:SELECT:(( SELECT auth.uid() AS uid) = user_id): | jagan_results.jagan_results_delete_own:PERMISSIVE:authenticated:DELETE:(( SELECT auth.uid() AS uid) = user_id): | jagan_results.jagan_results_select_own:PERMISSIVE:authenticated:SELECT:(( SELECT auth.uid() AS uid) = user_id):'
  union all select '09 privileges ' || p.tbl || ' / ' || p.role, p.v, e.expect from privs p join priv_expect e using (tbl, role)
  union all select '10 migration 20261102120000',
                   (select string_agg(version || ' ' || coalesce(name, ''), ',') from supabase_migrations.schema_migrations where version = '20261102120000'),
                   '20261102120000 jagan_01_results_shares'
  union all select '11 rows ' || tbl, (select (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', tbl), false, true, '')))[1]::text where to_regclass('public.' || tbl) is not null),
                   '0' from t
)
select k, (v is not distinct from expect) as ok, v, expect from rows order by k;
rollback;
