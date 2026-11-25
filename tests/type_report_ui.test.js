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
