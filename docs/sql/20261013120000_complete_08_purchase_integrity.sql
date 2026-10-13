-- ============================================================
-- complete_08：購入・権利・閲覧の整合（リリース前監査 C1〜C9・D1〜D6 の DB 側）
-- 2026-10-13。Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】本文に制約の削除・追加を含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴（supabase_migrations.schema_migrations）へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイル（Stripe Live・Preview の確認なし）で行う。
-- 前提：complete_01〜07 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない（関数・トリガー関数の置き換えと、新しい表・列・関数の追加だけ）。
-- 戻し：本文の各節の「戻し」を参照（置き換えた関数は complete_07 の本文を再実行すると元に戻る）。
-- ============================================================
--
-- §1 同じ診断結果の二重購入の防止（D1）
--   ・同じ本人（user_id）・同じ不変の診断結果（診断コードのハッシュ。旧購入権の参照値と同じ規則）の記録を「結果グループ」とし、
--     グループのどれかで購入済みなら、別の記録で同じ物を作らない（注文の作成・注文のトリガー・期限切れ後の支払いの3か所）。
--   ・ゲスト（user_id NULL）の記録はグループを作らない（診断コードの文字列だけで別の人の権利を共有しない）。
--   ・ロックの順：結果グループ（complete_result:<user>:<鍵>）→ 記録（complete_order:<記録>）→ 行。
--     注文の作成と引き継ぎ（complete_transfer_guest_record）が同じ順で取る。
--   ・API（lib/purchase-state.js）も同じ規則で offer を決める。ここは最終の防御。
--
-- §2 閲覧権の確認と旧 ¥1,000 の停止・復帰（D5・D6）
--   ・legacy_access_blocks：運営者が旧 ¥1,000（診断コードのハッシュ単位）の閲覧を停止（suspended）・取消（revoked）した記録。
--     取消は最終。停止は復帰（lifted）できる。既存の購入者は、行が無い限り今までどおり読める（一括で失効させない）。
--     操作は complete_admin_legacy_access（SQL Editor で運営者が実行。API のロールには EXECUTE を与えない）。
--     操作の記録は legacy_access_events（追記だけ。メール・Stripe ID・診断コードは入れない）。
--   ・閲覧（report-data・verify・my-report-link・マイページの権利）は、停止・取消の旧購入を権利に数えない。
--   ・¥2,000 の完全解析は、根拠（同じ記録の有効な解析権、または結び付けた有効な旧 ¥1,000）が有効な間だけ閲覧できる
--     （complete_report_for_view の state = basis_inactive）。¥1,000 の返金・敗訴・停止で根拠が失われた時は、
--     ¥2,000 の権利は残したまま閲覧を止める（返金するかは運営者が判断する。手順書を参照）。
--   ・戻し：legacy_access_blocks・legacy_access_events を drop し、complete_report_for_view・注文の作成関数を complete_07 の本文で戻す。
--
-- §3 完全解析の生成の失敗からの回復（C6）
--   ・自動の再試行を使い切った（または再試行しない失敗の）生成物は「失敗（最終）」。画面は「作成し直しています」のままにしない。
--   ・complete_regenerate_report：本人（またはゲスト記録の秘密値を確かめた API）が、同じ支払済みの注文・同じ目標・同じ生成物の行で
--     作り直しを依頼する（新しい注文・権利・請求は作らない）。行を FOR UPDATE で取り、最終の失敗の時だけ queued に戻すので、
--     連打・同時の依頼・Webhook の再送でも生成は1つ。本人の依頼は1つの生成物につき 2 回まで（manual_retries）。
--     入力・素材の不一致など、作り直しても直らない失敗は運営者へ（operator_required）。
--   ・complete_admin_regenerate_report：運営者（SQL Editor）が原因を直した後に、回数の上限に関係なく queued に戻す。
--     操作の記録は complete_report_admin_events（追記だけ）。API のロールは実行できない。
--   ・戻し：complete_reports.manual_retries を drop、関数2つと complete_report_admin_events を drop。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜07 の適用済みを確かめる
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
  if to_regprocedure('public.complete_claim_guest_record(uuid, uuid, text)') is null
     or to_regprocedure('public.complete_create_order_internal(uuid, uuid, text, text, text)') is null
     or to_regprocedure('public.complete_report_for_view(uuid, uuid)') is null then
    raise exception 'complete_01..07 are not applied';
  end if;
end
$$;

-- ============================================================
-- §2（表）旧 ¥1,000 の停止・取消（関数が参照するため、先に作る）
-- ============================================================
create table if not exists public.legacy_access_blocks (
  diagnosis_code_hash  text primary key check (diagnosis_code_hash ~ '^[0-9a-f]{64}$'),
  status               text not null check (status in ('suspended', 'revoked', 'lifted')),
  reason_code          text not null check (reason_code in ('refund', 'chargeback', 'fraud', 'customer_request', 'operator_error')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create table if not exists public.legacy_access_events (
  id                   uuid primary key default gen_random_uuid(),
  diagnosis_code_hash  text not null check (diagnosis_code_hash ~ '^[0-9a-f]{64}$'),
  action               text not null check (action in ('suspend', 'revoke', 'restore')),
  result_status        text not null check (result_status in ('suspended', 'revoked', 'lifted', 'noop')),
  reason_code          text not null check (reason_code in ('refund', 'chargeback', 'fraud', 'customer_request', 'operator_error')),
  incident_id          text not null unique check (incident_id ~ '^[0-9a-f]{12}$'),
  created_at           timestamptz not null default now()
);
revoke all on table public.legacy_access_blocks, public.legacy_access_events from public, anon, authenticated, service_role;
grant select on table public.legacy_access_blocks to service_role;
alter table public.legacy_access_blocks enable row level security;
alter table public.legacy_access_events enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する。書き込みは運営者の関数だけ）

create or replace function public.legacy_access_events_immutable()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  raise exception 'legacy_access_events_immutable' using errcode = '42501';
end;
$$;
revoke all on function public.legacy_access_events_immutable() from public, anon, authenticated, service_role;
create or replace trigger legacy_access_events_no_update
  before update or delete on public.legacy_access_events
  for each row execute function public.legacy_access_events_immutable();
create or replace trigger legacy_access_events_no_truncate
  before truncate on public.legacy_access_events
  for each statement execute function public.legacy_access_events_immutable();

-- 診断コードのハッシュの旧 ¥1,000 が停止・取消されているか
create or replace function public.complete_legacy_blocked(p_diagnosis_code_hash text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select exists (select 1 from public.legacy_access_blocks k
                  where k.diagnosis_code_hash = p_diagnosis_code_hash and k.status in ('suspended', 'revoked'))
$$;

-- ============================================================
-- §1 同じ診断結果の二重購入の防止（D1）
-- ============================================================

-- 記録の診断結果の鍵（ETI v2 は 'v2_' 付きの診断コード、旧版は診断コードの SHA-256。回答が無ければ NULL）
create or replace function public.complete_result_key(p_diagnosis_session_id uuid)
  returns text
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select encode(sha256(convert_to(case when s.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers
                                        else a.encoded_answers end, 'UTF8')), 'hex')
    from public.diagnosis_sessions s
    join public.diagnosis_answers a on a.session_id = s.id
   where s.id = p_diagnosis_session_id and a.encoded_answers is not null and a.encoded_answers <> ''
   limit 1
$$;

-- 結果グループ：同じ本人の、同じ診断結果の記録（指定した記録を含む）。本人が NULL・鍵が無い時は指定した記録だけ
create or replace function public.complete_result_group(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (diagnosis_session_id uuid)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_diagnosis_session_id
  union
  select s.id
    from public.diagnosis_sessions s
   where p_user_id is not null
     and s.user_id = p_user_id
     and public.complete_result_key(s.id) = public.complete_result_key(p_diagnosis_session_id)
$$;

-- 結果グループの直列化（本人の注文・引き継ぎ）。記録のロックより先に取る
create or replace function public.complete_lock_result_group(p_user_id uuid, p_diagnosis_session_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_key text;
begin
  if p_user_id is null then
    return;
  end if;
  v_key := public.complete_result_key(p_diagnosis_session_id);
  if v_key is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_result:' || p_user_id::text || ':' || v_key, 0));
end;
$$;

-- 結果グループの別の記録で、同じ物（解析レポート／完全解析）を購入済み・決済中か（本人の注文だけ。ゲストは false）
--   p_kind：'analysis'（解析レポート）／'complete'（完全解析）／'analysis_active'（有効・一時停止中の解析権か有効な結び付け）
create or replace function public.complete_result_group_has(p_user_id uuid, p_diagnosis_session_id uuid, p_kind text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
      from public.complete_result_group(p_user_id, p_diagnosis_session_id) g
     where g.diagnosis_session_id <> p_diagnosis_session_id
       and (
         (p_kind = 'open' and exists (
            select 1 from public.complete_orders o
             where o.diagnosis_session_id = g.diagnosis_session_id and o.status in ('created', 'checkout_open')))
         or (p_kind = 'analysis' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed', 'refunded'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis')
            or exists (select 1 from public.complete_legacy_bindings b
                         join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                        where b.diagnosis_session_id = g.diagnosis_session_id and b.user_id = p_user_id and pe.status = 'active'
                          and not public.complete_legacy_blocked(pe.diagnosis_code_hash))))
         or (p_kind = 'complete' and (
            exists (select 1 from public.complete_orders o
                     where o.diagnosis_session_id = g.diagnosis_session_id
                       and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed', 'refunded'))
            or exists (select 1 from public.record_entitlements e
                        where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'complete')))
         or (p_kind = 'analysis_active' and (
            exists (select 1 from public.record_entitlements e
                     where e.diagnosis_session_id = g.diagnosis_session_id and e.right_type = 'analysis'
                       and e.status in ('active', 'suspended'))
            or exists (select 1 from public.complete_legacy_bindings b
                         join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                        where b.diagnosis_session_id = g.diagnosis_session_id and b.user_id = p_user_id and pe.status = 'active'
                          and not public.complete_legacy_blocked(pe.diagnosis_code_hash))))
       ))
$$;

-- 注文の作成（complete_07 の本文に、結果グループの直列化・確認と、解析権の一時停止中の ¥3,000 の拒否を加えたもの）
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
  -- ロックの順：結果グループ → 記録
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
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
  -- 旧 ¥1,000：運営者が停止・取消したもの（§2 legacy_access_blocks）は権利に数えない
  v_has_legacy_binding := not v_guest and exists (select 1 from public.complete_legacy_bindings b
                                   join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                                  where b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id
                                    and pe.status = 'active' and not public.complete_legacy_blocked(pe.diagnosis_code_hash));
  v_has_legacy_purchase := exists (
      select 1
        from public.diagnosis_answers a
        join public.purchase_entitlements pe
          on pe.diagnosis_code_hash = encode(sha256(convert_to(
               case when v_session.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end, 'UTF8')), 'hex')
       where a.session_id = p_diagnosis_session_id and pe.status = 'active' and pe.product_type in ('core1', 'complete')
         and not public.complete_legacy_blocked(pe.diagnosis_code_hash));

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

  -- 同じ本人・同じ診断結果の別の記録（D1）：決済中なら作らない。購入済みの物は重ねて売らない
  if not v_guest then
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(p_user_id, p_diagnosis_session_id, case when p_offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
    if p_offer = 'direct_complete' and public.complete_result_group_has(p_user_id, p_diagnosis_session_id, 'analysis_active') then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
  end if;
  -- 解析権が一時停止中（dispute 中）の記録では ¥3,000 を作らない（解析権を重ねて作らない）
  if p_offer = 'direct_complete' and exists (select 1 from public.record_entitlements e
                                              where e.diagnosis_session_id = p_diagnosis_session_id
                                                and e.right_type = 'analysis' and e.status = 'suspended') then
    raise exception 'complete_rights_suspended' using errcode = '42501';
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

-- 再購入の禁止（トリガー）：complete_07 の記録単位の確認に、結果グループの確認を加えたもの
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
  if new.user_id is not null then
    perform public.complete_lock_result_group(new.user_id, new.diagnosis_session_id);
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id, 'open') then
      raise exception 'complete_same_result_checkout_open' using errcode = '42501';
    end if;
    if public.complete_result_group_has(new.user_id, new.diagnosis_session_id,
                                        case when new.offer = 'analysis' then 'analysis' else 'complete' end) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- 支払い確定（complete_07 の本文に、期限切れ後の支払いの確認を結果グループへ広げ、ロックの順を
--   結果グループ → 記録 → 注文の行 に揃えたもの。complete_create_order_internal・complete_transfer_guest_record と同じ順）
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
  v_sid uuid;
  v_uid uuid;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  -- ロックの順（全関数で共通）：結果グループ → 記録（complete_order:<記録>）→ 行（注文 → 記録 → 権利・生成物）。
  -- 注文の行を先に取ると、記録のロックを持って注文の行を待つ引き継ぎ・注文の作成と循環する（デッドロック）
  select o.diagnosis_session_id, o.user_id into v_sid, v_uid from public.complete_orders o where o.id = p_order_id;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  perform public.complete_lock_result_group(v_uid, v_sid);
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || v_sid::text, 0));
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  -- ロックを待つ間に引き継がれた（注文の本人が変わった）：取り直しのため一時的な失敗にする（Webhook の再送・次の確認で反映）
  if v_order.user_id is distinct from v_uid then
    raise exception 'complete_retry_later' using errcode = '40001';
  end if;

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
  -- 期限切れ・片付け済みの注文に支払いが届いた：同じ記録（本人の注文は同じ診断結果の記録も）に、
  -- 同じ種類（解析／完全解析）の別の有効な注文・権利があれば運営者確認
  v_kinds := case when v_order.offer = 'analysis' then array['analysis', 'direct_complete']
                  else array['direct_complete', 'analysis_upgrade'] end;
  if v_order.status in ('expired', 'canceled') and (
       exists (select 1 from public.complete_orders o2
                where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
                  and (o2.status in ('created', 'checkout_open')
                       or (o2.offer = any (v_kinds) and o2.status in ('paid', 'disputed', 'refunded'))))
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = v_order.diagnosis_session_id
                     and e.right_type = case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)
       or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id, 'open')
       or public.complete_result_group_has(v_order.user_id, v_order.diagnosis_session_id,
                                           case when v_order.offer = 'analysis' then 'analysis' else 'complete' end)) then
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

-- 引き継ぎ（complete_07 の本文に、結果グループのロックを記録のロックより先に取る処理を加えたもの）
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
  perform public.complete_lock_result_group(p_user_id, p_diagnosis_session_id);
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
  -- 決済待ちの注文がある間は引き継がない（API が Stripe の状態を確かめて片付けてから呼ぶ）
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

revoke all on function public.complete_result_key(uuid) from public, anon, authenticated;
revoke all on function public.complete_result_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_lock_result_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_result_group_has(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_result_key(uuid) to service_role;
grant execute on function public.complete_result_group(uuid, uuid) to service_role;
grant execute on function public.complete_lock_result_group(uuid, uuid) to service_role;
grant execute on function public.complete_result_group_has(uuid, uuid, text) to service_role;

-- ============================================================
-- §2 閲覧権の確認（D5・D6）
-- ============================================================

-- 完全解析の閲覧の権限確認（complete_07 の本文に、¥2,000 の根拠の確認を加えたもの）
--   state：ok／not_found／not_entitled／not_ready／basis_inactive（¥2,000 の根拠の解析レポートの購入が取消・停止中）
create or replace function public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)
  returns table (state text, report_id uuid, storage_path text, output_sha256 text)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
  v_order public.complete_orders%rowtype;
  v_entitled boolean;
  v_basis_ok boolean;
begin
  select * into v_report from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select * into v_order from public.complete_orders o
   where o.id = v_report.source_order_id and o.user_id is not distinct from p_user_id;
  v_entitled := exists (select 1 from public.record_entitlements e
                         where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                           and e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete' and e.status = 'active');
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or v_order.status is distinct from 'paid' or not v_entitled then
    return query select 'not_entitled'::text, null::uuid, null::text, null::text;
    return;
  end if;
  if v_order.offer = 'analysis_upgrade' then
    if v_order.analysis_basis = 'legacy_purchase_entitlement' then
      v_basis_ok := exists (select 1 from public.complete_legacy_bindings b
                              join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                             where b.diagnosis_session_id = p_diagnosis_session_id and b.user_id is not distinct from p_user_id
                               and pe.status = 'active' and not public.complete_legacy_blocked(pe.diagnosis_code_hash));
    else
      v_basis_ok := exists (select 1 from public.record_entitlements e
                             where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'analysis' and e.status = 'active');
    end if;
    if not v_basis_ok then
      return query select 'basis_inactive'::text, null::uuid, null::text, null::text;
      return;
    end if;
  end if;
  if v_report.status <> 'ready' or v_report.storage_path is null or v_report.output_sha256 is null then
    return query select 'not_ready'::text, v_report.id, null::text, null::text;
    return;
  end if;
  return query select 'ok'::text, v_report.id, v_report.storage_path, v_report.output_sha256;
end;
$$;

-- 運営者の操作：旧 ¥1,000 の閲覧の停止（suspend）・取消（revoke・最終）・復帰（restore：停止だけを戻す）。
--   対象は診断コードのハッシュ、または旧購入の Checkout Session ID（どちらか）。同じ照合 ID の再送は前回の結果を返す。
--   SQL Editor で運営者が実行する（API のロールは実行できない）。戻り値：suspended／revoked／lifted／noop
create or replace function public.complete_admin_legacy_access(p_diagnosis_code_hash text, p_stripe_checkout_session_id text,
                                                               p_action text, p_reason_code text, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_hash text := p_diagnosis_code_hash;
  v_prev public.legacy_access_events%rowtype;
  v_cur public.legacy_access_blocks%rowtype;
  v_result text;
begin
  if p_action is null or p_action not in ('suspend', 'revoke', 'restore')
     or p_reason_code is null or p_reason_code not in ('refund', 'chargeback', 'fraud', 'customer_request', 'operator_error')
     or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  if v_hash is null and p_stripe_checkout_session_id is not null then
    select pe.diagnosis_code_hash into v_hash from public.purchase_entitlements pe
     where pe.stripe_checkout_session_id = p_stripe_checkout_session_id;
  end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('legacy_access:' || v_hash, 0));
  select * into v_prev from public.legacy_access_events e where e.incident_id = p_incident_id;
  if found then
    if v_prev.diagnosis_code_hash <> v_hash or v_prev.action <> p_action then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.result_status;
  end if;
  select * into v_cur from public.legacy_access_blocks k where k.diagnosis_code_hash = v_hash;
  if found and v_cur.status = 'revoked' and p_action <> 'revoke' then
    raise exception 'legacy_access_revoked_is_final' using errcode = '42501';
  end if;
  if p_action = 'restore' then
    if not found or v_cur.status = 'lifted' then
      v_result := 'noop';
    else
      update public.legacy_access_blocks set status = 'lifted', reason_code = p_reason_code, updated_at = now() where diagnosis_code_hash = v_hash;
      v_result := 'lifted';
    end if;
  else
    v_result := case when p_action = 'suspend' then 'suspended' else 'revoked' end;
    insert into public.legacy_access_blocks (diagnosis_code_hash, status, reason_code)
    values (v_hash, v_result, p_reason_code)
    on conflict (diagnosis_code_hash) do update set status = excluded.status, reason_code = excluded.reason_code, updated_at = now();
  end if;
  insert into public.legacy_access_events (diagnosis_code_hash, action, result_status, reason_code, incident_id)
  values (v_hash, p_action, v_result, p_reason_code, p_incident_id);
  return v_result;
end;
$$;

revoke all on function public.complete_legacy_blocked(text) from public, anon, authenticated;
grant execute on function public.complete_legacy_blocked(text) to service_role;
revoke all on function public.complete_admin_legacy_access(text, text, text, text, text) from public, anon, authenticated, service_role;

-- ============================================================
-- §3 完全解析の生成の失敗からの回復（C6）
-- ============================================================
alter table public.complete_reports add column if not exists manual_retries integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'complete_reports_manual_retries_range'
                   and conrelid = 'public.complete_reports'::regclass) then
    alter table public.complete_reports add constraint complete_reports_manual_retries_range check (manual_retries between 0 and 20);
  end if;
end
$$;

create table if not exists public.complete_report_admin_events (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.complete_reports(id),
  action       text not null check (action in ('regenerate')),
  result       text not null check (result in ('requeued', 'noop')),
  incident_id  text not null unique check (incident_id ~ '^[0-9a-f]{12}$'),
  created_at   timestamptz not null default now()
);
revoke all on table public.complete_report_admin_events from public, anon, authenticated, service_role;
alter table public.complete_report_admin_events enable row level security;
create or replace trigger complete_report_admin_events_no_update
  before update or delete on public.complete_report_admin_events
  for each row execute function public.legacy_access_events_immutable();
create or replace trigger complete_report_admin_events_no_truncate
  before truncate on public.complete_report_admin_events
  for each statement execute function public.legacy_access_events_immutable();

-- 最終の失敗か（自動の再試行が残っていない）。lib/complete-report-job.js の finalFailure と同じ規則
create or replace function public.complete_report_final_failure(p_status text, p_attempts integer, p_max_attempts integer,
                                                                p_next_retry_at timestamptz, p_lease_expires_at timestamptz)
  returns boolean
  language sql
  immutable
  security invoker
  set search_path = ''
as $$
  select (p_status = 'failed' and (p_next_retry_at is null or p_attempts >= p_max_attempts))
      or (p_status = 'generating' and p_attempts >= p_max_attempts and p_lease_expires_at < now())
$$;

-- 本人（p_user_id）またはゲスト記録（p_user_id = null。API がゲストの秘密値を確かめてから呼ぶ）の作り直しの依頼。
--   戻り値：requeued／in_progress（生成中・自動の再試行待ち）／ready／limit_reached／operator_required／not_entitled／not_found
create or replace function public.complete_regenerate_report(p_user_id uuid, p_diagnosis_session_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_id uuid;
  v_report public.complete_reports%rowtype;
begin
  select r.id into v_id from public.complete_reports r
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id
   order by r.created_at desc
   limit 1;
  if v_id is null then
    return 'not_found';
  end if;
  select * into v_report from public.complete_reports r where r.id = v_id for update;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not exists (select 1 from public.complete_orders o where o.id = v_report.source_order_id and o.status = 'paid')
     or not exists (select 1 from public.record_entitlements e
                     where e.source_order_id = v_report.source_order_id and e.user_id is not distinct from p_user_id
                       and e.right_type = 'complete' and e.status = 'active') then
    return 'not_entitled';
  end if;
  if v_report.status = 'ready' then
    return 'ready';
  end if;
  if not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                              v_report.next_retry_at, v_report.lease_expires_at) then
    return 'in_progress';
  end if;
  -- 作り直しても同じ結果になる失敗（入力・素材・固定値の不一致）は運営者が原因を確かめる
  if v_report.last_error_code in ('materials_changed', 'input_mismatch', 'frozen_versions_mismatch', 'frozen_goal_mismatch',
                                  'record_data_missing', 'report_not_found') then
    return 'operator_required';
  end if;
  if v_report.manual_retries >= 2 then
    return 'limit_reached';
  end if;
  update public.complete_reports
     set status = 'queued', attempts = 0, next_retry_at = null, lease_token = null, lease_expires_at = null,
         manual_retries = manual_retries + 1, updated_at = now()
   where id = v_id;
  return 'requeued';
end;
$$;

-- 運営者の操作：原因を直した後に、最終の失敗の生成物を queued に戻す（回数の上限・失敗の種類に関係なく）。
--   同じ照合 ID の再送は前回の結果。SQL Editor で実行する（API のロールは実行できない）。戻り値：requeued／noop
create or replace function public.complete_admin_regenerate_report(p_report_id uuid, p_incident_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_prev public.complete_report_admin_events%rowtype;
  v_report public.complete_reports%rowtype;
  v_result text;
begin
  if p_report_id is null or p_incident_id is null or p_incident_id !~ '^[0-9a-f]{12}$' then
    raise exception 'complete_admin_invalid_request' using errcode = '22023';
  end if;
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'complete_report_not_found' using errcode = '42501';
  end if;
  select * into v_prev from public.complete_report_admin_events e where e.incident_id = p_incident_id;
  if found then
    if v_prev.report_id <> p_report_id then
      raise exception 'complete_admin_incident_conflict' using errcode = '23505';
    end if;
    return v_prev.result;
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                                 v_report.next_retry_at, v_report.lease_expires_at) then
    v_result := 'noop';
  else
    update public.complete_reports
       set status = 'queued', attempts = 0, next_retry_at = null, lease_token = null, lease_expires_at = null, updated_at = now()
     where id = p_report_id;
    v_result := 'requeued';
  end if;
  insert into public.complete_report_admin_events (report_id, action, result, incident_id)
  values (p_report_id, 'regenerate', v_result, p_incident_id);
  return v_result;
end;
$$;

revoke all on function public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz) to service_role;
revoke all on function public.complete_regenerate_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_report(uuid, uuid) to service_role;
revoke all on function public.complete_admin_regenerate_report(uuid, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $$
declare
  f text;
begin
  foreach f in array array[
      'public.complete_result_key(uuid)',
      'public.complete_result_group(uuid, uuid)',
      'public.complete_lock_result_group(uuid, uuid)',
      'public.complete_result_group_has(uuid, uuid, text)',
      'public.complete_create_order_internal(uuid, uuid, text, text, text)',
      'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)',
      'public.complete_transfer_guest_record(uuid, uuid, text)',
      'public.complete_legacy_blocked(text)',
      'public.complete_report_for_view(uuid, uuid)',
      'public.complete_report_final_failure(text, integer, integer, timestamptz, timestamptz)',
      'public.complete_regenerate_report(uuid, uuid)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_result_key', 'complete_result_group', 'complete_lock_result_group', 'complete_result_group_has',
                                'complete_create_order_internal', 'complete_orders_no_repurchase', 'complete_apply_payment',
                                'complete_transfer_guest_record')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_08 function is not security invoker with empty search_path';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'complete_orders_no_repurchase' and not tgisinternal) then
    raise exception 'complete_orders_no_repurchase trigger is missing';
  end if;
  -- §2：停止・取消の表は API から読むだけ。運営者の関数は API のロールから実行できない
  if not has_table_privilege('service_role', 'public.legacy_access_blocks', 'SELECT')
     or has_table_privilege('service_role', 'public.legacy_access_blocks', 'INSERT')
     or has_table_privilege('service_role', 'public.legacy_access_blocks', 'UPDATE')
     or has_table_privilege('service_role', 'public.legacy_access_events', 'SELECT')
     or has_table_privilege('anon', 'public.legacy_access_blocks', 'SELECT')
     or has_table_privilege('authenticated', 'public.legacy_access_blocks', 'SELECT') then
    raise exception 'unexpected privileges on legacy_access tables';
  end if;
  -- §3
  if has_function_privilege('service_role', 'public.complete_admin_regenerate_report(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_regenerate_report(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_regenerate_report(uuid, uuid)', 'EXECUTE')
     or has_table_privilege('service_role', 'public.complete_report_admin_events', 'SELECT')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'complete_reports'
                     and column_name = 'manual_retries') then
    raise exception 'complete_08 §3 objects or privileges are unexpected';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_report_final_failure', 'complete_regenerate_report', 'complete_admin_regenerate_report')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_08 §3 function is not security invoker with empty search_path';
  end if;
  if has_function_privilege('service_role', 'public.complete_admin_legacy_access(text, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_admin_legacy_access(text, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_admin_legacy_access(text, text, text, text, text)', 'EXECUTE') then
    raise exception 'complete_admin_legacy_access must be operator only';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_legacy_blocked', 'complete_admin_legacy_access', 'complete_report_for_view',
                                'legacy_access_events_immutable')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_08 §2 function is not security invoker with empty search_path';
  end if;
end
$$;

-- migration 履歴（SQL Editor で実行するため、ここで1行だけ追加する。二度当てしても増えない）
insert into supabase_migrations.schema_migrations (version, name)
values ('20261013120000', 'complete_08_purchase_integrity')
on conflict (version) do nothing;

commit;
