-- resonance_01_orders_reports_DRAFT_DO_NOT_RUN.sql
-- 共鳴診断｜人物像レポート（税込500円・買い切り）の保存先 — 草案（Phase C の C-1）。
--
-- ★ 適用しない（レビューとオーナーの承認まで）。ファイル名の DRAFT_DO_NOT_RUN は scripts/build-public.js でも公開禁止。
-- 根拠：docs/eti-mini/phase_c/共鳴診断_PhaseC_設計指示書_v1.md §5-2
-- 方針：本家（complete_orders・record_entitlements・stripe_webhook_events・complete_reports・report_deliveries）とは分ける。
--       本家の表を参照・変更しない（外部キーも張らない）。
--       すべて service_role 経由のサーバー API だけが読み書きする（anon・authenticated には権限を与えない。RLS も有効にして既定で拒否）。
--       本家の stripe_webhook_events は livemode=false の制約・complete_orders への外部キーがあるため流用せず、共鳴診断専用の受信記録を持つ。

begin;

-- 1. 注文（Checkout を作る前にサーバーが作る。金額は 500 円の固定。リクエストから受け取らない）
create table public.resonance_orders (
  id                        uuid primary key default gen_random_uuid(),
  product_code              text not null default 'resonance_report_v1' check (product_code = 'resonance_report_v1'),
  amount_jpy                integer not null check (amount_jpy = 500),
  currency                  text not null default 'jpy' check (currency = 'jpy'),
  environment               text not null check (environment in ('preview', 'production')),
  -- 3回答（内部キー）と、サーバーが固定割当表から引き直した人物。購入時のスナップショットの元
  answer_element            text not null check (answer_element in ('炎','水','氷','雷','風','岩','草')),
  answer_weapon             text not null check (answer_weapon in ('片手剣','両手剣','長柄','法器','弓')),
  answer_nation             text not null check (answer_nation in ('モンド','璃月','稲妻','スメール','フォンテーヌ','ナタ','スネージナヤ','ナドクライ')),
  mirror_character          text not null,
  stripe_session_id         text unique,
  stripe_payment_intent_id  text unique,
  status                    text not null default 'pending'
                            check (status in ('pending', 'paid', 'report_ready', 'failed', 'canceled', 'refunded', 'disputed')),
  created_at                timestamptz not null default now(),
  paid_at                   timestamptz,
  refunded_at               timestamptz
);
create index resonance_orders_status_idx on public.resonance_orders (status, created_at);

-- 2. 生成済みレポート（注文ごとに1件。再閲覧はこの行だけを読み、計算し直さない）
create table public.resonance_reports (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null unique references public.resonance_orders(id) on delete restrict,
  snapshot          jsonb not null,           -- RESONANCE-REPORT-SNAPSHOT-2（lib/resonance_report_v1.js の buildSnapshot）
  snapshot_sha256   text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version    text not null check (schema_version = 'RESONANCE-REPORT-SNAPSHOT-2'),
  text_version      text not null,
  chart_version     text not null,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,              -- 返金・異議などで閲覧を止めた時刻（行は消さない）
  constraint resonance_reports_no_draft check (not (snapshot ? 'draft_missing'))  -- 未執筆の辞書が残るものは保存できない
);

-- 3. 閲覧の権利（推測できない乱数のリンク。DB にはハッシュだけ）
create table public.resonance_access_tokens (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.resonance_reports(id) on delete restrict,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index resonance_access_tokens_report_idx on public.resonance_access_tokens (report_id);

-- 4. Stripe Webhook の受信記録（重複配送の冪等化。本文は保存しない）
create table public.resonance_webhook_events (
  event_id      text primary key,
  event_type    text not null,
  livemode      boolean not null,
  event_created timestamptz not null,
  order_id      uuid references public.resonance_orders(id) on delete set null,
  status        text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_code    text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

-- 権限：サーバー（service_role）だけ。公開ロールからは一切読めない
revoke all on table public.resonance_orders, public.resonance_reports, public.resonance_access_tokens, public.resonance_webhook_events
  from public, anon, authenticated;
alter table public.resonance_orders enable row level security;
alter table public.resonance_reports enable row level security;
alter table public.resonance_access_tokens enable row level security;
alter table public.resonance_webhook_events enable row level security;
-- ポリシーは作らない（RLS 有効＋ポリシーなし＝公開ロールは全拒否。service_role は RLS を通らない）

commit;
