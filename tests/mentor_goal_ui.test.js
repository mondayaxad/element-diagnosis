// MENTOR 目標の選択（mypage の記録内導線とシート）の表示・操作テスト（Playwright）。
// Supabase・/api/my-entitlements・/api/mentor-goal はすべて差し替え。Stripe・DB へは接続しない。
// Playwright が無い環境では skip する。
//   実行: node --test tests/mentor_goal_ui.test.js
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

// world：テストごとの「DB」。ページを読み込み直しても保たれる。
function world(over) {
  return Object.assign({
    appEnv: 'preview',
    rows: [B.row, A.row],
    purchased: { [`ETI-2.0:${A.code}`]: true },
    completeLookup: 'ok',
    records: { 'sess-B': rec(), 'sess-A': rec({ legacyPurchasePending: true }) },
    mentor: {}, // id → { goalId, locked, frozen }
    posts: [], gets: 0, postReply: null,
  }, over || {});
}

async function open(w, { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(w.rows) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: publicConfigJs(w.appEnv) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('**/api/my-entitlements', (r) => {
    const body = { purchased_by_version: w.purchased };
    if (w.completeLookup) body.completeLookup = w.completeLookup;
    if (w.completeLookup === 'ok') {
      body.records = JSON.parse(JSON.stringify(w.records));
      Object.entries(w.mentor).forEach(([id, m]) => { if (body.records[id]) body.records[id].mentorGoal = m.goalId ? { goalId: m.goalId, goalCatalogVersion: CE.MENTOR_CATALOG_VERSION, selectedAt: '2026-10-07T00:00:00Z' } : null; });
    }
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.route('**/api/mentor-goal**', async (r) => {
    const req = r.request();
    const m = (id) => (w.mentor[id] = w.mentor[id] || {});
    const view = (st) => ({ selection: st.goalId ? { goalId: st.goalId, goalCatalogVersion: CE.MENTOR_CATALOG_VERSION, selectedAt: '2026-10-07T00:00:00Z' } : null,
      locked: !!st.locked, checkoutInProgress: !!st.frozen, changeAllowed: !st.locked && !st.frozen });
    if (req.method() === 'GET') {
      w.gets++;
      const id = new URL(req.url()).searchParams.get('diagnosisSessionId');
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({ catalog: CE.MENTOR_CATALOG, eligible: true, ineligibleReason: null, onboardingCompleted: true, legacyPurchasePending: false }, view(m(id)))) });
    }
    const body = JSON.parse(req.postData() || '{}');
    w.posts.push(body);
    await new Promise((res) => setTimeout(res, 150)); // 送信中の表示・連打の確認のため少し待つ
    if (w.postReply) return r.fulfill({ status: w.postReply.status, contentType: 'application/json', body: JSON.stringify(w.postReply.body) });
    const st = m(body.diagnosisSessionId);
    st.goalId = body.goalId;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({ unchanged: false }, view(st))) });
  });
  await p.goto(base + '/mypage.html');
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  // LATEST RESULT・THE RECORDS の購入・閲覧導線は折りたたみ（details）の中にある。開いてから確認する
  await p.evaluate(() => document.querySelectorAll('details.mp-latest-fold, details.mp-rec').forEach((d) => { d.open = true; }));
  p.__errors = errors; p.__ctx = ctx;
  return p;
}
const actions = (p, id, src) => p.locator(`[data-rec-actions="${id}"][data-rec-source="${src}"]`);
const events = (p) => p.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === 'event').map((a) => [a[1], a[2] || {}]));

test('記録内の導線：direct ¥3,000 は「目標を選ぶ」、旧 ¥1,000 の確認中は ¥3,000・¥2,000 を出さない', { skip: skip() }, async () => {
  const w = world();
  const p = await open(w);
  const latestB = actions(p, 'sess-B', 'latest');
  assert.match(await latestB.innerText(), /完全解析 ¥3,000：目標を選ぶ/);
  assert.match(await actions(p, 'sess-B', 'records').innerText(), /完全解析 ¥3,000：目標を選ぶ/);
  const a = await actions(p, 'sess-A', 'records').innerText();
  assert.match(a, /既存の解析レポート購入を確認しています/);
  assert.doesNotMatch(a, /¥3,000|¥2,000/);
  assert.equal(await p.locator('.mp-btn-pending').count(), 0, '準備中ボタンは MENTOR 導線に置き換わる');
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('シート：目標選択 → 送信（連打しても1回）→ 内容確認（¥3,000・決済は押せない）→ LATEST と THE RECORDS が同期', { skip: skip() }, async () => {
  const w = world();
  const p = await open(w);
  const before = (await events(p)).length;
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  assert.equal(await p.locator('#mpUpgradeBody legend').innerText(), '目標');
  const labels = await p.locator('#mpUpgradeBody .ca-goal-label').allInnerTexts();
  const descs = await p.locator('#mpUpgradeBody .ca-goal-desc').allInnerTexts();
  assert.deepEqual(labels, CE.MENTOR_CATALOG.goals.map((g) => g.label));
  assert.deepEqual(descs, CE.MENTOR_CATALOG.goals.map((g) => g.description));
  assert.equal(await p.locator('#mpUpgradeBody input[name="ca-mentor-goal"]:checked').count(), 0, '自動で選ばない');
  // created・checkout_open の時点で変更できなくなるため「支払い完了後」と誤解されない案内にする
  assert.equal(await p.locator('#mpUpgradeBody .ca-mentor-note').innerText(), '5つの中から1つ選んでください。決済手続きへ進んだ後は変更できません。');
  assert.doesNotMatch(await p.locator('#mpUpgradeBody').innerText(), /お支払いの後は変更できません/);
  const submit = p.locator('#mpUpgradeBody [data-mentor-submit]');
  assert.equal(await submit.isDisabled(), true);
  await p.locator('#mpUpgradeBody label.ca-goal-option', { hasText: CE.MENTOR_CATALOG.goals[2].label }).click();
  assert.equal(await submit.isDisabled(), false);
  await submit.click();
  await submit.click({ force: true }).catch(() => {});
  await p.waitForSelector('#mpUpgradeBody .ca-confirm-list');
  assert.equal(w.posts.length, 1, '連打しても送信は1回');
  assert.deepEqual(w.posts[0], { diagnosisSessionId: 'sess-B', goalId: 'GOAL_RELATION_01' });
  const confirm = await p.locator('#mpUpgradeBody').innerText();
  assert.match(confirm, new RegExp(CE.MENTOR_CATALOG.goals[2].label));
  assert.match(confirm, /¥3,000/);
  const pay = p.locator('#mpUpgradeBody button', { hasText: '決済へ進む（準備中）' });
  assert.equal(await pay.isDisabled(), true);
  assert.equal(await pay.getAttribute('href'), null);
  // LATEST RESULT と THE RECORDS（同じ記録）の表示がそろう
  assert.match(await actions(p, 'sess-B', 'latest').innerText(), /MENTOR 目標：選択済み/);
  assert.match(await actions(p, 'sess-B', 'records').innerText(), /MENTOR 目標：選択済み/);
  // 計測は追加しない（目標・記録 ID・説明文を送らない）
  const after = (await events(p)).slice(before);
  const text = JSON.stringify(after);
  assert.ok(!/GOAL_|sess-B|mentor/i.test(text), text);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
  // 再読込（新しいページ）：保存した目標が DB（GET）から復元される
  const q = await open(w);
  assert.match(await actions(q, 'sess-B', 'records').innerText(), /MENTOR 目標：選択済み/);
  await actions(q, 'sess-B', 'records').locator('[data-mentor-open]').click();
  await q.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]:checked');
  assert.equal(await q.locator('#mpUpgradeBody input[name="ca-mentor-goal"]:checked').getAttribute('value'), 'GOAL_RELATION_01');
  await q.__ctx.close();
});

test('再読込後も DB の選択が復元される。戻るで段階を戻り、Escape でシート全体を閉じる', { skip: skip() }, async () => {
  const w = world({ mentor: { 'sess-B': { goalId: 'GOAL_PACE_01' } } });
  const p = await open(w);
  assert.match(await actions(p, 'sess-B', 'latest').innerText(), /MENTOR 目標：選択済み/);
  const histBefore = await p.evaluate(() => history.length);
  const opener = actions(p, 'sess-B', 'latest').locator('[data-mentor-open]');
  await opener.click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]:checked');
  assert.equal(await p.locator('#mpUpgradeBody input[name="ca-mentor-goal"]:checked').getAttribute('value'), 'GOAL_PACE_01');
  // 同じ目標のままなら送信せずに確認へ
  await p.click('#mpUpgradeBody [data-mentor-submit]');
  await p.waitForSelector('#mpUpgradeBody .ca-confirm-list');
  assert.equal(w.posts.length, 0);
  await p.click('#mpUpgradeBody [data-mentor-back="goal"]');
  await p.waitForSelector('#mpUpgradeBody fieldset.ca-goal-fieldset');
  await p.click('#mpUpgradeBody [data-mentor-back="overview"]');
  await p.waitForSelector('#mpUpgradeBody [data-mentor-start]');
  await p.click('#mpUpgradeBody [data-mentor-start]');
  await p.waitForSelector('#mpUpgradeBody fieldset.ca-goal-fieldset');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#mpUpgradeOverlay').isHidden(), true);
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-mentor-open')), true, 'フォーカスは開いたボタンへ戻る');
  assert.equal(await p.evaluate(() => location.hash), '', 'history・hash を使わない');
  assert.equal(await p.evaluate(() => history.length), histBefore, 'history に段階を積まない');
  await p.__ctx.close();
});

test('Tab の一巡に radio を含む（フォーカスはシートの外へ出ない）', { skip: skip() }, async () => {
  const w = world();
  const p = await open(w);
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  const seen = [];
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('Tab');
    seen.push(await p.evaluate(() => {
      const a = document.activeElement;
      const inSheet = !!(a && a.closest('#latest-upgrade-dialog'));
      return `${inSheet ? 'in' : 'OUT'}:${a ? (a.type === 'radio' ? 'radio' : a.tagName) : 'none'}`;
    }));
  }
  assert.ok(seen.every((s) => s.startsWith('in:')), seen.join(','));
  assert.ok(seen.includes('in:radio'), seen.join(','));
  await p.__ctx.close();
});

test('支払後ロック：radio は押せず、内容確認だけ', { skip: skip() }, async () => {
  const w = world({ mentor: { 'sess-B': { goalId: 'GOAL_VISIBLE_01', locked: true } } });
  const p = await open(w);
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  assert.equal(await p.locator('#mpUpgradeBody input[name="ca-mentor-goal"]:not([disabled])').count(), 0);
  assert.match(await p.locator('#mpUpgradeBody').innerText(), /お支払い済みのため、目標は変更できません/);
  assert.equal(await p.locator('#mpUpgradeBody [data-mentor-submit]').count(), 0);
  await p.click('#mpUpgradeBody [data-mentor-confirm]');
  await p.waitForSelector('#mpUpgradeBody .ca-confirm-list');
  await p.__ctx.close();
});

test('送信の失敗：409（決済手続き中）は読み取り表示へ、500 は再試行できる、403 登録未完了はシートを閉じる', { skip: skip() }, async () => {
  let w = world({ postReply: { status: 500, body: { error: 'save_failed', incident_id: 'abcdefabcdef' } } });
  let p = await open(w);
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  await p.locator('#mpUpgradeBody label.ca-goal-option').first().click();
  await p.click('#mpUpgradeBody [data-mentor-submit]');
  await p.waitForSelector('#mpUpgradeBody .ca-mentor-error');
  assert.match(await p.locator('#mpUpgradeBody .ca-mentor-error').innerText(), /保存できませんでした/);
  assert.equal(await p.locator('#mpUpgradeBody [data-mentor-submit]').isDisabled(), false, '再試行できる');
  await p.__ctx.close();

  w = world({ postReply: { status: 409, body: { error: 'checkout_in_progress' } } });
  p = await open(w);
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  await p.locator('#mpUpgradeBody label.ca-goal-option').first().click();
  w.mentor['sess-B'] = { frozen: true };
  await p.click('#mpUpgradeBody [data-mentor-submit]');
  await p.waitForSelector('#mpUpgradeBody .ca-mentor-note >> text=決済手続き中のため');
  assert.equal(await p.locator('#mpUpgradeBody input[name="ca-mentor-goal"]:not([disabled])').count(), 0);
  await p.__ctx.close();

  w = world({ postReply: { status: 403, body: { error: 'onboarding_required' } } });
  p = await open(w);
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  await p.locator('#mpUpgradeBody label.ca-goal-option').first().click();
  await p.click('#mpUpgradeBody [data-mentor-submit]');
  await p.waitForFunction(() => document.getElementById('mpUpgradeOverlay') === null || document.getElementById('mpUpgradeOverlay').hidden);
  await p.__ctx.close();
});

test('upgrade（固定済みの旧購入権）は 追加¥2,000、内容確認も 追加 ¥2,000', { skip: skip() }, async () => {
  const w = world({ records: { 'sess-B': rec(), 'sess-A': rec({ analysisSource: 'legacy_purchase_entitlement' }) } });
  const p = await open(w);
  const a = actions(p, 'sess-A', 'records');
  assert.match(await a.innerText(), /完全解析へ 追加¥2,000：目標を選ぶ/);
  await a.locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  await p.locator('#mpUpgradeBody label.ca-goal-option').nth(1).click();
  await p.click('#mpUpgradeBody [data-mentor-submit]');
  await p.waitForSelector('#mpUpgradeBody .ca-confirm-list');
  const t = await p.locator('#mpUpgradeBody').innerText();
  assert.match(t, /追加 ¥2,000/);
  assert.match(t, /完全解析へのアップグレード/);
  assert.doesNotMatch(t, /¥3,000/);
  await p.__ctx.close();
});

test('完全解析の読み取り失敗・v2 の項目なしでは MENTOR を出さず、従来の表示のまま（Production の停止は mentor_goal_state.test.js）', { skip: skip() }, async () => {
  for (const over of [{ completeLookup: 'failed' }, { completeLookup: null }]) {
    const w = world(over);
    const p = await open(w);
    assert.equal(await p.locator('[data-mentor-open]').count(), 0, JSON.stringify(over));
    assert.match(await actions(p, 'sess-B', 'latest').innerText(), /解析レポート/);
    assert.ok(await p.locator('.mp-btn-pending').count() >= 1, '従来の準備中ボタン');
    await p.click('#mpUpgradeTrigger');
    if (await p.locator('#mpUpgradeBody .ca-pick').count()) await p.click('#mpUpgradeBody [data-pick-index="0"]');
    assert.equal(await p.locator('#mpUpgradeBody [data-mentor-start]').count(), 0);
    assert.equal(w.gets + w.posts.length, 0, 'MENTOR API を呼ばない');
    await p.__ctx.close();
  }
});

test('Tab の一巡（radio を選んだ後・確認の段階）でもシートの外へ出ない', { skip: skip() }, async () => {
  const w = world();
  const p = await open(w);
  await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
  await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
  await p.keyboard.press('ArrowDown'); // radio を選ぶ（送信ボタンが押せるようになる）
  const cycle = async (n) => {
    const out = [];
    for (let i = 0; i < n; i++) { await p.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab'); out.push(await p.evaluate(() => !!(document.activeElement && document.activeElement.closest('#latest-upgrade-dialog')))); }
    return out;
  };
  assert.ok((await cycle(10)).every(Boolean));
  await p.locator('#mpUpgradeBody [data-mentor-submit]').click();
  await p.waitForSelector('#mpUpgradeBody .ca-confirm-list');
  assert.ok((await cycle(8)).every(Boolean));
  await p.__ctx.close();
});

test('320・390・1280px：目標の段階・確認の段階で横スクロールなし、選択肢は 44px 以上', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const w = world();
    const p = await open(w, { width, height: 800 });
    await actions(p, 'sess-B', 'latest').locator('[data-mentor-open]').click();
    await p.waitForSelector('#mpUpgradeBody input[name="ca-mentor-goal"]');
    const check = () => p.evaluate(() => {
      const sheet = document.querySelector('.ca-sheet-scroll');
      return { page: document.documentElement.scrollWidth <= document.documentElement.clientWidth, sheet: sheet.scrollWidth <= sheet.clientWidth };
    });
    assert.deepEqual(await check(), { page: true, sheet: true }, `goal ${width}`);
    const heights = await p.locator('#mpUpgradeBody label.ca-goal-option').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(heights.every((h) => h >= 44), `${width}: ${heights}`);
    for (const sel of ['[data-mentor-submit]', '[data-mentor-back]']) {
      const box = await p.locator(`#mpUpgradeBody ${sel}`).first().boundingBox();
      assert.ok(box.height >= 44, `${width} ${sel} ${box.height}`);
    }
    await p.locator('#mpUpgradeBody label.ca-goal-option').nth(4).click();
    await p.click('#mpUpgradeBody [data-mentor-submit]');
    await p.waitForSelector('#mpUpgradeBody .ca-confirm-list');
    assert.deepEqual(await check(), { page: true, sheet: true }, `confirm ${width}`);
    await p.__ctx.close();
  }
});
