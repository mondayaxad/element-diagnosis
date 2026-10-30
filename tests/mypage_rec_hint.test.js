// マイページから結果を開く時の「マイページの記録」の文脈（#rec=）を、リンクの # 以降を落とす環境でも保つ備えの試験。
//   ・マイページ：結果のリンクを押す直前に、記録 ID を同じ診断コードと一緒に 10 分だけ控える
//   ・結果ページ：# が無くても、同じ診断コードの控えが 10 分以内にあれば、マイページの記録として開く（無ければ従来どおり）
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* 次 */ } }
const skip = () => (chromium ? false : 'playwright がありません');
const ROOT = path.join(__dirname, '..');
const { pipeFile } = require('./fixtures/serve_file');
const { previewPublicConfigJs } = require('./fixtures/server_env');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css' };
function fakeSupabase(rows) {
  return `window.supabase = { createClient() {
    const user = { id: "user-1", email: "owner@example.test" };
    const rows = ${JSON.stringify(rows)};
    function builder(table) {
      let one = false;
      const q = new Proxy({}, { get(_t, k) {
        if (k === 'then') return (res, rej) => Promise.resolve(table === 'diagnosis_sessions' ? { data: one ? rows[0] : rows, error: null }
          : table === 'profiles' ? { data: { onboarding_status: 'completed', newsletter_sync_status: 'synced', newsletter_sync_attempts: 1, newsletter_sync_attempted_at: null }, error: null } : { data: [], error: null }).then(res, rej);
        if (k === 'single' || k === 'maybeSingle') return () => { one = true; return q; };
        return () => q;
      } });
      return q;
    }
    return { from: builder, rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: { access_token: "tok-1" } } }),
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) } };
  } };`;
}
// v2 の記録は正本エンジンで計算した回答・結果から作る
const makeV2 = (() => {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('this.__make = (k) => { const A = {}; ETI_V2_QUESTIONS.forEach((q, i) => { A[q.id] = ((i * k) % 5) - 2; }); const R = ETIv2.computeResultsV2(A, { elementPrototypes: ELEMENT_PROTOTYPES_V2, weaponPrototypes: WEAPON_PROTOTYPES_V2, nationPrototypes: NATION_PROTOTYPES_V2 }); return { code: ETIv2.encodeAnswersV2(A, ETI_V2_QUESTIONS), R: JSON.parse(JSON.stringify(R)) }; };', ctx);
  return ctx.__make;
})();
function v2Row(id, at, k) {
  const { code, R } = makeV2(k);
  return { code, row: { id, user_id: 'user-1', completed_at: at, diagnosis_type: 'element', diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0',
    diagnosis_results: [{ primary_result: {}, scores: {}, character_matches: [], diagnosis_code: code, item_set_version: 'ETI-ITEM-2.0.0', character_profile_version: 'ETI-CHAR-2.1.0', mirror_model_version: 'ETI-MIRROR-2.1.0',
      v2_scores: { personality: R.personality, style: R.style, values: R.values, valuesCentered: R.valuesCentered },
      v2_rankings: { element: R.elementRanking, weapon: R.weaponRanking, nation: R.nationRanking }, mirror_snapshot: [] }],
    diagnosis_answers: [{ encoded_answers: code }] } };
}

const ID = '11111111-1111-4111-8111-111111111111';
const V2 = v2Row(ID, '2026-10-27T10:00:00Z', 3);
const KEY = 'ed_rec_hint_v1';
let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const p0 = (u.pathname === '/result' || u.pathname === '/') ? '/index.html' : u.pathname;
    const f = path.join(ROOT, decodeURIComponent(p0));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function page() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const calls = [];
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase([V2.row]) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs({ completeSalesOpen: true, completeApiReady: true }) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com|googletagmanager|cdnjs/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('**/api/complete-checkout?op=my-reports', (r) => r.fulfill({ contentType: 'application/json', body: '{"reports":[],"records":[]}' }));
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.route('**/api/complete-checkout?op=buy-context', (r) => { calls.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ contentType: 'application/json', body: '{"context":"ctx.test","summary":{},"eligible":true}' }); });
  p.__ctx = ctx; p.__calls = calls;
  return p;
}
const resultUrl = `/?dv=ETI-2.0&code=${encodeURIComponent(V2.code)}&mv=2.1.0`;

test('マイページ：結果のリンクを押すと、記録 ID と診断コードを控える（リンクの # はそのまま）', { skip: skip() }, async () => {
  const p = await page();
  await p.goto(base + '/mypage.html');
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  const out = await p.evaluate((k) => {
    const a = document.querySelector('a[href*="#rec="]');
    a.addEventListener('click', (ev) => ev.preventDefault()); // 移動させず、控えだけ見る
    a.click();
    return { href: a.getAttribute('href'), hint: JSON.parse(localStorage.getItem(k) || 'null') };
  }, KEY);
  assert.match(out.href, /#rec=11111111-1111-4111-8111-111111111111$/);
  assert.equal(out.hint.id, ID);
  assert.equal(out.hint.code, V2.code);
  assert.ok(Date.now() - out.hint.at < 5000);
  await p.__ctx.close();
});

async function openResult(p, hash, hint) {
  await p.goto(base + '/');
  if (hint) await p.evaluate(([k, h]) => localStorage.setItem(k, JSON.stringify(h)), [KEY, hint]);
  await p.goto(base + resultUrl + hash);
  await p.waitForSelector('#recordCard', { state: 'attached' });
  await p.waitForTimeout(800);
  return p.evaluate(() => ({ card: document.getElementById('recordCard').getAttribute('data-state'), text: document.getElementById('recordCard').innerText }));
}

test('結果ページ：# が無くても、同じ診断コードの控えが 10 分以内なら、マイページの記録として開く', { skip: skip() }, async () => {
  const p = await page();
  const r = await openResult(p, '', { id: ID, code: V2.code, at: Date.now() - 60 * 1000 });
  assert.equal(r.card, 'registered', r.text);
  assert.match(r.text, /マイページに登録済み/);
  await p.__ctx.close();
});

test('結果ページ：# があれば従来どおり。控えが古い（10 分超）・別の診断コード・控えなしは、マイページの記録として扱わない', { skip: skip() }, async () => {
  const withHash = await page();
  assert.equal((await openResult(withHash, `#rec=${ID}`, null)).card, 'registered', '従来どおり # で開ける');
  await withHash.__ctx.close();
  for (const [label, hint] of [['古い', { id: ID, code: V2.code, at: Date.now() - 11 * 60 * 1000 }], ['別の診断コード', { id: ID, code: 'otherCode', at: Date.now() }], ['控えなし', null], ['IDが不正', { id: 'not-a-uuid', code: V2.code, at: Date.now() }]]) {
    const p = await page();
    const r = await openResult(p, '', hint);
    assert.notEqual(r.card, 'registered', label + ': ' + r.text);
    await p.__ctx.close();
  }
});
