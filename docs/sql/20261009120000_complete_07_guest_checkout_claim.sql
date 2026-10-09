-- ============================================================
-- complete_07：ゲスト購入（解析レポート ¥1,000・完全解析 ¥3,000・アップグレード ¥2,000）と、購入後のマイページ引き継ぎ
-- 2026-10-09。Preview（element-diagnosis-preview）専用。
-- 【SQL Editor で実行する】本文に制約・索引・NOT NULL の削除文を含むため、Supabase の API 経路（MCP）では適用できない。
--   最後に migration 履歴（supabase_migrations.schema_migrations）へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイル（Stripe Live・Preview の確認なし）で行う。
-- 前提：complete_01〜06 適用済み・PostgreSQL 17 以上。
-- ============================================================
--
-- 方針
--   ・既存の行は書き換えない・消さない。既存表への変更は次の2つだけ：
--       diagnosis_sessions.user_id の NOT NULL を外す（NULL ＝ ゲスト購入の記録。サーバーだけが作る）。
--       diagnosis_sessions に guest_created_at（ゲスト記録の目印）を足す。既存の行はすべて user_id があるため値は NULL のまま。
--     RLS（auth.uid() = user_id）は NULL に一致しないため、ゲスト記録はブラウザのどのロールからも見えない・作れない。
--   ・注文（complete_orders）に offer = 'analysis'（¥1,000・解析レポート）を足す。金額は offer から DB が決める。
--       analysis ¥1,000 → 権利 analysis
--       direct_complete ¥3,000 → 権利 analysis（未所持の時）＋ complete
--       analysis_upgrade ¥2,000 → 権利 complete（同じ記録の analysis 権、または固定済みの旧 ¥1,000 が根拠）
--   ・ゲストの注文は buyer = 'guest'・user_id NULL。注文ごとの引き継ぎ用の秘密値（256bit）は SHA-256 のハッシュだけを持つ。
--   ・購入時のメールは保存しない。サーバーの鍵で作った HMAC（purchase_email_hmac）だけを持つ（Cookie を失った時の復旧照合用）。
--   ・引き継ぎ（complete_claim_guest_record）：記録・回答・結果・注文・権利・MENTOR 目標・生成物の所有者を、
--     1トランザクションで NULL → 本人へ1度だけ変える。支払済みの注文だけ。別の人が引き継ぎ済みなら complete_claim_conflict。
--   ・記録の所有者の変更は、引き継ぎ関数の中（app.complete_claim = on）で NULL → 本人の時だけ許す。それ以外は従来どおり拒否。
--   ・関数はすべて SECURITY INVOKER・search_path = ''。EXECUTE は service_role だけ。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜06 の適用済みを確かめる
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null then
    raise exception 'not a preview database';
  end if;
  if public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  if to_regprocedure('public.complete_report_for_view(uuid, uuid)') is null
     or to_regprocedure('public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)') is null
     or to_regclass('public.complete_admin_audit_log') is null then
    raise exception 'complete_01..06 are not applied';
  end if;
end
$$;

-- 1. 記録：ゲスト購入の記録（所有者 NULL）を許す
alter table public.diagnosis_sessions alter column user_id drop not null;
alter table public.diagnosis_sessions add column if not exists guest_created_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diagnosis_sessions_owner_or_guest'
                   and conrelid = 'public.diagnosis_sessions'::regclass) then
    alter table public.diagnosis_sessions add constraint diagnosis_sessions_owner_or_guest
      check (user_id is not null or guest_created_at is not null) not valid;
    alter table public.diagnosis_sessions validate constraint diagnosis_sessions_owner_or_guest;
  end if;
end
$$;
comment on column public.diagnosis_sessions.user_id is
  'NULL はゲスト購入の記録（サーバーだけが作る。RLS で誰からも見えない）。引き継ぎ（complete_claim_guest_record）で1度だけ本人を入れる';
comment on column public.diagnosis_sessions.guest_created_at is
  'ゲスト購入の記録を作った日時（サーバーが作った記録の目印。引き継ぎ後も残す）';

-- 記録の所有者の固定：引き継ぎ関数の中で NULL → 本人の時だけ許す
create or replace function public.diagnosis_sessions_owner_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    if old.user_id is null and new.user_id is not null and old.guest_created_at is not null
       and current_setting('app.complete_claim', true) = 'on' then
      return new;
    end if;
    raise exception 'diagnosis_session_owner_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2. 注文
alter table public.complete_orders alter column user_id drop not null;
alter table public.complete_orders alter column mentor_goal_catalog_version drop not null;
alter table public.complete_orders alter column mentor_goal_id drop not null;
alter table public.complete_orders alter column mentor_goal_selected_at drop not null;
alter table public.complete_orders add column if not exists buyer text not null default 'user';
alter table public.complete_orders add column if not exists claim_secret_hash text;
alter table public.complete_orders add column if not exists claim_expires_at timestamptz;
alter table public.complete_orders add column if not exists claimed_by uuid references public.profiles(id) on delete restrict;
alter table public.complete_orders add column if not exists claimed_at timestamptz;
alter table public.complete_orders add column if not exists claim_method text;
alter table public.complete_orders add column if not exists purchase_email_hmac text;

alter table public.complete_orders drop constraint if exists complete_orders_offer_check;
alter table public.complete_orders drop constraint if exists complete_orders_amount_matches_offer;
alter table public.complete_orders drop constraint if exists complete_orders_upgrade_has_basis;
alter table public.complete_orders drop constraint if exists complete_orders_mentor_goal;
alter table public.complete_orders drop constraint if exists complete_orders_buyer_check;
alter table public.complete_orders drop constraint if exists complete_orders_claim_method_check;
alter table public.complete_orders drop constraint if exists complete_orders_hash_format;
alter table public.complete_orders drop constraint if exists complete_orders_buyer_consistency;
alter table public.complete_orders add constraint complete_orders_offer_check
  check (offer in ('analysis', 'direct_complete', 'analysis_upgrade'));
alter table public.complete_orders add constraint complete_orders_amount_matches_offer check (
  (offer = 'analysis' and amount = 1000) or (offer = 'direct_complete' and amount = 3000) or (offer = 'analysis_upgrade' and amount = 2000));
alter table public.complete_orders add constraint complete_orders_upgrade_has_basis check (
  (offer = 'analysis_upgrade' and analysis_basis is not null) or (offer in ('analysis', 'direct_complete') and analysis_basis is null));
-- MENTOR 目標：完全解析（direct・upgrade）は必須、解析レポート（analysis）は持たない
alter table public.complete_orders add constraint complete_orders_mentor_goal check (
  (offer = 'analysis' and mentor_goal_catalog_version is null and mentor_goal_id is null and mentor_goal_selected_at is null)
  or (offer in ('direct_complete', 'analysis_upgrade')
      and mentor_goal_catalog_version = 'CORE1-MENTOR-GOALS-1.0.0'
      and mentor_goal_id in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01')
      and mentor_goal_selected_at is not null));
alter table public.complete_orders add constraint complete_orders_buyer_check check (buyer in ('user', 'guest'));
alter table public.complete_orders add constraint complete_orders_claim_method_check check (claim_method is null or claim_method in ('cookie', 'email_otp'));
alter table public.complete_orders add constraint complete_orders_hash_format check (
  (claim_secret_hash is null or claim_secret_hash ~ '^[0-9a-f]{64}$') and (purchase_email_hmac is null or purchase_email_hmac ~ '^[0-9a-f]{64}$'));
-- 本人の注文：秘密値なし・所有者あり。ゲストの注文：秘密値と期限あり。引き継ぎ前は所有者 NULL、引き継ぎ後は所有者＝引き継いだ人
alter table public.complete_orders add constraint complete_orders_buyer_consistency check (
  (buyer = 'user' and user_id is not null and claim_secret_hash is null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null)
  or (buyer = 'guest' and claim_secret_hash is not null and claim_expires_at is not null
      and ((user_id is null and claimed_by is null and claimed_at is null and claim_method is null)
           or (user_id is not null and claimed_by = user_id and claimed_at is not null and claim_method is not null))));
create unique index if not exists complete_orders_claim_secret_uq on public.complete_orders (claim_secret_hash) where claim_secret_hash is not null;
create index if not exists complete_orders_unclaimed_email_idx on public.complete_orders (purchase_email_hmac)
  where buyer = 'guest' and user_id is null and purchase_email_hmac is not null;

-- 同じ記録の注文の重なり：決済待ちは1つ、支払済みは解析・完全解析それぞれ1つ
--  （旧索引は「決済待ち・支払済みを合わせて1つ」で、¥1,000 の支払い後の ¥2,000 を作れないため置き換える）
drop index if exists public.complete_orders_one_live_per_session;
create unique index if not exists complete_orders_one_open_per_session
  on public.complete_orders (diagnosis_session_id) where status in ('created', 'checkout_open');
create unique index if not exists complete_orders_one_paid_analysis_per_session
  on public.complete_orders (diagnosis_session_id) where offer = 'analysis' and status in ('paid', 'disputed');
create unique index if not exists complete_orders_one_paid_complete_per_session
  on public.complete_orders (diagnosis_session_id) where offer in ('direct_complete', 'analysis_upgrade') and status in ('paid', 'disputed');

-- 3. 権利・生成物・MENTOR 目標：ゲスト（所有者 NULL）を許す。権利の重複は記録単位で防ぐ
alter table public.record_entitlements alter column user_id drop not null;
create unique index if not exists record_entitlements_one_active_per_session
  on public.record_entitlements (diagnosis_session_id, right_type) where status in ('active', 'suspended');
alter table public.complete_reports alter column user_id drop not null;
alter table public.record_mentor_goals alter column user_id drop not null;

-- 4. 注文の前提（トリガー）：所有者が記録と一致・本人の注文は登録完了済み・ゲストの注文はゲスト記録だけ・
--    解析レポートは ETI v2 の記録・完全解析は RC1 の版と一致し、MENTOR 目標が注文の値と一致
create or replace function public.complete_orders_require_eligibility()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_owner uuid;
  v_guest timestamptz;
  v_found boolean;
  v_onboarding text;
  v_goal record;
begin
  select s.user_id, s.guest_created_at, true into v_owner, v_guest, v_found
    from public.diagnosis_sessions s where s.id = new.diagnosis_session_id;
  if v_found is null or v_owner is distinct from new.user_id then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  if new.buyer = 'guest' then
    if new.user_id is not null or v_guest is null then
      raise exception 'complete_not_owner' using errcode = '42501';
    end if;
  else
    select p.onboarding_status into v_onboarding from public.profiles p where p.id = new.user_id;
    if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
      raise exception 'complete_onboarding_required' using errcode = '42501';
    end if;
  end if;
  if new.offer = 'analysis' then
    if not exists (select 1 from public.diagnosis_results r
                    where r.session_id = new.diagnosis_session_id and r.diagnosis_version = 'ETI-2.0') then
      raise exception 'complete_version_not_eligible' using errcode = '42501';
    end if;
    return new;
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
   where g.diagnosis_session_id = new.diagnosis_session_id and g.user_id is not distinct from new.user_id;
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

-- 再購入の禁止：解析レポートは解析権（状態を問わない）・支払済みの解析／完全解析の注文がある記録では作らない。
--             完全解析は完全解析権（状態を問わない）・支払済みの完全解析の注文がある記録では作らない。
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = new.diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = new.diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- MENTOR 目標の所有者：記録の所有者と一致（ゲスト記録は NULL どうし）。決済待ち・支払済みの「完全解析の」注文がある間は変えない
create or replace function public.record_mentor_goals_ownership()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.diagnosis_session_id is null or not exists (
    select 1 from public.diagnosis_sessions s
     where s.id = new.diagnosis_session_id and s.user_id is not distinct from new.user_id
       and (s.user_id is not null or s.guest_created_at is not null)) then
    raise exception 'mentor_goal_record_not_found' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.goal_id is not distinct from old.goal_id
       and new.goal_catalog_version is not distinct from old.goal_catalog_version then
      new.selected_at := old.selected_at;
    elsif old.locked_at is null then
      if exists (select 1 from public.complete_orders o
                  where o.diagnosis_session_id = old.diagnosis_session_id
                    and o.offer in ('direct_complete', 'analysis_upgrade')
                    and o.status in ('created', 'checkout_open', 'paid', 'disputed')) then
        raise exception 'mentor_goal_checkout_in_progress' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 支払い後（locked_at あり）の目標は変えない。所有者は引き継ぎ（NULL → 本人）の時だけ変えられる
create or replace function public.record_mentor_goals_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.locked_at is not null and (
       new.goal_id is distinct from old.goal_id
    or new.goal_catalog_version is distinct from old.goal_catalog_version
    or new.selected_at is distinct from old.selected_at
    or new.locked_at is distinct from old.locked_at
    or (new.user_id is distinct from old.user_id
        and not (old.user_id is null and new.user_id is not null and current_setting('app.complete_claim', true) = 'on'))) then
    raise exception 'mentor_goal_locked' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 5. ゲスト購入の記録を作る（サーバーが回答から算出し直した保存値だけを渡す。保存 RPC の v2 と同じ形）
create or replace function public.complete_create_guest_record(
    p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb,
    p_item_set_version text, p_scoring_version text, p_translation_model_version text,
    p_character_profile_version text, p_mirror_model_version text)
  returns uuid
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
begin
  if p_encoded_answers is null or p_encoded_answers !~ '^[0-9a-z]+$' or length(p_encoded_answers) not between 8 and 400 or jsonb_typeof(p_answers_v2) <> 'object'
     or jsonb_typeof(p_v2_scores) <> 'object' or jsonb_typeof(p_v2_rankings) <> 'object' or jsonb_typeof(p_mirror_snapshot) is null then
    raise exception 'complete_invalid_guest_record' using errcode = '22023';
  end if;
  insert into public.diagnosis_sessions (user_id, diagnosis_type, diagnosis_version, item_set_version, scoring_version,
                                         client_session_id, completed_at, guest_created_at)
  values (null, 'element', 'ETI-2.0', p_item_set_version, p_scoring_version, gen_random_uuid(), v_now, v_now)
  returning id into v_id;
  insert into public.diagnosis_answers (session_id, answers, answers_v2, encoded_answers)
  values (v_id, '{}'::jsonb, p_answers_v2, p_encoded_answers);
  insert into public.diagnosis_results (session_id, primary_result, scores, character_matches, diagnosis_code,
                                        diagnosis_version, item_set_version, scoring_version, translation_model_version,
                                        character_profile_version, mirror_model_version, v2_scores, v2_rankings, mirror_snapshot)
  values (v_id, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, p_encoded_answers,
          'ETI-2.0', p_item_set_version, p_scoring_version, p_translation_model_version,
          p_character_profile_version, p_mirror_model_version, p_v2_scores, p_v2_rankings, p_mirror_snapshot);
  return v_id;
end;
$$;

-- 6. 注文の作成（本人・ゲスト共通の内部処理）。金額・根拠・MENTOR 目標は DB が記録から決める（ブラウザの値は使わない）。
--    同じ記録の決済待ちの注文があれば、それを返す（offer が違えば API が Stripe の Session を閉じてから作り直す）。
create or replace function public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                 p_offer text, p_idempotency_key text, p_claim_secret_hash text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_session public.diagnosis_sessions%rowtype;
  v_has_record_analysis boolean;
  v_has_legacy_binding boolean;
  v_has_legacy_purchase boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
  v_guest boolean := p_user_id is null;
begin
  if p_offer not in ('analysis', 'direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  if v_guest and (p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'complete_invalid_claim_secret' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id;
  if not found or v_session.user_id is distinct from p_user_id or (v_guest and v_session.guest_created_at is null) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id
       or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  v_has_legacy_binding := not v_guest and exists (select 1 from public.complete_legacy_bindings b
                                   join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                                  where b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id
                                    and pe.status = 'active');
  v_has_legacy_purchase := exists (
      select 1
        from public.diagnosis_answers a
        join public.purchase_entitlements pe
          on pe.diagnosis_code_hash = encode(sha256(convert_to(
               case when v_session.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end, 'UTF8')), 'hex')
       where a.session_id = p_diagnosis_session_id and pe.status = 'active' and pe.product_type in ('core1', 'complete'));

  -- 再購入の禁止（トリガーでも確かめる）
  if p_offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = p_diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  if p_offer = 'analysis' then
    -- 旧 ¥1,000（診断コードのハッシュが一致）を購入済みなら、解析レポートは購入済み（重ねて売らない）
    if v_has_legacy_purchase or v_has_legacy_binding then
      raise exception 'complete_analysis_already_purchased' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 1000;
  elsif p_offer = 'direct_complete' then
    if v_has_record_analysis or v_has_legacy_binding then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    if v_has_legacy_purchase then
      raise exception 'complete_legacy_purchase_pending' using errcode = '42501';
    end if;
    v_basis := null;
    v_amount := 3000;
  else
    if v_has_record_analysis then
      v_basis := 'record_entitlement';
    elsif v_has_legacy_binding then
      v_basis := 'legacy_purchase_entitlement';
    else
      raise exception 'complete_upgrade_requires_analysis' using errcode = '42501';
    end if;
    v_amount := 2000;
  end if;

  if p_offer = 'analysis' then
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'test', null, p_idempotency_key,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  else
    select * into v_goal from public.record_mentor_goals g
     where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id is not distinct from p_user_id;
    if not found then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                        mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                        buyer, claim_secret_hash, claim_expires_at)
    values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'test', v_basis, p_idempotency_key,
            v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at,
            case when v_guest then 'guest' else 'user' end, case when v_guest then p_claim_secret_hash end,
            case when v_guest then now() + interval '180 days' end)
    returning id into v_id;
  end if;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

-- 本人の注文（従来の関数名・引数のまま。analysis を受け付けるようになった）
create or replace function public.complete_create_order(p_user_id uuid, p_diagnosis_session_id uuid,
                                                        p_offer text, p_idempotency_key text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;
  return query select * from public.complete_create_order_internal(p_user_id, p_diagnosis_session_id, p_offer, p_idempotency_key, null);
end;
$$;

-- ゲストの注文。完全解析は MENTOR 目標を同じトランザクションで記録へ入れてから作る（支払い前なら選び直せる）
create or replace function public.complete_create_guest_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text,
                                                              p_claim_secret_hash text, p_goal_id text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_offer in ('direct_complete', 'analysis_upgrade') then
    if p_goal_id is null or p_goal_id not in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01') then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
    if not exists (select 1 from public.diagnosis_sessions s
                    where s.id = p_diagnosis_session_id and s.user_id is null and s.guest_created_at is not null) then
      raise exception 'complete_record_not_found' using errcode = '42501';
    end if;
    -- 完全解析を購入済みの記録では、目標に触れる前に断る（ロック済みの目標の書き換えを試みない）
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = p_diagnosis_session_id
                  and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    insert into public.record_mentor_goals (diagnosis_session_id, user_id, goal_catalog_version, goal_id, selected_at)
    values (p_diagnosis_session_id, null, 'CORE1-MENTOR-GOALS-1.0.0', p_goal_id, now())
    on conflict (diagnosis_session_id) do update
      set goal_id = excluded.goal_id, goal_catalog_version = excluded.goal_catalog_version, selected_at = excluded.selected_at;
  elsif p_goal_id is not null then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  return query select * from public.complete_create_order_internal(null, p_diagnosis_session_id, p_offer, p_idempotency_key, p_claim_secret_hash);
end;
$$;

-- 決済待ちの注文を閉じる（offer を変えて買い直す時。API が Stripe の Session を閉じた後に呼ぶ）。支払済みは変えない
create or replace function public.complete_cancel_open_order(p_order_id uuid, p_checkout_session_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.status = 'canceled' then
    return 'noop';
  end if;
  if v_order.status not in ('created', 'checkout_open') then
    raise exception 'complete_order_not_open' using errcode = '42501';
  end if;
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id is distinct from p_checkout_session_id then
    raise exception 'complete_checkout_session_mismatch' using errcode = '42501';
  end if;
  update public.complete_orders set status = 'canceled', failure_code = 'replaced', updated_at = now() where id = p_order_id;
  return 'applied';
end;
$$;

-- 7. 支払い確定（checkout.session.completed、または戻り先での Stripe への問い合わせ）：
--    注文 paid・（完全解析は MENTOR ロックと生成物 queued）・権利付与・イベント processed を1トランザクションで行う。
create or replace function public.complete_apply_payment(
    p_event_id text, p_event_created timestamptz, p_livemode boolean,
    p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text,
    p_amount_total integer, p_currency text, p_payment_status text,
    p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.completed';
  v_order public.complete_orders%rowtype;
  v_res public.diagnosis_results%rowtype;
  v_code text;
  v_kinds text[];
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || v_order.diagnosis_session_id::text, 0));

  v_code := case
    when p_payment_status is distinct from 'paid' then 'payment_not_paid'
    when p_livemode is distinct from false or v_order.stripe_mode <> 'test' then 'livemode_mismatch'
    when p_currency is distinct from 'jpy' then 'currency_mismatch'
    when p_amount_total is distinct from v_order.amount then 'amount_mismatch'
    when v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then 'checkout_session_mismatch'
    when v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then 'payment_intent_mismatch'
    else null end;
  if v_code is not null then
    if v_order.status in ('created', 'checkout_open') then
      update public.complete_orders set status = 'failed', failure_code = v_code, updated_at = now() where id = v_order.id;
    end if;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', v_code, v_order.id);
    return 'ignored:' || v_code;
  end if;

  if v_order.status in ('paid', 'disputed', 'refunded') then
    update public.complete_orders set last_stripe_event_id = p_event_id, last_event_created = greatest(last_event_created, p_event_created)
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  -- 期限切れ・片付け済みの注文に支払いが届いた：同じ記録に同じ種類（解析／完全解析）の別の有効な注文があれば運営者確認
  v_kinds := case when v_order.offer = 'analysis' then array['analysis', 'direct_complete']
                  else array['direct_complete', 'analysis_upgrade'] end;
  if v_order.status in ('expired', 'canceled') and (
       exists (select 1 from public.complete_orders o2
                where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
                  and (o2.status in ('created', 'checkout_open')
                       or (o2.offer = any (v_kinds) and o2.status in ('paid', 'disputed', 'refunded'))))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = v_order.diagnosis_session_id
                     and e.right_type = case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)) then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'live_order_conflict', v_order.id);
    return 'ignored:live_order_conflict';
  end if;

  if v_order.offer <> 'analysis' then
    update public.record_mentor_goals
       set goal_id = v_order.mentor_goal_id, goal_catalog_version = v_order.mentor_goal_catalog_version,
           selected_at = v_order.mentor_goal_selected_at, locked_at = coalesce(locked_at, now())
     where diagnosis_session_id = v_order.diagnosis_session_id and user_id is not distinct from v_order.user_id;
    if not found then
      raise exception 'complete_mentor_goal_missing' using errcode = '42501';
    end if;
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  -- 権利：analysis は analysis、direct は analysis（記録に有効な analysis 権が無い場合）と complete、upgrade は complete
  if v_order.offer in ('analysis', 'direct_complete') and not exists (
       select 1 from public.record_entitlements e
        where e.diagnosis_session_id = v_order.diagnosis_session_id
          and e.right_type = 'analysis' and e.status in ('active', 'suspended')) then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'analysis', v_order.id)
    on conflict (source_order_id, right_type) do nothing;
  end if;
  if v_order.offer in ('direct_complete', 'analysis_upgrade') then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'complete', v_order.id)
    on conflict (source_order_id, right_type) do nothing;

    if not exists (select 1 from public.complete_reports r where r.source_order_id = v_order.id) then
      select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
      if not found then
        raise exception 'complete_result_missing' using errcode = '42501';
      end if;
      insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                           content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                           translation_model_version, character_profile_version, mirror_model_version,
                                           mentor_goal_catalog_version, mentor_goal_id, input_sha256)
      values (v_order.user_id, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
              p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
              v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
              v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256);
    end if;
  end if;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 購入時メールの HMAC（ゲストの注文・支払済みだけ。最初の値を変えない）。API が支払い確定の後に呼ぶ（冪等）
create or replace function public.complete_set_purchase_email(p_order_id uuid, p_purchase_email_hmac text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  if p_purchase_email_hmac is null or p_purchase_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_email_hmac' using errcode = '22023';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.buyer <> 'guest' or v_order.status not in ('paid', 'disputed', 'refunded') then
    return 'skipped';
  end if;
  if v_order.purchase_email_hmac is not null then
    return 'noop';
  end if;
  update public.complete_orders set purchase_email_hmac = p_purchase_email_hmac, updated_at = now() where id = p_order_id;
  return 'applied';
end;
$$;

-- 8. 閲覧の権限確認（本人：p_user_id、ゲスト：p_user_id NULL ＝ 所有者 NULL の記録だけ。ゲストの確認は API が Cookie で行う）
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order_status text;
  v_entitled boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select o.status into v_order_status from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id is not distinct from p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order_status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;

-- 9. 解析レポートの閲覧権（診断コードのハッシュ単位。/api/report-data が旧 purchase_entitlements と合わせて確かめる）
--    記録単位の analysis 権（active）がある記録の診断コードのハッシュと一致すれば true
create or replace function public.complete_analysis_active_for_code_hash(p_code_hash text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_code_hash ~ '^[0-9a-f]{64}$' and exists (
    select 1
      from public.record_entitlements e
      join public.diagnosis_answers a on a.session_id = e.diagnosis_session_id
      join public.diagnosis_sessions s on s.id = e.diagnosis_session_id
     where e.right_type = 'analysis' and e.status = 'active' and s.diagnosis_version = 'ETI-2.0'
       and encode(sha256(convert_to('v2_' || a.encoded_answers, 'UTF8')), 'hex') = p_code_hash)
$$;

-- 10. 引き継ぎ：ゲスト記録の所有者を NULL → 本人へ（記録・回答・結果は記録の所有者に従う。注文・権利・目標・生成物を写す）
create or replace function public.complete_transfer_guest_record(p_user_id uuid, p_diagnosis_session_id uuid, p_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_session public.diagnosis_sessions%rowtype;
  v_onboarding text;
begin
  if p_user_id is null or p_method not in ('cookie', 'email_otp') then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_session from public.diagnosis_sessions s where s.id = p_diagnosis_session_id for update;
  if not found or v_session.guest_created_at is null then
    raise exception 'complete_claim_invalid' using errcode = '42501';
  end if;
  if v_session.user_id = p_user_id then
    return 'noop';
  end if;
  if v_session.user_id is not null then
    raise exception 'complete_claim_conflict' using errcode = '42501';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  -- 決済待ちの注文がある間は引き継がない（支払いと引き継ぎの順序を1つに決める）
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open')) then
    raise exception 'complete_claim_checkout_open' using errcode = '42501';
  end if;
  perform set_config('app.complete_claim', 'on', true);
  update public.diagnosis_sessions set user_id = p_user_id where id = p_diagnosis_session_id;
  update public.complete_orders
     set user_id = p_user_id, claimed_by = p_user_id, claimed_at = now(), claim_method = p_method, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_entitlements set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.record_mentor_goals set user_id = p_user_id
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  update public.complete_reports set user_id = p_user_id, updated_at = now()
   where diagnosis_session_id = p_diagnosis_session_id and user_id is null;
  perform set_config('app.complete_claim', 'off', true);
  return 'applied';
end;
$$;

-- 引き継ぎ（Cookie の秘密値）：支払済みのゲスト注文・秘密値のハッシュが一致・期限内。
--   同じ人の再実行は noop（冪等）。別の人が引き継ぎ済みなら complete_claim_conflict。秘密値の不一致・注文なしは complete_claim_invalid。
create or replace function public.complete_claim_guest_record(p_user_id uuid, p_order_id uuid, p_claim_secret_hash text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  if p_user_id is null or p_claim_secret_hash is null or p_claim_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id;
  if not found or v_order.buyer <> 'guest' or v_order.claim_secret_hash is distinct from p_claim_secret_hash then
    raise exception 'complete_claim_invalid' using errcode = '42501';
  end if;
  if v_order.user_id is not null then
    if v_order.user_id = p_user_id then
      return 'noop';
    end if;
    raise exception 'complete_claim_conflict' using errcode = '42501';
  end if;
  if v_order.claim_expires_at < now() then
    raise exception 'complete_claim_expired' using errcode = '42501';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'complete_claim_not_paid' using errcode = '42501';
  end if;
  return public.complete_transfer_guest_record(p_user_id, v_order.diagnosis_session_id, 'cookie');
end;
$$;

-- 引き継ぎ（Cookie を失った時）：API が「Supabase のメール OTP で確認した本人のメール」から作った HMAC と、
--   Stripe の購入時メールの HMAC が一致する、支払済み・未引き継ぎのゲスト記録をすべて本人へ。件数を返す。
create or replace function public.complete_claim_guest_by_email(p_user_id uuid, p_purchase_email_hmac text)
  returns table (claimed integer, skipped integer)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_sid uuid;
  v_claimed integer := 0;
  v_skipped integer := 0;
begin
  if p_user_id is null or p_purchase_email_hmac is null or p_purchase_email_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_claim_invalid' using errcode = '22023';
  end if;
  for v_sid in
    select distinct o.diagnosis_session_id from public.complete_orders o
     where o.buyer = 'guest' and o.user_id is null and o.status = 'paid' and o.purchase_email_hmac = p_purchase_email_hmac
  loop
    begin
      if public.complete_transfer_guest_record(p_user_id, v_sid, 'email_otp') = 'applied' then
        v_claimed := v_claimed + 1;
      end if;
    exception when others then
      if sqlerrm in ('complete_claim_conflict', 'complete_claim_checkout_open') then
        v_skipped := v_skipped + 1;
      else
        raise;
      end if;
    end;
  end loop;
  return query select v_claimed, v_skipped;
end;
$$;

-- 11. 関数の権限：EXECUTE は service_role だけ
revoke all on function public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_create_order_internal(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_create_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_create_guest_order(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_cancel_open_order(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_set_purchase_email(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_report_for_view(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_analysis_active_for_code_hash(text) from public, anon, authenticated;
revoke all on function public.complete_transfer_guest_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_claim_guest_record(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_claim_guest_by_email(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_ownership() from public, anon, authenticated;
revoke all on function public.record_mentor_goals_guard() from public, anon, authenticated;
revoke all on function public.diagnosis_sessions_owner_immutable() from public, anon, authenticated;
grant execute on function public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text) to service_role;
grant execute on function public.complete_create_order_internal(uuid, uuid, text, text, text) to service_role;
grant execute on function public.complete_create_order(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_create_guest_order(uuid, text, text, text, text) to service_role;
grant execute on function public.complete_cancel_open_order(uuid, text) to service_role;
grant execute on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;
grant execute on function public.complete_set_purchase_email(uuid, text) to service_role;
grant execute on function public.complete_report_for_view(uuid, uuid) to service_role;
grant execute on function public.complete_analysis_active_for_code_hash(text) to service_role;
grant execute on function public.complete_transfer_guest_record(uuid, uuid, text) to service_role;
grant execute on function public.complete_claim_guest_record(uuid, uuid, text) to service_role;
grant execute on function public.complete_claim_guest_by_email(uuid, text) to service_role;

-- 12. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  f text;
begin
  if exists (select 1 from public.diagnosis_sessions where user_id is null and guest_created_at is null) then
    raise exception 'diagnosis_sessions without owner or guest marker';
  end if;
  foreach f in array array[
      'public.complete_create_guest_record(jsonb, text, jsonb, jsonb, jsonb, text, text, text, text, text)',
      'public.complete_create_order_internal(uuid, uuid, text, text, text)',
      'public.complete_create_order(uuid, uuid, text, text)',
      'public.complete_create_guest_order(uuid, text, text, text, text)',
      'public.complete_cancel_open_order(uuid, text)',
      'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)',
      'public.complete_set_purchase_email(uuid, text)',
      'public.complete_report_for_view(uuid, uuid)',
      'public.complete_analysis_active_for_code_hash(text)',
      'public.complete_transfer_guest_record(uuid, uuid, text)',
      'public.complete_claim_guest_record(uuid, uuid, text)',
      'public.complete_claim_guest_by_email(uuid, text)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_create_guest_record', 'complete_create_order_internal', 'complete_create_order',
                                'complete_create_guest_order', 'complete_cancel_open_order', 'complete_apply_payment',
                                'complete_set_purchase_email', 'complete_report_for_view', 'complete_analysis_active_for_code_hash',
                                'complete_transfer_guest_record', 'complete_claim_guest_record', 'complete_claim_guest_by_email',
                                'complete_orders_no_repurchase', 'record_mentor_goals_ownership', 'diagnosis_sessions_owner_immutable')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_07 function is not security invoker with empty search_path';
  end if;
  if to_regclass('public.complete_orders_one_live_per_session') is not null then
    raise exception 'old live order index still exists';
  end if;
end
$$;

-- 13. migration 履歴（SQL Editor で実行するため、ここで1行だけ追加する。二度当てしても増えない）
insert into supabase_migrations.schema_migrations (version, name)
values ('20261009120000', 'complete_07_guest_checkout_claim')
on conflict (version) do nothing;

commit;
