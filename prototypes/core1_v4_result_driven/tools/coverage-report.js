// coverage-report.js — 12フィクスチャのカバレッジ表と claim trace の例を docs/ へ書き出す
'use strict';
const fs = require('fs');
const path = require('path');
const { buildOne } = require('../src/build-report');
const { loadContent } = require('../src/content-store');
const DIR = path.join(__dirname, '..', 'fixtures', 'answers');
const rows = [];
const seen = { element: new Set(), weapon: new Set(), nation: new Set() };
fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().forEach((f) => {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const { snap, vm } = buildOne(fx.input);
  const R = snap.rankings;
  const tie = ['element', 'weapon', 'nation'].filter((k) => R[k][0].display === R[k][1].display).map((k) => ({ element: '元素', weapon: '武器種', nation: '国家' }[k]));
  seen.element.add(R.element[0].name); seen.weapon.add(R.weapon[0].name); if (!snap.values_flat) seen.nation.add(R.nation[0].name);
  rows.push(`| ${fx.fixture_id} | ${fx.title} | ${vm.typeCode} | ${vm.typeName} | ${R.element[0].name} ${R.element[0].display} | ${R.weapon[0].name} ${R.weapon[0].display} | ${snap.values_flat ? '（平坦）' : R.nation[0].name + ' ' + R.nation[0].display} | ${snap.mirror.selected.name} | ${snap.mentor.status === 'ok' ? snap.mentor.goal.goal_id : 'なし'} | ${tie.join('・') || '—'} | ${vm.claims.length} |`);
});
const K = loadContent();
const md = `# CORE1 結果連動版 — カバレッジ表

自動生成：\`node tools/coverage-report.js\`

| ID | 内容 | コード | タイプ名 | 元素1位 | 武器種1位 | 国家1位 | MIRROR | MENTOR方向 | 表示同点 | claims |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

- 1位になった元素：${[...seen.element].join('・')}（${seen.element.size}/7）
- 1位になった武器種：${[...seen.weapon].join('・')}（${seen.weapon.size}/5）
- 1位になった国家：${[...seen.nation].join('・')}（${seen.nation.size}/8）

## 内容辞書の件数

| 辞書 | 件数 |
|---|---|
| 軸（axes.json） | ${Object.keys(K.axes.axes).length} |
| 元素（elements.json） | ${Object.keys(K.elements.items).length} |
| 武器種（weapons.json） | ${Object.keys(K.weapons.items).length} |
| 国家（nations.json） | ${Object.keys(K.nations.items).length} |
| 元素×武器種 | ${Object.keys(K.pairEW.items).length} |
| 元素×国家 | ${Object.keys(K.pairEN.items).length} |
| 武器種×国家 | ${Object.keys(K.pairWN.items).length} |
| 人物タグの言い回し（118名の全タグを網羅） | ${Object.keys(K.chars.tags).length} |
| 内的緊張の規則 | ${K.rules.tensions.length} |
| 弱み候補の規則 | ${K.rules.weakness_rules.length} |
| MENTOR方向（本人が選ぶ選択肢） | ${K.goals.goals.length} |
`;
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'coverage.md'), md);
const f02 = buildOne(JSON.parse(fs.readFileSync(path.join(DIR, 'F02.json'), 'utf8')).input);
const pick = ['P03-PEAKS', 'P03-FACT-3', 'P03-TENSION-1', 'P13-BODY-MEANING', 'P25-CONFLICT', 'P29-SUB-6', 'P29-MIN-6', 'P27-1-OVERLOOK'];
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'claim-trace-example.json'), JSON.stringify(f02.vm.claims.filter((c) => pick.includes(c.claim_id)), null, 1) + '\n');
console.log(md);
// 核の保存形式の例（P13〜P21）
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'core-records-example.json'), JSON.stringify(['element', 'weapon', 'nation'].flatMap((k) => f02.vm.details[k].map((d) => ({ page_kind: k, category: d.row.name, records: d.core.records || [] }))), null, 1) + '\n');
