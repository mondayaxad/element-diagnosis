-- ============================================================
-- complete_02：完全解析の5表で service_role の権限を SELECT・INSERT・UPDATE だけに絞る
-- 【実行禁止・草案】2026-10-07。Preview（element-diagnosis-preview）専用。未適用。
-- 【本番では実行しない】本番は別ファイル・別承認。
-- 前提：complete_01（20261007111306_complete_01_orders_entitlements_reports）適用済み。PostgreSQL 17 以上（MAINTAIN 権限）。
-- ============================================================
--
-- 背景
--   complete_01 は service_role に select・insert・update だけを GRANT したが、Supabase の既定権限
--   （ALTER DEFAULT PRIVILEGES）により、表の作成時点で service_role に TRUNCATE・REFERENCES・TRIGGER・MAINTAIN も付いた
--   （Preview の ACL：service_role=arwDxtm）。DELETE は complete_01 の revoke 対象外だが既定権限にも含まれず付いていない。
--
-- 方針
--   ・新5表の service_role から TRUNCATE・REFERENCES・TRIGGER・MAINTAIN だけを REVOKE する（残すのは SELECT・INSERT・UPDATE）。
--   ・DELETE は付与しない（記録は消さず状態で表す）。
--   ・anon・authenticated の権限には触れない（complete_01 で権限なし。末尾の確認で権限なしのままであることだけを確かめる）。
--   ・プロジェクト全体の ALTER DEFAULT PRIVILEGES は変えない（既存の表・API に影響させない）。
--   ・complete_01 の本文は編集しない（適用済み）。修正はこのような新しい migration で行う。

begin;

-- 0. Preview であること・PostgreSQL 17 以上であること・complete_01 の5表があることを確かめる
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required (MAINTAIN privilege)';
  end if;
  if to_regclass('public.complete_orders') is null or to_regclass('public.record_entitlements') is null
     or to_regclass('public.stripe_webhook_events') is null or to_regclass('public.complete_reports') is null
     or to_regclass('public.record_mentor_goals') is null then
    raise exception 'complete_01 is not applied';
  end if;
end
$$;

-- 1. service_role から余分な権限を外す
revoke truncate, references, trigger, maintain
  on table public.complete_orders, public.record_entitlements, public.stripe_webhook_events,
           public.complete_reports, public.record_mentor_goals
  from service_role;

-- 2. 結果を確かめる（変更はしない。期待と違えば全体を取り消す）
--    service_role：SELECT・INSERT・UPDATE あり／DELETE・TRUNCATE・REFERENCES・TRIGGER・MAINTAIN なし
--    anon・authenticated：どの権限もなし
do $$
declare
  t text;
  p text;
begin
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', t, p) then
        raise exception 'service_role lacks % on %', p, t;
      end if;
    end loop;
    foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then
        raise exception 'service_role still has % on %', p, t;
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
