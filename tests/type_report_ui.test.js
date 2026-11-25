// タイプ別レポート（report.html をタイプ別レポートとして開いた時）の回帰テスト。
//   ・/api/report-data が report_kind:'type'・type_code を返した時だけ：主語はタイプ名（「あなた」を出さない）、
//     解説は最新の文（js/type-report-texts.js）、完全解析の案内は出さない、タイトルは「タイプ別レポート「<名前>」」
//   ・既存の解析レポート（report_kind なし）は従来どおり（「あなた」・既存の文・完全解析の案内）
//   ・js/type-report-texts.js は生成スクリプトの出力と一致する
//   実行: node --test tests/type_report_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pipeFile } = require('./fixtures/serve_file');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const ROOT = path.join(__dirname, '..');
const STD = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/type-standard-answers.json'), 'utf8')).types;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json' };

test('js/type-report-texts.js は生成スクリプトの出力と一致する', async () => {
  const { renderTexts } = await import('../scripts/build-type-report-texts.mjs');
  assert.equal(fs.readFileSync(path.join(ROOT, 'js/type-report-texts.js'), 'utf8'), renderTexts());
});

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    pipeFile(f, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function open(code, kind) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.route(/googletagmanager|google-analytics|fonts\.(googleapis|gstatic)|cdnjs\.cloudflare\.com|supabase-js/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route(/\/api\/public-config/, (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.__ED_PUBLIC_CONFIG__ = null;' }));
  await p.route(/\/api\/report-data/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign(
    { code: STD[code].diagnosis_code, diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: true }, viewer: null, complete: null },
    kind === 'type' ? { report_kind: 'type', type_code: code } : {})) }));
  await p.route(/\/api\/(?!report-data|public-config)/, (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await p.goto(`${base}/report.html?token=TEST`);
  await p.waitForFunction(() => /ELEMENT DIAGNOSIS/.test(document.body.innerText), null, { timeout: 15000 });
  const r = await p.evaluate(() => ({ text: document.body.innerText, title: document.title }));
  await ctx.close();
  return Object.assign(r, { errors });
}

test('タイプ別レポート：主語はタイプ名、最新の解説文、完全解析の案内なし（炎・氷・風の片手剣）', { skip: !chromium }, async () => {
  for (const [code, name, nation] of [['PYSW', '殉愛者', 'ナタ'], ['CRSW', '宿縁者', 'スネージナヤ'], ['ANSW', '随風者', 'モンド']]) {
    const r = await open(code, 'type');
    assert.deepEqual(r.errors, [], code);
    assert.equal(r.title, `タイプ別レポート「${name}」｜元素診断`);
    assert.doesNotMatch(r.text, /あなた/, `${code} に「あなた」`);
    assert.ok(r.text.includes(`${name}の土台`), `${code} の「${name}の土台」`);
    assert.ok(r.text.includes(nation), `${code} の代表国家`);
    assert.ok(r.text.includes('支え合いと信頼を重視する傾向'), `${code} の最新の解説文`);
    assert.doesNotMatch(r.text, /援助者・堅実家|完全解析|BEYOND THE REPORT|46ページ/, `${code} に旧い文・完全解析の案内`);
  }
});

test('既存の解析レポート（report_kind なし）は従来どおり：「あなた」・既存の文・完全解析の案内', { skip: !chromium }, async () => {
  const r = await open('PYSW', 'analysis');
  assert.deepEqual(r.errors, []);
  assert.match(r.text, /あなたの土台/);
  assert.match(r.text, /援助者・堅実家/);
  assert.match(r.text, /完全解析|BEYOND THE REPORT/);
  assert.doesNotMatch(r.title, /タイプ別レポート/);
});

test('report.html：タイプ別レポートは report_kind:"type" と正しい形の type_code の時だけ', () => {
  const h = fs.readFileSync(path.join(ROOT, 'report.html'), 'utf8');
  assert.match(h, /data\.report_kind === 'type'/);
  assert.match(h, /\/\^\(PY\|HY\|CR\|EL\|AN\|GE\|DE\)\(SW\|CM\|PL\|CT\|BW\)\$\//);
  assert.match(h, /<script src="js\/type-report-texts\.js"><\/script>/);
});

// 購入後の流れ：固有リンク（/type-report#t=…）→ 支払い済みならレポートへ直接移る → レポートの最下部に
//   保存用の固有リンク（同じタブの sessionStorage から）と、無料診断への導線
//   固有リンクは https の同じオリジンだけ出すため、https の仮のオリジンで配る
const ORIGIN = 'https://eti.test';
async function httpsPage(code, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.route(/googletagmanager|google-analytics|fonts\.(googleapis|gstatic)|cdnjs\.cloudflare\.com|supabase-js/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route(`${ORIGIN}/**`, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/public-config') return r.fulfill({ contentType: 'application/javascript', body: 'window.__ED_PUBLIC_CONFIG__ = null;' });
    if (u.pathname === '/api/type-report') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(
      { ok: true, state: 'paid', type: code, typeName: STD[code].name, purchasedOn: '2026-11-25', reportUrl: '/report.html?token=TEST' }) });
    if (u.pathname === '/api/report-data') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(
      Object.assign({ code: STD[code].diagnosis_code, diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: true }, viewer: null, complete: null },
        opts.kind === 'analysis' ? {} : { report_kind: 'type', type_code: code })) });
    if (u.pathname.startsWith('/api/')) return r.fulfill({ contentType: 'application/json', body: '{}' });
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  if (opts.link !== undefined) await p.addInitScript((v) => { try { sessionStorage.setItem('ed_type_report_link_v1', v); } catch (e) {} }, opts.link);
  return { ctx, p, errors };
}
async function footerOf(p) {
  await p.waitForFunction(() => /ELEMENT DIAGNOSIS/.test(document.body.innerText), null, { timeout: 15000 });
  return p.evaluate(() => {
    const f = document.querySelector('.type-report-foot');
    if (!f) return null;
    const a = f.querySelector('a');
    return { text: f.innerText, cta: a && a.getAttribute('href'), copy: !!f.querySelector('[data-type-report-copy]'), last: f === f.parentNode.lastElementChild, pdfSkip: f.hasAttribute('data-pdf-skip') };
  });
}
const SECRET = 'A'.repeat(21) + '-_' + 'b'.repeat(20);

test('購入後：固有リンクのページからレポートへ直接移り、最下部に保存用リンクと無料診断の導線', { skip: !chromium }, async () => {
  const { ctx, p, errors } = await httpsPage('PYSW');
  await p.goto(`${ORIGIN}/type-report#t=${SECRET}`);
  await p.waitForURL(/\/report\.html\?token=TEST$/, { timeout: 15000 });
  const f = await footerOf(p);
  const saved = await p.evaluate(() => sessionStorage.getItem('ed_type_report_link_v1'));
  await ctx.close();
  assert.deepEqual(errors, []);
  assert.equal(saved, `${ORIGIN}/type-report#t=${SECRET}`);
  assert.ok(f, '最下部の欄');
  assert.ok(f.last && f.pdfSkip);
  assert.ok(f.copy, '保存用リンクのコピー');
  assert.match(f.text, /このレポートを開くリンク/);
  assert.match(f.text, /殉愛者は、元素診断の35タイプのひとつです/);
  assert.equal(f.cta, '/');
  assert.match(f.text, /無料の元素診断で、自分のタイプを確かめる/);
  assert.doesNotMatch(f.text, /あなた/);
});

test('最下部の保存用リンクは、正しい形・同じオリジンの固有リンクの時だけ（無料診断の導線は常に）', { skip: !chromium }, async () => {
  for (const link of [null, 'javascript:alert(1)', `https://evil.test/type-report#t=${SECRET}`, `${ORIGIN}/type-report#t=short`, `${ORIGIN}/report.html?token=TEST`]) {
    const { ctx, p, errors } = await httpsPage('CRSW', { link: link === null ? undefined : link });
    await p.goto(`${ORIGIN}/report.html?token=TEST`);
    const f = await footerOf(p);
    await ctx.close();
    assert.deepEqual(errors, [], String(link));
    assert.ok(f && !f.copy, `${link} で保存用リンクを出さない`);
    assert.doesNotMatch(f.text, /このレポートを開くリンク/);
    assert.equal(f.cta, '/');
  }
});

test('既存の解析レポートには、タイプ別レポートの最下部の欄を出さない', { skip: !chromium }, async () => {
  const { ctx, p, errors } = await httpsPage('PYSW', { kind: 'analysis', link: `${ORIGIN}/type-report#t=${SECRET}` });
  await p.goto(`${ORIGIN}/report.html?token=TEST`);
  const f = await footerOf(p);
  await ctx.close();
  assert.deepEqual(errors, []);
  assert.equal(f, null);
});
