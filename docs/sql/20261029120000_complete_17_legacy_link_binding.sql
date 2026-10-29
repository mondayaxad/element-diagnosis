-- complete_17：旧版（element-v1）の購入のマイページへの引き継ぎ（照合方式 link_possession を追加）
--   購入時の署名付きリンクを持つ人が、ログインして押したときに、旧購入（purchase_entitlements）を本人の記録へ結び付ける。
--   変えるのは次の2つだけ（データ・既存の行・権限は変えない）：
--     1. complete_legacy_bindings.match_method の許可値に 'link_possession' を足す
--     2. complete_bind_legacy_purchase の許可値に 'link_possession' を足す（関数の本体はほかに変えない）
--   Preview・本番とも同じ内容（Live／Test の差は無い）。二度実行しても同じ結果（冪等）。
begin;

do $$
begin
  if to_regclass('public.complete_legacy_bindings') is null
     or to_regprocedure('public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)') is null then
    raise exception 'complete_17 requires complete_04 (complete_legacy_bindings / complete_bind_legacy_purchase)';
  end if;
end
$$;

alter table public.complete_legacy_bindings drop constraint if exists complete_legacy_bindings_match_method_check;
alter table public.complete_legacy_bindings add constraint complete_legacy_bindings_match_method_check
  check (match_method in ('stripe_email_verified', 'operator_verified', 'link_possession'));

create or replace function public.complete_bind_legacy_purchase(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                p_legacy_entitlement_id uuid, p_match_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_binding public.complete_legacy_bindings%rowtype;
begin
  if p_match_method not in ('stripe_email_verified', 'operator_verified', 'link_possession') then
    raise exception 'complete_invalid_match_method' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_legacy:' || p_legacy_entitlement_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_binding from public.complete_legacy_bindings b where b.legacy_entitlement_id = p_legacy_entitlement_id;
  if found then
    if v_binding.user_id = p_user_id and v_binding.diagnosis_session_id = p_diagnosis_session_id then
      return 'noop';
    end if;
    raise exception 'complete_legacy_already_bound' using errcode = '42501';
  end if;
  if exists (select 1 from public.complete_legacy_bindings b where b.diagnosis_session_id = p_diagnosis_session_id) then
    raise exception 'complete_legacy_record_already_bound' using errcode = '42501';
  end if;
  insert into public.complete_legacy_bindings (legacy_entitlement_id, user_id, diagnosis_session_id, match_method)
  values (p_legacy_entitlement_id, p_user_id, p_diagnosis_session_id, p_match_method);
  return 'applied';
end;
$$;

-- 権限は complete_04 のまま（EXECUTE は service_role だけ）。作り直しで変わらないことを確かめる
revoke all on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) to service_role;

commit;
