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

test('全記録が対象：最新が無料でも、5件目の過去記録が解析購入済みなら、5件目のアコーディオンに完全解析の案内が出る', { skip: skip() }, async () => {
  const w = many({}, { [ID(5)]: analysisOnly() }, [5]);
  const p = await open(w);
  for (const k of [1, 2, 3, 4]) assert.equal(await guide(p, k).count(), 0, `無料の記録 ${k} に案内は出ない`);
  const g = guide(p, 5, 'records');
  assert.equal(await g.count(), 1);
  const t = await g.innerText();
  assert.match(t, /COMPLETE ANALYSIS｜完全解析/);
  assert.match(t, /三つの人物像が、ひとつの輪郭を結ぶ。/);
  assert.match(t, /MIRROR・HIDDEN SHAPE・MENTOR/);
  assert.match(t, /完全解析の内容を見る/);
  // 既存の「解析レポートを見る」は残り、その下に案内がある
  const box = actions(p, ID(5), 'records');
  const html = await box.innerHTML();
  assert.ok(html.indexOf('解析レポートを見る') >= 0 && html.indexOf('解析レポートを見る') < html.indexOf('data-ca-guide'));
  // 展開すると、解析購入者は追加 ¥2,000 と概要
  assert.equal(await g.locator('.ca-guide-price').isVisible(), false);
  await g.locator('summary').click();
  assert.equal(await g.locator('.ca-guide-price').isVisible(), true);
  assert.match(await g.locator('.ca-guide-price').innerText(), /追加 ¥2,000/);
  assert.match(await g.locator('.ca-rec-guide-body').innerText(), /MIRROR[\s\S]*HIDDEN SHAPE[\s\S]*MENTOR/);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('LATEST RESULT と THE RECORDS は同じ関数から出る：最新が解析購入済みなら両方に1つずつ、条件を二重に持たない', { skip: skip() }, async () => {
  const w = many({}, { [ID(1)]: analysisOnly() }, [1]);
  const p = await open(w);
  assert.equal(await guide(p, 1, 'latest').count(), 1);
  assert.equal(await guide(p, 1, 'records').count(), 1);
  assert.equal(await p.locator('[data-ca-guide]').count(), 2, '他の記録には出ない');
  assert.equal(await guide(p, 1, 'latest').innerText(), await guide(p, 1, 'records').innerText());
  // 別の大きな完全解析のバナーは、記録内には出さない（右上の入口のシートは開いた時だけ）
  assert.equal(await p.locator('.mp-latest .ca-card, .mp-rec .ca-card').count(), 0);
  const src = fs.readFileSync(path.join(ROOT, 'mypage.html'), 'utf8');
  assert.equal((src.match(/function caGuideMode\(/g) || []).length, 1);
  assert.equal((src.match(/caGuideMode\(/g) || []).length, 2, '定義1・呼び出し1（mpRecordActionsHtml）だけ');
  await p.__ctx.close();
});

test('解析購入済み・完全未購入：販売停止中は説明と追加価格が見え、目標の選択を含めて申込の操作は無効の「準備中」', { skip: skip() }, async () => {
  const w = many({}, { [ID(2)]: analysisOnly() }, [2]);
  const p = await open(w);
  const g = guide(p, 2, 'records');
  assert.equal(await g.getAttribute('data-ca-guide-kind'), 'offer');
  assert.equal(await g.locator('[data-mentor-open]').count(), 0, '目標の選択も出さない');
  const b = g.locator('button.mp-btn-pending');
  assert.equal(await b.count(), 1);
  assert.equal(await b.isDisabled(), true);
  assert.match(await b.innerText(), /完全解析へアップグレード ¥2,000（準備中）/);
  assert.match(await g.innerText(), /完全解析は準備中です。現在はお申し込みいただけません。/);
  await g.locator('summary').click();
  assert.match(await g.locator('.ca-guide-price').innerText(), /追加 ¥2,000/);
  await assertNoPayAction(p, 2);
  await p.__ctx.close();
});

test('解析購入済み・完全未購入：販売開始後だけ、目標の選択（未選択）の操作が出る。選択済みなら決済の確認へ', { skip: skip() }, async () => {
  const goal = { goalId: 'GOAL_PACE_01', goalCatalogVersion: 'CORE1-MENTOR-GOALS-1.0.0', selectedAt: '2026-10-07T00:00:00Z' };
  const w = many({}, { [ID(2)]: analysisOnly(), [ID(3)]: analysisOnly({ mentorGoal: goal }) }, [2, 3]);
  const p = await open(w, { salesOpen: true });
  const g2 = guide(p, 2, 'records');
  assert.match(await g2.innerText(), /完全解析へ 追加¥2,000：目標を選ぶ/);
  assert.equal(await g2.locator('[data-mentor-open]').isEnabled(), true);
  assert.equal(await g2.locator('button.mp-btn-pending').count(), 0);
  assert.doesNotMatch(await g2.innerText(), /完全解析は準備中です/);
  const g3 = guide(p, 3, 'records');
  assert.match(await g3.innerText(), /完全解析へ 追加¥2,000：決済の確認へ/);
  assert.equal(await g3.locator('[data-mentor-chosen="1"]').count(), 1);
  await p.__ctx.close();
});

test('販売停止中（Preview の状態確認用 fixture）：説明は見え、決済ボタンだけ「準備中」で無効', { skip: skip() }, async () => {
  const w = many({}, {}, []);
  const p = await open(w, { query: '?preview_entitlement=analysis&preview_past=analysis' });
  for (const k of [1, 2]) {
    const g = guide(p, k, 'records');
    assert.equal(await g.count(), 1, `記録 ${k}`);
    assert.match(await g.innerText(), /COMPLETE ANALYSIS｜完全解析[\s\S]*三つの人物像が、ひとつの輪郭を結ぶ。/);
    const b = g.locator('button.mp-btn-pending');
    assert.equal(await b.count(), 1);
    assert.equal(await b.isDisabled(), true);
    assert.match(await b.innerText(), /完全解析へアップグレード ¥2,000（準備中）/);
    assert.equal(await b.getAttribute('onclick'), null);
    assert.match(await g.innerText(), /完全解析は準備中です。現在はお申し込みいただけません。/);
  }
  assert.equal(await guide(p, 3).count(), 0, 'fixture は新しい順の2件だけ。3件目以降は無料');
  await p.__ctx.close();
});

test('完全解析の権利あり：購入案内は出さず、既存の queued/generating/ready/failed/suspended/revoked の表示を使う', { skip: skip() }, async () => {
  const cases = [
    ['ready', purchased(), '[data-ca-view-open]'],
    ['generating', purchased({ completeStatus: 'generating' }), '.ca-view.is-preparing'],
    ['queued', purchased({ completeStatus: 'queued' }), '.ca-view.is-preparing'],
    ['failed', purchased({ completeStatus: 'failed' }), '[data-ca-view-recheck]'],
    ['suspended', purchased({ completeEntitlement: 'suspended', completeStatus: 'ready' }), '.ca-view.is-suspended'],
    ['revoked', purchased({ completeEntitlement: 'revoked', completeStatus: 'revoked' }), '.ca-view.is-revoked'],
  ];
  for (const [name, r, sel] of cases) {
    const w = many({}, { [ID(3)]: r }, [3]);
    const p = await open(w);
    const box = actions(p, ID(3), 'records');
    assert.equal(await guide(p, 3).count(), 0, `${name}：購入案内なし`);
    assert.equal(await box.locator(sel).count() >= 1, true, `${name}：既存の表示 ${sel}`);
    assert.doesNotMatch(await box.innerText(), /¥2,000|¥3,000|目標を選ぶ|完全解析の内容を見る/, name);
    await p.__ctx.close();
  }
});

test('別の記録の権利を流用しない：A は完全解析 ready、B は解析のみ。B に A のボタン・状態は出ない', { skip: skip() }, async () => {
  const w = many({}, { [ID(1)]: purchased(), [ID(4)]: analysisOnly() }, [1, 4]);
  const p = await open(w);
  assert.equal(await actions(p, ID(1), 'records').locator('[data-ca-view-open]').count(), 1);
  assert.equal(await guide(p, 1).count(), 0);
  const b = actions(p, ID(4), 'records');
  assert.equal(await b.locator('[data-ca-view-open]').count(), 0, 'A の「完全解析を見る」を B に出さない');
  assert.equal(await guide(p, 4, 'records').count(), 1);
  assert.doesNotMatch(await b.innerHTML(), new RegExp(ID(1) + '(?!\\d)'));
  // 3件目（無料）にも出ない
  assert.equal(await guide(p, 3).count(), 0);
  await p.__ctx.close();
});

test('真の対象外（サーバーが対象外・v1/旧版）には購入案内を出さない', { skip: skip() }, async () => {
  // サーバーが対象外と判定
  let w = many({}, { [ID(2)]: analysisOnly({ completeEligible: false, ineligibleReason: 'version_mismatch' }) }, [2]);
  let p = await open(w);
  assert.equal(await guide(p, 2).count(), 0);
  let t = await actions(p, ID(2), 'records').innerText();
  assert.match(t, /解析レポートを見る/);
  assert.doesNotMatch(t, /¥2,000|¥3,000|完全解析の内容を見る|COMPLETE ANALYSIS/);
  await p.__ctx.close();
  // v1／旧版の記録（保存された診断版が ETI-2.0 ではない）
  const legacy = JSON.parse(JSON.stringify(ROWS[2].row));
  legacy.diagnosis_version = 'element-v1'; legacy.item_set_version = null;
  legacy.diagnosis_results[0].item_set_version = null;
  const rowsL = ROWS.map((r) => (r.row.id === ID(3) ? legacy : r.row));
  w = many({ rows: rowsL, purchased: { ['element-v1:' + ROWS[2].code]: 1 }, records: Object.fromEntries(ROWS.map((r) => [r.row.id, rec(r.row.id === ID(3) ? { completeEligible: false, ineligibleReason: 'legacy_version' } : {})])) });
  p = await open(w);
  assert.equal(await guide(p, 3).count(), 0);
  await p.__ctx.close();
  // 状態を取得できない時（サーバーの判定なし）も、保存された診断版・設問版で対象外と分かる記録（v1／旧版）には案内を出さない。
  // 回答が100問そろっているかはサーバー（completeEligible）の判定で、符号だけでは分からない（符号は桁を詰めた数のため）
  w = many({ rows: rowsL, completeLookup: 'failed', purchased: { ['element-v1:' + ROWS[2].code]: 1 } }, {}, []);
  p = await open(w);
  assert.equal(await guide(p, 3).count(), 0, '状態取得に失敗しても、v1 には案内なし');
  await p.__ctx.close();
});

test('状態取得に失敗：説明は見えるが決済はできない（重複購入防止）。「もう一度確認する」で状態を取り直せる', { skip: skip() }, async () => {
  const w = many({ completeLookup: 'failed' }, {}, [5]);
  const p = await open(w);
  const g = guide(p, 5, 'records');
  assert.equal(await g.count(), 1);
  assert.equal(await g.getAttribute('data-ca-guide-kind'), 'unknown');
  assert.match(await g.innerText(), /COMPLETE ANALYSIS｜完全解析[\s\S]*三つの人物像が、ひとつの輪郭を結ぶ。[\s\S]*MIRROR・HIDDEN SHAPE・MENTOR/);
  const pay = g.locator('button.mp-btn-pending');
  assert.equal(await pay.count(), 1);
  assert.equal(await pay.isDisabled(), true);
  assert.equal(await g.locator('[data-ca-view-recheck]').count(), 1);
  assert.doesNotMatch(await g.innerText(), /¥2,000|¥3,000|目標を選ぶ/, '金額は確認できるまで案内しない');
  await assertNoPayAction(p, 5);
  // サーバーの状態が取れるようになってから「もう一度確認する」：説明のまま、追加 ¥2,000 の導線に切り替わる（無料の記録には出ない）
  w.completeLookup = 'ok'; w.records = Object.fromEntries(ROWS.map((r) => [r.row.id, rec(r.row.id === ID(5) ? { analysisSource: 'record_entitlement' } : {})]));
  w.statusSeq[ID(5)] = [{ code: 200, entitlement: null, report: null }];
  await g.locator('[data-ca-view-recheck]').click();
  await p.waitForSelector(`[data-rec-actions="${ID(5)}"][data-rec-source="records"] [data-ca-guide]`);
  await p.__ctx.close();
});

test('権利確認中（旧 ¥1,000 購入の確認中）：説明は見えるが決済はできない。確認が終わると追加 ¥2,000 の導線に切り替わる', { skip: skip() }, async () => {
  const w = many({}, { [ID(5)]: rec({ legacyPurchasePending: true }) }, [5]);
  const p = await open(w);
  let g = guide(p, 5, 'records');
  assert.equal(await g.getAttribute('data-ca-guide-kind'), 'legacy');
  assert.match(await g.innerText(), /COMPLETE ANALYSIS｜完全解析[\s\S]*三つの人物像が、ひとつの輪郭を結ぶ。/);
  assert.match(await g.innerText(), /既存の解析レポート購入を確認しています/);
  assert.equal(await g.locator('button.mp-btn-pending').isDisabled(), true);
  assert.doesNotMatch(await g.innerText(), /¥2,000|¥3,000|目標を選ぶ/);
  assert.equal(await g.locator('[data-mentor-open]').count(), 0);
  await assertNoPayAction(p, 5);
  // 確認が終わった（固定済みの旧購入権になった）後に「もう一度確認する」
  w.records[ID(5)] = rec({ analysisSource: 'legacy_purchase_entitlement', legacyPurchasePending: false });
  await g.locator('button:has-text("もう一度確認する")').click();
  await p.waitForSelector('.mp-rec'); // 再確認は画面全体を描き直す
  await p.evaluate(() => document.querySelectorAll('details.mp-rec').forEach((d) => { d.open = true; }));
  await p.waitForFunction((id) => { const el = document.querySelector(`[data-rec-actions="${id}"][data-rec-source="records"] [data-ca-guide]`); return el && el.dataset.caGuideKind === 'offer'; }, ID(5));
  g = guide(p, 5, 'records');
  assert.equal(await g.getAttribute('data-ca-guide-kind'), 'offer');
  assert.match(await g.locator('button.mp-btn-pending').innerText(), /完全解析へアップグレード ¥2,000（準備中）/); // 販売停止中は無効の準備中
  await g.locator('summary').click();
  assert.match(await g.locator('.ca-guide-price').innerText(), /追加 ¥2,000/);
  await p.__ctx.close();
});

test('決済手続き中：案内は出るが決済は無効', { skip: skip() }, async () => {
  const w = many({}, { [ID(2)]: rec({ analysisSource: 'record_entitlement', checkoutInProgress: true }) }, [2]);
  const p = await open(w);
  const g = guide(p, 2, 'records');
  assert.equal(await g.getAttribute('data-ca-guide-kind'), 'checkout');
  assert.equal(await g.locator('button.mp-btn-pending').isDisabled(), true);
  assert.match(await g.innerText(), /完全解析の決済手続き中です/);
  await p.__ctx.close();
});

test('Preview でサーバーが完全解析の項目を返さない（lookup なし）：従来どおり記録の保存データで対象・金額を決め、説明を付けて決済は無効', { skip: skip() }, async () => {
  const w = many({ completeLookup: null }, {}, [5]);
  const p = await open(w);
  const g = guide(p, 5, 'records');
  assert.equal(await g.getAttribute('data-ca-guide-kind'), 'offer');
  assert.match(await g.locator('button.mp-btn-pending').innerText(), /完全解析へアップグレード ¥2,000（準備中）/);
  assert.equal(await g.locator('button.mp-btn-pending').isDisabled(), true);
  assert.equal(await guide(p, 4).count(), 0, '無料の記録には出ない');
  await p.__ctx.close();
});

test('Preview 以外の既存の表示は変えない：案内ブロックは出ず、従来の準備中ボタンのまま（Production は公開設定が preview でないため同じ）', { skip: skip() }, async () => {
  const w = many({ appEnv: 'development', completeLookup: null }, {}, [5]);
  const p = await open(w);
  assert.equal(await p.locator('[data-ca-guide]').count(), 0);
  assert.equal(await p.locator('.ca-rec-guide').count(), 0);
  const t = await actions(p, ID(5), 'records').innerText();
  assert.match(t, /解析レポートを見る/);
  assert.match(t, /完全解析へアップグレード ¥2,000（準備中）/);
  assert.equal(await actions(p, ID(5), 'records').locator('button.mp-btn-pending').isDisabled(), true);
  await p.__ctx.close();
});

for (const width of [320, 390]) {
  test(`${width}px：案内（offer・状態取得失敗・権利確認中）を開いても横スクロール・ボタンのはみ出しがない`, { skip: skip() }, async () => {
    const w = many({}, { [ID(2)]: analysisOnly(), [ID(3)]: rec({ legacyPurchasePending: true }) }, [2, 3, 5]);
    // 5件目は rec() のまま（offer の根拠なし＝direct の確認）。別に、状態取得失敗の世界も確かめる
    for (const world2 of [w, many({ completeLookup: 'failed' }, {}, [2, 5])]) {
      const p = await open(world2, { width });
      await p.evaluate(() => document.querySelectorAll('.ca-rec-guide-more').forEach((d) => { d.open = true; }));
      const m = await p.evaluate(() => {
        const de = document.documentElement; const vw = de.clientWidth;
        const bad = [];
        document.querySelectorAll('.ca-rec-guide, .ca-rec-guide button, .ca-rec-guide summary, .ca-rec-guide-body').forEach((el) => {
          const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) bad.push(el.className || el.tagName);
        });
        return { sw: de.scrollWidth, cw: vw, bad, guides: document.querySelectorAll('.ca-rec-guide').length };
      });
      assert.ok(m.guides >= 1, '案内がある');
      assert.equal(m.sw, m.cw, `${width}px：横スクロール`);
      assert.deepEqual(m.bad, [], `${width}px：はみ出し`);
      assert.deepEqual(p.__errors, []);
      await p.__ctx.close();
    }
  });
}
