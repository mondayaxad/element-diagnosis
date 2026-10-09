-- ============================================================
-- 0001 拡張機能・型（Preview 専用プロジェクト向け／未実行）
-- 出どころ：本番候補プロジェクトのカタログ（2026-10-06、読み取り専用ユーザーで取得）
-- 実行先：新しい Preview プロジェクトだけ。Project Ref はこのファイルに書かない。
--   実行前に、SQL Editor のプロジェクト名が element-diagnosis-preview であることを目で確認する。
-- 行データ：なし
-- ============================================================

-- 本番に入っている拡張（pg_stat_statements・pgcrypto・uuid-ossp・plpgsql・supabase_vault）は、
-- Supabase の新規プロジェクトで最初から有効になっている。念のため、無ければ有効にする。
-- gen_random_uuid() は PostgreSQL 13 以降の標準関数なので、拡張に依存しない。
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- 本番の public スキーマには、独自の enum・domain・複合型・シーケンスは無い（カタログで0件）。
-- 主キーはすべて uuid（gen_random_uuid()）で、identity 列・serial 列も無い。
-- よって、型・シーケンスの定義はここでは作らない。
