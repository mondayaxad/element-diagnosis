// 【実PG17のバックエンド】既存のDB依存試験（COMPLETE_DB_BACKEND）が使う口を、使い捨てのPG17の上で提供する。
//   使い方:  E2E_PG=1 COMPLETE_DB_BACKEND=$PWD/tests/pg/backend.js node --test tests/link_purchase_api.test.js
//            COMPLETE_DB_STRIPE_MODE=live にすると、本番相当（prod_01〜03）の構造・Live モードの注文の制約で流す
//   口: { kind, fetchImpl, calls, failNext(key), user(), record(), legacy(), rows(table), patch(table,id,values), sql(query,params), close() }
'use strict';
const crypto = require('crypto');
const pg = require('./pg_env');
const { createPreviewLikeDb, createProdLikeDb, dropDb } = require('./db_setup');
const { makeFetch, lit, ident } = require('./postgrest_mock');
const CE = require('../../lib/complete-eligibility');

const LIVE = process.env.COMPLETE_DB_STRIPE_MODE === 'live';
const uuid = () => crypto.randomUUID();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function createBackend() {
  if (!pg.enabled()) throw new Error('E2E_PG=1 is required');
  pg.assertSafeTarget();
  const db = LIVE ? createProdLikeDb({ synthetic: false }) : createPreviewLikeDb({ upTo: 99 });
  const users = {}; const tokens = {}; const failures = []; const calls = [];
  const sql = (q) => pg.sql(db, q);
  const take = (key) => { const i = failures.indexOf(key); if (i >= 0) { failures.splice(i, 1); return true; } return false; };
  const inner = makeFetch(db, {
    auth: (t) => users[tokens[t]] || null,
    failures: take,
  });
  const fetchImpl = async (url, opts = {}) => { calls.push({ path: new URL(url).pathname, method: opts.method || 'GET' }); return inner(url, opts); };
  const subst = (q, params = []) => q.replace(/\$(\d+)/g, (_m, n) => { const v = params[Number(n) - 1]; return v === null || v === undefined ? 'null' : lit(v); });
  return {
    kind: 'pg', fetchImpl, calls,
    failNext(key) { failures.push(key); },
    async user({ id = uuid(), email = null, confirmed = true, onboarding = 'completed', token, provider = 'email' } = {}) {
      sql(`insert into auth.users(id) values (${lit(id)}) on conflict do nothing`);
      // 登録完了（completed）は、同意の日時と版が揃っている必要がある（DB の制約）。版は現行の組（2026-10-21）
      const consent = onboarding === 'completed' ? ", onboarding_completed_at = now(), terms_accepted_at = now(), terms_version = '2026-10-21', privacy_accepted_at = now(), privacy_version = '2026-10-21'" : '';
      sql(`update public.profiles set onboarding_status = ${lit(onboarding)}${consent} where id = ${lit(id)}`);
      const now = new Date().toISOString();
      users[id] = { id, email, email_confirmed_at: email && confirmed ? now : null, identities: email ? [{ provider, identity_data: { email, email_verified: confirmed } }] : [{ provider: provider === 'email' ? 'x' : provider, identity_data: {} }] };
      if (token) tokens[token] = id;
      return id;
    },
    async record({ id = uuid(), userId, code = `CODE_${crypto.randomBytes(4).toString('hex')}`, versions = CE.RC1_REQUIRED_VERSIONS, goal = 'GOAL_PACE_01', answers = null, completedAt = new Date().toISOString() }) {
      const saved = answers ? require('../fixtures/report_data').savedRecord(answers) : null;
      const enc = saved ? saved.encoded_answers : code;
      sql(`insert into public.diagnosis_sessions(id, user_id, diagnosis_type, diagnosis_version, scoring_version, client_session_id, completed_at, item_set_version)
           values (${lit(id)}, ${lit(userId)}, 'element', 'ETI-2.0', ${lit(versions.scoring_version)}, ${lit(uuid())}, ${lit(completedAt)}, ${lit(versions.item_set_version)})`);
      const v2 = saved ? `${lit(JSON.stringify(saved.v2_scores))}::jsonb, ${lit(JSON.stringify(saved.v2_rankings))}::jsonb, ${lit(JSON.stringify(saved.mirror_snapshot))}::jsonb` : 'null, null, null';
      sql(`insert into public.diagnosis_results(session_id, primary_result, scores, character_matches, diagnosis_code, diagnosis_version, item_set_version, scoring_version, translation_model_version, character_profile_version, mirror_model_version, v2_scores, v2_rankings, mirror_snapshot)
           values (${lit(id)}, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, ${lit(enc)}, ${lit(versions.diagnosis_version)}, ${lit(versions.item_set_version)}, ${lit(versions.scoring_version)}, ${lit(versions.translation_model_version)}, ${lit(versions.character_profile_version)}, ${lit(versions.mirror_model_version)}, ${v2})`);
      sql(`insert into public.diagnosis_answers(session_id, answers, encoded_answers, answers_v2) values (${lit(id)}, '{}'::jsonb, ${lit(enc)}, ${lit(JSON.stringify(saved ? saved.answers_v2 : {}))}::jsonb)`);
      if (goal) sql(`insert into public.record_mentor_goals(diagnosis_session_id, user_id, goal_catalog_version, goal_id, selected_at) values (${lit(id)}, ${lit(userId)}, ${lit(CE.MENTOR_CATALOG_VERSION)}, ${lit(goal)}, now())`);
      return id;
    },
    async legacy({ code, stripeSessionId }) {
      const id = uuid();
      sql(`insert into public.purchase_entitlements(id, diagnosis_code_hash, stripe_checkout_session_id, stripe_payment_intent_id, product_type, amount, currency, status)
           values (${lit(id)}, ${lit(sha(`v2_${code}`))}, ${lit(stripeSessionId)}, ${lit('pi_legacy_' + crypto.randomBytes(6).toString('hex'))}, 'core1', 1000, 'jpy', 'active')`);
      return id;
    },
    async rows(table) { return JSON.parse(sql(`select coalesce(json_agg(t), '[]'::json) from public.${ident(table)} t`)); },
    async patch(table, id, values) {
      const sets = Object.entries(values).map(([k, v]) => `${ident(k)} = ${v === null ? 'null' : lit(typeof v === 'object' ? JSON.stringify(v) : v)}`).join(', ');
      sql(`update public.${ident(table)} set ${sets} where id = ${lit(id)}`);
    },
    async sql(query, params = []) {
      const q = subst(query, params);
      try {
        // 試験は配列（r[0].r）でも .rows でも読むので、両方で返す。管理者（postgres）の操作として実行する
        const rows = /^\s*(select|with)\b/i.test(q) ? JSON.parse(sql(`select coalesce(json_agg(x), '[]'::json) from (${q.replace(/;\s*$/, '')}) x`)) : (sql(q), []);
        return Object.assign(rows, { rows });
      } catch (e) { throw new Error(String((e && e.stderr) || (e && e.message) || e)); }
    },
    // 長く開いておく接続（begin／lock／commit をまたぐ）。管理者（postgres）として開く
    async session() { return pg.openSession(db); },
    async close() { dropDb(db); },
  };
}
module.exports = { createBackend };
