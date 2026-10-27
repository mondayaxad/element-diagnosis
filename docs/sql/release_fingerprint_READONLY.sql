-- リリース前後・バックアップ／復元の照合用フィンガープリント（READ ONLY。SELECT だけ。値そのものは出さず、件数と md5 だけを返す）
-- 使い方：Production 適用前・適用後、バックアップ元・復元先で同じ SQL を実行し、結果を突き合わせる（RELEASE_BACKUP_AND_ROLLBACK_RUNBOOK §4）。
-- 並び順は collate "C" に固定している（データベースの既定照合順序が違っても同じ md5 になる）。
with
cols as (select c.relname||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') x
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind in ('r','p','v') and a.attnum>0 and a.atttypid<>0),
cons as (select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) x from pg_constraint where connamespace='public'::regnamespace),
idx as (select pg_get_indexdef(i.indexrelid) x from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace),
fn as (select p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef||':'||coalesce(array_to_string(p.proconfig,','),'') x from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p')),
fnacl as (select p.oid::regprocedure::text||':'||coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a where a::text ~ '^(anon|authenticated|service_role|supabase_auth_admin|)='),'') x from pg_proc p where p.pronamespace='public'::regnamespace),
trg as (select tg.tgrelid::regclass::text||'.'||tg.tgname||':'||pg_get_triggerdef(tg.oid) x from pg_trigger tg join pg_class c on c.oid=tg.tgrelid where not tg.tgisinternal and (c.relnamespace='public'::regnamespace or (c.relnamespace='auth'::regnamespace and c.relname='users'))),
pol as (select schemaname||'.'||tablename||'.'||policyname||':'||permissive||':'||array_to_string(roles,',')||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') x from pg_policies where schemaname='public'),
rls as (select relname||':'||relrowsecurity||':'||relforcerowsecurity x from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')),
grt as (select table_name||':'||grantee||':'||privilege_type x from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role','supabase_auth_admin')),
mig as (select version||':'||name x from supabase_migrations.schema_migrations),
bkt as (select jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)::text x from storage.buckets),
au as (select id::text x from auth.users),
parts as (
  select 'schema.columns' k, count(*) n, md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) h from cols
  union all select 'schema.constraints', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from cons
  union all select 'schema.indexes', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from idx
  union all select 'functions', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from fn
  union all select 'functions.grants', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from fnacl
  union all select 'triggers', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from trg
  union all select 'rls.policies', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from pol
  union all select 'rls.enabled', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from rls
  union all select 'table.grants', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from grt
  union all select 'migration_history', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from mig
  union all select 'storage.buckets', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from bkt
  union all select 'auth.users.ids', count(*), md5(coalesce(string_agg(x, E'\n' order by x collate "C"),'')) from au
)
select k, n, h from parts
union all
select 'data.'||c.relname, (xpath('/row/n/text()', q))[1]::text::bigint, (xpath('/row/h/text()', q))[1]::text
from pg_class c, lateral query_to_xml(format('select count(*) n, md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text collate "C"),'''')) h from public.%I t', c.relname), false, true, '') q
where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
order by 1;
