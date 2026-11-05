// GA4 の精度の修正の試験（2026-10-28）：UTM の保持・diagnosis_result の result_origin・連続した再診断
//   ・js/ga.js：許可した utm_* だけを page_location に残す（診断コード・トークンなどは、これまでどおり送らない）
//   ・結果画面（Playwright。API・Supabase・Stripe はすべて差し替え。外部へは接続しない）：
//     初回表示（fresh）・開き直し（restored）・同じページでの連続した再診断（毎回 fresh）
//   実行: node --test tests/ga4_fixes.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const skip = () => (chromium ? false : 'playwright がありません');
const ROOT = path.join(__dirname, '..');
const { pipeFile } = require('./fixtures/serve_file');
const { previewPublicConfigJs } = require('./fixtures/server_env');
const CE = require('../lib/complete-eligibility');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const TOKEN = 'Rz0kEnSecretValueForResumeLink_ABCDEFGHIJKL'; // 43文字（base64url）。サーバーに無い秘密値として使う
const VERSIONS = { itemSetVersion: 'ETI-ITEM-2.0.0', scoringVersion: 'ETI-SCORE-2.0.0', translationModelVersion: 'ETI-TRANS-2.0.0',
  characterProfileVersion: 'ETI-CHAR-2.1.0', mirrorModelVersion: 'ETI-MIRROR-2.1.0' };

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  // 本番の配信（vercel.json）と同じく /result は index.html を返す
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname === '/result' ? '/index.html' : u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const GOALS = [200, { salesOpen: true, catalog: CE.MENTOR_CATALOG }];
// 購入対象トークン（試験用。固有リンクの秘密値ごとに決まる値）
const CTX_FOR = (tk) => 'Ctx_' + Buffer.from(tk).toString('base64url').slice(0, 70);
// 申込は購入対象トークンと商品だけ（診断コード・固有リンクの秘密値を op=buy に送らない）
function assertBuy(w, tk, product = 'analysis') {
  assert.deepEqual(w.calls.filter((c) => c.op === 'buy-context').map((c) => c.body).slice(-1), [{ resume: tk }]);
  const buy = w.calls.filter((c) => c.op === 'buy');
  assert.deepEqual(buy.map((c) => [c.body.context, c.body.product]).slice(-1), [[CTX_FOR(tk), product]]);
  assert.ok(buy.every((c) => !JSON.stringify(c.body).includes(tk)), 'op=buy に固有リンクの秘密値を送らない');
}

// world：サーバーの状態（固有リンクの秘密値 → 診断コード）
function world(over) {
  return Object.assign({ links: {}, issued: [], linkStatus: null, linkDelay: 0, openStatus: null, calls: [] }, over || {});
}
async function newContext({ width = 390 } = {}) {
  return browser.newContext({ viewport: { width, height: 844 } });
}
async function wire(ctx, w) {
  await ctx.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.supabase={createClient(){return {from(){const q=new Proxy({},{get(_t,k){if(k==="then")return (res)=>res({data:[],error:null});return ()=>q;}});return q;},rpc:async()=>({data:null,error:null}),auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};}};' }));
  await ctx.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs({ completeSalesOpen: true, completeApiReady: true }) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/cdnjs\.cloudflare\.com|googletagmanager|jsdelivr/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await ctx.route('https://checkout.stripe.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>stripe</p>' }));
  await ctx.route('**/api/complete-checkout?op=*', async (r) => {
    const req = r.request();
    const op = new URL(req.url()).searchParams.get('op');
    const body = JSON.parse(req.postData() || '{}');
    w.calls.push({ op, body, url: req.url() });
    const send = (status, json) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (op === 'result-link') {
      // 秘密値はブラウザが作る（応答には秘密値を含めない）。同じ秘密値の再送は 'existing'
      if (w.linkDelay) await new Promise((ok) => setTimeout(ok, w.linkDelay));
      if (w.linkStatus) return send(w.linkStatus, { error: w.linkStatus === 429 ? 'too_many_requests' : 'service_unavailable' });
      if (w.links[body.token]) return send(200, { result: 'existing' });
      w.issued.push(body.token);
      w.links[body.token] = body.code;
      return send(200, { result: 'created' });
    }
    if (op === 'result-open') {
      if (w.openStatus) return send(w.openStatus, { error: w.openStatus === 404 ? 'result_not_found' : 'service_unavailable' });
      const code = w.links[body.token];
      return code ? send(200, { code, diagnosisVersion: 'ETI-2.0', versions: VERSIONS }) : send(404, { error: 'result_not_found' });
    }
    if (op === 'guest-cancel') return send(200, { closed: 1, paid: 0 });
    // 申込（complete_13）：診断結果の固有リンクから購入対象トークン → 共通の op=buy
    if (op === 'buy-context') return w.links[body.resume] ? send(200, { context: CTX_FOR(body.resume), summary: {}, eligible: { analysis: true, complete: true } }) : send(404, { error: 'record_not_found' });
    if (op === 'buy') return send(200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', product: body.product });
    if (op === 'guest-status') return send(200, { salesOpen: true, purchases: [] });
    if (op === 'guest-goals') return send(...GOALS);
    if (op === 'guest-checkout') return send(200, { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_fake', offer: body.offer, amount: 1000 });
    return send(404, { error: 'not_found' });
  });
  await ctx.addInitScript(() => { window.__ev = []; window.gtag = function () { window.__ev.push(Array.from(arguments)); }; });
}
async function open(ctx, url) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.__errors = [];
  p.__console = [];
  p.on('pageerror', (e) => p.__errors.push(String(e)));
  p.on('console', (m) => p.__console.push(m.text()));
  await p.goto(base + url);
  return p;
}
// 診断の完了（100問の回答を入れて、完了の処理を呼ぶ）
async function complete(p, k = 7) {
  await p.waitForFunction(() => typeof showResultV2 === 'function' && typeof ETI_V2_QUESTIONS !== 'undefined');
  return p.evaluate((kk) => {
    const a = {};
    ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * kk) % 5) - 2; });
    window.__diagnosisVersion = 'ETI-2.0';
    answersV2 = a; // eslint-disable-line no-undef
    showResultV2(); // eslint-disable-line no-undef
    return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS);
  }, k);
}

// ---------------- js/ga.js：UTM ----------------
const vm = require('vm');
const GA_SRC = fs.readFileSync(path.join(ROOT, 'js/ga.js'), 'utf8');
const PROD = 'element-diagnosis-five.vercel.app';
function runGa(search, hostname = PROD, pathname = '/') {
  const win = {};
  const ctx = {
    window: win,
    location: { hostname, origin: `https://${hostname}`, pathname, search, hash: '#r=abc' },
    document: { referrer: '', head: { appendChild() {} }, createElement: () => ({}) },
    URLSearchParams,
  };
  win.dataLayer = undefined;
  vm.createContext(ctx);
  vm.runInContext(GA_SRC, ctx);
  const config = Array.from(win.dataLayer.find((a) => a[0] === 'config'));
  return { win, loc: config[2].page_location, cfg: JSON.parse(JSON.stringify(config[2])), config };
}

test('UTM：許可した utm_* だけを page_location に残す（流入元を GA4 へ渡す）', () => {
  assert.equal(runGa('?utm_source=x&utm_medium=social&utm_campaign=launch_1028').loc,
    `https://${PROD}/?utm_source=x&utm_medium=social&utm_campaign=launch_1028`);
  assert.equal(runGa('?utm_source=note&utm_medium=referral&utm_content=a-1&utm_term=t.1~x_y').loc,
    `https://${PROD}/?utm_source=note&utm_medium=referral&utm_content=a-1&utm_term=t.1~x_y`);
  assert.equal(runGa('').loc, `https://${PROD}/`, 'UTM が無ければ、これまでどおり origin＋path だけ');
  assert.equal(runGa('?utm_source=x', PROD, '/result').loc, `https://${PROD}/result?utm_source=x`);
});

test('UTM：診断コード・トークン・その他の問い合わせ文字列・# は、UTM と一緒でも送らない', () => {
  const code = 'q8tfdsyv0j9w30o6ezwid4nhcl7zm2wsros01rod63eq6';
  const r = runGa(`?dv=ETI-2.0&code=${code}&mv=2.1.0&utm_source=x&utm_medium=social&token=secret&view=v&rec=1&status=ok#r=abc`);
  assert.equal(r.loc, `https://${PROD}/?utm_source=x&utm_medium=social`);
  const all = JSON.stringify(Array.from(r.win.dataLayer, (a) => Array.from(a)));
  for (const s of [code, 'secret', 'token=', 'view=', 'dv=', '#r=', 'rec=']) assert.ok(!all.includes(s), s);
});

test('UTM：値が不正・個人情報や識別子に見えるものは捨てる（名前の無関係な utm_ も捨てる）', () => {
  const bad = [
    'utm_source=' + 'a'.repeat(65),                                  // 長すぎる
    'utm_source=a%40example.test',                                    // メール
    'utm_source=11111111-1111-4111-8111-111111111111',                // UUID
    'utm_source=cs_test_a1b2c3d4e5f6',                                // Stripe の ID
    'utm_source=https%3A%2F%2Fexample.test%2F%3Ftoken%3D1',           // URL
    'utm_source=' + 'q8tfdsyv0j9w30o6ezwid4nhcl7zm2wsros01rod63eq6',  // 診断コードに見える長い値
    'utm_source=%3Cscript%3E', 'utm_source=a b%0Ac', 'utm_source=%E3%83%86%E3%82%B9%E3%83%88', // 記号・空白・改行・日本語
    'utm_id=1', 'utm_source_platform=x', 'UTM_SOURCE=x',               // 許可していない名前
  ];
  for (const q of bad) assert.equal(runGa('?' + q).loc, `https://${PROD}/`, q);
  assert.equal(runGa('?utm_source=%E3%83%86%E3%82%B9%E3%83%88&utm_medium=social').loc, `https://${PROD}/?utm_medium=social`, '不正な値だけ捨てる');
});

const campaignOf = (cfg) => Object.fromEntries(Object.entries(cfg).filter(([k]) => k.startsWith('campaign_')));

test('campaign_*：URL の UTM と、config の値が対応する（utm_source→campaign_source など）。page_location の UTM と同じ値', () => {
  const r = runGa('?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease&utm_content=c-1&utm_term=t_1');
  assert.deepEqual(campaignOf(r.cfg), {
    campaign_source: 'ga4check', campaign_medium: 'test', campaign_name: 'prerelease', campaign_content: 'c-1', campaign_term: 't_1',
  });
  assert.equal(r.loc, `https://${PROD}/?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease&utm_content=c-1&utm_term=t_1`);
  // 一部だけ：あるものだけを反映する
  assert.deepEqual(campaignOf(runGa('?utm_source=x&utm_medium=social').cfg), { campaign_source: 'x', campaign_medium: 'social' });
  assert.deepEqual(campaignOf(runGa('?utm_campaign=only').cfg), { campaign_name: 'only' });
  // config の項目は、page_location・page_referrer と campaign_* だけ
  assert.deepEqual(Object.keys(r.cfg).sort(), ['campaign_content', 'campaign_medium', 'campaign_name', 'campaign_source', 'campaign_term', 'page_location', 'page_referrer']);
});

test('campaign_*：UTM が無ければ設定しない（config は従来どおり）', () => {
  for (const q of ['', '?foo=1', '?dv=ETI-2.0&code=abc&mv=2.1.0', '?utm_source=', '?utm_id=1&utm_source_platform=x']) {
    const r = runGa(q);
    assert.deepEqual(Object.keys(r.cfg).sort(), ['page_location', 'page_referrer'], q);
    assert.equal(r.loc, `https://${PROD}/`, q);
  }
});

test('campaign_*：不正な値・個人情報や識別子に見える値は、page_location にも campaign_* にも入れない。ほかの問い合わせ文字列は混ざらない', () => {
  const code = 'q8tfdsyv0j9w30o6ezwid4nhcl7zm2wsros01rod63eq6';
  const bad = ['a'.repeat(65), 'a%40example.test', '11111111-1111-4111-8111-111111111111', 'cs_test_a1b2c3d4e5f6',
    'https%3A%2F%2Fexample.test%2F%3Ftoken%3D1', code, '%3Cscript%3E', 'a b%0Ac', '%E3%83%86%E3%82%B9%E3%83%88', '', '%20'];
  for (const v of bad) {
    const r = runGa(`?utm_source=${v}&utm_medium=social&code=${code}&token=secret`);
    assert.deepEqual(campaignOf(r.cfg), { campaign_medium: 'social' }, v);
    assert.equal(r.loc, `https://${PROD}/?utm_medium=social`, v);
    const all = JSON.stringify(Array.from(r.win.dataLayer, (a) => Array.from(a)));
    assert.ok(!all.includes(code) && !all.includes('secret'), v);
  }
  // 同じ名前が複数：最初の値だけ（検証を通ったもの）を使う
  assert.deepEqual(campaignOf(runGa('?utm_source=a&utm_source=b').cfg), { campaign_source: 'a' });
  // 値の前後の空白は、取り除いて検証する
  assert.deepEqual(campaignOf(runGa('?utm_source=%20x%20').cfg), { campaign_source: 'x' });
});

test('campaign_*：本番以外では何も送らない・既存の gtag を上書きしない', () => {
  const win = {};
  const ctx = { window: win, location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '?utm_source=x&utm_medium=y', hash: '' },
    document: { referrer: '', head: { appendChild() {} }, createElement: () => ({}) }, URLSearchParams };
  win.dataLayer = undefined;
  vm.createContext(ctx);
  vm.runInContext(GA_SRC, ctx);
  assert.equal(win.dataLayer.length, 0);
});

test('UTM：本番以外では何も送らない（既存どおり）', () => {
  const win = {};
  const ctx = { window: win, location: { hostname: 'localhost', origin: 'http://localhost', pathname: '/', search: '?utm_source=x', hash: '' },
    document: { referrer: '', head: { appendChild() {} }, createElement: () => ({}) }, URLSearchParams };
  win.dataLayer = undefined;
  vm.createContext(ctx);
  vm.runInContext(GA_SRC, ctx);
  win.gtag('event', 'x', { a: 1 });
  assert.equal(win.dataLayer.length, 0);
});

// ---------------- 結果画面：result_origin ----------------
const dres = (p) => p.evaluate(() => window.__ev.filter((e) => e[0] === 'event' && e[1] === 'diagnosis_result').map((e) => e[2]));
const evAll = (p, name) => p.evaluate((n) => window.__ev.filter((e) => e[0] === 'event' && e[1] === n).map((e) => e[2]), name);

test('初回の表示は result_origin=fresh で1回だけ。再描画では増えない', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  await complete(p);
  await p.waitForFunction(() => window.__ev.some((e) => e[1] === 'diagnosis_result'));
  let r = await dres(p);
  assert.equal(r.length, 1);
  assert.equal(r[0].result_origin, 'fresh');
  assert.equal(r[0].diagnosis_version, 'ETI-2.0');
  assert.equal((await evAll(p, 'quiz_complete')).length, 1);
  // 同じ結果の再描画（render の再呼び出し）では、記録を重ねない
  await p.evaluate(() => { render(); render(); }); // eslint-disable-line no-undef
  assert.equal((await dres(p)).length, 1, '再描画で増えない');
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

test('同じページで続けて診断し直しても、完了のたびに fresh が1回ずつ出る（以前は2回目が欠落）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  await complete(p, 7);
  await p.waitForFunction(() => window.__ev.filter((e) => e[1] === 'diagnosis_result').length === 1);
  for (const k of [11, 13]) {
    await p.evaluate(() => startNewDiagnosisV2()); // eslint-disable-line no-undef
    await complete(p, k);
  }
  await p.waitForFunction(() => window.__ev.filter((e) => e[1] === 'diagnosis_result').length === 3);
  const r = await dres(p);
  assert.deepEqual(r.map((x) => x.result_origin), ['fresh', 'fresh', 'fresh']);
  assert.equal((await evAll(p, 'quiz_complete')).length, 3, 'quiz_complete と diagnosis_result が同数');
  assert.equal((await evAll(p, 'quiz_start')).length, 2);
  // 作り分けた結果が、別の結果として出ている（element_weapon_nation が全て同じではない）
  assert.ok(new Set(r.map((x) => x.element_weapon_nation)).size >= 2);
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

test('共有リンク（?dv=ETI-2.0&code=）・固有リンク（/result#r=）・再読み込みは result_origin=restored で、ページごとに1回', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForFunction(() => location.pathname === '/result' && location.hash.startsWith('#r='));
  const tk = w.issued[0];
  // 共有リンク
  const s = await open(ctx, `/?dv=ETI-2.0&code=${code}&mv=2.1.0`);
  await s.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  let r = await dres(s);
  assert.equal(r.length, 1);
  assert.equal(r[0].result_origin, 'restored');
  assert.equal((await evAll(s, 'quiz_complete')).length, 0, '開き直しは quiz_complete にならない');
  // 固有リンク
  const q = await open(ctx, `/result#r=${tk}`);
  await q.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  r = await dres(q);
  assert.deepEqual(r.map((x) => x.result_origin), ['restored']);
  // 再読み込み
  await q.reload();
  await q.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.deepEqual((await dres(q)).map((x) => x.result_origin), ['restored']);
  // 開き直した結果で購入を押して、固有リンクを作る流れ（__resumeFresh が true になる）でも、fresh と誤記録しない・増やさない
  await s.evaluate(() => { window.__resumeFresh = true; render(); }); // eslint-disable-line no-undef
  await s.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  r = await dres(s);
  assert.deepEqual(r.map((x) => x.result_origin), ['restored'], '開き直した結果が fresh にならない・増えない');
  assert.deepEqual(p.__errors.concat(s.__errors, q.__errors), []);
  await ctx.close();
});

test('開き直した結果のあとで、同じページで診断し直すと、その結果は fresh（restored → fresh）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const seed = await open(ctx, '/');
  const code = await complete(seed, 7);
  const p = await open(ctx, `/?dv=ETI-2.0&code=${code}&mv=2.1.0`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  await p.evaluate(() => startNewDiagnosisV2()); // eslint-disable-line no-undef
  await complete(p, 11);
  await p.waitForFunction(() => window.__ev.filter((e) => e[1] === 'diagnosis_result').length === 2);
  assert.deepEqual((await dres(p)).map((x) => x.result_origin), ['restored', 'fresh']);
  await ctx.close();
});

test('diagnosis_result に、診断コード・回答・トークンを含めない（result_origin は fresh／restored だけ）', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForFunction(() => window.__ev.some((e) => e[1] === 'diagnosis_result'));
  const ev = JSON.stringify(await p.evaluate(() => window.__ev));
  assert.ok(!ev.includes(code), '診断コードを送らない');
  assert.ok(!ev.includes(w.issued[0] || 'no-token'), '秘密値を送らない');
  const r = await dres(p);
  assert.match(r[0].result_origin, /^(fresh|restored)$/);
  assert.deepEqual(Object.keys(r[0]).sort(), ['diagnosis_version', 'element', 'element_weapon', 'element_weapon_nation', 'ennea_type', 'ennea_wing', 'event_category', 'nation', 'result_origin', 'top_character', 'top_character_match', 'weapon'].sort());
  await ctx.close();
});

test('diagnosis_profile：いま完了した新診断だけ、20軸を10点刻みで1回送る。回答・診断コードは含めない。開き直しでは送らない', { skip: skip() }, async () => {
  const w = world();
  const ctx = await newContext();
  await wire(ctx, w);
  const p = await open(ctx, '/');
  const code = await complete(p);
  await p.waitForFunction(() => window.__ev.some((e) => e[1] === 'diagnosis_profile'));
  await p.evaluate(() => { render(); render(); }); // eslint-disable-line no-undef
  const prof = await evAll(p, 'diagnosis_profile');
  assert.equal(prof.length, 1, '再描画で増えない');
  const keys = ['p_O', 'p_C', 'p_E', 'p_A', 'p_N', 's_AGY', 's_REL', 's_ROL', 's_REF', 's_AUT',
    'v_SD', 'v_ST', 'v_HE', 'v_AC', 'v_PO', 'v_SE', 'v_CO', 'v_TR', 'v_BE', 'v_UN'];
  keys.forEach((k) => {
    assert.ok(Number.isInteger(prof[0][k]) && prof[0][k] >= 0 && prof[0][k] <= 100 && prof[0][k] % 10 === 0, k + ' は10点刻み');
  });
  assert.ok(Object.keys(prof[0]).length <= 25, 'GA4 のイベントのパラメータは25個まで');
  assert.ok(!JSON.stringify(prof).includes(code), '診断コードを送らない');
  // 同じ結果を開き直した（restored）ときは送らない
  const p2 = await open(ctx, '/?dv=ETI-2.0&code=' + encodeURIComponent(code));
  await p2.waitForFunction(() => window.__ev.some((e) => e[1] === 'diagnosis_result'));
  assert.equal((await evAll(p2, 'diagnosis_profile')).length, 0, '開き直しでは送らない');
  assert.deepEqual(p.__errors, []);
  await ctx.close();
});

// ---------------- 実ブラウザ：本番のドメイン名での、送信の順序（gtag.js だけ差し替え。外部へは送らない） ----------------
const HOST = 'https://element-diagnosis-five.vercel.app';
async function prodHostPage(ctx) {
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin === HOST) {
      if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const rel = u.pathname === '/' || u.pathname === '/result' ? '/index.html' : decodeURIComponent(u.pathname);
      let f = path.join(ROOT, rel);
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    return r.fulfill({ contentType: 'application/javascript', body: '' }); // gtag.js・Supabase・フォントなどは空
  });
  return ctx.newPage();
}
const dlOf = (p) => p.evaluate(() => Array.from(window.dataLayer || [], (a) => Array.from(a)));

test('本番のドメイン：config（UTM・campaign_*）が、最初のイベントより前に積まれる。診断コードは含まれない', { skip: skip() }, async () => {
  const ctx = await newContext();
  const p = await prodHostPage(ctx);
  const code = 'q8tfdsyv0j9w30o6ezwid4nhcl7zm2wsros01rod63eq6';
  await p.goto(`${HOST}/?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease&dv=ETI-2.0&code=${code}&mv=2.1.0`, { referer: 'https://t.co/abc' });
  await p.waitForFunction(() => (window.dataLayer || []).some((a) => a[0] === 'event' && a[1] === 'diagnosis_result'));
  const dl = await dlOf(p);
  assert.equal(dl[0][0], 'js');
  assert.equal(dl[1][0], 'config');
  assert.deepEqual(dl[1][2], {
    page_location: `${HOST}/?utm_source=ga4check&utm_medium=test&utm_campaign=prerelease`,
    page_referrer: 'https://t.co/',
    campaign_source: 'ga4check', campaign_medium: 'test', campaign_name: 'prerelease',
  });
  const firstEvent = dl.findIndex((a) => a[0] === 'event');
  assert.ok(firstEvent > 1, 'イベントは config の後');
  const ev = dl.find((a) => a[0] === 'event' && a[1] === 'diagnosis_result');
  assert.equal(ev[2].result_origin, 'restored');
  assert.ok(!JSON.stringify(dl).includes(code), '診断コードを送らない');
  await ctx.close();
});

test('本番のドメイン：UTM が無い時は、config に campaign_* を入れない', { skip: skip() }, async () => {
  const ctx = await newContext();
  const p = await prodHostPage(ctx);
  await p.goto(`${HOST}/`);
  await p.waitForFunction(() => (window.dataLayer || []).some((a) => a[0] === 'config'));
  const dl = await dlOf(p);
  assert.deepEqual(dl[1][2], { page_location: `${HOST}/`, page_referrer: '' });
  await ctx.close();
});
