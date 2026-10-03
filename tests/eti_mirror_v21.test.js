// ETI-MIRROR-2.1.0 / ETI-CHAR-2.1.0 の実リポジトリ検証（node --test tests/*.test.js）
// 正本：docs/eti_mirror_v21/（ETI_CHAR_2_1_0.json・CSV・DECISION_MANIFEST.json・変更指示書）
// fixture：tests/fixtures/eti_mirror_v21_fixtures.json（引き継ぎパッケージの203件をそのまま収録）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// 本体と同じファイルを、ブラウザと同じく1つのスコープで読み込む
const ctx = new Function(
  ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js',
   'js/characters118_v2.js', 'js/characters118_v2_1.js', 'js/eti_mirror_selection_v21.js'].map(read).join('\n') +
  ';return { Q: ETI_V2_QUESTIONS, META: ETI_V2_META, E: ETIv2, OLD: ETI_V2_CHARACTERS, NEW: ETI_V2_CHARACTERS_2_1_0,' +
  ' SEL: ETIMirrorSelectionV21, EP: ELEMENT_PROTOTYPES_V2, WP: WEAPON_PROTOTYPES_V2, NP: NATION_PROTOTYPES_V2 };')();
const R = require('../js/eti_v2_mirror_resolver.js');
R.configure({
  ETI_V2_CHARACTERS: ctx.OLD, ETI_V2_CHARACTERS_2_1_0: ctx.NEW, ETI_V2_META: ctx.META, ETIv2: ctx.E,
  ETIMirrorSelectionV21: ctx.SEL, ELEMENT_PROTOTYPES_V2: ctx.EP, WEAPON_PROTOTYPES_V2: ctx.WP, NATION_PROTOTYPES_V2: ctx.NP,
});
const AX = [['personality', ctx.META.personalityAxes], ['style', ctx.META.styleAxes], ['values', ctx.META.valueAxes]];
const fixtures = JSON.parse(read('tests/fixtures/eti_mirror_v21_fixtures.json'));
const score = answers => ctx.E.computeResultsV2(Object.fromEntries(ctx.Q.map((q, i) => [q.id, answers[i]])),
  { elementPrototypes: ctx.EP, weaponPrototypes: ctx.WP, nationPrototypes: ctx.NP });

test('版定数：診断・設問・採点・翻訳は維持、キャラ座標とMIRRORは2.1.0', () => {
  assert.equal(ctx.META.diagnosisVersion, 'ETI-2.0');
  assert.equal(ctx.META.itemSetVersion, 'ETI-ITEM-2.0.0');
  assert.equal(ctx.META.scoringVersion, 'ETI-SCORE-2.0.0');
  assert.equal(ctx.META.translationModelVersion, 'ETI-TRANS-2.0.0');
  assert.equal(ctx.META.characterProfileVersion, 'ETI-CHAR-2.1.0');
  assert.equal(ctx.META.mirrorModelVersion, 'ETI-MIRROR-2.1.0');
  assert.equal(R.CURRENT, 'ETI-MIRROR-2.1.0');
});

test('ETI-CHAR-2.1.0：118名・JSON/CSVと20軸一致・事実メタデータと並び順は2.0.1と同一', () => {
  const json = JSON.parse(read('docs/eti_mirror_v21/ETI_CHAR_2_1_0.json')).characters;
  const csv = read('docs/eti_mirror_v21/ETI_CHAR_2_1_0_COORDINATES.csv').replace(/^﻿/, '').trim().split(/\r?\n/);
  const head = csv[0].split(',');
  assert.equal(ctx.NEW.length, 118); assert.equal(json.length, 118); assert.equal(csv.length - 1, 118);
  ctx.NEW.forEach((c, i) => {
    assert.equal(c.profile_version, 'ETI-CHAR-2.1.0');
    for (const k of ['name', 'wiki_name', 'element', 'weapon', 'region']) assert.equal(c[k], ctx.OLD[i][k], c.name + ' ' + k);
    assert.equal(c.name, json[i].name);
    const row = csv[i + 1].split(',');
    assert.equal(row[1], c.name);
    for (const [d, axes] of AX) for (const a of axes) {
      assert.equal(c[d][a], json[i][d][a]);
      assert.equal(Number(row[head.indexOf(a)]), c[d][a]);
    }
  });
  // 旧版データは消さずに残っている
  assert.equal(ctx.OLD.length, 118);
  assert.ok(ctx.OLD.every(c => c.profile_version === 'ETI-CHAR-2.0.1'));
});

test('203件のfixture：20軸・選出人物・上位4名と生スコア（誤差1e-10pt）が一致', () => {
  assert.equal(fixtures.length, 203);
  let maxErr = 0;
  for (const c of fixtures) {
    const u = score(c.answers);
    assert.deepEqual(AX.flatMap(([d, axes]) => axes.map(a => u[d][a])), c.scores, c.id);
    const r = R.computeMirror(u, 'ETI-MIRROR-2.1.0');
    assert.equal(r.mirrorModelVersion, 'ETI-MIRROR-2.1.0');
    assert.equal(r.characterProfileVersion, 'ETI-CHAR-2.1.0');
    assert.equal(r.mirror.name, c.mirror, c.id);
    assert.deepEqual(r.rankings.slice(0, 4).map(x => x.name), c.top4_names, c.id);
    r.rankings.slice(0, 4).forEach((x, i) => { const e = Math.abs(x.mirrorScoreRaw - c.top4_raw_pt[i]); maxErr = Math.max(maxErr, e); assert.ok(e < 1e-10); });
    // 保存snapshotは表示と同じ人物
    assert.equal(R.mirrorFromSnapshot(R.buildMirrorSnapshot(r)).name, c.mirror);
  }
  assert.ok(maxErr < 1e-10);
});

test('118名の本人プロフィールを入力すると本人が選ばれる', () => {
  ctx.NEW.forEach(c => {
    const r = R.computeMirror({ personality: c.personality, style: c.style, values: c.values }, 'ETI-MIRROR-2.1.0');
    assert.equal(r.mirror.name, c.name);
  });
});

test('同率選択：元素→国家→武器→番号、εは最大値アンカー、表示整数が同じでも生スコア優先', () => {
  const row = (i, element = '炎', region = 'モンド', weapon = '片手剣', s = 90) => ({ name: 't' + i, canonicalIndex: i, element, region, weapon, mirrorScoreRaw: s });
  const pick = (rows, at) => ctx.SEL.selectFromRankings(rows, at).mirror.canonicalIndex;
  const at = { element: ['水'], nation: ['璃月'], weapon: ['弓'] };
  assert.equal(pick([row(0), row(1, '水')], at), 1);                                   // 元素
  assert.equal(pick([row(0, '水'), row(1, '水', '璃月')], at), 1);                      // 国家
  assert.equal(pick([row(0, '水', '璃月'), row(1, '水', '璃月', '弓')], at), 1);       // 武器
  assert.equal(pick([row(1), row(0)], at), 0);                                         // 番号
  assert.equal(pick([row(0, '炎', 'モンド', '片手剣', 90.4), row(1, '水', '璃月', '弓', 90.1)], at), 0); // 表示90%同士でも同率ではない
  assert.equal(pick([row(0, '炎', 'モンド', '片手剣', 90), row(1, '水', '璃月', '弓', 90 - 5e-11)], at), 1);
  assert.equal(pick([row(0, '炎', 'モンド', '片手剣', 90), row(1, '水', '璃月', '弓', 90 - 2e-10)], at), 0);
  assert.equal(pick([row(0, '炎', 'モンド', '片手剣', 90), row(1, '炎', 'モンド', '片手剣', 90 - 7.5e-11), row(2, '水', '璃月', '弓', 90 - 1.5e-10)], at), 0); // 非推移
  assert.equal(pick([row(0, '炎'), row(1, '水', '璃月')], { element: ['炎', '水'], nation: ['璃月'], weapon: [] }), 1); // 属性側の複数同率
  assert.equal(pick([row(0, '水', null, '片手剣'), row(1, '水', '対象外', '弓')], at), 1); // 8国家外は国家一致なし
  const flat = Object.fromEntries(AX.map(([d, axes]) => [d, Object.fromEntries(axes.map(a => [a, 50]))]));
  const attrs = ctx.SEL.deriveAttributes(flat, { engine: ctx.E, meta: ctx.META, elementPrototypes: ctx.EP, nationPrototypes: ctx.NP, weaponPrototypes: ctx.WP });
  assert.equal(attrs.nation.length, 8);                                                 // 平坦な価値観は8国家すべて同率
});

test('同率で選ばれたMIRRORが一致率1位と違っても、snapshotとランキングは役割どおり', () => {
  // 1位と2位が完全同率、2位だけが元素一致 → MIRRORは2位。ランキングの並びは変えない。
  const computed = {
    mirrorModelVersion: 'ETI-MIRROR-2.1.0', characterProfileVersion: 'ETI-CHAR-2.1.0',
    rankings: [
      { name: 'A', canonicalIndex: 0, mirrorScore: 90, mirrorScoreRaw: 90, element: '炎', weapon: '弓', region: 'モンド' },
      { name: 'B', canonicalIndex: 1, mirrorScore: 90, mirrorScoreRaw: 90, element: '水', weapon: '弓', region: '璃月' },
      { name: 'C', canonicalIndex: 2, mirrorScore: 80, mirrorScoreRaw: 80, element: '水', weapon: '弓', region: '璃月' },
    ],
  };
  const sel = ctx.SEL.selectFromRankings(computed.rankings, { element: ['水'], nation: [], weapon: [] });
  computed.mirror = sel.mirror; computed.selectionMeta = sel.selectionMeta;
  const snap = R.buildMirrorSnapshot(computed);
  assert.deepEqual(snap.map(r => r.name), ['A', 'B', 'C']);   // 一致率順位は偽らない
  assert.equal(R.mirrorFromSnapshot(snap).name, 'B');           // 保存されたMIRRORは選択キャラ
  assert.equal(snap[1].selection.selected_by, 'element_match');
  assert.equal(snap[1].selection.tied_at_top, 2);
  assert.equal(snap[1].selection.mirror_model_version, 'ETI-MIRROR-2.1.0');
  // 5名以上の完全同率で選択キャラが上位4に入らない場合は5件目に足す
  const five = { ...computed, rankings: 'ABCDE'.split('').map((n, i) => ({ name: n, canonicalIndex: i, mirrorScore: 90, mirrorScoreRaw: 90, element: '炎', weapon: '弓', region: 'モンド' })) };
  five.mirror = five.rankings[4]; five.selectionMeta = { selectedBy: 'element_match', tiedAtTopCount: 5 };
  const s5 = R.buildMirrorSnapshot(five);
  assert.equal(s5.length, 5); assert.equal(R.mirrorFromSnapshot(s5).name, 'E');
});

test('旧版の保持：ETI-MIRROR-2.0.2 の座標と計算は残っており、ETI-CHAR-2.0.1 の生スコア1位を返す', () => {
  for (const c of fixtures.slice(0, 50)) {
    const u = score(c.answers);
    const old = R.computeMirror(u, 'ETI-MIRROR-2.0.2');
    const direct = ctx.E.computeMirrorV2(u, ctx.OLD, ctx.META);
    assert.equal(old.characterProfileVersion, 'ETI-CHAR-2.0.1');
    assert.deepEqual(old.rankings.map(x => [x.name, x.mirrorScoreRaw]), direct.map(x => [x.name, x.mirrorScoreRaw]));
    assert.equal(old.mirror.name, direct[0].name);
  }
  // 2.1.0 以外の保存版（2.0.0 等）も、従来どおり ETI-CHAR-2.0.1 で計算する
  assert.equal(R.resolveVersion('ETI-MIRROR-2.0.0'), 'ETI-MIRROR-2.0.2');
  assert.equal(R.resolveVersion(null), 'ETI-MIRROR-2.0.2');
  assert.equal(R.resolveVersion('ETI-MIRROR-2.1.0'), 'ETI-MIRROR-2.1.0');
});

test('URLと保存記録の版：Previewのデータは最新版で表示、mv付きはその版、往復で一致', () => {
  assert.equal(R.versionFromUrlParam(null), 'ETI-MIRROR-2.1.0');
  assert.equal(R.versionFromUrlParam('9.9.9'), 'ETI-MIRROR-2.1.0');
  for (const v of [null, 'ETI-MIRROR-2.0.0', 'ETI-MIRROR-2.0.2', 'ETI-MIRROR-2.1.0']) assert.equal(R.displayVersionForSaved(v), 'ETI-MIRROR-2.1.0');
  assert.equal(R.versionFromUrlParam('2.1.0'), 'ETI-MIRROR-2.1.0');
  for (const v of ['ETI-MIRROR-2.1.0', 'ETI-MIRROR-2.0.2']) assert.equal(R.versionFromUrlParam(R.urlParamFor(v)), v);
});

test('決定的：同じ入力は常に同じ結果（抽選・実行時補正なし）', () => {
  const u = score(fixtures[0].answers);
  const a = JSON.stringify(R.computeMirror(u, 'ETI-MIRROR-2.1.0'));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(R.computeMirror(u, 'ETI-MIRROR-2.1.0')), a);
});

test('保存：版を渡すとpendingに2.1.0、省略時は従来の固定値', () => {
  const save = require('../js/eti_v2_save.js');
  const p = save.buildPendingV2({}, 'code', {}, [{ name: 'X' }], 'id', { characterProfileVersion: 'ETI-CHAR-2.1.0', mirrorModelVersion: 'ETI-MIRROR-2.1.0' });
  assert.equal(p.characterProfileVersion, 'ETI-CHAR-2.1.0');
  assert.equal(p.mirrorModelVersion, 'ETI-MIRROR-2.1.0');
  assert.equal(p.diagnosisVersion, 'ETI-2.0'); assert.equal(p.itemSetVersion, 'ETI-ITEM-2.0.0'); assert.equal(p.scoringVersion, 'ETI-SCORE-2.0.0');
  const legacy = save.buildPendingV2({}, 'code', {}, [], 'id');
  assert.equal(legacy.characterProfileVersion, 'ETI-CHAR-2.0.1');
  assert.equal(legacy.mirrorModelVersion, 'ETI-MIRROR-2.0.2');
});
