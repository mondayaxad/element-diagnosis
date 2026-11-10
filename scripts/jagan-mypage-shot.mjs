// 実物の mypage.html を、ログイン済み・登録完了を模して開き、邪眼診断の記録と証の見た目を撮る（実データではない）
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = '/home/user/element-diagnosis/dist';
const OUT = process.argv[2];
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/mypage') p = '/mypage.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('{}'); return; }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(0);
const base = `http://localhost:${srv.address().port}`;

const { computeDiagnosis } = await import('/home/user/element-diagnosis/jagan/engine/runtime.mjs');
const { BUNDLE } = await import('/home/user/element-diagnosis/jagan/engine/data.mjs');
const { headlineOf } = await import('/home/user/element-diagnosis/lib/jagan-api.mjs');
const ids = BUNDLE.items.items.map((i) => i.id);
let seed = Number(process.env.SEED || 11); const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const dates = ['2026-11-07', '2026-11-03', '2026-10-28'];
const rows = dates.map((d, k) => {
  const answers = Object.fromEntries(ids.map((id) => [id, 1 + Math.floor(rnd() * 5)]));
  const rid = `00000000-0000-4000-8000-00000000000${k}`;
  const r = computeDiagnosis({ answers, resultId: rid, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
  return { result_id: rid, created_at: `${d}T03:00:00Z`, headline: headlineOf(r), snapshot: r };
});
// ENT：解析レポート（¥1,000）を購入済みにする記録の番号。CENT：完全解析（¥3,000）を購入済みにする記録の番号
const ENT = (process.env.ENT || '1').split(',').filter(Boolean).map((i) => ({ result_id: rows[Number(i)].result_id, status: 'active', product_key: 'jagan_report_v1' }))
  .concat((process.env.CENT || '').split(',').filter(Boolean).map((i) => ({ result_id: rows[Number(i)].result_id, status: 'active', product_key: 'jagan_complete_v1' })));
const SALES = process.env.SALES !== '0';
const STUB = `
(function(){
  var user={id:'u-1',email:'tester@example.com',app_metadata:{provider:'email'},identities:[{provider:'email'}],user_metadata:{}};
  var session={access_token:'t',user:user};
  function builder(table){
    var b={}; var result;
    ['select','eq','order','limit','in','neq','gte','lte','is','match'].forEach(function(m){ b[m]=function(){return b;}; });
    b.single=b.maybeSingle=function(){ return Promise.resolve(table==='profiles'?{data:{onboarding_status:'completed'},error:null}:{data:null,error:null}); };
    b.then=function(res,rej){ var d=[]; if(table==='jagan_results')d=window.__JG_ROWS; if(table==='jagan_entitlements')d=window.__JG_ENT; return Promise.resolve({data:d,error:null}).then(res,rej); };
    return b;
  }
  var client={ auth:{ getUser:async function(){return {data:{user:user},error:null};}, getSession:async function(){return {data:{session:session},error:null};},
      onAuthStateChange:function(cb){ setTimeout(function(){cb('INITIAL_SESSION',session);},0); return {data:{subscription:{unsubscribe:function(){}}}}; },
      signOut:async function(){return {error:null};}, getUserIdentities:async function(){return {data:{identities:user.identities},error:null};} },
    from:builder, rpc:async function(){return {data:null,error:null};}, channel:function(){return {on:function(){return this;},subscribe:function(){return this;}};} };
  window.supabase={createClient:function(){return client;}};
})();`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === 'cdn.jsdelivr.net' && /supabase/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB });
  if (u.pathname === '/api/public-config') return route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.__ED_PUBLIC_CONFIG__=Object.freeze({appEnv:'preview',supabaseUrl:'https://qelqehkigydgrwedbgtr.supabase.co',supabaseAnonKey:'sb_publishable_x',projectRef:'qelqehkigydgrwedbgtr',completeSalesOpen:false,completeApiReady:false,jaganSalesOpen:${SALES}});window.__JG_ROWS=${JSON.stringify(rows)};window.__JG_ENT=${JSON.stringify(ENT)};` });
  if (u.hostname === 'localhost' && /\/mypage(\.html)?$/.test(u.pathname)) { const html = fs.readFileSync(path.join(ROOT, 'mypage.html'), 'utf8').replace(/ integrity="[^"]+"/g, '').replace(/ crossorigin="anonymous"/g, ''); return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); }
  if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  if (u.hostname === 'localhost') return route.continue();
  return route.abort();
});
await page.goto(base + '/mypage.html', { waitUntil: 'load' });
try { await page.waitForSelector('.mp-latest', { timeout: 20000 }); } catch (e) {
  console.log('BODY:', (await page.evaluate(() => document.getElementById('root') ? document.getElementById('root').innerText.slice(0, 300) : document.body.innerText.slice(0, 300))).replace(/\s+/g, ' '), errs.slice(0, 5));
  await page.screenshot({ path: OUT + '-debug.png' }); await browser.close(); srv.close(); process.exit(1);
}
await page.evaluate(() => { document.querySelectorAll('details.mp-latest-fold, details.mp-rec').forEach((d, i) => { if (i < 2) d.open = true; }); document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); });
await page.waitForFunction(() => [...document.querySelectorAll('.mp-emblem img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
await page.waitForTimeout(500);
const info = await page.evaluate(() => ({ stats: [...document.querySelectorAll('.mp-stat')].map((x) => x.innerText.replace(/\s+/g, ' ')), trigger: (document.getElementById('mpUpgradeTrigger') || {}).textContent, recs: document.querySelectorAll('details.mp-rec').length, badges: document.querySelectorAll('.mp-badge').length, imgs: [...document.querySelectorAll('.mp-emblem img')].map((i) => i.getAttribute('src').replace('assets/emblems/jagan/', '')), buy: document.querySelectorAll('[data-jagan-buy][data-product="report"]').length, buyComplete: document.querySelectorAll('[data-jagan-buy][data-product="complete"]').length, ctaBg: [...document.querySelectorAll('[data-jagan-buy].primary')].map((b) => getComputedStyle(b).backgroundImage), readComplete: [...document.querySelectorAll('a[href^="/jagan/dipper?r="]')].length, completeChip: document.querySelectorAll('.mp-chip.complete').length, reveal: document.querySelectorAll('[data-mp-reveal]').length, recChips: [...document.querySelectorAll('details.mp-rec summary .mp-chip-row')].map((c) => c.textContent), pending: document.querySelectorAll('.mp-latest .is-pending, .mp-rec .is-pending').length, chips: [...document.querySelectorAll('.mp-latest .mp-chip')].map((c) => c.textContent), read: [...document.querySelectorAll('a[href^="/jagan/report?r="]')].length, overflowX: document.documentElement.scrollWidth > innerWidth }));
console.log(JSON.stringify(info), errs.slice(0, 3));
await page.screenshot({ path: OUT + '-full.png', fullPage: true });
await page.locator('.mp-latest').first().screenshot({ path: OUT + '-latest.png' });
await page.click('#mpUpgradeTrigger');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '-sheet.png' });
await browser.close(); srv.close();
