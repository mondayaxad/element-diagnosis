// 完全解析の閲覧（mypage の LATEST RESULT／THE RECORDS）の表示・操作テスト（Playwright）。
// Supabase・/api/my-entitlements・/api/complete-status はすべて差し替え。Stripe・DB・Storage へは接続しない。
// Playwright が無い環境では skip する。
//   実行: node --test tests/complete_view_ui.test.js
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
const { PREVIEW_ENV, PREVIEW_REF } = require('./fixtures/server_env');
const CE = require('../lib/complete-eligibility');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function publicConfigJs(appEnv) {
  return `window.__ED_PUBLIC_CONFIG__ = Object.freeze(${JSON.stringify({
    appEnv, supabaseUrl: PREVIEW_ENV.SUPABASE_URL, supabaseAnonKey: PREVIEW_ENV.SUPABASE_ANON_KEY, projectRef: PREVIEW_REF,
  })});`;
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
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) } };
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
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });
const skip = () => !chromium;

// world：テストごとのサーバーの状態。statusSeq は GET /api/complete-status が順に返す状態（最後の値を繰り返す）
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
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: publicConfigJs(w.appEnv) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('**/api/my-entitlements', (r) => {
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
  await p.goto(base + '/mypage.html' + query);
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  await p.evaluate(() => document.querySelectorAll('details.mp-latest-fold, details.mp-rec').forEach((d) => { d.open = true; }));
  p.__errors = errors; p.__console = consoleLines; p.__ctx = ctx;
  return p;
}
// 偽の時計を1秒ずつ進める（確認の通信が実時間で終わるのを待ちながら）
async function advance(p, ms) {
  for (let t = 0; t < ms; t += 1000) { await p.clock.runFor(Math.min(1000, ms - t)); await new Promise((r) => setTimeout(r, 40)); }
}
const actions = (p, id, src) => p.locator(`[data-rec-actions="${id}"][data-rec-source="${src}"]`);
// 閲覧 URL・トークンがどこにも残っていないか（DOM・属性・Web Storage・GA4・console）
async function assertNoToken(p) {
  const found = await p.evaluate((tok) => {
    const store = (s) => { const out = []; try { for (let i = 0; i < s.length; i++) { const k = s.key(i); out.push(k + '=' + s.getItem(k)); } } catch (e) { /* なし */ } return out.join('\n'); };
    return {
      // トークンそのもの、または属性値に閲覧 URL（view=）を持つ要素（スクリプト本文の検査用の正規表現は対象外）
      dom: document.documentElement.outerHTML.includes(tok)
        || [...document.querySelectorAll('*')].some((el) => [...el.attributes].some((at) => at.value.includes('view='))),
      local: store(localStorage).includes(tok), session: store(sessionStorage).includes(tok),
      ga: JSON.stringify(window.dataLayer || []).includes(tok) || JSON.stringify(window.dataLayer || []).includes('view='),
    };
  }, TOKEN);
  assert.deepEqual(found, { dom: false, local: false, session: false, ga: false });
  assert.ok(!p.__console.some((l) => l.includes(TOKEN) || l.includes('view=')), 'console に出さない');
}

test('ready＋active：LATEST と THE RECORDS の両方に「完全解析を見る」。押した時だけ POST し、同じタブで閲覧 URL へ移動する', { skip: skip() }, async () => {
  const w = world();
  const p = await open(w);
  for (const src of ['latest', 'records']) {
    const box = actions(p, 'sess-B', src);
    assert.equal(await box.locator('[data-ca-view-open]').innerText(), '完全解析を見る');
    assert.doesNotMatch(await box.innerText(), /¥1,000|¥3,000|¥2,000|目標を選ぶ/);
  }
  assert.equal(w.posts.length, 0, '表示しただけでは発行しない');
  // 別の記録（A：権利なし）は従来の導線のまま
  assert.equal(await actions(p, 'sess-A', 'latest').count() + await actions(p, 'sess-A', 'records').locator('[data-ca-view]').count(), 0);
  await Promise.all([p.waitForURL(/\/api\/complete-status\?view=/), actions(p, 'sess-B', 'records').locator('[data-ca-view-open]').click()]);
  assert.equal(await p.locator('#complete-view').innerText(), 'COMPLETE VIEW');
  assert.equal(w.posts.length, 1);
  assert.deepEqual(w.posts[0].body, { diagnosisSessionId: 'sess-B' }, 'この記録の ID だけを送る');
  assert.equal(w.posts[0].auth, 'Bearer t');
  assert.equal(w.viewHits, 1);
  // 同じオリジンの Web Storage にも残っていない
  assert.deepEqual(await p.evaluate(() => [localStorage.length ? Object.keys(localStorage).join() : '', JSON.stringify(sessionStorage)].join('|')).then((s) => s.includes('view=')), false);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('閲覧 URL・トークンを DOM・属性・localStorage・sessionStorage・GA4・console に残さない。連打しても発行は1回', { skip: skip() }, async () => {
  const w = world({ abortView: true }); // 移動を失敗させ、元のページに残る状態で中身を調べる
  const p = await open(w);
  const btn = actions(p, 'sess-B', 'latest').locator('[data-ca-view-open]');
  await btn.click();
  await btn.click({ force: true }).catch(() => {});
  await p.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(w.posts.length, 1, '連打しても1回');
  assert.equal(w.viewHits, 1);
  await assertNoToken(p);
  const ev = await p.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === 'event' && a[1] === 'complete_report_open').map((a) => a[2]));
  // GA4 へ送る場合も出来事だけ（URL・トークン・記録 ID を含めない）
  assert.ok(ev.every((x) => JSON.stringify(x) === JSON.stringify({ source: 'mypage_record' })), JSON.stringify(ev));
  await p.__ctx.close();
});

test('queued／generating：「完全解析を準備しています」。¥1,000・¥3,000 の購入導線を出さない', { skip: skip() }, async () => {
  for (const status of ['queued', 'generating']) {
    const w = world({ records: { 'sess-B': purchased({ completeStatus: status }), 'sess-A': rec() } });
    const p = await open(w);
    for (const src of ['latest', 'records']) {
      const box = actions(p, 'sess-B', src);
      assert.equal(await box.locator('.ca-view-status').innerText(), '完全解析を準備しています');
      assert.equal(await box.locator('[data-ca-view-open]').count(), 0);
      assert.doesNotMatch(await box.innerText(), /¥1,000|¥3,000|¥2,000/);
    }
    assert.equal(w.gets.length, 0, '戻りでなければ自動で確認しない');
    await p.__ctx.close();
  }
});

test('決済からの戻り（complete_return=1）：2秒→3秒→5秒の間隔で確認し、生成中→ready で「完全解析を見る」。URL から戻りの印を消す', { skip: skip() }, async () => {
  const w = world({
    records: { 'sess-B': purchased({ completeStatus: 'generating' }), 'sess-A': rec() },
    statusSeq: { 'sess-B': [{ code: 200, entitlement: 'active', report: 'generating' }, { code: 200, entitlement: 'active', report: 'generating' }, { code: 200, entitlement: 'active', report: 'ready' }] },
  });
  const p = await open(w, { query: '?complete_return=1', clock: true });
  assert.equal(new URL(p.url()).search, '', '戻りの印を消す（再読込で確認を繰り返さない）');
  await p.clock.runFor(1900);
  assert.equal(w.gets.length, 0);
  await p.clock.runFor(200);
  await p.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(w.gets.length, 1, '2秒後に1回目');
  await p.clock.runFor(3000);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(w.gets.length, 2, '3秒後に2回目');
  await p.clock.runFor(5000);
  await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] [data-ca-view-open]');
  assert.equal(w.gets.length, 3, '5秒後に3回目で ready');
  assert.ok(w.gets.every((g) => g.id === 'sess-B' && g.auth === 'Bearer t'));
  await advance(p, 30000);
  assert.equal(w.gets.length, 3, 'ready の後は確認しない');
  assert.equal(w.posts.length, 0, '閲覧 URL は押すまで発行しない');
  await p.__ctx.close();
});

test('戻りの確認は最大60秒で止め、手動の「もう一度確認する」へ（無限に確認しない）。既存の戻り先 complete=returned も同じ', { skip: skip() }, async () => {
  for (const query of ['?complete_return=1', '?complete=returned']) {
    const w = world({ records: { 'sess-B': rec({ checkoutInProgress: true }), 'sess-A': rec() },
      statusSeq: { 'sess-B': [{ code: 200, entitlement: 'active', report: 'generating' }] } });
    const p = await open(w, { query, clock: true });
    await advance(p, 30000);
    assert.match(await actions(p, 'sess-B', 'latest').innerText(), /完全解析を準備しています/);
    await advance(p, 40000);
    await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] [data-ca-view-recheck]');
    const n = w.gets.length;
    assert.ok(n >= 8 && n <= 12, `確認の回数 ${n}`);
    assert.match(await actions(p, 'sess-B', 'latest').innerText(), /準備に時間がかかっています/);
    await advance(p, 120000);
    assert.equal(w.gets.length, n, '60秒の後は自動で確認しない');
    await p.__ctx.close();
  }
});

test('failed／状態取得失敗：「もう一度確認する」。押すと確認し、ready なら「完全解析を見る」へ（フォーカスも移る）', { skip: skip() }, async () => {
  const w = world({ records: { 'sess-B': purchased({ completeStatus: 'failed' }), 'sess-A': rec() } });
  const p = await open(w);
  const box = actions(p, 'sess-B', 'latest');
  assert.equal(await box.locator('[data-ca-view-recheck]').innerText(), 'もう一度確認する');
  assert.doesNotMatch(await box.innerText(), /¥1,000|¥3,000|¥2,000/, '完全解析の権利がある記録に購入導線を出さない');
  await box.locator('[data-ca-view-recheck]').focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] [data-ca-view-open]');
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.dataset.caViewOpen), 'sess-B', 'フォーカスは新しい操作へ');
  assert.equal(await actions(p, 'sess-B', 'records').locator('[data-ca-view-open]').count(), 1, 'THE RECORDS も同期');
  await p.__ctx.close();

  // my-entitlements の完全解析の読み取りに失敗 → 「もう一度確認する」。確認で 503 なら再確認のまま
  const w2 = world({ completeLookup: 'failed', statusSeq: { 'sess-B': [{ code: 503 }] } });
  const p2 = await open(w2);
  await actions(p2, 'sess-B', 'latest').locator('[data-ca-view-recheck]').click();
  await p2.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] .ca-view-note >> text=状態を確認できませんでした');
  assert.equal(await actions(p2, 'sess-B', 'latest').locator('[data-ca-view-recheck]').isDisabled(), false);
  await p2.__ctx.close();
});

test('suspended：「現在、完全解析を閲覧できません」／revoked：「この完全解析は利用できません」。どちらも閲覧ボタン・購入導線なし', { skip: skip() }, async () => {
  for (const [ent, text] of [['suspended', '現在、完全解析を閲覧できません'], ['revoked', 'この完全解析は利用できません']]) {
    const w = world({ records: { 'sess-B': purchased({ completeEntitlement: ent, completeStatus: ent === 'revoked' ? 'revoked' : 'ready' }), 'sess-A': rec() } });
    const p = await open(w);
    for (const src of ['latest', 'records']) {
      const box = actions(p, 'sess-B', src);
      assert.equal(await box.locator('.ca-view-status').innerText(), text);
      assert.equal(await box.locator('[data-ca-view-open]').count(), 0);
      assert.doesNotMatch(await box.innerText(), /¥1,000|¥3,000|¥2,000/);
    }
    await p.__ctx.close();
  }
});

test('押した後の応答：403 は権利の状態を確かめ直して案内、409 は準備中、401 はログイン案内、500／503 は再確認', { skip: skip() }, async () => {
  const click = (p) => actions(p, 'sess-B', 'latest').locator('[data-ca-view-open]').click();
  // 403（発行の直前に dispute で停止）→ GET で suspended を確認して案内
  let w = world({ postReply: { status: 403, body: { error: 'not_entitled' } }, statusSeq: { 'sess-B': [{ code: 200, entitlement: 'suspended', report: 'ready' }] } });
  let p = await open(w);
  await click(p);
  await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] .ca-view-status >> text=現在、完全解析を閲覧できません');
  assert.equal(w.viewHits, 0);
  await p.__ctx.close();
  // 403 で GET も active（取り違え）→ 権利を確認できない旨と再確認
  w = world({ postReply: { status: 403, body: { error: 'not_entitled' } } });
  p = await open(w);
  await click(p);
  await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] .ca-view-note >> text=権利を確認できませんでした');
  await p.__ctx.close();
  // 409（生成物がまだ）→ 準備中にして有限の確認
  w = world({ postReply: { status: 409, body: { error: 'report_not_ready' } }, statusSeq: { 'sess-B': [{ code: 200, entitlement: 'active', report: 'generating' }] } });
  p = await open(w);
  await click(p);
  await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] .ca-view-status >> text=完全解析を準備しています');
  await p.__ctx.close();
  // 401 → ログイン案内（閲覧へは進まない）
  w = world({ postReply: { status: 401, body: { error: 'not_authenticated' } } });
  p = await open(w);
  await click(p);
  await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] [data-ca-view-login]');
  assert.match(await actions(p, 'sess-B', 'latest').innerText(), /ログインの有効期限が切れました/);
  await p.__ctx.close();
  for (const code of [500, 503]) {
    w = world({ postReply: { status: code, body: { error: 'service_unavailable', incident_id: 'abcdefabcdef' } } });
    p = await open(w);
    await click(p);
    await p.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] [data-ca-view-recheck]');
    assert.match(await actions(p, 'sess-B', 'latest').innerText(), /完全解析を開けませんでした/);
    assert.equal(w.viewHits, 0);
    await p.__ctx.close();
  }
});

test('別ユーザー・別の記録：各ボタンは自分の記録の ID だけを送る。サーバーが 404 を返せば移動しない', { skip: skip() }, async () => {
  const w = world({ records: { 'sess-B': purchased(), 'sess-A': purchased() } });
  const p = await open(w, { width: 1280, height: 900 });
  w.abortView = true;
  await actions(p, 'sess-A', 'records').locator('[data-ca-view-open]').click();
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(w.posts.map((x) => x.body.diagnosisSessionId), ['sess-A']);
  await p.__ctx.close();
  // 他人の記録（サーバーで本人の記録と確認できない）→ 404 record_not_found：閲覧へ進まず再確認の表示
  const w2 = world({ postReply: { status: 404, body: { error: 'record_not_found' } } });
  const p2 = await open(w2);
  await actions(p2, 'sess-B', 'latest').locator('[data-ca-view-open]').click();
  await p2.waitForSelector('[data-rec-actions="sess-B"][data-rec-source="latest"] [data-ca-view-recheck]');
  assert.equal(w2.viewHits, 0);
  await assertNoToken(p2);
  await p2.__ctx.close();
});

// 本物の Production（本番ホスト名）はローカルで再現できないため、appEnv が preview 以外（development）で機能フラグが閉じることを確かめる
test('Preview 以外（appEnv が preview でない）では新しい表示を出さず、complete-status を呼ばない', { skip: skip() }, async () => {
  const w = world({ appEnv: 'development', completeLookup: null, records: {} });
  const p = await open(w, { query: '?complete_return=1' });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(await p.locator('[data-ca-view]').count(), 0);
  assert.equal(w.gets.length + w.posts.length, 0);
  assert.ok(await p.locator('.mp-btn-pending').count() >= 1, '従来の準備中ボタンのまま（押せない）');
  assert.equal(await p.locator('.mp-btn-pending').first().isDisabled(), true);
  await p.__ctx.close();
  // Preview でも、my-entitlements が v2 の項目を返さなければ新しい表示を出さない
  const w2 = world({ completeLookup: null });
  const p2 = await open(w2);
  assert.equal(await p2.locator('[data-ca-view]').count(), 0);
  await p2.__ctx.close();
});

test('キーボード：Tab で「完全解析を見る」に到達し、フォーカスが見える。Enter で開く', { skip: skip() }, async () => {
  const w = world();
  const p = await open(w, { width: 1280, height: 900 });
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await p.keyboard.press('Tab');
    reached = await p.evaluate(() => !!(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.caViewOpen));
  }
  assert.ok(reached, 'Tab で到達できる');
  const outline = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, 'none', 'フォーカスが見える');
  await Promise.all([p.waitForURL(/\/api\/complete-status\?view=/), p.keyboard.press('Enter')]);
  assert.equal(w.posts.length, 1);
  await p.__ctx.close();
});

test('320・390・1280px：全状態で横スクロールなし、操作は 44px 以上', { skip: skip() }, async () => {
  const states = [purchased(), purchased({ completeStatus: 'generating' }), purchased({ completeStatus: 'failed' }),
    purchased({ completeEntitlement: 'suspended' }), purchased({ completeEntitlement: 'revoked', completeStatus: 'revoked' })];
  for (const width of [320, 390, 1280]) {
    for (const st of states) {
      const w = world({ records: { 'sess-B': st, 'sess-A': rec() } });
      const p = await open(w, { width, height: 800 });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width} ${st.completeEntitlement}/${st.completeStatus}`);
      const hs = await p.locator('[data-ca-view] button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      assert.ok(hs.every((h) => h >= 44), `${width}: ${hs}`);
      assert.deepEqual(p.__errors, []);
      await p.__ctx.close();
    }
  }
});

test('Checkout のボタンは押せない：販売開始後も、権利なしの記録は目標の選択の導線だけ（決済へのリンクはない）。停止中は無効の準備中', { skip: skip() }, async () => {
  const w = world({ records: { 'sess-B': purchased(), 'sess-A': rec() } });
  const closed = await open(w);
  const ac = actions(closed, 'sess-A', 'records');
  assert.equal(await ac.locator('[data-mentor-open]').count(), 0, '販売停止中は目標を選ぶ操作もない');
  assert.equal(await ac.locator('button.mp-btn-pending').isDisabled(), true);
  await closed.__ctx.close();
  const p = await open(w, { salesOpen: true });
  const a = actions(p, 'sess-A', 'records');
  assert.match(await a.innerText(), /目標を選ぶ/);
  assert.equal(await a.locator('[data-ca-view]').count(), 0);
  assert.equal(await p.locator('a[href*="checkout.stripe.com"], [data-checkout-start]').count(), 0);
  await p.__ctx.close();
});

// 5件以上の記録：購入した記録が新しい順で4件目以降でも、戻りの確認の対象になる
const MANY = ['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5', 'sess-6'].map((id, i) => v2Row(id, `2026-09-${String(28 - i * 3).padStart(2, '0')}T10:00:00Z`, 11 + i * 2));
function manyWorld(records, statusSeq) {
  return world({ rows: MANY.map((x) => x.row), records: Object.assign(Object.fromEntries(MANY.map((x) => [x.row.id, rec()])), records), statusSeq });
}

test('戻りの確認：6件の記録のうち5件目（4件目以降）を購入しても確認し、ready で「完全解析を見る」', { skip: skip() }, async () => {
  const w = manyWorld({ 'sess-5': rec({ checkoutInProgress: true }) },
    { 'sess-5': [{ code: 200, entitlement: null, report: null }, { code: 200, entitlement: 'active', report: 'generating' }, { code: 200, entitlement: 'active', report: 'ready' }] });
  const p = await open(w, { query: '?complete=returned', clock: true, width: 1280, height: 900 });
  await advance(p, 12000);
  await p.waitForSelector('[data-rec-actions="sess-5"][data-rec-source="records"] [data-ca-view-open]');
  assert.deepEqual([...new Set(w.gets.map((g) => g.id))], ['sess-5'], '対象の記録だけを確認する');
  assert.equal(w.gets.length, 3);
  assert.equal(await p.locator('[data-ca-view]').count(), 1, '他の記録は従来の導線のまま');
  await p.__ctx.close();
});

test('戻りの確認：対象が5件あっても同時に確認するのは最大3件。終わった記録の後に残りを確認する', { skip: skip() }, async () => {
  const ready = [{ code: 200, entitlement: 'active', report: 'ready' }];
  const targets = ['sess-2', 'sess-3', 'sess-4', 'sess-5', 'sess-6'];
  const w = manyWorld(Object.fromEntries(targets.map((id) => [id, purchased({ completeStatus: 'generating' })])),
    Object.fromEntries(targets.map((id) => [id, ready.slice()])));
  const p = await open(w, { query: '?complete_return=1', clock: true, width: 1280, height: 900 });
  await advance(p, 2000);
  assert.equal(new Set(w.gets.map((g) => g.id)).size, 3, '最初は3件だけ');
  await advance(p, 3000);
  assert.deepEqual([...new Set(w.gets.map((g) => g.id))].sort(), targets.slice().sort(), '残りの2件も確認する');
  for (const id of targets) await p.waitForSelector(`[data-rec-actions="${id}"][data-rec-source="records"] [data-ca-view-open]`);
  assert.equal(w.gets.length, 5, '各記録1回（ready で終わる）');
  await advance(p, 30000);
  assert.equal(w.gets.length, 5);
  await p.__ctx.close();
});
