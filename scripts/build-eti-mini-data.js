#!/usr/bin/env node
// 元素診断 Mini：ChatGPT 設計の正本 JSON から、公開用の JS を作る。
//   ・固定割当表 → js/eti_mini_auto_map_v1.js
//   ・3問20択の正式文言（Phase B）→ js/eti_mini_choices_v1.js
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
const CHOICES_SRC = 'docs/eti-mini/phase_b_v1/eti_mini_choices_final_v1.json';
const CHOICES_SHA256 = '9174cd9b54eefd831bd4814ecfd2cc664c135e226039965eb458785545ef9c96';
const CHOICES_OUT = 'js/eti_mini_choices_v1.js';

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

// 3問20択（正式版）。内部キー（key）は変えない。表示は label・detail だけ
function renderChoices() {
  const got = sha256(CHOICES_SRC);
  if (got !== CHOICES_SHA256) throw new Error(`${CHOICES_SRC} の sha256 が固定値と違います: ${got}`);
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, CHOICES_SRC), 'utf8'));
  const data = {
    version: src.version,
    sourceSha256: CHOICES_SHA256,
    questions: src.questions.map((q) => ({
      id: q.id, title: q.title, helper: q.helper,
      options: q.options.map((o) => ({ key: o.key, label: o.label, detail: o.detail })),
    })),
  };
  return [
    '// 自動生成：node scripts/build-eti-mini-data.js（手で編集しない）',
    `// 正本：${CHOICES_SRC}（sha256 ${CHOICES_SHA256}）`,
    '// 元素診断 Mini：3問20択の正式文言（ChatGPT 確定）。id = element / weapon / nation、key = 内部キー（画面に出さない）。',
    `var ETI_MINI_CHOICES = Object.freeze(${JSON.stringify(data, null, 1)});`,
    "if (typeof module !== 'undefined' && module.exports) module.exports = ETI_MINI_CHOICES;",
    '',
  ].join('\n');
}

const OUTPUTS = () => [[OUT, render()], [CHOICES_OUT, renderChoices()]];

module.exports = { render, renderChoices, OUT, CHOICES_OUT, MAP_SRC, CAND_SRC, CHOICES_SRC, MAP_SHA256, CAND_SHA256, CHOICES_SHA256 };

if (require.main === module) {
  const check = process.argv.includes('--check');
  let ok = true;
  for (const [rel, text] of OUTPUTS()) {
    const abs = path.join(ROOT, rel);
    if (check) {
      const same = fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === text;
      if (!same) { ok = false; console.log(`eti-mini data: ${rel} が正本と一致しません（node scripts/build-eti-mini-data.js で作り直す）`); }
    } else {
      fs.writeFileSync(abs, text);
      console.log(`wrote ${rel}`);
    }
  }
  if (check) { console.log(ok ? 'eti-mini data: OK' : 'eti-mini data: NG'); process.exit(ok ? 0 : 1); }
}
