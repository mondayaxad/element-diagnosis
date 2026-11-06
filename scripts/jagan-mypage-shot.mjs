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

const EL = ['炎', '水', '風', '雷', '草', '氷', '岩'];
const NAMES = { 炎: ['PY', '焔の者'], 水: ['HY', '縋望者'], 風: ['AN', '逸風者'], 雷: ['EL', '閃雷者'], 草: ['DE', '蔓の者'], 氷: ['CR', '凍れる者'], 岩: ['GE', '巌の者'] };
const rows = [['水', '依存', 'DP', '縋望者', 'カピターノ', 71, '2026-11-06'], ['炎', '衝動', 'IM', '焔衝者', 'アルレッキーノ', 83, '2026-11-04'], ['風', '撤退', 'WD', '逸風者', 'サンドローネ', 82, '2026-11-02']]
  .map(([el, ty, c2, name, ch, m, d], i) => ({ result_id: `00000000-0000-4000-8000-00000000000${i}`, created_at: `${d}T03:00:00Z`, interpretation_version: 'x',
    headline: { element: el, type: ty, code: NAMES[el][0] + c2, name, character: ch, matchPercent: m } }));

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
  if (u.pathname === '/api/public-config') return route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.__ED_PUBLIC_CONFIG__=Object.freeze({appEnv:'preview',supabaseUrl:'https://qelqehkigydgrwedbgtr.supabase.co',supabaseAnonKey:'sb_publishable_x',projectRef:'qelqehkigydgrwedbgtr',completeSalesOpen:false,completeApiReady:false});window.__JG_ROWS=${JSON.stringify(rows)};window.__JG_ENT=${JSON.stringify([{ result_id: rows[1].result_id, status: 'active' }])};` });
  if (u.hostname === 'localhost' && /\/mypage(\.html)?$/.test(u.pathname)) { const html = fs.readFileSync(path.join(ROOT, 'mypage.html'), 'utf8').replace(/ integrity="[^"]+"/g, '').replace(/ crossorigin="anonymous"/g, ''); return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); }
  if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  if (u.hostname === 'localhost') return route.continue();
  return route.abort();
});
await page.goto(base + '/mypage.html#jagan', { waitUntil: 'load' });
try { await page.waitForSelector('#jagan .jg-mp-row', { timeout: 20000 }); } catch (e) {
  console.log('BODY:', (await page.evaluate(() => document.getElementById('root') ? document.getElementById('root').innerText.slice(0, 300) : document.body.innerText.slice(0, 300))).replace(/\s+/g, ' '), errs.slice(0, 5));
  await page.screenshot({ path: OUT + '-debug.png' }); await browser.close(); srv.close(); process.exit(1);
}
await page.waitForFunction(() => [...document.querySelectorAll('#jagan img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
await page.waitForTimeout(500);
const info = await page.evaluate(() => ({ rows: document.querySelectorAll('#jagan .jg-mp-row').length, imgs: [...document.querySelectorAll('#jagan img')].map((i) => i.getAttribute('src').replace('assets/emblems/jagan/', '')), overflowX: document.documentElement.scrollWidth > innerWidth }));
console.log(JSON.stringify(info), errs.slice(0, 3));
await page.screenshot({ path: OUT + '-full.png', fullPage: true });
await page.locator('#jagan').scrollIntoViewIfNeeded();
await page.locator('#jagan').screenshot({ path: OUT + '-section.png' });
await browser.close(); srv.close();
