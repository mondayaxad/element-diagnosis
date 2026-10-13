-- ============================================================
-- complete_97：complete_09（20261013180000_complete_09_result_resume_links）の戻し【実行禁止・草案】2026-10-13。Preview 専用。未適用。
-- 使う時：complete_09 を当てた後に、アプリを固有リンクより前の commit へ戻す時だけ。
--         アプリ（固有リンクの commit）は complete_09 の関数を使うため、DB だけを戻すと固有リンクの作成・照会が 503 になる
--         （診断結果の表示・購入は固有リンクが無くても動く）。先にアプリを戻してから、この SQL を実行する。
-- 消えるもの：固有リンクの表（秘密値のハッシュ）。発行済みの /result#r=… はすべて開けなくなる（戻せない）。
-- 残るもの：固有リンクの作成の時に作ったゲストの診断記録（diagnosis_sessions・answers・results）。
--           購入のある記録は購入の記録として残す必要があるため、ここでは消さない。
--           購入の無い記録を消す時は、運営者が件数を控えてから別に判断する（この SQL では行わない）。
-- 手順：(1) 下の「読み取りの確認」を実行し、件数を控える → (2) この SQL を SQL Editor で実行 → (3) もう一度「読み取りの確認」
--   select count(*) as links, count(*) filter (where expires_at > now()) as active from public.result_resume_links;
-- ============================================================
begin;

do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
end
$$;

drop function if exists public.complete_purge_result_links();
drop function if exists public.complete_open_result_link(text);
drop function if exists public.complete_create_result_link(text, jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text);
drop table if exists public.result_resume_links;

delete from supabase_migrations.schema_migrations where version = '20261013180000';

commit;
