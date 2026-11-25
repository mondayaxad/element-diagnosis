// 構造化データ（JSON-LD）の回帰テスト（SEO Phase 2）。
//   ・公開ページの JSON-LD はすべて JSON として解析できる
//   ・邪眼診断：/jagan/ は WebApplication（無料の診断だけを Offer に）、/jagan/about は WebPage と BreadcrumbList
//   ・description・url は、ページの meta description・canonical と一致する
//   ・使わない型（FAQPage・Review・AggregateRating・医療系）は邪眼のページに無い
//   実行: node --test tests/seo_jsonld.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../scripts/seo-policy.js');

const ROOT = path.join(__dirname, '..');
const O = P.ORIGIN;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const blocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const metaDesc = (html) => /<meta name="description" content="([^"]*)">/.exec(html)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const canonical = (html) => /<link rel="canonical" href="([^"]*)">/.exec(html)[1];
const types = (v) => { const out = []; const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x['@type']) out.push(x['@type']); Object.values(x).forEach(walk); } }; walk(v); return out; };

test('公開ページ（index・noindex 以外）の JSON-LD は、すべて JSON として解析できる', () => {
  let n = 0;
  for (const [file, v] of Object.entries(P.PAGES)) {
    if (v.policy !== 'index') continue;
    for (const b of blocks(read(file))) { assert.doesNotThrow(() => JSON.parse(b), file); n++; }
  }
  assert.ok(n >= 38, `JSON-LD の数 ${n}`); // TOP・タイプ35・邪眼2
});

test('/jagan/：WebApplication。無料の診断（50問・0円）だけを Offer に載せ、description・url はページと一致する', () => {
  const html = read('jagan/index.html');
  const bs = blocks(html);
  assert.equal(bs.length, 1);
  const ld = JSON.parse(bs[0]);
  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'WebApplication');
  assert.equal(ld.name, '邪眼診断');
  assert.equal(ld.url, canonical(html));
  assert.equal(ld.url, `${O}/jagan/`);
  assert.equal(ld.description, metaDesc(html));
  assert.match(ld.description, /医療診断ではありません/);
  assert.equal(ld.isAccessibleForFree, true);
  assert.deepEqual(ld.offers, { '@type': 'Offer', name: '邪眼診断（50問）', price: '0', priceCurrency: 'JPY' }, '有料の解析レポート・DIPPER は載せない');
  assert.doesNotMatch(bs[0], /1,?000|3,?000|DIPPER|解析レポート/, '有料商品の情報を混ぜない');
  // ページに実在する情報：50問・無料
  assert.match(html, /50の問い|50問/);
  assert.match(html, /診断：無料/);
});

test('/jagan/about：WebPage と BreadcrumbList。description・url はページと一致し、パンくずは 邪眼診断 → 理論', () => {
  const html = read('jagan/about.html');
  const bs = blocks(html);
  assert.equal(bs.length, 1);
  const [page, crumbs] = JSON.parse(bs[0]);
  assert.equal(page['@type'], 'WebPage');
  assert.equal(page.url, canonical(html));
  assert.equal(page.description, metaDesc(html));
  assert.equal(page.name, '邪眼診断の理論');
  assert.match(html, /<h1[^>]*>邪眼診断の理論<\/h1>/);
  assert.deepEqual(page.isPartOf, { '@type': 'WebApplication', name: '邪眼診断', url: `${O}/jagan/` });
  assert.equal(crumbs['@type'], 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((x) => [x.position, x.name, x.item]), [[1, '邪眼診断', `${O}/jagan/`], [2, '邪眼診断の理論', `${O}/jagan/about`]]);
});

test('邪眼のページに、FAQ・評価・レビュー・医療系の型を使わない', () => {
  for (const f of ['jagan/index.html', 'jagan/about.html']) {
    const all = blocks(read(f)).flatMap((b) => types(JSON.parse(b)));
    for (const t of all) assert.doesNotMatch(t, /^(FAQPage|Question|Answer|Review|AggregateRating|Rating)$|^Medical/, `${f}: ${t}`);
  }
});
