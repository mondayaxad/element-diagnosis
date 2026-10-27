-- ============================================================
-- 0006 RLS とポリシー（Preview 専用／未実行）
-- 本番カタログ：6テーブルとも RLS 有効・FORCE なし。ポリシーは下の8件だけ（ロールは public）。
-- purchase_entitlements・report_snapshots はポリシーが無い＝ブラウザ（anon・authenticated）からは
-- 読み書きできず、service_role（RLS を迂回する）だけが使える。
-- 依存：0002・0003
-- ============================================================

alter table public.profiles              enable row level security;
alter table public.diagnosis_sessions    enable row level security;
alter table public.diagnosis_answers     enable row level security;
alter table public.diagnosis_results     enable row level security;
alter table public.report_snapshots      enable row level security;
alter table public.purchase_entitlements enable row level security;

-- profiles：本人の行だけ読める・更新できる（INSERT は handle_new_user トリガーが行う。DELETE は auth.users の CASCADE）
create policy profiles_select_own on public.profiles
  as permissive for select to public
  using (auth.uid() = id);
-- WITH CHECK が無い UPDATE ポリシーは、USING の式が新しい行の検査にも使われる（id を他人のものへ変えられない）
create policy profiles_update_own on public.profiles
  as permissive for update to public
  using (auth.uid() = id);

-- diagnosis_sessions：本人の記録だけ読める・作れる（UPDATE・DELETE のポリシーは無い）
create policy diagnosis_sessions_select_own on public.diagnosis_sessions
  as permissive for select to public
  using (auth.uid() = user_id);
create policy diagnosis_sessions_insert_own on public.diagnosis_sessions
  as permissive for insert to public
  with check (auth.uid() = user_id);

-- diagnosis_answers：本人の記録に属する行だけ
create policy diagnosis_answers_select_own on public.diagnosis_answers
  as permissive for select to public
  using (exists (select 1 from public.diagnosis_sessions s
                 where s.id = diagnosis_answers.session_id and s.user_id = auth.uid()));
create policy diagnosis_answers_insert_own on public.diagnosis_answers
  as permissive for insert to public
  with check (exists (select 1 from public.diagnosis_sessions s
                      where s.id = diagnosis_answers.session_id and s.user_id = auth.uid()));

-- diagnosis_results：本人の記録に属する行だけ
create policy diagnosis_results_select_own on public.diagnosis_results
  as permissive for select to public
  using (exists (select 1 from public.diagnosis_sessions s
                 where s.id = diagnosis_results.session_id and s.user_id = auth.uid()));
create policy diagnosis_results_insert_own on public.diagnosis_results
  as permissive for insert to public
  with check (exists (select 1 from public.diagnosis_sessions s
                      where s.id = diagnosis_results.session_id and s.user_id = auth.uid()));

-- report_snapshots・purchase_entitlements：ポリシーを作らない（service_role 専用）
