-- ============================================================
-- 診断記録の重複防止（案2）— rollback 草案
-- 【実行禁止】承認前。適用した Step の逆順で戻す。行データは消さない。
-- ============================================================

-- R7) クライアント：直前のコミットへ revert（DBより先に戻す。新クライアントは旧RPCでも動くが、duplicate_of 列が無いと loadDiagnosisHistory が失敗するため）

-- R6) RPC：適用前に保存しておいた pg_get_functiondef の本文（00_preflight P3 の出力）で CREATE OR REPLACE し直す。
--     戻り値型・引数を変えていないため、置き換えだけで戻る。

-- R4) 一意インデックスを外す（単独で実行）
drop index concurrently if exists public.diagnosis_sessions_identity_uq;

-- R3) 重複の印を外す（行は元から消していないので、印だけ戻せば適用前と同じ）
begin;
update public.diagnosis_sessions set duplicate_of = null where duplicate_of is not null;
commit;

-- R1/R2) 追加列：nullable で既存処理から参照されないため、残しても害はない。
--        完全に戻す場合のみ（Step1で scoring_version を新規追加した場合に限り、その列も落とす）：
-- begin;
-- alter table public.diagnosis_sessions drop column if exists duplicate_of;
-- alter table public.diagnosis_sessions drop column if exists answers_code;
-- alter table public.diagnosis_sessions drop column if exists scoring_version;  -- ← 既存列だった場合は絶対に実行しない
-- commit;
