#!/usr/bin/env node
// 邪眼診断：仕様パッケージ（docs/jagan/spec_v1_0_rc1/data/*.json）から、ブラウザとサーバーが共通で読む
// jagan/engine/data.mjs を作る。data/ の JSON が正本で、data.mjs は生成物（手で直さない）。
//   実行: node scripts/jagan-data.mjs           （作り直す）
//         node scripts/jagan-data.mjs --check   （正本と一致しているかだけ確かめる。不一致なら終了コード 1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'docs/jagan/spec_v1_0_rc1/data');
const OUT = path.join(ROOT, 'jagan/engine/data.mjs');
const read = (n) => JSON.parse(fs.readFileSync(path.join(SPEC, n), 'utf8'));

export function render() {
  const bundle = {
    items: read('items.json'),
    interpretation: read('interpretation.json'),
    characters: read('characters.json'),
    product: read('product.json'),
  };
  const copy = {
    character: read('character.copy.json'),
    result: read('result.copy.json'),
    report: read('report.copy.json'),
    method: read('method.copy.json'),
  };
  return '// 生成物：scripts/jagan-data.mjs が docs/jagan/spec_v1_0_rc1/data/*.json から作る。手で編集しない。\n' +
    `export const BUNDLE = Object.freeze(${JSON.stringify(bundle, null, 1)});\n` +
    `export const COPY = Object.freeze(${JSON.stringify(copy, null, 1)});\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = render();
  if (process.argv.includes('--check')) {
    const ok = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
    console.log(ok ? 'jagan-data: OK' : 'jagan-data: jagan/engine/data.mjs is stale');
    process.exit(ok ? 0 : 1);
  }
  fs.writeFileSync(OUT, text);
  console.log(`jagan-data: wrote ${path.relative(ROOT, OUT)} (${text.length} bytes)`);
}
