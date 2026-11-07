// scripts/audit-resonance-report.js — 共鳴診断｜人物像レポート（C-1）の 280 件監査
//   設計書§3-5「まず全280ケースを監査して偏り・不自然さがないか確認する」のための集計。数値は監査用（画面・本文には出さない）
//   出力：docs/eti-mini/phase_c/audit_280.json（全件）・audit_280.md（集計）
//   実行：node scripts/audit-resonance-report.js
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../lib/resonance_report_v1.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAP = require('../js/eti_mini_auto_map_v1.js');

const OUT = path.join(__dirname, '..', 'docs/eti-mini/phase_c');
const E = ['炎', '水', '氷', '雷', '風', '岩', '草'], W = ['片手剣', '両手剣', '長柄', '法器', '弓'];
const N = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
const pool = Array.from(new Set(Object.values(MAP.rows))).map((n) => CHARS.find((c) => c.name === n)); // 排出される66名
const rows = [];
for (const element of E) for (const weapon of W) for (const nation of N) {
  const m = R.modelVectors({ element, weapon, nation });
  const an = R.analyze(m);
  // 参考：同じ代表モデルで66名を本家 MIRROR の総合参照値で並べた時、割り当てられた人物が何位か（均等化の影響を見る）
  const scores = pool.map((c) => {
    const mm = { ...m, char: { persona: c.personality, style: c.style, values: c.values } };
    return { name: c.name, ref: R.analyze(mm).mirrorRef };
  }).sort((a, b) => b.ref - a.ref);
  const rank = scores.findIndex((s) => s.name === m.mirror) + 1;
  rows.push({ key: `${element}|${weapon}|${nation}`, mirror: m.mirror, pSim: +an.sims.persona.toFixed(4), sSim: +an.sims.style.toFixed(4), vSim: +an.sims.values.toFixed(4),
    mirrorRef: +an.mirrorRef.toFixed(4), rankAmong66: rank, flat: an.flat, closeDomain: an.closeDomain, farDomain: an.farDomain,
    common: an.common, differ: an.differ, styleNear: an.axes.style.near, styleFar: an.axes.style.far, styleFarSmall: an.axes.style.farIsSmall,
    valuesNear: an.axes.values.near, valuesFar: an.axes.values.far, valuesFarSmall: an.axes.values.farIsSmall });
}
fs.writeFileSync(path.join(OUT, 'audit_280.json'), JSON.stringify(rows, null, 1) + '\n');

const count = (f) => rows.reduce((o, r) => { const k = f(r); o[k] = (o[k] || 0) + 1; return o; }, {});
const table = (obj, head) => `| ${head} | 件数 |\n|---|---|\n` + Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (name, arr) => `| ${name} | ${q(arr, 0).toFixed(3)} | ${q(arr, 0.25).toFixed(3)} | ${q(arr, 0.5).toFixed(3)} | ${q(arr, 0.75).toFixed(3)} | ${Math.max(...arr).toFixed(3)} |`;
const md = `# 共鳴診断｜人物像レポート C-1：280件の監査

自動生成：\`node scripts/audit-resonance-report.js\`（全件は audit_280.json）。数値は監査用で、画面・本文には出さない。

## 1. 3側面の内部の近さ（pSim・sSim・vSim）の分布

| 指標 | 最小 | 25% | 中央 | 75% | 最大 |
|---|---|---|---|---|---|
${stat('pSim（性格・RMSE）', rows.map((r) => r.pSim))}
${stat('sSim（行動・RMSE）', rows.map((r) => r.sSim))}
${stat('vSim（価値観・中心化コサイン）', rows.map((r) => r.vSim))}

## 2. 「比較的近い側面」「違いが表れた側面」の選ばれ方（設計書§3-5 の暫定ルール）

- 3側面の差が ${R.FLAT_DOMAIN} 未満（偏りなし）：**${rows.filter((r) => r.flat).length} 件** / 280

${table(count((r) => (r.flat ? '（偏りなし）' : r.closeDomain)), '近い側面')}

${table(count((r) => (r.flat ? '（偏りなし）' : r.farDomain)), '違いの側面')}

## 3. 共鳴の章で挙げる軸

${table(count((r) => r.common.domain + ':' + r.common.axis), '共通点の軸')}

${table(count((r) => r.differ.domain + ':' + r.differ.axis + (r.differ.isSmall ? '（差が小さい）' : '')), '相違点の軸')}

## 4. 割り当てられた人物は、本家 MIRROR の総合参照値で66名中何位か（均等化の影響）

${table(count((r) => (r.rankAmong66 === 1 ? '1位' : r.rankAmong66 <= 3 ? '2〜3位' : r.rankAmong66 <= 10 ? '4〜10位' : '11位以下')), '順位')}

- 1位でない割当が多いほど、「類似度が一番高いから現れた」とは書けない（設計書§1・§4 RESONANCE の禁止事項の裏付け）

## 5. 気づいた点（ChatGPT への返却用）

- 「近い側面」は 価値観 ${count((r) => r.closeDomain).values || 0}・行動 ${count((r) => r.closeDomain).style || 0}・性格 ${count((r) => r.closeDomain).persona || 0}（偏りなしの件も含めた、最も近い側面の数）。極端な偏りがあれば、側面の比較をやめて軸ごとの説明だけにする代替案（設計書§3-5）を検討してほしい
- vSim（中心化コサイン）と pSim・sSim（RMSE）は尺度が違う。上の分布の幅は近いが、同じ尺度ではない点は設計書のとおり
- 武器種が同じなら STYLE の代表モデルは同じ。国家が同じなら VALUES も同じ（設計書§2 の注意どおり）。同じ人物が別タイプで現れる時、STYLE・VALUES の文は武器種・国家ごとにしか変わらない
`;
fs.writeFileSync(path.join(OUT, 'audit_280.md'), md);
console.log('flat', rows.filter((r) => r.flat).length, count((r) => (r.flat ? 'flat' : r.closeDomain)), count((r) => (r.rankAmong66 === 1 ? '1' : 'not1')));
