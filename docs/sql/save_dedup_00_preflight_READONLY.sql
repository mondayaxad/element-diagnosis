-- ============================================================
-- 診断記録の重複防止（案2）— 事前確認用（読み取り専用）
-- ・SELECTのみ。INSERT/UPDATE/DELETE/DDLは含まない。
-- ・まずPreview（akivoobkqcnqvdumxtmg）で実行し、結果を設計書の「前提」と照合する。
-- ・この結果を見るまで 01_migration は確定しない（列名・関数の戻り値型を合わせる必要がある）。
-- ============================================================
BEGIN READ ONLY;

-- P1) diagnosis_sessions / diagnosis_answers / diagnosis_results の列（scoring_version・item_set_version がどこにあるか）
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name in ('diagnosis_sessions','diagnosis_answers','diagnosis_results')
order by table_name, ordinal_position;

-- P2) 既存の制約・インデックス（client_session_id のUNIQUEを含む）
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid in ('public.diagnosis_sessions'::regclass,'public.diagnosis_answers'::regclass,'public.diagnosis_results'::regclass)
order by 1, 3;
select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in ('diagnosis_sessions','diagnosis_answers','diagnosis_results');

-- P3) 保存RPCの完全な定義と戻り値型（この本文を 01 の差し込み位置に合わせる）
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as returns, p.prosecdef as security_definer,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('save_diagnosis_session','save_diagnosis_session_v2');

-- P4) RLSポリシー（新しい列が本人のSELECTで読めることの確認）
select tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename in ('diagnosis_sessions','diagnosis_answers','diagnosis_results');

-- P5) diagnosis_version / scoring_version の実際の値の分布（legacyの null / 'element-v1' の混在確認）
select s.diagnosis_version, s.item_set_version, count(*) as sessions
from diagnosis_sessions s group by 1, 2 order by 1, 2;

-- P6) 回答コードが無いセッション（一致キーを作れない行）
select s.diagnosis_version, count(*) as sessions_without_code
from diagnosis_sessions s left join diagnosis_answers a on a.session_id = s.id
where a.encoded_answers is null group by 1;

-- P7) v2 で diagnosis_code と encoded_answers が一致しているか（v2の前提：同一のはず。0行が正常）
select s.id from diagnosis_sessions s
join diagnosis_answers a on a.session_id = s.id
join diagnosis_results r on r.session_id = s.id
where s.diagnosis_version = 'ETI-2.0' and r.diagnosis_code is distinct from a.encoded_answers
limit 20;

-- P8) 既に存在する「同じ測定条件＋同じ回答」の重複（migrationで印を付ける対象の件数）
--     scoring_version の場所は P1 の結果に合わせて読み替える（ここでは results 側を参照）
select s.user_id, coalesce(s.diagnosis_version,'element-v1') as dv, coalesce(s.item_set_version,'') as isv,
       coalesce(r.scoring_version,'') as sv, a.encoded_answers, count(*) as n,
       array_agg(s.id order by s.completed_at, s.id) as session_ids
from diagnosis_sessions s
join diagnosis_answers a on a.session_id = s.id
left join diagnosis_results r on r.session_id = s.id
group by 1,2,3,4,5 having count(*) > 1
order by n desc limit 100;

ROLLBACK;
