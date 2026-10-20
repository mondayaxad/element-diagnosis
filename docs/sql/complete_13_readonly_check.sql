-- complete_13 の適用の前後に Preview の SQL Editor で実行する確認（読み取りだけ。行を変えない）。
-- 適用の前と後で、既存の表の行数とチェックサムが同じであることを比べる（complete_reports は追加した via_link 列を除いて比べる）。
-- 秘密値・メールアドレス・Stripe の ID は出さない（件数と先頭10桁のハッシュだけ）。
select t, n, h from (
  select 'complete_orders' t, count(*) n, left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) h from public.complete_orders x
  union all select 'record_entitlements', count(*), left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) from public.record_entitlements x
  union all select 'complete_reports', count(*), left(md5(coalesce(string_agg((to_jsonb(x) - 'via_link')::text, '|' order by (to_jsonb(x) - 'via_link')::text), '')), 10) from public.complete_reports x
  union all select 'record_mentor_goals', count(*), left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) from public.record_mentor_goals x
  union all select 'diagnosis_sessions', count(*), left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) from public.diagnosis_sessions x
  union all select 'stripe_webhook_events', count(*), left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) from public.stripe_webhook_events x
  union all select 'purchase_entitlements', count(*), left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) from public.purchase_entitlements x
  union all select 'result_resume_links', count(*), left(md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')), 10) from public.result_resume_links x
) s order by t;

-- 適用の後だけ（適用の前は表が無いためエラーになる）：新しい表は空・RLS 有効・ポリシー無し・履歴は1行
-- select (select count(*) from public.report_deliveries) deliveries, (select count(*) from public.account_report_registrations) registrations,
--        (select count(*) from public.complete_reports where via_link) via_link_reports,
--        (select bool_and(relrowsecurity) from pg_class where oid in ('public.report_deliveries'::regclass, 'public.account_report_registrations'::regclass)) rls,
--        (select count(*) from pg_policies where tablename in ('report_deliveries', 'account_report_registrations')) policies,
--        (select count(*) from supabase_migrations.schema_migrations where version = '20261020120000') history;
