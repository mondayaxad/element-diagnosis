-- ============================================================
-- complete_04：完全解析の決済処理の原子化・再購入の禁止・旧 ¥1,000 購入権の結び付け
-- 【実行禁止・草案】2026-10-07。Preview（element-diagnosis-preview）専用。未適用。
-- 【本番では実行しない】本番は別ファイル・別承認。
-- 前提：complete_01（20261007111306）・complete_02（20261007113230）・complete_03（20261007205700）適用済み。PostgreSQL 17 以上。
-- 注意：Supabase の API 経路はトリガー・関数の削除文を含む本文を通さないため、本文に削除文を書かない
--       （create or replace／if not exists で二度当てに対応する）。
-- ============================================================
--
-- 方針
--   ・決済は初期リリースではカードだけ（非同期決済の「入金待ち」状態は作らない）。
--   ・Webhook で複数の表を更新する処理は、SQL 関数1回の呼び出し（＝1トランザクション）で行う。
--     途中で例外が起きれば、注文・MENTOR ロック・権利・生成物・イベント記録のすべてが取り消される。
--   ・Stripe API の呼び出しは DB トランザクションに含められないため、API 側で注文 ID と Idempotency-Key により再開可能にする。
--   ・関数はすべて SECURITY INVOKER・search_path = ''。EXECUTE は service_role だけ（anon・authenticated・PUBLIC なし）。
--   ・Webhook の結果：処理済み（processed）／恒久的な不一致（ignored・HTTP 200）。
--     通信・DB の失敗は関数の例外で全体を取り消し、API が complete_webhook_finish で failed を記録して HTTP 500 を返す。
--     再送時は failed のイベントを処理し直す。processed・ignored のイベントは二度処理しない。
--   ・同じ診断記録の再購入は禁止（paid・disputed・refunded の注文、または完全解析権〔状態を問わない〕がある記録）。
--     返金・敗訴後も MENTOR のロックは維持する（complete_01 の guard）。
--   ・注文の状態は後戻りさせない（refunded は最終・revoked は最終〔complete_01〕・paid から期限切れへ戻さない）。
--   ・旧 ¥1,000（purchase_entitlements）は診断コードのハッシュ一致だけではアップグレードの根拠にしない。
--     complete_legacy_bindings に「旧購入権1件 → 1人・1記録」を一度だけ固定したものだけを根拠にする。
--     Stripe から取り直した購入時メールと Auth の本人メールの照合は API が行い、一致した時だけこの関数を呼ぶ
--     （DB は所有者・診断コードのハッシュ・旧購入権の有効性・一度だけの固定を確かめる）。不一致は自動で結び付けない。
--
-- 注文の状態遷移（complete_orders_state_guard）
--   created       → checkout_open, failed, canceled, expired, paid, refunded
--   checkout_open → expired, failed, canceled, paid, refunded
--   expired       → paid, refunded     （期限切れ処理の後に支払い完了が届いた場合）
--   canceled      → paid, refunded     （サーバーが片付けた後に支払い完了が届いた場合）
--   failed        → refunded           （不一致の支払いを運営者が返金した場合）
--   paid          → disputed, refunded
--   disputed      → paid（勝訴）, refunded
--   refunded      → （最終）
--   同じ状態への更新は許す（冪等）。
--
-- 戻し：complete_99_rollback_DRAFT_DO_NOT_RUN.sql（complete_04 の関数・表・トリガーも明示的に削除する）。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_01〜03 の適用済みを確かめる
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
  if to_regclass('public.complete_orders') is null or to_regclass('public.record_entitlements') is null
     or to_regclass('public.stripe_webhook_events') is null or to_regclass('public.complete_reports') is null
     or to_regclass('public.record_mentor_goals') is null
     or to_regprocedure('public.complete_orders_require_eligibility()') is null then
    raise exception 'complete_01 is not applied';
  end if;
  if has_table_privilege('service_role', 'public.complete_orders', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.record_entitlements', 'TRUNCATE')
     or not has_table_privilege('service_role', 'public.complete_orders', 'UPDATE') then
    raise exception 'complete_02 is not applied';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'record_mentor_goals_0_ownership' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'diagnosis_sessions_owner_immutable' and not tgisinternal) then
    raise exception 'complete_03 is not applied';
  end if;
end
$$;

-- 1. 旧 ¥1,000 購入権の結び付け（旧購入権1件 → 1人・1記録。一度だけ。更新・削除しない）
create table if not exists public.complete_legacy_bindings (
  id                     uuid primary key default gen_random_uuid(),
  legacy_entitlement_id  uuid not null references public.purchase_entitlements(id) on delete restrict,
  user_id                uuid not null references public.profiles(id) on delete restrict,
  diagnosis_session_id   uuid not null references public.diagnosis_sessions(id) on delete restrict,
  match_method           text not null check (match_method in ('stripe_email_verified', 'operator_verified')),
  bound_at               timestamptz not null default now()
);
create unique index if not exists complete_legacy_bindings_entitlement_uq on public.complete_legacy_bindings (legacy_entitlement_id);
create unique index if not exists complete_legacy_bindings_session_uq on public.complete_legacy_bindings (diagnosis_session_id);

revoke all on table public.complete_legacy_bindings from public, anon, authenticated;
revoke all on table public.complete_legacy_bindings from service_role;
grant select, insert on table public.complete_legacy_bindings to service_role;
alter table public.complete_legacy_bindings enable row level security;
-- ポリシーは作らない（service_role は RLS を迂回する）

-- 結び付けの前提（関数を通さない直接の INSERT でも確かめる）：
--   本人の記録・旧購入権が有効（active・core1／complete）・旧購入権の診断コードのハッシュが記録の診断コードと一致
create or replace function public.complete_legacy_bindings_check()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_ref text;
begin
  select case when s.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end
    into v_ref
    from public.diagnosis_sessions s
    join public.diagnosis_answers a on a.session_id = s.id
   where s.id = new.diagnosis_session_id and s.user_id = new.user_id;
  if v_ref is null then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.purchase_entitlements e
     where e.id = new.legacy_entitlement_id
       and e.status = 'active'
       and e.product_type in ('core1', 'complete')
       and e.diagnosis_code_hash = encode(sha256(convert_to(v_ref, 'UTF8')), 'hex')) then
    raise exception 'complete_legacy_not_matched' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.complete_legacy_bindings_check() from public, anon, authenticated;
create or replace trigger complete_legacy_bindings_check
  before insert on public.complete_legacy_bindings
  for each row execute function public.complete_legacy_bindings_check();

-- 2. 同じ記録の再購入を禁止する（注文作成の前提に加える）
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = new.diagnosis_session_id
                and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;
create or replace trigger complete_orders_no_repurchase
  before insert on public.complete_orders
  for each row execute function public.complete_orders_no_repurchase();

-- 3. 注文の状態を後戻りさせない
create or replace function public.complete_orders_state_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if (old.status = 'created'       and new.status in ('checkout_open', 'failed', 'canceled', 'expired', 'paid', 'refunded'))
  or (old.status = 'checkout_open' and new.status in ('expired', 'failed', 'canceled', 'paid', 'refunded'))
  or (old.status = 'expired'       and new.status in ('paid', 'refunded'))
  or (old.status = 'canceled'      and new.status in ('paid', 'refunded'))
  or (old.status = 'failed'        and new.status in ('refunded'))
  or (old.status = 'paid'          and new.status in ('disputed', 'refunded'))
  or (old.status = 'disputed'      and new.status in ('paid', 'refunded')) then
    return new;
  end if;
  raise exception 'complete_order_invalid_transition' using errcode = '42501';
end;
$$;
revoke all on function public.complete_orders_state_guard() from public, anon, authenticated;
create or replace trigger complete_orders_state_guard
  before update of status on public.complete_orders
  for each row execute function public.complete_orders_state_guard();

-- 4. Webhook イベントの受付（内部用）。処理済み・無視済みなら false（二度処理しない）。received・failed は処理し直す。
--    同じイベントの同時配送は行ロックで直列にする。
create or replace function public.complete_webhook_gate(p_event_id text, p_event_type text, p_livemode boolean, p_event_created timestamptz)
  returns boolean
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_status text;
begin
  insert into public.stripe_webhook_events (event_id, event_type, livemode, event_created)
  values (p_event_id, p_event_type, p_livemode, p_event_created)
  on conflict (event_id) do nothing;
  select e.status into v_status from public.stripe_webhook_events e where e.event_id = p_event_id for update;
  return v_status in ('received', 'failed');
end;
$$;

-- イベントの結果を記録する（内部用・API からも使う）。processed のイベントは変えない。
create or replace function public.complete_webhook_finish(p_event_id text, p_event_type text, p_livemode boolean,
                                                          p_event_created timestamptz, p_status text, p_error_code text,
                                                          p_order_id uuid default null)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'complete_invalid_event_status' using errcode = '22023';
  end if;
  insert into public.stripe_webhook_events (event_id, event_type, livemode, event_created)
  values (p_event_id, p_event_type, p_livemode, p_event_created)
  on conflict (event_id) do nothing;
  select e.status into v_status from public.stripe_webhook_events e where e.event_id = p_event_id for update;
  if v_status = 'processed' or (v_status = 'ignored' and p_status = 'failed') then
    return v_status;
  end if;
  update public.stripe_webhook_events
     set status = p_status, error_code = p_error_code, order_id = coalesce(p_order_id, order_id),
         processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end
   where event_id = p_event_id;
  return p_status;
end;
$$;

-- 5. 注文の作成（Checkout Session を作る前）。同じ記録の処理は直列にする。
--    既存の決済待ち注文（created／checkout_open）があればそれを返す（created = false）。
create or replace function public.complete_create_order(p_user_id uuid, p_diagnosis_session_id uuid,
                                                        p_offer text, p_idempotency_key text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_goal public.record_mentor_goals%rowtype;
  v_has_record_analysis boolean;
  v_has_legacy_binding boolean;
  v_basis text;
  v_amount integer;
  v_id uuid;
begin
  if p_offer not in ('direct_complete', 'analysis_upgrade') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 16 then
    raise exception 'complete_invalid_idempotency_key' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));

  if not exists (select 1 from public.diagnosis_sessions s where s.id = p_diagnosis_session_id and s.user_id = p_user_id) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;

  -- 同じ Idempotency-Key の再送：同じ内容なら同じ注文を返す
  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.diagnosis_session_id <> p_diagnosis_session_id or v_existing.offer <> p_offer then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  -- 再購入の禁止（トリガーでも確かめる）
  if exists (select 1 from public.complete_orders o
              where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('paid', 'disputed', 'refunded'))
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = p_diagnosis_session_id and e.right_type = 'complete') then
    raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
  end if;

  -- 決済待ちの注文があればそれを返す
  select * into v_existing from public.complete_orders o
   where o.diagnosis_session_id = p_diagnosis_session_id and o.status in ('created', 'checkout_open');
  if found then
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;

  -- 解析権の根拠：記録単位の analysis 権（active）、または一度だけ固定した旧 ¥1,000 購入権。診断コードのハッシュ一致だけでは認めない。
  v_has_record_analysis := exists (select 1 from public.record_entitlements e
                                    where e.user_id = p_user_id and e.diagnosis_session_id = p_diagnosis_session_id
                                      and e.right_type = 'analysis' and e.status = 'active');
  v_has_legacy_binding := exists (select 1 from public.complete_legacy_bindings b
                                   join public.purchase_entitlements pe on pe.id = b.legacy_entitlement_id
                                  where b.user_id = p_user_id and b.diagnosis_session_id = p_diagnosis_session_id
                                    and pe.status = 'active');
  if p_offer = 'direct_complete' then
    if v_has_record_analysis or v_has_legacy_binding then
      raise exception 'complete_direct_not_allowed_after_analysis' using errcode = '42501';
    end if;
    -- 旧 ¥1,000 の購入（診断コードのハッシュが一致）があるのに結び付けが未完了：¥3,000 へ誘導しない（「既存の購入を確認中」）
    if exists (
      select 1
        from public.diagnosis_sessions s
        join public.diagnosis_answers a on a.session_id = s.id
        join public.purchase_entitlements pe
          on pe.diagnosis_code_hash = encode(sha256(convert_to(
               case when s.diagnosis_version = 'ETI-2.0' then 'v2_' || a.encoded_answers else a.encoded_answers end, 'UTF8')), 'hex')
       where s.id = p_diagnosis_session_id and pe.status = 'active' and pe.product_type in ('core1', 'complete')) then
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

  select * into v_goal from public.record_mentor_goals g
   where g.diagnosis_session_id = p_diagnosis_session_id and g.user_id = p_user_id;
  if not found then
    raise exception 'complete_mentor_goal_required' using errcode = '42501';
  end if;

  insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                      mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at)
  values (p_user_id, p_diagnosis_session_id, p_offer, v_amount, 'test', v_basis, p_idempotency_key,
          v_goal.goal_catalog_version, v_goal.goal_id, v_goal.selected_at)
  returning id into v_id;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;

-- 6. Checkout Session を作った後：created → checkout_open（同じ Session なら冪等）
create or replace function public.complete_mark_checkout_open(p_order_id uuid, p_checkout_session_id text, p_expires_at timestamptz)
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
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then
    raise exception 'complete_checkout_session_mismatch' using errcode = '42501';
  end if;
  if v_order.status = 'checkout_open' then
    return 'noop';
  end if;
  if v_order.status <> 'created' then
    raise exception 'complete_order_not_open' using errcode = '42501';
  end if;
  update public.complete_orders
     set status = 'checkout_open', stripe_checkout_session_id = p_checkout_session_id,
         checkout_expires_at = p_expires_at, updated_at = now()
   where id = p_order_id;
  return 'applied';
end;
$$;

-- 7. Checkout Session を作れなかった・古い created を片付ける：created → failed／canceled
create or replace function public.complete_close_unopened_order(p_order_id uuid, p_status text, p_failure_code text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_order public.complete_orders%rowtype;
begin
  if p_status not in ('failed', 'canceled') then
    raise exception 'complete_invalid_order_status' using errcode = '22023';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'complete_order_not_found' using errcode = '42501';
  end if;
  if v_order.status = p_status then
    return 'noop';
  end if;
  if v_order.status <> 'created' then
    raise exception 'complete_order_not_open' using errcode = '42501';
  end if;
  update public.complete_orders set status = p_status, failure_code = p_failure_code, updated_at = now() where id = p_order_id;
  return 'applied';
end;
$$;

-- 8. 支払い確定（checkout.session.completed・payment_status = paid）：
--    注文 paid・MENTOR ロック・権利付与・生成物 queued・イベント processed を1トランザクションで行う。
--    生成物の本文素材・テンプレート・入力のハッシュは API（生成器）が計算して渡す。版は保存済みの結果から写す。
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
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;

  -- 支払い内容の完全照合（恒久的な不一致は ignored。決済待ちの注文は failed にして権利を与えない）
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

  -- 既に支払い確定以降（重複・順序逆転）：状態を変えない
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
  -- 期限切れ・片付け済みの注文に支払いが届いた：同じ記録に別の有効な注文があれば運営者確認
  if v_order.status in ('expired', 'canceled') and exists (
       select 1 from public.complete_orders o2
        where o2.diagnosis_session_id = v_order.diagnosis_session_id and o2.id <> v_order.id
          and o2.status in ('created', 'checkout_open', 'paid', 'disputed', 'refunded')) then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'live_order_conflict', v_order.id);
    return 'ignored:live_order_conflict';
  end if;

  -- MENTOR：注文に写した目標で記録をロックする（支払い前に記録へ戻す）
  update public.record_mentor_goals
     set goal_id = v_order.mentor_goal_id, goal_catalog_version = v_order.mentor_goal_catalog_version,
         selected_at = v_order.mentor_goal_selected_at, locked_at = coalesce(locked_at, now())
   where diagnosis_session_id = v_order.diagnosis_session_id and user_id = v_order.user_id;
  if not found then
    raise exception 'complete_mentor_goal_missing' using errcode = '42501';
  end if;

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  -- 権利：direct は analysis（既に有効な analysis 権が無い場合）と complete、upgrade は complete
  if v_order.offer = 'direct_complete' and not exists (
       select 1 from public.record_entitlements e
        where e.user_id = v_order.user_id and e.diagnosis_session_id = v_order.diagnosis_session_id
          and e.right_type = 'analysis' and e.status in ('active', 'suspended')) then
    insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
    values (v_order.user_id, v_order.diagnosis_session_id, 'analysis', v_order.id)
    on conflict (source_order_id, right_type) do nothing;
  end if;
  insert into public.record_entitlements (user_id, diagnosis_session_id, right_type, source_order_id)
  values (v_order.user_id, v_order.diagnosis_session_id, 'complete', v_order.id)
  on conflict (source_order_id, right_type) do nothing;

  -- 生成物：queued（同じ注文で既にあれば作らない）
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

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 9. Checkout の期限切れ（checkout.session.expired）：決済待ちの注文だけ expired。支払い後は状態を戻さない。
create or replace function public.complete_apply_checkout_expired(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid, p_checkout_session_id text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'checkout.session.expired';
  v_order public.complete_orders%rowtype;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'checkout_session_mismatch', v_order.id);
    return 'ignored:checkout_session_mismatch';
  end if;
  if v_order.status in ('created', 'checkout_open') then
    update public.complete_orders
       set status = 'expired', last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
     where id = v_order.id;
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
    return 'applied';
  end if;
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
  return 'noop';
end;
$$;

-- 10. 返金（charge.refunded）：全額なら注文 refunded・権利 revoked（refund）・生成物 revoked＋隔離。一部返金は記録だけ。
--     支払い確定より先に届いた場合も refunded を優先する（後から届く支払い確定は noop）。
create or replace function public.complete_apply_refund(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid,
    p_payment_intent_id text, p_amount_refunded integer)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type constant text := 'charge.refunded';
  v_order public.complete_orders%rowtype;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'payment_intent_mismatch', v_order.id);
    return 'ignored:payment_intent_mismatch';
  end if;
  if p_amount_refunded is null or p_amount_refunded < v_order.amount then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'partial_refund_recorded', v_order.id);
    return 'partial';
  end if;
  if v_order.status = 'refunded' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  update public.complete_orders
     set status = 'refunded', refunded_at = now(), stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         last_stripe_event_id = p_event_id, last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created),
         updated_at = now()
   where id = v_order.id;
  update public.record_entitlements
     set status = 'revoked', revoked_at = now(), revoke_reason = 'refund'
   where source_order_id = v_order.id and status <> 'revoked';
  update public.complete_reports
     set status = 'revoked', revoked_at = now(), quarantined_at = coalesce(quarantined_at, now()),
         lease_token = null, lease_expires_at = null, updated_at = now()
   where source_order_id = v_order.id and status <> 'revoked';
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 11. dispute（charge.dispute.created／closed）：
--     opened：paid → disputed・権利 suspended（dispute_open）。支払い確定前に届いた場合は complete_retry_later（API は 500 で再送させる）。
--             既に後のイベント（勝訴・敗訴など）を適用済みなら古い opened は無視する。
--     won   ：disputed → paid・suspended の権利を active に戻す。
--     lost  ：権利 revoked（dispute_lost）・生成物 revoked＋隔離。注文は disputed のまま（再購入不可）。
create or replace function public.complete_apply_dispute(
    p_event_id text, p_event_created timestamptz, p_livemode boolean, p_order_id uuid,
    p_payment_intent_id text, p_action text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_type text;
  v_order public.complete_orders%rowtype;
begin
  if p_action not in ('opened', 'won', 'lost') then
    raise exception 'complete_invalid_dispute_action' using errcode = '22023';
  end if;
  v_type := case when p_action = 'opened' then 'charge.dispute.created' else 'charge.dispute.closed' end;
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
  end if;
  if v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'payment_intent_mismatch', v_order.id);
    return 'ignored:payment_intent_mismatch';
  end if;
  if v_order.status = 'refunded' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
    return 'noop';
  end if;
  if v_order.status = 'failed' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_failed', v_order.id);
    return 'ignored:order_failed';
  end if;
  if v_order.status not in ('paid', 'disputed') then
    raise exception 'complete_retry_later' using errcode = '55000';
  end if;

  if p_action = 'opened' then
    if v_order.last_event_created is not null and p_event_created < v_order.last_event_created then
      perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'stale', v_order.id);
      return 'stale';
    end if;
    if v_order.status = 'disputed' then
      perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', 'noop', v_order.id);
      return 'noop';
    end if;
    update public.complete_orders
       set status = 'disputed', last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'suspended', suspended_at = now(), suspend_reason = 'dispute_open'
     where source_order_id = v_order.id and status = 'active';
  elsif p_action = 'won' then
    update public.complete_orders
       set status = 'paid', last_stripe_event_id = p_event_id,
           last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created), updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'active', suspended_at = null, suspend_reason = null
     where source_order_id = v_order.id and status = 'suspended';
  else
    update public.complete_orders
       set status = 'disputed', last_stripe_event_id = p_event_id,
           last_event_created = greatest(coalesce(last_event_created, p_event_created), p_event_created), updated_at = now()
     where id = v_order.id;
    update public.record_entitlements
       set status = 'revoked', revoked_at = now(), revoke_reason = 'dispute_lost'
     where source_order_id = v_order.id and status <> 'revoked';
    update public.complete_reports
       set status = 'revoked', revoked_at = now(), quarantined_at = coalesce(quarantined_at, now()),
           lease_token = null, lease_expires_at = null, updated_at = now()
     where source_order_id = v_order.id and status <> 'revoked';
  end if;
  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;

-- 12. 旧 ¥1,000 購入権の結び付け（API が Stripe の購入時メールと Auth の本人メールの一致を確かめた後に呼ぶ）。
--     同じ旧購入権・同じ記録の再呼び出しは冪等。別の人・別の記録へは結び付けない。
create or replace function public.complete_bind_legacy_purchase(p_user_id uuid, p_diagnosis_session_id uuid,
                                                                p_legacy_entitlement_id uuid, p_match_method text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_binding public.complete_legacy_bindings%rowtype;
begin
  if p_match_method not in ('stripe_email_verified', 'operator_verified') then
    raise exception 'complete_invalid_match_method' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_legacy:' || p_legacy_entitlement_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('complete_order:' || p_diagnosis_session_id::text, 0));
  select * into v_binding from public.complete_legacy_bindings b where b.legacy_entitlement_id = p_legacy_entitlement_id;
  if found then
    if v_binding.user_id = p_user_id and v_binding.diagnosis_session_id = p_diagnosis_session_id then
      return 'noop';
    end if;
    raise exception 'complete_legacy_already_bound' using errcode = '42501';
  end if;
  if exists (select 1 from public.complete_legacy_bindings b where b.diagnosis_session_id = p_diagnosis_session_id) then
    raise exception 'complete_legacy_record_already_bound' using errcode = '42501';
  end if;
  insert into public.complete_legacy_bindings (legacy_entitlement_id, user_id, diagnosis_session_id, match_method)
  values (p_legacy_entitlement_id, p_user_id, p_diagnosis_session_id, p_match_method);
  return 'applied';
end;
$$;

-- 13. 関数の権限：EXECUTE は service_role だけ（トリガー関数はどのロールにも与えない）
revoke all on function public.complete_webhook_gate(text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_webhook_finish(text, text, boolean, timestamptz, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_create_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_mark_checkout_open(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_close_unopened_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_apply_checkout_expired(text, timestamptz, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_apply_refund(text, timestamptz, boolean, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_webhook_gate(text, text, boolean, timestamptz) to service_role;
grant execute on function public.complete_webhook_finish(text, text, boolean, timestamptz, text, text, uuid) to service_role;
grant execute on function public.complete_create_order(uuid, uuid, text, text) to service_role;
grant execute on function public.complete_mark_checkout_open(uuid, text, timestamptz) to service_role;
grant execute on function public.complete_close_unopened_order(uuid, text, text) to service_role;
grant execute on function public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;
grant execute on function public.complete_apply_checkout_expired(text, timestamptz, boolean, uuid, text) to service_role;
grant execute on function public.complete_apply_refund(text, timestamptz, boolean, uuid, text, integer) to service_role;
grant execute on function public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text) to service_role;
grant execute on function public.complete_bind_legacy_purchase(uuid, uuid, uuid, text) to service_role;

-- 14. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
declare
  t text;
  p text;
  f text;
begin
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('service_role', t, p) then raise exception 'service_role lacks % on %', p, t; end if;
    end loop;
    foreach p in array array['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('service_role', t, p) then raise exception 'service_role has % on %', p, t; end if;
    end loop;
  end loop;
  foreach p in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('service_role', 'public.complete_legacy_bindings', p) then
      raise exception 'service_role lacks % on complete_legacy_bindings', p;
    end if;
  end loop;
  foreach p in array array['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
    if has_table_privilege('service_role', 'public.complete_legacy_bindings', p) then
      raise exception 'service_role has % on complete_legacy_bindings', p;
    end if;
  end loop;
  foreach t in array array['public.complete_orders', 'public.record_entitlements', 'public.stripe_webhook_events',
                           'public.complete_reports', 'public.record_mentor_goals', 'public.complete_legacy_bindings'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] loop
      if has_table_privilege('anon', t, p) or has_table_privilege('authenticated', t, p) then
        raise exception 'anon or authenticated has % on %', p, t;
      end if;
    end loop;
  end loop;
  foreach f in array array['public.complete_webhook_gate(text, text, boolean, timestamptz)',
                           'public.complete_webhook_finish(text, text, boolean, timestamptz, text, text, uuid)',
                           'public.complete_create_order(uuid, uuid, text, text)',
                           'public.complete_mark_checkout_open(uuid, text, timestamptz)',
                           'public.complete_close_unopened_order(uuid, text, text)',
                           'public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)',
                           'public.complete_apply_checkout_expired(text, timestamptz, boolean, uuid, text)',
                           'public.complete_apply_refund(text, timestamptz, boolean, uuid, text, integer)',
                           'public.complete_apply_dispute(text, timestamptz, boolean, uuid, text, text)',
                           'public.complete_bind_legacy_purchase(uuid, uuid, uuid, text)'] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role cannot execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'anon or authenticated can execute %', f;
    end if;
  end loop;
  foreach f in array array['public.complete_legacy_bindings_check()', 'public.complete_orders_no_repurchase()',
                           'public.complete_orders_state_guard()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'trigger function % is executable by an API role', f;
    end if;
  end loop;
  -- complete_04 が作る関数はすべて SECURITY INVOKER・search_path 空（onboarding_01 の complete_registration_onboarding は対象外）
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_legacy_bindings_check', 'complete_orders_no_repurchase', 'complete_orders_state_guard',
                                'complete_webhook_gate', 'complete_webhook_finish', 'complete_create_order',
                                'complete_mark_checkout_open', 'complete_close_unopened_order', 'complete_apply_payment',
                                'complete_apply_checkout_expired', 'complete_apply_refund', 'complete_apply_dispute',
                                'complete_bind_legacy_purchase')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_04 function is not security invoker with empty search_path';
  end if;
end
$$;

commit;
