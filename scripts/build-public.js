#!/usr/bin/env node
// 公開してよいファイルだけを dist/ へコピーする（Vercel の outputDirectory）。
//   実行: node scripts/build-public.js            （dist/ を作り直して検証。問題があれば終了コード 1）
//         node scripts/build-public.js --check    （dist/ を作らずに API の import だけ確かめる）
//
// 方針
//   ・リポジトリ直下を丸ごと配信しない。下の PUBLIC_FILES・PUBLIC_DIRS に書いたものだけをコピーする。
//     ディレクトリ指定は「そのディレクトリ直下・指定の拡張子だけ」（再帰しない）。
//   ・api/ は Vercel Functions として従来どおり別にビルドされる（dist/ にはコピーしない）。
//     lib/ は API の require 先として残すが、静的には公開しない。
//   ・コピー後に dist/ を検証する：許可リストのファイルがそろっているか、公開禁止のものが混ざっていないか、
//     HTML・JS が参照するローカルパスが dist/ に存在するか、API の import が解決できるか。
//
// 配信しない（リポジトリには残す・削除や内容変更はしない。2026-10-07 決定）
//   gensokouro.html、diagnosis-ui-demo.html、index-demo-v3.html、ogp-card-demo.html、result-save-demo.html、
//   js/ogp-fixtures.mjs、直下の旧 JS 7本（ETI_v2_QUESTIONS_100.js、characters118_v2.js、eti_v2_answer_collection.js、
//   eti_v2_engine.js、eti_v2_prototypes.js、eti_v2_quiz_ui.js、eti_v2_save.js）、index-test.html
//
// Production 移行前の残課題
//   type/*.html（35件）の og:image が /thumbs/x_card_XXXX.png を指すが、リポジトリに thumbs/ が無い（既存の欠損）。
//   画像を用意して許可リストに加えるか、og:image を差し替えるかを Production 移行前に決める。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = 'dist';

// A. 公開必須（明示的な許可リスト）
const PUBLIC_FILES = [
  'index.html',
  'mypage.html',
  'report.html',
  'report_sample.html',
  'privacy.html',
  'terms.html',
  'complete-analysis.js',
  'diagnosis-save.js',
  'ogp.jpeg',
  'complete-sample.html',                                     // 完全解析サンプル（どこからもリンクしない・noindex）
  'assets/ogp/ogp-top-20261009.jpg',                          // TOP・完全解析サンプルの OGP（1200×630）
  'robots.txt',
  'sitemap.xml',
  'js/ETI_v2_QUESTIONS_100.js',
  'js/auth-providers.js',
  'js/characters118_v2.js',
  'js/characters118_v2_1.js',
  'js/diagnosis-record-check.js',
  'js/eti_mirror_selection_v21.js',
  'js/eti_v2_answer_collection.js',
  'js/eti_v2_engine.js',
  'js/eti_v2_legacy_adapter.js',
  'js/eti_v2_mirror_resolver.js',
  'js/eti_v2_prototypes.js',
  'js/eti_v2_save.js',
  'js/registration-onboarding.js',
  'assets/backgrounds/quiet-starry-lake.jpg',
];
// ディレクトリ直下の指定拡張子だけ（再帰しない）
const PUBLIC_DIRS = [
  { dir: 'type', ext: '.html' },                               // タイプ解説（sitemap・index からリンク）
  { dir: 'assets/result', ext: '.webp' },                      // 結果画面の図（index が名前で組み立てる）
  { dir: 'assets/emblems/2026-autumn/record', ext: '.png' },   // マイページの記録エンブレム
  { dir: 'assets/emblems/2026-autumn/awakened', ext: '.png' }, // マイページの覚醒エンブレム
  { dir: 'assets/ogp/backgrounds', ext: '.jpg' },              // api/og-image が自サイトから取得する背景
];

// 公開禁止（dist/ に1つでもあれば失敗）。許可リストの誤りに対する二重の確認。
const FORBIDDEN = [
  { re: /^(docs|tests|prototypes|lib|scripts|api|node_modules|fixtures|\.git|\.vercel|\.github|\.claude)(\/|$)/, why: '開発・資料・サーバー専用のディレクトリ' },
  { re: /(^|\/)fixtures?\//, why: 'テスト fixture' },
  { re: /\.sql$/i, why: 'SQL・migration' },
  { re: /DRAFT|DO_NOT_RUN/, why: '草案ファイル' },
  { re: /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|vercel\.json|\.vercelignore|\.gitignore|\.npmrc|\.nvmrc)$/, why: 'パッケージ・開発設定' },
  { re: /(^|\/)\.env/, why: '環境変数ファイル' },
  { re: /\.(md|markdown|test\.js|test\.mjs)$/i, why: '内部資料・テスト' },
  { re: /(^|\/)(README|LICENSE|CHANGELOG)(\.|$)/i, why: '内部資料' },
  { re: /^index-test\.html$/, why: 'テスト用ページ' },
  { re: /(^|\/)server-env\.js$/, why: 'サーバー専用モジュール' },
];

function listPublicFiles(root = ROOT, files = PUBLIC_FILES, dirs = PUBLIC_DIRS) {
  const out = [];
  const problems = [];
  for (const f of files) {
    if (fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile()) out.push(f);
    else problems.push(`許可リストのファイルがありません: ${f}`);
  }
  for (const { dir, ext } of dirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) { problems.push(`許可リストのディレクトリがありません: ${dir}`); continue; }
    const hits = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(ext) && !d.name.startsWith('.'))
      .map((d) => `${dir}/${d.name}`).sort();
    if (!hits.length) problems.push(`許可リストのディレクトリに ${ext} がありません: ${dir}`);
    out.push(...hits);
  }
  return { files: [...new Set(out)], problems };
}

function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

function forbiddenIn(relPaths) {
  const hits = [];
  for (const p of relPaths) for (const f of FORBIDDEN) if (f.re.test(p)) { hits.push(`公開禁止のファイルがあります（${f.why}）: ${p}`); break; }
  return hits;
}

// ---- 参照の確認 ----
const SITE_ORIGIN = 'https://element-diagnosis-five.vercel.app';
// 既知の欠損（本番ドメインの絶対 URL で、このリポジトリに実体が無いもの。上記「Production 移行前の残課題」）。新しい欠損は失敗にする。
const KNOWN_MISSING_ABSOLUTE = [/^thumbs\/x_card_[A-Z]{4}\.png$/];

function stripQuery(p) { return p.replace(/[?#].*$/, ''); }

// ローカル参照の候補を集める（テンプレート・外部 URL・data: などは除く）
function collectRefs(text, isHtml) {
  const refs = new Set();
  const add = (raw) => {
    if (!raw) return;
    const v = raw.trim();
    if (!v || v.includes('${') || v.includes("' +") || v.includes('" +')) return;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(v)) return;
    refs.add(v);
  };
  if (isHtml) {
    // data-asset（生成物の画像の出どころの記録。読み込みはしない。画像本体は data: で埋め込み済み）は参照として数えない
    text = text.replace(/\sdata-asset\s*=\s*"[^"]*"/gi, '');
    for (const m of text.matchAll(/\s(?:src|href|poster|data-src)\s*=\s*"([^"]*)"/gi)) add(m[1]);
    for (const m of text.matchAll(/\s(?:src|href|poster|data-src)\s*=\s*'([^']*)'/gi)) add(m[1]);
  }
  for (const m of text.matchAll(/(?<![A-Za-z0-9_$.])url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1]); // CSS の url()（JS の関数名 toDataURL( などは除く）
  // JS の文字列リテラルにある公開資産のパス（/assets/…・assets/…・js/…）
  for (const m of text.matchAll(/["'`]((?:\/)?(?:assets|js)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)["'`]/g)) add(m[1]);
  return [...refs];
}

function resolveInDist(distFiles, fromFile, ref) {
  const clean = stripQuery(ref);
  if (!clean || clean.startsWith('/api/') || clean === '/api') return { ok: true, skip: true };
  let rel = clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(fromFile), clean);
  rel = path.posix.normalize(rel).replace(/^\.\//, '');
  if (rel === '' || rel === '.' || rel.endsWith('/')) rel = path.posix.join(rel, 'index.html');
  const has = (p) => distFiles.has(p);
  // cleanUrls：/type/pysw → type/pysw.html
  if (has(rel) || has(`${rel}.html`) || has(path.posix.join(rel, 'index.html'))) return { ok: true, path: rel };
  return { ok: false, path: rel };
}

function checkRefs(outDir) {
  const list = walk(outDir);
  const distFiles = new Set(list);
  const problems = [];
  const absoluteMissing = [];
  for (const f of list) {
    if (!/\.(html|js|mjs|css)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(outDir, f), 'utf8');
    for (const ref of collectRefs(text, f.endsWith('.html'))) {
      const r = resolveInDist(distFiles, f, ref);
      if (!r.ok) problems.push(`参照先が dist にありません: ${f} → ${ref}`);
    }
    // 本番ドメインの絶対 URL（canonical・og:image・タイプへのリンク）も自サイトの資産として確かめる
    for (const m of text.matchAll(new RegExp(`${SITE_ORIGIN.replace(/[.]/g, '\\.')}(/[^"'\\s<>)]*)`, 'g'))) {
      const p = stripQuery(m[1]);
      const r = resolveInDist(distFiles, f, p);
      if (r.ok) continue;
      if (KNOWN_MISSING_ABSOLUTE.some((re) => re.test(r.path))) absoluteMissing.push(r.path);
      else problems.push(`本番ドメインの参照先が dist にありません: ${f} → ${m[0]}`);
    }
  }
  return { problems, absoluteMissing: [...new Set(absoluteMissing)].sort() };
}

// ---- API の import の確認（Vercel Functions のバンドル対象） ----
const NODE_BUILTINS = new Set(require('module').builtinModules);

function apiEntryFiles(root = ROOT) {
  const dir = path.join(root, 'api');
  return fs.readdirSync(dir).filter((n) => /\.(js|mjs|cjs)$/.test(n)).map((n) => `api/${n}`).sort();
}

function specifiersOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bexport\s+[^'";]*?\s+from\s+['"]([^'"]+)['"]/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
  return [...out];
}

function resolveLocal(root, fromRel, spec) {
  const base = path.join(root, path.dirname(fromRel), spec);
  for (const c of [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return path.relative(root, c).split(path.sep).join('/');
  }
  return null;
}

// api/ の各エントリから相対 import をたどる。返り値：たどれたローカルファイル・解決できない import・未宣言のパッケージ
function traceApiImports(root = ROOT, entries = apiEntryFiles(root)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deps = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {})]);
  const seen = new Set();
  const problems = [];
  const packages = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const spec of specifiersOf(text)) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const hit = spec.startsWith('/') ? null : resolveLocal(root, rel, spec);
        if (!hit) { problems.push(`API の import が解決できません: ${rel} → ${spec}`); continue; }
        if (hit.startsWith('..')) { problems.push(`API の import がリポジトリの外を指しています: ${rel} → ${spec}`); continue; }
        queue.push(hit);
      } else {
        const name = spec.replace(/^node:/, '');
        if (spec.startsWith('node:') || NODE_BUILTINS.has(name)) continue;
        const pkgName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
        packages.add(pkgName);
        if (!deps.has(pkgName)) problems.push(`API が package.json に無いパッケージを使っています: ${rel} → ${spec}`);
      }
    }
  }
  return { files: [...seen].sort(), packages: [...packages].sort(), problems };
}

// API のサーバー専用ファイル（api/ 以外の require 先）が dist に無いことを確かめる
function apiFilesExposed(outDir, traced) {
  const dist = new Set(walk(outDir));
  return traced.filter((f) => dist.has(f)).map((f) => `API 専用のファイルが dist にあります: ${f}`);
}

function verifyDist(outDir, { root = ROOT, expected } = {}) {
  const problems = [];
  const present = walk(outDir);
  const presentSet = new Set(present);
  if (expected) for (const f of expected) if (!presentSet.has(f)) problems.push(`dist にありません: ${f}`);
  problems.push(...forbiddenIn(present));
  const refs = checkRefs(outDir);
  problems.push(...refs.problems);
  const api = traceApiImports(root);
  problems.push(...api.problems);
  problems.push(...apiFilesExposed(outDir, api.files));
  return { problems, files: present, absoluteMissing: refs.absoluteMissing, api };
}

function build({ root = ROOT, outDir = path.join(ROOT, OUT_DIR), files = PUBLIC_FILES, dirs = PUBLIC_DIRS } = {}) {
  const { files: list, problems } = listPublicFiles(root, files, dirs);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of list) {
    const dest = path.join(outDir, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, f), dest);
  }
  const v = verifyDist(outDir, { root, expected: list });
  return { ...v, problems: [...problems, ...v.problems], copied: list };
}

module.exports = {
  PUBLIC_FILES, PUBLIC_DIRS, FORBIDDEN, KNOWN_MISSING_ABSOLUTE,
  listPublicFiles, walk, forbiddenIn, collectRefs, checkRefs, traceApiImports, apiFilesExposed, verifyDist, build,
};

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const api = traceApiImports();
    for (const p of api.problems) console.error(`NG ${p}`);
    console.log(`api: ${api.files.length} files traced, packages: ${api.packages.join(', ')}`);
    process.exit(api.problems.length ? 1 : 0);
  }
  const r = build();
  for (const p of r.problems) console.error(`NG ${p}`);
  if (r.absoluteMissing.length) console.warn(`WARN 既知の欠損（本番ドメインの絶対 URL）: ${r.absoluteMissing.length} 件（例: ${r.absoluteMissing[0]}）`);
  console.log(`dist: ${r.copied.length} files / api: ${r.api.files.length} files traced (${r.api.packages.join(', ')})`);
  if (r.problems.length) { console.error(`build-public: ${r.problems.length} problem(s)`); process.exit(1); }
  console.log('build-public: OK');
}
