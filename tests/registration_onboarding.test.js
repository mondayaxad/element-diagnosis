// 登録完了（利用規約・プライバシーポリシーへの同意とお知らせメール）の処理順のテスト。2026-10-07
// diagnosis-save.js・js/eti_v2_save.js を vm で読み込み、Supabase・/api/subscribe・モーダルはすべて偽物にする。
//   実行: node --test tests/registration_onboarding.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PREVIEW_REF } = require('./fixtures/server_env');

const ROOT = path.join(__dirname, '..');
const SAVE_SRC = fs.readFileSync(path.join(ROOT, 'diagnosis-save.js'), 'utf8');
const V2_SRC = fs.readFileSync(path.join(ROOT, 'js', 'eti_v2_save.js'), 'utf8');

function makeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// opts.status：profiles.onboarding_status（null で行なし）／opts.profileError：読み取り失敗
// opts.choice：モーダルでの選択（'accepted' | 'declined'）／opts.noModal：モーダルの読み込み失敗
// opts.subscribeStatus：/api/subscribe の応答／opts.provider：ログイン方法（記録のためだけ。処理は同じ）
function load(opts = {}) {
  const storage = opts.storage || makeStorage();
  const log = [];
  const profile = opts.status === null ? null : {
    onboarding_status: opts.status || 'required',
    newsletter_sync_status: opts.syncStatus === undefined ? null : opts.syncStatus,
    newsletter_sync_attempts: opts.syncAttempts || 0,
    newsletter_sync_attempted_at: opts.syncAttemptedAt || null,
    newsletter_opted_in: opts.newsletterOptedIn === undefined ? null : opts.newsletterOptedIn,
  };
  let user = opts.signedIn === false ? null : { id: 'user-1', app_metadata: { provider: opts.provider || 'google' } };
  const authCbs = [];
  const profileWrites = [];

  function builder(table) {
    let updating = null;
    const q = {
      select() { return q; }, eq() { return q; }, single() { return q; }, maybeSingle() { return q; },
      update(v) { updating = v; profileWrites.push({ table, v }); return q; },
      then(resolve, reject) {
        let out;
        if (table !== 'profiles') out = { data: null, error: { message: 'unexpected table ' + table } };
        else if (updating) out = { data: null, error: { message: 'consent_columns_read_only' } };
        else if (opts.profileError) out = { data: null, error: { message: 'permission denied' } };
        else if (!profile) out = { data: null, error: { message: 'no rows' } };
        else out = { data: { ...profile }, error: null };
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return q;
  }

  const supabase = {
    createClient: () => ({
      from: builder,
      rpc: async (name, params) => {
        log.push('rpc:' + name);
        if (name === 'complete_registration_onboarding') {
          if (opts.rpcError) return { data: null, error: { message: 'boom' } };
          log.push('rpc_params:' + JSON.stringify(params));
          if (profile && profile.onboarding_status === 'required') {
            profile.onboarding_status = 'completed';
            profile.newsletter_opted_in = true;
            profile.newsletter_sync_status = 'pending';
          }
          return { data: { onboarding_status: profile.onboarding_status, newsletter_sync_status: profile.newsletter_sync_status }, error: null };
        }
        // 保存 RPC：DB 側でも登録完了前は拒否する（migration のトリガーを模す）
        if (profile && profile.onboarding_status === 'required') return { data: null, error: { message: 'onboarding_required' } };
        if (opts.saveError) return { data: null, error: { message: 'boom' } };
        return { data: 'session-id', error: null };
      },
      auth: {
        getUser: async () => ({ data: { user } }),
        getSession: async () => ({ data: { session: user ? { access_token: 'tok-1' } : null } }),
        onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        signOut: async () => { log.push('signOut'); user = null; authCbs.forEach((cb) => cb('SIGNED_OUT', null)); return {}; },
        signInWithOAuth: async () => ({ error: null }),
      },
    }),
  };

  const fetchImpl = async (url, init) => {
    log.push('fetch:' + url);
    const status = opts.subscribeStatus || 200;
    if (url === '/api/subscribe' && profile && status < 300) profile.newsletter_sync_status = 'synced';
    return { ok: status < 300, status, json: async () => ({}) };
  };

  const ctx = {
    console: { error() {}, log() {}, warn() {} },
    localStorage: storage, sessionStorage: makeStorage(), fetch: fetchImpl,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
    gtag: (_e, name) => log.push('ga:' + name), document: { getElementById: () => null },
    location: { origin: 'https://preview.test', hostname: 'preview.test' },
    URLSearchParams, Date, JSON, Promise, Proxy, setTimeout, Number, Object, Array,
    __ED_PUBLIC_CONFIG__: Object.freeze({ appEnv: 'preview', supabaseUrl: `https://${PREVIEW_REF}.supabase.co`, supabaseAnonKey: 'sb_publishable_preview_fake_for_test', projectRef: PREVIEW_REF }),
  };
  ctx.window = ctx;
  ctx.window.supabase = supabase;
  let modalCount = 0;
  if (!opts.noModal) {
    ctx.showRegistrationOnboarding = async ({ onAccept }) => {
      modalCount += 1;
      log.push('modal');
      const choice = typeof opts.choice === 'function' ? opts.choice(modalCount) : (opts.choice || 'accepted');
      if (choice !== 'accepted') return 'declined';
      const r = await onAccept();
      return r && r.ok ? 'accepted' : 'declined';
    };
  }
  vm.createContext(ctx);
  vm.runInContext(SAVE_SRC, ctx, { filename: 'diagnosis-save.js' });
  vm.runInContext(V2_SRC, ctx, { filename: 'eti_v2_save.js' });

  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)); };
  const fire = async (event) => { authCbs.forEach((cb) => cb(event, user ? { access_token: 'tok-1' } : null)); await settle(); };
  const stashV1 = () => vm.runInContext(`stashPendingDiagnosis({q:1}, {primary_result:{}, scores:{}, character_matches:[]}, 'CODE1')`, ctx);
  const stashV2 = () => vm.runInContext(`stashPendingDiagnosisV2(buildPendingV2([1,2], 'CODE2', {personality:{},style:{},values:{},valuesCentered:{},elementRanking:[],weaponRanking:[],nationRanking:[]}, [], 'csid-2'))`, ctx);
  const hasV1 = () => !!storage.getItem('pendingDiagnosis_v1');
  const hasV2 = () => !!storage.getItem('pendingDiagnosis_v2');
  return { ctx, log, storage, profile, profileWrites, fire, settle, stashV1, stashV2, hasV1, hasV2, modalCount: () => modalCount };
}

const idx = (log, entry) => log.findIndex((x) => x.startsWith(entry));
const count = (log, entry) => log.filter((x) => x.startsWith(entry)).length;

for (const provider of ['google', 'x', 'email']) {
  test(`新規（${provider}）：認証 → モーダル → 同意記録 → v1・v2 保存 → /api/subscribe の順`, async () => {
    const h = load({ provider, status: 'required' });
    h.stashV1(); h.stashV2();
    await h.fire('SIGNED_IN');
    assert.equal(h.modalCount(), 1);
    const order = ['modal', 'rpc:complete_registration_onboarding', 'rpc:save_diagnosis_session', 'rpc:save_diagnosis_session_v2', 'fetch:/api/subscribe'].map((e) => idx(h.log, e));
    assert.ok(order.every((i) => i >= 0), JSON.stringify(h.log));
    assert.deepEqual([...order].sort((a, b) => a - b), order, '順序：' + JSON.stringify(h.log));
    const params = JSON.parse(h.log.find((x) => x.startsWith('rpc_params:')).slice('rpc_params:'.length));
    assert.deepEqual(params, { p_terms_version: '2026-10-07', p_privacy_version: '2026-10-07', p_newsletter_consent_version: '2026-10-07-v1' });
    assert.equal(h.hasV1(), false); assert.equal(h.hasV2(), false);
    assert.equal(h.profile.onboarding_status, 'completed');
    assert.equal(h.profileWrites.length, 0, 'ブラウザから profiles を直接書かない');
  });

  test(`既存（${provider}）再ログイン：モーダルを出さず、同意を記録せず、保存だけ行う`, async () => {
    for (const status of ['completed', 'legacy_exempt']) {
      const h = load({ provider, status, syncStatus: status === 'completed' ? 'synced' : null, syncAttempts: status === 'completed' ? 1 : 0, newsletterOptedIn: false });
      h.stashV1();
      await h.fire('SIGNED_IN');
      assert.equal(h.modalCount(), 0, status);
      assert.equal(count(h.log, 'rpc:complete_registration_onboarding'), 0);
      assert.equal(count(h.log, 'rpc:save_diagnosis_session'), 1);
      assert.equal(count(h.log, 'fetch:/api/subscribe'), 0, '既存ユーザーの再ログインで Kit を呼ばない');
      assert.equal(h.profile.newsletter_opted_in, false, '既存ユーザーの newsletter 値は変わらない');
      assert.equal(h.profileWrites.length, 0);
    }
  });
}

test('メールOTP（ページ遷移なし）：保存ボタンからの保存も登録完了を待ち、モーダルは1回だけ', async () => {
  const h = load({ provider: 'email', status: 'required' });
  // verifyOtp 成功 → SIGNED_IN と、保存ボタンの処理（handleSaveResultClick）が同時に走る
  const fired = h.fire('SIGNED_IN');
  const res = await vm.runInContext(`handleSaveResultClick({q:1}, {primary_result:{}, scores:{}, character_matches:[]}, 'CODE1', 'APPLY')`, h.ctx);
  await fired; await h.settle();
  assert.equal(h.modalCount(), 1);
  assert.equal(count(h.log, 'rpc:complete_registration_onboarding'), 1);
  assert.equal(res.ok, true);
  assert.ok(idx(h.log, 'rpc:complete_registration_onboarding') < idx(h.log, 'rpc:save_diagnosis_session'));
  assert.equal(h.hasV1(), false);
});

test('いいえ：サインアウト・保存しない・pending は残す・Kit を呼ばない／次回ログインで再びモーダル', async () => {
  const storage = makeStorage();
  const h = load({ status: 'required', choice: 'declined', storage });
  h.stashV1(); h.stashV2();
  await h.fire('SIGNED_IN');
  assert.equal(h.modalCount(), 1);
  assert.equal(count(h.log, 'signOut'), 1);
  assert.equal(count(h.log, 'rpc:'), 0, JSON.stringify(h.log));
  assert.equal(count(h.log, 'fetch:/api/subscribe'), 0);
  assert.equal(h.hasV1(), true); assert.equal(h.hasV2(), true);
  assert.equal(h.profile.onboarding_status, 'required');
  // 次回ログイン（同じブラウザ）：再びモーダル。今度は同意 → 残っていた pending を保存
  const h2 = load({ status: 'required', choice: 'accepted', storage });
  await h2.fire('SIGNED_IN');
  assert.equal(h2.modalCount(), 1);
  assert.equal(count(h2.log, 'rpc:save_diagnosis_session'), 2); // v1 と v2
  assert.equal(h2.hasV1(), false); assert.equal(h2.hasV2(), false);
});

test('同意後は二度と表示されない（同じページの再通知・再読込後の INITIAL_SESSION）', async () => {
  const h = load({ status: 'required' });
  await h.fire('SIGNED_IN');
  await h.fire('SIGNED_IN');
  await h.fire('INITIAL_SESSION');
  assert.equal(h.modalCount(), 1);
  assert.equal(count(h.log, 'rpc:complete_registration_onboarding'), 1);
  // 再読込（新しいページ）：DB が completed なので出ない
  const h2 = load({ status: 'completed', syncStatus: 'synced', syncAttempts: 1 });
  await h2.fire('INITIAL_SESSION');
  assert.equal(h2.modalCount(), 0);
});

test('二重：SIGNED_IN と INITIAL_SESSION が同時でも、モーダル・同意記録・Kit 同期は1回', async () => {
  const h = load({ status: 'required' });
  h.stashV1();
  await Promise.all([h.fire('INITIAL_SESSION'), h.fire('SIGNED_IN'), h.fire('SIGNED_IN')]);
  assert.equal(h.modalCount(), 1);
  assert.equal(count(h.log, 'rpc:complete_registration_onboarding'), 1);
  assert.equal(count(h.log, 'fetch:/api/subscribe'), 1);
});

test('Kit 障害：登録と診断保存は成功のまま（pending は消える・例外にしない）', async () => {
  for (const subscribeStatus of [502, 503, 500]) {
    const h = load({ status: 'required', subscribeStatus });
    h.stashV1(); h.stashV2();
    await h.fire('SIGNED_IN');
    assert.equal(h.profile.onboarding_status, 'completed');
    assert.equal(h.hasV1(), false); assert.equal(h.hasV2(), false);
    assert.equal(count(h.log, 'fetch:/api/subscribe'), 1);
    assert.ok(h.log.includes('ga:newsletter_subscribe_error'));
  }
});

test('Kit 再送：失敗から24時間未満の再ログインでは呼ばない／24時間以上・3回未満なら呼ぶ', async () => {
  const at = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const recent = load({ status: 'completed', syncStatus: 'failed', syncAttempts: 1, syncAttemptedAt: at(2) });
  await recent.fire('SIGNED_IN');
  assert.equal(count(recent.log, 'fetch:/api/subscribe'), 0);
  const due = load({ status: 'completed', syncStatus: 'failed', syncAttempts: 1, syncAttemptedAt: at(25) });
  await due.fire('SIGNED_IN');
  assert.equal(count(due.log, 'fetch:/api/subscribe'), 1);
  const maxed = load({ status: 'completed', syncStatus: 'failed', syncAttempts: 3, syncAttemptedAt: at(100) });
  await maxed.fire('SIGNED_IN');
  assert.equal(count(maxed.log, 'fetch:/api/subscribe'), 0);
});

test('fail-closed：profiles を読めない・行が無い・値が想定外・モーダルが無いなら、登録済み扱いにせず保存しない', async () => {
  for (const o of [{ profileError: true }, { status: null }, { status: 'weird' }, { status: 'required', noModal: true }]) {
    const h = load(o);
    h.stashV1(); h.stashV2();
    await h.fire('SIGNED_IN');
    assert.equal(count(h.log, 'rpc:'), 0, JSON.stringify(o) + JSON.stringify(h.log));
    assert.equal(count(h.log, 'fetch:/api/subscribe'), 0);
    assert.equal(h.hasV1(), true); assert.equal(h.hasV2(), true);
    const reg = await vm.runInContext('ensureRegistrationComplete()', h.ctx);
    assert.equal(reg.state, 'error', JSON.stringify(o));
  }
});

test('同意の記録に失敗したら登録済み扱いにしない（保存しない・pending は残す）', async () => {
  const h = load({ status: 'required', rpcError: true });
  h.stashV1();
  await h.fire('SIGNED_IN');
  assert.equal(count(h.log, 'rpc:save_diagnosis_session'), 0);
  assert.equal(h.hasV1(), true);
});

test('v2 の保存ボタン：登録完了前に「いいえ」なら保存せず registration=declined を返す', async () => {
  const h = load({ status: 'required', choice: 'declined' });
  const res = await vm.runInContext(`handleSaveResultClickV2([1,2], 'CODE2', {personality:{},style:{},values:{},valuesCentered:{},elementRanking:[],weaponRanking:[],nationRanking:[]}, [], 'csid-9')`, h.ctx);
  assert.equal(res.ok, false);
  assert.equal(res.registration, 'declined');
  assert.equal(count(h.log, 'rpc:save_diagnosis_session_v2'), 0);
  assert.equal(h.hasV2(), true);
});

test('DB 側でも登録完了前の保存は拒否される（onboarding_required を分類する）', async () => {
  const h = load({ status: 'required' });
  const r = await vm.runInContext(`saveDiagnosisSession({diagnosisType:'element',diagnosisVersion:'element-v1',scoringVersion:'s',clientSessionId:'c',completedAt:'t',answers:{},encodedAnswers:'E',results:{primary_result:{},scores:{},character_matches:[]}})`, h.ctx);
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, 'onboarding_required');
});

test('newsletterSyncDue：判定表（legacy_exempt・required は対象外）', () => {
  const h = load({ status: 'completed' });
  const due = (p) => vm.runInContext(`newsletterSyncDue(${JSON.stringify(p)}, Date.now())`, h.ctx);
  const ago = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
  assert.equal(due({ onboarding_status: 'completed', newsletter_sync_status: 'pending', newsletter_sync_attempts: 0 }), true);
  assert.equal(due({ onboarding_status: 'completed', newsletter_sync_status: 'synced', newsletter_sync_attempts: 1 }), false);
  assert.equal(due({ onboarding_status: 'completed', newsletter_sync_status: 'failed', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: ago(23) }), false);
  assert.equal(due({ onboarding_status: 'completed', newsletter_sync_status: 'failed', newsletter_sync_attempts: 2, newsletter_sync_attempted_at: ago(24.1) }), true);
  assert.equal(due({ onboarding_status: 'completed', newsletter_sync_status: 'failed', newsletter_sync_attempts: 3, newsletter_sync_attempted_at: ago(500) }), false);
  assert.equal(due({ onboarding_status: 'legacy_exempt', newsletter_sync_status: null, newsletter_sync_attempts: 0 }), false);
  assert.equal(due({ onboarding_status: 'required', newsletter_sync_status: null, newsletter_sync_attempts: 0 }), false);
});

test('旧仕様の一時保持（pendingNewsletterConsent_v1）は読み込み時に消える', () => {
  const storage = makeStorage();
  storage.setItem('pendingNewsletterConsent_v1', '{"optIn":true}');
  load({ storage });
  assert.equal(storage.getItem('pendingNewsletterConsent_v1'), null);
});

test('画面：index・mypage は登録完了モーダルを diagnosis-save.js の後に読み込む。結果画面にメール案内のチェックボックスは無い', () => {
  for (const f of ['index.html', 'mypage.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const save = html.indexOf('<script src="diagnosis-save.js"></script>');
    const modal = html.indexOf('<script src="js/registration-onboarding.js"></script>');
    assert.ok(save >= 0 && modal > save, f);
    assert.ok(!html.includes('newsletterOptInCheckbox'), f);
    assert.ok(!html.includes('processPendingNewsletterConsent'), f);
  }
});

test('プライバシーポリシー：任意チェックの旧説明が無く、配信内容・Kit・停止方法・版を明記', () => {
  const t = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assert.ok(!t.includes('チェックを入れて同意した場合のみ'));
  assert.ok(!t.includes('同意は任意です'));
  for (const s of ['利用規約とプライバシーポリシーへの同意', '新しい診断', '新しい解析', '関連する商品・企画', 'Kit', '配信メール内のリンクから停止', '2026-10-07']) {
    assert.ok(t.includes(s), s);
  }
  const terms = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
  for (const s of ['メールアドレス（6桁の確認コード）', 'アカウントの登録について', '2026-10-07']) assert.ok(terms.includes(s), s);
});
