-- ============================================================
-- 診断記録の重複防止（案2）— migration 草案
-- 【実行禁止】承認前。00_preflight の結果で列名・RPCの戻り値型を確認してから確定する。
-- 適用順：Step 1 → 2 → 3 →（4は単独で・トランザクション外）→ 5 → 6（RPC）→ 7（クライアント）
-- 各StepはPreviewで実行・確認してから本番へ。本番は別途承認。
-- ============================================================

-- ---------- Step 1: 列の追加（既存行に影響なし・nullable） ----------
begin;
alter table public.diagnosis_sessions
  add column if not exists answers_code    text,  -- 100回答の可逆コード（= diagnosis_answers.encoded_answers。v2では diagnosis_code と同一）
  add column if not exists scoring_version text,  -- 採点版（sessions に無い場合のみ追加。P1で既存なら何もしない）
  add column if not exists duplicate_of    uuid references public.diagnosis_sessions(id) on delete set null;
comment on column public.diagnosis_sessions.answers_code is
  '同一診断の一致キー用。diagnosis_answers.encoded_answers の複製（legacyでは diagnosis_results.diagnosis_code とは別物なので、必ず encoded_answers を使う）';
comment on column public.diagnosis_sessions.duplicate_of is
  'migration時点で既に存在した重複行の印。同じ一致キーで最も早い記録（正本）のidを指す。新規保存では常にnull';
commit;

-- ---------- Step 2: 既存行へのバックフィル ----------
begin;
update public.diagnosis_sessions s
   set answers_code = a.encoded_answers
  from public.diagnosis_answers a
 where a.session_id = s.id and s.answers_code is null and a.encoded_answers is not null;

-- scoring_version：results 側にある値を写す（P1で sessions に既にあればこの文は不要）
update public.diagnosis_sessions s
   set scoring_version = r.scoring_version
  from public.diagnosis_results r
 where r.session_id = s.id and s.scoring_version is null and r.scoring_version is not null;

-- legacy：保存RPCは常に定数 'element-score-v1' を送っていた（diagnosis-save.js SCORING_VERSION）。
-- それでも null の legacy 行だけ、この定数で埋める（P5/P1で null 行の実在を確認してから）。
update public.diagnosis_sessions
   set scoring_version = 'element-score-v1'
 where scoring_version is null and coalesce(diagnosis_version,'element-v1') <> 'ETI-2.0';
commit;

-- ---------- Step 3: 既存の重複に印を付ける（削除しない） ----------
-- 同じ「ユーザー＋測定条件＋回答」のうち、最も早い completed_at（同時刻なら id 順）を正本とし、
-- それ以外に duplicate_of = 正本id を入れる。行・回答・結果・購入権利は一切消さない。
begin;
with ranked as (
  select s.id,
         first_value(s.id) over (
           partition by s.user_id, s.diagnosis_type, coalesce(s.diagnosis_version,'element-v1'),
                        coalesce(s.item_set_version,''), coalesce(s.scoring_version,''), s.answers_code
           order by s.completed_at, s.id) as keep_id
    from public.diagnosis_sessions s
   where s.answers_code is not null
)
update public.diagnosis_sessions s
   set duplicate_of = r.keep_id
  from ranked r
 where s.id = r.id and r.keep_id <> s.id and s.duplicate_of is null;
commit;

-- ---------- Step 4: 一意インデックス（単独で実行。CONCURRENTLY はトランザクション内不可） ----------
-- NULLを含む列は coalesce で正規化し、v1/v2・設問版・採点版を必ずキーに含める。
-- 他ユーザーの行とは user_id が違うため衝突しない（RLSとも独立）。
create unique index concurrently if not exists diagnosis_sessions_identity_uq
  on public.diagnosis_sessions (
    user_id, diagnosis_type,
    (coalesce(diagnosis_version,'element-v1')),
    (coalesce(item_set_version,'')),
    (coalesce(scoring_version,'')),
    answers_code)
  where answers_code is not null and duplicate_of is null;
-- 失敗（INVALIDなインデックスが残る）した場合： drop index concurrently if exists diagnosis_sessions_identity_uq; → Step 3 を再確認して再作成

-- ---------- Step 5: 確認（読み取り） ----------
-- select indexname, indexdef from pg_indexes where indexname = 'diagnosis_sessions_identity_uq';
-- select count(*) filter (where duplicate_of is not null) as marked, count(*) as total from public.diagnosis_sessions;

-- ---------- Step 6: RPC 変更（save_diagnosis_session_v2 / save_diagnosis_session） ----------
-- 既存の関数本文（00_preflight P3）を土台に、次の2点だけを差し込む。戻り値型・引数・SECURITY INVOKER は変えない
-- （戻り値型を変えると DROP が必要になり、クライアントとの互換が崩れるため）。
--
-- (a) 「同じ client_session_id の既存セッション」の確認（既存ロジック：冪等な再送・payload不一致の判定）はそのまま先に行う。
-- (b) その直後、INSERTの前に「同一診断」の確認を追加する：
--
--   select s.id into v_existing_id
--     from public.diagnosis_sessions s
--    where s.user_id = auth.uid()
--      and s.diagnosis_type = p_diagnosis_type
--      and coalesce(s.diagnosis_version,'element-v1') = coalesce(p_diagnosis_version,'element-v1')
--      and coalesce(s.item_set_version,'') = coalesce(p_item_set_version,'')     -- legacy版RPCでは '' 固定
--      and coalesce(s.scoring_version,'')  = coalesce(p_scoring_version,'')
--      and s.answers_code = p_encoded_answers
--      and s.duplicate_of is null
--    limit 1;
--   if v_existing_id is not null then
--     return v_existing_id;          -- 新しい行は作らない。成功として既存のidを返す（戻り値型に合わせる）
--   end if;
--
-- (c) 3テーブルへのINSERTを1つのサブブロックで囲み、同時保存の競合だけを既存扱いにする：
--
--   begin
--     insert into public.diagnosis_sessions (..., answers_code, scoring_version) values (..., p_encoded_answers, p_scoring_version)
--       returning id into v_session_id;
--     insert into public.diagnosis_answers (...);
--     insert into public.diagnosis_results (...);
--   exception when unique_violation then
--     get stacked diagnostics v_constraint = constraint_name;
--     if v_constraint = 'diagnosis_sessions_identity_uq' then
--       -- 別タブ・別端末の保存が先に確定した。このブロックのINSERTは巻き戻り、既存のidを返す
--       select s.id into v_existing_id from public.diagnosis_sessions s
--        where <(b)と同じ条件>;
--       return v_existing_id;
--     end if;
--     raise;  -- client_session_id のUNIQUE違反など、それ以外は従来どおり呼び出し元へ
--   end;
--
-- ※ client_session_id の役割は変えない（同じ保存操作の再送を防ぐ）。一致キーは「同じ診断内容」を防ぐ。
--    両方が同時に当たる場合（同じ client_session_id の再送）は (a) が先に処理する。

-- ---------- Step 7: クライアント（DB適用後に別コミット） ----------
-- ・loadDiagnosisHistory：.is('duplicate_of', null) を追加し、マイページに重複行を出さない（行自体は残す）
-- ・保存済み判定（READ）：diagnosis_sessions を answers_code＋版で1件検索
-- ・eti_v2_save.js / diagnosis-save.js：RPCが既存idを返した場合も ok:true（UIは「保存済み」）
