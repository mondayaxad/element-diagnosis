// インデックス制御の回帰テスト（全ルート）。scripts/seo-policy.js の方針一覧を正として、
//   dist（公開ファイル）・vercel.json（rewrite・X-Robots-Tag）・sitemap.xml・robots.txt・各ページの meta・API の応答を突き合わせる。
//   ・方針の未定義：dist の HTML と vercel.json の rewrite は、すべて方針一覧に載っていること（新しいページの決め忘れを検出）
//   ・index：拡張子なし・末尾スラッシュの両方で noindex が当たらず、canonical は正規 URL、sitemap に載る
//   ・noindex：拡張子なし・末尾スラッシュの両方で vercel.json の X-Robots-Tag が当たる（ページ内の meta も残す）
//   ・共有ページ（/api/share・邪眼の共有）は関数の応答ヘッダーで noindex。共有の機能（OGP・転送）は変わらない
//   実行: node --test tests/seo_index_guard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../scripts/build-public.js');
const P = require('../scripts/seo-policy.js');
const { ROOT, VERCEL, robotsHeaders, metaRobots, canonical, sitemapLocs, variants, sourceToRegExp } = require('./seo_helpers.js');

let DIST;
test.before(() => {
  DIST = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ed-seo-guard-')), 'dist');
  const r = B.build({ outDir: DIST });
  assert.deepEqual(r.problems, []);
});
test.after(() => { if (DIST) fs.rmSync(path.dirname(DIST), { recursive: true, force: true }); });

const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');
const hasNoindex = (v) => /noindex|none/i.test(v || '');
const pages = (policy) => Object.entries(P.PAGES).filter(([, v]) => v.policy === policy);

test('方針の未定義を検出：dist の HTML はすべて scripts/seo-policy.js に載っている（載っていない HTML があれば失敗）', () => {
  const html = B.walk(DIST).filter((f) => f.endsWith('.html')).sort();
  const missing = html.filter((f) => !P.PAGES[f]);
  assert.deepEqual(missing, [], `インデックス方針が未定義の公開ページ: ${missing.join(', ')}`);
  const gone = Object.keys(P.PAGES).filter((f) => !html.includes(f));
  assert.deepEqual(gone, [], `方針一覧にあるが公開されていないページ: ${gone.join(', ')}`);
  assert.equal(pages('index').length, 39);
});

test('方針の未定義を検出：vercel.json の rewrite・HTML を返す API はすべて方針一覧に載っている', () => {
  const dyn = P.DYNAMIC.map((d) => d.pattern);
  for (const r of VERCEL.rewrites || []) {
    const src = r.source.replace(/\(\[[^\]]*\]\{[^}]*\}\)/g, ''); // /j/:k([0-9A-Za-z]{4,21}) → /j/:k
    assert.ok(dyn.includes(src), `rewrite の方針が未定義: ${r.source}`);
  }
  // HTML を返す API（text/html を返すもの）
  for (const f of fs.readdirSync(path.join(ROOT, 'api'))) {
    if (!/\.(m?js)$/.test(f) || f.startsWith('_')) continue;
    const src = fs.readFileSync(path.join(ROOT, 'api', f), 'utf8');
    const servesHtml = /text\/html/.test(src) || /createSharePageHandler/.test(src);
    if (!servesHtml) continue;
    const route = `/api/${f.replace(/\.m?js$/, '')}`;
    if (route === '/api/complete-status') continue; // 有料レポートの生成 HTML（認証つき・private, no-store・noindex を自前で返す）
    assert.ok(dyn.includes(route), `HTML を返す API の方針が未定義: ${route}`);
  }
});

test('index：39件（TOP・7元素ガイド・邪眼トップ・理論・タイプ35）は、拡張子なし・末尾スラッシュの両方で noindex が当たらず、canonical は正規 URL', () => {
  for (const [file, v] of pages('index')) {
    const html = read(file);
    assert.ok(!hasNoindex(metaRobots(html)), `${v.path} のページ内に noindex があります`);
    for (const p of variants(v.path)) {
      for (const h of robotsHeaders(p)) assert.ok(!hasNoindex(h), `${p} に vercel.json の noindex ヘッダーが当たります（${h}）`);
    }
    assert.equal(canonical(html), P.ORIGIN + v.path, `${v.path} の canonical`);
    assert.match(html, /<html lang="ja"/, `${v.path} の lang`);
    assert.match(html, /<title>[^<]{4,}<\/title>/, `${v.path} の title`);
    assert.match(html, /<meta name="description" content="[^"]{20,}">/, `${v.path} の description`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${v.path} の H1 は1つ`);
  }
});

test('sitemap.xml は index の39件と完全に一致する（多くも少なくもない）', () => {
  assert.deepEqual([...sitemapLocs()].sort(), P.indexUrls().sort());
});

test('allow（法務・所有権確認）：noindex は当てず、sitemap にも載せない', () => {
  const locs = sitemapLocs().map((u) => new URL(u).pathname);
  for (const [file, v] of pages('allow')) {
    for (const p of variants(v.path)) for (const h of robotsHeaders(p)) assert.ok(!hasNoindex(h), `${p} に noindex が当たります`);
    if (!v.plain) assert.ok(!hasNoindex(metaRobots(read(file))), `${file} に noindex があります`);
    assert.ok(!locs.includes(v.path), `${v.path} が sitemap にあります`);
  }
});

test('noindex：公開 HTML は、拡張子なし・末尾スラッシュの両方に vercel.json の X-Robots-Tag が当たり、ページ内の meta robots も noindex', () => {
  for (const [file, v] of pages('noindex')) {
    for (const p of variants(v.path)) {
      assert.ok(robotsHeaders(p).some(hasNoindex), `${p} に noindex のヘッダーが当たりません（末尾スラッシュの漏れ）`);
    }
    assert.ok(hasNoindex(metaRobots(read(file))), `${file} のページ内に meta robots の noindex がありません`);
  }
});

test('noindex：rewrite のルート（結果・邪眼の共有）は、末尾スラッシュも含めてヘッダーで noindex', () => {
  for (const d of P.DYNAMIC.filter((x) => x.header !== 'function')) {
    for (const s of d.samples) for (const p of variants(s)) {
      assert.ok(robotsHeaders(p).some(hasNoindex), `${p} に noindex のヘッダーが当たりません`);
    }
  }
});

test('ヘッダーとページ内 robots の整合：index のページに noindex のヘッダーを当てる広い指定（/(.*) など）が無い', () => {
  for (const h of VERCEL.headers) {
    if (!h.headers.some((x) => x.key.toLowerCase() === 'x-robots-tag' && hasNoindex(x.value))) continue;
    const re = sourceToRegExp(h.source);
    for (const [, v] of pages('index')) for (const p of variants(v.path)) assert.ok(!re.test(p), `${h.source} が index の ${p} に当たります`);
  }
});

test('末尾スラッシュの解釈：vercel.json の {/}? は、拡張子なし・末尾スラッシュの両方だけに当たり、似た別のパスには当たらない', () => {
  const re = sourceToRegExp('/report{/}?');
  assert.ok(re.test('/report') && re.test('/report/'));
  assert.ok(!re.test('/report-link') && !re.test('/report_sample') && !re.test('/reports') && !re.test('/report//'));
});

test('robots.txt：noindex のページ・共有をクロール拒否しない（拒否すると noindex が読まれない）', () => {
  const t = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  const dis = [...t.matchAll(/^Disallow:\s*(\S*)\s*$/gm)].map((m) => m[1]).filter(Boolean);
  const targets = [...pages('noindex').map(([, v]) => v.path), ...P.DYNAMIC.flatMap((d) => d.samples), ...P.indexUrls().map((u) => new URL(u).pathname)];
  for (const d of dis) for (const p of targets) assert.ok(!p.startsWith(d), `robots.txt の Disallow: ${d} が ${p} を拒否します`);
});

test('旧ページ・テスト用ページ：公開されない（404 のまま）', () => {
  for (const f of ['gensokouro.html', 'index-test.html', 'diagnosis-ui-demo.html', 'index-demo-v3.html', 'ogp-card-demo.html', 'result-save-demo.html']) {
    assert.ok(!fs.existsSync(path.join(DIST, f)), `${f} が公開されています`);
  }
});

test('クエリ付き URL：index のページの canonical はクエリを含まない絶対 URL（?code=・?utm_* などは正規 URL に集約される）', () => {
  for (const [file, v] of pages('index')) {
    const c = canonical(read(file));
    assert.match(c, /^https:\/\/element-diagnosis-five\.vercel\.app\/[^?#]*$/, `${v.path}: ${c}`);
  }
});

test('タイプ解説35件：title・description は重複せず、og:url・canonical は自分自身', () => {
  const titles = new Set(); const descs = new Set();
  for (const c of P.TYPE_CODES) {
    const html = read(`type/${c}.html`);
    const t = /<title>([^<]+)<\/title>/.exec(html)[1];
    const d = /<meta name="description" content="([^"]+)">/.exec(html)[1];
    assert.ok(!titles.has(t) && !descs.has(d), `${c} の title・description が重複`);
    titles.add(t); descs.add(d);
    assert.match(html, new RegExp(`<meta property="og:url" content="${P.ORIGIN}/type/${c}">`));
  }
  assert.equal(titles.size, 35);
});

// ---- 共有ページ（関数の応答） ----
function fakeRes() {
  const r = { headers: {}, code: 0, body: '' };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.send = (b) => { r.body = String(b); return r; };
  r.end = (b) => { r.body = String(b || ''); return r; };
  return r;
}
test('/api/share：p 形式・dv/mv 付き・旧 el/w/nat 形式・値の欠け・壊れた値のすべてで X-Robots-Tag: noindex（nofollow は付けない）。OGP・転送は従来どおり', async () => {
  const handler = require('../api/share.js');
  const cases = [
    '/api/share?code=AUDITDUMMY&p=6dfgg',
    '/api/share?dv=ETI-2.0&code=AUDITDUMMY&mv=2.1.0&p=6dfgg',
    '/api/share?code=AUDITDUMMY&el=EL&w=CM&nat=I&c=1&m=80',
    '/api/share',
    '/api/share?p=%%%&code=',
    '/api/share/?code=AUDITDUMMY&p=6dfgg',
  ];
  for (const u of cases) {
    const res = fakeRes();
    await handler({ url: u, headers: { host: 'element-diagnosis-five.vercel.app' } }, res);
    assert.equal(res.headers['x-robots-tag'], 'noindex', `${u} の X-Robots-Tag は noindex（検索結果に出さない。リンクの追跡は止めない）`);
    assert.equal(res.code, 200, u);
    assert.match(res.body, /<meta property="og:image" content="https:\/\/element-diagnosis-five\.vercel\.app\/api\/og-image\?/, `${u} の og:image`);
    assert.match(res.body, /<meta name="twitter:card" content="summary_large_image">/, `${u} の X のカード`);
    assert.match(res.body, /<meta http-equiv="refresh" content="0;url=https:\/\/element-diagnosis-five\.vercel\.app\/\?/, `${u} の転送`);
    assert.match(res.body, /window\.location\.replace\(/, `${u} の転送（JS）`);
  }
  // 結果の復元に使う値（dv・code・mv）は、転送先にそのまま残る
  const res = fakeRes();
  await handler({ url: cases[1], headers: { host: 'element-diagnosis-five.vercel.app' } }, res);
  assert.match(res.body, /url=https:\/\/element-diagnosis-five\.vercel\.app\/\?dv=ETI-2\.0&amp;code=AUDITDUMMY&amp;mv=2\.1\.0"/);
});

test('邪眼の共有ページ（/api/jagan-share-page）：見つからない時も、URL に値を載せた形でも X-Robots-Tag と meta robots の noindex', async () => {
  const { createSharePageHandler } = await import('../lib/jagan-api.mjs');
  const handler = createSharePageHandler({ env: {}, fetchImpl: async () => { throw new Error('network not allowed in test'); } });
  for (const u of ['/api/jagan-share-page', '/api/jagan-share-page?k=AUDIT000', '/api/jagan-share-page?id=AUDIT0000']) {
    const res = fakeRes();
    try { await handler({ url: u, headers: { host: 'element-diagnosis-five.vercel.app' } }, res); } catch { /* DB を使う形は失敗してよい。ヘッダーは最初に付く */ }
    assert.match(res.headers['x-robots-tag'] || '', /noindex/, `${u} のヘッダー`);
    if (res.body) assert.match(res.body, /<meta name="robots" content="noindex,nofollow">/, `${u} の meta`);
  }
});
