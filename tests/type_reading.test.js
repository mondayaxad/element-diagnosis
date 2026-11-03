// 以前の結果から読むレポート（元素・武器・国家の選択から決まる数値）の計算の試験
//   実行: node --test tests/type_reading.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
const CH = require('../js/type_reading_chars.js');
const TYPES = [];
for (const e of T.ELEMENTS) for (const w of T.WEAPONS) for (const n of T.NATIONS) TYPES.push([e, w, n]);

test('280タイプ：数値は整数0〜100、判定し直すと選んだ元素・武器・国家に戻る。同じタイプなら常に同じ数値', () => {
  assert.equal(TYPES.length, 280);
  for (const [e, w, n] of TYPES) {
    const r = T.resultsFor(e, w, n);
    for (const dom of ['personality', 'style', 'values']) for (const v of Object.values(r[dom])) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
    assert.deepEqual([r.elementRanking[0].name, r.weaponRanking[0].name, r.nationRanking[0].name], [e, w, n]);
    assert.deepEqual(T.resultsFor(e, w, n), r);
  }
});

test('キャラクターを選ぶと、そのキャラクターが一致度1位（MIRROR v2.1 の選び方）になり、タイプは変わらない。候補表のすべてで確かめる', () => {
  assert.equal(CH.PROFILE_VERSION, T.TYPE_PROFILE_VERSION);
  let n = 0;
  for (const [e, w, nat] of TYPES) {
    const rows = CH.TYPES[`${e}|${w}|${nat}`];
    assert.ok(rows.length >= 1, `${e}${w}${nat}: 候補が1名以上`);
    for (const [name] of rows) {
      const r = T.resultsFor(e, w, nat, name);
      assert.equal(R.computeMirror(r, 'ETI-MIRROR-2.1.0').mirror.name, name, `${e}${w}${nat}:${name}`);
      assert.deepEqual([r.elementRanking[0].name, r.weaponRanking[0].name, r.nationRanking[0].name], [e, w, nat]);
      n += 1;
    }
  }
  assert.ok(n > 280);
});

test('候補表に無いキャラクター（このタイプで1位になれない）は、数値を作らない（別の人物を1位にして見せない）', () => {
  const rows = CH.TYPES['炎|両手剣|ナタ'].map((x) => x[0]);
  const other = T.characters().map((c) => c.name).find((nm) => !rows.includes(nm));
  assert.throws(() => T.resultsFor('炎', '両手剣', 'ナタ', other));
  assert.throws(() => T.resultsFor('炎', '片手剣', '存在しない国', null));
});
