-- ============================================================
-- complete_05：運営者操作の監査ログ・旧 ¥1,000 購入権の手動確認（承認・却下）
-- 【実行禁止・草案】2026-10-07 改訂1（理由コードの意味を固定・照合 ID の冪等）。Preview（element-diagnosis-preview）専用。未適用。
-- 【本番では実行しない】本番は別ファイル・別承認。
-- 前提：complete_01（20261007111306）〜 complete_04（20261007213147）適用済み。PostgreSQL 17 以上。
-- 注意：Supabase の API 経路はトリガー・関数の削除文を含む本文を通さないため、本文に削除文を書かない
--       （create or replace／if not exists で二度当てに対応する）。
-- ============================================================
--
-- 方針
--   ・監査ログ（complete_admin_audit_log）は構造化した固定項目だけを持つ。
--     保存する：監査 ID・運営者の user ID・操作種別・対象種別・対象 ID・結果・理由コード・照合 ID（incident ID）・実行日時。
--     保存しない：メールアドレス・Stripe の秘密値・Checkout Session ID／PaymentIntent ID の全文・診断コード・回答・
--               MENTOR の本文・リクエスト本文・自由記述（自由記述の列を作らない。理由は固定の理由コードだけ）。
--   ・操作は旧購入権の手動承認・手動却下だけ。生成の再試行などの操作種別は、対応する関数を作る migration で追加する。
--   ・理由コードは操作・結果ごとに意味を固定する。
--       承認 applied：operator_verified ／ 承認 noop：already_bound
--       却下 rejected：email_mismatch・auth_email_missing・stripe_session_unavailable・purchase_not_eligible・identity_unverified
--       失敗 failed：invalid_request・record_not_found・legacy_purchase_not_found・binding_conflict・purchase_hash_mismatch・
--                   database_error・internal_error
--     未認証・未認可（運営者として確認される前のアクセス）はこの表に入れない（API のセキュリティログで扱う）。
--   ・照合 ID（incident_id）は NOT NULL・一意。同じ照合 ID の再送は新しい行を作らず、前回の結果を返す。
--     同じ照合 ID で運営者・操作・対象・内容が違えば complete_admin_incident_conflict（行を追加しない。API は 409）。
--   ・監査ログは追記だけ。UPDATE・DELETE・TRUNCATE はトリガーで拒否する（所有者でも）。
--     RLS 有効・ポリシーなし。anon・authenticated・PUBLIC は権限なし。service_role は SELECT・INSERT だけ。
--   ・運営者かどうかは DB では判断しない（API が Supabase JWT と環境変数 COMPLETE_ADMIN_USER_ID の完全一致で確認してから呼ぶ）。
--     actor_user_id は外部キーにしない（Auth の利用者が削除された後も監査記録を残す。表示時に存在しなくても削除・書き換えない）。
--   ・手動承認：complete_04 の complete_bind_legacy_purchase（照合方式 operator_verified）で所有者・有効性・
--     診断コードのハッシュ・一度だけの固定を確かめ、同じトランザクションで監査ログを追加する。
--     途中で失敗すれば結び付けも監査ログも取り消される（失敗は API が complete_admin_record_failure で別に残す）。
--   ・手動却下：結び付けは作らず、却下の理由コードだけを記録する。新しい照合 ID なら同じ購入権を再度却下できる。後で承認もできる。
--   ・関数はすべて SECURITY INVOKER・search_path = ''。呼び出し関数の EXECUTE は service_role だけ、トリガー関数は所有者だけ。
--
-- 戻し：complete_99_rollback_DRAFT_DO_NOT_RUN.sql（complete_05 の関数・表・トリガーも明示的に削除する）。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜04 の適用済みを確かめる
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  if to_regclass('public.complete_orders') is null or to_regclass('public.record_mentor_goals') is null then
    raise exception 'complete_01 is not applied';
  end if;
  if has_table_privilege('service_role', 'public.complete_orders', 'TRUNCATE') then
    raise exception 'complete_02 is not applied';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_sessions_owner_immutable' and not tgisinternal) then
    raise exception 'complete_03 is not applied';
  end if;
  if to_regclass('public.complete_legacy_bindings') is null
     or to_regprocedure('public.complete_bind_legacy_purchase(uuid, uuid, uuid, text)') is null then
    raise exception 'complete_04 is not applied';
  end if;
end
$$;

-- 1. 運営者操作の監査ログ（追記だけ・固定項目だけ）
create table if not exists public.complete_admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid not null,                     -- API が JWT と COMPLETE_ADMIN_USER_ID で確認した運営者（外部キーにしない）
  action         text not null check (action in ('legacy_binding_approve', 'legacy_binding_reject')),
  target_type    text not null check (target_type = 'legacy_entitlement'),
  target_id      uuid not null,
  outcome        text not null check (outcome in ('applied', 'noop', 'rejected', 'failed')),
  reason_code    text not null,
  incident_id    text not null check (incident_id ~ '^[0-9a-f]{12}$'),
  created_at     timestamptz not null default now(),
  constraint complete_admin_audit_log_incident_unique unique (incident_id),
  -- 理由コードは操作・結果ごとに意味を固定する（自由記述・未認証・未認可は入れない）
  constraint complete_admin_audit_log_reason_code check (
    (action = 'legacy_binding_approve' and outcome = 'applied' and reason_code = 'operator_verified')
    or (action = 'legacy_binding_approve' and outcome = 'noop' and reason_code = 'already_bound')
    or (action = 'legacy_binding_reject' and outcome = 'rejected'
        and reason_code in ('email_mismatch', 'auth_email_missing', 'stripe_session_unavailable',
                            'purchase_not_eligible', 'identity_unverified'))
    or (outcome = 'failed'
        and reason_code in ('invalid_request', 'record_not_found', 'legacy_purchase_not_found', 'binding_conflict',
                            'purchase_hash_mismatch', 'database_error', 'internal_error')))
);
create index if not exists complete_admin_audit_log_target_idx on public.complete_admin_audit_log (target_type, target_id, created_at desc);
create index if not exists complete_admin_audit_log_created_idx on public.complete_admin_audit_log (created_at desc);

revoke all on table public.complete_admin_audit_log from public, anon, authenticated;
revoke all on table public.complete_admin_audit_log from service_role;
grant select, insert on table public.complete_admin_audit_log to service_role;
alter table public.complete_admin_audit_log enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する）

-- 追記だけ：UPDATE・DELETE・TRUNCATE を拒否する（権限を持つ所有者による操作も止める）
create or replace function public.complete_admin_audit_log_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'complete_admin_audit_log_immutable' using errcode = '42501';
end;
$$;
revoke all on function public.complete_admin_audit_log_immutable() from public, anon, authenticated, service_role;
create or replace trigger complete_admin_audit_log_no_update
  before update or delete on public.complete_admin_audit_log
  for each row execute function public.complete_admin_audit_log_immutable();
create or replace trigger complete_admin_audit_log_no_truncate
  before truncate on public.complete_admin_audit_log
  for each statement execute function public.complete_admin_audit_log_immutable();

-- 2. 旧 ¥1,000 購入権の手動承認：結び付け（complete_04 の検査）と監査ログを1トランザクションで
--    戻り値：applied（新しく固定）／noop（同じ購入権・同じ記録へ固定済み）。
--    同じ照合 ID の再送は行を増やさず前回の結果（applied／noop／failed）を返す。内容が違えば complete_admin_incident_conflict。
--    例外（API が failed の理由コードへ対応付ける）：
--      complete_admin_invalid_request → invalid_request ／ complete_record_not_found → record_not_found ／
--      complete_legacy_purchase_not_found → legacy_purchase_not_found ／ complete_legacy_not_matched → purchase_hash_mismatch ／
--      complete_legacy_already_bound・complete_legacy_record_already_bound → binding_conflict
create or replace function public.complete_admin_approve_legacy_binding(
    p_actor_user_id uuid, p_user_id uuid, p_diagnosis_session_id uuid, p_legacy_entitlement_id uuid, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_admin_audit_log%rowtype;
  v_result text;
begin
  if p_actor_user_id is null or p_user_id is null or p_diagnosis_session_id is null or p_legacy_entitlement_id is null
     or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_admin_incident:' || p_incident_id, 0));
  select * into v_prev from public.complete_admin_audit_log a where a.incident_id = p_incident_id;
  if found then
    if v_prev.actor_user_id <> p_actor_user_id or v_prev.action <> 'legacy_binding_approve'
       or v_prev.target_id <> p_legacy_entitlement_id then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    if v_prev.outcome in ('applied', 'noop') and not exists (
         select 1 from public.complete_legacy_bindings b
          where b.legacy_entitlement_id = p_legacy_entitlement_id
            and b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id) then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.outcome;
  end if;
  if not exists (select 1 from public.purchase_entitlements e where e.id = p_legacy_entitlement_id) then
    raise exception 'complete_legacy_purchase_not_found' using errcode = '42501';
  end if;
  v_result := public.complete_bind_legacy_purchase(p_user_id, p_diagnosis_session_id, p_legacy_entitlement_id, 'operator_verified');
  insert into public.complete_admin_audit_log (actor_user_id, action, target_type, target_id, outcome, reason_code, incident_id)
  values (p_actor_user_id, 'legacy_binding_approve', 'legacy_entitlement', p_legacy_entitlement_id, v_result,
          case when v_result = 'applied' then 'operator_verified' else 'already_bound' end, p_incident_id);
  return v_result;
end;
$$;

-- 3. 旧 ¥1,000 購入権の手動却下：結び付けは作らず、却下の理由コードだけを記録する。戻り値：rejected
--    同じ照合 ID の再送は行を増やさず前回の結果を返す。内容（運営者・操作・対象・理由コード）が違えば complete_admin_incident_conflict。
--    例外：complete_admin_invalid_request・complete_admin_invalid_reason → invalid_request ／
--          complete_legacy_purchase_not_found → legacy_purchase_not_found ／ complete_legacy_already_bound → binding_conflict
create or replace function public.complete_admin_reject_legacy_binding(
    p_actor_user_id uuid, p_legacy_entitlement_id uuid, p_reason_code text, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_admin_audit_log%rowtype;
begin
  if p_actor_user_id is null or p_legacy_entitlement_id is null
     or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  if p_reason_code is null or p_reason_code not in ('email_mismatch', 'auth_email_missing', 'stripe_session_unavailable',
                                                   'purchase_not_eligible', 'identity_unverified') then
    raise exception 'complete_admin_invalid_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_admin_incident:' || p_incident_id, 0));
  select * into v_prev from public.complete_admin_audit_log a where a.incident_id = p_incident_id;
  if found then
    if v_prev.actor_user_id <> p_actor_user_id or v_prev.action <> 'legacy_binding_reject'
       or v_prev.target_id <> p_legacy_entitlement_id
       or (v_prev.outcome = 'rejected' and v_prev.reason_code <> p_reason_code) then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.outcome;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_legacy:' || p_legacy_entitlement_id::text, 0));
  if not exists (select 1 from public.purchase_entitlements e where e.id = p_legacy_entitlement_id) then
    raise exception 'complete_legacy_purchase_not_found' using errcode = '42501';
  end if;
  if exists (select 1 from public.complete_legacy_bindings b where b.legacy_entitlement_id = p_legacy_entitlement_id) then
    raise exception 'complete_legacy_already_bound' using errcode = '42501';
  end if;
  insert into public.complete_admin_audit_log (actor_user_id, action, target_type, target_id, outcome, reason_code, incident_id)
  values (p_actor_user_id, 'legacy_binding_reject', 'legacy_entitlement', p_legacy_entitlement_id, 'rejected', p_reason_code, p_incident_id);
  return 'rejected';
end;
$$;

-- 4. 失敗の記録（操作のトランザクションが取り消された後に、API が同じ照合 ID で別に呼ぶ）。戻り値：failed
--    理由コードは失敗用の一覧だけ（CHECK）。同じ照合 ID・同じ内容の再送は行を増やさない。内容が違えば complete_admin_incident_conflict。
create or replace function public.complete_admin_record_failure(
    p_actor_user_id uuid, p_action text, p_target_id uuid, p_reason_code text, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_admin_audit_log%rowtype;
begin
  if p_actor_user_id is null or p_target_id is null or p_incident_id is null then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_admin_incident:' || p_incident_id, 0));
  select * into v_prev from public.complete_admin_audit_log a where a.incident_id = p_incident_id;
  if found then
    if v_prev.actor_user_id <> p_actor_user_id or v_prev.action is distinct from p_action
       or v_prev.target_id <> p_target_id or v_prev.outcome <> 'failed' or v_prev.reason_code is distinct from p_reason_code then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return 'failed';
  end if;
  insert into public.complete_admin_audit_log (actor_user_id, action, target_type, target_id, outcome, reason_code, incident_id)
  values (p_actor_user_id, p_action, 'legacy_entitlement', p_target_id, 'failed', p_reason_code, p_incident_id);
  return 'failed';
end;
$$;

-- 5. 関数の権限：呼び出し関数の EXECUTE は service_role だけ
revoke all on function public.complete_admin_approve_legacy_binding(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_admin_reject_legacy_binding(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_admin_record_failure(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_admin_approve_legacy_binding(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_admin_reject_legacy_binding(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_admin_record_failure(uuid, text, uuid, text, text) to service_role;

-- 6. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  p text;
  f text;
begin
  foreach p in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('service_role', 'public.complete_admin_audit_log', p) then
      raise exception 'service_role lacks % on complete_admin_audit_log', p;
    end if;
  end loop;
  foreach p in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
    if has_table_privilege('service_role', 'public.complete_admin_audit_log', p) then
      raise exception 'service_role has % on complete_admin_audit_log', p;
    end if;
  end loop;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
    if has_table_privilege('anon', 'public.complete_admin_audit_log', p) or has_table_privilege('authenticated', 'public.complete_admin_audit_log', p) then
      raise exception 'anon or authenticated has % on complete_admin_audit_log', p;
    end if;
  end loop;
  foreach f in array array['public.complete_admin_approve_legacy_binding(uuid, uuid, uuid, uuid, text)',
                           'public.complete_admin_reject_legacy_binding(uuid, uuid, text, text)',
                           'public.complete_admin_record_failure(uuid, text, uuid, text, text)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.complete_admin_audit_log_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_admin_audit_log_immutable()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.complete_admin_audit_log_immutable()', 'EXECUTE') then
    raise exception 'trigger function is executable by an API role';
  end if;
  if exists (select 1 from pg_proc p2 where p2.pronamespace = 'public'::regnamespace
              and p2.proname in ('complete_admin_audit_log_immutable', 'complete_admin_approve_legacy_binding',
                                 'complete_admin_reject_legacy_binding', 'complete_admin_record_failure')
              and (p2.prosecdef or p2.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_05 function is not security invoker with empty search_path';
  end if;
  if (select count(*) from pg_proc p3 where p3.pronamespace = 'public'::regnamespace and p3.proname like 'complete\_admin\_%') <> 4 then
    raise exception 'unexpected complete_admin functions';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.complete_admin_audit_log'::regclass and not tgisinternal) <> 2 then
    raise exception 'unexpected triggers on complete_admin_audit_log';
  end if;
end
$$;

commit;
