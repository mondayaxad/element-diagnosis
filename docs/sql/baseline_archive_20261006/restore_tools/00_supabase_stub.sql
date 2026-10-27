-- ローカル検査専用：Supabase が用意するものの最小の代用品（成果物ではない・実 Supabase では実行しない）
-- ロールはクラスター全体で共有されるため、無いときだけ作る
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  -- Supabase Auth が auth.users に書き込むときのロール
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
create schema extensions;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public, extensions to anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, insert, delete on auth.users to supabase_auth_admin;
-- Supabase の既定権限の再現（新しいテーブルに anon・authenticated・service_role の全権限が付く）
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
