#!/usr/bin/env python3
"""本番（akivoob）専用 migration を、検証済みの Preview migration から機械的に組み立てる。

- 入力：docs/sql/2026*.sql（Preview 用。中身は変えない）
- 出力：docs/sql/production/prod_0[1-4]_*.sql（本番専用。生成物もコミットしてレビューする）
- 置き換えは全て「件数を数えて」行い、想定と違えば生成を止める（取りこぼし・過剰置換の防止）。
使い方: python3 docs/sql/production/build_production_sql.py [--check]
  --check: 生成結果とコミット済みファイルの一致だけを確かめる（差分があれば終了コード1）
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
SQL = ROOT.parent

PREVIEW = {
    'onb': '20261006225744_onboarding_01_registration_onboarding.sql',
    '01': '20261007111306_complete_01_orders_entitlements_reports.sql',
    '02': '20261007113230_complete_02_service_role_privileges.sql',
    '03': '20261007205700_complete_03_mentor_goal_ownership.sql',
    '04': '20261007213147_complete_04_payment_transactions.sql',
    '05': '20261007234325_complete_05_admin_audit_log.sql',
    '06': '20261008101348_complete_06_report_storage.sql',
    '07': '20261009120000_complete_07_guest_checkout_claim.sql',
    '08': '20261013120000_complete_08_purchase_integrity.sql',
    '09': '20261013180000_complete_09_result_resume_links.sql',
    '10': '20261014120000_complete_10_entitlement_owner_isolation.sql',
    '11': '20261014180000_complete_11_refund_rebuy_double_purchase.sql',
    '12': '20261015120000_complete_12_single_purchase_email_claim.sql',
    '13': '20261020120000_complete_13_report_links_and_registrations.sql',
    '14': '20261021120000_complete_14_reissue_clears_registrations.sql',
    '15': '20261021180000_complete_15_consent_versions.sql',
    '16': '20261021200000_complete_16_close_old_consent_versions.sql',
}


def rep(text, old, new, count, label):
    n = text.count(old)
    if n != count:
        sys.exit(f'replace mismatch [{label}]: expected {count}, found {n}: {old[:80]!r}')
    return text.replace(old, new)


def rep_re(text, pattern, new, count, label, flags=re.S):
    found = len(re.findall(pattern, text, flags))
    if found != count:
        sys.exit(f'regex mismatch [{label}]: expected {count}, found {found}: {pattern[:80]!r}')
    return re.sub(pattern, new, text, flags=flags)


def body(key):
    """Preview ファイルから、トランザクション・Preview 判定・migration 履歴の行を除いた本体を取り出す。"""
    name = PREVIEW[key]
    t = (SQL / name).read_text(encoding='utf-8')
    if t.count('\nbegin;\n') != 1 or t.count('\ncommit;') != 1:
        sys.exit(f'{name}: begin/commit must appear exactly once')
    head, rest = t.split('\nbegin;\n', 1)
    inner = rest.rsplit('\ncommit;', 1)[0]
    # 最初の DO ブロック（Preview 判定と前提確認）を除く。中に 'not a preview database' が必ずある
    m = re.match(r'\s*(--[^\n]*\n\s*)*do \$\$\n.*?\nend\n\$\$;\n', inner, re.S)
    if not m or 'not a preview database' not in m.group(0):
        sys.exit(f'{name}: preview guard block not found at the start of the transaction')
    inner = inner[m.end():]
    if 'not a preview database' in inner or 'deployment_environment' in inner.replace('-- ', ''):
        sys.exit(f'{name}: preview reference remains after removing the guard')
    # migration 履歴（supabase_migrations）への INSERT を除く。本番は element_release.migration_ledger に記録する
    inner = rep_re(inner, r'\n(--[^\n]*\n)*insert into supabase_migrations\.schema_migrations \(version, name\)\nvalues \([^)]*\)\non conflict \(version\) do nothing;\n',
                   '\n', 0 if key in ('onb', '01', '02', '03', '04', '05', '06') else 1, f'{key}:ledger')
    if 'supabase_migrations' in inner:
        sys.exit(f'{name}: supabase_migrations reference remains')
    return f'-- ------------------------------------------------------------\n-- 由来：docs/sql/{name}（Preview 判定・履歴行を除き、本番向けの置き換えをしたもの）\n-- ------------------------------------------------------------\n' + inner.strip('\n') + '\n'


def live_only(text, key, inserts, mismatch):
    """Stripe Test 前提の箇所を Live 前提へ置き換える（件数を固定して確認）。"""
    text = rep_re(text, r"(\bv_amount, |then 1000 else 3000 end, )'test',", r"\1'live',", inserts, f'{key}:insert_mode', flags=0)
    text = rep(text, "when p_livemode is distinct from false or v_order.stripe_mode <> 'test' then 'livemode_mismatch'",
               "when p_livemode is distinct from true or v_order.stripe_mode <> 'live' then 'livemode_mismatch'", mismatch, f'{key}:mismatch')
    return text


# ------------------------------------------------------------------
# 本番の基準値（2026-10-21 に運営者の手元で読み取り専用に取得した値）
#   構造：バックアップ時の基準値と一致（列・関数・policy・制約・索引・権限・auth トリガー）
#   購入：件数・金額・状態と、診断コードハッシュの集計指紋（個別の値ではない）
# ------------------------------------------------------------------
EXPECTED = {
    'live_hashfp': '30665072821e4cafb1fe85fc56f4dc96',
    'test_hashfp': 'a5bc637c700f585024be751b912db9b6',
}

BASE_COLS = ['diagnosis_answers.answers', 'diagnosis_answers.answers_v2', 'diagnosis_answers.created_at', 'diagnosis_answers.encoded_answers', 'diagnosis_answers.id', 'diagnosis_answers.session_id', 'diagnosis_results.character_db_version', 'diagnosis_results.character_matches', 'diagnosis_results.character_profile_version', 'diagnosis_results.created_at', 'diagnosis_results.diagnosis_code', 'diagnosis_results.diagnosis_version', 'diagnosis_results.ennea_sorted', 'diagnosis_results.id', 'diagnosis_results.item_set_version', 'diagnosis_results.mirror_model_version', 'diagnosis_results.mirror_snapshot', 'diagnosis_results.primary_result', 'diagnosis_results.report_logic_version', 'diagnosis_results.scores', 'diagnosis_results.scoring_version', 'diagnosis_results.session_id', 'diagnosis_results.template_version', 'diagnosis_results.translation_model_version', 'diagnosis_results.v2_rankings', 'diagnosis_results.v2_scores', 'diagnosis_sessions.client_session_id', 'diagnosis_sessions.completed_at', 'diagnosis_sessions.created_at', 'diagnosis_sessions.diagnosis_type', 'diagnosis_sessions.diagnosis_version', 'diagnosis_sessions.id', 'diagnosis_sessions.item_set_version', 'diagnosis_sessions.scoring_version', 'diagnosis_sessions.user_id', 'profiles.created_at', 'profiles.id', 'profiles.newsletter_opted_in', 'profiles.newsletter_opted_in_at', 'profiles.updated_at', 'purchase_entitlements.amount', 'purchase_entitlements.created_at', 'purchase_entitlements.currency', 'purchase_entitlements.diagnosis_code_hash', 'purchase_entitlements.id', 'purchase_entitlements.product_type', 'purchase_entitlements.purchased_at', 'purchase_entitlements.status', 'purchase_entitlements.stripe_checkout_session_id', 'purchase_entitlements.stripe_payment_intent_id', 'report_snapshots.character_matches', 'report_snapshots.created_at', 'report_snapshots.diagnosis_code', 'report_snapshots.id', 'report_snapshots.primary_result', 'report_snapshots.scores', 'report_snapshots.scoring_version']
BASE_POLICIES = ['diagnosis_answers_insert_own', 'diagnosis_answers_select_own', 'diagnosis_results_insert_own', 'diagnosis_results_select_own', 'diagnosis_sessions_insert_own', 'diagnosis_sessions_select_own', 'profiles_select_own', 'profiles_update_own']
BASE_CONSTRAINTS = ['diagnosis_answers_pkey', 'diagnosis_answers_session_id_fkey', 'diagnosis_answers_session_id_key', 'diagnosis_results_pkey', 'diagnosis_results_session_id_fkey', 'diagnosis_results_session_id_key', 'diagnosis_sessions_client_session_id_unique', 'diagnosis_sessions_pkey', 'diagnosis_sessions_user_id_fkey', 'profiles_id_fkey', 'profiles_pkey', 'purchase_entitlements_amount_nonneg_check', 'purchase_entitlements_hash_format_check', 'purchase_entitlements_pkey', 'purchase_entitlements_product_type_check', 'purchase_entitlements_status_check', 'purchase_entitlements_stripe_checkout_session_id_key', 'report_snapshots_diagnosis_code_key', 'report_snapshots_pkey']
BASE_INDEXES = ['diagnosis_answers_pkey', 'diagnosis_answers_session_id_key', 'diagnosis_results_pkey', 'diagnosis_results_session_id_key', 'diagnosis_sessions_client_session_id_unique', 'diagnosis_sessions_pkey', 'idx_diagnosis_sessions_user_id_completed_at', 'idx_purchase_entitlements_code_hash', 'profiles_pkey', 'purchase_entitlements_pkey', 'purchase_entitlements_stripe_checkout_session_id_key', 'report_snapshots_diagnosis_code_key', 'report_snapshots_pkey']


def arr(xs):
    return 'array[' + ', '.join(f"'{x}'" for x in xs) + ']'


def guard(stage, prev_required, phase):
    """本番であること・既存構造と旧購入が基準どおりであることの確認（phase: before/after）。"""
    ledger = ''
    if phase == 'before':
        if stage == 1:
            ledger = """
  -- 段階の順序：1 は最初。台帳がある＝既に何かが適用済み
  if to_regclass('element_release.migration_ledger') is not null then
    if exists (select 1 from element_release.migration_ledger where stage = 1) then
      raise exception 'stage_already_applied: prod_01 は適用済みです（何も変更していません）';
    end if;
    raise exception 'unexpected ledger state before prod_01';
  end if;
  if to_regnamespace('element_release') is not null then
    raise exception 'schema element_release already exists (unexpected)';
  end if;
  -- 追加する列・表がまだ無いこと（部分適用の検出）
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status')
     or to_regclass('public.complete_orders') is not null
     or to_regprocedure('public.complete_registration_onboarding(text, text, text)') is not null then
    raise exception 'registration/complete objects already exist (partial or foreign state)';
  end if;"""
        else:
            extra = ''
            if stage == 2:
                extra = """
  -- complete 系の表がまだ無いこと（部分適用・別系統の作成の検出）
  if to_regclass('public.complete_orders') is not null or to_regclass('public.record_entitlements') is not null
     or to_regclass('public.report_deliveries') is not null or to_regclass('public.account_report_registrations') is not null
     or to_regclass('public.complete_legacy_bindings') is not null or to_regclass('public.legacy_access_blocks') is not null
     or to_regclass('public.stripe_webhook_events') is not null or to_regclass('public.complete_reports') is not null then
    raise exception 'complete tables already exist before prod_02 (partial or foreign state)';
  end if;"""
            ledger = f"""
  -- 段階の順序：prod_{stage - 1:02d} まで適用済みで、prod_{stage:02d} は未適用
  if to_regclass('element_release.migration_ledger') is null then
    raise exception 'prod_01 is not applied (ledger missing)';
  end if;
  if exists (select 1 from element_release.migration_ledger where stage = {stage}) then
    raise exception 'stage_already_applied: prod_{stage:02d} は適用済みです（何も変更していません）';
  end if;
  if (select array_agg(stage order by stage) from element_release.migration_ledger) is distinct from {prev_required} then
    raise exception 'ledger does not show the previous stages in order';
  end if;{extra}"""
    return f"""do $guard$
declare
  v_n integer; v_fp text; v_cut timestamptz;
begin
  -- 1. PostgreSQL 17 以上
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'postgresql 17 or later is required';
  end if;
  -- 2. Preview ではないこと（Preview だけが deployment_environment() を持つ）
  if to_regprocedure('public.deployment_environment()') is not null then
    raise exception 'deployment_environment() exists: this is not the production database';
  end if;
  if exists (select 1 from pg_constraint where conname in ('complete_orders_preview_test_mode_only', 'stripe_webhook_events_preview_test_only')) then
    raise exception 'preview-only constraints exist: this is not the production database';
  end if;
  -- 3. Supabase の auth と既存6表
  if to_regclass('auth.users') is null then raise exception 'auth.users is missing'; end if;
  if to_regclass('public.profiles') is null or to_regclass('public.diagnosis_sessions') is null
     or to_regclass('public.diagnosis_answers') is null or to_regclass('public.diagnosis_results') is null
     or to_regclass('public.report_snapshots') is null or to_regclass('public.purchase_entitlements') is null then
    raise exception 'baseline tables are missing';
  end if;
  -- 4. 既存の主要3関数と auth.users のトリガー（棚卸し・バックアップ時の定義と一致）
  if md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) <> '965ca6d894f643c07e2db06b6dd83b29' then
    raise exception 'handle_new_user() differs from the inventoried definition';
  end if;
  select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by pg_get_function_identity_arguments(p.oid)) into v_fp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session';
  if v_fp is distinct from '9fd749fe0ebe2c595fa48e6e3f0b2ffd' then
    raise exception 'save_diagnosis_session differs from the inventoried definition';
  end if;
  select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by pg_get_function_identity_arguments(p.oid)) into v_fp
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_diagnosis_session_v2';
  if v_fp is distinct from '6ec1bde79f95610afe92ffce824f7997' then
    raise exception 'save_diagnosis_session_v2 differs from the inventoried definition';
  end if;
  select count(*), md5(string_agg(t.tgname || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname)) into v_n, v_fp
    from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
  if v_n <> 1 or v_fp <> 'ffa9bd9ac265fa1a7a3d53923f1df8e5' then
    raise exception 'auth.users triggers differ from the inventoried state';
  end if;
  -- 5. 既存6表の既存部分（追加列・追加制約を除いた部分）がバックアップ時と同じ
  select count(*), md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, ''), ',' order by table_name, column_name))
    into v_n, v_fp from information_schema.columns
   where table_schema = 'public' and (table_name || '.' || column_name) = any({arr(BASE_COLS)});
  if v_n <> 57 or v_fp <> '83c76ac577beace4c523c6ea25974331' then
    raise exception 'baseline columns differ (count %, type or default changed)', v_n;
  end if;
  select count(*), md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname))
    into v_n, v_fp from pg_policies where schemaname = 'public' and policyname = any({arr(BASE_POLICIES)});
  if v_n <> 8 or v_fp <> 'f6ebc1e867656e2dcfb8b2f6a0a897d5' then
    raise exception 'baseline policies differ';
  end if;
  select count(*), md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
    into v_n, v_fp from pg_constraint where connamespace = 'public'::regnamespace and conname = any({arr(BASE_CONSTRAINTS)});
  if v_n <> 19 or v_fp <> 'e86317025f947fae6e5cbb41786fa0c8' then
    raise exception 'baseline constraints differ';
  end if;
  select count(*), md5(string_agg(indexdef, ',' order by indexname)) into v_n, v_fp
    from pg_indexes where schemaname = 'public' and indexname = any({arr(BASE_INDEXES)});
  if v_n <> 13 or v_fp <> '10cb608446bd505b5d21f716745fcc76' then
    raise exception 'baseline indexes differ';
  end if;
  select count(*), md5(string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' order by table_name, grantee, privilege_type))
    into v_n, v_fp from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     and table_name in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements');
  if v_n <> 126 or v_fp <> '6965208bc08c57e15bb54915ef77c7a9' then
    raise exception 'baseline table grants differ';
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
              and c.relname in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements')
              and not c.relrowsecurity) then
    raise exception 'row level security is off on a baseline table';
  end if;
  -- 6. 旧購入（purchase_entitlements）が基準どおり：9件・live 1件 ¥1,000・test 8件 ¥8,000・全て active・集計指紋
  --    比べるのは prod_01 を適用した時点より前の行（基準の9件）。prod_01 の後に旧 main（/api/verify）が記録した
  --    正規の Live の購入は、基準と別に「全て cs_live_・active・core1 ¥1,000」であることだけを確かめる（止めない）
  v_cut := 'infinity';
  if to_regclass('element_release.migration_ledger') is not null then
    execute 'select applied_at from element_release.migration_ledger where stage = 1' into v_cut;
    v_cut := coalesce(v_cut, 'infinity');
  end if;
  if v_cut = 'infinity' and nullif(current_setting('element.prod01_applied_at', true), '') is not null then
    v_cut := current_setting('element.prod01_applied_at', true)::timestamptz;  -- prod_91（台帳を外した後の確認）用
  end if;
  if (select count(*) from public.purchase_entitlements where created_at < v_cut) <> 9 then
    raise exception 'purchase_entitlements baseline is not 9 rows (stop and re-run the preflight)';
  end if;
  if exists (select 1 from public.purchase_entitlements where created_at >= v_cut
              and (stripe_checkout_session_id not like 'cs\\_live\\_%' or status <> 'active' or product_type <> 'core1' or amount <> 1000 or currency <> 'jpy')) then
    raise exception 'unexpected purchase_entitlements rows after prod_01 (not a live core1 purchase)';
  end if;
  if (select count(*) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\\_live\\_%') <> 1
     or (select sum(amount) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\\_live\\_%') <> 1000
     or (select count(*) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\\_test\\_%') <> 8
     or (select sum(amount) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\\_test\\_%') <> 8000
     or exists (select 1 from public.purchase_entitlements where created_at < v_cut and status <> 'active') then
    raise exception 'purchase_entitlements live/test counts, amounts or status differ from the baseline';
  end if;
  -- BEGIN EXPECTED PURCHASE FINGERPRINT（本番の基準値。ローカル試験だけが合成データ用の値に差し替える）
  if (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\\_live\\_%') <> '{EXPECTED['live_hashfp']}'
     or (select md5(string_agg(diagnosis_code_hash || ':' || status, ',' order by diagnosis_code_hash, status)) from public.purchase_entitlements where created_at < v_cut and stripe_checkout_session_id like 'cs\\_test\\_%') <> '{EXPECTED['test_hashfp']}' then
    raise exception 'purchase_entitlements fingerprint differs from the baseline';
  end if;
  -- END EXPECTED PURCHASE FINGERPRINT{ledger}
end
$guard$;
"""


LEDGER_INSERT = """insert into element_release.migration_ledger (stage, name) values ({stage}, '{name}');
"""

HEADER = """-- ============================================================
-- {title}
-- 【本番（element-diagnosis-test / akivoob）専用】SQL Editor で、このファイル全体を1回だけ実行する。
-- 【Preview・その他では実行しない】冒頭の確認で、本番の基準と違えば何も変えずに止まる。
-- 生成元：docs/sql/production/build_production_sql.py（Preview migration から機械的に組み立て。手で編集しない）
-- 前提：{prereq}
-- 戻し：{rollback}（DRAFT_DO_NOT_RUN）
-- 二度目の実行：冒頭で stage_already_applied として止まる（何も変更しない）。
-- 旧購入者保護（S0）：purchase_entitlements・旧購入・既存6表の既存列・主要3関数・既存 RLS／policy／権限は変更しない。
-- ============================================================
{notes}
begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

"""


def stage1():
    onb = body('onb')
    # 既存行は legacy_exempt（この仕組み以前からの利用者。同意したとは記録しない・お知らせメールの値も変えない）。
    # UPDATE 文を使わず、列の既定値で一度に埋める（既存列の値は触らない）。
    onb = rep(onb, "alter table public.profiles\n  add column onboarding_status            text,\n",
              "alter table public.profiles\n  add column onboarding_status            text not null default 'legacy_exempt',\n", 1, 'onb:add_status')
    onb = rep_re(onb, r"\n-- 2\. 既存行の区分（Preview：すべて required。同意日時・版は入れない）\nupdate public\.profiles\n   set onboarding_status = 'required'\n where onboarding_status is null;\n",
                 "\n-- 2. 既存行の区分（本番）：列の追加時の既定値 'legacy_exempt' で埋まっている（UPDATE はしない）。\n--    同意日時・版・お知らせメールの値は入れない・変えない。\n", 1, 'onb:update')
    # 移行期間（この段階を当ててから prod_04 まで）の新規登録は、旧画面からの登録＝新しい同意をしていないので legacy_exempt。
    # 'required' への切り替えと、診断保存の拒否トリガーは prod_04（Production deploy の直前）で行う。
    onb = rep(onb, "alter table public.profiles\n  alter column onboarding_status set default 'required',\n  alter column onboarding_status set not null,\n  add constraint",
              "alter table public.profiles\n  add constraint", 1, 'onb:default')
    onb = rep_re(onb, r"\ncreate trigger diagnosis_sessions_require_onboarding\n  before insert on public\.diagnosis_sessions\n  for each row execute function public\.diagnosis_sessions_require_onboarding\(\);\n",
                 "\n-- トリガーの作成は prod_04（切り替え）で行う。ここでは関数だけを用意する。\n", 1, 'onb:trigger')
    # 同意の版は最終版（2026-10-21 の組だけ）。Preview の 09・15 の途中版は本番では不要
    c16 = body('16')
    return HEADER.format(
        title='prod_01：登録・同意・既存利用者の互換層（本番）',
        prereq='prod_00_preflight_READONLY.sql の全項目が OK。バックアップ取得・復元試験が合格済み',
        rollback='docs/sql/production/prod_91_rollback_01_DRAFT_DO_NOT_RUN.sql',
        notes="""--
-- 内容
--   ・本番専用の migration 台帳 element_release.migration_ledger（外部 API から見えない別スキーマ）
--   ・profiles に登録完了・同意・お知らせメール同期の列を追加（既存3人は legacy_exempt。既存の値は変えない）
--   ・同意列のブラウザ直接書き換え防止トリガー、登録完了 RPC（同意版は 2026-10-21 の組だけ）
--   ・新規登録の既定値は、prod_04 までの間は legacy_exempt（旧画面からの登録は新しい同意をしていないため）
--   ・旧 main のコード（save_diagnosis_session・/api/verify・/api/report-data）の動きは変わらない
""") + guard(1, None, 'before') + """
-- ============================================================
-- 0. 本番専用の migration 台帳（Supabase CLI の supabase_migrations とは別物・名前も重ねない）
-- ============================================================
create schema element_release;
revoke all on schema element_release from public, anon, authenticated, service_role;
create table element_release.migration_ledger (
  stage       integer primary key check (stage between 1 and 4),
  name        text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user
);
revoke all on table element_release.migration_ledger from public, anon, authenticated, service_role;
comment on schema element_release is '元素診断 本番 migration の台帳（prod_01〜04）。アプリ・API からは使わない';

""" + onb + '\n' + c16 + """
-- ============================================================
-- 適用後の確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $post$
begin
  if (select count(*) from public.profiles where onboarding_status is distinct from 'legacy_exempt') <> 0 then
    raise exception 'existing profiles must all be legacy_exempt';
  end if;
  if exists (select 1 from public.profiles where terms_version is not null or privacy_version is not null or newsletter_consent_version is not null
              or onboarding_completed_at is not null or newsletter_sync_status is not null) then
    raise exception 'consent values must not be recorded for existing profiles';
  end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status')
     is distinct from '''legacy_exempt''::text' then
    raise exception 'onboarding_status default must be legacy_exempt until prod_04';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'diagnosis_sessions_require_onboarding') then
    raise exception 'require_onboarding trigger must not exist before prod_04';
  end if;
  if has_schema_privilege('anon', 'element_release', 'USAGE') or has_schema_privilege('authenticated', 'element_release', 'USAGE')
     or has_schema_privilege('service_role', 'element_release', 'USAGE') then
    raise exception 'element_release must not be reachable from the API roles';
  end if;
end
$post$;
""" + guard(1, None, 'after') + LEDGER_INSERT.format(stage=1, name='prod_01_registration_compat') + """
notify pgrst, 'reload schema';

commit;
"""


def stage2():
    parts = []
    for k, ins, mm in [('01', 0, 0), ('02', 0, 0), ('03', 0, 0), ('04', 1, 1), ('05', 0, 0), ('06', 0, 0), ('07', 2, 1),
                       ('08', 2, 1), ('09', 0, 0), ('10', 2, 0), ('11', 2, 1), ('12', 0, 0), ('13', 1, 1)]:
        b = body(k)
        b = live_only(b, k, ins, mm)
        if k == '01':
            b = rep(b, "  -- Preview の DB には Test の決済だけを入れる\n  constraint complete_orders_preview_test_mode_only check (stripe_mode = 'test'),",
                    "  -- 本番の DB には Live の決済だけを入れる\n  constraint complete_orders_production_live_mode_only check (stripe_mode = 'live'),", 1, '01:orders_mode')
            b = rep(b, "stripe_checkout_session_id is null or stripe_checkout_session_id like 'cs\\_test\\_%')",
                    "stripe_checkout_session_id is null or stripe_checkout_session_id like 'cs\\_live\\_%')", 1, '01:checkout_prefix')
            b = rep(b, "  constraint stripe_webhook_events_preview_test_only check (livemode = false)",
                    "  constraint stripe_webhook_events_production_live_only check (livemode = true)", 1, '01:webhook_mode')
        if k == '09':
            # 同意版の途中版（2026-10-13）への置き換えは本番では行わない（prod_01 で最終版を入れ済み）
            b = rep_re(b, r"\n-- 5\. 登録完了の同意版：.*?\ngrant execute on function public\.complete_registration_onboarding\(text, text, text\) to authenticated;\n",
                       "\n-- 5. （本番では省略）同意版の途中版への置き換えはしない。prod_01 の最終版（2026-10-21 の組だけ）を保つ。\n", 1, '09:consent')
            b = rep(b, "     or position('2026-10-13' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) = 0 then",
                    "     or position('2026-10-21' in pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure)) = 0\n     or pg_get_functiondef('public.complete_registration_onboarding(text, text, text)'::regprocedure) ~ '2026-10-13' then", 1, '09:check')
        parts.append(b)
    return HEADER.format(
        title='prod_02：注文・権利・レポート・固有リンク・登録機能（本番）',
        prereq='prod_01 適用済み（element_release.migration_ledger に stage 1）',
        rollback='docs/sql/production/prod_92_rollback_02_DRAFT_DO_NOT_RUN.sql',
        notes="""--
-- 内容（Preview の complete_01〜13 を順に。同じ順序・同じ本文で、次だけを本番向けに変える）
--   ・complete_orders は Live だけ（stripe_mode = 'live'）。stripe_webhook_events も livemode = true だけ
--   ・注文作成 RPC が記録する stripe_mode は 'live'。Webhook の照合も Live 前提
--   ・Preview 専用の制約（*_preview_test_*）は作らない。Test の Price ID・Webhook 値は SQL に含まない
--   ・既存表への変更は diagnosis_sessions だけ：user_id の NOT NULL を外す（ゲストの記録用。既存8行は値を持つまま）・
--     guest_created_at 列・所有者か ゲストかの制約・所有者固定トリガーの追加。既存行・既存列の値は変えない
--   ・purchase_entitlements には何もしない（cs_test_ の8行があるため Live 限定制約も付けない）。旧購入を新しい表へ移さない
""") + guard(2, 'array[1]', 'before') + '\n' + '\n'.join(parts) + """
-- ============================================================
-- 適用後の確認（変更はしない。期待と違えば全体を取り消す）
-- ============================================================
do $post$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and (pg_get_functiondef(p.oid) ~ $re$stripe_mode <> 'test'$re$ or pg_get_functiondef(p.oid) ~ $re$v_amount, 'test',$re$
                   or pg_get_functiondef(p.oid) ~ $re$end, 'test', null$re$ or pg_get_functiondef(p.oid) ~ 'p_livemode is distinct from false')) then
    raise exception 'a function still assumes Stripe test mode';
  end if;
  if exists (select 1 from pg_constraint c where c.connamespace = 'public'::regnamespace
              and (pg_get_constraintdef(c.oid) ~ 'cs\\\\_test' or pg_get_constraintdef(c.oid) ~ 'livemode = false'
                   or pg_get_constraintdef(c.oid) ~ $re$stripe_mode = 'test'$re$)
              and c.conrelid <> 'public.purchase_entitlements'::regclass) then
    raise exception 'a constraint still assumes Stripe test mode';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'complete_orders_production_live_mode_only')
     or not exists (select 1 from pg_constraint where conname = 'stripe_webhook_events_production_live_only') then
    raise exception 'live-only constraints are missing';
  end if;
  if (select count(*) from public.complete_orders) <> 0 or (select count(*) from public.record_entitlements) <> 0
     or (select count(*) from public.complete_legacy_bindings) <> 0 or (select count(*) from public.report_deliveries) <> 0
     or (select count(*) from public.account_report_registrations) <> 0 or (select count(*) from public.legacy_access_blocks) <> 0 then
    raise exception 'new tables must be empty right after the migration (no automatic migration of old purchases)';
  end if;
  if exists (select 1 from public.diagnosis_sessions where user_id is null) then
    raise exception 'existing diagnosis_sessions must keep their owner';
  end if;
end
$post$;
""" + guard(2, 'array[1]', 'after') + LEDGER_INSERT.format(stage=2, name='prod_02_orders_reports_links') + """
notify pgrst, 'reload schema';

commit;
"""


def stage3():
    b14 = body('14')
    return HEADER.format(
        title='prod_03：管理（再発行）・本番制約の最終確認（本番）',
        prereq='prod_02 適用済み（element_release.migration_ledger に stage 1, 2）',
        rollback='docs/sql/production/prod_93_rollback_03_DRAFT_DO_NOT_RUN.sql',
        notes="""--
-- 内容
--   ・管理者の再発行で、旧リンクに紐づくマイページ登録を外す（Preview complete_14 と同じ本文）
--   ・本番制約の最終確認：Live 限定・API ロールの権限・Preview 専用物が無いこと・旧購入の不変
""") + guard(3, 'array[1, 2]', 'before') + '\n' + b14 + """
-- ============================================================
-- 適用後の確認（本番制約の総点検。変更はしない）
-- ============================================================
do $post$
declare
  t text;
begin
  -- 新しい表：RLS 有効・anon／authenticated は権限なし
  foreach t in array array['complete_orders', 'record_entitlements', 'stripe_webhook_events', 'complete_reports', 'record_mentor_goals',
                           'complete_legacy_bindings', 'complete_admin_audit_log', 'complete_report_admin_events', 'legacy_access_blocks',
                           'legacy_access_events', 'result_resume_links', 'result_link_rate', 'report_deliveries', 'account_report_registrations'] loop
    if to_regclass('public.' || t) is null then raise exception 'missing table %', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('anon', 'public.' || t, 'INSERT')
       or has_table_privilege('anon', 'public.' || t, 'UPDATE') or has_table_privilege('anon', 'public.' || t, 'DELETE') then
      raise exception 'anon has privileges on %', t;
    end if;
  end loop;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'complete\\_%'
              and has_function_privilege('anon', p.oid, 'EXECUTE')) then
    raise exception 'anon can execute a complete_* function';
  end if;
  if to_regprocedure('public.deployment_environment()') is not null then raise exception 'preview function exists'; end if;
end
$post$;
""" + guard(3, 'array[1, 2]', 'after') + LEDGER_INSERT.format(stage=3, name='prod_03_reissue_and_constraints') + """
notify pgrst, 'reload schema';

commit;
"""


def stage4():
    return HEADER.format(
        title='prod_04：登録完了の必須化（切り替え。本番 Production deploy の直前に実行）',
        prereq='prod_03 適用済み。新コードの Production deploy の準備ができていること（この直後に Promote する）',
        rollback='docs/sql/production/prod_94_rollback_04_DRAFT_DO_NOT_RUN.sql',
        notes="""--
-- 内容
--   ・新規登録の既定値を 'required' にする（新しい画面で同意してから保存する）
--   ・登録完了前（required）の利用者の診断保存を DB でも拒否するトリガーを作る
--   ・既存3人（legacy_exempt）と、prod_01〜04 の間に旧画面で登録した人（legacy_exempt）は対象外のまま
-- 注意：この段階の後、新コードの deploy までの間に旧画面で新規登録した人は、新コードが出るまで診断を保存できない。
--       そのため prod_04 は Production deploy（Promote）の直前に実行し、間を空けない。
""") + guard(4, 'array[1, 2, 3]', 'before') + """
alter table public.profiles alter column onboarding_status set default 'required';

create trigger diagnosis_sessions_require_onboarding
  before insert on public.diagnosis_sessions
  for each row execute function public.diagnosis_sessions_require_onboarding();

do $post$
begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status')
     is distinct from '''required''::text' then
    raise exception 'onboarding_status default must be required';
  end if;
  if exists (select 1 from public.profiles where onboarding_status = 'required' and created_at < (select applied_at from element_release.migration_ledger where stage = 1)) then
    raise exception 'profiles created before prod_01 must not be required';
  end if;
end
$post$;
""" + guard(4, 'array[1, 2, 3]', 'after') + LEDGER_INSERT.format(stage=4, name='prod_04_onboarding_required') + """
notify pgrst, 'reload schema';

commit;
"""


# ------------------------------------------------------------------
# rollback 草案（DRAFT_DO_NOT_RUN）
#   ・適用直後で、新しい購入・登録・リンクが 0 件のときだけ戻せる。1件でもあれば止まる
#   ・既存6表の既存列・既存行・旧購入（purchase_entitlements）には触れない
#   ・後の段階から順に戻す（04 → 03 → 02 → 01）。台帳は対象の段階の行だけを消す
# ------------------------------------------------------------------
STAGE2_FUNCS = [
    "public.claim_complete_report_job(p_lease_seconds integer)",
    "public.complete_admin_approve_legacy_binding(p_actor_user_id uuid, p_user_id uuid, p_diagnosis_session_id uuid, p_legacy_entitlement_id uuid, p_incident_id text)",
    "public.complete_admin_audit_log_immutable()",
    "public.complete_admin_legacy_access(p_diagnosis_code_hash text, p_stripe_checkout_session_id text, p_action text, p_reason_code text, p_incident_id text)",
    "public.complete_admin_record_failure(p_actor_user_id uuid, p_action text, p_target_id uuid, p_reason_code text, p_incident_id text)",
    "public.complete_admin_regenerate_report(p_report_id uuid, p_incident_id text)",
    "public.complete_admin_reissue_delivery(p_delivery_id uuid, p_new_link_token_hash text)",
    "public.complete_admin_reject_legacy_binding(p_actor_user_id uuid, p_legacy_entitlement_id uuid, p_reason_code text, p_incident_id text)",
    "public.complete_admin_revoke_delivery(p_delivery_id uuid, p_reason text)",
    "public.complete_analysis_active_for_code_hash(p_code_hash text)",
    "public.complete_apply_checkout_expired(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_checkout_session_id text)",
    "public.complete_apply_dispute(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_payment_intent_id text, p_action text)",
    "public.complete_apply_link_payment(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text, p_amount_total integer, p_currency text, p_payment_status text, p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)",
    "public.complete_apply_payment(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text, p_amount_total integer, p_currency text, p_payment_status text, p_content_version text, p_template_version text, p_content_sha256 text, p_template_sha256 text, p_input_sha256 text)",
    "public.complete_apply_refund(p_event_id text, p_event_created timestamp with time zone, p_livemode boolean, p_order_id uuid, p_payment_intent_id text, p_amount_refunded integer)",
    "public.complete_bind_legacy_purchase(p_user_id uuid, p_diagnosis_session_id uuid, p_legacy_entitlement_id uuid, p_match_method text)",
    "public.complete_cancel_open_order(p_order_id uuid, p_checkout_session_id text)",
    "public.complete_claim_guest_by_email(p_user_id uuid, p_purchase_email_hmac text)",
    "public.complete_claim_guest_record(p_user_id uuid, p_order_id uuid, p_claim_secret_hash text)",
    "public.complete_claim_report(p_report_id uuid, p_lease_seconds integer)",
    "public.complete_close_unopened_order(p_order_id uuid, p_status text, p_failure_code text)",
    "public.complete_create_guest_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text, p_claim_secret_hash text, p_goal_id text)",
    "public.complete_create_guest_record(p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb, p_item_set_version text, p_scoring_version text, p_translation_model_version text, p_character_profile_version text, p_mirror_model_version text)",
    "public.complete_create_link_order(p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text, p_link_token_hash text, p_goal_id text)",
    "public.complete_create_order(p_user_id uuid, p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text)",
    "public.complete_create_order_internal(p_user_id uuid, p_diagnosis_session_id uuid, p_offer text, p_idempotency_key text, p_claim_secret_hash text)",
    "public.complete_create_result_link(p_token_hash text, p_rate_key text, p_answers_v2 jsonb, p_encoded_answers text, p_v2_scores jsonb, p_v2_rankings jsonb, p_mirror_snapshot jsonb, p_item_set_version text, p_scoring_version text, p_translation_model_version text, p_character_profile_version text, p_mirror_model_version text)",
    "public.complete_fail_report(p_report_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean)",
    "public.complete_finish_report(p_report_id uuid, p_lease_token uuid, p_storage_path text, p_output_sha256 text)",
    "public.complete_legacy_bindings_check()",
    "public.complete_legacy_blocked(p_diagnosis_code_hash text)",
    "public.complete_lock_result_group(p_user_id uuid, p_diagnosis_session_id uuid)",
    "public.complete_mark_checkout_open(p_order_id uuid, p_checkout_session_id text, p_expires_at timestamp with time zone)",
    "public.complete_open_result_link(p_token_hash text)",
    "public.complete_orders_no_repurchase()",
    "public.complete_orders_require_eligibility()",
    "public.complete_orders_state_guard()",
    "public.complete_purge_result_links()",
    "public.complete_rc1_required_versions()",
    "public.complete_regenerate_link_report(p_report_id uuid)",
    "public.complete_regenerate_report(p_user_id uuid, p_diagnosis_session_id uuid)",
    "public.complete_register_delivery(p_user_id uuid, p_link_token_hash text)",
    "public.complete_release_mentor_goal_lock(p_user_id uuid, p_diagnosis_session_id uuid)",
    "public.complete_report_final_failure(p_status text, p_attempts integer, p_max_attempts integer, p_next_retry_at timestamp with time zone, p_lease_expires_at timestamp with time zone)",
    "public.complete_report_for_view(p_user_id uuid, p_diagnosis_session_id uuid)",
    "public.complete_result_group(p_user_id uuid, p_diagnosis_session_id uuid)",
    "public.complete_result_group_has(p_user_id uuid, p_diagnosis_session_id uuid, p_kind text)",
    "public.complete_result_key(p_diagnosis_session_id uuid)",
    "public.complete_set_purchase_email(p_order_id uuid, p_purchase_email_hmac text)",
    "public.complete_transfer_guest_record(p_user_id uuid, p_diagnosis_session_id uuid, p_method text)",
    "public.complete_webhook_finish(p_event_id text, p_event_type text, p_livemode boolean, p_event_created timestamp with time zone, p_status text, p_error_code text, p_order_id uuid)",
    "public.complete_webhook_gate(p_event_id text, p_event_type text, p_livemode boolean, p_event_created timestamp with time zone)",
    "public.diagnosis_sessions_owner_immutable()",
    "public.legacy_access_events_immutable()",
    "public.record_entitlements_guard()",
    "public.record_mentor_goals_guard()",
    "public.record_mentor_goals_ownership()"
]
STAGE2_TABLES = ['account_report_registrations', 'report_deliveries', 'complete_report_admin_events', 'stripe_webhook_events',
                 'record_entitlements', 'complete_reports', 'complete_orders', 'complete_legacy_bindings', 'record_mentor_goals',
                 'result_resume_links', 'result_link_rate', 'legacy_access_events', 'legacy_access_blocks', 'complete_admin_audit_log']

RB_HEADER = """-- ============================================================
-- {title}
-- 【DRAFT_DO_NOT_RUN】本番では実行しない。障害時に、別途の承認を得てから使う草案。
-- 生成元：docs/sql/production/build_production_sql.py（手で編集しない）
-- 使える条件：{cond}
--   条件を満たさなければ、冒頭の確認で何も変えずに止まる。
-- 戻した後：旧 main（/api/verify・/api/report-data・save_diagnosis_session）の購入・旧レポート閲覧は動く。
-- 既存6表の既存列・既存行・旧購入（purchase_entitlements の9行）は変更・削除しない。
-- ============================================================

begin;

set local lock_timeout = '5s';

"""


def rb_ledger(stage):
    return f"""do $rb$
begin
  if to_regclass('element_release.migration_ledger') is null then
    raise exception 'ledger missing: nothing to roll back';
  end if;
  if (select max(stage) from element_release.migration_ledger) is distinct from {stage} then
    raise exception 'rollback must be done from the latest stage: latest is %, this file rolls back {stage}', (select max(stage) from element_release.migration_ledger);
  end if;
end
$rb$;
"""


NEW_DATA_GUARD = """do $nodata$
declare
  t text; n bigint;
begin
  foreach t in array array[""" + ", ".join(f"'{t}'" for t in STAGE2_TABLES) + """] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then
      raise exception 'new data exists in % (% rows): do not roll back; handle it as a forward fix', t, n;
    end if;
  end loop;
  if exists (select 1 from public.diagnosis_sessions where user_id is null or guest_created_at is not null) then
    raise exception 'guest diagnosis records exist: do not roll back';
  end if;
end
$nodata$;
"""


def rollback4():
    return RB_HEADER.format(title='prod_94：prod_04（登録完了の必須化）の戻し草案',
                            cond='prod_04 が最新。登録完了前（required）・登録完了済み（completed）の利用者が 0 人') + guard(4, None, 'after') + rb_ledger(4) + """
do $nodata$
begin
  if exists (select 1 from public.profiles where onboarding_status in ('required', 'completed')) then
    raise exception 'new registrations exist (required/completed): do not roll back';
  end if;
end
$nodata$;

drop trigger diagnosis_sessions_require_onboarding on public.diagnosis_sessions;
alter table public.profiles alter column onboarding_status set default 'legacy_exempt';
delete from element_release.migration_ledger where stage = 4;
""" + guard(4, None, 'after') + """
notify pgrst, 'reload schema';

commit;
"""


def rollback3():
    b13 = (SQL / PREVIEW['13']).read_text(encoding='utf-8')
    m = re.search(r'\ncreate or replace function public\.complete_admin_reissue_delivery\(.*?\n\$\$;\n', b13, re.S)
    if not m:
        sys.exit('complete_13 reissue function not found')
    return RB_HEADER.format(title='prod_93：prod_03（管理の再発行）の戻し草案',
                            cond='prod_03 が最新。新しい注文・レポート・リンク・登録が 0 件') + guard(3, None, 'after') + rb_ledger(3) + NEW_DATA_GUARD + """
-- 再発行の関数を prod_02 時点（Preview complete_13）の本文へ戻す
""" + m.group(0).lstrip('\n') + """revoke all on function public.complete_admin_reissue_delivery(uuid, text) from public, anon, authenticated, service_role;
delete from element_release.migration_ledger where stage = 3;
""" + guard(3, None, 'after') + """
notify pgrst, 'reload schema';

commit;
"""


def rollback2():
    drops_t = ''.join(f'drop table public.{t};\n' for t in STAGE2_TABLES)
    drops_f = ''.join(f'drop function {f};\n' for f in STAGE2_FUNCS)
    return RB_HEADER.format(title='prod_92：prod_02（注文・権利・レポート・固有リンク・登録）の戻し草案',
                            cond='prod_02 が最新（prod_03 を先に戻してある）。新しい注文・レポート・リンク・登録・ゲスト記録が 0 件') + guard(2, None, 'after') + rb_ledger(2) + NEW_DATA_GUARD + """
-- 1. diagnosis_sessions に加えたものを外す（既存8行は user_id を持つまま。値は変えない）
drop trigger diagnosis_sessions_owner_immutable on public.diagnosis_sessions;
alter table public.diagnosis_sessions drop constraint diagnosis_sessions_owner_or_guest;
alter table public.diagnosis_sessions drop column guest_created_at;
alter table public.diagnosis_sessions alter column user_id set not null;
comment on column public.diagnosis_sessions.user_id is null;  -- prod_02 が付けた説明を外す（元は説明なし）

-- 2. 新しい表（参照される側を後に。CASCADE は使わない＝想定外の依存があれば止まる）
""" + drops_t + """
-- 3. 新しい関数
""" + drops_f + """
delete from element_release.migration_ledger where stage = 2;
""" + guard(2, None, 'after') + """
do $post$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not in
              ('handle_new_user', 'save_diagnosis_session', 'save_diagnosis_session_v2',
               'complete_registration_onboarding', 'diagnosis_sessions_require_onboarding', 'profiles_guard_consent_columns')) then
    raise exception 'unexpected functions remain after rollback';
  end if;
end
$post$;

notify pgrst, 'reload schema';

commit;
"""


def rollback1():
    return RB_HEADER.format(title='prod_91：prod_01（登録・同意・既存利用者の互換層）の戻し草案',
                            cond='prod_01 が最新（prod_02 以降を先に戻してある）。登録完了・同意・お知らせメール同期の記録が 0 件') + guard(1, None, 'after') + rb_ledger(1) + """
do $nodata$
begin
  if exists (select 1 from public.profiles where onboarding_status <> 'legacy_exempt'
              or onboarding_completed_at is not null or terms_accepted_at is not null or terms_version is not null
              or privacy_accepted_at is not null or privacy_version is not null or newsletter_consent_source is not null
              or newsletter_consent_version is not null or newsletter_sync_status is not null
              or newsletter_sync_attempted_at is not null or newsletter_sync_attempts <> 0) then
    raise exception 'registration or consent records exist: do not roll back';
  end if;
end
$nodata$;

select set_config('element.prod01_applied_at', (select applied_at::text from element_release.migration_ledger where stage = 1), true);

drop trigger profiles_guard_consent_columns on public.profiles;
drop function public.profiles_guard_consent_columns();
drop function public.complete_registration_onboarding(text, text, text);
drop function public.diagnosis_sessions_require_onboarding();
alter table public.profiles
  drop constraint profiles_onboarding_status_check,
  drop constraint profiles_onboarding_completed_check,
  drop constraint profiles_newsletter_sync_status_check,
  drop constraint profiles_newsletter_sync_attempts_check;
alter table public.profiles
  drop column onboarding_required,
  drop column onboarding_status,
  drop column onboarding_completed_at,
  drop column terms_accepted_at,
  drop column terms_version,
  drop column privacy_accepted_at,
  drop column privacy_version,
  drop column newsletter_consent_source,
  drop column newsletter_consent_version,
  drop column newsletter_sync_status,
  drop column newsletter_sync_attempted_at,
  drop column newsletter_sync_attempts;

-- 台帳：stage 1 の行だけを消し、空になった台帳と専用スキーマを外す
delete from element_release.migration_ledger where stage = 1;
do $empty$
begin
  if exists (select 1 from element_release.migration_ledger) then
    raise exception 'ledger is not empty after removing stage 1';
  end if;
end
$empty$;
drop table element_release.migration_ledger;
drop schema element_release;
""" + guard(1, None, 'after') + """
notify pgrst, 'reload schema';

commit;
"""



def readonly_preflight():
    """prod_00：適用前の読み取り確認（何も変えない）。guard と同じ条件を、止めずに一覧で出す。"""
    g = guard(1, None, 'after')
    body = g.split('begin\n', 1)[1].rsplit('\nend\n$guard$;', 1)[0]
    # raise exception を「NG 行の出力」に変えた版：各 if ... then raise ...; end if; を通知へ
    body = re.sub(r"raise exception '([^']*)'(, [^;]*)?;", lambda m: "raise notice 'NG: " + m.group(1).replace('%', '') + "'; v_ng := v_ng + 1;", body)
    return """-- ============================================================
-- prod_00：本番 migration 適用前の読み取り確認（READONLY・何も変更しない）
-- SQL Editor で実行し、最後の行が「preflight: OK（NG 0 件）」であることを確かめる。
-- NG があれば migration を実行しない。出力は確認項目名だけ（個別の値・ID は出さない）。
-- 生成元：docs/sql/production/build_production_sql.py
-- ============================================================
begin read only;

do $pre$
declare
  v_n integer; v_fp text; v_cut timestamptz; v_ng integer := 0;
begin
""" + body + """
  -- 適用状態（どの段階まで当たっているか）
  if to_regclass('element_release.migration_ledger') is not null then
    raise notice 'INFO: ledger stages = %', (select array_agg(stage order by stage) from element_release.migration_ledger);
  else
    raise notice 'INFO: ledger なし（prod_01 未適用）';
  end if;
  if v_ng = 0 then raise notice 'preflight: OK（NG 0 件）'; else raise exception 'preflight: NG % 件（migration を実行しない）', v_ng; end if;
end
$pre$;

rollback;
"""


def readonly_postcheck():
    """prod_81：適用後の読み取り確認（段階ごとの状態・本番制約）。"""
    return """-- ============================================================
-- prod_81：本番 migration 適用後の読み取り確認（READONLY・何も変更しない）
-- 各段階の後に実行する。出力は項目・状態だけ（個別の値・ID は出さない）。
-- あわせて prod_80_invariants_READONLY.sql の出力が適用前と完全に一致することも確かめる。
-- 生成元：docs/sql/production/build_production_sql.py
-- ============================================================
begin read only;

select k, v from (values
  ('ledger.stages', case when to_regclass('element_release.migration_ledger') is null then '(台帳なし)' else (xpath('/row/c/text()', query_to_xml('select array_agg(stage order by stage)::text as c from element_release.migration_ledger', false, true, '')))[1]::text end),
  ('preview.deployment_environment', (to_regprocedure('public.deployment_environment()') is null)::text || ' (true = 無い)'),
  ('preview.constraints', (select count(*)::text from pg_constraint where conname like '%preview%') || ' (0 であること)'),
  ('live.complete_orders', (select count(*)::text from pg_constraint where conname = 'complete_orders_production_live_mode_only') || ' (prod_02 以降 1)'),
  ('live.stripe_webhook_events', (select count(*)::text from pg_constraint where conname = 'stripe_webhook_events_production_live_only') || ' (prod_02 以降 1)'),
  ('live.functions_assume_test', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and (pg_get_functiondef(p.oid) ~ $re$stripe_mode <> 'test'$re$ or pg_get_functiondef(p.oid) ~ 'p_livemode is distinct from false')) || ' (0 であること)'),
  ('consent.accepts_2026_10_21_only', (select case when d is null then '(関数なし)' else (position('2026-10-21' in d) > 0 and d !~ '2026-10-13' and d !~ '2026-10-07([^-]|$)')::text end
       from (select case when to_regprocedure('public.complete_registration_onboarding(text, text, text)') is null then null else pg_get_functiondef(to_regprocedure('public.complete_registration_onboarding(text, text, text)')) end d) x)),
  ('onboarding.default', (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status') || ' (prod_01〜03: legacy_exempt / prod_04 以降: required)'),
  ('onboarding.require_trigger', (select count(*)::text from pg_trigger where tgname = 'diagnosis_sessions_require_onboarding') || ' (prod_04 以降 1)'),
  ('profiles.by_status', case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_status') then '(列なし)'
       else (xpath('/row/c/text()', query_to_xml('select string_agg(onboarding_status || ''='' || n, '','' order by onboarding_status) as c from (select onboarding_status, count(*) n from public.profiles group by 1) x', false, true, '')))[1]::text end),
  ('new_tables.rows', (select coalesce(string_agg(t || '=' || case when to_regclass('public.' || t) is null then '(なし)'
       else (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text end, ',' order by t), '')
       from unnest(array['complete_orders', 'record_entitlements', 'complete_legacy_bindings', 'report_deliveries', 'account_report_registrations', 'legacy_access_blocks']) t)),
  ('api.anon_on_new_tables', (select count(*)::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname not in ('profiles', 'diagnosis_sessions', 'diagnosis_answers', 'diagnosis_results', 'report_snapshots', 'purchase_entitlements')
       and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))) || ' (0 であること)'),
  ('api.anon_exec_complete_functions', (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'complete\\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')) || ' (0 であること)'),
  ('ledger.reachable_from_api', case when to_regnamespace('element_release') is null then '(台帳なし)' else (has_schema_privilege('anon', 'element_release', 'USAGE') or has_schema_privilege('authenticated', 'element_release', 'USAGE') or has_schema_privilege('service_role', 'element_release', 'USAGE'))::text || ' (false であること)' end)
) v(k, v) order by k;

rollback;
"""


OUT = {
    'prod_00_preflight_READONLY.sql': readonly_preflight,
    'prod_81_postcheck_READONLY.sql': readonly_postcheck,
    'prod_01_registration_compat.sql': stage1,
    'prod_02_orders_reports_links.sql': stage2,
    'prod_03_reissue_and_constraints.sql': stage3,
    'prod_04_onboarding_required.sql': stage4,
    'prod_91_rollback_01_DRAFT_DO_NOT_RUN.sql': rollback1,
    'prod_92_rollback_02_DRAFT_DO_NOT_RUN.sql': rollback2,
    'prod_93_rollback_03_DRAFT_DO_NOT_RUN.sql': rollback3,
    'prod_94_rollback_04_DRAFT_DO_NOT_RUN.sql': rollback4,
}

if __name__ == '__main__':
    check = '--check' in sys.argv
    bad = 0
    for name, fn in OUT.items():
        text = fn()
        p = ROOT / name
        if check:
            if not p.exists() or p.read_text(encoding='utf-8') != text:
                print(f'DIFF {name}'); bad = 1
        else:
            p.write_text(text, encoding='utf-8'); print(f'wrote {name} ({len(text.splitlines())} lines)')
    sys.exit(bad)
