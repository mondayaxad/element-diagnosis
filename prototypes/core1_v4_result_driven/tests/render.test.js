// render.test.js — 46ページ表示（A4・はみ出し・PDF・390px・JS無効・印刷・外部依存・画像registry・P12・P43–45）
// Playwright が無い環境では skip する（NODE_PATH=$(npm root -g) で全体インストールを使う）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixtures, built } = require('./helpers');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (e) { /* skip */ }
const skip = chromium ? false : 'playwright not installed';
const DIST = path.join(__dirname, '..', 'dist');
const fileOf = (id) => { const f = path.join(DIST, id + '.html'); fs.writeFileSync(f, built(id).html); return f; };

test('no external CDN / font / script references', () => {
  fixtures.forEach((fx) => {
    const { html } = built(fx.fixture_id);
    assert.ok(!/(src|href)="https?:/.test(html), fx.fixture_id);
    assert.ok(!/@import|fonts\.googleapis|<link /.test(html), fx.fixture_id);
  });
});

test('images come from the asset registry; cover and P13 use the same element file', () => {
  fixtures.forEach((fx) => {
    const { html, snap } = built(fx.fixture_id);
    const assets = [...html.matchAll(/data-asset="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(assets.length, 10, fx.fixture_id);
    const K = require('../src/content-store').loadContent();
    const want = [
      'assets/elements/' + K.elements.items[snap.rankings.element[0].key].visual.image + '.jpg',
      ...snap.rankings.element.slice(0, 3).map((r) => 'assets/elements/' + K.elements.items[r.key].visual.image + '.jpg'),
      ...snap.rankings.weapon.slice(0, 3).map((r) => 'assets/weapons/' + K.weapons.items[r.key].visual.image + '.jpg'),
      ...snap.rankings.nation.slice(0, 3).map((r) => 'assets/nations/' + K.nations.items[r.key].visual.image + '.jpg'),
    ];
    assert.deepEqual(assets.slice().sort(), want.slice().sort(), fx.fixture_id);
    assert.equal(assets[0], assets[1], 'cover and P13 share the same approved file');
    assert.ok(!/class="td-sym[^"]*"[^>]*>\s*<svg/.test(html), 'no SVG fallback');
  });
  const ids = new Set();
  const K = require('../src/content-store').loadContent();
  [K.elements, K.weapons, K.nations].forEach((d) => Object.values(d.items).forEach((it) => { assert.ok(!ids.has(it.visual.image)); ids.add(it.visual.image); }));
  assert.equal(ids.size, 20);
});

test('A4 layout: 46 pages, no overflow, P12 one-line heading, P43–P46 headings once and one line (all 12 fixtures)', { skip, timeout: 240000 }, async () => {
  const { check } = require('../tools/layout-check');
  const EXC = { p01: ['minGap'], p10: ['right'], p11: ['right'], p12: ['right'] };
  for (const fx of fixtures) {
    const r = await check(fileOf(fx.fixture_id));
    assert.equal(r.count, 46, fx.fixture_id);
    const bad = r.pages.filter((x) => x.over > 0 || (x.right > 1 && !(EXC[x.id] || []).includes('right')) || (x.minGap < 0 && !(EXC[x.id] || []).includes('minGap')) || x.clipped.length || Math.abs(x.h - 1123) > 2);
    assert.deepEqual(bad, [], fx.fixture_id);
    assert.ok(r.p12oneLine, fx.fixture_id + ' P12');
    r.axisCards.forEach((c) => { assert.ok(c.oneLine, `${fx.fixture_id} ${c.code} one line`); assert.equal(c.nameCount, 1, `${fx.fixture_id} ${c.code} once`); assert.equal(c.hidden, 0); });
    assert.ok(r.imgs.every((i) => i.ok && !i.svg), fx.fixture_id);
  }
});

test('PDF is exactly 46 A4 pages; print hides the viewer; 390px works; no-JS shows all pages', { skip, timeout: 240000 }, async () => {
  const b = await chromium.launch();
  for (const id of ['F01', 'F02', 'F09']) {
    const url = 'file://' + fileOf(id);
    const p = await b.newPage(); await p.goto(url); await p.emulateMedia({ media: 'print' });
    const pdfPath = path.join(os.tmpdir(), `core1_${id}.pdf`);
    await p.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    const pdf = fs.readFileSync(pdfPath, 'latin1');
    assert.equal((pdf.match(/\/Type\s*\/Page[^s]/g) || []).length, 46, id + ' pdf pages');
    const navVisible = await p.evaluate(() => [...document.querySelectorAll('.viewer-nav,.vn-open,.toc-panel,.mobile-notice')].some((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0));
    assert.equal(navVisible, false, id + ' print nav');
    const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await m.goto(url); await m.waitForTimeout(200);
    const ok = m.locator('[data-nav="notice-ok"]'); if (await ok.isVisible()) await ok.tap();
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), id + ' 390 no h-scroll');
    await m.locator('[data-nav="next"]').tap(); await m.waitForTimeout(700);
    assert.match((await m.locator('.vn-pos').textContent()).trim(), /^02 \/ 46$/);
    const c = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1100, height: 1400 } });
    const q = await c.newPage(); await q.goto(url);
    assert.equal(await q.evaluate(() => [...document.querySelectorAll('.page')].filter((x) => x.getBoundingClientRect().height > 1000 && x.innerText.length > 100).length), 46, id + ' no-JS');
    await c.close(); await p.close(); await m.close();
  }
  await b.close();
});
