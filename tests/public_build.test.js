// scripts/build-public.js のテスト。公開してよいファイルだけを dist/ に出すこと、
// 参照の欠損・公開禁止ファイルの混入・API の import の破損を検出できることを確かめる。
//   実行: node --test tests/public_build.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../scripts/build-public.js');

const ROOT = path.join(__dirname, '..');

const TMP = [];
function tmpDir(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }
test.after(() => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });
function buildTo(opts = {}) {
  const outDir = path.join(tmpDir('ed-dist-'), 'dist');
  const r = B.build({ outDir, ...opts });
  return { ...r, outDir, has: (p) => fs.existsSync(path.join(outDir, p)) };
}
const hasProblem = (r, re) => r.problems.some((p) => re.test(p));

test('許可リストどおりに dist を作り、問題が無い', () => {
  const r = buildTo();
  assert.deepEqual(r.problems, []);
  for (const f of ['index.html', 'mypage.html', 'report.html', 'report_sample.html', 'privacy.html', 'terms.html',
                   'complete-analysis.js', 'diagnosis-save.js', 'ogp.jpeg', 'robots.txt', 'sitemap.xml',
                   'js/eti_v2_engine.js', 'js/registration-onboarding.js', 'assets/backgrounds/quiet-starry-lake.jpg',
                   'assets/result/seven-nations-compass.webp', 'assets/ogp/backgrounds/pyro.jpg',
                   'assets/emblems/2026-autumn/record/pyro.png', 'assets/emblems/2026-autumn/awakened/pyro.png']) {
    assert.ok(r.has(f), `dist にありません: ${f}`);
  }
  assert.equal(B.walk(path.join(r.outDir, 'type')).length, 35);
  // 公開ページが読み込む JS はすべて dist にある（index・mypage・report の <script src>）
  for (const page of ['index.html', 'mypage.html', 'report.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"$]+)"/g)) {
      if (/^(https?:)?\/\//.test(m[1]) || m[1].startsWith('/api/')) continue;
      assert.ok(r.has(m[1].replace(/^\//, '').replace(/\?.*$/, '')), `${page} の ${m[1]} が dist にありません`);
    }
  }
});

test('公開禁止のものは dist に無い（docs・tests・prototypes・lib・scripts・api・SQL・設定・テスト用ページ）', () => {
  const r = buildTo();
  for (const d of ['docs', 'tests', 'prototypes', 'lib', 'scripts', 'api', 'node_modules']) assert.ok(!r.has(d), `${d}/ が dist にあります`);
  for (const f of ['api/public-config.js', 'lib/server-env.js', 'package.json', 'vercel.json', '.gitignore', 'index-test.html',
                   'js/ogp-card.mjs', 'js/ogp-theme.mjs', 'js/ogp-fixtures.mjs']) {
    assert.ok(!r.has(f), `${f} が dist にあります`);
  }
  assert.deepEqual(r.files.filter((f) => /\.(sql|md)$/i.test(f) || /DRAFT|DO_NOT_RUN/.test(f)), []);
  assert.deepEqual(B.forbiddenIn(r.files), []);
});

test('許可リストはディレクトリを丸ごと・再帰でコピーしない', () => {
  for (const f of B.PUBLIC_FILES) {
    assert.ok(!/[*?]/.test(f), `ワイルドカード: ${f}`);
    assert.deepEqual(B.forbiddenIn([f]), [], `公開禁止に当たる: ${f}`);
  }
  for (const { dir, ext } of B.PUBLIC_DIRS) {
    assert.ok(dir && dir !== '.' && !dir.includes('*'), `ディレクトリ指定が広すぎます: ${dir}`);
    assert.match(ext, /^\.[a-z0-9]+$/);
    assert.deepEqual(B.forbiddenIn([`${dir}/x${ext}`]), [], `公開禁止に当たる: ${dir}`);
  }
});

test('API の import は解決でき、lib/server-env.js などサーバー専用ファイルは dist に出ない', () => {
  const api = B.traceApiImports();
  assert.deepEqual(api.problems, []);
  for (const f of ['api/public-config.js', 'api/verify.js', 'api/og-image.mjs', 'lib/server-env.js', 'js/ogp-card.mjs', 'js/ogp-theme.mjs']) {
    assert.ok(api.files.includes(f), `API からたどれません: ${f}`);
  }
  assert.deepEqual(api.packages, ['@vercel/og', 'stripe']);
  const r = buildTo();
  assert.deepEqual(B.apiFilesExposed(r.outDir, api.files), []);
});

test('vercel.json：build で dist を作り、dist だけを配信する（cleanUrls は維持）', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(v.buildCommand, 'node scripts/build-public.js');
  assert.equal(v.outputDirectory, 'dist');
  assert.equal(v.cleanUrls, true);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^dist\/$/m);
});

test('本番ドメインの絶対 URL で実体が無いのは既知の thumbs だけ', () => {
  const r = buildTo();
  assert.ok(r.absoluteMissing.every((p) => /^thumbs\/x_card_[A-Z]{4}\.png$/.test(p)), r.absoluteMissing.join(','));
});

// ---- 意図的に壊したときに検出できること ----
test('検出：必要な JS をコピーし忘れる', () => {
  const r = buildTo({ files: B.PUBLIC_FILES.filter((f) => f !== 'js/eti_v2_engine.js') });
  assert.ok(hasProblem(r, /参照先が dist にありません: (index|mypage|report)\.html → js\/eti_v2_engine\.js/), r.problems.join('\n'));
});

test('検出：画像ディレクトリを外して画像が欠ける', () => {
  const r = buildTo({ dirs: B.PUBLIC_DIRS.filter((d) => d.dir !== 'assets/emblems/2026-autumn/record') });
  assert.ok(hasProblem(r, /mypage\.html → assets\/emblems\/2026-autumn\/record\/pyro\.png/), r.problems.join('\n'));
});

test('検出：docs を誤って dist へコピーする', () => {
  const r = buildTo({ files: [...B.PUBLIC_FILES, 'docs/complete_analysis/FOUNDATION_DESIGN_DRAFT.md'] });
  assert.ok(hasProblem(r, /公開禁止のファイルがあります.*docs\/complete_analysis\/FOUNDATION_DESIGN_DRAFT\.md/), r.problems.join('\n'));
  const r2 = buildTo({ dirs: [...B.PUBLIC_DIRS, { dir: 'docs/sql', ext: '.sql' }] });
  assert.ok(hasProblem(r2, /公開禁止のファイルがあります.*docs\/sql\/.*\.sql/), r2.problems.join('\n'));
});

test('検出：lib/server-env.js を静的公開する', () => {
  const r = buildTo({ files: [...B.PUBLIC_FILES, 'lib/server-env.js'] });
  assert.ok(hasProblem(r, /公開禁止のファイルがあります.*lib\/server-env\.js/), r.problems.join('\n'));
  assert.ok(hasProblem(r, /API 専用のファイルが dist にあります: lib\/server-env\.js/), r.problems.join('\n'));
});

test('検出：API の import が解決できない・未宣言のパッケージ', () => {
  const root = tmpDir('ed-api-');
  fs.mkdirSync(path.join(root, 'api'));
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { stripe: '*' } }));
  fs.writeFileSync(path.join(root, 'lib', 'server-env.js'), "module.exports = {};\n");
  fs.writeFileSync(path.join(root, 'api', 'ok.js'), "const crypto = require('crypto');\nconst e = require('../lib/server-env');\nrequire('stripe');\n");
  fs.writeFileSync(path.join(root, 'api', 'broken.js'), "const { x } = require('../lib/server-env-renamed');\n");
  fs.writeFileSync(path.join(root, 'api', 'img.mjs'), "import { ImageResponse } from '@vercel/og';\nimport { a } from '../js/missing.mjs';\n");
  const api = B.traceApiImports(root);
  assert.ok(api.files.includes('lib/server-env.js'));
  assert.ok(api.problems.some((p) => /api\/broken\.js → \.\.\/lib\/server-env-renamed/.test(p)), api.problems.join('\n'));
  assert.ok(api.problems.some((p) => /api\/img\.mjs → \.\.\/js\/missing\.mjs/.test(p)), api.problems.join('\n'));
  assert.ok(api.problems.some((p) => /package\.json に無いパッケージ.*@vercel\/og/.test(p)), api.problems.join('\n'));
  assert.ok(!api.problems.some((p) => /api\/ok\.js/.test(p)));
});

test('検出：許可リストのファイルが無い', () => {
  const r = buildTo({ files: [...B.PUBLIC_FILES, 'js/does-not-exist.js'] });
  assert.ok(hasProblem(r, /許可リストのファイルがありません: js\/does-not-exist\.js/), r.problems.join('\n'));
});
