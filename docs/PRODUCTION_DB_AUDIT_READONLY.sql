-- ============================================================
-- 元素診断 本番DB 読み取り専用監査SQL（2026-09-27 作成）
-- ・SELECTのみ。INSERT/UPDATE/DELETE/DDLは含まない。
-- ・実行前に接続先プロジェクト（Preview: akivoobkqcnqvdumxtmg ／ 本番: csoivksmieguzywgxbrs）を必ず確認。
-- ・可能なら読み取り専用ロール、または BEGIN READ ONLY; ... ROLLBACK; で実行する。
-- ・テーブル名が異なる場合は、1) の結果を見てから該当箇所だけ読み替えること。
-- ============================================================
BEGIN READ ONLY;

-- 1) 関連テーブルの存在確認
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and (table_name like 'diagnosis%' or table_name like '%entitlement%' or table_name like '%purchase%')
order by table_name;

-- 2) save_diagnosis_session_v2 の完全な定義（同名・別スキーマ・オーバーロードすべて）
select n.nspname as schema, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'save_diagnosis_session_v2';

-- 2b) 関数内で mirror_model_version / ETI-MIRROR を固定値チェックしていないか
--     （今回 ETI-MIRROR-2.0.0 → 2.0.2、ETI-CHAR-2.0.0 → 2.0.1 へ更新するため、固定値比較があると保存が失敗する）
select n.nspname, p.proname,
       position('ETI-MIRROR' in pg_get_functiondef(p.oid)) > 0 as mentions_mirror_version_literal,
       position('ETI-CHAR' in pg_get_functiondef(p.oid)) > 0 as mentions_char_version_literal
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'save_diagnosis_session_v2';

-- 2c) mirror_model_version / character_profile_version 列のCHECK制約の有無
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as def
from pg_constraint
where contype = 'c' and (pg_get_constraintdef(oid) ilike '%mirror%' or pg_get_constraintdef(oid) ilike '%profile%');

-- 3) diagnosis_answers.session_id / diagnosis_results.session_id の制約（UNIQUE・PK・FK）
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid in ('public.diagnosis_answers'::regclass, 'public.diagnosis_results'::regclass)
order by table_name, contype;

-- 3b) session_id の一意インデックス
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('diagnosis_answers','diagnosis_results');

-- 4) 同一 session_id の重複（0行なら正常）
select 'answers' as t, session_id, count(*) from diagnosis_answers group by session_id having count(*) > 1
union all
select 'results' as t, session_id, count(*) from diagnosis_results group by session_id having count(*) > 1;

-- 5) 世代別の診断セッション件数（本番に既存ETI v2セッションが存在するか）
select diagnosis_version, count(*) as sessions, min(completed_at) as first_at, max(completed_at) as last_at
from diagnosis_sessions
group by diagnosis_version
order by diagnosis_version;

-- 5b) ETI v2 保存済みの mirror_model_version 別件数（2.0.0の履歴は事実として保持する方針。件数把握のみ）
--     列名が異なる場合は 1) の結果を見て読み替える
select mirror_model_version, count(*) from diagnosis_sessions
where diagnosis_version = 'ETI-2.0'
group by mirror_model_version;

-- 5c) ETI v2 保存済みの character_profile_version 別件数（ETI-CHAR-2.0.1 で保存されているかの確認。件数把握のみ）
--     列名が異なる場合は 1) の結果を見て読み替える
select character_profile_version, mirror_model_version, count(*) from diagnosis_sessions
where diagnosis_version = 'ETI-2.0'
group by character_profile_version, mirror_model_version
order by character_profile_version, mirror_model_version;

-- 6) v1 / v2 の権利件数（権利テーブル名は 1) で確認してから読み替える）
--    例：core1_entitlements(product, diagnosis_code_hash, status, ...) の場合
-- select product, status, count(*) from core1_entitlements group by product, status order by product, status;

-- 7) 同一回答コードを持つ複数セッション（INSIGHTS重複除外の影響範囲の把握）
select s.diagnosis_version, a.encoded_answers, count(*) as sessions
from diagnosis_sessions s join diagnosis_answers a on a.session_id = s.id
group by s.diagnosis_version, a.encoded_answers
having count(*) > 1
order by sessions desc
limit 50;

ROLLBACK;
