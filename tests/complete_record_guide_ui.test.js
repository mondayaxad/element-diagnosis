// 解析購入済みの記録内の完全解析の案内（mypage の LATEST RESULT／THE RECORDS・Preview のみ）のテスト（Playwright）。
// 全読み込み済み記録が対象（最新だけ・最新3件だけに限定しない）。権利・保存データの判定は記録ごと。
// Supabase・/api/my-entitlements・/api/complete-status はすべて差し替え。Stripe・DB・Storage へは接続しない。
// Playwright が無い環境では skip する。
//   実行: node --test tests/complete_record_guide_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const ROOT = path.join(__dirname, '..');
const { pipeFile } = require('./fixtures/serve_file');
const { PREVIEW_ENV, PREVIEW_REF } = require('./fixtures/server_env');
const CE = require('../lib/complete-eligibility');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function publicConfigJs(appEnv, extra) {
  return `window.__ED_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify(Object.assign({
    appEnv, supabaseUrl: PREVIEW_ENV.SUPABASE_URL, supabaseAnonKey: PREVIEW_ENV.SUPABASE_ANON_KEY, projectRef: PREVIEW_REF,
  }, extra || {}))});`;
}
function fakeSupabase(rows) {
  return `window.supabase = { createClient() {
    const user = { id: "user-1", email: "owner@example.test" };
    const rows = ${JSON.stringify(rows)};
    function builder(table) {
      let one = false;
      const q = new Proxy({}, { get(_t, k) {
        if (k === 'then') return (res, rej) => {
          let out;
          if (table === 'diagnosis_sessions') out = { data: one ? (rows[0] || null) : rows, error: null };
          else if (table === 'profiles') out = { data: { onboarding_status: 'completed', newsletter_sync_status: 'synced', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: null }, error: null };
          else out = { data: one ? null : [], error: null };
          return Promise.resolve(out).then(res, rej);
        };
        if (k === 'single' || k === 'maybeSingle') return () => { one = true; return q; };
        return () => q;
      } });
      return q;
    }
    return { from: builder, rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: { access_token: "t" } } }),
        onAuthStateChange(cb) { window.__edAuthCb = cb; return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) } };
  } };`;
}
// 最新版（ETI v2）の記録は正本エンジンで計算した回答・結果から作る
const V2 = (() => {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('this.__make = (k) => { const A = {}; ETI_V2_QUESTIONS.forEach((q, i) => { A[q.id] = ((i * k) % 5) - 2; }); const R = ETIv2.computeResultsV2(A, { elementPrototypes: ELEMENT_PROTOTYPES_V2, weaponPrototypes: WEAPON_PROTOTYPES_V2, nationPrototypes: NATION_PROTOTYPES_V2 }); return { code: ETIv2.encodeAnswersV2(A, ETI_V2_QUESTIONS), R: JSON.parse(JSON.stringify(R)) }; };', ctx);
  return ctx.__make;
})();
function v2Row(id, completedAt, k) {
  const { code, R } = V2(k);
  return {
    code,
    row: { id, user_id: 'user-1', completed_at: completedAt, diagnosis_type: 'element', diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0',
      diagnosis_results: [{ primary_result: {}, scores: {}, character_matches: [], diagnosis_code: code, item_set_version: 'ETI-ITEM-2.0.0', scoring_version: 'ETI-SCORE-2.0.0',
        character_profile_version: 'ETI-CHAR-2.1.0', mirror_model_version: 'ETI-MIRROR-2.1.0',
        v2_scores: { personality: R.personality, style: R.style, values: R.values, valuesCentered: R.valuesCentered },
        v2_rankings: { element: R.elementRanking, weapon: R.weaponRanking, nation: R.nationRanking }, mirror_snapshot: [] }],
      diagnosis_answers: [{ encoded_answers: code }] },
  };
}
const B = v2Row('sess-B', '2026-10-01T10:00:00Z', 7); // 最新：direct ¥3,000
const A = v2Row('sess-A', '2026-09-20T10:00:00Z', 3); // 旧 ¥1,000 購入済み（確認中／固定済み）

function rec(over) {
  return Object.assign({ completeEligible: true, ineligibleReason: null, mentorGoal: null, mentorGoalLocked: false, checkoutInProgress: false,
    completeEntitlement: null, completeStatus: 'none', analysisSource: null, legacyPurchasePending: false, repurchaseBlocked: false }, over || {});
}
const TOKEN = 'Vt0kEnSecretValue_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij';
const purchased = (over) => rec(Object.assign({ completeEntitlement: 'active', completeStatus: 'ready', repurchaseBlocked: true, analysisSource: 'record_entitlement' }, over || {}));

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });
const skip = () => !chromium;
function world(over) {
  return Object.assign({
    appEnv: 'preview',
    rows: [B.row, A.row],
    purchased: {},
    completeLookup: 'ok',
    records: { 'sess-B': purchased(), 'sess-A': rec() },
    statusSeq: {}, // id → [{ code, entitlement, report }]
    postReply: null, // { status, body }
    posts: [], gets: [], viewHits: 0, abortView: false,
  }, over || {});
}
function statusBody(st) {
  return { salesOpen: false, order: { status: 'paid', offer: 'direct_complete', amount: 3000 },
    entitlements: { analysis: st.entitlement === 'active' ? 'active' : null, complete: st.entitlement || null },
    report: st.report ? { status: st.report } : null, mentorGoal: null };
}

async function open(w, opts = {}) {
  const { width = 390, height = 844, query = '', clock = false } = opts;
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [];
  const consoleLines = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => consoleLines.push(m.text()));
  if (clock) await p.clock.install();
  // 販売開始後の表示の確認用：complete-analysis.js の販売中の定数だけ差し替える（サーバー・Stripe には接続しない）
  if (opts.salesOpen) {
    await p.route(/\/complete-analysis\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'complete-analysis.js'), 'utf8')
      .replace('var CA_COMPLETE_API_READY = false;', 'var CA_COMPLETE_API_READY = true;').replace('var CA_COMPLETE_SALES_OPEN = false;', 'var CA_COMPLETE_SALES_OPEN = true;') }));
  }
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(w.rows) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript',
    body: publicConfigJs(w.appEnv, opts.publicSales ? { completeSalesOpen: true, completeApiReady: true } : null) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  // 登録したレポート（complete_13）：この試験では登録なし
  await p.route('**/api/complete-checkout?op=my-reports', (r) => r.fulfill({ contentType: 'application/json', body: '{"reports":[],"records":[]}' }));
  await p.route('**/api/my-entitlements', (r) => {
    w.entitlementHits = (w.entitlementHits || 0) + 1;
    const body = { purchased_by_version: w.purchased };
    if (w.completeLookup) body.completeLookup = w.completeLookup;
    if (w.completeLookup === 'ok') body.records = JSON.parse(JSON.stringify(w.records));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.route('**/api/mentor-goal**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unexpected"}' }));
  await p.route('**/api/complete-status**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    if (u.searchParams.get('view') !== null) {
      w.viewHits++;
      if (w.abortView) return r.fulfill({ status: 204, body: '' }); // 移動しない（元のページに残る）
      return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>complete</title><p id="complete-view">COMPLETE VIEW</p>' });
    }
    if (req.method() === 'GET') {
      const id = u.searchParams.get('diagnosisSessionId');
      w.gets.push({ id, at: Date.now(), auth: req.headers().authorization || null });
      const seq = w.statusSeq[id] || [{ code: 200, entitlement: 'active', report: 'ready' }];
      const st = seq.length > 1 ? seq.shift() : seq[0];
      if (st.code !== 200) return r.fulfill({ status: st.code, contentType: 'application/json', body: JSON.stringify({ error: 'x', incident_id: 'abcdefabcdef' }) });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(statusBody(st)) });
    }
    const body = JSON.parse(req.postData() || '{}');
    w.posts.push({ body, auth: req.headers().authorization || null });
    await new Promise((res) => setTimeout(res, 120));
    if (w.postReply) return r.fulfill({ status: w.postReply.status, contentType: 'application/json', body: JSON.stringify(w.postReply.body) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ viewUrl: `/api/complete-status?view=${TOKEN}`, expiresIn: 300 }) });
  });
  if (opts.routes) await opts.routes(p);
  await p.goto(base + '/mypage.html' + query);
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  await p.evaluate(() => document.querySelectorAll('details.mp-latest-fold, details.mp-rec').forEach((d) => { d.open = true; }));
  p.__errors = errors; p.__console = consoleLines; p.__ctx = ctx;
  return p;
}
// 偽の時計を1秒ずつ進める（確認の通信が実時間で終わるのを待ちながら）

const actions = (p, id, src) => p.locator(`[data-rec-actions="${id}"][data-rec-source="${src}"]`);

// ---- 記録5件：新しい順に sess-1（最新）〜 sess-5。解析の購入（旧 ¥1,000）は diagnosis_code 単位の purchased_by_version で表す
const ROWS = [1, 2, 3, 4, 5].map((k) => v2Row('sess-' + k, `2026-10-0${6 - k}T10:00:00Z`, k + 10));
const ID = (k) => 'sess-' + k;
const codeKey = (k) => 'ETI-2.0:' + ROWS[k - 1].code;
const analysisOnly = (over) => rec(Object.assign({ analysisSource: 'record_entitlement' }, over || {}));
function many(over, recs, purchasedKs) {
  const records = {}; ROWS.forEach((r) => { records[r.row.id] = rec(); });
  Object.assign(records, recs || {});
  const pb = {}; (purchasedKs || []).forEach((k) => { pb[codeKey(k)] = 1; });
  return world(Object.assign({ rows: ROWS.map((r) => r.row), purchased: pb, records }, over || {}));
}
const guide = (p, k, src) => p.locator(`[data-rec-actions="${ID(k)}"]${src ? `[data-rec-source="${src}"]` : ''} [data-ca-guide]`);
const SECRETISH = /checkout\.stripe|buy\.stripe|payment_link/i;
// 決済へ進める操作（有効なボタン・リンク）が案内の中に無いこと（目標の選択の手順は決済ではない）
async function assertNoPayAction(p, k) {
  const g = guide(p, k, 'records');
  assert.equal(await g.locator('a[href]').count(), 0, '決済リンクなし');
  assert.equal(await g.locator('.mp-btn-pending:not([disabled])').count(), 0, '準備中ボタンは常に無効');
  assert.doesNotMatch(await g.innerHTML(), SECRETISH);
}

















test('Stripe で戻った（?complete=canceled）：未払いの決済画面を閉じる（user-reconcile cancel）・URL から印を消す（C3）', { skip: skip() }, async () => {
  const w = many({}, { [ID(5)]: analysisOnly() }, [5]);
  const calls = [];
  const p = await open(w, { query: '?complete=canceled', routes: (pg) => pg.route('**/api/complete-checkout?op=user-reconcile', (r) => {
    calls.push({ body: JSON.parse(r.request().postData() || '{}'), auth: r.request().headers().authorization || '' });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ applied: 0, closed: 1 }) });
  }) });
  assert.deepEqual(calls.map((c) => c.body), [{ cancel: true }]);
  assert.match(calls[0].auth, /^Bearer /);
  assert.equal(await p.evaluate(() => location.search), '');
  await p.__ctx.close();
});

test('支払いから戻った（?complete=returned）：Stripe に問い合わせるだけ（決済画面は閉じない）', { skip: skip() }, async () => {
  const w = many({}, { [ID(5)]: analysisOnly() }, [5]);
  const calls = [];
  const p = await open(w, { query: '?complete=returned', routes: (pg) => pg.route('**/api/complete-checkout?op=user-reconcile', (r) => {
    calls.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ applied: 1, closed: 0 }) });
  }) });
  assert.deepEqual(calls, [{}]);
  await p.__ctx.close();
});

test('決済画面から支払わずに戻った（戻り先を通らない「戻る」・再読み込み）：中止と同じく未払いの決済を閉じる。支払いの戻り先では閉じない', { skip: skip() }, async () => {
  for (const [query, expected] of [['', [{ cancel: true }]], ['?complete=returned', [{}]]]) {
    const w = many({}, { [ID(5)]: analysisOnly() }, [5]);
    const calls = [];
    const p = await open(w, { query, routes: async (pg) => {
      await pg.addInitScript(() => { if (!sessionStorage.getItem('__marked')) { sessionStorage.setItem('ed_mp_checkout_started_v1', '1'); sessionStorage.setItem('__marked', '1'); } });
      await pg.route('**/api/complete-checkout?op=user-reconcile', (r) => {
        calls.push(JSON.parse(r.request().postData() || '{}'));
        r.fulfill({ contentType: 'application/json', body: JSON.stringify({ applied: 0, closed: 1 }) });
      });
    } });
    assert.deepEqual(calls, expected, query || '(戻る)');
    assert.equal(await p.evaluate(() => sessionStorage.getItem('ed_mp_checkout_started_v1')), null, '印は使い終える');
    // 再読み込みでは繰り返さない
    await p.reload();
    await p.waitForSelector('.mp-latest', { state: 'attached' });
    assert.equal(calls.filter((c) => c.cancel).length, query ? 0 : 1, '印の無い再読み込みでは閉じない');
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
  // 印が無ければ（普通に開いた）何もしない
  const w = many({}, { [ID(5)]: analysisOnly() }, [5]);
  let hits = 0;
  const p = await open(w, { routes: (pg) => pg.route('**/api/complete-checkout?op=user-reconcile', (r) => { hits++; r.fulfill({ contentType: 'application/json', body: '{}' }); }) });
  assert.equal(hits, 0);
  await p.__ctx.close();
});

// ================= G5：タブ復帰・戻る・pageshow・スクロール（C7）
const MENTOR_ROUTE = async (p) => {
  await p.route('**/api/mentor-goal**', (r) => {
    if (r.request().method() !== 'GET') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unexpected"}' });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ catalog: CE.MENTOR_CATALOG, eligible: true, ineligibleReason: null, onboardingCompleted: true,
      legacyPurchasePending: false, selection: null, locked: false, checkoutInProgress: false, changeAllowed: true }) });
  });
};
const overflowOf = (p) => p.evaluate(() => [document.documentElement.style.overflow, document.body.style.overflow].join('|'));


test('C7：別の利用者の SIGNED_IN では描き直す。SIGNED_IN が描画中に重なっても描画は重ならない', { skip: skip() }, async () => {
  const w = many({}, { [ID(4)]: analysisOnly() }, [4]);
  const p = await open(w, { salesOpen: true, routes: MENTOR_ROUTE });
  await p.waitForLoadState('networkidle');
  const hits = w.entitlementHits;
  await p.evaluate(() => { window.__edAuthCb('SIGNED_IN', { user: { id: 'user-2' } }); window.__edAuthCb('SIGNED_IN', { user: { id: 'user-2' } }); window.__edAuthCb('SIGNED_IN', null); });
  await p.waitForFunction((h) => window.__mpRecords && document.querySelectorAll('[data-rec-actions]').length > 0, hits);
  // 描き直しは、記録を描く前の引き継ぎの確認（この端末の購入）の後に状態を読む：読みに来るまで待ってから数える
  for (let t = 0; t < 80 && w.entitlementHits === hits; t++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(w.entitlementHits - hits >= 1 && w.entitlementHits - hits <= 2, `描き直しは最大2回（実行中の1回＋後の1回）：${w.entitlementHits - hits}`);
  assert.equal(await p.locator('.mp-latest').count(), 1);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});


// ================= G7：旧版の販売終了・販売中の文言・計測（D4・C9）
test('D4：旧版（legacy-v1）の未購入の記録には購入導線を出さず「対象外・最新の診断へ」の案内。ETI v2 の記録はサーバーの Checkout・320／1280px', { skip: skip() }, async () => {
  for (const width of [320, 1280]) {
    const legacy = JSON.parse(JSON.stringify(ROWS[2].row));
    legacy.diagnosis_version = 'element-v1'; legacy.item_set_version = null; legacy.diagnosis_results[0].item_set_version = null;
    const rowsL = ROWS.map((r) => (r.row.id === ID(3) ? legacy : r.row));
    const w = many({ rows: rowsL, records: Object.fromEntries(ROWS.map((r) => [r.row.id, rec(r.row.id === ID(3) ? { completeEligible: false, ineligibleReason: 'legacy_version' } : {})])) });
    const p = await open(w, { width, publicSales: true });
    const a3 = actions(p, ID(3), 'records');
    assert.equal(await a3.locator('[data-analysis-checkout]').count(), 0);
    assert.equal((await a3.locator('.mp-legacy-retired').innerText()).trim(), 'この結果は現在の解析商品の対象外です。最新の元素診断を受けてください。');
    assert.equal(await actions(p, ID(2), 'records').locator('[data-analysis-checkout]').count(), 1, 'ETI v2 は販売中');
    assert.equal(await p.locator('a[href*="stripe.com"]').count(), 0);
    assert.doesNotMatch(await p.content(), /buy\.stripe\.com/);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), String(width));
    await p.__ctx.close();
  }
});
