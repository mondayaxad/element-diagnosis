-- ============================================================
-- 0007 権限：本番の現状をそのまま再現する（Preview 専用／未実行）
-- 出どころ：本番候補プロジェクトのカタログ（pg_class.relacl・pg_proc.proacl。2026-10-06 取得）
--
-- 【注意】これは「現状の再現用」であり、推奨する設定ではない。
--   ・anon・authenticated に、6テーブルすべての広い権限（SELECT・INSERT・UPDATE・DELETE・
--     TRUNCATE・REFERENCES・TRIGGER、PostgreSQL 17 では MAINTAIN も）が付いている
--   ・行の保護は RLS（0006）だけに依存している。RLS が無効になると、ブラウザから全行を読み書きできる
--   ・TRUNCATE は RLS の対象外。PostgREST（API）からは発行できないが、権限としては残っている
--   ・handle_new_user（SECURITY DEFINER）は PUBLIC が実行できる（PostgreSQL の既定のまま）
-- 目的：Preview の基本スキーマを本番と一致させ、「コードの動作の差」と「権限の差」を混同しないこと。
-- 権限を絞る案は 0009_grants_hardening_DRAFT_DO_NOT_RUN.sql（基本セットには含めない・別承認）。
--
-- 【本番へ再適用するための SQL ではない】本番では実行しない（本番には既にこの権限がある）。
-- 依存：0002〜0006（RLS を有効にした後に付ける）
-- ============================================================

-- テーブル：本番では anon・authenticated・service_role の3ロールとも全権限。
-- GRANT ALL は、PostgreSQL 17（本番・Supabase）では MAINTAIN を含み、16 では含まない。
grant all on table
  public.profiles, public.diagnosis_sessions, public.diagnosis_answers,
  public.diagnosis_results, public.report_snapshots, public.purchase_entitlements
to anon, authenticated, service_role;

-- 列単位の権限：本番には無い。シーケンス：public には無い。

-- 関数：本番の実行権限
--   save_diagnosis_session・save_diagnosis_session_v2：authenticated と所有者（postgres）だけ。
--     PUBLIC・anon・service_role には無い（0004 で PUBLIC を外している）
grant execute on function public.save_diagnosis_session(text, text, text, uuid, timestamptz, jsonb, text, jsonb, jsonb, jsonb, text, jsonb, text) to authenticated;
grant execute on function public.save_diagnosis_session_v2(text, text, text, text, text, text, text, uuid, timestamptz, jsonb, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
--   handle_new_user：PUBLIC と所有者（PostgreSQL の既定）。本番と同じであることを明示する
grant execute on function public.handle_new_user() to public;
