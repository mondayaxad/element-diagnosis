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

test('サンプル：8ページ・noindex,nofollow,noarchive・同じサイトの script だけ（戻る・販売中の設定・共通の申込・申込欄）・form／iframe なし', () => {
  assert.equal((SAMPLE.match(/<section class="page/g) || []).length, 8);
  assert.match(SAMPLE, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  let rest = SAMPLE;
  for (const src of ['/js/sample-return.js', '/api/public-config?format=js', '/js/report-purchase.js', '/js/sample-buy.js']) rest = rest.replace(`<script src="${src}"></script>`, '');
  assert.doesNotMatch(rest, /<script|<form|<iframe|<object|<embed|<link\b|\son[a-z]+\s*=/i);
  assert.match(SAMPLE, /script-src 'self'/);
  // 外部への読み込み（src・url()）が無い。http(s) は OGP の meta だけ
  assert.doesNotMatch(SAMPLE, /\ssrc\s*=\s*["']?https?:/i);
  assert.doesNotMatch(SAMPLE, /url\(\s*["']?https?:/i);
  const external = [...SAMPLE.matchAll(/https?:\/\/[^"'\s<>)]+/g)].map((m) => m[0]);
  for (const u of external) assert.ok(u.startsWith('https://element-diagnosis-five.vercel.app/'), u);
  const metaUrls = [...SAMPLE.matchAll(/<meta [^>]*content="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.equal(external.length, metaUrls.length, 'OGP の meta 以外に外部 URL があります');
});


test('サンプル（complete_13）：上部は「元の画面に戻る」、末尾は申込欄（購入対象トークンがある時だけ申込・直接開いた時は「まず元素診断を受ける」）。Stripe へ直接は送らない', () => {
  const hrefs = [...SAMPLE.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('#'));
  assert.deepEqual(hrefs, ['/', '/']);
  assert.equal((SAMPLE.match(/data-sample-return/g) || []).length, 1);
  assert.equal((SAMPLE.match(/data-sample-buy/g) || []).length, 1);
  assert.doesNotMatch(SAMPLE, /stripe|checkout/i);
  // 通信は同じサイトだけ（申込欄の API）
  assert.match(SAMPLE, /script-src 'self'; connect-src 'self'/);
  assert.deepEqual([...SAMPLE.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]), ['/js/sample-return.js', '/api/public-config?format=js', '/js/report-purchase.js', '/js/sample-buy.js']);
  assert.doesNotMatch(read('js/sample-return.js'), /fetch|XMLHttpRequest|sendBeacon|gtag/);
  // 申込欄：直接開いた時は申し込まない（購入対象トークンが無い）
  const buy = read('js/sample-buy.js');
  assert.match(buy, /まず元素診断を受ける/);
  assert.match(buy, /var hasContext = B\.contextOk\(context\);/);
  assert.match(buy, /if \(!hasContext\) \{/);
});


test('サンプル：OGP は新しい画像の絶対 URL・summary_large_image', () => {
  assert.match(SAMPLE, new RegExp(`<meta property="og:image" content="${OGP_URL.replace(/[.]/g, '\\.')}">`));
  assert.match(SAMPLE, new RegExp(`<meta name="twitter:image" content="${OGP_URL.replace(/[.]/g, '\\.')}">`));
  assert.match(SAMPLE, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(SAMPLE, /<meta property="og:url" content="https:\/\/element-diagnosis-five\.vercel\.app\/complete-sample">/);
});

test('サンプルへのリンクは、診断結果の欄・解析レポートの最下部・共通の申込（EdBuy.sampleHref）だけ（ナビ・sitemap・タイプページからはリンクしない）', () => {
  for (const p of ['mypage.html', 'privacy.html', 'terms.html', 'sitemap.xml', 'robots.txt', 'complete-analysis.js']) {
    assert.doesNotMatch(read(p), /complete-sample/, `${p} がサンプルを参照しています`);
  }
  const index = read('index.html');
  assert.equal((index.match(/complete-sample/g) || []).length, 1, 'index は完全解析の欄の1か所だけ');
  assert.match(index, /href="\/complete-sample\.html#from=result" data-ca-sample data-buy-sample="complete"/);
  const report = read('report.html');
  assert.equal((report.match(/complete-sample/g) || []).length, 1, 'report は以前の仕組みの閲覧の最下部の1か所だけ（固有リンクの最下部は EdBuy.sampleHref）');
  assert.match(read('js/report-purchase.js'), /'\/complete-sample\.html'/);
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
