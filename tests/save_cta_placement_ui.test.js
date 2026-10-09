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
    const saved = []; // 保存された記録（結果ページの「保存済みか」の確認に返す）
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
          } else if (table === 'diagnosis_sessions') out = { data: inner ? saved.slice() : (one ? (rows[0] || null) : rows), error: null };
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
      rpc: async (name, a) => {
        window.__log.push('rpc:' + name);
        if (name === 'complete_registration_onboarding') { status = 'completed'; return { data: { onboarding_status: 'completed', newsletter_sync_status: 'pending' }, error: null }; }
        if (window.__saveFails && name.startsWith('save_diagnosis_session')) return { data: null, error: { message: 'network' } };
        if (status === 'required') return { data: null, error: { message: 'onboarding_required' } };
        if (name === 'save_diagnosis_session_v2') saved.push({ id: 'saved-' + saved.length, diagnosis_version: 'ETI-2.0', item_set_version: a.p_item_set_version || 'ETI-ITEM-2.0.0',
          diagnosis_results: [{ diagnosis_code: a.p_encoded_answers, scoring_version: a.p_scoring_version || 'ETI-SCORE-2.0.0', item_set_version: a.p_item_set_version || 'ETI-ITEM-2.0.0' }] });
        return { data: null, error: null };
      },
      auth: {
        getUser: async () => { if (${userDelayMs}) await delay(${userDelayMs}); return { data: { user } }; },
        getSession: async () => ({ data: { session: user ? { access_token: 't' } : null } }),
        onAuthStateChange(cb) { cbs.push(cb); setTimeout(() => cb('INITIAL_SESSION', user ? { access_token: 't' } : null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithOtp: async () => { window.__log.push('otp:send'); return { error: null }; },
        verifyOtp: async () => { window.__log.push('otp:verify'); user = { id: 'user-1', email: 'owner@example.test' }; cbs.forEach((cb) => cb('SIGNED_IN', { access_token: 't' })); return { error: null }; },
        signOut: async () => { window.__log.push('signOut'); user = null; cbs.forEach((cb) => cb('SIGNED_OUT', null)); return {}; },
        signInWithOAuth: async (o) => { window.__log.push('oauth'); window.__log.push('oauth:' + new URL(o.options.redirectTo).pathname); return { error: null }; },
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

// hint：端末ヒントを最初から入れておくか／pendingV2：未保存の v2 診断を最初から入れておくか（文字列ならその診断コード）
// seed：最初に入れておく localStorage／entitlements：/api/my-entitlements の応答
async function openPage(url, { supa = {}, hint = false, pendingV2 = false, seed = {}, width = 390, height = 844, entitlements, salesOpen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [], popups = [], gtagEvents = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  ctx.on('page', (np) => popups.push(np));
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(supa) }));
  // salesOpen：販売中の表示（公開設定の completeSalesOpen。サーバー・Stripe には接続しない）
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs(salesOpen ? { completeSalesOpen: true, completeApiReady: true } : {}) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route(/buy\.stripe\.com/, (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await p.route('**/api/my-entitlements', (r) => entitlements ? entitlements(r) : r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.route('**/api/subscribe', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await p.exposeFunction('__recordGtag', (name) => { gtagEvents.push(name); });
  await p.addInitScript(({ hint, pendingV2, seed, HINT }) => {
    window.gtag = function (kind, name) { if (kind === 'event' && window.__recordGtag) window.__recordGtag(name); };
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    if (hint) localStorage.setItem(HINT, '1');
    if (pendingV2) localStorage.setItem('pendingDiagnosis_v2', JSON.stringify({ diagnosisType: 'element', diagnosisVersion: 'ETI-2.0', clientSessionId: 'c-1',
      answersV2: [1], encodedAnswers: typeof pendingV2 === 'string' ? pendingV2 : 'X', results: { personality: {}, style: {}, values: {}, valuesCentered: {}, elementRanking: [], weaponRanking: [], nationRanking: [] }, createdAt: Date.now() }));
    Object.keys(seed).forEach((k) => localStorage.setItem(k, typeof seed[k] === 'function' ? seed[k]() : seed[k]));
  }, { hint, pendingV2, seed, HINT });
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
  // 状態が決まるまで待つ（確認中は data-state="pending"）
  await p.waitForFunction(() => { const e = document.getElementById('recordCard'); return e && e.getAttribute('data-state') !== 'pending'; });
  return p;
}
const log = (p) => p.evaluate(() => window.__log.slice());
const cardState = (p) => p.evaluate(() => document.getElementById('recordCard').getAttribute('data-state'));
// 保存カードは元素TOP3の直後・購入導線より前の1か所だけ
async function assertSingleEarlyCard(p, msg) {
  const r = await p.evaluate(() => ({
    cards: document.querySelectorAll('#recordCard, #recordEarly, #recordCardBottom, .rs-card').length,
    note: document.querySelectorAll('.rs-note, #recordNoteJump').length,
    card: document.getElementById('recordCard').getBoundingClientRect().top + scrollY,
    unlock: document.getElementById('lockUnlockAllBtn').getBoundingClientRect().top + scrollY,
    share: document.getElementById('saveImgBtn').getBoundingClientRect().top + scrollY,
  }));
  assert.equal(r.cards, 1, '保存カードは1つ ' + (msg || ''));
  assert.equal(r.note, 0, '「下部の保存へ」の案内なし');
  assert.ok(r.card < r.share && r.card < r.unlock, '画像保存・購入導線より前 ' + (msg || ''));
}
const btnText = (p, sel) => p.locator(sel).innerText().then((t) => t.trim());

// ---------------- 診断完了ページ ----------------

test('ログイン中・completed／legacy_exempt：「この結果を診断記録に保存する」。モーダルなしで保存し、同じページで「保存しました」', { skip: skip() }, async () => {
  for (const status of ['completed', 'legacy_exempt']) {
    const p = await indexResult({ supa: { status } });
    await assertSingleEarlyCard(p, status);
    assert.equal(await btnText(p, '#recordCard #recordSaveBtn'), 'この結果を診断記録に保存する');
    assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1', 'DB で確認できたので端末ヒントを記録');
    const url = p.url();
    await p.locator('#recordSaveBtn').click();
    await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
    await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'just_saved');
    assert.match(await p.locator('#recordCard').innerText(), /✓ 診断記録に保存しました/);
    assert.match(await p.locator('#recordCard a[href="/mypage.html"]').innerText(), /マイページで確認する/);
    assert.equal(p.url(), url, 'マイページへ自動で移動しない');
    // 結果閲覧・画像保存・Xシェア・購入導線はそのまま続けられる
    for (const sel of ['#saveImgBtn', '#tweetShareBtn', '#lockUnlockAllBtn']) assert.equal(await p.locator(sel).isVisible(), true, sel);
    assert.equal(await p.locator('.ro-dialog').count(), 0, 'モーダルを出さない');
    assert.ok(!(await log(p)).includes('rpc:complete_registration_onboarding'));
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('ログイン中・required：開いただけではモーダルなし。「登録を完了して診断記録に保存する」を押したときだけモーダル → 同意 → 保存', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'required' } });
  await p.waitForTimeout(600);
  assert.equal(await p.locator('.ro-dialog').count(), 0, 'ページを開いただけではモーダルなし');
  await assertSingleEarlyCard(p);
  assert.equal(await btnText(p, '#recordCard #recordSaveBtn'), '登録を完了して診断記録に保存する');
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), null, 'required では端末ヒントを付けない');
  assert.ok(!(await log(p)).some((x) => x.startsWith('rpc:')));
  const url = p.url();
  await p.locator('#recordSaveBtn').click();
  await p.waitForSelector('.ro-dialog');
  assert.ok(!(await log(p)).includes('rpc:save_diagnosis_session_v2'), '同意前は保存しない');
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  const l = await log(p);
  assert.ok(l.indexOf('rpc:complete_registration_onboarding') < l.indexOf('rpc:save_diagnosis_session_v2'), JSON.stringify(l));
  await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'just_saved');
  assert.equal(p.url(), url, 'マイページへ自動で移動しない');
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1', '同意の完了後に端末ヒントを記録');
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('required がモーダルで「いいえ」→ 保存しない・サインアウトし、未登録の表示に戻る', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'required' } });
  await p.locator('#recordSaveBtn').click();
  await p.waitForSelector('.ro-dialog');
  await p.locator('#roNo').click();
  await p.waitForFunction(() => window.__log.includes('signOut'));
  const l = await log(p);
  assert.ok(!l.includes('rpc:save_diagnosis_session_v2') && !l.includes('rpc:complete_registration_onboarding'), JSON.stringify(l));
  await p.waitForSelector('#recordCard #recordLoginBtn');
  assert.equal(await btnText(p, '#recordLoginBtn'), '無料登録して診断記録に保存する');
  await p.__ctx.close();
});

test('ログアウト中・端末ヒントなし：上部に「無料登録して診断記録に保存する」と補足。押すまでログイン・保存しない', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false } });
  await assertSingleEarlyCard(p);
  assert.equal(await btnText(p, '#recordCard #recordLoginBtn'), '無料登録して診断記録に保存する');
  assert.match(await p.locator('#recordCard').innerText(), /保存後も、このページで結果を続けてご覧いただけます。/);
  assert.equal(await p.locator('#recordAuth').isHidden(), true);
  await p.locator('#recordLoginBtn').click();
  await p.waitForSelector('#recordCard #recordAuth [data-au="google"]');
  const l = await log(p);
  assert.ok(!l.includes('oauth') && !l.includes('otp:send') && !l.some((x) => x.startsWith('rpc:')), JSON.stringify(l));
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  await p.__ctx.close();
});

test('ログアウト中・端末ヒントあり：「ログインして診断記録に保存する」。ヒントは文言だけで、保存・同意しない', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false }, hint: true });
  await assertSingleEarlyCard(p);
  assert.equal(await btnText(p, '#recordCard #recordLoginBtn'), 'ログインして診断記録に保存する');
  assert.doesNotMatch(await p.locator('#recordCard').innerText(), /無料登録/);
  await p.waitForTimeout(300);
  assert.ok(!(await log(p)).some((x) => x.startsWith('rpc:')), 'ヒントだけでは保存も同意もしない');
  await p.locator('#recordLoginBtn').click();
  await p.waitForSelector('#recordCard #recordAuth [data-au="google"]');
  assert.ok(!(await log(p)).some((x) => x === 'oauth' || x.startsWith('rpc:')));
  await p.__ctx.close();
});

test('メールOTP：ログイン後に DB が required（ヒントの偽陽性）でも必ずモーダル → 保存後も同じページ', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false, status: 'required' }, hint: true });
  const url = p.url();
  await p.locator('#recordLoginBtn').click();
  await p.locator('#recordCard [data-au="email"]').click();
  await p.locator('#auEmail').fill('owner@example.test');
  await p.locator('#auSend').click();
  await p.locator('#auCode').fill('123456');
  await p.waitForSelector('.ro-dialog');
  assert.ok(!(await log(p)).includes('rpc:save_diagnosis_session_v2'), 'モーダルの前に保存しない');
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'just_saved');
  const l = await log(p);
  assert.ok(l.indexOf('rpc:complete_registration_onboarding') < l.indexOf('rpc:save_diagnosis_session_v2'), JSON.stringify(l));
  assert.equal(l.filter((x) => x === 'rpc:save_diagnosis_session_v2').length, 1, '保存は1回だけ');
  assert.equal(p.url(), url);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('メールOTP：ログイン後に DB が completed ならモーダルなしで保存し、同じページで「保存しました」', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false, status: 'completed' } });
  const url = p.url();
  await p.locator('#recordLoginBtn').click();
  await p.locator('#recordCard [data-au="email"]').click();
  await p.locator('#auEmail').fill('owner@example.test');
  await p.locator('#auSend').click();
  await p.locator('#auCode').fill('123456');
  await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'just_saved');
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  assert.equal((await log(p)).filter((x) => x === 'rpc:save_diagnosis_session_v2').length, 1, '保存は1回だけ');
  assert.equal(p.url(), url);
  await p.__ctx.close();
});

test('Google：認証へ進む前に戻り先（この結果ページ）を残す', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { signedIn: false } });
  await p.locator('#recordLoginBtn').click();
  await p.locator('#recordCard [data-au="google"]').click();
  await p.waitForFunction(() => window.__log.includes('oauth'));
  const ret = await p.evaluate(() => JSON.parse(localStorage.getItem('ed_save_return_v1')));
  assert.equal(ret.url, `${base}/?dv=ETI-2.0&code=${RB.code}&mv=${new URL(ret.url).searchParams.get('mv')}`);
  assert.ok(await p.evaluate(() => !!localStorage.getItem('pendingDiagnosis_v2')), 'pending を退避');
  await p.__ctx.close();
});

test('Google・X の認証から戻ったマイページ：表示せず結果ページの保存カードへ戻り、そこで保存して「保存しました」', { skip: skip() }, async () => {
  const resultPath = `/?dv=ETI-2.0&code=${RB.code}`;
  for (const status of ['completed', 'required']) {
    const p = await openPage('/mypage.html?code=auth-code', { supa: { status }, pendingV2: RB.code,
      seed: { ed_save_return_v1: JSON.stringify({ url: base + resultPath, at: Date.now() }) } });
    await p.waitForURL((u) => u.pathname === '/' && u.searchParams.get('code') === RB.code);
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    if (status === 'required') {
      // 結果ページで規約モーダル（マイページでは出さない）
      await p.waitForSelector('.ro-dialog');
      await p.locator('#roAll').check();
      await p.locator('#roYes').click();
    }
    await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'just_saved');
    assert.match(await p.locator('#recordCard').innerText(), /✓ 診断記録に保存しました/, status);
    assert.equal(new URL(p.url()).pathname, '/', '結果ページに留まる ' + status);
    assert.ok(await p.evaluate(() => !localStorage.getItem('pendingDiagnosis_v2')), '保存成功後に pending を削除');
    assert.ok(await p.evaluate(() => !localStorage.getItem('ed_save_return_v1')), '戻り先の印は1回で消す');
    assert.equal((await log(p)).filter((x) => x === 'rpc:save_diagnosis_session_v2').length, 1, '保存は1回だけ ' + status);
    // 保存カードが画面内にある（レイアウトが落ち着いた後も）
    await p.waitForFunction(() => { const r = document.getElementById('recordCard').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }, null, { timeout: 4000 });
    await p.waitForTimeout(2200);
    assert.ok(await p.locator('#recordCard').evaluate((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }), 'card in view ' + status);
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('戻り先の印があっても、認証から戻ったのでなければマイページは通常どおり表示する', { skip: skip() }, async () => {
  const p = await openPage('/mypage.html', { supa: { rows: [] }, seed: { ed_save_return_v1: JSON.stringify({ url: base + '/?code=x', at: Date.now() }) } });
  await p.waitForSelector('#mpUpgradeTrigger');
  assert.equal(new URL(p.url()).pathname, '/mypage.html');
  await p.__ctx.close();
  // 別サイトの URL は受け付けない
  const q = await openPage('/mypage.html?code=auth-code', { supa: { rows: [] }, seed: { ed_save_return_v1: JSON.stringify({ url: 'https://evil.example/?code=x', at: Date.now() }) } });
  await q.waitForSelector('#mpUpgradeTrigger');
  assert.equal(new URL(q.url()).host, new URL(base).host);
  await q.__ctx.close();
});

test('OAuth をキャンセル・失敗して戻っても pending は残り、結果ページで再試行できる', { skip: skip() }, async () => {
  const p = await openPage('/mypage.html?error=access_denied&error_description=cancelled', { supa: { signedIn: false }, pendingV2: RB.code,
    seed: { ed_save_return_v1: JSON.stringify({ url: `${base}/?dv=ETI-2.0&code=${RB.code}`, at: Date.now() }) } });
  await p.waitForURL((u) => u.pathname === '/' && u.searchParams.get('code') === RB.code);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'signed_out');
  assert.equal(await btnText(p, '#recordLoginBtn'), '無料登録して診断記録に保存する', '再試行できる');
  assert.ok(await p.evaluate(() => !!localStorage.getItem('pendingDiagnosis_v2')), 'pending を失わない');
  assert.ok(!(await log(p)).some((x) => x.startsWith('rpc:')));
  await p.__ctx.close();
});

test('戻り先の印：印の無い通常のマイページログインは移動しない・60分を過ぎた印は無効', { skip: skip() }, async () => {
  // 認証から戻った（?code=）が、印が無い：通常どおりマイページ
  const p = await openPage('/mypage.html?code=auth-code', { supa: { rows: [] } });
  await p.waitForSelector('#mpUpgradeTrigger');
  assert.equal(new URL(p.url()).pathname, '/mypage.html');
  await p.__ctx.close();
  // 60分を過ぎた印は使わず、消す
  const q = await openPage('/mypage.html?code=auth-code', { supa: { rows: [] },
    seed: { ed_save_return_v1: JSON.stringify({ url: `${base}/?code=x`, at: Date.now() - 61 * 60 * 1000 }) } });
  await q.waitForSelector('#mpUpgradeTrigger');
  assert.equal(new URL(q.url()).pathname, '/mypage.html');
  assert.equal(await q.evaluate(() => localStorage.getItem('ed_save_return_v1')), null);
  await q.__ctx.close();
});

test('保存に失敗したら pending を残し、「もう一度試す」で再試行できる（成功時だけ pending を削除・二重保存なし）', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'completed' } });
  await p.evaluate(() => { window.__saveFails = true; });
  await p.locator('#recordSaveBtn').click();
  await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'error');
  assert.ok(await p.evaluate(() => !!localStorage.getItem('pendingDiagnosis_v2')), '失敗時は pending を残す');
  assert.equal(await btnText(p, '#recordSaveBtn'), 'もう一度試す');
  await p.evaluate(() => { window.__saveFails = false; window.__log.length = 0; });
  // 連打しても保存は1回
  await p.locator('#recordSaveBtn').evaluate((b) => { b.click(); b.click(); });
  await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') === 'just_saved');
  assert.equal((await log(p)).filter((x) => x === 'rpc:save_diagnosis_session_v2').length, 1);
  assert.ok(await p.evaluate(() => !localStorage.getItem('pendingDiagnosis_v2')), '成功後に pending を削除');
  await p.__ctx.close();
});

test('DB の登録状態を確認できない：「登録状態を確認できませんでした」と「もう一度確認する」。保存ボタンなし', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'completed', profileError: true }, hint: true });
  assert.equal(await cardState(p), 'registration_unknown');
  assert.match(await p.locator('#recordCard').innerText(), /登録状態を確認できませんでした/);
  assert.equal(await p.locator('#recordSaveBtn, #recordLoginBtn').count(), 0);
  assert.equal(await btnText(p, '#recordRecheckBtn'), 'もう一度確認する');
  await p.waitForTimeout(300);
  assert.ok(!(await log(p)).some((x) => x.startsWith('rpc:')));
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  await p.__ctx.close();
});

test('認証状態の確認中は中立の表示だけ（誤った保存・ログイン導線を一瞬も出さない）', { skip: skip() }, async () => {
  for (const supa of [{ signedIn: true, status: 'completed', userDelayMs: 3000 }, { signedIn: false, userDelayMs: 3000 }]) {
    const p = await openPage(await resultUrl(), { supa });
    await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
    assert.equal(await cardState(p), 'pending', JSON.stringify(supa));
    assert.equal(await p.locator('#recordSaveBtn, #recordLoginBtn, #recordAuth').count(), 0);
    await p.waitForFunction(() => document.getElementById('recordCard').getAttribute('data-state') !== 'pending');
    await p.__ctx.close();
  }
});

test('ログアウトしても端末ヒントは残る（ほかの保存データは入れない）', { skip: skip() }, async () => {
  const p = await indexResult({ supa: { status: 'completed' } });
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1');
  await p.evaluate(() => signOutUser());
  await p.waitForFunction(() => window.__log.includes('signOut'));
  assert.equal(await p.evaluate((k) => localStorage.getItem(k), HINT), '1');
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

test('診断完了ページ：320／390／1280px で横スクロールしない（全状態）', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    for (const opts of [{ supa: { status: 'completed' } }, { supa: { status: 'required' } }, { supa: { signedIn: false } }, { supa: { signedIn: false }, hint: true }]) {
      const p = await indexResult(Object.assign({ width }, opts));
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
        && Array.from(document.querySelectorAll('#recordCard *')).every((e) => e.getBoundingClientRect().right <= window.innerWidth + 0.5)), `${width} ${JSON.stringify(opts)}`);
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
    await d.locator(':scope > summary').click();
    assert.equal(await d.evaluate((e) => e.open), true, 'open ' + i);
    assert.match(await d.innerText(), /この記録の購入状態を確認できませんでした/);
    assert.equal(await d.locator('.mp-notice button').innerText(), 'もう一度確認する');
    assert.equal(await d.locator('a[href*="buy.stripe"], button.is-pending, [data-session-id]').count(), 0, '購入・閲覧ボタンを出さない');
    await d.locator(':scope > summary').click();
    assert.equal(await d.evaluate((e) => e.open), false, 'close ' + i);
  }
  // 再確認：API が回復すれば購入導線が戻る
  await p.unroute('**/api/my-entitlements');
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.locator('#mp-rec-0 > summary').click();
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
  await p.locator('#mp-rec-1 > summary').click();
  const a = p.locator('#mp-rec-1 .mp-rec-actions');
  const aBtns = await a.locator('a, button').allInnerTexts();
  // 販売停止中（既定）：¥1,000 も「準備中」。Payment Link へは送らない
  assert.deepEqual(aBtns.map((t) => t.trim()), ['解析レポート（準備中）', '完全解析 ¥3,000（準備中）']);
  assert.equal(await a.locator('a[href*="buy.stripe"]').count(), 0);
  // B（解析レポート購入済み）
  await p.locator('#mp-rec-0 > summary').click();
  const b = p.locator('#mp-rec-0 .mp-rec-actions');
  assert.deepEqual((await b.locator('a, button').allInnerTexts()).map((t) => t.trim()), ['解析レポートを見る', '完全解析へアップグレード ¥2,000（準備中）']);
  // 準備中ボタン：button・disabled・href なし。強制クリックしても外部遷移・決済イベントなし
  for (const btn of [...await p.locator('#mp-rec-1 button.is-pending').all(), ...await p.locator('#mp-rec-0 button.is-pending').all()]) {
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
  await p.locator('#mp-rec-0 > summary').click();
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
  assert.equal(await f.locator('#mpUpgradeBody .ca-card--primary a[href*="buy.stripe"]').count(), 0);
  assert.match(await f.locator('#mpUpgradeBody .ca-card--primary').innerText(), /解析レポート（準備中）/);
  assert.deepEqual((await f.locator('#mpUpgradeBody button.is-pending').allInnerTexts()).map((t) => t.trim()).filter((t) => /完全解析/.test(t)), ['完全解析 ¥3,000（準備中）']);
  await f.__ctx.close();
  const a = await mypage({ supa: { rows: [RA.row] }, entitlements: purchasedFor(RA.code) });
  assert.equal(await a.locator('#mpUpgradeTrigger').innerText(), '完全解析へ');
  await a.click('#mpUpgradeTrigger');
  assert.equal((await a.locator('#mpUpgradeBody button.is-pending').innerText()).trim(), '完全解析へアップグレード ¥2,000（準備中）');
  assert.equal(await a.locator('#mpUpgradeBody a[href*="buy.stripe"]').count(), 0);
  await a.__ctx.close();
});

test('マイページ：記録が複数なら、対象を選ぶまで購入導線を確定しない（日付・結果を表示）', { skip: skip() }, async () => {
  const p = await mypage({ supa: { rows: [RB.row, RA.row] }, salesOpen: true });
  await p.click('#mpUpgradeTrigger');
  const body = p.locator('#mpUpgradeBody');
  assert.match(await body.innerText(), /どの診断記録をアップグレードしますか/);
  const picks = body.locator('.ca-pick');
  assert.equal(await picks.count(), 2);
  for (const t of await picks.allInnerTexts()) assert.match(t, /\d{4}/, '日付');
  assert.equal(await body.locator('a[href*="buy.stripe"], button.is-pending, .ca-card').count(), 0, '選ぶまで購入導線なし');
  // 過去A を選ぶと、A の診断コードの導線だけになる（最新B ではない）
  await body.locator('[data-pick-index="1"]').click();
  // 販売中：¥1,000 はサーバーの Checkout（選んだ記録 A の ID だけを送る。診断コードは URL に載せない）
  const buy = body.locator('.ca-card--primary [data-analysis-checkout]');
  assert.equal(await buy.getAttribute('data-analysis-checkout'), 'sess-A', 'A の記録');
  assert.equal(await body.locator('a[href*="buy.stripe"]').count(), 0);
  await p.__ctx.close();
});

test('マイページ：320／390／1280px で横スクロールしない（記録を開いた状態・シート）', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    const p = await mypage({ supa: { rows: [RB.row, RA.row] }, entitlements: purchasedFor(RB.code), width });
    await p.locator('#mp-rec-0 > summary').click();
    await p.locator('#mp-rec-1 > summary').click();
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

// ---------------- LATEST RESULT のアコーディオン（2026-10-07 追加） ----------------
const actionTexts = (p, sel) => p.locator(`${sel} .mp-rec-actions`).locator('a, button').allInnerTexts().then((a) => a.map((t) => t.trim()));
async function openLatestFold(p) {
  const d = p.locator('details.mp-latest-fold');
  if (!(await d.evaluate((e) => e.open))) await d.locator(':scope > summary').click();
  return d;
}
async function openRecord(p, i) {
  const d = p.locator(`#mp-rec-${i}`);
  if (!(await d.evaluate((e) => e.open))) await d.locator(':scope > summary').click();
  return d;
}

test('LATEST RESULT：4状態で THE RECORDS の同じ記録と同じ購入・閲覧導線を出す', { skip: skip() }, async () => {
  const cases = [
    { name: 'free', opts: { supa: { rows: [RB.row, RA.row] } }, want: ['解析レポート（準備中）', '完全解析 ¥3,000（準備中）'] },
    { name: 'analysis', opts: { supa: { rows: [RB.row, RA.row] }, entitlements: purchasedFor(RB.code) }, want: ['解析レポートを見る', '完全解析へアップグレード ¥2,000（準備中）'] },
    { name: 'complete', opts: { url: '/mypage.html?preview_entitlement=complete-ready', supa: { rows: [RB.row, RA.row] } }, want: ['解析レポートを見る', '完全解析を見る'] },
  ];
  for (const c of cases) {
    const p = await mypage(c.opts);
    await openLatestFold(p);
    const latest = await actionTexts(p, '.mp-latest-fold');
    assert.deepEqual(latest, c.want, 'latest ' + c.name);
    await openRecord(p, 0);
    assert.deepEqual(await actionTexts(p, '#mp-rec-0'), latest, '最新記録と THE RECORDS の同じ記録で一致 ' + c.name);
    // 準備中ボタンは button・disabled・href なし
    for (const b of await p.locator('.mp-latest-fold button.is-pending').all()) {
      assert.equal(await b.isDisabled(), true); assert.equal(await b.getAttribute('href'), null); assert.equal(await b.getAttribute('onclick'), null);
    }
    // 配置：購入状態の表示の後、「結果を見る」「Xシェア」の前
    const order = await p.evaluate(() => {
      const fold = document.querySelector('.mp-latest-fold-body');
      const acts = fold.querySelector('.mp-rec-actions'), row = fold.querySelector('.mp-btn-row');
      return !!(acts && row && (acts.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.ok(order, 'actions before 結果を見る/Xシェア ' + c.name);
    assert.match(await p.locator('.mp-latest-fold .mp-btn-row').innerText(), /結果を見る[\s\S]*Xシェア/);
    // 完全解析を見る は最新記録（B）が対象
    if (c.name === 'complete') assert.equal(await p.locator('.mp-latest-fold').getByText('完全解析を見る').getAttribute('data-session-id'), 'sess-B');
    if (c.name === 'analysis') assert.equal(await p.locator('.mp-latest-fold').getByText('解析レポートを見る').getAttribute('data-session-id'), 'sess-B');
    // 右上の入口は残る
    assert.equal(await p.locator('#mpUpgradeTrigger').count(), 1);
    assert.deepEqual(p.__errors, []);
    await p.__ctx.close();
  }
});

test('LATEST RESULT：購入状態APIが失敗しても開閉でき、購入・閲覧ボタンを隠して「もう一度確認する」', { skip: skip() }, async () => {
  const p = await mypage({ supa: { rows: [RB.row, RA.row] }, entitlements: (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"service_unavailable"}' }) });
  const d = await openLatestFold(p);
  assert.equal(await d.evaluate((e) => e.open), true);
  assert.match(await d.innerText(), /この記録の購入状態を確認できませんでした/);
  assert.equal(await d.locator('.mp-notice button').innerText(), 'もう一度確認する');
  assert.equal(await d.locator('a[href*="buy.stripe"], button.is-pending, [data-session-id]').count(), 0);
  // THE RECORDS の同じ記録も同じ表示
  const r0 = await openRecord(p, 0);
  assert.equal(await r0.locator('.mp-notice button').innerText(), 'もう一度確認する');
  await d.locator(':scope > summary').click();
  assert.equal(await d.evaluate((e) => e.open), false);
  await p.__ctx.close();
});

test('LATEST RESULT：¥1,000 は最新記録の session に紐づき、入口（source=latest／records）を送る。販売中だけ押せる', { skip: skip() }, async () => {
  const p = await mypage({ supa: { rows: [RB.row, RA.row] }, salesOpen: true });
  const d = await openLatestFold(p);
  const btn = d.locator('.mp-rec-actions [data-analysis-checkout]');
  assert.equal((await btn.innerText()).trim(), '解析レポート　¥1,000');
  assert.equal(await btn.getAttribute('data-analysis-checkout'), 'sess-B', '最新記録（B）');
  assert.equal(await btn.getAttribute('data-source'), 'latest');
  assert.equal(await btn.getAttribute('href'), null);
  // THE RECORDS 側の同じ記録は source=records
  const r0 = await openRecord(p, 0);
  const rb = r0.locator('.mp-rec-actions [data-analysis-checkout]');
  assert.equal(await rb.getAttribute('data-analysis-checkout'), 'sess-B');
  assert.equal(await rb.getAttribute('data-source'), 'records');
  // 押すと本人のトークン付きで POST /api/complete-checkout（記録 ID と product だけ）。Stripe の画面へ同じタブで移動する
  const posts = [];
  await p.route('**/api/complete-checkout', (r) => { posts.push({ body: JSON.parse(r.request().postData()), auth: r.request().headers().authorization || '' });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', offer: 'analysis', amount: 1000 }) }); });
  await p.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await btn.click();
  await p.waitForURL(/checkout\.stripe\.com/);
  assert.deepEqual(posts.map((x) => x.body), [{ diagnosisSessionId: 'sess-B', product: 'analysis' }]);
  assert.match(posts[0].auth, /^Bearer /);
  assert.equal(p.__popups.length, 0, '新しいタブを開かない');
  await p.__ctx.close();
});

test('LATEST RESULT：320／390／1280px で横スクロールしない（最新の詳細を開いた状態）', { skip: skip() }, async () => {
  for (const width of [320, 390, 1280]) {
    for (const opts of [{ supa: { rows: [RB.row, RA.row] } }, { supa: { rows: [RB.row, RA.row] }, entitlements: purchasedFor(RB.code) }]) {
      const p = await mypage(Object.assign({ width }, opts));
      await openLatestFold(p);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
        && Array.from(document.querySelectorAll('.mp-latest-fold .mp-rec-actions *')).every((e) => e.getBoundingClientRect().right <= window.innerWidth + 0.5)), 'width ' + width);
      assert.equal(await p.locator('.mp-latest-fold .mp-rec-actions').evaluate((e) => getComputedStyle(e).flexDirection), width <= 420 ? 'column' : 'row');
      await p.__ctx.close();
    }
  }
});
