#!/usr/bin/env node
// 邪眼診断：仕様パッケージから、ブラウザとサーバーが共通で読む jagan/engine/data.mjs を作る。
//   設問・特性・邪眼元素・人物の参照と固定補正：docs/jagan/spec_v0_3_balanced/（items.json・core-model.json・characters.json）
//   商品（1,000円・買い切り・販売は閉じたまま）：docs/jagan/spec_v1_0_rc1/data/product.json
//   DTI の名称・コード：docs/jagan/dti_handoff_20261104/dti-types.json
//   data.mjs は生成物（手で直さない）。
//   実行: node scripts/jagan-data.mjs           （作り直す）
//         node scripts/jagan-data.mjs --check   （正本と一致しているかだけ確かめる。不一致なら終了コード 1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, 'docs/jagan/spec_v0_3_balanced');
const OUT = path.join(ROOT, 'jagan/engine/data.mjs');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function render() {
  const bundle = {
    items: read(path.join(SPEC, 'items.json')),
    core: read(path.join(SPEC, 'core-model.json')),
    characters: read(path.join(SPEC, 'characters.json')),
    product: read(path.join(ROOT, 'docs/jagan/spec_v1_0_rc1/data/product.json')),
    // DTI（邪眼タイプ指標）の名称・コード：84通り（元素2文字＋異相2文字・漢字三文字の呼び名）。全画面でこれだけを参照する
    dti: read(path.join(ROOT, 'docs/jagan/dti_handoff_20261104/dti-types.json')),
  };
  return '// 生成物：scripts/jagan-data.mjs が docs/jagan/spec_v0_3_balanced/*.json から作る。手で編集しない。\n' +
    `export const BUNDLE = Object.freeze(${JSON.stringify(bundle, null, 1)});\n`;
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
