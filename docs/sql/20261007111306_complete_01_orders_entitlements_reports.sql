-- ============================================================
-- complete_01：完全解析の注文・記録単位の権利・MENTOR 目標・Webhook 受信記録・生成物
-- 【実行禁止・草案】2026-10-07 改訂2（判断 1〜13 と追加判断 1〜8 を反映）。Preview（element-diagnosis-preview）専用。未適用。
-- 【本番では実行しない】本番は別ファイル・別承認（本文の正本・Price・Webhook の確定後）。
-- 置き換え：complete_consent_01_migration_DRAFT_DO_NOT_RUN.sql（SUPERSEDED。適用しない）
-- 戻し：complete_99_rollback_DRAFT_DO_NOT_RUN.sql
-- 設計書：docs/complete_analysis/FOUNDATION_DESIGN_DRAFT.md
-- ============================================================
--
-- 方針
--   ・既存の purchase_entitlements（¥1,000。診断コードのハッシュ単位・旧4商品）には手を入れない。既存データも移さない。
--     旧商品（core1／core2 ¥2,000／complete ¥2,500／core2_upgrade ¥1,500）の意味・価格・行は変えない。
--   ・完全解析（direct ¥3,000／upgrade ¥2,000）の権利の正本は diagnosis_session_id 単位（新しい4表＋MENTOR 目標の表）。
--   ・生成元は COMPLETE-RC1（prototypes/core1_v4_result_driven。技術候補であり、承認済みの本文ではない）。
--   ・販売対象は、保存時の版が生成側の版と完全に一致する記録だけ（旧 MIRROR 2.0.2 等は黙って再計算しない＝販売対象外）。
--   ・MENTOR の目標は、利用者が確認済みの5目標から1つ選ぶ。選ぶまで注文（Checkout）を作れない。支払い後は変えられない。
--   ・提供形式は認証必須の非公開 HTML だけ（PDF は扱わない）。
--   ・新しい表は anon・authenticated に権限を与えない（GRANT なし＋RLS 有効・ポリシーなしの二層）。読み書きはサーバーの API だけ。
--   ・既存表の広い GRANT の是正は混ぜない（0009 権限強化の別課題）。Storage バケット・拡張機能は作らない。
--   ・生の回答・メールアドレス・秘密値は保存しない。
--   ・完全解析権は complete_orders（direct ¥3,000／upgrade ¥2,000）の支払いからだけ成立する。
--     旧 complete ¥2,500・旧ナラティブ（LEGACY_NARRATIVE_V1）・旧 CORE2 は完全解析権を付与しない（この表に行を作らない）。
--   ・dispute 中は権利を一時停止（suspended）。勝訴で active に戻し、敗訴・返金確定で revoked にする。
--   ・運営者 API の監査ログ表は、運営者 API の実装時に別 migration（complete_02）で追加する（この草案には含めない）。

begin;

-- 0. Preview であることを確かめる（0008 の deployment_environment()）。本番には関数が無いため、ここで止まる。
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
end
$$;

-- 1. 生成側（COMPLETE-RC1）が受け付ける版。保存済みの記録の版がこれと完全に一致する場合だけ販売・生成する。
--    版を変えるときは、この関数の差し替え（別 migration・別承認）で行う。
create or replace function public.complete_rc1_required_versions()
  returns table (diagnosis_version text, item_set_version text, scoring_version text,
                 translation_model_version text, character_profile_version text, mirror_model_version text)
  language sql immutable
  set search_path = ''
as $$
  select 'ETI-2.0'::text, 'ETI-ITEM-2.0.0'::text, 'ETI-SCORE-2.0.0'::text,
         'ETI-TRANS-2.0.0'::text, 'ETI-CHAR-2.1.0'::text, 'ETI-MIRROR-2.1.0'::text
$$;

-- 2. MENTOR の目標（記録ごとに1つ）。利用者が確認済みの5目標（CORE1-MENTOR-GOALS-1.0.0）から選ぶ。
--    支払い（注文の paid）で locked_at を入れ、以後は変更できない。結果から自動で選ばない。
create table public.record_mentor_goals (
  diagnosis_session_id  uuid primary key references public.diagnosis_sessions(id) on delete restrict,
  user_id               uuid not null references public.profiles(id) on delete restrict,
  goal_catalog_version  text not null,
  goal_id               text not null,
  selected_at           timestamptz not null default now(),
  locked_at             timestamptz,
  updated_at            timestamptz not null default now(),
  constraint record_mentor_goals_catalog_goal check (
    goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
    and goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01'))
);

create or replace function public.record_mentor_goals_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- 支払い後（locked_at あり）は目標・版・日時・所有者を変えない（ロック自体の解除もしない）
  if old.locked_at is not null and (
       new.goal_id is distinct from old.goal_id
    or new.goal_catalog_version is distinct from old.goal_catalog_version
    or new.selected_at is distinct from old.selected_at
    or new.user_id is distinct from old.user_id
    or new.locked_at is distinct from old.locked_at) then
    raise exception 'mentor_goal_locked' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger record_mentor_goals_guard
  before update on public.record_mentor_goals
  for each row execute function public.record_mentor_goals_guard();

-- 3. 注文（購入 intent）。Checkout Session を作る前にサーバーが1行作り、その id を Stripe の metadata に入れる。
--    支払いの確定は Webhook だけが行う（ブラウザの戻り先・verify では付与しない）。
create table public.complete_orders (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id        uuid not null references public.diagnosis_sessions(id) on delete restrict,
  offer                       text not null check (offer in ('direct_complete', 'analysis_upgrade')),
  amount                      integer not null check (amount > 0),
  currency                    text not null default 'jpy' check (currency = 'jpy'),
  stripe_mode                 text not null check (stripe_mode in ('test', 'live')),
  status                      text not null default 'created'
    check (status in ('created', 'checkout_open', 'paid', 'expired', 'failed', 'canceled', 'refunded', 'disputed')),
  -- 注文時点の MENTOR 目標を写して固定する（以後の生成はこの値を使う）
  mentor_goal_catalog_version text not null,
  mentor_goal_id              text not null,
  mentor_goal_selected_at     timestamptz not null,
  -- upgrade の根拠（既存 ¥1,000 の権利）。どこで確認したかだけを持つ（既存データは移さない）
  analysis_basis              text check (analysis_basis in ('legacy_purchase_entitlement', 'record_entitlement')),
  idempotency_key             text not null,              -- サーバーが決める（user・記録・offer・試行枠）。クライアント値は使わない
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text unique,
  last_stripe_event_id        text,
  last_event_created          timestamptz,                -- 到着順に依存しないため、イベントの作成時刻で新旧を判定する
  failure_code                text,
  created_at                  timestamptz not null default now(),
  checkout_expires_at         timestamptz,
  paid_at                     timestamptz,
  refunded_at                 timestamptz,
  updated_at                  timestamptz not null default now(),
  -- 現在の価格だけを正とする（旧 ¥2,500／¥1,500 を受け付けない）
  constraint complete_orders_amount_matches_offer check (
    (offer = 'direct_complete' and amount = 3000) or (offer = 'analysis_upgrade' and amount = 2000)),
  constraint complete_orders_upgrade_has_basis check (
    (offer = 'analysis_upgrade' and analysis_basis is not null) or (offer = 'direct_complete' and analysis_basis is null)),
  constraint complete_orders_mentor_goal check (
    mentor_goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
    and mentor_goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')),
  -- Preview の DB には Test の決済だけを入れる
  constraint complete_orders_preview_test_mode_only check (stripe_mode = 'test'),
  constraint complete_orders_checkout_prefix check (
    stripe_checkout_session_id is null or stripe_checkout_session_id like 'cs\_test\_%')
);
create unique index complete_orders_idempotency_key_uq on public.complete_orders (idempotency_key);
-- 同じ記録に、決済待ち・支払済みの注文は1つだけ（連打・別タブ・direct と upgrade の並行購入を防ぐ）
create unique index complete_orders_one_live_per_session
  on public.complete_orders (diagnosis_session_id)
  where status in ('created', 'checkout_open', 'paid', 'disputed');
create index complete_orders_user_idx on public.complete_orders (user_id, created_at desc);

-- 注文を作る前提を DB 側でも確かめる（API の確認に重ねる二層目）：
--   本人の記録・ETI v2 の保存済み結果があり版が RC1 と完全一致・登録完了済み・MENTOR 目標が選択済みで注文の値と一致
create or replace function public.complete_orders_require_eligibility()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_owner uuid;
  v_onboarding text;
  v_goal record;
begin
  select s.user_id into v_owner from public.diagnosis_sessions s where s.id = new.diagnosis_session_id;
  if v_owner is distinct from new.user_id then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = new.user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.diagnosis_results r, public.complete_rc1_required_versions() v
     where r.session_id = new.diagnosis_session_id
       and r.diagnosis_version         is not distinct from v.diagnosis_version
       and r.item_set_version          is not distinct from v.item_set_version
       and r.scoring_version           is not distinct from v.scoring_version
       and r.translation_model_version is not distinct from v.translation_model_version
       and r.character_profile_version is not distinct from v.character_profile_version
       and r.mirror_model_version      is not distinct from v.mirror_model_version) then
    raise exception 'complete_version_not_eligible' using errcode = '42501';
  end if;
  select g.goal_id, g.goal_catalog_version, g.selected_at into v_goal
    from public.record_mentor_goals g
   where g.diagnosis_session_id = new.diagnosis_session_id and g.user_id = new.user_id;
  if not found then
    raise exception 'complete_mentor_goal_required' using errcode = '42501';
  end if;
  if v_goal.goal_id is distinct from new.mentor_goal_id
     or v_goal.goal_catalog_version is distinct from new.mentor_goal_catalog_version
     or v_goal.selected_at is distinct from new.mentor_goal_selected_at then
    raise exception 'complete_mentor_goal_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger complete_orders_require_eligibility
  before insert on public.complete_orders
  for each row execute function public.complete_orders_require_eligibility();

-- 4. 記録単位の権利（正本）。analysis＝解析レポート、complete＝完全解析。
--    direct ¥3,000 は analysis と complete の2行、upgrade ¥2,000 は complete の1行。
--    既存 ¥1,000（purchase_entitlements の core1・旧 complete）は写さず、読み取り時に導出する（設計書 §4-3）。
--    状態：active（閲覧可）／suspended（dispute 中の一時停止。閲覧不可）／revoked（失効。閲覧不可）。
--    suspended → active（勝訴）または revoked（敗訴・返金確定）。revoked からは戻さない（再購入は新しい注文）。
create table public.record_entitlements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id   uuid not null references public.diagnosis_sessions(id) on delete restrict,
  right_type             text not null check (right_type in ('analysis', 'complete')),
  source_order_id        uuid not null references public.complete_orders(id) on delete restrict,
  status                 text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  suspend_reason         text check (suspend_reason is null or suspend_reason in ('dispute_open')),
  suspended_at           timestamptz,
  revoke_reason          text check (revoke_reason is null or revoke_reason in ('refund', 'dispute_lost', 'manual', 'mistaken_purchase')),
  created_at             timestamptz not null default now(),
  revoked_at             timestamptz,
  constraint record_entitlements_state_consistency check (
    (status = 'active'    and revoked_at is null and revoke_reason is null and suspended_at is null and suspend_reason is null)
    or (status = 'suspended' and revoked_at is null and revoke_reason is null and suspended_at is not null and suspend_reason is not null)
    or (status = 'revoked'   and revoked_at is not null and revoke_reason is not null))
);
-- 同じ利用者・同じ記録・同じ権利の「失効していない」行（active／suspended）は1つだけ
create unique index record_entitlements_one_active
  on public.record_entitlements (user_id, diagnosis_session_id, right_type) where status in ('active', 'suspended');

-- 失効（revoked）は最終状態。revoked から active／suspended へ戻さない
create or replace function public.record_entitlements_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status = 'revoked' and new.status is distinct from 'revoked' then
    raise exception 'entitlement_revoked_is_final' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger record_entitlements_guard
  before update on public.record_entitlements
  for each row execute function public.record_entitlements_guard();
create unique index record_entitlements_order_right_uq on public.record_entitlements (source_order_id, right_type);

-- 5. Stripe Webhook の受信記録（重複配送の冪等化）。本文（payload）は保存しない。
create table public.stripe_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  livemode      boolean not null,
  event_created timestamptz not null,
  order_id      uuid references public.complete_orders(id) on delete set null,
  status        text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_code    text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  constraint stripe_webhook_events_preview_test_only check (livemode = false)
);

-- 6. 完全解析の生成物（記録ごと・版ごと）。購入（権利）と生成完了は別の事実として持つ。
--    行が無い＝none。購入後に queued で作り、ジョブが generating → ready／failed へ進める。
--    失効（revoked）では閲覧を直ちに止め、生成物は非公開のまま隔離する（quarantined_at）。保持期間は本番前に別途決める。
--    dispute 中の一時停止は権利（record_entitlements.suspended）で表す。生成物は ready のまま（閲覧 API が権利で止める）。
--    生成 HTML には実名・user_id・diagnosis_session_id を入れない。表示名は「あなた」、識別子が要るならこの表の id（推測困難な乱数）だけ。
create table public.complete_reports (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id        uuid not null references public.diagnosis_sessions(id) on delete restrict,
  source_order_id             uuid not null references public.complete_orders(id) on delete restrict,
  status                      text not null default 'queued'
    check (status in ('queued', 'generating', 'ready', 'failed', 'revoked')),
  output_format               text not null default 'html' check (output_format = 'html'),   -- 非公開 HTML だけ（PDF なし）
  attempts                    integer not null default 0 check (attempts >= 0),
  max_attempts                integer not null default 5 check (max_attempts between 1 and 20),
  last_error_code             text,
  next_retry_at               timestamptz,
  lease_token                 uuid,
  lease_expires_at            timestamptz,
  -- 凍結する版（購入確定時に記録から写す。生成側の版と一致するものだけ。キャラクター座標の更新後も差し替えない）
  generator_release           text not null default 'COMPLETE-RC1' check (generator_release = 'COMPLETE-RC1'),
  content_version             text not null,
  template_version            text not null,
  content_sha256              text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),   -- 本文素材（content JSON）の内容ハッシュ
  template_sha256             text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),  -- テンプレート・CSS・画像の内容ハッシュ
  diagnosis_version           text not null,
  item_set_version            text not null,
  scoring_version             text not null,
  translation_model_version   text not null,
  character_profile_version   text not null,
  mirror_model_version        text not null,
  mentor_goal_catalog_version text not null,
  mentor_goal_id              text not null,
  input_sha256                text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path                text,                       -- 非公開バケット内のパス。API の応答・ログに出さない
  output_sha256               text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  created_at                  timestamptz not null default now(),
  generating_at               timestamptz,
  ready_at                    timestamptz,
  failed_at                   timestamptz,
  revoked_at                  timestamptz,
  quarantined_at              timestamptz,
  updated_at                  timestamptz not null default now(),
  constraint complete_reports_versions_rc1 check (
    diagnosis_version = 'ETI-2.0' and item_set_version = 'ETI-ITEM-2.0.0' and scoring_version = 'ETI-SCORE-2.0.0'
    and translation_model_version = 'ETI-TRANS-2.0.0' and character_profile_version = 'ETI-CHAR-2.1.0'
    and mirror_model_version = 'ETI-MIRROR-2.1.0'),
  constraint complete_reports_mentor_goal check (
    mentor_goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
    and mentor_goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')),
  constraint complete_reports_ready_has_output check (status <> 'ready' or (storage_path is not null and output_sha256 is not null and ready_at is not null)),
  -- 失効：日時が必須。生成物がある（storage_path あり）なら隔離日時も必須
  constraint complete_reports_revoked_quarantine check (
    status <> 'revoked' or (revoked_at is not null and (storage_path is null or quarantined_at is not null)))
);
create unique index complete_reports_one_active_per_session
  on public.complete_reports (diagnosis_session_id) where status <> 'revoked';
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256);
create index complete_reports_due_idx on public.complete_reports (status, next_retry_at) where status in ('queued', 'failed');

-- 7. 権限：anon・authenticated には何も与えない（GRANT なし）。RLS も有効にしてポリシーを作らない（二層）。
revoke all on table public.complete_orders, public.record_entitlements, public.stripe_webhook_events,
                    public.complete_reports, public.record_mentor_goals
  from public, anon, authenticated;
grant select, insert, update on table public.complete_orders, public.record_entitlements, public.stripe_webhook_events,
                                      public.complete_reports, public.record_mentor_goals
  to service_role;
alter table public.complete_orders       enable row level security;
alter table public.record_entitlements   enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.complete_reports      enable row level security;
alter table public.record_mentor_goals   enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。DELETE は与えない：記録は消さず状態で表す）

-- 8. 生成ジョブの貸出し（多重実行を防ぐ）。service_role だけが実行できる。
--    queued、再試行時刻を過ぎた failed、貸出し期限切れの generating のうち1件を、期限付きで generating にして返す。
create or replace function public.claim_complete_report_job(p_lease_seconds integer default 120)
  returns table (report_id uuid, diagnosis_session_id uuid, lease_token uuid)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
begin
  select r.id into v_id
    from public.complete_reports r
   where (r.status = 'queued'
          or (r.status = 'failed' and r.attempts < r.max_attempts and r.next_retry_at <= now())
          or (r.status = 'generating' and r.lease_expires_at < now()))
   order by r.created_at
   limit 1
   for update skip locked;
  if v_id is null then return; end if;
  update public.complete_reports
     set status = 'generating', attempts = attempts + 1, lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
         generating_at = now(), updated_at = now()
   where id = v_id;
  return query select v_id, (select r2.diagnosis_session_id from public.complete_reports r2 where r2.id = v_id), v_token;
end;
$$;

revoke all on function public.claim_complete_report_job(integer) from public, anon, authenticated;
revoke all on function public.complete_rc1_required_versions() from public, anon, authenticated;
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_guard() from public, anon, authenticated;
revoke all on function public.record_entitlements_guard() from public, anon, authenticated;
grant execute on function public.claim_complete_report_job(integer) to service_role;
grant execute on function public.complete_rc1_required_versions() to service_role;

commit;
