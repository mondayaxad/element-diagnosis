-- 実行禁止の草案：type_report_01 の戻し（Preview）。タイプ別レポートの注文の表と関数を消す（データも消える）。
-- 実行する前に、支払い済みの注文が無いこと（販売していないこと）と、消してよいことを運営者が確かめる。
begin;
do $$
begin
  if public.deployment_environment() is distinct from 'preview' then raise exception 'not a preview database'; end if;
  if exists (select 1 from public.type_report_orders where status in ('paid', 'refunded', 'disputed')) then
    raise exception 'paid type report orders exist';
  end if;
end
$$;
drop function if exists public.type_report_apply_reversal(uuid, text);
drop function if exists public.type_report_close_order(uuid, text, text);
drop function if exists public.type_report_apply_payment(uuid, text, text, integer, text, text, boolean);
drop function if exists public.type_report_mark_checkout_open(uuid, text);
drop function if exists public.type_report_create_order(text, text, text, text, text, text);
drop table if exists public.type_report_orders;
delete from supabase_migrations.schema_migrations where version = '20261125120000';
commit;
