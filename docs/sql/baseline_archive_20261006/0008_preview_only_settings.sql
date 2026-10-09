-- ============================================================
-- 0008 Preview 専用の設定（設計案・まだ実行しない）
-- 【実行禁止】Preview 構築の承認後に、0001〜0007 の検証が済んでから別承認で実行する。
-- 【本番では絶対に実行しない】このファイルは「このDBは Preview である」と宣言する。
--   本番で実行すると、Preview 用の検査（Test 決済のみ許可）が本番の Live 決済を拒否してしまう。
-- 完全解析テーブル・newsletter の追加列は含めない（SCHEMA_INVENTORY.md §8 を参照）。
-- 行データ：なし（INSERT を使わずに識別できる形にしている）
-- ============================================================

-- ------------------------------------------------------------
-- (1) Preview 環境の識別
-- ------------------------------------------------------------
-- 方式：定数を返す関数。行を入れないので、本番データのコピーや TRUNCATE で消えることがない。
-- サーバー（service_role）だけが RPC として呼べる。ヘルスチェックと、Preview 専用 SQL（テストデータの
-- 投入・削除）の冒頭で確認に使う。ブラウザ（anon・authenticated）からは呼べない。
-- Project Ref は書かない（Ref はプロジェクトごとに決まり、SQL では取れないため。Ref の照合は
-- サーバー側の環境ガードが SUPABASE_URL で行う）。
create or replace function public.deployment_environment()
  returns text
  language sql
  immutable
  security invoker
  set search_path = ''
as $$ select 'preview'::text $$;

revoke all on function public.deployment_environment() from public, anon, authenticated;
grant execute on function public.deployment_environment() to service_role;

comment on function public.deployment_environment() is
  'このDBの用途。Preview 専用プロジェクトでだけ作る。本番には作らない（本番では関数が存在しないことで判別する）';

-- 人が SQL Editor で見て分かるように、スキーマにも注記を付ける
comment on schema public is
  'element-diagnosis PREVIEW 専用。本番（Production）のデータを入れない。本番のユーザー・診断・購入権・同意をコピーしない';

-- Preview 専用 SQL（テストデータの投入・削除）の冒頭に置く確認の例（ここでは定義だけ）：
--   do $$ begin
--     if public.deployment_environment() is distinct from 'preview' then
--       raise exception 'not a preview database';
--     end if;
--   end $$;
-- 本番には関数が無いため、本番で誤って実行すると「関数が無い」エラーで止まる。

-- ------------------------------------------------------------
-- (2) 本番データの誤投入を防ぐ
-- ------------------------------------------------------------
-- ・本番からの pg_dump（データ込み）・CSV 取り込み・Table Editor への貼り付けをしない。
-- ・Preview のユーザーは Preview の Auth で新規に作る（本番の auth.users をコピーしない）。
-- ・下の (3) により、Live の Checkout Session（cs_live_…）は purchase_entitlements に入らない。
--   本番の購入権をコピーしようとすると、この制約で失敗する。

-- ------------------------------------------------------------
-- (3) Test と Live を混ぜない制約（Preview 側）
-- ------------------------------------------------------------
-- Preview の購入権は Stripe Test モードの Checkout Session だけ。
-- Stripe の Checkout Session ID は、Test が cs_test_、Live が cs_live_ で始まる。
alter table public.purchase_entitlements
  add constraint purchase_entitlements_preview_test_mode_only
  check (stripe_checkout_session_id like 'cs\_test\_%');

-- 本番側の候補（このファイルでは実行しない。本番に Test 権利が8件あるため、本番に付けるなら
-- NOT VALID で既存行を検査せずに追加し、Test 行の扱いを決めた後で VALIDATE する。別承認）：
--   alter table public.purchase_entitlements
--     add constraint purchase_entitlements_live_mode_only
--     check (stripe_checkout_session_id like 'cs\_live\_%') not valid;
-- 列で mode を持つ案（stripe_mode text check (stripe_mode in ('live','test'))）は、コード側の変更が
-- 必要なため候補として記録するだけにする。
