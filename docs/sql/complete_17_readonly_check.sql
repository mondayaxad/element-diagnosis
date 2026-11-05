-- complete_17 の適用前後の読み取り確認（READONLY。何も変更しない。出力は項目と状態だけ）
begin read only;
select k, v from (values
  ('constraint', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'complete_legacy_bindings_match_method_check')),
  ('function_allows_link_possession', (position('link_possession' in pg_get_functiondef('public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)'::regprocedure)) > 0)::text),
  ('service_role_exec', has_function_privilege('service_role', 'public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)', 'EXECUTE')::text),
  ('anon_exec', has_function_privilege('anon', 'public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)', 'EXECUTE')::text || ' (false であること)'),
  ('authenticated_exec', has_function_privilege('authenticated', 'public.complete_bind_legacy_purchase(uuid,uuid,uuid,text)', 'EXECUTE')::text || ' (false であること)'),
  ('bindings_total', (select count(*)::text from public.complete_legacy_bindings)),
  ('bindings_link_possession', (select count(*)::text from public.complete_legacy_bindings where match_method = 'link_possession')),
  ('purchase_entitlements_rows', (select count(*)::text from public.purchase_entitlements))
) t(k, v);
rollback;
