#!/usr/bin/env node
// 完全解析（COMPLETE-RC1）の生成素材の版と内容ハッシュを lib/complete-materials.json に書き出す。
//   実行: node scripts/complete-materials.js          （照合だけ。書き換えない。違えば終了コード 1）
//         node scripts/complete-materials.js --check  （同上）
//         node scripts/complete-materials.js --write  （明示した時だけ書き換える。旧値・新値・対象ファイルを表示する）
//   テストから --write を呼ばない。golden hash（tests/complete_report_generator.test.js）は自動では書き換えない。
//
// 方針
//   ・Webhook（支払い確定）は、ここで固定したハッシュを complete_apply_payment へ渡し、complete_reports に凍結する。
//     素材の読み込みを関数の実行時に行わない（Vercel の関数に prototypes/ の素材を同梱しない）。
//   ・対象はサーバー生成器（api/_complete/）。prototypes/core1_v4_result_driven は査読用の原本として残し、ここでは使わない。
//     本文素材（content_sha256）：api/_complete/rc1/src/content/*.json
//     生成器（template_sha256）：テンプレート（rc1/src/templates/*）・画像（rc1/assets/）・文章を組み立てるコード
//       （rc1/src/*.js・rc1/src/models/*.js）・正本エンジンの同梱物（rc1/vendor/）・入口（api/_complete/generate-report.js）
//     どちらも「api/_complete/ からの相対パス・改行・ファイルの SHA-256・改行」を相対パスの順に並べた文字列の SHA-256。
//   ・素材を変えたら、差分をレビューしてから --write で書き換える（tests/complete_payment_api.test.js・tests/complete_report_generator.test.js が一致を確かめる）。
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GENERATOR_ROOT = 'api/_complete';
const BASE = `${GENERATOR_ROOT}/rc1`;
const OUT = 'lib/complete-materials.json';
const CONTENT_VERSION = 'CORE1-CONTENT-1.0.1';
const TEMPLATE_VERSION = 'CORE1-TEMPLATE-46P-WEB-1.0.1';

function walk(root, rel) {
  const abs = path.join(root, rel);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => {
    const r = `${rel}/${d.name}`;
    return d.isDirectory() ? walk(root, r) : [r];
  });
}

function digestOf(root, files) {
  const h = crypto.createHash('sha256');
  for (const f of [...files].sort()) {
    // 相対パスは api/_complete/ から（置き場所を変えても内容が同じなら同じハッシュ）
    h.update(`${path.posix.relative(GENERATOR_ROOT, f)}\n${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')}\n`);
  }
  return h.digest('hex');
}

// 区分：content＝査読済みの本文・辞書・MENTOR カタログ（rc1/src/content/*.json）
//       template＝テンプレート・CSS・画像・文章を組み立てるコード・正本エンジン・入口
function materialFiles(root = ROOT) {
  const content = walk(root, `${BASE}/src/content`).filter((f) => f.endsWith('.json')).sort();
  const code = [...walk(root, `${BASE}/src`).filter((f) => f.endsWith('.js')), `${GENERATOR_ROOT}/generate-report.js`];
  const template = [...walk(root, `${BASE}/src/templates`).filter((f) => !f.endsWith('.js')), ...walk(root, `${BASE}/assets`),
    ...walk(root, `${BASE}/vendor`), ...code].sort();
  return { content, template };
}

function computeMaterials(root = ROOT) {
  const { content, template } = materialFiles(root);
  const source = fs.readFileSync(path.join(root, `${BASE}/src/calculate-result.js`), 'utf8');
  if (!source.includes(`'${CONTENT_VERSION}'`) || !source.includes(`'${TEMPLATE_VERSION}'`)) {
    throw new Error('material versions do not match calculate-result.js');
  }
  return {
    generatorRelease: 'COMPLETE-RC1',
    contentVersion: CONTENT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    contentSha256: digestOf(root, content),
    templateSha256: digestOf(root, template),
    contentFiles: content.length,
    templateFiles: template.length,
  };
}

// 照合だけ（書き換えない）。{ ok, have, want, problems }
function checkMaterials(root = ROOT) {
  const outPath = path.join(root, OUT);
  const want = computeMaterials(root);
  let have = null;
  try { have = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { have = null; }
  const problems = [];
  if (!have) problems.push(`${OUT} が無い・読めない`);
  else for (const k of Object.keys(want)) if (have[k] !== want[k]) problems.push(`${k}: ${have[k]} → ${want[k]}`);
  return { ok: problems.length === 0, have, want, problems };
}

// 明示的な --write の時だけ書き換える。旧値・新値・対象ファイルの一覧を表示する（golden hash は書き換えない）。
function writeMaterials(root = ROOT, log = console.log) {
  const r = checkMaterials(root);
  const files = materialFiles(root);
  log(`対象ファイル（content ${files.content.length}件）:`);
  files.content.forEach((f) => log(`  ${f}`));
  log(`対象ファイル（template ${files.template.length}件）:`);
  files.template.forEach((f) => log(`  ${f}`));
  for (const k of Object.keys(r.want)) log(`${k}: ${r.have ? r.have[k] : '(なし)'} → ${r.want[k]}${r.have && r.have[k] === r.want[k] ? '（同じ）' : ''}`);
  fs.writeFileSync(path.join(root, OUT), `${JSON.stringify(r.want, null, 2)}\n`);
  log(`wrote ${OUT}（tests/complete_report_generator.test.js の GOLDEN_SHA256 は自動では変えない。出力が変わったら差分をレビューして手で更新する）`);
  return r;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--write', '--check'].includes(a));
  if (unknown.length || (args.includes('--write') && args.includes('--check'))) {
    console.error('使い方: node scripts/complete-materials.js [--check | --write]');
    process.exit(2);
  }
  if (args.includes('--write')) {
    writeMaterials();
  } else {
    const r = checkMaterials();
    if (!r.ok) {
      console.error(`${OUT} が素材と一致しません（書き換えていません）:`);
      r.problems.forEach((x) => console.error(`  ${x}`));
      console.error('素材の変更をレビューした上で、明示的に node scripts/complete-materials.js --write を実行してください。');
      process.exit(1);
    }
    console.log(`${OUT} は素材と一致しています`);
  }
}

module.exports = { computeMaterials, materialFiles, checkMaterials, writeMaterials, OUT };
