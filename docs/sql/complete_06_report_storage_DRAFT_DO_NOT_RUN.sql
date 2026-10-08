-- ============================================================
-- complete_06：完全解析レポートの生成ジョブ（取得・完了・失敗）と閲覧の権限確認
-- 【実行禁止・草案】2026-10-08。Preview（element-diagnosis-preview）専用。未適用。
-- 【本番では実行しない】本番は別ファイル・別承認。
-- 前提：complete_01（20261007111306）〜 complete_05（20261007234325）適用済み。PostgreSQL 17 以上。
-- 注意：Supabase の API 経路はトリガー・関数の削除文を含む本文を通さないため、本文に削除文を書かない
--       （create or replace／if not exists で二度当てに対応する）。
-- ============================================================
--
-- 方針
--   ・生成は complete_reports の1行ごとの貸し出し（lease）で1つの処理だけが行う。取得は for update skip locked。
--     queued・再試行時刻を過ぎた failed（attempts < max_attempts）・lease の切れた generating だけを取得できる。
--   ・保存先は非公開 bucket の reports/<report_id>/<試行回数>-<乱数32桁>.html。置き場所は API の応答・ログに出さない。
--     ready にするのは、保存に成功し、lease を持ったままの時だけ（complete_finish_report）。
--     途中で失敗した・lease を失った・返金等で revoked になった場合、API は保存した物を消す（DB は ready にしない）。
--     取得のたびに API は reports/<report_id>/ の下を消してから保存する（中断した試行の残りを残さない）。
--   ・失敗：再試行できる失敗は failed（next_retry_at は 1分・2分・4分…最大1時間）。再試行できない失敗は attempts を
--     max_attempts にして止める。理由コードだけを記録する（本文・パス・ID を記録しない）。
--   ・閲覧：本人の記録で、生成物が ready（失効・隔離なし）、注文が paid、完全解析権（complete）が active の時だけ
--     保存先を返す（complete_report_for_view）。suspended（dispute 中）・revoked（返金・敗訴）では返さない。
--   ・関数はすべて SECURITY INVOKER・search_path = ''。EXECUTE は service_role だけ（anon・authenticated・PUBLIC なし）。
--   ・非公開 bucket（complete-reports）の作成は、この SQL ではなく別の手順（Storage API・別承認）で行う。
--
-- 戻し：complete_99_rollback_DRAFT_DO_NOT_RUN.sql（complete_06 の関数も明示的に削除する）。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜05 の適用済みを確かめる
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
  if to_regclass('public.complete_reports') is null or to_regprocedure('public.claim_complete_report_job(integer)') is null then
    raise exception 'complete_01 is not applied';
  end if;
  if has_table_privilege('service_role', 'public.complete_reports', 'TRUNCATE') then
    raise exception 'complete_02 is not applied';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'diagnosis_sessions_owner_immutable' and not tgisinternal) then
    raise exception 'complete_03 is not applied';
  end if;
  if to_regprocedure('public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)') is null then
    raise exception 'complete_04 is not applied';
  end if;
  if to_regclass('public.complete_admin_audit_log') is null then
    raise exception 'complete_05 is not applied';
  end if;
end
$$;

-- 1. 保存先の形式（reports/<自分の report_id>/<試行回数>-<乱数32桁>.html だけ）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'complete_reports_storage_path_format'
                   and conrelid = 'public.complete_reports'::regclass) then
    alter table public.complete_reports add constraint complete_reports_storage_path_format check (
      storage_path is null or storage_path ~ ('^reports/' || id::text || '/[0-9]{1,2}-[0-9a-f]{32}\.html$'));
  end if;
end
$$;

-- 2. 生成ジョブの取得：p_report_id を指定すればその行だけ、null なら期限の来た最も古い行。取れなければ0行。
create or replace function public.complete_claim_report(p_report_id uuid, p_lease_seconds integer default 120)
  returns table (report_id uuid, lease_token uuid, attempt integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
  v_attempt integer;
begin
  select r.id into v_id
    from public.complete_reports r
   where (p_report_id is null or r.id = p_report_id)
     and (r.status = 'queued'
          or (r.status = 'failed' and r.attempts < r.max_attempts and r.next_retry_at <= now())
          or (r.status = 'generating' and r.lease_expires_at < now() and r.attempts < r.max_attempts))
   order by r.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  update public.complete_reports
     set status = 'generating', attempts = attempts + 1, lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
         generating_at = now(), updated_at = now()
   where id = v_id
  returning attempts into v_attempt;
  return query select v_id, v_token, v_attempt;
end;
$$;

-- 3. 生成の完了：lease を持ったまま generating の時だけ ready にする。戻り値：ready／lost_lease／revoked
create or replace function public.complete_finish_report(p_report_id uuid, p_lease_token uuid, p_storage_path text, p_output_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
begin
  if p_output_sha256 is null or p_output_sha256 !~ '^[0-9a-f]{64}$'
     or p_storage_path is null or p_storage_path !~ ('^reports/' || p_report_id::text || '/[0-9]{1,2}-[0-9a-f]{32}\.html$') then
    raise exception 'complete_invalid_report_output' using errcode = '22023';
  end if;
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'complete_report_not_found' using errcode = '42501';
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null then
    return 'revoked';
  end if;
  if v_report.status <> 'generating' or v_report.lease_token is distinct from p_lease_token then
    return 'lost_lease';
  end if;
  update public.complete_reports
     set status = 'ready', storage_path = p_storage_path, output_sha256 = p_output_sha256, ready_at = now(),
         lease_token = null, lease_expires_at = null, last_error_code = null, next_retry_at = null, updated_at = now()
   where id = p_report_id;
  return 'ready';
end;
$$;

-- 4. 生成の失敗：lease を持ったまま generating の時だけ failed にする。戻り値：failed／stopped／lost_lease／revoked
create or replace function public.complete_fail_report(p_report_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_stop boolean;
begin
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'complete_invalid_error_code' using errcode = '22023';
  end if;
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'complete_report_not_found' using errcode = '42501';
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null then
    return 'revoked';
  end if;
  if v_report.status <> 'generating' or v_report.lease_token is distinct from p_lease_token then
    return 'lost_lease';
  end if;
  v_stop := not coalesce(p_retryable, false) or v_report.attempts >= v_report.max_attempts;
  update public.complete_reports
     set status = 'failed', failed_at = now(), last_error_code = p_error_code,
         attempts = case when v_stop then greatest(v_report.attempts, v_report.max_attempts) else v_report.attempts end,
         next_retry_at = case when v_stop then null
                              else now() + make_interval(secs => least(3600, 60 * power(2, greatest(v_report.attempts - 1, 0))::integer)) end,
         lease_token = null, lease_expires_at = null, updated_at = now()
   where id = p_report_id;
  return case when v_stop then 'stopped' else 'failed' end;
end;
$$;

-- 5. 閲覧の権限確認：本人の記録・生成物 ready（失効・隔離なし）・注文 paid・完全解析権 active の時だけ保存先を返す。
--    state：ok／not_found（本人の生成物が無い）／not_entitled（権利が active でない・注文が paid でない）／not_ready（生成中・失敗）
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order_status text;
  v_entitled boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id = p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select o.status into v_order_status from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id = p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id = p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order_status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;

-- 6. 関数の権限：EXECUTE は service_role だけ
revoke all on function public.complete_claim_report(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_finish_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_fail_report(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.complete_report_for_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_claim_report(uuid, integer) to service_role;
grant execute on function public.complete_finish_report(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_fail_report(uuid, uuid, text, boolean) to service_role;
grant execute on function public.complete_report_for_view(uuid, uuid) to service_role;

-- 7. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  f text;
begin
  foreach f in array array['public.complete_claim_report(uuid, integer)', 'public.complete_finish_report(uuid, uuid, text, text)',
                           'public.complete_fail_report(uuid, uuid, text, boolean)', 'public.complete_report_for_view(uuid, uuid)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_claim_report', 'complete_finish_report', 'complete_fail_report', 'complete_report_for_view')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_06 function is not security invoker with empty search_path';
  end if;
  if has_table_privilege('service_role', 'public.complete_reports', 'DELETE') or has_table_privilege('service_role', 'public.complete_reports', 'TRUNCATE')
     or has_table_privilege('anon', 'public.complete_reports', 'SELECT') or has_table_privilege('authenticated', 'public.complete_reports', 'SELECT') then
    raise exception 'unexpected privileges on complete_reports';
  end if;
end
$$;

commit;
