// 使い捨てのデータベース（e2e_*）を、本番（akivoob）相当の構造で作る。合成データだけを入れる。
//   baseline_archive 0001〜0007（構造）＋ Supabase の代用品 ＋ prod_01〜03（本番専用 migration）＋ complete_17 ＋ 合成データ。
//   本番の「購入の集計指紋」2行だけ、合成データ用の値に差し替えて適用する（docs/sql/production/local_check/mkcopies.sh と同じ規則。差し替え以外の変更は無い）。
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('./pg_env');

const ROOT = path.join(__dirname, '..', '..');
const BASE = path.join(ROOT, 'docs', 'sql', 'baseline_archive_20261006');
const PROD = path.join(ROOT, 'docs', 'sql', 'production');
const SWAP = [['30665072821e4cafb1fe85fc56f4dc96', '97e7de0aa4e87b92d44f8424422c792c'], ['a5bc637c700f585024be751b912db9b6', '8b7054e5f23e3f805953e3cf55c8a85a']];

// ロールはクラスター全体で共有される。試験ファイルが並行して DB を作っても競合しないよう、重複エラーを受け流して先に作っておく
//   （00_supabase_stub.sql は「無い時だけ作る」ので、先にあれば何もしない）
const ENSURE_ROLES = `do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','supabase_auth_admin'] loop
    begin
      if r = 'service_role' then execute 'create role service_role nologin bypassrls'; else execute format('create role %I nologin', r); end if;
    exception when duplicate_object or unique_violation then null; end;
  end loop; end $$;`;

// 本番（Supabase）の既定権限の再現（pg_default_acl の postgres 分。local_check/harness.sh の mkprod と同じ）
const DEFAULT_PRIVS = `
  alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public revoke execute on functions from public;
  alter default privileges for role postgres in schema public revoke all on sequences from public;`;

function swapFingerprint(text) {
  let out = text;
  for (const [from, to] of SWAP) out = out.split(from).join(to);
  return out;
}

// 本番に適用する migration の段階（docs/sql/production/README.md）。既定は従来どおり 01〜03（旧版購入権の試験が前提にする構造）
const PROD_STAGES_BASE = ['01_registration_compat', '02_orders_reports_links', '03_reissue_and_constraints'];
// 本番の現状（prod_01〜04b と、邪眼の prod_06）。アプリの DB 試験を Live（本番相当）で流す時に使う
const PROD_STAGES_ALL = [...PROD_STAGES_BASE, '04a_onboarding_required_state', '04b_onboarding_enforcement', '06_jagan'];
// 合成データ（synthetic_data.sql）が入れる行。clearData で空にする（README：「prod_01〜04b を当てた DB をテンプレートにし、合成の既存データは空にする」）
const SYNTHETIC_TABLES = ['public.purchase_entitlements', 'public.diagnosis_answers', 'public.diagnosis_results', 'public.diagnosis_sessions', 'auth.identities', 'auth.users'];

// synthetic：合成の既存データを入れる（本番 migration の冒頭の確認が「既存の旧購入9行」などを前提にするため、本番の段階を当てる時は必須）
// stages：当てる本番の段階（既定は 01〜03）。clearData：段階を当てた後に、合成の既存データを空にする（アプリ試験を空の本番相当の DB で始める）
function createProdLikeDb({ withComplete17 = true, synthetic = true, stages = PROD_STAGES_BASE, clearData = false } = {}) {
  pg.assertSafeTarget();
  const db = pg.newDbName();
  pg.sql('postgres', `create database ${db}`);
  const run = (file) => pg.sqlFile(db, file);
  pg.sqlText(db, ENSURE_ROLES);
  run(path.join(BASE, 'restore_tools', '00_supabase_stub.sql'));
  // 本番相当の追加の代用品（auth.identities・storage）と既定権限は、local_check/harness.sh の mkprod と同じ
  pg.sqlText(db, `
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text);
    grant select on auth.identities to supabase_auth_admin;
    create schema storage;
    create table storage.buckets(id text primary key, name text);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);`);
  for (const f of fs.readdirSync(BASE).filter((x) => /^000[1-7].*\.sql$/.test(x)).sort()) run(path.join(BASE, f));
  pg.sqlText(db, DEFAULT_PRIVS);
  if (synthetic) {
    run(path.join(PROD, 'local_check', 'synthetic_data.sql'));
    pg.sqlText(db, "insert into auth.identities(user_id, provider) select id, 'email' from auth.users;");
  }
  if (clearData && !synthetic) throw new Error('clearData requires synthetic data (the production stages check the existing rows first)');
  const applyStage = (stage) => pg.sqlText(db, swapFingerprint(fs.readFileSync(path.join(PROD, `prod_${stage}.sql`), 'utf8')));
  try {
    for (const stage of stages.filter((x) => PROD_STAGES_BASE.includes(x))) applyStage(stage);
    if (withComplete17) run(path.join(ROOT, 'docs', 'sql', '20261029120000_complete_17_legacy_link_binding.sql'));
    for (const stage of stages.filter((x) => !PROD_STAGES_BASE.includes(x))) applyStage(stage);
    // 監査の表（legacy_access_events など）は本番で TRUNCATE・削除を禁止するトリガーを持つ。使い捨ての DB を試験の初期状態に
    //   するこの1回だけ、トリガーを止めて（session_replication_role = replica・この接続だけ）合成データとその派生行を空にする
    if (clearData) pg.sqlText(db, `set session_replication_role = replica; truncate ${SYNTHETIC_TABLES.join(', ')} cascade; reset session_replication_role;`);
  } catch (e) { dropDb(db); throw e; } // 失敗しても使い捨てDBを残さない
  return db;
}
// Preview（Test モード）相当：baseline 0001〜0008（0008 は Preview 専用の設定）＋ docs/sql/2026*.sql を番号順に適用する。
//   既存のDB依存試験（COMPLETE_DB_BACKEND）が前提にする「complete_01〜NN」の構造。upTo に最後の番号（例 13）を渡すと、そこまで適用する。
function createPreviewLikeDb({ upTo = 99 } = {}) {
  pg.assertSafeTarget();
  const db = pg.newDbName();
  pg.sql('postgres', `create database ${db}`);
  const run = (file) => pg.sqlFile(db, file);
  pg.sqlText(db, ENSURE_ROLES);
  run(path.join(BASE, 'restore_tools', '00_supabase_stub.sql'));
  pg.sqlText(db, `
    create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text);
    grant select on auth.identities to supabase_auth_admin;
    create schema storage;
    create table storage.buckets(id text primary key, name text);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);`);
  for (const f of fs.readdirSync(BASE).filter((x) => /^000[1-8].*\.sql$/.test(x)).sort()) run(path.join(BASE, f));
  pg.sqlText(db, DEFAULT_PRIVS);
  // Preview の migration は Supabase CLI の台帳（supabase_migrations.schema_migrations）に自分を記録する
  pg.sqlText(db, 'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);');
  const dir = path.join(ROOT, 'docs', 'sql');
  try {
    // 登録・同意の migration（onboarding_01）は complete_01〜 の前提なので常に含める。complete_NN は upTo まで
    for (const f of fs.readdirSync(dir).filter((x) => /^2026\d{10}_(complete_\d+|onboarding_\d+)_.*\.sql$/.test(x)).sort()) {
      const c = /_complete_(\d+)_/.exec(f);
      if (!c || Number(c[1]) <= upTo) run(path.join(dir, f));
    }
  } catch (e) { dropDb(db); throw e; } // 失敗しても使い捨てDBを残さない
  return db;
}
function dropDb(db) {
  pg.assertTestDb(db);
  pg.sql('postgres', `drop database if exists ${db} with (force)`);
}
module.exports = { createProdLikeDb, createPreviewLikeDb, dropDb, PROD_STAGES_BASE, PROD_STAGES_ALL };
