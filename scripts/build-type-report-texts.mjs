// タイプ別レポート（report.html をタイプ別レポートとして開いた時）で使う文を、結果ページ（index.html）の最新の文から書き出す。
//   ・ELEMENT_DESC・WEAPON_DESC は結果ページ・タイプ解説と同じ最新の文（既存の解析レポートの文は変えない）
//   ・TYPE_NAME（35タイプの名前）
//   出力：js/type-report-texts.js（手で編集しない）
//   実行: node scripts/build-type-report-texts.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function indexConst(name) {
  const i = INDEX.indexOf(`const ${name} = `);
  if (i < 0) throw new Error(`index.html に ${name} がありません`);
  const j = INDEX.indexOf('{', i); let depth = 0; let k = j;
  for (; k < INDEX.length; k++) { if (INDEX[k] === '{') depth++; else if (INDEX[k] === '}' && --depth === 0) break; }
  return vm.runInNewContext(`(${INDEX.slice(j, k + 1)})`);
}
export function renderTexts() {
  const data = { ELEMENT_DESC: indexConst('ELEMENT_DESC'), WEAPON_DESC: indexConst('WEAPON_DESC'), TYPE_NAME: indexConst('TYPE_NAME') };
  return `// js/type-report-texts.js（scripts/build-type-report-texts.mjs で生成。手で編集しない）
// タイプ別レポートで使う最新の解説文とタイプ名。結果ページ（index.html）と同じ文。既存の解析レポートには使わない。
window.ED_TYPE_REPORT_TEXTS = Object.freeze(${JSON.stringify(data, null, 1)});
`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.writeFileSync(path.join(ROOT, 'js/type-report-texts.js'), renderTexts());
  console.log('wrote js/type-report-texts.js');
}
