// 診断完了ページの保存導線（A〜D）・端末ヒント・マイページのアップグレード導線の画面テスト（Playwright）。2026-10-07
// Supabase・API・フォントはすべて偽物。Stripe・Kit・DB へは接続しない。Playwright が無い環境では skip する。
//   実行: node --test tests/save_cta_placement_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { previewPublicConfigJs } = require('./fixtures/server_env');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const skip = () => !chromium;
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const HINT = 'ed_registration_known_v1';

// 偽の Supabase。
//   signedIn：最初からログイン中か／status：profiles.onboarding_status／profileError：profiles を読めない
//   userDelayMs：getUser の応答を遅らせる（認証確認中の表示の確認用）／rows：diagnosis_sessions の行（マイページ）
function fakeSupabase({ signedIn = true, status = 'completed', profileError = false, userDelayMs = 0, rows = [] } = {}) {
  return `window.__log = []; window.supabase = { createClient() {
    let user = ${signedIn ? '{ id: "user-1", email: "owner@example.test" }' : 'null'};
    let status = ${JSON.stringify(status)};
    const rows = ${JSON.stringify(rows)};
    const cbs = [];
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    function builder(table) {
      let one = false, inner = false;
      const q = new Proxy({}, { get(_t, k) {
        if (k === 'then') return (res, rej) => {
          let out;
          if (table === 'profiles') {
            window.__log.push('read:profiles');
            out = ${profileError ? '{ data: null, error: { message: "unavailable" } }' : `{ data: { onboarding_status: status, newsletter_sync_status: 'synced', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: null }, error: null }`};
          } else if (table === 'diagnosis_sessions') out = { data: inner ? [] : (one ? (rows[0] || null) : rows), error: null };
          else out = { data: one ? null : [], error: null };
          return Promise.resolve(out).then(res, rej);
        };
        if (k === 'single' || k === 'maybeSingle') return () => { one = true; return q; };
        if (k === 'select') return (cols) => { if (String(cols || '').includes('!inner')) inner = true; return q; };
        return () => q;
      } });
      return q;
    }
    return { from: builder,
      rpc: async (name) => {
        window.__log.push('rpc:' + name);
        if (name === 'complete_registration_onboarding') { status = 'completed'; return { data: { onboarding_status: 'completed', newsletter_sync_status: 'pending' }, error: null }; }
        return { data: null, error: status === 'required' ? { message: 'onboarding_required' } : null };
      },
      auth: {
        getUser: async () => { if (${userDelayMs}) await delay(${userDelayMs}); return { data: { user } }; },
        getSession: async () => ({ data: { session: user ? { access_token: 't' } : null } }),
        onAuthStateChange(cb) { cbs.push(cb); setTimeout(() => cb('INITIAL_SESSION', user ? { access_token: 't' } : null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOtp: async () => { window.__log.push('otp:send'); return { error: null }; },
        verifyOtp: async () => { window.__log.push('otp:verify'); user = { id: 'user-1', email: 'owner@example.test' }; cbs.forEach((cb) => cb('SIGNED_IN', { access_token: 't' })); return { error: null }; },
        signOut: async () => { window.__log.push('signOut'); user = null; cbs.forEach((cb) => cb('SIGNED_OUT', null)); return {}; },
        signInWithOAuth: async () => { window.__log.push('oauth'); return { error: null }; },
      } };
  } };`;
}

// ETI v2 の記録（マイページ用）：正本エンジンで計算した回答・結果から作る
const V2 = (() => {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('this.__make = (k) => { const A = {}; ETI_V2_QUESTIONS.forEach((q, i) => { A[q.id] = ((i * k) % 5) - 2; }); const R = ETIv2.computeResultsV2(A, { elementPrototypes: ELEMENT_PROTOTYPES_V2, weaponPrototypes: WEAPON_PROTOTYPES_V2, nationPrototypes: NATION_PROTOTYPES_V2 }); return { code: ETIv2.encodeAnswersV2(A, ETI_V2_QUESTIONS), R: JSON.parse(JSON.stringify(R)) }; };', ctx);
  return ctx.__make;
})();
function v2Row(id, completedAt, k) {
  const { code, R } = V2(k);
  return { code, row: { id, user_id: 'user-1', completed_at: completedAt, diagnosis_type: 'element', diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0',
    diagnosis_results: [{ primary_result: {}, scores: {}, character_matches: [], diagnosis_code: code, item_set_version: 'ETI-ITEM-2.0.0', scoring_version: 'ETI-SCORE-2.0.0',
      character_profile_version: 'ETI-CHAR-2.1.0', mirror_model_version: 'ETI-MIRROR-2.1.0',
      v2_scores: { personality: R.personality, style: R.style, values: R.values, valuesCentered: R.valuesCentered },
      v2_rankings: { element: R.elementRanking, weapon: R.weaponRanking, nation: R.nationRanking }, mirror_snapshot: [] }],
    diagnosis_answers: [{ encoded_answers: code }] } };
}
const RB = v2Row('sess-B', '2026-10-01T10:00:00Z', 7);
const RA = v2Row('sess-A', '2026-09-20T10:00:00Z', 3);

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

// hint：端末ヒントを最初から入れておくか／pendingV2：未保存の v2 診断を最初から入れておくか／entitlements：/api/my-entitlements の応答
async function openPage(url, { supa = {}, hint = false, pendingV2 = false, width = 390, height = 844, entitlements } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [], popups = [], gtagEvents = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  ctx.on('page', (np) => popups.push(np));
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(supa) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs() }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route(/buy\.stripe\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await p.route('**/api/my-entitlements', (r) => entitlements ? entitlements(r) : r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.route('**/api/subscribe', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await p.exposeFunction('__recordGtag', (name) => { gtagEvents.push(name); });
  await p.addInitScript(({ hint, pendingV2, HINT }) => {
    window.gtag = function (kind, name) { if (kind === 'event' && window.__recordGtag) window.__recordGtag(name); };
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    if (hint) localStorage.setItem(HINT, '1');
    if (pendingV2) localStorage.setItem('pendingDiagnosis_v2', JSON.stringify({ diagnosisType: 'element', diagnosisVersion: 'ETI-2.0', clientSessionId: 'c-1',
      answersV2: [1], encodedAnswers: 'X', results: { personality: {}, style: {}, values: {}, valuesCentered: {}, elementRanking: [], weaponRanking: [], nationRanking: [] }, createdAt: Date.now() }));
  }, { hint, pendingV2, HINT });
  await p.goto(base + url);
  p.__ctx = ctx; p.__errors = errors; p.__popups = popups; p.__gtag = gtagEvents;
  return p;
}

let V2_CODE = null;
async function resultUrl() {
  if (!V2_CODE) V2_CODE = RB.code;
  return `/?dv=ETI-2.0&code=${V2_CODE}`;
}
async function indexResult(opts) {
  const p = await openPage(await resultUrl(), opts);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  // 配置が決まるまで待つ（確認中は data-placement="pending"）
  await p.waitForFunction(() => { const e = document.getElementById('recordEarly'); return e && e.getAttribute('data-placement') !== 'pending'; });
  return p;
}
const log = (p) => p.evaluate(() => window.__log.slice());
const placement = (p) => p.evaluate(() => document.getElementById('recordEarly').getAttribute('data-placement'));
// 早い位置（元素TOP3 の直後）と下部（購入導線の後）の縦位置
async function positions(p) {
  return p.evaluate(() => ({
    early: document.getElementById('recordEarly').getBoundingClientRect().top + scrollY,
    unlock: document.getElementById('lockUnlockAllBtn').getBoundingClientRect().top + scrollY,
    bottom: document.getElementById('recordCardBottom').hidden ? null : document.getElementById('recordCardBottom').getBoundingClientRect().top + scrollY,
  }));
}

// ---------------- 診断完了ページ ----------------

test('A：ログイン中・completed／legacy_exempt は早い位置で保存。モーダルなし・端末ヒントを記録', { skip: skip() }, async () => {
  for (const status of ['completed', 'legacy_exempt']) {
    const p = await indexResult({ supa: { status } });
    assert.equal(await placement(p), 'early', status);
    const btn = p.locator('#recordEarly #recordSaveBtn');
    assert.equal((await btn.innerText()).trim(), 'この結果を診断記録に保存する');
    assert.equal(await p.locator('#recordCardBottom').isHidden(), true);
    const pos = await positions(p);
    assert.ok(pos.early < pos.unlock, '購入導線より前');
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1', 'DB で確認できたので端末ヒントを記録');
    await btn.click();
    await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
    await p.waitForSelector('#recordEarly .rs-done');
    assert.equal(await p.locator('.ro-dialog').count(), 0, 'モーダルを出さない');
    assert.ok(!(await log(p)).includes('rpc:complete_registration_onboarding'));
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('D：ログイン中・required は、開いただけではモーダルを出さない。早い位置は案内だけ、保存は下部', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'required' } });
  await p.waitForTimeout(600);
  assert.equal(await p.locator('.ro-dialog').count(), 0, 'ページを開いただけではモーダルなし');
  assert.equal(await placement(p), 'note');
  assert.match(await p.locator('#recordEarly').innerText(), /この結果は、ページ下部から診断記録に残せます。/);
  assert.equal(await p.locator('#recordEarly button:not(#recordNoteJump), #recordEarly a').count(), 0, '早い位置に保存・ログインのボタンなし');
  const pos = await positions(p);
  assert.ok(pos.bottom > pos.unlock, '保存カードは購入導線の後');
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), null, 'required では端末ヒントを付けない');
  const l = await log(p);
  assert.ok(!l.some((x) => x.startsWith('rpc:')), JSON.stringify(l));
  // 保存を押したときだけモーダル。同意前は保存しない
  await p.locator('#recordCardBottom #recordSaveBtn').click();
  await p.waitForSelector('.ro-dialog');
  assert.ok(!(await log(p)).includes('rpc:save_diagnosis_session_v2'), '同意前は保存しない');
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  const l2 = await log(p);
  assert.ok(l2.indexOf('rpc:complete_registration_onboarding') < l2.indexOf('rpc:save_diagnosis_session_v2'), JSON.stringify(l2));
  await p.waitForSelector('#recordCardBottom .rs-done');
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1', '同意の完了後に端末ヒントを記録');
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('D：required が保存を押してモーダルで「いいえ」→ 保存しない・サインアウト', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'required' } });
  await p.locator('#recordCardBottom #recordSaveBtn').click();
  await p.waitForSelector('.ro-dialog');
  await p.locator('#roNo').click();
  await p.waitForFunction(() => window.__log.includes('signOut'));
  const l = await log(p);
  assert.ok(!l.includes('rpc:save_diagnosis_session_v2') && !l.includes('rpc:complete_registration_onboarding'), JSON.stringify(l));
  await p.waitForSelector('#recordCardBottom #recordAuth', { state: 'attached' });
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), null);
  await p.__ctx.close();
});

test('C：ログアウト中・端末ヒントなし：早い位置は案内だけ。押しても下部へスクロールするだけ', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false } });
  assert.equal(await placement(p), 'note');
  assert.equal(await p.locator('#recordEarly #recordAuth, #recordEarly #recordLoginBtn, #recordEarly #recordSaveBtn').count(), 0);
  await p.waitForSelector('#recordCardBottom #recordAuth [data-au="google"]', { state: 'attached' });
  const pos = await positions(p);
  assert.ok(pos.bottom > pos.unlock && pos.early < pos.unlock);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.locator('#recordNoteJump').click();
  await p.waitForFunction(() => { const r = document.getElementById('recordCardBottom').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
  const l = await log(p);
  assert.ok(!l.includes('oauth') && !l.includes('otp:send') && !l.some((x) => x.startsWith('rpc:')), JSON.stringify(l));
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  await p.__ctx.close();
});

test('B：ログアウト中・端末ヒントあり：早い位置に「ログインして診断記録に保存する」。ヒントだけでは保存・同意しない', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false }, hint: true });
  assert.equal(await placement(p), 'early');
  const btn = p.locator('#recordEarly #recordLoginBtn');
  assert.equal((await btn.innerText()).trim(), 'ログインして診断記録に保存する');
  assert.equal(await p.locator('#recordCardBottom').isHidden(), true);
  await p.waitForTimeout(300);
  const l = await log(p);
  assert.ok(!l.some((x) => x.startsWith('rpc:')), 'ヒントだけでは保存も同意もしない ' + JSON.stringify(l));
  // 押すとログイン方法を出すだけ（まだログイン・保存しない）
  await btn.click();
  await p.waitForSelector('#recordEarly #recordAuth [data-au="google"]');
  assert.ok(!(await log(p)).some((x) => x === 'oauth' || x.startsWith('rpc:')));
  await p.__ctx.close();
});

test('B→ログイン後に DB が required（ヒントの偽陽性）：保存の前に必ずモーダル', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false, status: 'required' }, hint: true });
  await p.locator('#recordEarly #recordLoginBtn').click();
  await p.locator('#recordEarly [data-au="email"]').click();
  await p.locator('#auEmail').fill('owner@example.test');
  await p.locator('#auSend').click();
  await p.locator('#auCode').fill('123456');
  await p.waitForSelector('.ro-dialog');
  assert.ok(!(await log(p)).includes('rpc:save_diagnosis_session_v2'), 'モーダルの前に保存しない');
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  const l = await log(p);
  assert.ok(l.indexOf('rpc:complete_registration_onboarding') < l.indexOf('rpc:save_diagnosis_session_v2'), JSON.stringify(l));
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('B→ログイン後に DB が completed：モーダルなしで保存', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false, status: 'completed' }, hint: true });
  await p.locator('#recordEarly #recordLoginBtn').click();
  await p.locator('#recordEarly [data-au="email"]').click();
  await p.locator('#auEmail').fill('owner@example.test');
  await p.locator('#auSend').click();
  await p.locator('#auCode').fill('123456');
  await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  await p.waitForSelector('#recordEarly .rs-done');
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  assert.ok(!(await log(p)).includes('rpc:complete_registration_onboarding'));
  await p.__ctx.close();
});

test('DB の登録状態を確認できない：保存ボタンを出さず、保存もしない（fail-closed）', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'completed', profileError: true }, hint: true });
  assert.equal(await p.locator('#recordEarly').getAttribute('data-state'), 'registration_unknown');
  assert.equal(await p.locator('#recordSaveBtn').count(), 0);
  assert.equal(await p.locator('#recordRecheckBtn').innerText(), 'もう一度確認する');
  await p.waitForTimeout(300);
  assert.ok(!(await log(p)).some((x) => x.startsWith('rpc:')));
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  await p.__ctx.close();
});

test('認証状態の確認中は中立の表示だけ（誤った保存・ログイン導線を一瞬も出さない）', { skip: skip() }, async () => {
  for (const supa of [{ signedIn: true, status: 'completed', userDelayMs: 3000 }, { signedIn: false, userDelayMs: 3000 }]) {
    const p = await openPage(await resultUrl(), { supa });
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    assert.equal(await placement(p), 'pending', JSON.stringify(supa));
    assert.equal(await p.locator('#recordSaveBtn, #recordLoginBtn, #recordAuth, .rs-note').count(), 0);
    assert.equal(await p.locator('#recordCardBottom').isHidden(), true);
    // 確定後は1回だけ描画する
    await p.waitForFunction(() => document.getElementById('recordEarly').getAttribute('data-placement') !== 'pending');
    await p.__ctx.close();
  }
});

test('ログアウトしても端末ヒントは残る（ほかの保存データは入れない）', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'completed' } });
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1');
  await p.evaluate(() => signOutUser());
  await p.waitForFunction(() => window.__log.includes('signOut'));
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1');
  // ヒントの値は '1' だけ（メール・ID・トークンを含まない）
  const all = await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  assert.ok(!all.includes('owner@example.test') && !all.includes('user-1'), all);
  await p.__ctx.close();
});

test('認証復帰時に pending があれば、従来どおり保存を再開する（required ならモーダル）', { skip: skip() }, async () => {
  const p = await openPage('/', { supa: { status: 'required' }, pendingV2: true });
  await p.waitForSelector('.ro-dialog');
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  await p.waitForFunction(() => !localStorage.getItem('pendingDiagnosis_v2'));
  await p.__ctx.close();
  // completed：モーダルなしで保存
  const q = await openPage('/', { supa: { status: 'completed' }, pendingV2: true });
  await q.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  assert.equal(await q.locator('.ro-dialog').count(), 0);
  await q.__ctx.close();
});

test('トップ（結果以外）を開いただけでは、required でもモーダルを出さない', { skip: skip() }, async () => {
  const p = await openPage('/', { supa: { status: 'required' } });
  await p.waitForTimeout(800);
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  assert.ok(!(await log(p)).includes('rpc:complete_registration_onboarding'));
  await p.__ctx.close();
});

test('診断完了ページ：320／390／1280px で横スクロールしない（A・C）', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    for (const opts of [{ supa: { status: 'completed' } }, { supa: { signedIn: false } }]) {
      const p = await indexResult(Object.assign({ width }, opts));
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width} ${JSON.stringify(opts)}`);
      await p.__ctx.close();
    }
  }
});

// ---------------- マイページ ----------------

async function mypage(opts) {
  const p = await openPage(opts.url || '/mypage.html', opts);
  await p.waitForSelector(opts.waitFor || '.mp-latest', { state: 'attached' });
  return p;
}
const purchasedFor = (...codes) => (r) => r.fulfill({ contentType: 'application/json',
  body: JSON.stringify({ purchased_by_version: Object.fromEntries(codes.map((c) => [`ETI-2.0:${c}`, true])) }) });

test('マイページ：購入状態APIが失敗してもアコーディオンは開閉でき、記録内に「もう一度確認する」', { skip: skip() }, async () => {
  const p = await mypage({ supa: { rows: [RB.row, RA.row] }, entitlements: (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service_unavailable"}' }) });
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), '状態を確認');
  for (const i of [0, 1]) {
    const d = p.locator(`#mp-rec-${i}`);
    await d.locator('summary').click();
    assert.equal(await d.evaluate((e) => e.open), true, 'open ' + i);
    assert.match(await d.innerText(), /この記録の購入状態を確認できませんでした/);
    assert.equal(await d.locator('.mp-notice button').innerText(), 'もう一度確認する');
    assert.equal(await d.locator('a[href*="buy.stripe"], button.is-pending, [data-session-id]').count(), 0, '購入・閲覧ボタンを出さない');
    await d.locator('summary').click();
    assert.equal(await d.evaluate((e) => e.open), false, 'close ' + i);
  }
  // 再確認：API が回復すれば購入導線が戻る
  await p.unroute('**/api/my-entitlements');
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.locator('#mp-rec-0 summary').click();
  await p.locator('#mp-rec-0 .mp-notice button').click();
  await p.waitForSelector('#mp-rec-0 .mp-rec-actions', { state: 'attached' });
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), 'アップグレード');
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('マイページ：記録内CTA（無料のみ／解析購入済み）と準備中ボタン。準備中は押しても遷移・計測しない', { skip: skip() }, async () => {
  // B＝解析レポート購入済み、A＝無料のみ
  const p = await mypage({ supa: { rows: [RB.row, RA.row] }, entitlements: purchasedFor(RB.code) });
  // A（無料のみ）
  await p.locator('#mp-rec-1 summary').click();
  const a = p.locator('#mp-rec-1 .mp-rec-actions');
  const aBtns = await a.locator('a, button').allInnerTexts();
  assert.deepEqual(aBtns.map((t) => t.trim()), ['解析レポート　¥1,000', '完全解析 ¥3,000（準備中）']);
  assert.match(await a.locator('a').getAttribute('href'), /buy\.stripe\.com\/test_.*client_reference_id=v2_/);
  // B（解析レポート購入済み）
  await p.locator('#mp-rec-0 summary').click();
  const b = p.locator('#mp-rec-0 .mp-rec-actions');
  assert.deepEqual((await b.locator('a, button').allInnerTexts()).map((t) => t.trim()), ['解析レポートを見る', '完全解析へアップグレード ¥2,000（準備中）']);
  // 準備中ボタン：button・disabled・href なし。強制クリックしても外部遷移・決済イベントなし
  for (const sel of ['#mp-rec-1 button.is-pending', '#mp-rec-0 button.is-pending']) {
    const btn = p.locator(sel);
    assert.equal(await btn.evaluate((e) => e.tagName), 'BUTTON');
    assert.equal(await btn.isDisabled(), true);
    assert.equal(await btn.getAttribute('href'), null);
    assert.equal(await btn.getAttribute('onclick'), null);
    const url = p.url(); const before = p.__gtag.length;
    await btn.click({ force: true });
    await btn.evaluate((e) => e.click());
    await p.waitForTimeout(200);
    assert.equal(p.url(), url);
    assert.equal(p.__popups.length, 0, '新しいタブを開かない');
    assert.equal(p.__gtag.length, before, '計測イベントを送らない');
  }
  await p.__ctx.close();
});

test('マイページ：完全解析購入済みの記録は「解析レポートを見る」「完全解析を見る」', { skip: skip() }, async () => {
  const p = await mypage({ url: '/mypage.html?preview_entitlement=complete-ready', supa: { rows: [RB.row] } });
  await p.locator('#mp-rec-0 summary').click();
  assert.deepEqual((await p.locator('#mp-rec-0 .mp-rec-actions button').allInnerTexts()).map((t) => t.trim()), ['解析レポートを見る', '完全解析を見る']);
  assert.equal(await p.locator('#mp-rec-0 button.is-pending').count(), 0);
  // 記録1件：右上は「完全解析を見る」。シートは記録を選ばせずに開く
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), '完全解析を見る');
  await p.click('#mpUpgradeTrigger');
  assert.equal(await p.locator('#mpUpgradeBody .ca-pick').count(), 0);
  assert.equal(await p.locator('#mpUpgradeBody').getByText('完全解析を見る').count(), 1);
  await p.__ctx.close();
});

test('マイページ：記録1件はその記録が選択済み。右上の文言は状態で変わる', { skip: skip() }, async () => {
  const f = await mypage({ supa: { rows: [RA.row] } });
  assert.equal(await f.locator('#mpUpgradeTrigger').innerText(), 'アップグレード');
  await f.click('#mpUpgradeTrigger');
  assert.equal(await f.locator('#mpUpgradeBody .ca-pick').count(), 0);
  assert.equal(await f.locator('#mpUpgradeBody .ca-card--primary a[href*="buy.stripe"]').count(), 1);
  assert.equal((await f.locator('#mpUpgradeBody button.is-pending').innerText()).trim(), '完全解析 ¥3,000（準備中）');
  await f.__ctx.close();
  const a = await mypage({ supa: { rows: [RA.row] }, entitlements: purchasedFor(RA.code) });
  assert.equal(await a.locator('#mpUpgradeTrigger').innerText(), '完全解析へ');
  await a.click('#mpUpgradeTrigger');
  assert.equal((await a.locator('#mpUpgradeBody button.is-pending').innerText()).trim(), '完全解析へアップグレード ¥2,000（準備中）');
  assert.equal(await a.locator('#mpUpgradeBody a[href*="buy.stripe"]').count(), 0);
  await a.__ctx.close();
});

test('マイページ：記録が複数なら、対象を選ぶまで購入導線を確定しない（日付・結果を表示）', { skip: skip() }, async () => {
  const p = await mypage({ supa: { rows: [RB.row, RA.row] } });
  await p.click('#mpUpgradeTrigger');
  const body = p.locator('#mpUpgradeBody');
  assert.match(await body.innerText(), /どの診断記録をアップグレードしますか/);
  const picks = body.locator('.ca-pick');
  assert.equal(await picks.count(), 2);
  for (const t of await picks.allInnerTexts()) assert.match(t, /\d{4}/, '日付');
  assert.equal(await body.locator('a[href*="buy.stripe"], button.is-pending, .ca-card').count(), 0, '選ぶまで購入導線なし');
  // 過去A を選ぶと、A の診断コードの導線だけになる（最新B ではない）
  await body.locator('[data-pick-index="1"]').click();
  const href = await body.locator('.ca-card--primary a[href*="buy.stripe"]').getAttribute('href');
  assert.ok(href.includes(encodeURIComponent('v2_' + RA.code)) || href.includes('v2_' + RA.code), 'A のコード');
  assert.ok(!href.includes(RB.code), 'B のコードではない');
  await p.__ctx.close();
});

test('マイページ：320／390／1280px で横スクロールしない（記録を開いた状態・シート）', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await mypage({ supa: { rows: [RB.row, RA.row] }, entitlements: purchasedFor(RB.code), width });
    await p.locator('#mp-rec-0 summary').click();
    await p.locator('#mp-rec-1 summary').click();
    const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
      && Array.from(document.querySelectorAll('.mp-rec-actions *')).every((e) => e.getBoundingClientRect().right <= window.innerWidth + 0.5));
    assert.ok(await fits(), 'page ' + width);
    // 狭い画面では縦並び
    const dir = await p.locator('#mp-rec-1 .mp-rec-actions').evaluate((e) => getComputedStyle(e).flexDirection);
    assert.equal(dir, width <= 420 ? 'column' : 'row', 'direction ' + width);
    // 右上の入口は見出しと重ならず、画面内に収まる
    const t = await p.locator('#mpUpgradeTrigger').boundingBox();
    assert.ok(t.x >= 0 && t.x + t.width <= width, 'trigger in view ' + width);
    await p.click('#mpUpgradeTrigger');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
      && Array.from(document.querySelectorAll('#mpUpgradeBody *')).every((e) => e.getBoundingClientRect().right <= window.innerWidth + 0.5)), 'sheet ' + width);
    await p.__ctx.close();
  }
});
