// SEO の回帰テストの共通部品（*.test.js ではないので、単独では実行されない）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

// vercel.json の source（path-to-regexp の一部：:name・:name(正規表現)・(...)・{...}? の省略可能な部分）を正規表現にする
function sourceToRegExp(src) {
  let re = '';
  for (let i = 0; i < src.length;) {
    const rest = src.slice(i);
    let m;
    if ((m = /^\{([^}]*)\}\?/.exec(rest))) { re += `(?:${sourceToRegExp(m[1]).source.slice(1, -1)})?`; i += m[0].length; continue; }
    if ((m = /^:([A-Za-z_]\w*)\(([^)]*\)?[^)]*)\)/.exec(rest))) { re += `(${m[2]})`; i += m[0].length; continue; }
    if ((m = /^:([A-Za-z_]\w*)/.exec(rest))) { re += '([^/]+)'; i += m[0].length; continue; }
    if ((m = /^\(([^)]*)\)/.exec(rest))) { re += `(${m[1]})`; i += m[0].length; continue; }
    re += src[i].replace(/[.*+?^${}|[\]\\/]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${re}$`);
}
// その URL のパスに付く X-Robots-Tag（当たる全ルール。Vercel は当たったルールのヘッダーを全部付け、外すことはできない）
function robotsHeaders(urlPath, vercel = VERCEL) {
  return (vercel.headers || [])
    .filter((h) => sourceToRegExp(h.source).test(urlPath))
    .flatMap((h) => h.headers.filter((x) => x.key.toLowerCase() === 'x-robots-tag').map((x) => x.value));
}
const metaRobots = (html) => (/<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html) || [])[1] || '';
const canonical = (html) => (/<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(html) || [])[1] || '';
const sitemapLocs = () => [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
// Vercel（cleanUrls・trailingSlash 未設定）で同じページを返す表記：/a・/a/（.html 付きは 308 で /a へ転送される）
const variants = (p) => (p === '/' ? ['/'] : p.endsWith('/') ? [p, p.slice(0, -1)] : [p, `${p}/`]);

module.exports = { ROOT, VERCEL, sourceToRegExp, robotsHeaders, metaRobots, canonical, sitemapLocs, variants };
