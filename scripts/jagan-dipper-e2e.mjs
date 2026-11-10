// 完了ページ → 購入（模擬の API）→ 解析レポート・完全解析のページ、までを通しで確かめる（dist を配信。Stripe・DB は使わない）。
//   ・50問を実際に回答し、完了ページの ¥1,000 と ¥3,000 の申込で、サーバーへ送る回答が完了ページの回答と同じこと
//   ・固有リンク（模擬の op=link-open）がその回答を返すと、解析レポート・完全解析が同じ DTI・邪眼・異相・人物で表示されること
//   ・完全解析は23ページ、最後に「マイページに登録する」。解析レポートの下部に完全解析の申込
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('../dist', import.meta.url).pathname;
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
const srv = http.createServer((q, r) => {
  let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0].split('#')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(0);
const base = `http://localhost:${srv.address().port}`;
const TOKEN = 'T'.repeat(43);
const out = { errors: [] };
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', (e) => out.errors.push(String(e)));
let bought = []; let lastBuy = null;
await p.route(/cdn\.jsdelivr|googletagmanager|google-analytics|fonts\.g/, (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
await p.route('**/api/public-config**', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.__ED_PUBLIC_CONFIG__=Object.freeze({appEnv:'preview',jaganSalesOpen:true});" }));
await p.route('**/api/jagan-report?op=*', async (r) => {
  const op = new URL(r.request().url()).searchParams.get('op');
  const body = JSON.parse(r.request().postData() || '{}');
  if (op === 'buy') { bought.push(body); lastBuy = body; return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'service_unavailable' }) }); }
  if (op === 'link-open') {
    const src = bought.find((x) => (x.product || 'report') === (r.request().url().includes('dipper') ? 'complete' : 'report')) || lastBuy;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'paid', report: { resultId: src.resultId, itemSetVersion: src.itemSetVersion, answers: src.answers, paidAt: '2026-11-10T00:00:00Z', headline: null, product: globalThis.__product } }) });
  }
  return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
});
// 1) 50問に答えて完了ページへ
await p.goto(`${base}/jagan/`);
await p.waitForTimeout(500);
await p.click('.jt-hero [data-start]'); await p.waitForTimeout(300);
const pat = [5, 2, 4, 3, 4, 2, 1, 5, 3]; let k = 0;
for (let i = 0; i < 200; i++) {
  const q = await p.evaluate(() => { if (document.querySelector('#qResult')) return 'done'; const c = document.querySelector('.qz-card.is-active'); return c ? c.dataset.qid : null; });
  if (q === 'done') break;
  if (!q) { await p.waitForTimeout(350); continue; }
  await p.click(`.qz-card[data-qid="${q}"] .qz-dot[data-v="${pat[k++ % 9]}"]`); await p.waitForTimeout(40);
  if (await p.evaluate(() => !!document.querySelector('.qz-card') && [...document.querySelectorAll('.qz-card')].every((c) => c.querySelector('.is-on')))) await p.waitForTimeout(420);
}
await p.click('#qResult');
await p.waitForTimeout(1200);
const shown = await p.evaluate(() => ({ code: (document.querySelector('#resultBody') || {}).innerText.match(/\b[A-Z]{4}\b/)?.[0], last: JSON.parse(localStorage.getItem('jagan_last_v1') || 'null') }));
out.resultCode = shown.code;
// 2) 完了ページの ¥1,000・¥3,000 の申込（サーバーへ送る回答）
await p.evaluate(() => document.querySelector('#resultBody .rx-buy-all').click());
await p.waitForTimeout(600);
await p.evaluate(() => { const d = document.querySelector('.dp-reveal'); d.open = true; d.querySelector('[data-buy="complete"]').click(); });
await p.waitForTimeout(600);
out.buys = bought.map((x) => ({ product: x.product || 'report', sameAnswers: JSON.stringify(x.answers) === JSON.stringify(shown.last.answers), sameId: x.resultId === shown.last.resultId, n: Object.keys(x.answers || {}).length }));
// 3) 固有リンクから解析レポート・完全解析
const { computeDiagnosis } = await import('../jagan/engine/runtime.mjs');
const { BUNDLE } = await import('../jagan/engine/data.mjs');
const expect = computeDiagnosis({ answers: shown.last.answers, resultId: shown.last.resultId, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
out.expect = { code: expect.dti.code, element: expect.element.label, isou: expect.isou.label, fatui: expect.character.name };
globalThis.__product = 'report';
await p.route('**/api/jagan-report?op=link-open', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'paid', report: { resultId: shown.last.resultId, itemSetVersion: BUNDLE.items.item_set_version, answers: shown.last.answers, paidAt: '2026-11-10T00:00:00Z', headline: null, product: globalThis.__product } }) }));
await p.goto(`${base}/jagan/report#t=${TOKEN}`); await p.waitForTimeout(1500);
out.report = await p.evaluate(() => ({ text: document.getElementById('rpBody').innerText.slice(0, 400), dipper: !!document.querySelector('#rpDipper [data-buy="complete"]:not([disabled])'), register: !document.getElementById('registerBtn').hidden }));
globalThis.__product = 'complete';
await p.goto(`${base}/jagan/dipper#t=${TOKEN}`); await p.waitForTimeout(2500);
out.dipper = await p.evaluate(() => ({ pages: document.querySelectorAll('.dp-page').length, cover: (document.querySelector('.dp-page') || {}).innerText, keep: !document.getElementById('dpKeep').hidden, register: !document.getElementById('registerBtn').hidden, lastIsKeep: document.getElementById('dpBook').nextElementSibling.id }));
await p.locator('#dpKeep').screenshot({ path: process.argv[2] || '/tmp/dipper-keep.png' });
out.report.hasCode = out.report.text.includes(out.expect.code);
out.dipper.hasCode = (out.dipper.cover || '').includes(out.expect.code) && (out.dipper.cover || '').includes(out.expect.fatui);
delete out.report.text; delete out.dipper.cover;
console.log(JSON.stringify(out));
await b.close(); srv.close();
