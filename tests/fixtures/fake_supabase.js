// テスト用の偽の Supabase（Auth・PostgREST・complete_04 の SQL 関数のメモリ上の模型）。外部へは接続しない。
//   ・select は eq.・in.(…)・order=<列>.desc・select=<列,…> だけを解釈する。
//   ・rpc は complete_04 の関数の主な規則を写したもの（正本は SQL。ローカル PG17 の試験では本物の関数で同じ試験を実行する）。
//   ・failNext('rpc:<関数名>' | 'select:<表>' | 'auth') で次の1回を失敗させる（DB・Auth の一時的な失敗）。
'use strict';
const crypto = require('crypto');
const CE = require('../../lib/complete-eligibility');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
class DbError extends Error {}
const raise = (code) => { throw new DbError(code); };

function createMemoryBackend() {
  const t = {
    profiles: [], diagnosis_sessions: [], diagnosis_results: [], diagnosis_answers: [], record_mentor_goals: [],
    purchase_entitlements: [], complete_legacy_bindings: [], complete_orders: [], record_entitlements: [],
    complete_reports: [], stripe_webhook_events: [], complete_admin_audit_log: [],
  };
  const users = {};
  const tokens = {};
  const failures = [];
  const calls = [];

  // ---- complete_04 の模型
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  function gate(id, type, livemode, created) {
    let e = t.stripe_webhook_events.find((x) => x.event_id === id);
    if (!e) { e = { event_id: id, event_type: type, livemode, event_created: created, status: 'received', error_code: null, order_id: null }; t.stripe_webhook_events.push(e); }
    return e.status === 'received' || e.status === 'failed';
  }
  function finish(a) {
    if (!['processed', 'ignored', 'failed'].includes(a.p_status)) raise('complete_invalid_event_status');
    let e = t.stripe_webhook_events.find((x) => x.event_id === a.p_event_id);
    if (!e) { gate(a.p_event_id, a.p_event_type, a.p_livemode, a.p_event_created); e = t.stripe_webhook_events.find((x) => x.event_id === a.p_event_id); }
    if (e.status === 'processed' || (e.status === 'ignored' && a.p_status === 'failed')) return e.status;
    if (a.p_order_id && !t.complete_orders.some((o) => o.id === a.p_order_id)) raise('fk_violation');
    Object.assign(e, { status: a.p_status, error_code: a.p_error_code, order_id: a.p_order_id || e.order_id });
    return a.p_status;
  }
  const fin = (a, type, status, code, orderId) => finish({ p_event_id: a.p_event_id, p_event_type: type, p_livemode: a.p_livemode,
    p_event_created: a.p_event_created, p_status: status, p_error_code: code, p_order_id: orderId });
  const refOf = (s) => {
    const ans = t.diagnosis_answers.find((x) => x.session_id === s.id);
    return ans ? (s.diagnosis_version === 'ETI-2.0' ? `v2_${ans.encoded_answers}` : ans.encoded_answers) : null;
  };
  const RPC = {
    complete_create_order(a) {
      if (!['direct_complete', 'analysis_upgrade'].includes(a.p_offer)) raise('complete_invalid_offer');
      if (!a.p_idempotency_key || a.p_idempotency_key.length < 16) raise('complete_invalid_idempotency_key');
      const s = t.diagnosis_sessions.find((x) => x.id === a.p_diagnosis_session_id && x.user_id === a.p_user_id);
      if (!s) raise('complete_record_not_found');
      const ex = t.complete_orders.find((o) => o.idempotency_key === a.p_idempotency_key);
      if (ex) {
        if (ex.user_id !== a.p_user_id || ex.diagnosis_session_id !== a.p_diagnosis_session_id || ex.offer !== a.p_offer) raise('complete_idempotency_conflict');
        return [{ order_id: ex.id, order_status: ex.status, offer: ex.offer, checkout_session_id: ex.stripe_checkout_session_id, created: false }];
      }
      const mine = t.complete_orders.filter((o) => o.diagnosis_session_id === s.id);
      if (mine.some((o) => ['paid', 'disputed', 'refunded'].includes(o.status))
          || t.record_entitlements.some((e) => e.diagnosis_session_id === s.id && e.right_type === 'complete')) raise('complete_repurchase_not_allowed');
      const pending = mine.find((o) => ['created', 'checkout_open'].includes(o.status));
      if (pending) return [{ order_id: pending.id, order_status: pending.status, offer: pending.offer, checkout_session_id: pending.stripe_checkout_session_id, created: false }];
      const hasRight = t.record_entitlements.some((e) => e.user_id === a.p_user_id && e.diagnosis_session_id === s.id && e.right_type === 'analysis' && e.status === 'active');
      const hasBinding = t.complete_legacy_bindings.some((b) => b.user_id === a.p_user_id && b.diagnosis_session_id === s.id
        && t.purchase_entitlements.some((p) => p.id === b.legacy_entitlement_id && p.status === 'active'));
      let basis = null;
      if (a.p_offer === 'direct_complete') {
        if (hasRight || hasBinding) raise('complete_direct_not_allowed_after_analysis');
        const ref = refOf(s);
        if (ref && t.purchase_entitlements.some((p) => p.status === 'active' && ['core1', 'complete'].includes(p.product_type) && p.diagnosis_code_hash === sha(ref))) {
          raise('complete_legacy_purchase_pending');
        }
      } else if (hasRight) basis = 'record_entitlement';
      else if (hasBinding) basis = 'legacy_purchase_entitlement';
      else raise('complete_upgrade_requires_analysis');
      const goal = t.record_mentor_goals.find((g) => g.diagnosis_session_id === s.id && g.user_id === a.p_user_id);
      if (!goal) raise('complete_mentor_goal_required');
      // 注文トリガー（complete_01）：登録完了・RC1
      const prof = t.profiles.find((p) => p.id === a.p_user_id);
      if (!CE.isOnboardingComplete(prof && prof.onboarding_status)) raise('complete_onboarding_required');
      const r = t.diagnosis_results.find((x) => x.session_id === s.id);
      if (!CE.eligibilityOf(s.diagnosis_version, r || null).eligible) raise('complete_version_not_eligible');
      const o = { id: uuid(), user_id: a.p_user_id, diagnosis_session_id: s.id, offer: a.p_offer, amount: a.p_offer === 'direct_complete' ? 3000 : 2000,
        currency: 'jpy', stripe_mode: 'test', status: 'created', analysis_basis: basis, idempotency_key: a.p_idempotency_key,
        mentor_goal_catalog_version: goal.goal_catalog_version, mentor_goal_id: goal.goal_id, mentor_goal_selected_at: goal.selected_at,
        stripe_checkout_session_id: null, stripe_payment_intent_id: null, last_event_created: null, failure_code: null, created_at: now() };
      t.complete_orders.push(o);
      return [{ order_id: o.id, order_status: 'created', offer: o.offer, checkout_session_id: null, created: true }];
    },
    complete_mark_checkout_open(a) {
      const o = t.complete_orders.find((x) => x.id === a.p_order_id);
      if (!o) raise('complete_order_not_found');
      if (o.stripe_checkout_session_id && o.stripe_checkout_session_id !== a.p_checkout_session_id) raise('complete_checkout_session_mismatch');
      if (o.status === 'checkout_open') return 'noop';
      if (o.status !== 'created') raise('complete_order_not_open');
      Object.assign(o, { status: 'checkout_open', stripe_checkout_session_id: a.p_checkout_session_id, checkout_expires_at: a.p_expires_at });
      return 'applied';
    },
    complete_close_unopened_order(a) {
      const o = t.complete_orders.find((x) => x.id === a.p_order_id);
      if (!o) raise('complete_order_not_found');
      if (o.status === a.p_status) return 'noop';
      if (o.status !== 'created') raise('complete_order_not_open');
      Object.assign(o, { status: a.p_status, failure_code: a.p_failure_code });
      return 'applied';
    },
    complete_bind_legacy_purchase(a) {
      if (!['stripe_email_verified', 'operator_verified'].includes(a.p_match_method)) raise('complete_invalid_match_method');
      const b = t.complete_legacy_bindings.find((x) => x.legacy_entitlement_id === a.p_legacy_entitlement_id);
      if (b) {
        if (b.user_id === a.p_user_id && b.diagnosis_session_id === a.p_diagnosis_session_id) return 'noop';
        raise('complete_legacy_already_bound');
      }
      if (t.complete_legacy_bindings.some((x) => x.diagnosis_session_id === a.p_diagnosis_session_id)) raise('complete_legacy_record_already_bound');
      const s = t.diagnosis_sessions.find((x) => x.id === a.p_diagnosis_session_id && x.user_id === a.p_user_id);
      const ref = s && refOf(s);
      if (!ref) raise('complete_record_not_found');
      const p = t.purchase_entitlements.find((x) => x.id === a.p_legacy_entitlement_id);
      if (!p || p.status !== 'active' || !['core1', 'complete'].includes(p.product_type) || p.diagnosis_code_hash !== sha(ref)) raise('complete_legacy_not_matched');
      t.complete_legacy_bindings.push({ id: uuid(), legacy_entitlement_id: p.id, user_id: a.p_user_id, diagnosis_session_id: s.id, match_method: a.p_match_method });
      return 'applied';
    },
    complete_webhook_finish: finish,
    complete_apply_payment(a) {
      const type = 'checkout.session.completed';
      if (!gate(a.p_event_id, type, a.p_livemode, a.p_event_created)) return 'duplicate';
      const o = t.complete_orders.find((x) => x.id === a.p_order_id);
      if (!o) { fin(a, type, 'ignored', 'order_not_found'); return 'ignored:order_not_found'; }
      const code = a.p_payment_status !== 'paid' ? 'payment_not_paid' : a.p_livemode !== false ? 'livemode_mismatch'
        : a.p_currency !== 'jpy' ? 'currency_mismatch' : a.p_amount_total !== o.amount ? 'amount_mismatch'
          : (o.stripe_checkout_session_id && o.stripe_checkout_session_id !== a.p_checkout_session_id) ? 'checkout_session_mismatch'
            : (o.stripe_payment_intent_id && o.stripe_payment_intent_id !== a.p_payment_intent_id) ? 'payment_intent_mismatch' : null;
      if (code) {
        if (['created', 'checkout_open'].includes(o.status)) Object.assign(o, { status: 'failed', failure_code: code });
        fin(a, type, 'ignored', code, o.id); return `ignored:${code}`;
      }
      if (['paid', 'disputed', 'refunded'].includes(o.status)) { fin(a, type, 'processed', 'noop', o.id); return 'noop'; }
      if (o.status === 'failed') { fin(a, type, 'ignored', 'order_failed', o.id); return 'ignored:order_failed'; }
      const g = t.record_mentor_goals.find((x) => x.diagnosis_session_id === o.diagnosis_session_id && x.user_id === o.user_id);
      if (!g) raise('complete_mentor_goal_missing');
      Object.assign(g, { goal_id: o.mentor_goal_id, locked_at: g.locked_at || now() });
      Object.assign(o, { status: 'paid', stripe_checkout_session_id: a.p_checkout_session_id, stripe_payment_intent_id: a.p_payment_intent_id, last_event_created: a.p_event_created });
      const right = (type2) => t.record_entitlements.push({ id: uuid(), user_id: o.user_id, diagnosis_session_id: o.diagnosis_session_id, right_type: type2, source_order_id: o.id, status: 'active' });
      if (o.offer === 'direct_complete' && !t.record_entitlements.some((e) => e.diagnosis_session_id === o.diagnosis_session_id && e.right_type === 'analysis' && e.status !== 'revoked')) right('analysis');
      right('complete');
      for (const k of ['p_content_sha256', 'p_template_sha256', 'p_input_sha256']) if (!/^[0-9a-f]{64}$/.test(a[k])) raise('check_violation');
      t.complete_reports.push({ id: uuid(), user_id: o.user_id, diagnosis_session_id: o.diagnosis_session_id, source_order_id: o.id, status: 'queued',
        content_version: a.p_content_version, template_version: a.p_template_version, content_sha256: a.p_content_sha256,
        template_sha256: a.p_template_sha256, input_sha256: a.p_input_sha256, mentor_goal_id: o.mentor_goal_id, storage_path: null, created_at: now() });
      fin(a, type, 'processed', null, o.id);
      return 'applied';
    },
    complete_apply_checkout_expired(a) {
      const type = 'checkout.session.expired';
      if (!gate(a.p_event_id, type, a.p_livemode, a.p_event_created)) return 'duplicate';
      const o = t.complete_orders.find((x) => x.id === a.p_order_id);
      if (!o) { fin(a, type, 'ignored', 'order_not_found'); return 'ignored:order_not_found'; }
      if (o.stripe_checkout_session_id && o.stripe_checkout_session_id !== a.p_checkout_session_id) { fin(a, type, 'ignored', 'checkout_session_mismatch', o.id); return 'ignored:checkout_session_mismatch'; }
      if (['created', 'checkout_open'].includes(o.status)) { o.status = 'expired'; fin(a, type, 'processed', null, o.id); return 'applied'; }
      fin(a, type, 'processed', 'noop', o.id); return 'noop';
    },
    complete_apply_refund(a) {
      const type = 'charge.refunded';
      if (!gate(a.p_event_id, type, a.p_livemode, a.p_event_created)) return 'duplicate';
      const o = t.complete_orders.find((x) => x.id === a.p_order_id);
      if (!o) { fin(a, type, 'ignored', 'order_not_found'); return 'ignored:order_not_found'; }
      if (o.stripe_payment_intent_id && o.stripe_payment_intent_id !== a.p_payment_intent_id) { fin(a, type, 'ignored', 'payment_intent_mismatch', o.id); return 'ignored:payment_intent_mismatch'; }
      if (a.p_amount_refunded == null || a.p_amount_refunded < o.amount) { fin(a, type, 'processed', 'partial_refund_recorded', o.id); return 'partial'; }
      if (o.status === 'refunded') { fin(a, type, 'processed', 'noop', o.id); return 'noop'; }
      Object.assign(o, { status: 'refunded', stripe_payment_intent_id: o.stripe_payment_intent_id || a.p_payment_intent_id });
      t.record_entitlements.filter((e) => e.source_order_id === o.id).forEach((e) => { e.status = 'revoked'; });
      t.complete_reports.filter((r) => r.source_order_id === o.id).forEach((r) => { r.status = 'revoked'; });
      fin(a, type, 'processed', null, o.id); return 'applied';
    },
    complete_apply_dispute(a) {
      if (!['opened', 'won', 'lost'].includes(a.p_action)) raise('complete_invalid_dispute_action');
      const type = a.p_action === 'opened' ? 'charge.dispute.created' : 'charge.dispute.closed';
      if (!gate(a.p_event_id, type, a.p_livemode, a.p_event_created)) return 'duplicate';
      const o = t.complete_orders.find((x) => x.id === a.p_order_id);
      if (!o) { fin(a, type, 'ignored', 'order_not_found'); return 'ignored:order_not_found'; }
      if (o.stripe_payment_intent_id && o.stripe_payment_intent_id !== a.p_payment_intent_id) { fin(a, type, 'ignored', 'payment_intent_mismatch', o.id); return 'ignored:payment_intent_mismatch'; }
      if (o.status === 'refunded') { fin(a, type, 'processed', 'noop', o.id); return 'noop'; }
      if (o.status === 'failed') { fin(a, type, 'ignored', 'order_failed', o.id); return 'ignored:order_failed'; }
      // 本物の関数と同じく、例外でイベントの記録を含む全体を取り消す（fetchImpl の取り消し処理）
      if (!['paid', 'disputed'].includes(o.status)) raise('complete_retry_later');
      const rights = t.record_entitlements.filter((e) => e.source_order_id === o.id);
      if (a.p_action === 'opened') {
        if (o.last_event_created && a.p_event_created < o.last_event_created) { fin(a, type, 'processed', 'stale', o.id); return 'stale'; }
        if (o.status === 'disputed') { fin(a, type, 'processed', 'noop', o.id); return 'noop'; }
        o.status = 'disputed'; o.last_event_created = a.p_event_created;
        rights.filter((e) => e.status === 'active').forEach((e) => { e.status = 'suspended'; });
      } else if (a.p_action === 'won') {
        o.status = 'paid'; if (!o.last_event_created || a.p_event_created > o.last_event_created) o.last_event_created = a.p_event_created;
        rights.filter((e) => e.status === 'suspended').forEach((e) => { e.status = 'active'; });
      } else {
        o.status = 'disputed'; if (!o.last_event_created || a.p_event_created > o.last_event_created) o.last_event_created = a.p_event_created;
        rights.forEach((e) => { e.status = 'revoked'; });
        t.complete_reports.filter((r) => r.source_order_id === o.id).forEach((r) => { r.status = 'revoked'; });
      }
      fin(a, type, 'processed', null, o.id); return 'applied';
    },
  };

  function takeFailure(key) {
    const i = failures.indexOf(key);
    if (i < 0) return false;
    failures.splice(i, 1);
    return true;
  }

  function selectFrom(table, params) {
    let rows = t[table] || [];
    let order = null;
    let cols = null;
    for (const [k, v] of params.entries()) {
      if (k === 'select') { cols = v.split(','); continue; }
      if (k === 'order') { order = v; continue; }
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(','); rows = rows.filter((r) => set.includes(String(r[k]))); }
    }
    if (order) {
      const [col, dir] = order.split('.');
      rows = [...rows].sort((x, y) => (x[col] < y[col] ? -1 : x[col] > y[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    return rows.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])) : { ...r }));
  }

  async function fetchImpl(url, opts = {}) {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: opts.method || 'GET' });
    if (u.pathname === '/auth/v1/user') {
      if (takeFailure('auth')) return res(503, {});
      const tok = String((opts.headers && opts.headers.Authorization) || '').replace(/^Bearer /, '');
      const user = users[tokens[tok]];
      return user ? res(200, user) : res(401, { msg: 'invalid' });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice('/rest/v1/rpc/'.length);
      if (takeFailure(`rpc:${fn}`)) throw new TypeError('fetch failed');
      if (!RPC[fn]) return res(404, { message: 'not found' });
      const snapshot = JSON.stringify(t);
      try {
        return res(200, RPC[fn](JSON.parse(opts.body)));
      } catch (err) {
        // 例外は1回の関数呼び出し（1トランザクション）の変更をすべて取り消す
        const restored = JSON.parse(snapshot);
        for (const k of Object.keys(t)) t[k] = restored[k];
        if (err instanceof DbError) return res(400, { code: 'P0001', message: err.message });
        throw err;
      }
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (takeFailure(`select:${table}`)) return res(500, { message: 'boom' });
    return res(200, selectFrom(table, u.searchParams));
  }

  return {
    kind: 'memory',
    fetchImpl,
    calls,
    failNext(key) { failures.push(key); },
    async user({ id = uuid(), email = null, confirmed = true, onboarding = 'completed', token } = {}) {
      users[id] = { id, email, email_confirmed_at: email && confirmed ? now() : null };
      t.profiles.push({ id, onboarding_status: onboarding });
      if (token) tokens[token] = id;
      return id;
    },
    async record({ id = uuid(), userId, code = `CODE_${crypto.randomBytes(4).toString('hex')}`, versions = CE.RC1_REQUIRED_VERSIONS, goal = 'GOAL_PACE_01' }) {
      t.diagnosis_sessions.push({ id, user_id: userId, diagnosis_version: 'ETI-2.0', completed_at: now(), created_at: now() });
      t.diagnosis_results.push({ session_id: id, ...versions });
      t.diagnosis_answers.push({ session_id: id, encoded_answers: code });
      if (goal) t.record_mentor_goals.push({ diagnosis_session_id: id, user_id: userId, goal_catalog_version: CE.MENTOR_CATALOG_VERSION, goal_id: goal, selected_at: now(), locked_at: null });
      return id;
    },
    async legacy({ code, stripeSessionId }) {
      const id = uuid();
      t.purchase_entitlements.push({ id, diagnosis_code_hash: sha(`v2_${code}`), stripe_checkout_session_id: stripeSessionId,
        stripe_payment_intent_id: `pi_legacy_${crypto.randomBytes(6).toString('hex')}`, product_type: 'core1', amount: 1000, currency: 'jpy', status: 'active' });
      return id;
    },
    async rows(table) { return JSON.parse(JSON.stringify(t[table])); },
    async close() {},
  };
}

module.exports = { createMemoryBackend };
