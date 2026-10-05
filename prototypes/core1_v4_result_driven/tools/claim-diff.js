// claim-diff.js — 修正前後の claim 差分（docs/claim-diff.md）。使い方: node tools/claim-diff.js <修正前claimsのディレクトリ> F01 F02 F04
'use strict';
const fs = require('fs');
const path = require('path');
const [beforeDir, ...ids] = process.argv.slice(2);
const strip = (s) => s.replace(/<[^>]+>/g, '');
let md = '# 修正前後の claim 差分\n\n修正前＝内容整合性修正の直前に生成した claims、修正後＝現在の claims。表示文が変わったもの、増えたもの、無くなったものだけを載せる（人物の一行・辞書の定型文の変化も含む）。\n';
ids.forEach((id) => {
  const A = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(beforeDir, id + '.claims.json'), 'utf8')).map((c) => [c.claim_id, c]));
  const B = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist', id + '.claims.json'), 'utf8')).map((c) => [c.claim_id, c]));
  const changed = Object.keys(B).filter((k) => A[k] && A[k].text !== B[k].text);
  const added = Object.keys(B).filter((k) => !A[k]);
  const removed = Object.keys(A).filter((k) => !B[k]);
  md += `\n## ${id}\n\n変更 ${changed.length}件・追加 ${added.length}件・削除 ${removed.length}件\n\n### 変更\n\n| claim | 修正前 | 修正後 |\n|---|---|---|\n`;
  changed.forEach((k) => { md += `| ${k} | ${strip(A[k].text).replace(/\|/g, '｜')} | ${strip(B[k].text).replace(/\|/g, '｜')} |\n`; });
  md += `\n### 追加\n\n${added.map((k) => `- ${k}：${strip(B[k].text)}`).join('\n') || '（なし）'}\n\n### 削除\n\n${removed.map((k) => `- ${k}：${strip(A[k].text)}`).join('\n') || '（なし）'}\n`;
});
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'claim-diff.md'), md);
console.log(md.split('\n').filter((l) => /^## |^変更 /.test(l)).join('\n'));
