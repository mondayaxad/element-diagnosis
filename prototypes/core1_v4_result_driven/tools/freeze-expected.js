// freeze-expected.js — 各フィクスチャの算出値を expected/ へ凍結する（回帰検出用）。
'use strict';
const fs = require('fs');
const path = require('path');
const { calculateResult } = require('../src/calculate-result');
const DIR = path.join(__dirname, '..', 'fixtures');

function summary(s) {
  const cat = (rows) => rows.map((r) => ({ rank: r.rank, name: r.name, display: r.display, distance: r.distance, band: r.band }));
  const ch = (rows) => rows.map((r) => ({ rank: r.rank, name: r.name, display: r.display, raw: r.raw }));
  return {
    axes: s.axes, values_flat: s.values_flat,
    rankings: { element: cat(s.rankings.element), weapon: cat(s.rankings.weapon), nation: cat(s.rankings.nation) },
    mirror: { top10: ch(s.mirror.top10), selected: s.mirror.selected },
    hidden: { top10: ch(s.hidden.top10) },
    mentor: { status: s.mentor.status, changes: s.mentor.changes || [], top10: ch(s.mentor.top10) },
    domains: s.domains.items.map((d) => ({ key: d.key, display: d.display })),
  };
}
fs.mkdirSync(path.join(DIR, 'expected'), { recursive: true });
fs.readdirSync(path.join(DIR, 'answers')).filter((f) => f.endsWith('.json')).sort().forEach((f) => {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, 'answers', f), 'utf8'));
  const s = calculateResult(fx.input);
  fs.writeFileSync(path.join(DIR, 'expected', f), JSON.stringify(summary(s), null, 1) + '\n');
  console.log('frozen', f);
});
module.exports = { summary };
