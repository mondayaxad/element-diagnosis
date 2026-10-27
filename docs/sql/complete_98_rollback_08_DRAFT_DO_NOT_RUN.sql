-- ============================================================
-- complete_98：complete_08（20261013120000_complete_08_purchase_integrity）の戻し【実行禁止・草案】2026-10-13。Preview 専用。未適用。
-- 使う時：complete_08 を当てた後に、アプリを complete_08 より前（ecd6b57 以前）へ戻す時だけ。
--         アプリ（G1〜G7 の commit）は complete_08 の関数・表を使うため、DB だけを戻すとマイページ・決済・閲覧が 503 になる。
-- 手順：(1) この SQL を SQL Editor で実行 → (2) 20261009120000_complete_07_guest_checkout_claim.sql をもう一度実行
--       （complete_08 が置き換えた5つの関数を complete_07 の本文へ戻す。complete_07 は二度当てできる）。
-- 注意：旧 ¥1,000 の停止・取消（legacy_access_blocks）を消すと、止めた旧購入が再び読めるようになる。
--       停止・取消の行がある時は止める（運営者が記録を控え、扱いを決めてから外す）。
--       完全解析の作り直しの回数（manual_retries）と運営者の作り直しの記録も消える。
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if to_regclass('public.legacy_access_blocks') is not null
     and exists (select 1 from public.legacy_access_blocks where status in ('suspended', 'revoked')) then
    raise exception 'legacy access blocks exist; rollback refused';
  end if;
end
$$;

-- §3 生成の失敗からの回復
drop function if exists public.complete_admin_regenerate_report(uuid, text);
drop function if exists public.complete_regenerate_report(uuid, uuid);
drop function if exists public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz);
drop table if exists public.complete_report_admin_events;
alter table public.complete_reports drop constraint if exists complete_reports_manual_retries_range;
alter table public.complete_reports drop column if exists manual_retries;

-- §2 閲覧権・旧 ¥1,000 の停止
drop function if exists public.complete_admin_legacy_access(text, text, text, text, text);
drop table if exists public.legacy_access_events;
drop table if exists public.legacy_access_blocks;
drop function if exists public.legacy_access_events_immutable();

-- §1 結果グループ（置き換えた関数は、この後に complete_07 を再実行して戻す。それまでは下の関数を参照するため先に戻さない）
-- complete_07 の再実行の後に、次の4つを消す（complete_07 の本文はこれらを参照しない）：
--   drop function if exists public.complete_result_group_has(uuid, uuid, text);
--   drop function if exists public.complete_lock_result_group(uuid, uuid);
--   drop function if exists public.complete_result_group(uuid, uuid);
--   drop function if exists public.complete_result_key(uuid);
--   drop function if exists public.complete_legacy_blocked(text);

delete from supabase_migrations.schema_migrations where version = '20261013120000';

commit;
