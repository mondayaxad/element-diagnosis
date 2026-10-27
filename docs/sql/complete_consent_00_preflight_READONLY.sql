-- ============================================================
-- 完全解析（記録単位の権利）・メール配信同意 — 事前確認用（読み取り専用）
-- ・SELECTのみ。INSERT/UPDATE/DELETE/DDLは含まない。
-- ・まずPreview（テスト用Supabaseプロジェクト）で実行し、結果を
--   docs/COMPLETE_ANALYSIS_PREVIEW_DESIGN.md の「未確定事項」と照合する。
-- ・この結果を見るまで 01_migration は確定しない。IF NOT EXISTS だけで安全とは判断しない
--   （同名の列が別の型・制約で既に存在する場合、IF NOT EXISTS は何もせず黙って通るため）。
-- ============================================================
BEGIN READ ONLY;

-- C1) profiles の全列と型・NULL可否・既定値
--     確認：newsletter_opted_in が boolean・nullable・既定値なし（null＝未確認）であること。
--          newsletter_opted_in_at が timestamptz であること。
--          newsletter_consent_source / newsletter_consent_version / newsletter_sync_* が
--          既に別の型で存在しないこと。
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- C2) profiles の制約（CHECK・FK・UNIQUE）
select con.conname, con.contype, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and rel.relname = 'profiles'
order by con.conname;

-- C3) profiles の RLS 有効状態とポリシー
--     確認：本人（auth.uid() = id）が newsletter_* 列を UPDATE でき、更新後の行を SELECT で読めること。
--          （diagnosis-save.js は update(...).select(...) で書き戻し値を確認し、読めなければ Kit へ送らない）
select relname, relrowsecurity, relforcerowsecurity
from pg_class where oid = 'public.profiles'::regclass;
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'profiles'
order by policyname;

-- C4) profiles の列単位の権限（authenticated に UPDATE を列で絞っている場合の確認）
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles' and grantee in ('anon', 'authenticated')
order by grantee, privilege_type, column_name;

-- C5) profiles 行を作るトリガー（新規ユーザー作成時に行が無いと、同意を記録できない）
select tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
where not t.tgisinternal and (t.tgrelid = 'auth.users'::regclass or t.tgrelid = 'public.profiles'::regclass);

-- C6) 既存の同意の分布（値だけ。メールアドレス等は読まない）
select newsletter_opted_in, count(*) from public.profiles group by 1 order by 1;

-- E1) purchase_entitlements の列・制約・RLS（既存の complete ¥2,500 の扱いを変えないための確認）
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'purchase_entitlements'
order by ordinal_position;
select con.conname, pg_get_constraintdef(con.oid)
from pg_constraint con
where con.conrelid = 'public.purchase_entitlements'::regclass
order by con.conname;
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'purchase_entitlements';

-- E2) product_type の現在値の分布（新しい仮ID core_complete_analysis* と衝突しないことの確認）
select product_type, status, count(*) from public.purchase_entitlements group by 1, 2 order by 1, 2;

-- E3) diagnosis_sessions.id の型（新テーブルの外部キー型を合わせる）と、同一ユーザー内で
--     同じ診断コードを持つ記録が複数あるか（コード単位の権利が別記録へ漏れ得る規模の確認）
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'diagnosis_sessions' and column_name in ('id', 'user_id');
select count(*) as users_with_same_code_on_multiple_records
from (
  select s.user_id, a.encoded_answers
  from public.diagnosis_sessions s
  join public.diagnosis_answers a on a.session_id = s.id
  group by 1, 2 having count(*) > 1
) t;

ROLLBACK;
