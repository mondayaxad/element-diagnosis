-- ============================================================
-- complete_13：購入を「解析レポート ¥1,000」「完全解析 ¥3,000」の2商品と、期限なしのレポート固有リンクにする（2026-10-20）。
-- Preview（element-diagnosis-preview）専用。未適用。
-- 【SQL Editor で実行する】表・列・索引・制約・関数の追加と置き換えを含むため、Supabase の API 経路（MCP）では適用しない。
--   最後に migration 履歴へ1行を追加する（二度当てしても増えない）。
-- 【本番では実行しない】本番は Production 用の別ファイルで行う。
-- 前提：complete_01〜12 適用済み・PostgreSQL 17 以上。
-- 既存の行は書き換えない・消さない・移さない。
--   ・complete_orders の制約と一意索引は、新しい注文の種類（buyer = 'link'）を加えた形に置き換える（既存の行の値は変えない）。
--   ・complete_reports に via_link（既定 false）を足す。既存の行はすべて false のまま。
-- 戻し：complete_95_rollback_13_DRAFT_DO_NOT_RUN.sql（実行禁止の草案）。
-- ============================================================
--
-- 方針（新しい購入の経路。ログイン・購入時メール・Cookie を本人の判定に使わない）
--   ・商品は2つ：analysis（解析レポート ¥1,000）・direct_complete（完全解析 ¥3,000。API の product は complete）。
--     追加 ¥2,000（analysis_upgrade）は、すべての入口で新しく作らない（complete_orders_no_repurchase で断る：complete_offer_retired）。
--     既存の analysis_upgrade の行はそのまま残す。
--   ・新しい購入の注文は buyer = 'link'。user_id は持たない（誰が買ったかではなく、どの診断記録の商品かだけを持つ）。
--     claim_secret_hash に、購入した時に発行するレポート固有リンクの秘密値（256bit）の SHA-256 を入れる（秘密値そのものは保存しない）。
--     同じ記録・同じ商品の再購入を断らない。決済待ちが残っていても次の購入を妨げない（buyer = 'link' は一意索引の対象外）。
--     完全解析の MENTOR 目標は注文に固定する（record_mentor_goals は使わない）。
--   ・支払いの反映（complete_apply_link_payment）で、注文ごとに納品（report_deliveries）を1件作る。
--     完全解析は、注文ごとに生成物（complete_reports、via_link = true）を1件作る。同じ注文・同じイベントの重複は作らない。
--   ・固有リンクの有効性は開くたびに確かめる：納品が active、かつ注文が paid（返金・異議申し立て中・敗訴・運営者の停止で読めない）。
--   ・アカウントへの登録（account_report_registrations）は、閲覧の登録の追加だけ。購入の移転ではない。
--     同じ納品を別のアカウントにも登録できる。同じアカウント・同じ納品は1件（二度目は already）。
--     diagnosis_sessions.user_id は付け替えない。アカウントを消しても納品は残る（登録だけが消える）。
--   ・運営者の停止・再発行（complete_admin_revoke_delivery・complete_admin_reissue_delivery）は SQL Editor 専用。
--     再発行は新しい秘密値のハッシュに置き換え、古いリンクは開けなくなる。
--   ・新しい表は RLS 有効・ポリシーなし。anon・authenticated に権限を付けない。service_role は SELECT・INSERT・UPDATE だけ。
--   ・関数はすべて SECURITY INVOKER・search_path = ''。

begin;

-- 0. Preview・PostgreSQL 17 以上・complete_12 の適用済みを確かめる
do $$
begin
  if to_regprocedure('public.deployment_environment()') is null
     or public.deployment_environment() is distinct from 'preview' then
    raise exception 'not a preview database';
  end if;
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261015120000')
     or to_regprocedure('public.complete_apply_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)') is null
     or to_regprocedure('public.complete_open_result_link(text)') is null then
    raise exception 'complete_01..12 are not applied';
  end if;
end
$$;

-- 1. 注文の種類 buyer = 'link'（レポート固有リンクで納品する購入）
alter table public.complete_orders drop constraint if exists complete_orders_buyer_check;
alter table public.complete_orders add constraint complete_orders_buyer_check check (buyer in ('user', 'guest', 'link'));
alter table public.complete_orders drop constraint if exists complete_orders_buyer_consistency;
alter table public.complete_orders add constraint complete_orders_buyer_consistency check (
  (buyer = 'user' and user_id is not null and claim_secret_hash is null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null)
  or (buyer = 'guest' and claim_secret_hash is not null and claim_expires_at is not null
     and ((user_id is null and claimed_by is null and claimed_at is null and claim_method is null)
          or (user_id is not null and claimed_by = user_id and claimed_at is not null and claim_method is not null)))
  or (buyer = 'link' and user_id is null and claim_secret_hash is not null and claim_expires_at is null
     and claimed_by is null and claimed_at is null and claim_method is null and purchase_email_hmac is null
     and offer in ('analysis', 'direct_complete'))
);

-- 2. 1つの記録あたり1件の決済待ち・支払いの一意索引は、従来の注文（user・guest）だけに掛ける（新しい購入は再購入を断らない）
drop index if exists public.complete_orders_one_open_per_session;
create unique index complete_orders_one_open_per_session on public.complete_orders (diagnosis_session_id)
  where status in ('created', 'checkout_open') and buyer <> 'link';
drop index if exists public.complete_orders_one_paid_analysis_per_session;
create unique index complete_orders_one_paid_analysis_per_session on public.complete_orders (diagnosis_session_id)
  where offer = 'analysis' and status in ('paid', 'disputed') and buyer <> 'link';
drop index if exists public.complete_orders_one_paid_complete_per_session;
create unique index complete_orders_one_paid_complete_per_session on public.complete_orders (diagnosis_session_id)
  where offer in ('direct_complete', 'analysis_upgrade') and status in ('paid', 'disputed') and buyer <> 'link';

-- 3. 完全解析の生成物：新しい購入の生成物（via_link）は注文ごとに1件。従来の生成物は記録ごとに1件のまま
alter table public.complete_reports add column if not exists via_link boolean not null default false;
drop index if exists public.complete_reports_one_active_per_session;
create unique index complete_reports_one_active_per_session on public.complete_reports (diagnosis_session_id)
  where status <> 'revoked' and not via_link;
drop index if exists public.complete_reports_same_version_uq;
create unique index complete_reports_same_version_uq
  on public.complete_reports (diagnosis_session_id, generator_release, content_sha256, template_sha256, input_sha256)
  where status <> 'revoked' and not via_link;
create unique index if not exists complete_reports_one_per_order on public.complete_reports (source_order_id)
  where status <> 'revoked';

-- 4. 納品（支払済みの注文ごとに1件。レポート固有リンクの秘密値のハッシュを持つ）
create table if not exists public.report_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null unique references public.complete_orders(id) on delete restrict,
  diagnosis_session_id  uuid not null references public.diagnosis_sessions(id) on delete restrict,
  product               text not null check (product in ('analysis', 'complete')),
  report_id             uuid references public.complete_reports(id) on delete restrict,
  link_token_hash       text not null unique check (link_token_hash ~ '^[0-9a-f]{64}$'),
  status                text not null default 'active' check (status in ('active', 'revoked')),
  revoke_reason         text check (revoke_reason is null or revoke_reason in ('operator', 'mistaken_purchase', 'abuse')),
  issued_at             timestamptz not null default now(),
  reissue_count         integer not null default 0 check (reissue_count >= 0),
  reissued_at           timestamptz,
  revoked_at            timestamptz,
  updated_at            timestamptz not null default now(),
  constraint report_deliveries_state check (
    (status = 'active' and revoked_at is null and revoke_reason is null)
    or (status = 'revoked' and revoked_at is not null and revoke_reason is not null)),
  constraint report_deliveries_report_matches_product check (
    (product = 'analysis' and report_id is null) or product = 'complete')
);
create index if not exists report_deliveries_session_idx on public.report_deliveries (diagnosis_session_id);
alter table public.report_deliveries enable row level security;
revoke all on table public.report_deliveries from public, anon, authenticated;
grant select, insert, update on table public.report_deliveries to service_role;

-- 5. アカウントへの閲覧の登録（購入の移転ではない。同じ納品を複数のアカウントに登録できる）
create table if not exists public.account_report_registrations (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  delivery_id    uuid not null references public.report_deliveries(id) on delete restrict,
  registered_at  timestamptz not null default now(),
  primary key (user_id, delivery_id)
);
create index if not exists account_report_registrations_delivery_idx on public.account_report_registrations (delivery_id);
alter table public.account_report_registrations enable row level security;
revoke all on table public.account_report_registrations from public, anon, authenticated;
grant select, insert on table public.account_report_registrations to service_role;

-- 6. 注文の作成の規則：追加 ¥2,000 は新しく作らない。新しい購入（link）は再購入・決済待ちを理由に断らない
create or replace function public.complete_orders_no_repurchase()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.offer = 'analysis_upgrade' then
    raise exception 'complete_offer_retired' using errcode = '42501';
  end if;
  if new.buyer = 'link' then
    return new;
  end if;
  if new.offer = 'analysis' then
    if exists (select 1 from public.complete_orders o
                where o.diagnosis_session_id = new.diagnosis_session_id
                  and o.offer in ('analysis', 'direct_complete') and o.status in ('paid', 'disputed') and o.buyer <> 'link')
       or exists (select 1 from public.record_entitlements e
                   where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'analysis'
                     and e.status in ('active', 'suspended')) then
      raise exception 'complete_repurchase_not_allowed' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.complete_orders o
                 where o.diagnosis_session_id = new.diagnosis_session_id
                   and o.offer in ('direct_complete', 'analysis_upgrade') and o.status in ('paid', 'disputed') and o.buyer <> 'link')
     or exists (select 1 from public.record_entitlements e
                 where e.diagnosis_session_id = new.diagnosis_session_id and e.right_type = 'complete'
                     and e.status in ('active', 'suspended')) then
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
revoke all on function public.complete_orders_no_repurchase() from public, anon, authenticated;

-- 7. 注文の作成の前提：新しい購入（link）は、記録の持ち主・ログイン・record_mentor_goals を見ない（版と目標だけを確かめる）
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
  if v_found is null then
    raise exception 'complete_not_owner' using errcode = '42501';
  end if;
  if new.buyer = 'link' then
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
    if new.mentor_goal_id is null or new.mentor_goal_selected_at is null then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
    return new;
  end if;
  if v_owner is distinct from new.user_id then
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
revoke all on function public.complete_orders_require_eligibility() from public, anon, authenticated;

-- 8. 新しい購入の注文を作る。同じ購入操作（p_idempotency_key）の再送は同じ注文を返す（連打・再試行で注文を増やさない）
create or replace function public.complete_create_link_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text,
                                                             p_link_token_hash text, p_goal_id text)
  returns table (order_id uuid, order_status text, offer text, checkout_session_id text, created boolean)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_existing public.complete_orders%rowtype;
  v_id uuid;
begin
  if p_offer = 'analysis_upgrade' then
    raise exception 'complete_offer_retired' using errcode = '42501';
  end if;
  if p_offer is null or p_offer not in ('analysis', 'direct_complete') then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^lk_[A-Za-z0-9_-]{22,64}$'
     or p_link_token_hash is null or p_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  if p_offer = 'direct_complete' then
    if p_goal_id is null or p_goal_id not in ('GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01') then
      raise exception 'complete_mentor_goal_required' using errcode = '42501';
    end if;
  elsif p_goal_id is not null then
    raise exception 'complete_invalid_offer' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('complete_link_attempt:' || p_idempotency_key, 0));
  select * into v_existing from public.complete_orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.buyer <> 'link' or v_existing.diagnosis_session_id <> p_diagnosis_session_id or v_existing.offer <> p_offer
       or v_existing.mentor_goal_id is distinct from p_goal_id then
      raise exception 'complete_idempotency_conflict' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.status, v_existing.offer, v_existing.stripe_checkout_session_id, false;
    return;
  end if;
  if not exists (select 1 from public.diagnosis_sessions s where s.id = p_diagnosis_session_id) then
    raise exception 'complete_record_not_found' using errcode = '42501';
  end if;
  insert into public.complete_orders (user_id, diagnosis_session_id, offer, amount, stripe_mode, analysis_basis, idempotency_key,
                                      mentor_goal_catalog_version, mentor_goal_id, mentor_goal_selected_at,
                                      buyer, claim_secret_hash, claim_expires_at)
  values (null, p_diagnosis_session_id, p_offer, case when p_offer = 'analysis' then 1000 else 3000 end, 'test', null, p_idempotency_key,
          case when p_offer = 'direct_complete' then 'CORE1-MENTOR-GOALS-1.0.0' end, p_goal_id,
          case when p_offer = 'direct_complete' then now() end,
          'link', p_link_token_hash, null)
  returning id into v_id;
  return query select v_id, 'created'::text, p_offer, null::text, true;
end;
$$;
revoke all on function public.complete_create_link_order(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_create_link_order(uuid, text, text, text, text) to service_role;

-- 9. 新しい購入の支払いの反映：注文を paid にし、納品を1件、完全解析は生成物を1件作る（Webhook・購入完了ページの再処理とも冪等）。
--    期限切れ・中止の後に支払われた古い決済も、別の支払済みの注文として納品する（再購入を断らない）
create or replace function public.complete_apply_link_payment(
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
  v_report uuid;
begin
  if not public.complete_webhook_gate(p_event_id, v_type, p_livemode, p_event_created) then
    return 'duplicate';
  end if;
  select * into v_order from public.complete_orders o where o.id = p_order_id for update;
  if not found or v_order.buyer <> 'link' then
    perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'ignored', 'order_not_found');
    return 'ignored:order_not_found';
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

  update public.complete_orders
     set status = 'paid', paid_at = now(), stripe_checkout_session_id = p_checkout_session_id,
         stripe_payment_intent_id = p_payment_intent_id, failure_code = null,
         last_stripe_event_id = p_event_id, last_event_created = p_event_created, updated_at = now()
   where id = v_order.id;

  if v_order.offer = 'direct_complete' then
    select r.id into v_report from public.complete_reports r where r.source_order_id = v_order.id and r.status <> 'revoked';
    if v_report is null then
      select * into v_res from public.diagnosis_results r where r.session_id = v_order.diagnosis_session_id;
      if not found then
        raise exception 'complete_result_missing' using errcode = '42501';
      end if;
      insert into public.complete_reports (user_id, diagnosis_session_id, source_order_id, content_version, template_version,
                                           content_sha256, template_sha256, diagnosis_version, item_set_version, scoring_version,
                                           translation_model_version, character_profile_version, mirror_model_version,
                                           mentor_goal_catalog_version, mentor_goal_id, input_sha256, via_link)
      values (null, v_order.diagnosis_session_id, v_order.id, p_content_version, p_template_version,
              p_content_sha256, p_template_sha256, v_res.diagnosis_version, v_res.item_set_version, v_res.scoring_version,
              v_res.translation_model_version, v_res.character_profile_version, v_res.mirror_model_version,
              v_order.mentor_goal_catalog_version, v_order.mentor_goal_id, p_input_sha256, true)
      returning id into v_report;
    end if;
  end if;
  insert into public.report_deliveries (order_id, diagnosis_session_id, product, report_id, link_token_hash)
  values (v_order.id, v_order.diagnosis_session_id, case when v_order.offer = 'analysis' then 'analysis' else 'complete' end,
          v_report, v_order.claim_secret_hash)
  on conflict (order_id) do nothing;

  perform public.complete_webhook_finish(p_event_id, v_type, p_livemode, p_event_created, 'processed', null, v_order.id);
  return 'applied';
end;
$$;
revoke all on function public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text) to service_role;

-- 10. アカウントへの閲覧の登録（有効な納品だけ。同じアカウント・同じ納品は1件）
create or replace function public.complete_register_delivery(p_user_id uuid, p_link_token_hash text)
  returns table (result text, delivery_id uuid)
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_delivery public.report_deliveries%rowtype;
  v_status text;
  v_onboarding text;
  v_count integer;
begin
  if p_user_id is null or p_link_token_hash is null or p_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  select p.onboarding_status into v_onboarding from public.profiles p where p.id = p_user_id;
  if v_onboarding is null or v_onboarding not in ('completed', 'legacy_exempt') then
    raise exception 'complete_onboarding_required' using errcode = '42501';
  end if;
  select * into v_delivery from public.report_deliveries d where d.link_token_hash = p_link_token_hash;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  select o.status into v_status from public.complete_orders o where o.id = v_delivery.order_id;
  if v_delivery.status <> 'active' or v_status is distinct from 'paid' then
    return query select 'inactive'::text, null::uuid;
    return;
  end if;
  insert into public.account_report_registrations (user_id, delivery_id) values (p_user_id, v_delivery.id)
  on conflict (user_id, delivery_id) do nothing;
  get diagnostics v_count = row_count;
  return query select case when v_count > 0 then 'registered' else 'already' end, v_delivery.id;
end;
$$;
revoke all on function public.complete_register_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_register_delivery(uuid, text) to service_role;

-- 11. 新しい購入の完全解析の作り直し（固有リンク・登録で確かめた後に API が呼ぶ。手動の作り直しは2回まで）
create or replace function public.complete_regenerate_link_report(p_report_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  v_report public.complete_reports%rowtype;
begin
  select * into v_report from public.complete_reports r where r.id = p_report_id for update;
  if not found or not v_report.via_link then
    return 'not_found';
  end if;
  if v_report.status = 'revoked' or v_report.revoked_at is not null or v_report.quarantined_at is not null
     or not exists (select 1 from public.complete_orders o where o.id = v_report.source_order_id and o.status = 'paid')
     or not exists (select 1 from public.report_deliveries d where d.report_id = v_report.id and d.status = 'active') then
    return 'not_entitled';
  end if;
  if v_report.status = 'ready' then
    return 'ready';
  end if;
  if not public.complete_report_final_failure(v_report.status, v_report.attempts, v_report.max_attempts,
                                              v_report.next_retry_at, v_report.lease_expires_at) then
    return 'in_progress';
  end if;
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
   where id = v_report.id;
  return 'requeued';
end;
$$;
revoke all on function public.complete_regenerate_link_report(uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_link_report(uuid) to service_role;

-- 12. 従来の閲覧・作り直し（本人・ゲストの記録ごと）は、新しい購入の生成物（via_link）を見ない
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
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id and not r.via_link
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
revoke all on function public.complete_report_for_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_report_for_view(uuid, uuid) to service_role;

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
   where r.user_id is not distinct from p_user_id and r.diagnosis_session_id = p_diagnosis_session_id and not r.via_link
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
revoke all on function public.complete_regenerate_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_regenerate_report(uuid, uuid) to service_role;

-- 13. 運営者の停止・再発行（SQL Editor 専用。API のロールは実行できない）。秘密値は SQL・ログに出さない（ハッシュだけを渡す）
create or replace function public.complete_admin_revoke_delivery(p_delivery_id uuid, p_reason text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_reason is null or p_reason not in ('operator', 'mistaken_purchase', 'abuse') then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  update public.report_deliveries
     set status = 'revoked', revoked_at = now(), revoke_reason = p_reason, updated_at = now()
   where id = p_delivery_id and status = 'active';
  return case when found then 'revoked' else 'noop' end;
end;
$$;
revoke all on function public.complete_admin_revoke_delivery(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.complete_admin_reissue_delivery(p_delivery_id uuid, p_new_link_token_hash text)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if p_new_link_token_hash is null or p_new_link_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_invalid_request' using errcode = '22023';
  end if;
  update public.report_deliveries
     set link_token_hash = p_new_link_token_hash, reissue_count = reissue_count + 1, reissued_at = now(),
         status = 'active', revoked_at = null, revoke_reason = null, updated_at = now()
   where id = p_delivery_id;
  return case when found then 'reissued' else 'not_found' end;
end;
$$;
revoke all on function public.complete_admin_reissue_delivery(uuid, text) from public, anon, authenticated, service_role;

-- 14. 確認（変更はしない。期待と違えば全体を取り消す）
do $$
begin
  if to_regclass('public.report_deliveries') is null or to_regclass('public.account_report_registrations') is null
     or not (select relrowsecurity from pg_class where oid = 'public.report_deliveries'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.account_report_registrations'::regclass) then
    raise exception 'complete_13 tables are missing or without row level security';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('report_deliveries', 'account_report_registrations')) then
    raise exception 'complete_13 tables must not have policies';
  end if;
  if has_table_privilege('anon', 'public.report_deliveries', 'SELECT') or has_table_privilege('authenticated', 'public.report_deliveries', 'SELECT')
     or has_table_privilege('anon', 'public.account_report_registrations', 'SELECT')
     or has_table_privilege('authenticated', 'public.account_report_registrations', 'SELECT')
     or has_table_privilege('service_role', 'public.report_deliveries', 'DELETE')
     or has_table_privilege('service_role', 'public.account_report_registrations', 'DELETE')
     or not has_table_privilege('service_role', 'public.report_deliveries', 'SELECT')
     or not has_table_privilege('service_role', 'public.account_report_registrations', 'INSERT') then
    raise exception 'unexpected table privileges after complete_13';
  end if;
  if has_function_privilege('service_role', 'public.complete_admin_revoke_delivery(uuid, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.complete_admin_reissue_delivery(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_create_link_order(uuid, text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_register_delivery(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_create_link_order(uuid, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_apply_link_payment(text, timestamptz, boolean, uuid, text, text, integer, text, text, text, text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_register_delivery(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_regenerate_link_report(uuid)', 'EXECUTE') then
    raise exception 'unexpected function privileges after complete_13';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('complete_create_link_order', 'complete_apply_link_payment', 'complete_register_delivery',
                                'complete_regenerate_link_report', 'complete_admin_revoke_delivery', 'complete_admin_reissue_delivery',
                                'complete_orders_no_repurchase', 'complete_report_for_view', 'complete_regenerate_report')
              and (p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then
    raise exception 'complete_13 function is not security invoker with empty search_path';
  end if;
  if exists (select 1 from public.complete_reports where via_link) and not exists (select 1 from public.report_deliveries) then
    raise exception 'unexpected via_link reports';
  end if;
end
$$;

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261020120000', 'complete_13_report_links_and_registrations')
on conflict (version) do nothing;

commit;
