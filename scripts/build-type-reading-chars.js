#!/usr/bin/env node
// 以前の結果から読むレポート：タイプ（元素×武器×国家）ごとに、一致度1位になり得るキャラクターの表を作る。
//   js/type_reading_chars.js を書き出す（入力画面の候補・購入時の検証に使う）。キャラクターデータ・代表プロファイルの版を変えたら作り直す。
//   実行: node scripts/build-type-reading-chars.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ctx = new Function(['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js', 'js/characters118_v2.js', 'js/characters118_v2_1.js', 'js/eti_mirror_selection_v21.js'].map(read).join('\n')
  + ';return { META: ETI_V2_META, E: ETIv2, OLD: ETI_V2_CHARACTERS, NEW: ETI_V2_CHARACTERS_2_1_0, SEL: ETIMirrorSelectionV21, EP: ELEMENT_PROTOTYPES_V2, WP: WEAPON_PROTOTYPES_V2, NP: NATION_PROTOTYPES_V2 };')();
Object.assign(globalThis, { ELEMENT_PROTOTYPES_V2: ctx.EP, WEAPON_PROTOTYPES_V2: ctx.WP, NATION_PROTOTYPES_V2: ctx.NP, ETIv2: ctx.E, ETI_V2_META: ctx.META });
const R = require('../js/eti_v2_mirror_resolver.js');
R.configure({ ETI_V2_CHARACTERS: ctx.OLD, ETI_V2_CHARACTERS_2_1_0: ctx.NEW, ETI_V2_META: ctx.META, ETIv2: ctx.E, ETIMirrorSelectionV21: ctx.SEL,
  ELEMENT_PROTOTYPES_V2: ctx.EP, WEAPON_PROTOTYPES_V2: ctx.WP, NATION_PROTOTYPES_V2: ctx.NP });
globalThis.ETIv2MirrorResolver = R;
const T = require('../js/eti_type_reading.js');
const out = {};
for (const e of T.ELEMENTS) for (const w of T.WEAPONS) for (const n of T.NATIONS.concat([null])) {
  const rows = [];
  for (const c of T.characters()) { const b = T.blendFor(e, w, n, c.name); if (b) rows.push([c.name, b.t]); }
  rows.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  out[`${e}|${w}|${n || '-'}`] = rows; // 国家を覚えていない時は '-'
}
const body = `// 自動生成（scripts/build-type-reading-chars.js）。手で直さない。
// タイプ（元素|武器|国家）ごとに、一致度1位になり得るキャラクターと、代表プロファイルから寄せる割合 t（小さいほどタイプの傾向に近い）。
(function (root) {
  var api = { PROFILE_VERSION: ${JSON.stringify(T.TYPE_PROFILE_VERSION)}, MIRROR_VERSION: ${JSON.stringify(T.MIRROR_VERSION)}, TYPES: ${JSON.stringify(out)} };
  root.EdTypeReadingChars = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(ROOT, 'js/type_reading_chars.js'), body);
const counts = Object.values(out).map((r) => r.length).sort((a, b) => a - b);
console.log('types', counts.length, 'min', counts[0], 'median', counts[140], 'max', counts[counts.length - 1]);
