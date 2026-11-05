#!/usr/bin/env node
// 元素診断 Mini：ChatGPT 設計の固定割当表（正本 JSON）から、公開用の JS（js/eti_mini_auto_map_v1.js）を作る。
//   実行: node scripts/build-eti-mini-data.js          （生成）
//         node scripts/build-eti-mini-data.js --check  （生成物が正本と一致するかだけ確かめる。テストからも使う）
//
// 方針（docs/eti-mini/handoff_v1/README_Claude_実装指示書.md §2）
//   ・正本 JSON は変更しない。sha256 を固定し、違えば止める（差し替えは版を上げて別ファイルにする）。
//   ・公開側には key → mirror_character だけを出す。internal_rank・internal_regret_pp は監査専用なので含めない。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = 'docs/eti-mini/handoff_v1/data';
const MAP_SRC = `${SRC_DIR}/eti_mini_758_5star_280_mapping.json`;
const CAND_SRC = `${SRC_DIR}/eti_mini_auto_candidates_v1.json`;
const MAP_SHA256 = 'cf67efa6b5d3bbeaff67a2c36e69e45b266685b44df52dad4c8401714b5b4946';
const CAND_SHA256 = '61dc214cfb7b1549dd074e619a087a16b09e66475ad1e55aaf0401f2f179a9fb';
const OUT = 'js/eti_mini_auto_map_v1.js';

function sha256(rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); }

function render() {
  const gotMap = sha256(MAP_SRC), gotCand = sha256(CAND_SRC);
  if (gotMap !== MAP_SHA256) throw new Error(`${MAP_SRC} の sha256 が固定値と違います: ${gotMap}`);
  if (gotCand !== CAND_SHA256) throw new Error(`${CAND_SRC} の sha256 が固定値と違います: ${gotCand}`);
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, MAP_SRC), 'utf8'));
  const cand = JSON.parse(fs.readFileSync(path.join(ROOT, CAND_SRC), 'utf8'));
  const rows = {};
  for (const r of map.rows) {
    if (rows[r.key]) throw new Error(`key が重複しています: ${r.key}`);
    rows[r.key] = r.mirror_character;
  }
  const data = {
    version: map.version,
    status: map.status,
    sourceSha256: MAP_SHA256,
    candidateListSha256: CAND_SHA256,
    candidateCount: cand.candidate_names.length,
    candidates: cand.candidate_names,
    rows,
  };
  return [
    '// 自動生成：node scripts/build-eti-mini-data.js（手で編集しない）',
    `// 正本：${MAP_SRC}（sha256 ${MAP_SHA256}）`,
    `//       ${CAND_SRC}（sha256 ${CAND_SHA256}）`,
    '// 元素診断 Mini：キャラクター未選択時の固定割当（key = 元素|武器|国家の内部キー → キャラクター名）。',
    '// 監査専用の値（internal_rank・internal_regret_pp）は含めない。',
    `var ETI_MINI_AUTO_MAP_V1 = Object.freeze(${JSON.stringify(data, null, 1)});`,
    "if (typeof module !== 'undefined' && module.exports) module.exports = ETI_MINI_AUTO_MAP_V1;",
    '',
  ].join('\n');
}

module.exports = { render, OUT, MAP_SRC, CAND_SRC, MAP_SHA256, CAND_SHA256 };

if (require.main === module) {
  const text = render();
  const outAbs = path.join(ROOT, OUT);
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(outAbs) && fs.readFileSync(outAbs, 'utf8') === text;
    console.log(same ? 'eti-mini data: OK' : `eti-mini data: ${OUT} が正本と一致しません（node scripts/build-eti-mini-data.js で作り直す）`);
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(outAbs, text);
  console.log(`wrote ${OUT}`);
}
