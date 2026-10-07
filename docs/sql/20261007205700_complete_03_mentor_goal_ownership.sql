-- ============================================================
-- complete_03：MENTOR 目標の所有者整合と、決済中・支払後の変更防止（DB 側の保証）
-- 【実行禁止・草案】2026-10-07 改訂2（改訂1＋トリガー作成を create or replace trigger に変更。Supabase の API 経路がトリガー削除文を含む本文を通さないため）。Preview（element-diagnosis-preview）専用。未適用。
-- 【本番では実行しない】本番は別ファイル・別承認。
-- 前提：complete_01（20261007111306）・complete_02（20261007113230）適用済み。PostgreSQL 17 以上。
-- ============================================================
--
-- 背景
--   complete_01 の record_mentor_goals は、user_id が記録（diagnosis_sessions）の所有者と一致することを
--   DB で確かめていない（注文作成時のトリガーで目標と注文の user_id の一致を見るだけ）。
--   API で照合する予定だが、DB でも保証する（二層目）。あわせて、決済待ちの注文がある間の目標変更を DB で止め、
--   同じ目標の再送で selected_at が動かないようにする（注文へ写した値と記録の値をずらさない）。
--
-- 内容（トリガー2つ。表・列・制約・権限は変えない）
-- A. record_mentor_goals：BEFORE INSERT OR UPDATE で、complete_01 の record_mentor_goals_guard（支払後ロック）より先に動く
--   （同じ時点のトリガーは名前順に動く。'record_mentor_goals_0_…' < 'record_mentor_goals_guard'）。
--   1. 所有者：INSERT・UPDATE のたびに（変更された列に関係なく）、NEW の (diagnosis_session_id, user_id) が
--      diagnosis_sessions の (id, user_id) と一致することを確かめ、一致しなければ拒否する。
--      他人の記録と存在しない記録は同じ誤り（mentor_goal_record_not_found・42501・DETAIL なし）にする。
--      外部キーの検査（行の作成後）より前に動くため、存在しない記録でも外部キー違反の情報は返らない。
--   2. 同じ目標の再送（UPDATE で goal_id・goal_catalog_version が変わらない）：1 の所有者確認を通った後でだけ、
--      selected_at を元の値に戻す。
--      → 冪等。支払後（locked_at あり）の同じ目標の再送も、変更なしとして通る。
--   3. 目標を変える UPDATE（goal_id・goal_catalog_version が変わる）：
--      ・支払後（locked_at あり）は何もしない（complete_01 の guard が mentor_goal_locked で拒否する）
--      ・同じ記録に決済待ち・支払済みの注文（created／checkout_open／paid／disputed）があれば拒否
--        （mentor_goal_checkout_in_progress・42501）
--      ・それ以外（支払い前）は選び直しを許す（従来どおり）
-- B. diagnosis_sessions：BEFORE UPDATE OF user_id で、記録の所有者を変えさせない。
--   OLD.user_id と NEW.user_id が同じなら許す（同じ値での更新）。異なれば diagnosis_session_owner_immutable（42501）で拒否。
--   誤りに DETAIL・user ID・記録 ID を含めない。user_id 以外の列の更新では動かない（UPDATE OF user_id）。
--   記録の削除（ユーザー削除の ON DELETE CASCADE）は UPDATE ではないため影響しない。
--   ・権限：関数は PUBLIC・anon・authenticated から EXECUTE を外す（トリガー関数は呼び出し権限なしで動く）。
--     表の権限には触れない（service_role は arw のまま。anon・authenticated・PUBLIC はなし）。
--   ・ALTER DEFAULT PRIVILEGES は実行しない。complete_01・02 の本文は変えない。
--
-- 戻し：complete_99_rollback_DRAFT_DO_NOT_RUN.sql が、この2つのトリガーと2つの関数を明示的に削除する。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01／02 の適用済みを確かめる
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
  -- complete_01：表・既存トリガー
  if to_regclass('public.record_mentor_goals') is null or to_regclass('public.complete_orders') is null
     or to_regprocedure('public.record_mentor_goals_guard()') is null
     or not exists (select 1 from pg_trigger where tgrelid = 'public.record_mentor_goals'::regclass
                     and tgname = 'record_mentor_goals_guard' and not tgisinternal) then
    raise exception 'complete_01 is not applied';
  end if;
  -- complete_02：service_role の権限が SELECT・INSERT・UPDATE だけ
  if not has_table_privilege('service_role', 'public.record_mentor_goals', 'SELECT')
     or not has_table_privilege('service_role', 'public.record_mentor_goals', 'INSERT')
     or not has_table_privilege('service_role', 'public.record_mentor_goals', 'UPDATE')
     or has_table_privilege('service_role', 'public.record_mentor_goals', 'DELETE')
     or has_table_privilege('service_role', 'public.record_mentor_goals', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.record_mentor_goals', 'TRIGGER')
     or has_table_privilege('service_role', 'public.complete_orders', 'TRUNCATE') then
    raise exception 'complete_02 is not applied';
  end if;
end
$$;

-- 1. 所有者・決済中の変更・同じ目標の再送を扱うトリガー関数
create or replace function public.record_mentor_goals_ownership()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  -- 所有者：INSERT・UPDATE のたびに確かめる（変更された列に関係なく。同じ目標の再送でも先に確かめる）
  if new.user_id is null or new.diagnosis_session_id is null or not exists (
    select 1 from public.diagnosis_sessions s
     where s.id = new.diagnosis_session_id and s.user_id = new.user_id) then
    raise exception 'mentor_goal_record_not_found' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.goal_id is not distinct from old.goal_id
       and new.goal_catalog_version is not distinct from old.goal_catalog_version then
      -- 同じ目標の再送（所有者確認を通った後だけ）：選択日時を動かさない（冪等）
      new.selected_at := old.selected_at;
    elsif old.locked_at is null then
      -- 支払い前の選び直し：決済待ち・支払済みの注文がある間は変えない
      if exists (select 1 from public.complete_orders o
                  where o.diagnosis_session_id = old.diagnosis_session_id
                    and o.status in ('created', 'checkout_open', 'paid', 'disputed')) then
        raise exception 'mentor_goal_checkout_in_progress' using errcode = '42501';
      end if;
    end if;
    -- 支払後（locked_at あり）の変更は、続く record_mentor_goals_guard が mentor_goal_locked で拒否する
  end if;
  return new;
end;
$$;

revoke all on function public.record_mentor_goals_ownership() from public, anon, authenticated;

create or replace trigger record_mentor_goals_0_ownership
  before insert or update on public.record_mentor_goals
  for each row execute function public.record_mentor_goals_ownership();

-- 2. 記録（diagnosis_sessions）の所有者を固定する
create or replace function public.diagnosis_sessions_owner_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'diagnosis_session_owner_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.diagnosis_sessions_owner_immutable() from public, anon, authenticated;

create or replace trigger diagnosis_sessions_owner_immutable
  before update of user_id on public.diagnosis_sessions
  for each row execute function public.diagnosis_sessions_owner_immutable();

-- 3. 既存の行が所有者の規則を満たすことを確かめ、権限・トリガーの順序を確認する（変更はしない）
do $$
declare
  t text;
  p text;
begin
  if exists (select 1 from public.record_mentor_goals g
              where not exists (select 1 from public.diagnosis_sessions s
                                 where s.id = g.diagnosis_session_id and s.user_id = g.user_id)) then
    raise exception 'existing record_mentor_goals rows violate ownership';
  end if;
  if (select array_agg(tgname::text order by tgname) from pg_trigger
       where tgrelid = 'public.record_mentor_goals'::regclass and not tgisinternal)
     is distinct from array['record_mentor_goals_0_ownership', 'record_mentor_goals_guard'] then
    raise exception 'unexpected triggers on record_mentor_goals';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.diagnosis_sessions'::regclass
                  and tgname = 'diagnosis_sessions_owner_immutable' and not tgisinternal) then
    raise exception 'diagnosis_sessions_owner_immutable trigger missing';
  end if;
  if has_function_privilege('anon', 'public.record_mentor_goals_ownership()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_mentor_goals_ownership()', 'EXECUTE')
     or has_function_privilege('anon', 'public.diagnosis_sessions_owner_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.diagnosis_sessions_owner_immutable()', 'EXECUTE') then
    raise exception 'anon or authenticated can execute complete_03 trigger functions';
  end if;
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', t, p) then
        raise exception 'service_role lacks % on %', p, t;
      end if;
    end loop;
    foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then
        raise exception 'service_role has % on %', p, t;
      end if;
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('anon', t, p) or has_table_privilege('authenticated', t, p) then
        raise exception 'anon or authenticated has % on %', p, t;
      end if;
    end loop;
  end loop;
end
$$;

commit;
