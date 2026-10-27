// build-report.js — 100 answers → snapshot → claims → 46ページHTML（dist/ へ書き出す）。本番へは接続しない。
// 使い方: node src/build-report.js fixtures/answers/F02.json [--out dist/F02]   /  node src/build-report.js --all
'use strict';
const fs = require('fs');
const path = require('path');
const { calculateResult } = require('./calculate-result');
const { buildClaims } = require('./build-claims');
const { loadContent } = require('./content-store');
const { render } = require('./templates/report-46p');

const ROOT = path.join(__dirname, '..');
function buildOne(input, outBase) {
  const snap = calculateResult(input);
  const vm = buildClaims(snap);
  const html = render(vm, loadContent());
  if (outBase) {
    fs.mkdirSync(path.dirname(outBase), { recursive: true });
    fs.writeFileSync(outBase + '.html', html);
    fs.writeFileSync(outBase + '.snapshot.json', JSON.stringify(snap, null, 1) + '\n');
    fs.writeFileSync(outBase + '.claims.json', JSON.stringify(vm.claims, null, 1) + '\n');
  }
  return { snap, vm, html };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const files = args.includes('--all') ? fs.readdirSync(path.join(ROOT, 'fixtures', 'answers')).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(ROOT, 'fixtures', 'answers', f)) : args.filter((a) => !a.startsWith('--'));
  files.forEach((f) => {
    const fx = JSON.parse(fs.readFileSync(f, 'utf8'));
    const id = fx.fixture_id || path.basename(f, '.json');
    const { vm, html } = buildOne(fx.input, path.join(ROOT, 'dist', id));
    console.log(id, vm.typeCode, vm.typeName, `${vm.claims.length} claims`, `${Math.round(html.length / 1024)}KB`);
  });
}
module.exports = { buildOne };
