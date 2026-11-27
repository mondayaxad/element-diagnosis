// α が既存 ETI・DTI と本番配信から隔離されていること、外部への通信先を持たないことを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ALPHA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ALPHA, '../..');
const BASE_COMMIT = 'a68df0877f6613bc5fe929c444f705b2dde77d3c';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'screenshots'].includes(e.name) ? [] : walk(p);
    return [p];
  });
}
const RUNTIME = walk(ALPHA).filter((f) => /\.(js|html|css|svg)$/.test(f) && !f.includes(`${path.sep}tests${path.sep}`) && !f.includes(`${path.sep}scripts${path.sep}`));

test('画面で読み込むファイルに外部 URL・通信 API・分析 SDK が無い', () => {
  for (const f of RUNTIME) {
    const rel = path.relative(ALPHA, f);
    // SVG の名前空間の宣言（通信しない識別子）だけは許す
    const src = fs.readFileSync(f, 'utf8').replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
    if (f.endsWith('.svg')) assert.doesNotMatch(src, /<script|href=|<foreignObject|<image/i, `${rel} に外部参照・スクリプトがあります`);
    assert.doesNotMatch(src, /https?:\/\//, `${rel} に外部 URL があります`);
    assert.doesNotMatch(src, /\/\/[a-z0-9-]+\.[a-z]{2,}/i, `${rel} にプロトコル省略の外部 URL があります`);
    assert.doesNotMatch(src, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts)\s*\(/, `${rel} に通信 API の呼び出しがあります`);
    assert.doesNotMatch(src, /gtag|dataLayer|googletagmanager|supabase|stripe|sentry|posthog|mixpanel|openai|anthropic/i, `${rel} に外部サービスの参照があります`);
    assert.doesNotMatch(src, /@import|url\((?!#)/, `${rel} に外部リソースを読み込む CSS があります`); // url(#id) は文書内の参照
  }
});

test('index.html の CSP が外部通信を禁止している', () => {
  const html = fs.readFileSync(path.join(ALPHA, 'index.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  for (const d of ["default-src 'none'", "connect-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data:", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.match(html, /noindex, nofollow/);
});

test('本番ビルド（scripts/build-public.js）の dist に α が含まれない', () => {
  const require = createRequire(import.meta.url);
  const B = require(path.join(REPO, 'scripts/build-public.js'));
  const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'isa-dist-')), 'dist');
  try {
    const r = B.build({ outDir });
    assert.deepEqual(r.problems, []);
    assert.ok(!fs.existsSync(path.join(outDir, 'alpha')), 'dist に alpha/ があります');
    const files = B.walk(outDir);
    assert.ok(!files.some((f) => /ideal-self|isa-alpha/i.test(f)));
  } finally { fs.rmSync(path.dirname(outDir), { recursive: true, force: true }); }
});

test('基準コミットからの差分は alpha/ideal-self の中だけ（既存 ETI・DTI・ビルド・設定に変更なし）', (t) => {
  let out;
  try {
    execFileSync('git', ['cat-file', '-e', BASE_COMMIT], { cwd: REPO });
    out = execFileSync('git', ['diff', '--name-only', BASE_COMMIT, '--'], { cwd: REPO, encoding: 'utf8' })
      + execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
  } catch { t.skip('基準コミットが無い環境'); return; }
  const changed = out.split('\n').filter(Boolean);
  const outside = changed.filter((f) => !f.startsWith('alpha/ideal-self/'));
  assert.deepEqual(outside, [], `α の外に変更があります: ${outside.join(', ')}`);
});
