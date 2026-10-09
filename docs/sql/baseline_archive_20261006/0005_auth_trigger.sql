-- ============================================================
-- 0005 新規ユーザー作成時の profiles 自動作成（Preview 専用／未実行）
-- 本番カタログ：関数 public.handle_new_user()（SECURITY DEFINER、search_path=public、所有者 postgres）
--               トリガー on_auth_user_created（auth.users、AFTER INSERT、FOR EACH ROW、有効）
-- `supabase db dump` の既定では auth.users 上のトリガーが出力されないため、ここで明示的に作る。
-- 依存：0002・0003（profiles と profiles_pkey。on conflict (id) が主キーを使う）
-- ============================================================

-- 本文は本番と同じ。SECURITY DEFINER なので search_path を固定し、
-- テーブルはスキーマ名付き（public.profiles）で参照している。
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- 実行権限：本番と同じく PostgreSQL の既定（PUBLIC に EXECUTE）のままにする。
-- 0007_grants_production_parity.sql で本番どおりであることを明示する。
-- PUBLIC の実行権限を外す案は 0009_grants_hardening_DRAFT_DO_NOT_RUN.sql（基本セットには含めない）。

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 本番に updated_at を更新するトリガーは無い（profiles.updated_at は作成時の now() のまま）。
-- 診断保存に関するトリガーも無い（保存の整合性は RPC の中で取っている）。
