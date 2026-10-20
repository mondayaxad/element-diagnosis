// 最終統合仕様（complete_13）の画面の試験（Playwright）：診断結果・サンプル・購入完了・レポート固有リンク・マイページ（表14）・
// マイページへの登録・解析レポートの最下部・OTP・画面幅（320・390・1280px）。
// API（/api/complete-checkout?op=…）・Supabase・Stripe はすべて差し替え。外部へは接続しない。
//   実行: node --test tests/report_purchase_ui.test.js
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
const skip = () => (chromium ? false : 'playwright がありません');
const ROOT = path.join(__dirname, '..');
const { previewPublicConfigJs } = require('./fixtures/server_env');
const CE = require('../lib/complete-eligibility');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const RESUME = 'Rz0kEnSecretValueForResumeLink_ABCDEFGHIJKL'; // 診断結果の固有リンク（43文字）
const LINK_A = 'LinkTokenForAnalysisReport_0123456789abcdef'; // レポート固有リンク（43文字）
const LINK_B = 'LinkTokenForCompleteReport_0123456789abcdef';
const CTX = 'PurchaseContextToken_' + 'x'.repeat(60); // 購入対象トークン（60〜200文字）
const VERSIONS = { itemSetVersion: 'ETI-ITEM-2.0.0', scoringVersion: 'ETI-SCORE-2.0.0', translationModelVersion: 'ETI-TRANS-2.0.0',
  characterProfileVersion: 'ETI-CHAR-2.1.0', mirrorModelVersion: 'ETI-MIRROR-2.1.0' };
const GOALS = { salesOpen: true, catalog: CE.MENTOR_CATALOG };
const SUMMARY = { diagnosedOn: '2026-10-20', element: '風', weapon: '弓', nation: 'モンド', mirror: 'ウェンティ' };
const PRICE_RE = /¥\s?[0-9,]+/g;

// 最新版（ETI v2）の記録（保存時と同じ形）
const V2 = (() => {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('this.__make = (k) => { const A = {}; ETI_V2_QUESTIONS.forEach((q, i) => { A[q.id] = ((i * k) % 5) - 2; }); const R = ETIv2.computeResultsV2(A, { elementPrototypes: ELEMENT_PROTOTYPES_V2, weaponPrototypes: WEAPON_PROTOTYPES_V2, nationPrototypes: NATION_PROTOTYPES_V2 }); return { code: ETIv2.encodeAnswersV2(A, ETI_V2_QUESTIONS), R: JSON.parse(JSON.stringify(R)) }; };', ctx);
  return ctx.__make;
})();
function v2Row(id, completedAt, k, userId = 'user-1') {
  const { code, R } = V2(k);
  return { id, user_id: userId, completed_at: completedAt, diagnosis_type: 'element', diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0',
    diagnosis_results: [{ primary_result: {}, scores: {}, character_matches: [], diagnosis_code: code, item_set_version: 'ETI-ITEM-2.0.0', scoring_version: 'ETI-SCORE-2.0.0',
      character_profile_version: 'ETI-CHAR-2.1.0', mirror_model_version: 'ETI-MIRROR-2.1.0',
      v2_scores: { personality: R.personality, style: R.style, values: R.values, valuesCentered: R.valuesCentered },
      v2_rankings: { element: R.elementRanking, weapon: R.weaponRanking, nation: R.nationRanking }, mirror_snapshot: [] }],
    diagnosis_answers: [{ encoded_answers: code }] };
}
const REC_ID = '22222222-2222-4222-8222-222222222222';
const REC_ROW = v2Row(REC_ID, '2026-10-01T10:00:00Z', 7);

function fakeSupabase({ signedIn, rows }) {
  return `window.supabase = { createClient() {
    const user = ${signedIn ? '{ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test" }' : 'null'};
    const rows = ${JSON.stringify(rows || [])};
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
      auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: user ? { access_token: "tok-user", user } : null } }),
        signInWithOtp: async () => (window.__otpSend ? window.__otpSend() : { error: null }),
        verifyOtp: async (a) => { (window.__otpTried = window.__otpTried || []).push(a.token); return window.__otpVerify ? window.__otpVerify(a) : { error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' } }; },
        onAuthStateChange(cb) { window.__edAuthCb = cb; return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) } };
  } };`;
}

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname === '/result' ? '/index.html' : u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

// api：op ごとの応答（関数なら body を受け取って [status, json]）
async function open(url, { width = 390, api = {}, signedIn = false, rows = [], salesOpen = true, init = null, entitlements = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [];
  const calls = [];
  const consoleLines = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => consoleLines.push(m.text()));
  await ctx.addInitScript(() => { window.__ev = []; window.gtag = function () { window.__ev.push(Array.from(arguments)); }; });
  if (init) await ctx.addInitScript(init);
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs(salesOpen ? { completeSalesOpen: true, completeApiReady: true } : { completeApiReady: true }) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager|jsdelivr/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  // supabase-js の代用品は CDN の空の応答より後に登録する（後から登録した route が先に使われる）
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase({ signedIn, rows }) }));
  await p.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(entitlements || { purchased_by_version: {}, completeLookup: 'ok', records: {}, result_states: {} }) }));
  await p.route('**/api/complete-checkout?op=*', (r) => {
    const req = r.request();
    const op = new URL(req.url()).searchParams.get('op');
    const body = JSON.parse(req.postData() || '{}');
    calls.push({ op, body, url: req.url(), auth: req.headers().authorization || '' });
    const h = api[op];
    const [status, json] = typeof h === 'function' ? h(body) : h || [404, { error: 'not_found' }];
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  await p.goto(base + url);
  p.__ctx = ctx; p.__errors = errors; p.__calls = calls; p.__console = consoleLines;
  return p;
}
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const BUY_OK = (b) => [200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', product: b.product }];
const RESULT_API = (extra) => Object.assign({
  'result-open': (b) => (b.token === RESUME ? [200, { code: V2(7).code, diagnosisVersion: 'ETI-2.0', versions: VERSIONS }] : [404, { error: 'result_not_found' }]),
  'buy-context': [200, { context: CTX, summary: SUMMARY, eligible: { analysis: true, complete: true } }],
  'guest-goals': [200, GOALS],
  buy: BUY_OK,
}, extra || {});
async function resultPage(opts = {}) {
  const p = await open('/result#r=' + RESUME, { ...opts, api: RESULT_API(opts.api) });
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'visible' });
  await p.waitForSelector('[data-buy-complete]', { state: 'attached' });
  // 完全解析の欄（折りたたみ）を開いておく
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  return p;
}
function assertNoSecrets(p, secrets) {
  const ev = JSON.stringify(p.__ev || []);
  for (const s of secrets) {
    assert.ok(!ev.includes(s), 'GA4 に秘密値を出さない');
    assert.ok(!p.__console.some((l) => l.includes(s)), 'console に秘密値を出さない');
    assert.ok(p.__calls.every((c) => !c.url.includes(s)), 'API の URL に秘密値を入れない（本文だけ）');
  }
}

// ================= 診断結果ページ
test('診断結果：A ¥1,000・B ¥3,000 を常に出し、A は購入対象トークンと商品だけで op=buy。同じタブで Stripe へ（コード・記録 ID を送らない）', { skip: skip() }, async () => {
  for (const signedIn of [false, true]) {
    const p = await resultPage({ signedIn });
    const html = await p.locator('body').innerText();
    assert.match(html, /完全解析　全46ページ　¥3,000/);
    // ブラウザの履歴・タブで自分の結果を見分けられる題名（元素×武器×国家・タイプ名）
    assert.match(await p.title(), /^診断結果 .+×.+×.+・.+（[A-Z]{4}-[A-Z]）｜元素診断$/);
    assert.match(html, /解析レポートのサンプルを見る/);
    assert.doesNotMatch(html, /¥2,000|追加 ?¥|アップグレード/);
    await p.waitForFunction(() => !document.querySelector('#lockUnlockAllBtn').disabled);
    await p.click('#lockUnlockAllBtn');
    await p.waitForURL(/checkout\.stripe\.com/);
    const buy = p.__calls.filter((c) => c.op === 'buy');
    assert.equal(buy.length, 1);
    assert.deepEqual(Object.keys(buy[0].body).sort(), ['attempt', 'context', 'product', 'source']);
    assert.equal(buy[0].body.product, 'analysis');
    assert.equal(buy[0].body.context, CTX);
    assert.match(buy[0].body.attempt, /^[A-Za-z0-9_-]{24}$/);
    assert.doesNotMatch(JSON.stringify(buy[0].body), UUID_RE);
    assert.ok(!JSON.stringify(buy[0].body).includes(V2(7).code), '診断コードを送らない');
    // 購入対象トークンは、診断結果の固有リンク（本文）から作る
    assert.deepEqual(p.__calls.filter((c) => c.op === 'buy-context').map((c) => c.body), [{ resume: RESUME }]);
    assertNoSecrets(p, [RESUME, CTX]);
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('診断結果：B は共通の MENTOR 目標の選択を通ってから op=buy（目標は注文に固定）。購入前に「別商品・本文は含まれない」を示す。やめると決済しない', { skip: skip() }, async () => {
  const p = await resultPage();
  assert.match(await p.locator('body').innerText(), /完全解析は、解析レポートとは異なる内容を扱う別商品です。解析レポートの本文は含まれません。/);
  await p.click('[data-buy-complete]');
  await p.waitForSelector('.edb-dialog input[name="edb-goal"]');
  assert.match(await p.locator('.edb-dialog').innerText(), /解析レポートの本文は含まれません/);
  await p.click('[data-edb-cancel]');
  assert.equal(await p.locator('.edb-dialog').count(), 0);
  assert.equal(p.__calls.filter((c) => c.op === 'buy').length, 0, 'やめると申し込まない');
  await p.click('[data-buy-complete]');
  await p.waitForSelector('.edb-dialog input[name="edb-goal"]');
  assert.equal(await p.locator('[data-edb-go]').isDisabled(), true, '選ぶまで押せない');
  const goal = await p.locator('.edb-dialog input[name="edb-goal"]').first().getAttribute('value');
  await p.locator('.edb-dialog input[name="edb-goal"]').first().check();
  await p.click('[data-edb-go]');
  await p.waitForURL(/checkout\.stripe\.com/);
  const buy = p.__calls.filter((c) => c.op === 'buy');
  assert.deepEqual([buy.length, buy[0].body.product, buy[0].body.goal], [1, 'complete', goal]);
  await p.__ctx.close();
});

test('診断結果：サンプルへは同じタブ・購入対象トークンはフラグメント（クエリ・UUID・コードなし）。販売停止中は押せない「準備中」', { skip: skip() }, async () => {
  const p = await resultPage();
  await p.click('[data-buy-sample="complete"]');
  await p.waitForURL(/complete-sample/);
  const u = new URL(p.url());
  assert.equal(u.search, '');
  assert.doesNotMatch(p.url(), UUID_RE);
  await p.__ctx.close();
  const q = await resultPage({ salesOpen: false });
  assert.equal(await q.locator('[data-buy-complete]').isDisabled(), true);
  assert.match(await q.locator('[data-buy-complete]').innerText(), /準備中/);
  await q.__ctx.close();
});

// ================= サンプル
test('サンプル：直接開くと「まず元素診断を受ける」だけ（申込なし）。購入対象トークン付きは記録の概要と、そのサンプルの商品の申込（解析レポートのサンプルは完全解析を折りたたみの中に）。トークンは URL から消す', { skip: skip() }, async () => {
  for (const pg of ['/complete-sample.html', '/report_sample.html']) {
    const d = await open(pg, { api: RESULT_API() });
    await d.waitForSelector('[data-sample-buy] a.sample-return');
    const t = await d.locator('[data-sample-buy]').innerText();
    assert.match(t, /まず元素診断を受ける/);
    assert.doesNotMatch(t, /作成する/);
    assert.equal(d.__calls.filter((c) => c.op === 'buy-summary' || c.op === 'buy').length, 0);
    await d.__ctx.close();
    const s = await open(`${pg}#c=${CTX}&from=result`, { api: RESULT_API({ 'buy-summary': [200, { summary: SUMMARY, eligible: { analysis: true, complete: true } }] }), init: () => { window.__goalPick = true; } });
    const isB = pg.startsWith('/complete');
    // 完全解析のサンプル：完全解析だけ。解析レポートのサンプル：解析レポートが主・完全解析は折りたたみの中
    await s.waitForSelector(isB ? '[data-buy="complete"]' : '[data-buy="analysis"]');
    const text = await s.locator('[data-sample-buy]').innerText();
    assert.match(text, /元素 風/);
    if (isB) {
      assert.match(text, /まだ見えていない輪郭を読む[\s\S]*この診断結果の完全解析　全46ページ　¥3,000/);
      assert.equal(await s.locator('[data-buy="analysis"]').count(), 0, '完全解析のサンプルに解析レポートの申込を出さない');
    } else {
      assert.match(text, /この診断結果で、解析レポートを読む/);
      assert.match(text, /解析レポート　¥1,000/);
      assert.equal(await s.locator('[data-sample-buy] [data-buy="complete"]').count(), 0, '末尾の申込欄は解析レポートだけ');
      // 完全解析は、本文の「この先にあるもの」（旧ナラティブレポートの紹介を置き換えた欄）で、図・説明・サンプルと一緒に案内する
      const beyond = s.locator('.beyond-sec');
      assert.equal(await s.getByText('NARRATIVE REPORT').count(), 0);
      assert.match(await beyond.innerText(), /まだ見えていない輪郭を読む[\s\S]*全46ページ[\s\S]*¥3,000/);
      assert.equal(await beyond.locator('.edl-map svg .edl-orbit').count(), 3);
      assert.equal(await beyond.locator('[data-buy="complete"]').count(), 1);
      assert.match(await beyond.locator('[data-sample-complete-link]').getAttribute('href'), /^\/complete-sample\.html#c=/);
    }
    assert.equal(new URL(s.url()).hash, '', 'トークンを URL から消す');
    const product = isB ? 'complete' : 'analysis';
    await s.click(`[data-buy="${product}"]`);
    if (isB) {
      await s.waitForSelector('.edb-dialog input[name="edb-goal"]');
      await s.locator('.edb-dialog input[name="edb-goal"]').first().check();
      await s.click('[data-edb-go]');
    }
    await s.waitForURL(/checkout\.stripe\.com/);
    assert.deepEqual(s.__calls.filter((c) => c.op === 'buy').map((c) => [c.body.product, c.body.context, c.body.source]), [[product, CTX, 'result_sample']]);
    assert.deepEqual(s.__errors, []);
    await s.__ctx.close();
  }
});

// ================= 購入完了ページ
test('購入完了：受け取り専用（状態・開く・リンクのコピー・PDF の案内・登録）。ほかの商品の申込は出さない', { skip: skip() }, async () => {
  const p = await open('/purchase-complete?status=returned', { api: { deliveries: [200, { purchases: [
    { product: 'analysis', state: 'active', link: LINK_A, purchasedOn: '2026-10-20' },
    { product: 'complete', state: 'active', link: LINK_B, purchasedOn: '2026-10-20', report: { status: 'generating' } },
  ] }] } });
  await p.waitForSelector('[data-item="1"]');
  const text = await p.locator('#pcList').innerText();
  assert.match(text, /解析レポートを開く/);
  assert.match(text, /完全解析を開く/);
  assert.match(text, /完全解析を作成しています/);
  assert.match(text, /PDFとして端末に保存できます/);
  assert.match(text, /別のアカウントにも何度でも登録できます/);
  assert.equal(await p.locator('[data-register]').count(), 2);
  assert.equal(await p.locator('[data-copy]').count(), 2);
  assert.equal((text.match(PRICE_RE) || []).length, 0, '価格・申込の導線を出さない');
  assert.equal(await p.locator('[data-buy], [data-buy-complete], [data-analysis-checkout], [data-complete-checkout]').count(), 0);
  assert.equal(new URL(p.url()).search, '', '戻り先の印を URL から消す');
  assert.equal(await p.locator('[data-item="0"] [data-open]').getAttribute('href'), '/report-link#t=' + LINK_A);
  // 登録：秘密値はこのタブの sessionStorage だけ。マイページへ
  await p.click('[data-item="0"] [data-register]');
  await p.waitForURL(/\/mypage/);
  const intent = await p.evaluate(() => JSON.parse(sessionStorage.getItem('ed_register_v1')));
  assert.equal(intent.t, LINK_A);
  assert.ok(!p.url().includes(LINK_A));
  await p.__ctx.close();
});

// ================= レポート固有リンク
test('固有リンク：開くたびに状態を確かめ、読む・コピー・登録・共有の注意。返金後は読めない。無効なリンクは無効と示す', { skip: skip() }, async () => {
  const active = { product: 'analysis', state: 'active', purchasedOn: '2026-10-20', summary: SUMMARY };
  const p = await open('/report-link#t=' + LINK_A, { api: { 'link-open': (b) => (b.open ? [200, { ...active, url: '/report.html?token=view' }] : [200, active]) } });
  await p.waitForSelector('[data-open]');
  const text = await p.locator('#rlBox').innerText();
  assert.match(text, /解析レポートを読む/);
  assert.match(text, /マイページに登録する/);
  assert.match(text, /別のアカウントにも何度でも登録できます/);
  assert.doesNotMatch(text, /¥/);
  await p.click('[data-open]');
  await p.waitForURL(/report\.html\?token=view/);
  assert.deepEqual(p.__calls.filter((c) => c.op === 'link-open').map((c) => c.body), [{ token: LINK_A, open: false }, { token: LINK_A, open: true }]);
  assertNoSecrets(p, [LINK_A]);
  await p.__ctx.close();
  const r = await open('/report-link#t=' + LINK_A, { api: { 'link-open': [200, { ...active, state: 'refunded' }] } });
  await r.waitForSelector('.state');
  assert.match(await r.locator('#rlBox').innerText(), /返金のため現在ご覧いただけません/);
  assert.equal(await r.locator('[data-open]').count(), 0);
  await r.__ctx.close();
  const n = await open('/report-link#t=' + LINK_A, { api: { 'link-open': [404, { error: 'link_not_found' }] } });
  await n.waitForSelector('.state');
  assert.match(await n.locator('#rlBox').innerText(), /このリンクは無効です/);
  await n.__ctx.close();
});

// ================= マイページ（表14）
const DEL = (product, state, extra) => Object.assign({ delivery: product === 'complete' ? '33333333-3333-4333-8333-333333333333' : '44444444-4444-4444-8444-444444444444', record: REC_ID, product, state, purchasedOn: '2026-10-20' }, extra || {});
async function mypage(reports, opts = {}) {
  const p = await open('/mypage.html', { signedIn: true, rows: [REC_ROW], ...opts, api: Object.assign({
    'my-reports': [200, { reports, records: [] }],
    'buy-context': [200, { context: CTX, summary: SUMMARY, eligible: { analysis: true, complete: true } }],
    'guest-goals': [200, GOALS],
    buy: BUY_OK,
    'my-report-open': [200, { state: 'active', product: 'analysis', url: '/report.html?token=view' }],
  }, opts.api || {}) });
  await p.waitForSelector('.mp-latest [data-rec-product="complete"]', { state: 'attached' });
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  return p;
}
const rowText = (p, product) => p.locator(`.mp-latest [data-rec-product="${product}"]`).first().textContent();

test('マイページ（表14）：登録なし／A のみ／B のみ／A・B の4つの状態。A は B を開けず、B は A を開けない', { skip: skip() }, async () => {
  const cases = [
    [[], /解析レポート\s*¥1,000/, /完全解析\s*¥3,000/],
    [[DEL('analysis', 'active')], /解析レポートを読む/, /完全解析\s*¥3,000/],
    [[DEL('complete', 'active', { report: { status: 'ready' } })], /解析レポート\s*¥1,000/, /完全解析を読む/],
    [[DEL('analysis', 'active'), DEL('complete', 'active', { report: { status: 'ready' } })], /解析レポートを読む/, /完全解析を読む/],
  ];
  for (const [reports, a, b] of cases) {
    const p = await mypage(reports);
    assert.match(await rowText(p, 'analysis'), a);
    assert.match(await rowText(p, 'complete'), b);
    assert.doesNotMatch(await p.locator('.mp-latest').textContent(), /¥2,000|追加|アップグレード/);
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('マイページ：返金した納品はその納品だけ止める（もう一方は読める・買い直せる）。B の作成中・失敗の表示', { skip: skip() }, async () => {
  const p = await mypage([DEL('analysis', 'refunded'), DEL('complete', 'active', { report: { status: 'ready' } })]);
  assert.match(await rowText(p, 'analysis'), /返金のため/);
  assert.match(await rowText(p, 'analysis'), /解析レポート\s*¥1,000/);
  assert.match(await rowText(p, 'complete'), /完全解析を読む/);
  await p.__ctx.close();
  const g = await mypage([DEL('complete', 'active', { report: { status: 'generating' } })]);
  assert.match(await rowText(g, 'complete'), /作成しています/);
  await g.__ctx.close();
  const f = await mypage([DEL('complete', 'active', { report: { status: 'failed', regenerate: 'available' } })]);
  assert.match(await rowText(f, 'complete'), /もう一度作成する/);
  await f.__ctx.close();
});

test('マイページ：右上は「レポート」・シートの見出しは「この記録のレポート」。購入は共通の op=buy（記録の購入対象トークン）', { skip: skip() }, async () => {
  const p = await mypage([DEL('analysis', 'active')]);
  assert.equal((await p.locator('#mpUpgradeTrigger').innerText()).trim(), 'レポート');
  await p.click('#mpUpgradeTrigger');
  await p.waitForSelector('#mpUpgradeBody #latest-upgrade-title');
  assert.equal((await p.locator('#latest-upgrade-title').innerText()).trim(), 'この記録のレポート');
  const sheet = await p.locator('#mpUpgradeBody').innerText();
  assert.match(sheet, /解析レポートを読む/);
  assert.match(sheet, /完全解析\s*¥3,000/);
  await p.locator('#mpUpgradeBody [data-complete-checkout]').click();
  await p.waitForSelector('.edb-dialog input[name="edb-goal"]');
  await p.locator('.edb-dialog input[name="edb-goal"]').first().check();
  await p.click('[data-edb-go]');
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(p.__calls.filter((c) => c.op === 'buy-context').map((c) => c.body), [{ record: REC_ID }]);
  const buy = p.__calls.filter((c) => c.op === 'buy');
  assert.deepEqual([buy.length, buy[0].body.product, buy[0].body.source, buy[0].body.context], [1, 'complete', 'mypage_header', CTX]);
  await p.__ctx.close();
});

test('マイページ：登録した読むボタンは my-report-open（納品 ID だけ）で開く。購入時メール・Cookie の引き継ぎを呼ばない', { skip: skip() }, async () => {
  const p = await mypage([DEL('analysis', 'active')]);
  await p.locator('.mp-latest [data-mp-open]').first().click();
  await p.waitForURL(/report\.html\?token=view/);
  const opens = p.__calls.filter((c) => c.op === 'my-report-open');
  assert.deepEqual(opens.map((c) => c.body), [{ delivery: DEL('analysis').delivery }]);
  assert.ok(opens[0].auth.startsWith('Bearer '));
  assert.equal(p.__calls.filter((c) => ['guest-claim', 'guest-recover', 'guest-status'].includes(c.op)).length, 0, '引き継ぎ・端末の購入の照合をしない');
  await p.__ctx.close();
});

test('C7：同じ利用者の SIGNED_IN 再通知（タブ復帰）では描き直さない（開いたシートを保つ・登録したレポートを取り直さない）', { skip: skip() }, async () => {
  const p = await mypage([DEL('analysis', 'active')]);
  await p.click('#mpUpgradeTrigger');
  await p.waitForSelector('#mpUpgradeBody #latest-upgrade-title');
  const hits = p.__calls.filter((c) => c.op === 'my-reports').length;
  await p.evaluate(() => window.__edAuthCb('SIGNED_IN', { user: { id: '11111111-1111-4111-8111-111111111111' } }));
  await p.waitForTimeout(400);
  assert.equal(p.__calls.filter((c) => c.op === 'my-reports').length, hits, '描き直さない');
  assert.equal(await p.locator('#mpUpgradeOverlay').isVisible(), true, 'シートは開いたまま');
  await p.__ctx.close();
});

test('C7（iOS Safari 相当）：「決済画面へ移動しています…」のまま止めない（タブ復帰・戻る〔bfcache の pageshow〕で押せる状態へ戻す）', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await mypage([], { width });
    await p.route('https://checkout.stripe.com/**', (r) => r.fulfill({ status: 204, body: '' })); // 移動しない
    const btn = p.locator('.mp-latest [data-analysis-checkout]').first();
    const label = (await btn.innerText()).trim();
    await btn.click();
    await p.waitForFunction(() => !!document.querySelector('[data-analysis-checkout][data-nav-busy="away"]'));
    assert.equal((await btn.innerText()).trim(), '決済画面へ移動しています…');
    assert.equal(await btn.isDisabled(), true);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal((await btn.innerText()).trim(), label, `${width}: タブ復帰で元の表示`);
    assert.equal(await btn.isDisabled(), false);
    await btn.click();
    await p.waitForFunction(() => !!document.querySelector('[data-analysis-checkout][data-nav-busy="away"]'));
    await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal((await btn.innerText()).trim(), label, `${width}: pageshow で元の表示`);
    assert.equal(await btn.isDisabled(), false);
    await p.__ctx.close();
  }
});

test('完全解析の目標の選択（共通の画面）：Escape でやめる・320／390／1280px で横にはみ出さない・選択肢は 44px 以上', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await resultPage({ width });
    await p.click('[data-buy-complete]');
    await p.waitForSelector('.edb-dialog input[name="edb-goal"]');
    assert.ok(await noScroll(p), `${width}px`);
    const hs = await p.locator('.edb-goal').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(hs.length > 0 && hs.every((h) => h >= 44), hs.join(','));
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.edb-dialog').count(), 0);
    assert.equal(p.__calls.filter((c) => c.op === 'buy').length, 0);
    await p.__ctx.close();
  }
});

// ================= マイページへの登録
test('登録：リンクの秘密値（このタブの sessionStorage）でログイン後に登録。「登録しました」／2回目は「登録済みです」。秘密値は URL・GA4 に出さない', { skip: skip() }, async () => {
  const seed = `sessionStorage.setItem('ed_register_v1', JSON.stringify({ t: '${LINK_A}', at: Date.now() }));`;
  for (const [result, re] of [['registered', /このマイページに登録しました/], ['already', /登録済みです/]]) {
    const p = await mypage([DEL('analysis', 'active')], { init: seed, api: { 'link-register': [200, { result, product: 'analysis' }] } });
    await p.waitForSelector('#mpClaimBox');
    assert.match(await p.locator('#mpClaimBox').innerText(), re);
    const reg = p.__calls.filter((c) => c.op === 'link-register');
    assert.deepEqual(reg.map((c) => c.body), [{ token: LINK_A }]);
    assert.ok(reg[0].auth.startsWith('Bearer '));
    assert.equal(await p.evaluate(() => sessionStorage.getItem('ed_register_v1')), null, '使った後は消す');
    assertNoSecrets(p, [LINK_A]);
    await p.__ctx.close();
  }
  // 未ログイン：登録の予定をログインの画面で示し、秘密値は残す（ログインの後に登録する）
  const g = await open('/mypage.html', { init: seed, api: {} });
  await g.waitForSelector('#gateAuth');
  assert.match(await g.locator('#historyGateArea').innerText(), /購入したレポートをこのマイページに登録します/);
  assert.equal(JSON.parse(await g.evaluate(() => sessionStorage.getItem('ed_register_v1'))).t, LINK_A);
  await g.__ctx.close();
});

// ================= 解析レポートの最下部
test('解析レポート（固有リンク）の最下部：登録・B の説明とサンプル・「この診断結果で完全解析を作成する ¥3,000」・共有の注意・PDF。¥2,000 なし', { skip: skip() }, async () => {
  const p = await open('/report.html?token=view', {
    init: `sessionStorage.setItem('ed_report_link_v1', '${LINK_A}');`,
    api: { 'link-open': [200, { product: 'analysis', state: 'active', context: CTX, summary: SUMMARY }], 'guest-goals': [200, GOALS], buy: BUY_OK },
  });
  await p.route('**/api/report-data**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: V2(7).code, diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: true }, viewer: 'delivery' }) }));
  await p.reload();
  await p.waitForSelector('[data-report-buy-complete]');
  const box = await p.locator('[data-report-complete]').innerText();
  assert.match(box, /マイページに登録する/);
  assert.match(box, /この診断結果で完全解析を作成する ¥3,000/);
  assert.match(box, /解析レポートの本文は含まれません/);
  assert.match(box, /別のアカウントにも何度でも登録できます/);
  assert.match(box, /PDFとして端末に保存できます/);
  assert.doesNotMatch(await p.locator('body').innerText(), /¥2,000|追加 ?¥2/);
  await p.__ctx.close();
});

// ================= OTP（第17節）
async function otpScreen(opts = {}) {
  const p = await open('/mypage.html', { init: opts.init || null });
  await p.waitForSelector('#gateAuth [data-au="email"]');
  await p.click('#gateAuth [data-au="email"]');
  await p.fill('#auEmail', 'someone@example.test');
  await p.click('#auSend');
  await p.waitForSelector('#auCode');
  return p;
}
test('OTP：誤ったコードの後もコードの画面のまま・同じ入力では自動で送り直さない・「あとN秒で再送できます」・最新のメールのコードへ案内', { skip: skip() }, async () => {
  const p = await otpScreen();
  assert.match(await p.locator('#auResendWait').innerText(), /^あと\d+秒で再送できます$/);
  assert.equal(await p.locator('#auResend').isDisabled(), true);
  await p.fill('#auCode', '123456');
  await p.waitForFunction(() => (window.__otpTried || []).length === 1);
  await p.waitForFunction(() => /最新のメールに届いたコード/.test(document.querySelector('.au-msg').textContent));
  assert.equal(await p.locator('#auCode').count(), 1, 'コードの画面のまま');
  // 同じ入力（再入力の操作で同じ値）では自動で送り直さない
  await p.locator('#auCode').dispatchEvent('input');
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__otpTried.length), 1);
  // 入力が変われば送る
  await p.fill('#auCode', '654321');
  await p.waitForFunction(() => window.__otpTried.length === 2);
  // 「ログイン」を押した時は同じ値でも送る
  await p.click('#auVerify');
  await p.waitForFunction(() => window.__otpTried.length === 3);
  await p.__ctx.close();
});

test('OTP：送信の上限（429）はコードの画面へ（短い間の上限と1時間の上限を分けて案内）。再送の 429 でもコードの画面のまま', { skip: skip() }, async () => {
  const req = await otpScreen({ init: () => { window.__otpSend = () => ({ error: { code: 'over_request_rate_limit', status: 429, message: 'For security purposes, you can only request this after 37 seconds.' } }); } });
  assert.match(await req.locator('.au-msg').innerText(), /短い間に何度も送信しました/);
  assert.match(await req.locator('#auResendWait').innerText(), /^あと3[0-7]秒で再送できます$/);
  await req.__ctx.close();
  const hour = await otpScreen({ init: () => { window.__otpSend = () => ({ error: { code: 'over_email_send_rate_limit', status: 429, message: 'Email rate limit exceeded' } }); } });
  assert.match(await hour.locator('.au-msg').innerText(), /1時間ほど待って/);
  assert.equal(await hour.locator('#auCode').count(), 1);
  await hour.__ctx.close();
});

// ================= 画面幅
test('320・390・1280px：診断結果・サンプル・購入完了・固有リンク・マイページで横スクロールなし', { skip: skip(), timeout: 240000 }, async () => {
  for (const width of [320, 390, 1280]) {
    const pages = [
      await resultPage({ width }),
      await open(`/complete-sample.html#c=${CTX}&from=result`, { width, api: RESULT_API({ 'buy-summary': [200, { summary: SUMMARY, eligible: { analysis: true, complete: true } }] }) }),
      await open('/purchase-complete', { width, api: { deliveries: [200, { purchases: [{ product: 'analysis', state: 'active', link: LINK_A, purchasedOn: '2026-10-20' }] }] } }),
      await open('/report-link#t=' + LINK_A, { width, api: { 'link-open': [200, { product: 'complete', state: 'active', summary: SUMMARY, report: { status: 'ready' } }] } }),
      await mypage([DEL('analysis', 'active')], { width }),
    ];
    for (const p of pages) {
      await p.waitForTimeout(300);
      assert.ok(await noScroll(p), `${width}px ${p.url()} で横スクロール`);
      await p.__ctx.close();
    }
  }
});
