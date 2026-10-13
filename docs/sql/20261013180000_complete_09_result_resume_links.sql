-- ============================================================
-- complete_09：診断結果の固有リンク（未ログインでも同じ診断結果へ戻る。/result#r=<秘密値>）
-- 2026-10-13。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】表・関数・権限の追加を含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴（supabase_migrations.schema_migrations）へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイルで行う。
-- 前提：complete_01〜08 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない（新しい表と関数の追加だけ）。
-- ============================================================
--
-- 方針
--   ・秘密値（256bit の乱数・base64url）はブラウザの URL フラグメント（#r=）にだけ置く。DB には SHA-256 のハッシュだけを保存する。
--   ・診断完了の時に、無料結果の保存値（回答・結果のスナップショット）を、ゲストの診断記録（diagnosis_sessions.user_id = NULL・
--     guest_created_at あり。complete_07 のゲスト購入と同じ形）として作り、固有リンクの行を1つ結び付ける。
--   ・固有リンクで開けるのは無料の診断結果だけ。解析レポート・完全解析の閲覧は、従来どおり毎回 DB で権利を確かめる（この表は使わない）。
--   ・保存期間：最後に開いた日から 180 日（開くたびに延長）。期限を過ぎたリンクは開けない。
--     購入の無い（注文・権利・生成物の無い）ゲストの診断記録は、リンクの期限切れの後に運営者の整理（complete_purge_result_links）で削除する。
--     購入のある記録は、購入の記録の保存方針（会計上・法令上必要な期間）に従い残す。
--   ・RLS 有効・ポリシーなし。anon・authenticated は権限なし。service_role は関数を通じて作成・照会する（SELECT・INSERT・UPDATE のみ。DELETE なし）。
--   ・関数はすべて SECURITY INVOKER・search_path = ''。整理の関数は運営者（SQL Editor）専用（API のロールは実行できない）。
--
-- 戻し：complete_97_rollback_09_DRAFT_DO_NOT_RUN.sql（実行禁止の草案）。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜08 の適用済みを確かめる
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
  if to_regprocedure('public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)') is null
     or to_regclass('public.legacy_access_blocks') is null then
    raise exception 'complete_01..08 are not applied';
  end if;
end
$$;

-- 1. 固有リンク（秘密値のハッシュ → ゲストの診断記録）
create table if not exists public.result_resume_links (
  token_hash            text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  diagnosis_session_id  uuid not null unique references public.diagnosis_sessions(id) on delete cascade,
  created_at            timestamptz not null default now(),
  last_opened_at        timestamptz,
  expires_at            timestamptz not null
);
create index if not exists result_resume_links_expires_idx on public.result_resume_links (expires_at);
revoke all on table public.result_resume_links from public, anon, authenticated, service_role;
grant select, insert, update on table public.result_resume_links to service_role;
alter table public.result_resume_links enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。anon・authenticated は権限なし）

-- 2. 作成：診断完了の時。無料結果の保存値でゲストの診断記録を作り、秘密値のハッシュを結び付ける
create or replace function public.complete_create_result_link(
    p_token_hash text,
    p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb,
    p_item_set_version text, p_scoring_version text, p_translation_model_version text,
    p_character_profile_version text, p_mirror_model_version text)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_result_link' using errcode = '22023';
  end if;
  v_id := public.complete_create_guest_record(p_answers_v2, p_encoded_answers, p_v2_scores, p_v2_rankings, p_mirror_snapshot,
                                              p_item_set_version, p_scoring_version, p_translation_model_version,
                                              p_character_profile_version, p_mirror_model_version);
  insert into public.result_resume_links (token_hash, diagnosis_session_id, expires_at)
  values (p_token_hash, v_id, now() + interval '180 days');
end;
$$;

-- 3. 照会：期限内のリンクだけ。開くたびに期限を延ばす。返すのは無料結果の表示に必要な保存値だけ（権利・注文は返さない）
create or replace function public.complete_open_result_link(p_token_hash text)
  returns table (diagnosis_session_id uuid, guest boolean, encoded_answers text, diagnosis_version text,
                 item_set_version text, scoring_version text, translation_model_version text,
                 character_profile_version text, mirror_model_version text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_sid uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  update public.result_resume_links l
     set last_opened_at = now(), expires_at = greatest(l.expires_at, now() + interval '180 days')
   where l.token_hash = p_token_hash and l.expires_at > now()
  returning l.diagnosis_session_id into v_sid;
  if v_sid is null then
    return;
  end if;
  return query
    select s.id, s.user_id is null, a.encoded_answers, r.diagnosis_version,
           r.item_set_version, r.scoring_version, r.translation_model_version,
           r.character_profile_version, r.mirror_model_version
      from public.diagnosis_sessions s
      join public.diagnosis_answers a on a.session_id = s.id
      join public.diagnosis_results r on r.session_id = s.id
     where s.id = v_sid;
end;
$$;

-- 4. 運営者の整理（SQL Editor）：期限切れのリンクを消し、購入の無い・リンクの無い古いゲストの診断記録を消す。
--    購入（注文・権利・生成物・旧購入の結び付け）のある記録は消さない。戻り値：消したリンク・記録の数
create or replace function public.complete_purge_result_links()
  returns table (links_deleted integer, records_deleted integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_links integer;
  v_records integer;
begin
  delete from public.result_resume_links l where l.expires_at <= now();
  get diagnostics v_links = row_count;
  with doomed as (
    select s.id from public.diagnosis_sessions s
     where s.user_id is null and s.guest_created_at is not null and s.guest_created_at < now() - interval '180 days'
       and not exists (select 1 from public.result_resume_links l where l.diagnosis_session_id = s.id)
       and not exists (select 1 from public.complete_orders o where o.diagnosis_session_id = s.id)
       and not exists (select 1 from public.record_entitlements e where e.diagnosis_session_id = s.id)
       and not exists (select 1 from public.complete_reports r where r.diagnosis_session_id = s.id)
       and not exists (select 1 from public.complete_legacy_bindings b where b.diagnosis_session_id = s.id)
  ), goals as (
    delete from public.record_mentor_goals g using doomed d where g.diagnosis_session_id = d.id
  )
  delete from public.diagnosis_sessions s using doomed d where s.id = d.id;
  get diagnostics v_records = row_count;
  return query select v_links, v_records;
end;
$$;

revoke all on function public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) to service_role;
revoke all on function public.complete_open_result_link(text) from public, anon, authenticated;
grant execute on function public.complete_open_result_link(text) to service_role;
revoke all on function public.complete_purge_result_links() from public, anon, authenticated, service_role;

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.result_resume_links'::regclass) then
    raise exception 'result_resume_links must have row level security';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'result_resume_links') then
    raise exception 'result_resume_links must not have policies';
  end if;
  if has_table_privilege('anon', 'public.result_resume_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.result_resume_links', 'SELECT')
     or has_table_privilege('service_role', 'public.result_resume_links', 'DELETE')
     or not has_table_privilege('service_role', 'public.result_resume_links', 'INSERT') then
    raise exception 'unexpected privileges on result_resume_links';
  end if;
  if has_function_privilege('service_role', 'public.complete_purge_result_links()', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_open_result_link(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_open_result_link(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_open_result_link(text)', 'EXECUTE') then
    raise exception 'unexpected privileges on complete_09 functions';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_create_result_link', 'complete_open_result_link', 'complete_purge_result_links')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_09 function is not security invoker with empty search_path';
  end if;
end
$$;

-- migration 履歴（SQL Editor で実行するため、ここで1行だけ追加する。二度当てしても増えない）
insert into supabase_migrations.schema_migrations (version, name)
values ('20261013180000', 'complete_09_result_resume_links')
on conflict (version) do nothing;

commit;
