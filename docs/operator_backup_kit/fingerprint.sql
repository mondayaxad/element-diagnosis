-- 読み取り専用。個人情報・ID・回答・決済IDは出力しない（件数・合計・ハッシュのみ）。
\set QUIET on
set session characteristics as transaction read only;
set default_transaction_read_only = on;
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
select 'rows', n.nspname || '.' || c.relname,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname in ('public','auth','storage')
order by 2;
select 'struct', 'public_tables', count(*)::text from pg_tables where schemaname = 'public';
select 'struct', 'public_rls_on', string_agg(c.relname || ':' || c.relrowsecurity || '/' || c.relforcerowsecurity, ',' order by c.relname)
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';
select 'fp', 'public_columns', count(*) || ' ' || coalesce(md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' order by table_name, column_name)), '-')
  from information_schema.columns where table_schema = 'public';
select 'fp', 'public_functions', count(*) || ' ' || coalesce(md5(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef, ',' order by p.proname, pg_get_function_identity_arguments(p.oid))), '-')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f';
select 'fp', 'public_policies', count(*) || ' ' || coalesce(md5(string_agg(tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles, '|')||':'||coalesce(qual,'')||':'||coalesce(with_check,''), ',' order by tablename, policyname)), '-')
  from pg_policies where schemaname = 'public';
select 'fp', 'public_constraints', count(*) || ' ' || coalesce(md5(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname)), '-')
  from pg_constraint where connamespace = 'public'::regnamespace;
select 'fp', 'public_indexes', count(*) || ' ' || coalesce(md5(string_agg(indexdef, ',' order by indexname)), '-') from pg_indexes where schemaname = 'public';
select 'fp', 'public_triggers', count(*) || ' ' || coalesce(md5(string_agg(tgrelid::regclass::text||'.'||tgname||':'||pg_get_triggerdef(t.oid), ',' order by tgrelid::regclass::text, tgname)), '-')
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal;
select 'fp', 'auth_users_triggers', count(*) || ' ' || coalesce(md5(string_agg(t.tgname||':'||pg_get_triggerdef(t.oid), ',' order by t.tgname)), '-')
  from pg_trigger t where t.tgrelid = to_regclass('auth.users') and not t.tgisinternal;
select 'fp', 'public_table_grants', count(*) || ' ' || coalesce(md5(string_agg(table_name||':'||grantee||':'||privilege_type, ',' order by table_name, grantee, privilege_type)), '-')
  from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','service_role');
select 'fn', p.proname, md5(pg_get_functiondef(p.oid))
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('handle_new_user','save_diagnosis_session','save_diagnosis_session_v2') order by 2;
select 'pe', split_part(stripe_checkout_session_id, '_', 1) || '_' || split_part(stripe_checkout_session_id, '_', 2),
       count(*) || ' sum=' || coalesce(sum(amount),0) || ' status=' || string_agg(distinct status, '|') || ' types=' || string_agg(distinct product_type, '|')
       || ' hashfp=' || md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status))
  from public.purchase_entitlements group by 2 order by 2;
select 'storage', 'buckets', (select count(*) from storage.buckets)::text;
select 'storage', 'objects', (select count(*) from storage.objects)::text;
