-- ============================================================
-- 0002 テーブル（列・型・NOT NULL・既定値・コメント）（Preview 専用／未実行）
-- 制約（主キー・一意・外部キー・CHECK）とインデックスは 0003。RLS は 0006。権限は 0007。
-- 行データ：なし（INSERT・COPY を含まない）
-- 依存：auth.users（Supabase が用意）。0001。
-- ============================================================

create table public.profiles (
  id                      uuid        not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  newsletter_opted_in     boolean,
  newsletter_opted_in_at  timestamptz
);

create table public.diagnosis_sessions (
  id                 uuid        not null default gen_random_uuid(),
  user_id            uuid        not null,
  diagnosis_type     text        not null default 'element'::text,
  diagnosis_version  text        not null,
  scoring_version    text        not null,
  client_session_id  uuid        not null,
  completed_at       timestamptz not null,
  created_at         timestamptz not null default now(),
  item_set_version   text
);

create table public.diagnosis_answers (
  id               uuid        not null default gen_random_uuid(),
  session_id       uuid        not null,
  answers          jsonb       not null,
  encoded_answers  text,
  created_at       timestamptz not null default now(),
  answers_v2       jsonb
);

create table public.diagnosis_results (
  id                         uuid        not null default gen_random_uuid(),
  session_id                 uuid        not null,
  primary_result             jsonb       not null,
  scores                     jsonb       not null,
  character_matches          jsonb,
  diagnosis_code             text,
  created_at                 timestamptz not null default now(),
  ennea_sorted               jsonb,
  character_db_version       text,
  report_logic_version       text,
  template_version           text,
  diagnosis_version          text,
  item_set_version           text,
  scoring_version            text,
  translation_model_version  text,
  character_profile_version  text,
  mirror_model_version       text,
  v2_scores                  jsonb,
  v2_rankings                jsonb,
  mirror_snapshot            jsonb
);

create table public.report_snapshots (
  id                 uuid        not null default gen_random_uuid(),
  diagnosis_code     text        not null,
  scoring_version    text        not null,
  primary_result     jsonb       not null,
  scores             jsonb       not null,
  character_matches  jsonb       not null,
  created_at         timestamptz not null default now()
);

create table public.purchase_entitlements (
  id                          uuid        not null default gen_random_uuid(),
  diagnosis_code_hash         text        not null,
  stripe_checkout_session_id  text        not null,
  stripe_payment_intent_id    text,
  product_type                text        not null,
  amount                      integer     not null,
  currency                    text        not null default 'jpy'::text,
  purchased_at                timestamptz not null default now(),
  status                      text        not null default 'active'::text,
  created_at                  timestamptz not null default now()
);

-- 本番と同じ列コメント
comment on column public.diagnosis_results.ennea_sorted is
  '9タイプ全体の最終順位・スコア（診断保存時に保存。QUEST章の上位3タイプ判定に使用）';
comment on column public.diagnosis_results.character_db_version is
  '診断計算に使用したキャラクターDBのバージョン（診断保存時に保存）';
comment on column public.diagnosis_results.report_logic_version is
  '第二レポート（アナタの旅路）の算出ロジックのバージョン（CORE2生成時に記録。診断保存時点では未確定のためNULL）';
comment on column public.diagnosis_results.template_version is
  '第二レポートのテンプレート文言のバージョン（CORE2生成時に記録。診断保存時点では未確定のためNULL）';
comment on column public.purchase_entitlements.product_type is
  'core1 / core2 / complete / core2_upgrade のいずれか（CHECK制約で強制）';
comment on column public.purchase_entitlements.status is
  '初期リリースでは active のみ許可（CHECK制約）。返金・取消時の状態遷移は今回のリリース範囲外';

-- RLS を有効にする前（0006）に、ブラウザ用ロールが触れないようにしておく。
-- Supabase の既定権限（default privileges）で新しいテーブルに anon・authenticated の権限が付く場合があるため、
-- ここで一度すべて外し、RLS を有効にした後（0006 の後）に、本番と同じ権限を 0007 で付け直す。
revoke all on table
  public.profiles, public.diagnosis_sessions, public.diagnosis_answers,
  public.diagnosis_results, public.report_snapshots, public.purchase_entitlements
from anon, authenticated;
