-- 実行禁止の草案：jagan_01 の戻し（Preview）。保存結果・共有・購入権限の表を消す（データも消える）。
-- 実行する前に、jagan_entitlements に行が無いこと（販売していないこと）と、消してよいことを運営者が確かめる。
begin;
do $$
begin
  if public.deployment_environment() is distinct from 'preview' then raise exception 'not a preview database'; end if;
  if exists (select 1 from public.jagan_entitlements) then raise exception 'jagan entitlements exist'; end if;
end
$$;
drop table if exists public.jagan_entitlements;
drop table if exists public.jagan_shares;
drop table if exists public.jagan_results;
delete from supabase_migrations.schema_migrations where version = '20261102120000';
commit;
