-- ============================================================
-- complete_99：complete_01〜03 の戻し【実行禁止・草案】2026-10-07 改訂3（complete_03 のトリガー・関数を明示的に削除）。Preview 専用。未適用。
-- 注意：購入・権利・MENTOR 目標・Webhook 受信・生成物の記録をすべて消す。Preview の試験データだけの段階でのみ使う。
--       決済が1件でも記録された後は、この戻しではなく状態（revoked 等）で扱うこと（会計記録を消さない）。
--       非公開 Storage に置いた生成物ファイルは、この SQL では消えない（別手順）。
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  -- Test の決済でも、支払済みの注文がある場合は止める（誤って記録を消さない）
  if to_regclass('public.complete_orders') is not null
     and exists (select 1 from public.complete_orders where status in ('paid', 'refunded', 'disputed')) then
    raise exception 'paid orders exist; rollback refused';
  end if;
end
$$;

-- complete_03：所有者確認・所有者固定のトリガーと関数（diagnosis_sessions は消さないため明示的に削除する）
drop trigger if exists diagnosis_sessions_owner_immutable on public.diagnosis_sessions;
drop function if exists public.diagnosis_sessions_owner_immutable();
do $$
begin
  if to_regclass('public.record_mentor_goals') is not null then
    drop trigger if exists record_mentor_goals_0_ownership on public.record_mentor_goals;
  end if;
end
$$;
drop function if exists public.record_mentor_goals_ownership();

drop function if exists public.claim_complete_report_job(integer);
drop table if exists public.complete_reports;
drop table if exists public.record_entitlements;           -- トリガー record_entitlements_guard も一緒に消える
drop function if exists public.record_entitlements_guard();
drop table if exists public.stripe_webhook_events;
drop table if exists public.complete_orders;          -- トリガー complete_orders_require_eligibility も一緒に消える
drop function if exists public.complete_orders_require_eligibility();
drop table if exists public.record_mentor_goals;      -- トリガー record_mentor_goals_guard も一緒に消える
drop function if exists public.record_mentor_goals_guard();
drop function if exists public.complete_rc1_required_versions();

commit;
