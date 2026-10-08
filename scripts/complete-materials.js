#!/usr/bin/env node
// 完全解析（COMPLETE-RC1）の生成素材の版と内容ハッシュを lib/complete-materials.json に書き出す。
//   実行: node scripts/complete-materials.js          （書き出す）
//         node scripts/complete-materials.js --check  （書き出さずに一致を確かめる。違えば終了コード 1）
//
// 方針
//   ・Webhook（支払い確定）は、ここで固定したハッシュを complete_apply_payment へ渡し、complete_reports に凍結する。
//     素材の読み込みを関数の実行時に行わない（Vercel の関数に prototypes/ の素材を同梱しない）。
//   ・本文素材（content_sha256）：prototypes/core1_v4_result_driven/src/content/*.json
//     テンプレート（template_sha256）：src/templates/* と assets/ 以下のすべて（CSS・JS・画像）
//     どちらも「相対パス・改行・ファイルの SHA-256・改行」を相対パスの順に並べた文字列の SHA-256。
//   ・素材を変えたらこのスクリプトを実行し直す（tests/complete_payment.test.js が一致を確かめる）。
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = 'prototypes/core1_v4_result_driven';
const OUT = 'lib/complete-materials.json';
const CONTENT_VERSION = 'CORE1-CONTENT-1.0.0';
const TEMPLATE_VERSION = 'CORE1-TEMPLATE-46P-1.0.0';

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
    h.update(`${f}\n${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')}\n`);
  }
  return h.digest('hex');
}

function computeMaterials(root = ROOT) {
  const content = walk(root, `${BASE}/src/content`).filter((f) => f.endsWith('.json'));
  const template = [...walk(root, `${BASE}/src/templates`), ...walk(root, `${BASE}/assets`)];
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

if (require.main === module) {
  const want = `${JSON.stringify(computeMaterials(), null, 2)}\n`;
  const outPath = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    if (have !== want) { console.error(`${OUT} is out of date`); process.exit(1); }
    console.log(`${OUT} is up to date`);
  } else {
    fs.writeFileSync(outPath, want);
    console.log(`wrote ${OUT}`);
  }
}

module.exports = { computeMaterials, OUT };
