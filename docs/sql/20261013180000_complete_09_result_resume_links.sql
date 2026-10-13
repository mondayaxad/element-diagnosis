-- ============================================================
-- complete_09：診断結果の固有リンク（未ログインでも同じ診断結果へ戻る。/result#r=<秘密値>）
-- 2026-10-13。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】表・関数・権限の追加を含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴（supabase_migrations.schema_migrations）へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイルで行う。
-- 前提：onboarding_01・complete_01〜08 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない（新しい表と関数の追加、登録完了の関数の版の更新だけ）。
-- 旧版の complete_09（固有リンクの作成関数が 11 引数の版）を当てた DB にも、そのまま当てられる（作成関数を置き換える）。
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
--   ・大量作成の防止：
--       冪等：秘密値はブラウザが作り（256bit）、同じ秘密値での作成は同じリンクを返す（再送・連打で記録もリンクも増えない）。
--       回数：接続元ごと（IP アドレスをサーバーの鍵で HMAC-SHA256 にした値。IP アドレスそのものは保存しない）に、
--             10 分で 10 件・24 時間で 100 件まで。超えたら作らない（API は 429）。回数の行は 24 時間を過ぎたら消す。
--   ・登録完了の同意版：プライバシーポリシーを 2026-10-13 版に改定（固有リンクの追記）。利用規約は 2026-10-07 のまま。
--     今後の新規の同意だけを 2026-10-13 で記録する（既存の利用者の同意の記録は書き換えない）。
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
     or to_regclass('public.legacy_access_blocks') is null
     or to_regprocedure('public.complete_registration_onboarding(text, text, text)') is null then
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

-- 1b. 作成の回数（接続元の鍵付きハッシュ × 1 分の区切り）。24 時間を過ぎた行は作成の時に消す
create table if not exists public.result_link_rate (
  rate_key  text not null check (rate_key ~ '^[0-9a-f]{64}$'),
  bucket    timestamptz not null,
  n         integer not null check (n > 0),
  primary key (rate_key, bucket)
);
create index if not exists result_link_rate_bucket_idx on public.result_link_rate (bucket);
revoke all on table public.result_link_rate from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.result_link_rate to service_role;
alter table public.result_link_rate enable row level security;

-- 2. 作成：診断完了の時。無料結果の保存値でゲストの診断記録を作り、秘密値のハッシュを結び付ける
--    同じ秘密値の再送は、同じ診断結果なら 'existing' を返すだけ（記録・リンク・回数を増やさない）。違う診断結果なら拒否する。
--    新しく作る時だけ回数を数え、上限を超えたら complete_result_link_rate_limited（記録もリンクも作らない）。
drop function if exists public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text);
create or replace function public.complete_create_result_link(
    p_token_hash text, p_rate_key text,
    p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb,
    p_item_set_version text, p_scoring_version text, p_translation_model_version text,
    p_character_profile_version text, p_mirror_model_version text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_sid uuid;
  v_expires timestamptz;
  v_short integer;
  v_day integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$'
     or p_encoded_answers is null or p_encoded_answers !~ '^[0-9a-z]+$' or length(p_encoded_answers) not between 8 and 400 then
    raise exception 'complete_invalid_result_link' using errcode = '22023';
  end if;
  -- 同じ秘密値の同時の作成を1つずつ処理する（二重に記録を作らない）
  perform pg_advisory_xact_lock(hashtextextended('complete_result_link:' || p_token_hash, 0));
  select l.diagnosis_session_id, l.expires_at into v_sid, v_expires
    from public.result_resume_links l where l.token_hash = p_token_hash;
  if v_sid is not null then
    if v_expires > now() and exists (select 1 from public.diagnosis_answers a
                                       where a.session_id = v_sid and a.encoded_answers = p_encoded_answers) then
      return 'existing';
    end if;
    raise exception 'complete_result_link_conflict' using errcode = '23505';
  end if;

  -- 回数（同じ接続元の同時の作成を1つずつ数える）
  perform pg_advisory_xact_lock(hashtextextended('complete_result_link_rate:' || p_rate_key, 0));
  delete from public.result_link_rate r where r.bucket < now() - interval '24 hours';
  select coalesce(sum(r.n) filter (where r.bucket >= now() - interval '10 minutes'), 0), coalesce(sum(r.n), 0)
    into v_short, v_day
    from public.result_link_rate r where r.rate_key = p_rate_key;
  if v_short >= 10 or v_day >= 100 then
    raise exception 'complete_result_link_rate_limited' using errcode = '54000';
  end if;
  insert into public.result_link_rate as r (rate_key, bucket, n)
  values (p_rate_key, date_trunc('minute', now()), 1)
  on conflict (rate_key, bucket) do update set n = r.n + 1;

  v_id := public.complete_create_guest_record(p_answers_v2, p_encoded_answers, p_v2_scores, p_v2_rankings, p_mirror_snapshot,
                                              p_item_set_version, p_scoring_version, p_translation_model_version,
                                              p_character_profile_version, p_mirror_model_version);
  insert into public.result_resume_links (token_hash, diagnosis_session_id, expires_at)
  values (p_token_hash, v_id, now() + interval '180 days');
  return 'created';
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
  delete from public.result_link_rate r where r.bucket < now() - interval '24 hours';
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

revoke all on function public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) to service_role;
revoke all on function public.complete_open_result_link(text) from public, anon, authenticated;
grant execute on function public.complete_open_result_link(text) to service_role;
revoke all on function public.complete_purge_result_links() from public, anon, authenticated, service_role;

-- 5. 登録完了の同意版：プライバシーポリシーだけ 2026-10-13 にする（利用規約・お知らせメールの版は変えない）。
--    onboarding_01 の関数の本文から、プライバシーポリシーの版の比較だけを変える（既存の行は書き換えない。権限は置き換えでも保たれる）。
create or replace function public.complete_registration_onboarding(
  p_terms_version text,
  p_privacy_version text,
  p_newsletter_consent_version text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_terms_version is distinct from '2026-10-07'
     or p_privacy_version is distinct from '2026-10-13'
     or p_newsletter_consent_version is distinct from '2026-10-07-v1' then
    raise exception 'unsupported_consent_version' using errcode = '22023';
  end if;

  select onboarding_status into v_status from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'required' then
    update public.profiles
       set onboarding_status          = 'completed',
           onboarding_completed_at    = now(),
           terms_accepted_at          = now(),
           terms_version              = p_terms_version,
           privacy_accepted_at        = now(),
           privacy_version            = p_privacy_version,
           newsletter_opted_in        = true,
           newsletter_opted_in_at     = now(),
           newsletter_consent_source  = 'registration_onboarding',
           newsletter_consent_version = p_newsletter_consent_version,
           newsletter_sync_status     = 'pending',
           updated_at                 = now()
     where id = v_uid;
  elsif v_status <> 'completed' then
    raise exception 'onboarding_not_required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'onboarding_status', onboarding_status,
      'newsletter_sync_status', newsletter_sync_status)
      from public.profiles where id = v_uid);
end;
$$;
revoke all on function public.complete_registration_onboarding(text, text, text) from public, anon;
grant execute on function public.complete_registration_onboarding(text, text, text) to authenticated;

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
     or has_function_privilege('anon', 'public.complete_create_result_link(text, text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_open_result_link(text)', 'EXECUTE') then
    raise exception 'unexpected privileges on complete_09 functions';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.result_link_rate'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'result_link_rate')
     or has_table_privilege('anon', 'public.result_link_rate', 'SELECT')
     or has_table_privilege('authenticated', 'public.result_link_rate', 'SELECT') then
    raise exception 'unexpected security on result_link_rate';
  end if;
  if to_regprocedure('public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)') is not null then
    raise exception 'old complete_create_result_link remains';
  end if;
  if has_function_privilege('anon', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.complete_registration_onboarding(text, text, text)', 'EXECUTE')
     or position('2026-10-13' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) = 0 then
    raise exception 'unexpected complete_registration_onboarding';
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
