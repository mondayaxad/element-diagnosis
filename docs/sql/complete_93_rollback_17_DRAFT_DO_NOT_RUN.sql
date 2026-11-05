-- complete_17 の戻し（草案。実行しない）。link_possession の結び付けが 0 件であることを確かめてから、制約と関数を元に戻す。
begin;
do $$
begin
  if exists (select 1 from public.complete_legacy_bindings where match_method = 'link_possession') then
    raise exception 'link_possession bindings exist: do not roll back (they would violate the old constraint)';
  end if;
end
$$;
alter table public.complete_legacy_bindings drop constraint if exists complete_legacy_bindings_match_method_check;
alter table public.complete_legacy_bindings add constraint complete_legacy_bindings_match_method_check
  check (match_method in ('stripe_email_verified', 'operator_verified'));
-- 関数は complete_04 の定義へ戻す（許可値から link_possession を外す）
create or replace function public.complete_bind_legacy_purchase(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                p_legacy_entitlement_id uuid, p_match_method text)
  returns text language plpgsql security invoker set search_path = ''
as $$
declare
  v_binding public.complete_legacy_bindings%rowtype;
begin
  if p_match_method not in ('stripe_email_verified', 'operator_verified') then
    raise exception 'complete_invalid_match_method' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_legacy:' || p_legacy_entitlement_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_binding from public.complete_legacy_bindings b where b.legacy_entitlement_id = p_legacy_entitlement_id;
  if found then
    if v_binding.user_id = p_user_id and v_binding.diagnosis_session_id = p_diagnosis_session_id then return 'noop'; end if;
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
revoke all on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) to service_role;
commit;
