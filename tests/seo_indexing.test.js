// 検索エンジン向けの設定（robots.txt・sitemap.xml・canonical・noindex）の回帰テスト。
//   ・sitemap.xml に載せた URL は、公開ファイル（dist）として存在し、noindex（ページ内の meta・vercel.json のヘッダー）が無く、
//     canonical が sitemap の URL と一致すること。
//   ・結果・購入・共有・マイページ・サンプル・有料レポートの URL は、必ず noindex であること。
//   ・vercel.json の X-Robots-Tag は、該当する全ルールが重ねて付く（後から外すことはできない）。そのため
//     「検索に出すページに一つでも noindex のルールが当たれば失敗」として、ヘッダーの優先順位を確かめる。
//   実行: node --test tests/seo_indexing.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../scripts/build-public.js');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://element-diagnosis-five.vercel.app';
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

let DIST;
test.before(() => {
  DIST = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ed-seo-')), 'dist');
  const r = B.build({ outDir: DIST });
  assert.deepEqual(r.problems, []);
});
test.after(() => { if (DIST) fs.rmSync(path.dirname(DIST), { recursive: true, force: true }); });

// vercel.json の source（path-to-regexp の一部：:name・:name(正規表現)・(.*)）を正規表現にする
function sourceToRegExp(src) {
  let re = '';
  for (let i = 0; i < src.length;) {
    const rest = src.slice(i);
    let m;
    if ((m = /^:([A-Za-z_]\w*)\(([^)]*\)?[^)]*)\)/.exec(rest))) { re += `(${m[2]})`; i += m[0].length; continue; }
    if ((m = /^:([A-Za-z_]\w*)/.exec(rest))) { re += '([^/]+)'; i += m[0].length; continue; }
    if ((m = /^\(([^)]*)\)/.exec(rest))) { re += `(${m[1]})`; i += m[0].length; continue; }
    re += src[i].replace(/[.*+?^${}|[\]\\/]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${re}$`);
}
// その URL のパスに付く X-Robots-Tag（当たる全ルール）
function robotsHeaders(urlPath) {
  return (VERCEL.headers || [])
    .filter((h) => sourceToRegExp(h.source).test(urlPath))
    .flatMap((h) => h.headers.filter((x) => x.key.toLowerCase() === 'x-robots-tag').map((x) => x.value));
}
// cleanUrls の配信先：/ → index.html、/a/ → a/index.html、/a → a.html（無ければ a/index.html）
function fileFor(urlPath) {
  if (urlPath.endsWith('/')) return path.join(DIST, urlPath, 'index.html');
  const f = path.join(DIST, `${urlPath}.html`);
  return fs.existsSync(f) ? f : path.join(DIST, urlPath, 'index.html');
}
const metaRobots = (html) => (/<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html) || [])[1] || '';
const canonical = (html) => (/<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(html) || [])[1] || '';
const sitemapLocs = () => [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

test('robots.txt：全体を許可し、sitemap.xml の場所を示す', () => {
  const t = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(t, /^User-agent: \*$/m);
  assert.doesNotMatch(t, /^Disallow:\s*\/\s*$/m);
  assert.match(t, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, 'm'));
});

test('sitemap.xml：元素診断の TOP・タイプ解説35件と、邪眼診断のトップ・理論ページを載せる（重複なし）', () => {
  const locs = sitemapLocs();
  assert.equal(new Set(locs).size, locs.length, '重複した URL があります');
  for (const u of [`${ORIGIN}/`, `${ORIGIN}/jagan/`, `${ORIGIN}/jagan/about`]) assert.ok(locs.includes(u), `sitemap にありません: ${u}`);
  assert.equal(locs.filter((u) => u.startsWith(`${ORIGIN}/type/`)).length, 35);
  for (const u of locs) assert.ok(u.startsWith(`${ORIGIN}/`), `本番のドメインではありません: ${u}`);
});

test('sitemap.xml の URL：公開ファイルがあり、noindex が無く（meta・ヘッダー）、canonical が一致する', () => {
  for (const loc of sitemapLocs()) {
    const p = new URL(loc).pathname;
    const f = fileFor(p);
    assert.ok(fs.existsSync(f), `${loc} の配信ファイルが dist にありません`);
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(metaRobots(html), /noindex|none/i, `${loc} のページ内に noindex があります`);
    for (const v of robotsHeaders(p)) assert.doesNotMatch(v, /noindex|none/i, `${loc} に vercel.json の noindex ヘッダーが当たります`);
    assert.equal(canonical(html), loc, `${loc} の canonical が一致しません`);
  }
});

test('邪眼診断のトップ：/jagan（スラッシュ無し）も noindex ヘッダーが当たらず、canonical は /jagan/ を指す', () => {
  for (const v of robotsHeaders('/jagan')) assert.doesNotMatch(v, /noindex/i);
  const html = fs.readFileSync(path.join(DIST, 'jagan/index.html'), 'utf8');
  assert.equal(canonical(html), `${ORIGIN}/jagan/`);
  assert.match(html, /<title>邪眼診断｜原神の邪眼とファトゥスで知る、もう一人の自分<\/title>/);
});

// 検索に出さない URL（結果・購入・共有・マイページ・サンプル・有料レポート）
const PRIVATE = [
  '/result', '/report', '/report-link', '/purchase-complete', '/mypage', '/complete-sample', '/report_sample',
  '/jagan/sample', '/jagan/complete-sample', '/jagan/dipper', '/jagan/report',
  '/jagan/s/abc123', '/jagan/share', '/j/Ab12Cd',
];
test('検索に出さない URL：vercel.json のヘッダーで noindex が付く', () => {
  for (const p of PRIVATE) {
    assert.ok(robotsHeaders(p).some((v) => /noindex/i.test(v)), `${p} に noindex のヘッダーが付きません`);
  }
});

test('検索に出さない URL：sitemap.xml に載せない。邪眼のサンプル・DIPPER・レポートはページ内の noindex も保つ', () => {
  const paths = sitemapLocs().map((u) => new URL(u).pathname);
  for (const p of PRIVATE) assert.ok(!paths.includes(p), `${p} が sitemap にあります`);
  for (const f of ['jagan/sample.html', 'jagan/complete-sample.html', 'jagan/dipper.html', 'jagan/report.html']) {
    assert.match(metaRobots(fs.readFileSync(path.join(ROOT, f), 'utf8')), /noindex/, `${f} のページ内の noindex がありません`);
  }
});

test('元素診断の公開ページ：エニアグラムを理論の土台として示さない（v2 は Big Five・対人スタイル・価値観理論）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.doesNotMatch(head, /エニアグラム|Enneagram/, 'title・description・構造化データにエニアグラムがあります');
  // 画面に出る箇所（ヒーロー・About・診断の案内・運営者情報）。旧版の結果の理論（renderBasis の v1 部分）とコメントは除く
  const body = html.slice(html.indexOf('<body'));
  const visible = body
    .replace(/<script[\s\S]*?<\/script>/g, (s) => {
      const intro = /function renderIntro[\s\S]*?\n}\n/.exec(s);
      const v2 = /function renderBasisV2[\s\S]*?\n}\n/.exec(s);
      return (intro ? intro[0] : '') + (v2 ? v2[0] : '');
    });
  assert.doesNotMatch(visible, /エニアグラム|Enneagram/);
  assert.match(head, /Big Five・対人スタイル・シュワルツの価値観理論/);
});
