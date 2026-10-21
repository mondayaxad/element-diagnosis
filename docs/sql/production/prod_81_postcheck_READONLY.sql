-- ============================================================
-- prod_81：本番 migration 適用後の読み取り確認（READONLY・何も変更しない）
-- 各段階の後に実行する。出力は項目・状態だけ（個別の値・ID は出さない）。
-- あわせて prod_80_invariants_READONLY.sql の出力が適用前と完全に一致することも確かめる。
-- 生成元：docs/sql/production/build_production_sql.py
-- ============================================================
begin read only;

select k, v from (values
  ('ledger.stages', case when to_regclass('element_release.migration_ledger') is null then '(台帳なし)' else (xpath('/row/c/text()', query_to_xml('select array_agg(stage order by stage)::text as c from element_release.migration_ledger', false, true, '')))[1]::text end),
  ('preview.deployment_environment', (to_regprocedure('public.deployment_environment()') is null)::text || ' (true = 無い)'),
  ('preview.constraints', (select count(*)::text from pg_constraint where conname like '%preview%') || ' (0 であること)'),
  ('live.complete_orders', (select count(*)::text from pg_constraint where conname = 'complete_orders_production_live_mode_only') || ' (prod_02 以降 1)'),
  ('live.stripe_webhook_events', (select count(*)::text from pg_constraint where conname = 'stripe_webhook_events_production_live_only') || ' (prod_02 以降 1)'),
  ('live.functions_assume_test', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and (pg_get_functiondef(p.oid) ~ $re$stripe_mode <> 'test'$re$ or pg_get_functiondef(p.oid) ~ 'p_livemode is distinct from false')) || ' (0 であること)'),
  ('consent.accepts_2026_10_21_only', (select case when d is null then '(関数なし)' else (position('2026-10-21' in d) > 0 and d !~ '2026-10-13' and d !~ '2026-10-07([^-]|$)')::text end
       from (select case when to_regprocedure('public.complete_registration_onboarding(text, text, text)') is null then null else pg_get_functiondef(to_regprocedure('public.complete_registration_onboarding(text, text, text)')) end d) x)),
  ('onboarding.default', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status') || ' (prod_01〜03: legacy_exempt / prod_04 以降: required)'),
  ('onboarding.require_trigger', (select count(*)::text from pg_trigger where tgname = 'diagnosis_sessions_require_onboarding') || ' (prod_04 以降 1)'),
  ('profiles.by_status', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status') then '(列なし)'
       else (xpath('/row/c/text()', query_to_xml('select string_agg(onboarding_status || ''='' || n, '','' order by onboarding_status) as c from (select onboarding_status, count(*) n from public.profiles group by 1) x', false, true, '')))[1]::text end),
  ('new_tables.rows', (select coalesce(string_agg(t || '=' || case when to_regclass('public.' || t) is null then '(なし)'
       else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text end, ',' order by t), '')
       from unnest(array['complete_orders', 'record_entitlements', 'complete_legacy_bindings', 'report_deliveries', 'account_report_registrations', 'legacy_access_blocks']) t)),
  ('api.anon_on_new_tables', (select count(*)::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname not in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements')
       and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))) || ' (0 であること)'),
  ('api.anon_exec_complete_functions', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'complete\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')) || ' (0 であること)'),
  ('ledger.reachable_from_api', case when to_regnamespace('element_release') is null then '(台帳なし)' else (has_schema_privilege('anon', 'element_release', 'USAGE') or has_schema_privilege('authenticated', 'element_release', 'USAGE') or has_schema_privilege('service_role', 'element_release', 'USAGE'))::text || ' (false であること)' end)
) v(k, v) order by k;

rollback;
