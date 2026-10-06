// diagnosis-save.js のメール配信同意（初期OFF・同意記録・Kit同期の順序・fail-closed）のテスト。
// Supabase・/api/subscribe はすべて偽物。実際のKitリスト・DBには接続しない。
//   実行: node --test tests/newsletter_consent.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'diagnosis-save.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const VERSION = '2026-10-06-v1';

function makeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

// opts.profile：profiles 行（newsletter_opted_in の現在値）。
// opts.profileReadError / updateError / dropVersionOnWrite：同意記録の失敗の再現。
// opts.subscribeStatus：/api/subscribe の応答。opts.signedIn：ログイン状態。
function load(opts = {}) {
  const storage = opts.storage || makeStorage();
  const profile = { newsletter_opted_in: null, ...(opts.profile || {}) };
  const writes = [], fetches = [], events = [], rpcs = [];
  let authCb = null;
  const user = opts.signedIn === false ? null : { id: 'user-1', email: 'owner@example.test' };
  function builder(table) {
    let update = null; let selected = false;
    const q = {
      select() { selected = true; return q; },
      eq() { return q; },
      update(v) { update = v; return q; },
      single() { return q; },
      then(resolve, reject) {
        let out;
        if (table !== 'profiles') out = { data: null, error: { message: 'unexpected table' } };
        else if (update) {
          if (opts.updateError) out = { data: null, error: { message: 'column "newsletter_consent_source" does not exist' } };
          else {
            writes.push(update);
            Object.assign(profile, update);
            const row = { newsletter_opted_in: profile.newsletter_opted_in, newsletter_consent_version: opts.dropVersionOnWrite ? null : profile.newsletter_consent_version };
            out = { data: selected ? row : null, error: null };
          }
        } else if (opts.profileReadError) out = { data: null, error: { message: 'permission denied' } };
        else out = { data: { newsletter_opted_in: profile.newsletter_opted_in }, error: null };
        return Promise.resolve(out).then(resolve, reject);
      },
    };
    return q;
  }
  const supabase = {
    createClient: () => ({
      from: builder,
      rpc: async (name, p) => { rpcs.push(name); return opts.saveError ? { error: { message: 'boom' } } : { data: 'sess', error: null }; },
      auth: {
        getUser: async () => ({ data: { user } }),
        getSession: async () => ({ data: { session: user ? { access_token: 'tok-1' } : null } }),
        onAuthStateChange: (cb) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOAuth: async () => ({ error: null }),
      },
    }),
  };
  const fetchImpl = async (url, init) => {
    fetches.push({ url, init });
    // subscribeStatuses：呼ばれるたびに先頭から使う（Kit 初回失敗 → 次回成功の再現用）
    const status = (opts.subscribeStatuses && opts.subscribeStatuses.length ? opts.subscribeStatuses.shift() : null) || opts.subscribeStatus || 200;
    return { ok: status < 300, status, json: async () => ({}) };
  };
  const ctx = {
    console: { error() {}, log() {}, warn() {} },
    localStorage: storage, fetch: fetchImpl, crypto: { randomUUID: () => 'uuid-1' },
    gtag: (_e, name, p) => events.push([name, p]), document: { getElementById: () => null },
    location: { origin: 'https://preview.test' }, URLSearchParams, Date, JSON, Promise,
  };
  ctx.window = ctx;
  ctx.window.supabase = supabase;
  if (opts.v2Pending) ctx.readPendingDiagnosisV2 = () => ({ any: true });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, storage, profile, writes, fetches, events, rpcs, fireAuth: (e) => authCb && authCb(e, { access_token: 'tok-1' }) };
}

const kitCalls = (h) => h.fetches.filter((f) => f.url === '/api/subscribe');
const plain = (v) => JSON.parse(JSON.stringify(v));

test('index：同意チェックは初期OFF（checked 属性なし）・文言・補足の関連付け', () => {
  const m = /<input type="checkbox" id="newsletterOptInCheckbox"[^>]*>/.exec(INDEX);
  assert.ok(m, 'checkbox exists');
  assert.ok(!/\bchecked\b/.test(m[0]), 'no checked attribute');
  assert.match(m[0], /aria-describedby="newsletterOptInDesc"/);
  assert.ok(INDEX.includes('新しい診断や更新のお知らせをメールで受け取る'));
  assert.ok(INDEX.includes('配信は不定期です。いつでもメール内から停止できます。'));
  assert.ok(INDEX.includes('<label class="rs-optin" for="newsletterOptInCheckbox">'), 'ラベル全体がタップ領域');
  assert.ok(!/\.rs-optin[^{]*\{[^}]*display:\s*none/.test(INDEX), '同意欄を隠すCSSなし');
});

test('未チェック（false）：false を記録し、Kit API を呼ばない', async () => {
  const h = load();
  h.ctx.stashNewsletterConsent(false);
  const r = await h.ctx.processPendingNewsletterConsent();
  assert.deepEqual(plain(r), { ok: true, synced: false });
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].newsletter_opted_in, false);
  assert.equal(h.writes[0].newsletter_consent_source, 'mypage_signup');
  assert.equal(h.writes[0].newsletter_consent_version, VERSION);
  assert.ok(h.writes[0].newsletter_opted_in_at);
  assert.equal(kitCalls(h).length, 0);
  assert.ok(h.events.some(([n]) => n === 'newsletter_opt_out'));
});

test('チェック（true）：同意・日時・source・version を記録してから Kit API を1回だけ呼ぶ（メールは送らない）', async () => {
  const h = load();
  h.ctx.stashNewsletterConsent(true);
  const r = await h.ctx.processPendingNewsletterConsent();
  assert.deepEqual(plain(r), { ok: true, synced: true });
  assert.equal(h.writes[0].newsletter_opted_in, true);
  const calls = kitCalls(h);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok-1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { consentVersion: VERSION });
  assert.ok(!calls[0].init.body.includes('@'));
  // 2回目は一時保持が消えているので何もしない
  await h.ctx.processPendingNewsletterConsent();
  assert.equal(kitCalls(h).length, 1);
  const names = h.events.map(([n]) => n);
  assert.ok(names.includes('newsletter_opt_in') && names.includes('newsletter_subscribe_success'));
  for (const [, p] of h.events) assert.ok(!JSON.stringify(p).includes('@'), 'GA4 にメールを送らない');
});

test('判断済み（true/false）なら上書きせず、Kit も呼ばない', async () => {
  for (const decided of [true, false]) {
    const h = load({ profile: { newsletter_opted_in: decided } });
    assert.equal(await h.ctx.hasDecidedNewsletter(), true, '再表示しない');
    h.ctx.stashNewsletterConsent(!decided);
    const r = await h.ctx.processPendingNewsletterConsent();
    assert.equal(r.skipped, 'already_decided');
    assert.equal(h.writes.length, 0);
    assert.equal(kitCalls(h).length, 0);
  }
  assert.equal(await load().ctx.hasDecidedNewsletter(), false, '未判断なら表示する');
});

test('同意記録の失敗（列が無い・書き戻しを確認できない・読めない）では Kit へ送らない（fail-closed）', async () => {
  for (const o of [{ updateError: true }, { dropVersionOnWrite: true }, { profileReadError: true }]) {
    const h = load(o);
    h.ctx.stashNewsletterConsent(true);
    const r = await h.ctx.processPendingNewsletterConsent();
    assert.equal(r.ok, false, JSON.stringify(o));
    assert.equal(kitCalls(h).length, 0, JSON.stringify(o));
  }
  // 型が boolean でも null でもない値は、型を確認できないとして送らない
  const h = load({ profile: { newsletter_opted_in: 'yes' } });
  h.ctx.stashNewsletterConsent(true);
  assert.equal((await h.ctx.processPendingNewsletterConsent()).reason, 'unexpected_type');
  assert.equal(kitCalls(h).length, 0);
});

test('Kit 同期の失敗：例外にせず、同意記録は残る（画面のエラーにしない）', async () => {
  const h = load({ subscribeStatus: 502 });
  h.ctx.stashNewsletterConsent(true);
  const r = await h.ctx.processPendingNewsletterConsent();
  assert.deepEqual(plain(r), { ok: true, synced: false });
  assert.equal(h.profile.newsletter_opted_in, true);
  assert.ok(h.events.some(([n]) => n === 'newsletter_subscribe_error'));
});

test('保存より先に同意を処理しない（pending の診断が残っている間は待つ）', async () => {
  const h = load({ v2Pending: true });
  h.ctx.stashNewsletterConsent(true);
  assert.equal((await h.ctx.processPendingNewsletterConsent()).skipped, 'save_pending');
  assert.equal(h.writes.length, 0);
  assert.equal(kitCalls(h).length, 0);
  assert.ok(h.storage.getItem('pendingNewsletterConsent_v1'), '選択は保持したまま');
});

test('OAuth 往復：ページを離れても選択が保持され、復帰後に記録される', async () => {
  const storage = makeStorage();
  const before = load({ storage, signedIn: false });
  before.ctx.stashNewsletterConsent(true);
  assert.equal((await before.ctx.processPendingNewsletterConsent()).skipped, 'not_authenticated');
  // 復帰後（別ページ・同じブラウザ保存領域）
  const after = load({ storage });
  const r = await after.ctx.processPendingNewsletterConsent();
  assert.deepEqual(plain(r), { ok: true, synced: true });
  assert.equal(kitCalls(after).length, 1);
});

test('v1 保存：認証復帰後、保存成功 → 同意記録 → Kit同期の順。未チェックでも保存は成功', async () => {
  for (const optIn of [true, false]) {
    const storage = makeStorage();
    const h = load({ storage });
    h.ctx.stashPendingDiagnosis([1, 2], { primary_result: {}, scores: {}, character_matches: [] }, 'code', optIn);
    await h.fireAuth('SIGNED_IN');
    assert.deepEqual(h.rpcs, ['save_diagnosis_session']);
    assert.equal(storage.getItem('pendingDiagnosis_v1'), null, '保存成功');
    assert.equal(h.writes[0].newsletter_opted_in, optIn);
    assert.equal(kitCalls(h).length, optIn ? 1 : 0);
  }
});

test('v1 保存：Kit が失敗しても保存は成功扱い', async () => {
  const storage = makeStorage();
  const h = load({ storage, subscribeStatus: 500 });
  h.ctx.stashPendingDiagnosis([1], { primary_result: {}, scores: {}, character_matches: [] }, 'code', true);
  await h.fireAuth('SIGNED_IN');
  assert.equal(storage.getItem('pendingDiagnosis_v1'), null);
});

test('保存に失敗した間は同意も記録しない', async () => {
  const storage = makeStorage();
  const h = load({ storage, saveError: true });
  h.ctx.stashPendingDiagnosis([1], { primary_result: {}, scores: {}, character_matches: [] }, 'code', true);
  await h.fireAuth('SIGNED_IN');
  assert.ok(storage.getItem('pendingDiagnosis_v1'));
  assert.equal(h.writes.length, 0);
  assert.equal(kitCalls(h).length, 0);
});

test('同時に2回呼ばれても Kit 同期は1回', async () => {
  const h = load();
  h.ctx.stashNewsletterConsent(true);
  await Promise.all([h.ctx.processPendingNewsletterConsent(), h.ctx.processPendingNewsletterConsent()]);
  assert.equal(kitCalls(h).length, 1);
});

// ---- 再試行：DB記録と Kit 同期が完了するまで一時保持を消さない ----
const KEY = 'pendingNewsletterConsent_v1';

test('DB書込失敗・書込確認失敗・読取失敗では一時保持が残り、Kit を呼ばない', async () => {
  for (const o of [{ updateError: true }, { dropVersionOnWrite: true }, { profileReadError: true }]) {
    const h = load(o);
    h.ctx.stashNewsletterConsent(true);
    await h.ctx.processPendingNewsletterConsent();
    assert.ok(h.storage.getItem(KEY), JSON.stringify(o));
    assert.equal(kitCalls(h).length, 0);
  }
});

test('Kit 初回失敗で一時保持が残り、次回呼出しで再試行して成功したら削除する', async () => {
  const storage = makeStorage();
  const first = load({ storage, subscribeStatus: 502 });
  first.ctx.stashNewsletterConsent(true);
  const r1 = await first.ctx.processPendingNewsletterConsent();
  assert.deepEqual(plain(r1), { ok: true, synced: false });
  assert.equal(first.profile.newsletter_opted_in, true, '同意は記録済み');
  assert.ok(storage.getItem(KEY), '保持が残る');
  assert.equal(kitCalls(first).length, 1);
  // 次回（別ページ読込）：DB は既に true、保持も true → Kit 同期の再試行
  const second = load({ storage, profile: { newsletter_opted_in: true, newsletter_consent_version: VERSION } });
  const r2 = await second.ctx.processPendingNewsletterConsent();
  assert.deepEqual(plain(r2), { ok: true, synced: true, retried: true });
  assert.equal(kitCalls(second).length, 1);
  assert.equal(second.writes.length, 0, 'DB は書き直さない');
  assert.equal(storage.getItem(KEY), null, '成功後に削除');
  // さらに次回は何もしない
  assert.equal((await second.ctx.processPendingNewsletterConsent()).skipped, 'no_consent');
  assert.equal(kitCalls(second).length, 1);
});

test('同じページで Kit が失敗 → 再呼出しで成功（保持は成功まで残る）', async () => {
  const h = load({ subscribeStatuses: [500, 200] });
  h.ctx.stashNewsletterConsent(true);
  await h.ctx.processPendingNewsletterConsent();
  assert.ok(h.storage.getItem(KEY));
  const r = await h.ctx.processPendingNewsletterConsent();
  assert.equal(r.retried, true);
  assert.equal(kitCalls(h).length, 2);
  assert.equal(h.storage.getItem(KEY), null);
});

test('再試行中の同時呼出しでも Kit 同期は1回', async () => {
  const h = load({ profile: { newsletter_opted_in: true, newsletter_consent_version: VERSION } });
  h.ctx.stashNewsletterConsent(true);
  await Promise.all([h.ctx.processPendingNewsletterConsent(), h.ctx.processPendingNewsletterConsent(), h.ctx.processPendingNewsletterConsent()]);
  assert.equal(kitCalls(h).length, 1);
});

test('false を記録できた時だけ保持を削除する', async () => {
  const h = load();
  h.ctx.stashNewsletterConsent(false);
  await h.ctx.processPendingNewsletterConsent();
  assert.equal(h.storage.getItem(KEY), null);
  const bad = load({ updateError: true });
  bad.ctx.stashNewsletterConsent(false);
  await bad.ctx.processPendingNewsletterConsent();
  assert.ok(bad.storage.getItem(KEY), '記録できなければ保持');
});

test('DB が false の人を true に変更しない（保持は破棄・Kit なし）', async () => {
  const h = load({ profile: { newsletter_opted_in: false } });
  h.ctx.stashNewsletterConsent(true);
  const r = await h.ctx.processPendingNewsletterConsent();
  assert.equal(r.skipped, 'already_decided');
  assert.equal(h.writes.length, 0);
  assert.equal(h.profile.newsletter_opted_in, false);
  assert.equal(kitCalls(h).length, 0);
  assert.equal(h.storage.getItem(KEY), null);
});

test('配信停止済み（サーバーが再登録しない＝200 not_reactivated）なら再試行を続けない', async () => {
  // /api/subscribe は配信停止済みの人を active へ戻さず 200 を返す（tests/subscribe_api.test.js で検証）
  const h = load({ profile: { newsletter_opted_in: true, newsletter_consent_version: VERSION }, subscribeStatus: 200 });
  h.ctx.stashNewsletterConsent(true);
  await h.ctx.processPendingNewsletterConsent();
  assert.equal(kitCalls(h).length, 1);
  assert.equal(h.storage.getItem(KEY), null, '再試行しない');
  await h.ctx.processPendingNewsletterConsent();
  assert.equal(kitCalls(h).length, 1);
});
