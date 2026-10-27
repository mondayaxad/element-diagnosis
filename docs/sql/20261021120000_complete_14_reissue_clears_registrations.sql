-- complete_14：レポート固有リンクの再発行で、古いリンクで登録したマイページの閲覧も止める（Preview 専用）
--
--   ・運営者が complete_admin_reissue_delivery でリンクを再発行すると、その納品をマイページに登録していたアカウントの閲覧を消す
--     （古いリンクを知る第三者が登録していても、再発行で閲覧を止められるように）。購入者は新しいリンクで登録し直す。
--   ・関数は SQL Editor 専用のまま（anon・authenticated・service_role は実行できない）。SECURITY INVOKER・search_path = ''。
--   ・表・既存の行は変えない（関数の置き換えだけ）。

begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020120000')
     or to_regprocedure('public.complete_admin_reissue_delivery(uuid, text)') is null then
    raise exception 'complete_13 is not applied';
  end if;
end
$$;

create or replace function public.complete_admin_reissue_delivery(p_delivery_id uuid, p_new_link_token_hash text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_new_link_token_hash is null or p_new_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  update public.report_deliveries
     set link_token_hash = p_new_link_token_hash, reissue_count = reissue_count + 1, reissued_at = now(),
         status = 'active', revoked_at = null, revoke_reason = null, updated_at = now()
   where id = p_delivery_id;
  if not found then
    return 'not_found';
  end if;
  -- 古いリンクで登録したマイページの閲覧を止める（購入者は新しいリンクで登録し直す）
  delete from public.account_report_registrations where delivery_id = p_delivery_id;
  return 'reissued';
end;
$$;
revoke all on function public.complete_admin_reissue_delivery(uuid, text) from public, anon, authenticated, service_role;

do $$
begin
  if has_function_privilege('service_role', 'public.complete_admin_reissue_delivery(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_admin_reissue_delivery(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_admin_reissue_delivery(uuid, text)', 'EXECUTE') then
    raise exception 'unexpected function privileges after complete_14';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'complete_admin_reissue_delivery'
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_14 function is not security invoker with empty search_path';
  end if;
end
$$;

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261021120000', 'complete_14_reissue_clears_registrations')
on conflict (version) do nothing;

commit;
