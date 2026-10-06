// 旧版（element-v1）と ETI v2 の購入済み記録の再閲覧契約（文言ではなく意味で検証する）。
//   - 購入済みの旧版記録・v2記録の双方から、認証済みの再閲覧処理（/api/my-report-link）へ到達できる
//   - そのとき diagnosis_session_id（その記録のID）が送られる
//   - 未購入の記録からは再閲覧処理を呼べない（導線を出さない）
//   - 権利キーは「世代:コード」で、旧版と v2 を混同しない
// Supabase・API はすべて偽物。Playwright が無い環境では skip する。
//   実行: node --test tests/dual_version_contract.test.js
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
const { previewPublicConfigJs } = require('./fixtures/server_env');
const skip = () => !chromium;

// ---- 静的な契約：購入状態の照合キーは「世代:コード」 ----
test('購入状態の照合キーは世代付き（element-v1:／ETI-2.0:）で、旧版と v2 を混同しない', () => {
  const src = fs.readFileSync(path.join(ROOT, 'diagnosis-save.js'), 'utf8');
  const fn = /async function attachPurchasedStatus[\s\S]*?\n}\n/.exec(src)[0];
  assert.match(fn, /s\.isV2 \? 'ETI-2\.0' : 'element-v1'/);
  assert.match(fn, /`\$\{version\}:\$\{s\.encodedAnswers\}`/);
  // 再閲覧APIはクライアントから診断コードを受け取らず、diagnosis_session_id だけを受け取る
  const api = fs.readFileSync(path.join(ROOT, 'api', 'my-report-link.js'), 'utf8');
  assert.match(api, /parseBody\(req\)\.diagnosis_session_id/);
  assert.match(api, /const reference = diagnosisVersion === 'ETI-2\.0' \? `v2_\$\{code\}` : code;/);
});

// ---- ブラウザでの確認 ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css' };
function fakeSupabase(rows) {
  return `window.supabase = { createClient() {
    const user = { id: "user-1", email: "owner@example.test" };
    const rows = ${JSON.stringify(rows)};
    function builder(table) {
      let one = false;
      const q = new Proxy({}, { get(_t, k) {
        if (k === 'then') return (res, rej) => Promise.resolve(table === 'diagnosis_sessions' ? { data: one ? rows[0] : rows, error: null }
          : table === 'profiles' ? { data: { newsletter_opted_in: false }, error: null } : { data: [], error: null }).then(res, rej);
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
const LEGACY_CODE = 'legacycode01';
const LEGACY = { id: 'sess-L', user_id: 'user-1', completed_at: '2026-09-01T10:00:00Z', diagnosis_type: 'element', diagnosis_version: null,
  diagnosis_results: [{ primary_result: { element: '水', weapon: '長柄', nation: '璃月' }, scores: {}, character_matches: [{ name: '行秋', match: 77, el: '水' }] }],
  diagnosis_answers: [{ encoded_answers: LEGACY_CODE }] };
const V2P = v2Row('sess-V', '2026-09-20T10:00:00Z', 7); // 購入済みにする v2
const V2U = v2Row('sess-U', '2026-10-01T10:00:00Z', 3); // 未購入の v2（最新）
const ROWS = [V2U.row, V2P.row, LEGACY];

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function mypage(purchasedKeys) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const linkCalls = [];
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(ROWS) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs() }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ purchased_by_version: Object.fromEntries(purchasedKeys.map((k) => [k, true])) }) }));
  await p.route('**/api/my-report-link', (r) => {
    const req = r.request();
    linkCalls.push({ method: req.method(), auth: req.headers().authorization, body: JSON.parse(req.postData() || '{}') });
    return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stub"}' }); // 遷移させない
  });
  await p.goto(base + '/mypage.html');
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  p.__ctx = ctx; p.__calls = linkCalls;
  return p;
}
// その記録の再閲覧ボタン（購入済みレポートを開く処理につながるもの）
const reopenButtons = (p, id) => p.evaluate((sid) => Array.from(document.querySelectorAll(`button[data-session-id="${encodeURIComponent(sid)}"]`))
  .filter((b) => /openPurchasedReport/.test(b.getAttribute('onclick') || '')).length, id);
const clickReopen = (p, id) => p.evaluate((sid) => Array.from(document.querySelectorAll(`button[data-session-id="${encodeURIComponent(sid)}"]`))
  .find((b) => /openPurchasedReport/.test(b.getAttribute('onclick') || '')).click(), id);

test('購入済みの旧版・v2記録の双方から、認証済みの再閲覧処理へ diagnosis_session_id 付きで到達できる', { skip: skip() }, async () => {
  const p = await mypage([`element-v1:${LEGACY_CODE}`, `ETI-2.0:${V2P.code}`]);
  for (const id of ['sess-L', 'sess-V']) {
    assert.ok(await reopenButtons(p, id) >= 1, id + ' に再閲覧導線がある');
    const before = p.__calls.length;
    await clickReopen(p, id);
    await p.waitForTimeout(300);
    const call = p.__calls[p.__calls.length - 1];
    assert.equal(p.__calls.length, before + 1, id);
    assert.equal(call.method, 'POST');
    assert.equal(call.auth, 'Bearer tok-1');
    assert.deepEqual(call.body, { diagnosis_session_id: id });
  }
  // 未購入の v2 記録には再閲覧導線を出さない（＝再閲覧処理を呼べない）
  assert.equal(await reopenButtons(p, 'sess-U'), 0);
  assert.ok(p.__calls.every((c) => c.body.diagnosis_session_id !== 'sess-U'));
  await p.__ctx.close();
});

test('世代を取り違えた権利キーでは購入済みにならない（旧版コードの ETI-2.0 キー／v2コードの element-v1 キー）', { skip: skip() }, async () => {
  const p = await mypage([`ETI-2.0:${LEGACY_CODE}`, `element-v1:${V2P.code}`]);
  for (const id of ['sess-L', 'sess-V', 'sess-U']) assert.equal(await reopenButtons(p, id), 0, id);
  assert.equal(p.__calls.length, 0);
  await p.__ctx.close();
});
