// タイプ解説ページの診断への導線の計測（js/type-page.js → type_diagnosis_cta_click）の回帰テスト。
//   ・上・末尾・関連の導線を cta_position で区別し、遷移先をラベル（eti_top・jagan_top）で送る
//   ・1クリック1回（リスナーは1回だけ・同じ導線の1秒以内の再クリックは送らない）。読み込みが2回でも二重にならない
//   ・js/ga.js の消毒を通しても値が落ちない。個人情報・URL・診断結果を送らない
//   実行: node --test tests/ga4_type_cta.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'type-page.js'), 'utf8');
const GA_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'ga.js'), 'utf8');

function el(attrs) {
  return { getAttribute: (k) => (k in attrs ? attrs[k] : null), closest(sel) { return sel === 'a[data-type-cta]' && 'data-type-cta' in attrs ? this : null; } };
}
function setup({ loadTwice = false, body = { typeCode: 'ELCM', element: 'electro', weaponType: 'claymore' } } = {}) {
  const listeners = [];
  const sent = [];
  let now = 1_000_000;
  const window = { gtag: (kind, name, params) => sent.push([kind, name, params]) };
  const ctx = {
    window, WeakMap,
    Date: { now: () => now },
    document: { body: { dataset: body }, addEventListener: (t, fn) => { if (t === 'click') listeners.push(fn); } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (loadTwice) vm.runInContext(SRC, ctx);
  const click = (target) => listeners.forEach((fn) => fn({ target }));
  return { listeners, sent, click, tick: (ms) => { now += ms; } };
}

const TOP = el({ 'data-type-cta': 'top', 'data-destination': 'eti_top' });
const BOTTOM = el({ 'data-type-cta': 'bottom', 'data-destination': 'eti_top' });
const RELATED = el({ 'data-type-cta': 'related', 'data-destination': 'jagan_top' });

test('上・末尾・関連の導線を cta_position と destination で区別して送る（ページの値は body から）', () => {
  const s = setup();
  s.click(TOP); s.tick(5); s.click(BOTTOM); s.tick(5); s.click(RELATED);
  assert.deepEqual(s.sent.map((x) => x[1]), ['type_diagnosis_cta_click', 'type_diagnosis_cta_click', 'type_diagnosis_cta_click']);
  assert.deepEqual(JSON.parse(JSON.stringify(s.sent[0][2])), { type_code: 'ELCM', element: 'electro', weapon_type: 'claymore', cta_position: 'top', destination: 'eti_top', transport_type: 'beacon' });
  assert.equal(s.sent[1][2].cta_position, 'bottom');
  assert.deepEqual([s.sent[2][2].cta_position, s.sent[2][2].destination], ['related', 'jagan_top']);
});

test('二重発火しない：スクリプトを2回読み込んでもリスナーは1つ。同じ導線の1秒以内の再クリックは送らない（1秒後は送る）', () => {
  const s = setup({ loadTwice: true });
  assert.equal(s.listeners.length, 1);
  s.click(TOP); s.tick(300); s.click(TOP);
  assert.equal(s.sent.length, 1);
  s.tick(800); s.click(TOP);
  assert.equal(s.sent.length, 2);
});

test('導線以外のクリック・値が不正なページでは送らない', () => {
  const s = setup();
  s.click(el({})); s.click(null);
  s.click(el({ 'data-type-cta': 'evil', 'data-destination': 'eti_top' }));
  s.click(el({ 'data-type-cta': 'top', 'data-destination': 'https://example.com/' }));
  assert.equal(s.sent.length, 0);
  const bad = setup({ body: { typeCode: 'elcm<script>', element: 'electro', weaponType: 'claymore' } });
  bad.click(TOP);
  assert.equal(bad.sent.length, 0);
});

test('js/ga.js の消毒を通しても、type_diagnosis_cta_click の値は落ちない（本番ドメイン）', () => {
  const win = {};
  const store = {};
  const ctx = {
    window: win, URLSearchParams,
    location: { hostname: 'element-diagnosis-five.vercel.app', origin: 'https://element-diagnosis-five.vercel.app', pathname: '/type/elcm', search: '', hash: '' },
    document: { referrer: '', head: { appendChild() {} }, createElement: () => ({}) },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  ctx.window.localStorage = ctx.localStorage; ctx.window.sessionStorage = ctx.sessionStorage;
  vm.createContext(ctx);
  vm.runInContext(GA_SRC, ctx);
  const params = { type_code: 'ELCM', element: 'electro', weapon_type: 'claymore', cta_position: 'top', destination: 'eti_top', transport_type: 'beacon' };
  win.gtag('event', 'type_diagnosis_cta_click', params);
  const ev = win.dataLayer.map((a) => Array.from(a)).find((a) => a[0] === 'event' && a[1] === 'type_diagnosis_cta_click');
  assert.ok(ev, 'dataLayer に入らない');
  const cleaned = win.__edGaClean ? win.__edGaClean(ev[2]) : ev[2];
  assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), params);
  // page_view：/type/ のページも config（content_group: eti）が送られる
  const cfg = win.dataLayer.map((a) => Array.from(a)).find((a) => a[0] === 'config');
  assert.equal(cfg[2].page_location, 'https://element-diagnosis-five.vercel.app/type/elcm');
  assert.equal(cfg[2].content_group, 'eti');
});
