-- ============================================================
-- 0003 制約・インデックス（Preview 専用／未実行）
-- 名前・定義は本番カタログ（pg_get_constraintdef／pg_indexes）と同じ。
-- 依存：0002。外部キーの参照順：auth.users → profiles → diagnosis_sessions → answers／results
-- ============================================================

-- 主キー
alter table public.profiles              add constraint profiles_pkey              primary key (id);
alter table public.diagnosis_sessions    add constraint diagnosis_sessions_pkey    primary key (id);
alter table public.diagnosis_answers     add constraint diagnosis_answers_pkey     primary key (id);
alter table public.diagnosis_results     add constraint diagnosis_results_pkey     primary key (id);
alter table public.report_snapshots      add constraint report_snapshots_pkey      primary key (id);
alter table public.purchase_entitlements add constraint purchase_entitlements_pkey primary key (id);

-- 一意制約
-- 保存 RPC（save_diagnosis_session）は、この制約名で一意違反を見分けている。名前を変えないこと。
alter table public.diagnosis_sessions
  add constraint diagnosis_sessions_client_session_id_unique unique (client_session_id);
alter table public.diagnosis_answers
  add constraint diagnosis_answers_session_id_key unique (session_id);
alter table public.diagnosis_results
  add constraint diagnosis_results_session_id_key unique (session_id);
alter table public.report_snapshots
  add constraint report_snapshots_diagnosis_code_key unique (diagnosis_code);
-- api/verify.js は、この一意制約の違反（HTTP 409）を「同時アクセスの競合」として扱う。
alter table public.purchase_entitlements
  add constraint purchase_entitlements_stripe_checkout_session_id_key unique (stripe_checkout_session_id);

-- 外部キー（ON UPDATE は本番も既定の NO ACTION）
-- auth.users を削除すると profiles → diagnosis_sessions → answers／results の順に消える。
-- purchase_entitlements・report_snapshots はユーザーに紐付かない（診断コードのハッシュ／診断コードが鍵）。
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;
alter table public.diagnosis_sessions
  add constraint diagnosis_sessions_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.diagnosis_answers
  add constraint diagnosis_answers_session_id_fkey
  foreign key (session_id) references public.diagnosis_sessions(id) on delete cascade;
alter table public.diagnosis_results
  add constraint diagnosis_results_session_id_fkey
  foreign key (session_id) references public.diagnosis_sessions(id) on delete cascade;

-- CHECK 制約
alter table public.purchase_entitlements
  add constraint purchase_entitlements_amount_nonneg_check check (amount >= 0);
alter table public.purchase_entitlements
  add constraint purchase_entitlements_hash_format_check check (diagnosis_code_hash ~ '^[0-9a-f]{64}$'::text);
alter table public.purchase_entitlements
  add constraint purchase_entitlements_product_type_check
  check (product_type = any (array['core1'::text, 'core2'::text, 'complete'::text, 'core2_upgrade'::text]));
alter table public.purchase_entitlements
  add constraint purchase_entitlements_status_check check (status = 'active'::text);

-- 制約以外のインデックス
create index idx_diagnosis_sessions_user_id_completed_at
  on public.diagnosis_sessions using btree (user_id, diagnosis_type, completed_at desc);
create index idx_purchase_entitlements_code_hash
  on public.purchase_entitlements using btree (diagnosis_code_hash);
