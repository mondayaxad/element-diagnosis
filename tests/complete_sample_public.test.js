// 完全解析サンプル（complete-sample.html）と TOP の OGP 画像のテスト。
//   ・承認済みの8ページ版を公開する。どこからもリンクしない（X の返信で直接共有する）・noindex,nofollow,noarchive。
//   ・script・form・iframe・外部への読み込みを含まない。CTA は /mypage だけ（Stripe へ直接送らない）。
//   ・OGP は TOP とサンプルだけが新しい 1200×630 の画像を使う（絶対 URL・summary_large_image）。
//   実行: node --test tests/complete_sample_public.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SAMPLE = read('complete-sample.html');
const OGP_PATH = 'assets/ogp/ogp-top-20261009.jpg';
const OGP_URL = `https://element-diagnosis-five.vercel.app/${OGP_PATH}`;

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'JPEG ではありません');
  let i = 2;
  while (i < buf.length) {
    const marker = buf.readUInt16BE(i);
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xffc0 && marker <= 0xffc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('SOF が見つかりません');
}

test('サンプル：8ページ・noindex,nofollow,noarchive・script／form／iframe なし', () => {
  assert.equal((SAMPLE.match(/<section class="page/g) || []).length, 8);
  assert.match(SAMPLE, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  assert.doesNotMatch(SAMPLE, /<script|<form|<iframe|<object|<embed|<link\b|\son[a-z]+\s*=/i);
  assert.match(SAMPLE, /script-src 'none'/);
  // 外部への読み込み（src・url()）が無い。http(s) は OGP の meta だけ
  assert.doesNotMatch(SAMPLE, /\ssrc\s*=\s*["']?https?:/i);
  assert.doesNotMatch(SAMPLE, /url\(\s*["']?https?:/i);
  const external = [...SAMPLE.matchAll(/https?:\/\/[^"'\s<>)]+/g)].map((m) => m[0]);
  for (const u of external) assert.ok(u.startsWith('https://element-diagnosis-five.vercel.app/'), u);
  const metaUrls = [...SAMPLE.matchAll(/<meta [^>]*content="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.equal(external.length, metaUrls.length, 'OGP の meta 以外に外部 URL があります');
});

test('サンプル：CTA は /mypage?from=sample だけ（Stripe へ直接送らない）・作成の案内がある', () => {
  const hrefs = [...SAMPLE.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('#'));
  assert.deepEqual(hrefs, ['/mypage?from=sample']);
  assert.doesNotMatch(SAMPLE, /stripe|checkout/i);
  assert.match(SAMPLE, /マイページをお持ちでない方も、ここから無料で作成できます。/);
});

test('サンプル：OGP は新しい画像の絶対 URL・summary_large_image', () => {
  assert.match(SAMPLE, new RegExp(`<meta property="og:image" content="${OGP_URL.replace(/[.]/g, '\\.')}">`));
  assert.match(SAMPLE, new RegExp(`<meta name="twitter:image" content="${OGP_URL.replace(/[.]/g, '\\.')}">`));
  assert.match(SAMPLE, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(SAMPLE, /<meta property="og:url" content="https:\/\/element-diagnosis-five\.vercel\.app\/complete-sample">/);
});

test('サンプルはどこからもリンクしない（TOP・マイページ・ナビ・sitemap）', () => {
  for (const p of ['index.html', 'mypage.html', 'report.html', 'privacy.html', 'terms.html', 'sitemap.xml', 'robots.txt', 'complete-analysis.js']) {
    assert.doesNotMatch(read(p), /complete-sample/, `${p} がサンプルを参照しています`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'type'))) {
    assert.doesNotMatch(read(`type/${f}`), /complete-sample/);
  }
});

test('TOP の OGP：1200×630 の JPEG・新しいファイル名・絶対 URL', () => {
  const size = jpegSize(fs.readFileSync(path.join(ROOT, OGP_PATH)));
  assert.deepEqual(size, { width: 1200, height: 630 });
  const index = read('index.html');
  assert.ok(index.includes(`<meta property="og:image" content="${OGP_URL}">`));
  assert.ok(index.includes(`<meta name="twitter:image" content="${OGP_URL}">`));
  assert.match(index, /<meta property="og:image:width" content="1200">/);
  assert.match(index, /<meta property="og:image:height" content="630">/);
  assert.match(index, /<meta name="twitter:card" content="summary_large_image">/);
});

test('新しい OGP は TOP とサンプルだけ（type・privacy・terms・report は変えない）', () => {
  for (const p of ['mypage.html', 'report.html', 'report_sample.html', 'privacy.html', 'terms.html']) {
    assert.doesNotMatch(read(p), /ogp-top-20261009/, p);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'type'))) assert.doesNotMatch(read(`type/${f}`), /ogp-top-20261009/);
  // Xシェアの経路（/api/share → /api/og-image）は変えない
  assert.match(read('api/share.js'), /og-image/);
});
