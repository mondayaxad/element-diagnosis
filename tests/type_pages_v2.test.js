// タイプ解説の新しいテンプレート（type-v2。scripts/build-type-pages.mjs）とトップの全35タイプ一覧の回帰テスト。
//   ・生成した type/<code>.html が、生成スクリプトの出力と一致する（手で編集して食い違っていない）
//   ・本文（導入・元素・武器種・組み合わせ・軸・タグ）と SEO の head が、元データ（scripts/type-pages-data.json）のまま
//   ・標準プロフィール・タイプ別レポートの欄は Preview 専用（既定は hidden。本番ドメインでは開かない）。購入ボタンは計測の属性を持たない
//   ・トップの一覧：7元素の紋章・色、35タイプへのリンク、id="types-<元素>"
//   実行: node --test tests/type_pages_v2.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/type-pages-data.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const V2 = Object.keys(DATA).filter((c) => read(`type/${c.toLowerCase()}.html`).includes('<!-- template: type-v2'));
let render;
test.before(async () => { ({ renderTypePage: render } = await import('../scripts/build-type-pages.mjs')); });

test('元データは35タイプ。35ページすべてが type-v2', () => {
  assert.equal(Object.keys(DATA).length, 35);
  assert.equal(V2.length, 35, '全35タイプが type-v2');
});

test('type-v2：ファイルは生成スクリプトの出力と一致する', () => {
  for (const c of V2) assert.equal(read(`type/${c.toLowerCase()}.html`), render(c), `${c} が生成結果と食い違っています`);
});

// 結果ページ（index.html）の文章資産：タイプ解説はこれと同じ文を使う
const INDEX = read('index.html');
function indexConst(name) {
  const i = INDEX.indexOf(`const ${name} = `); const j = INDEX.indexOf('{', i); let depth = 0; let k = j;
  for (; k < INDEX.length; k++) { if (INDEX[k] === '{') depth++; else if (INDEX[k] === '}' && --depth === 0) break; }
  return vm.runInNewContext(`(${INDEX.slice(j, k + 1)})`);
}
const EL_NAME = { PY: '炎', HY: '水', CR: '氷', EL: '雷', AN: '風', GE: '岩', DE: '草' };
const WP_NAME = { SW: '片手剣', CM: '両手剣', PL: '長柄', CT: '法器', BW: '弓' };
const sentences = (t) => t.split('。').filter((x) => x.trim()).map((x) => x + '。');

test('type-v2：SEO の head は元データのまま。本文は結果ページと同じ文（元素・武器種の解説、タイプ固有の説明を全文）', () => {
  const TYPE_DESC = indexConst('TYPE_DESC'); const ED = indexConst('ELEMENT_DESC'); const WD = indexConst('WEAPON_DESC');
  for (const c of V2) {
    const h = read(`type/${c.toLowerCase()}.html`); const d = DATA[c];
    const el = EL_NAME[c.slice(0, 2)]; const wp = WP_NAME[c.slice(2)];
    assert.ok(h.includes(d.head), `${c} の head`);
    const text = h.replace(/<[^>]+>/g, ''); // 文頭の強調（<strong>）などのタグを除いた本文で比べる
    for (const t of [...sentences(ED[el]), ...sentences(WD[wp]), ...sentences(TYPE_DESC[el][wp])]) {
      // 「強み…ますが、つまずき…」の1文は、強みとつまずきの2か所に分けて載せる（言葉はそのまま）
      const i = t.indexOf('ますが、');
      const ok = text.includes(t) || (i > 0 && text.includes(t.slice(0, i + 2) + '。') && text.includes(t.slice(i + 4)));
      assert.ok(ok, `${c} に「${t.slice(0, 20)}…」がない`);
    }
    assert.ok(h.includes(d.combineText) && h.includes(`<div class="axis">${d.axis}</div>`), `${c} の組み合わせ・軸`);
    if (d.lead) assert.ok(h.includes(`<p class="lead">${d.lead}</p>`), `${c} の導入`);
    assert.doesNotMatch(h, /エニアグラム|援助者・堅実家/, `${c} に旧い表記`);
    assert.equal((h.match(/<script type="application\/ld\+json">/g) || []).length, 1);
  }
});

test('type-v2：標準プロフィール・タイプ別レポートは Preview 専用（既定は hidden）。購入ボタンは計測の属性なし。注記（仮値・受検者の平均ではない）は置かない', () => {
  for (const c of V2) {
    const h = read(`type/${c.toLowerCase()}.html`);
    assert.match(h, /<section class="prof" data-preview-only hidden /, `${c} の欄は既定で隠す`);
    assert.match(h, /<div class="r-price">¥1,000<small>（税込）<\/small><\/div>/);
    assert.match(h, /<button type="button" class="r-btn" data-report-open>今すぐアクセス →<\/button>/);
    assert.doesNotMatch(h, /表示用の仮値|受検者の平均ではありません/);
    assert.match(h, /<div class="report" id="report">/);
    assert.doesNotMatch(h, /buy\.stripe\.com|checkout\.stripe|\/api\/complete-checkout/, `${c} は決済に接続しない`);
    const btn = /<button[^>]*data-report-open[^>]*>/.exec(h)[0];
    assert.doesNotMatch(btn, /data-type-cta/);
    assert.match(h, /<script src="\/js\/type-detail\.js" defer><\/script>/);
    assert.ok(h.includes(`href="/#types-`), `${c} の一覧へ戻るリンク`);
  }
});

function runDetail(hostname) {
  const prof = { hidden: true };
  const stored = {};
  const ctx = {
    window: {}, location: { hostname }, sessionStorage: { setItem: (k, v) => { stored[k] = v; } },
    document: { readyState: 'complete', body: { getAttribute: () => 'pyro' }, querySelectorAll: () => [prof], getElementById: () => null, querySelector: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(read('js/type-detail.js'), ctx);
  return { prof, stored };
}
test('js/type-detail.js：Preview・ローカルでは欄を開き、本番ドメインでは開かない。読んでいた元素を残す', () => {
  assert.equal(runDetail('element-diagnosis-five.vercel.app').prof.hidden, true);
  assert.equal(runDetail('element-diagnosis-git-x-nmkw0322-4497s-projects.vercel.app').prof.hidden, false);
  assert.deepEqual(runDetail('127.0.0.1').stored, { ed_types_open_v1: 'pyro' });
});

test('トップの全35タイプ一覧：7元素（紋章・色・id）、35タイプへのリンク、一覧の状態を戻す処理', () => {
  const h = read('index.html');
  const els = [...h.matchAll(/<details class="tl-el" id="types-([a-z]+)" data-el="\1" style="--el:#[0-9a-f]{6};--el-l:#[0-9a-f]{6}">/g)].map((m) => m[1]);
  assert.deepEqual(els, ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro']);
  for (const e of els) assert.ok(h.includes(`src="/assets/emblems/2026-autumn/record/${e}.png"`), `${e} の紋章`);
  const links = [...h.matchAll(/<li><a href="\/type\/([a-z]{4})"><span class="tl-n">([^<]+)<\/span>/g)].map((m) => [m[1].toUpperCase(), m[2]]);
  assert.equal(links.length, 35);
  for (const [c, n] of links) assert.ok(DATA[c] && DATA[c].h1.includes(`「${n}」`), `${c} のタイプ名`);
  assert.match(h, /initTypeList\(root\);/);
  assert.match(h, /var TYPE_LIST_KEY = 'ed_types_open_v1';/);
});

// 標準データ（グラフの値）が、そのタイプの基準であること：
//   気質＝元素の設計値（ELEMENT_PROTOTYPES_V2）・関わり方＝武器種の設計値（WEAPON_PROTOTYPES_V2）を、実際の回答の形にして
//   診断エンジン（ETIv2.computeResultsV2）に通すと、35タイプすべてがそのタイプ（元素×武器種）と判定される
test('標準データ：35タイプすべてで、設計値を再現した回答が、そのタイプと判定される（元素・武器とも1位、2位と十分な差）', () => {
  const ctx = { console, Math };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext('this.__x = { Q: ETI_V2_QUESTIONS, EP: ELEMENT_PROTOTYPES_V2, WP: WEAPON_PROTOTYPES_V2, NP: NATION_PROTOTYPES_V2, E: ETIv2 };', ctx);
  const { Q, EP, WP, NP, E } = ctx.__x;
  // 各軸の回答（-2〜+2）の平均が、表示値 ((平均+2)/4)*100 で設計値になるように配る（価値観は 0）
  function answersFor(p, s) {
    const A = {}; const byAx = {};
    for (const q of Q) {
      if (q.domain === 'PERSONALITY' || q.domain === 'STYLE') (byAx[`${q.domain}:${q.axis}`] = byAx[`${q.domain}:${q.axis}`] || []).push(q);
      else A[q.id] = 0;
    }
    for (const [k, qs] of Object.entries(byAx)) {
      const [dom, ax] = k.split(':'); const target = (dom === 'PERSONALITY' ? p : s)[ax];
      let total = Math.round((target / 100 * 4 - 2) * qs.length); const vals = Array(qs.length).fill(0); let i = 0;
      while (total !== 0) { const sg = Math.sign(total); if (Math.abs(vals[i] + sg) <= 2) { vals[i] += sg; total -= sg; } i = (i + 1) % qs.length; }
      qs.forEach((q, j) => { A[q.id] = q.direction === -1 ? -vals[j] : vals[j]; });
    }
    return A;
  }
  let n = 0;
  for (const el of Object.keys(EP)) for (const w of Object.keys(WP)) {
    const R = E.computeResultsV2(answersFor(EP[el], WP[w]), { elementPrototypes: EP, weaponPrototypes: WP, nationPrototypes: NP });
    assert.equal(R.elementRanking[0].name, el, `${el}×${w} の元素`);
    assert.equal(R.weaponRanking[0].name, w, `${el}×${w} の武器`);
    assert.ok(R.elementTopGap >= 10 && R.weaponTopGap >= 10, `${el}×${w} は2位と十分に離れている（${R.elementTopGap}・${R.weaponTopGap}）`);
    n++;
  }
  assert.equal(n, 35);
});

test('type-v2：グラフの値はページのタイプの設計値（気質＝元素、関わり方＝武器種）', () => {
  const { ELEMENT_PROTOTYPES_V2: EP, WEAPON_PROTOTYPES_V2: WP } = require('../js/eti_v2_prototypes.js');
  for (const c of V2) {
    const h = read(`type/${c.toLowerCase()}.html`);
    const el = EL_NAME[c.slice(0, 2)]; const wp = WP_NAME[c.slice(2)];
    const vals = [...h.matchAll(/<span class="g-l">[^<]+<\/span><span class="g-v"[^>]*>(\d+)<\/span>/g)].map((m) => +m[1]);
    assert.deepEqual(vals, [...['O', 'C', 'E', 'A', 'N'].map((k) => EP[el][k]), ...['AGY', 'REL', 'ROL', 'REF', 'AUT'].map((k) => WP[wp][k])], `${c} のグラフ`);
  }
});

// タイプ別レポート用の標準の回答（scripts/type-standard-answers.json）：35タイプ。代表国家は元素ごと。
//   生成スクリプトの出力と一致し、符号を戻して診断エンジンに通すと、元素・武器種・代表国家がすべて1位になる
test('標準の回答：35タイプの符号が生成スクリプトと一致し、診断エンジンで元素・武器種・代表国家が1位になる', async () => {
  const { buildAll, REPRESENTATIVE_NATION } = await import('../scripts/build-type-standard-answers.mjs');
  const file = JSON.parse(read('scripts/type-standard-answers.json'));
  assert.deepEqual(file, JSON.parse(JSON.stringify(buildAll())), 'scripts/type-standard-answers.json が生成結果と食い違っています');
  assert.deepEqual(REPRESENTATIVE_NATION, { 炎: 'ナタ', 水: 'フォンテーヌ', 氷: 'スネージナヤ', 雷: '稲妻', 風: 'モンド', 岩: '璃月', 草: 'スメール' });
  const ctx = { console, Math };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext('this.__x = { Q: ETI_V2_QUESTIONS, EP: ELEMENT_PROTOTYPES_V2, WP: WEAPON_PROTOTYPES_V2, NP: NATION_PROTOTYPES_V2, E: ETIv2 };', ctx);
  const { Q, EP, WP, NP, E } = ctx.__x;
  assert.equal(Object.keys(file.types).length, 35);
  for (const [code, t] of Object.entries(file.types)) {
    assert.equal(code, Object.keys(EL_NAME).find((k) => EL_NAME[k] === t.element) + Object.keys(WP_NAME).find((k) => WP_NAME[k] === t.weapon));
    const R = E.computeResultsV2(E.decodeAnswersV2(t.diagnosis_code, Q), { elementPrototypes: EP, weaponPrototypes: WP, nationPrototypes: NP });
    assert.deepEqual([R.elementRanking[0].name, R.weaponRanking[0].name, R.nationRanking[0].name], [t.element, t.weapon, REPRESENTATIVE_NATION[t.element]], code);
  }
});
