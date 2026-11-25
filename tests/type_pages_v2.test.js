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

test('元データは35タイプ。type-v2 のページがある（今回は炎・氷・雷の片手剣）', () => {
  assert.equal(Object.keys(DATA).length, 35);
  assert.deepEqual(V2.slice().sort(), ['CRSW', 'ELSW', 'PYSW']);
});

test('type-v2：ファイルは生成スクリプトの出力と一致する', () => {
  for (const c of V2) assert.equal(read(`type/${c.toLowerCase()}.html`), render(c), `${c} が生成結果と食い違っています`);
});

test('type-v2：SEO の head と本文は元データのまま（文言を書き換えない）', () => {
  for (const c of V2) {
    const h = read(`type/${c.toLowerCase()}.html`); const d = DATA[c];
    assert.ok(h.includes(d.head), `${c} の head`);
    for (const k of ['elementText', 'weaponText']) {
      const t = d[k]; const i = t.indexOf('。');
      assert.ok(h.includes(t.slice(0, i + 1)) && h.includes(t.slice(i + 1)), `${c} の ${k}`);
    }
    assert.ok(h.includes(d.combineText) && h.includes(`<div class="axis">${d.axis}</div>`), `${c} の組み合わせ・軸`);
    if (d.lead) assert.ok(h.includes(`<p class="lead">${d.lead}</p>`), `${c} の導入`);
    assert.equal((h.match(/<script type="application\/ld\+json">/g) || []).length, 1);
  }
});

test('type-v2：標準プロフィール・タイプ別レポートは Preview 専用（既定は hidden）。購入ボタンは計測の属性なし。「表示用の仮値」と明記', () => {
  for (const c of V2) {
    const h = read(`type/${c.toLowerCase()}.html`);
    assert.match(h, /<section class="prof" data-preview-only hidden /, `${c} の欄は既定で隠す`);
    assert.match(h, /<button type="button" class="r-btn" data-report-open>今すぐアクセス　¥1,000（税込）<\/button>/);
    assert.ok(h.includes('表示用の仮値'));
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
