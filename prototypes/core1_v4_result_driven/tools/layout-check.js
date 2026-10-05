// layout-check.js — 生成済みHTMLの紙面検査（Playwright）。使い方: NODE_PATH=$(npm root -g) node tools/layout-check.js dist/F01.html [--shots dir]
// 各ページ：枠外はみ出し・重なり・不可視の切り取り。P12の見出し1行、P43–P45の軸見出し1回・1行、P13–P21の画像（registry）を確認する。
'use strict';
const path = require('path');
const { chromium } = require('playwright');

async function check(file, opts = {}) {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const p = await b.newPage({ viewport: { width: 1100, height: 1400 } });
  await p.goto('file://' + path.resolve(file)); await p.waitForTimeout(250);
  const res = await p.evaluate(() => {
    const pages = [...document.querySelectorAll('.page')].map((pg) => {
      const inner = pg.querySelector('.page-inner'), ib = inner.getBoundingClientRect(), pb = pg.getBoundingClientRect();
      let maxB = 0, maxR = 0, worst = '';
      inner.querySelectorAll('*').forEach((el) => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return; if (r.bottom > maxB) { maxB = r.bottom; worst = el.className || el.tagName; } maxR = Math.max(maxR, r.right); });
      const kids = [...inner.children]; let minGap = 99;
      for (let i = 1; i < kids.length; i++) minGap = Math.min(minGap, Math.round(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom));
      const clipped = [...inner.querySelectorAll('*')].filter((el) => { const cs = getComputedStyle(el); return (cs.overflow === 'hidden' || cs.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 8 && !el.matches('.mb-t,.sqbar,.ptrack,.rbar,.dc-bar,.dma-bar,.nv-bar,.mv-bar,.td-img,.cover-img'); }).map((el) => String(el.className)).slice(0, 3);
      return { id: pg.id, h: Math.round(pb.height), over: Math.round(maxB - ib.bottom), right: Math.round(maxR - ib.right), minGap, worst: String(worst).slice(0, 40), clipped };
    });
    // P12「過剰使用のサイン」は1行
    const p12 = [...document.querySelectorAll('#p12 .to-k')].map((th) => ({ t: th.textContent, lines: Math.round(th.getBoundingClientRect().height / parseFloat(getComputedStyle(th).lineHeight || 14)), sh: th.scrollWidth <= th.clientWidth + 1 }));
    const p12over = [...document.querySelectorAll('#p12 .to-k')].find((th) => th.textContent === '過剰使用のサイン');
    const p12oneLine = p12over ? (() => { const r = document.createRange(); r.selectNodeContents(p12over); return r.getClientRects().length === 1; })() : false;
    // P43–P45：軸見出しは1ノード・1行、カード内で同じ項目名が二度出ない
    const axisCards = ['#p43', '#p44', '#p45', '#p46'].flatMap((id) => [...document.querySelectorAll(id + ' .dict.ax')].map((c) => {
      const h = c.querySelector('.dc-n'), code = c.querySelector('.dc-code').textContent, name = h.textContent;
      const r = document.createRange(); r.selectNodeContents(h);
      const heads = [...c.querySelectorAll('.dc-h, .pole')].map((x) => x.textContent).join('|'); const count = heads.split(name).length - 1 + (c.querySelector('.pole').textContent.includes(code) ? 1 : 0);
      return { id, code, oneLine: r.getClientRects().length === 1, nameCount: count, hidden: c.querySelectorAll('.pc,.pl,.pv').length };
    }));
    const imgs = [...document.querySelectorAll('.td-img img, .cover-img img')].map((im) => ({ page: im.closest('.page').id, asset: im.getAttribute('data-asset'), ok: im.naturalWidth > 0, svg: !!im.closest('.page').querySelector('.td-sym svg') }));
    return { pages, p12oneLine, axisCards, imgs, count: document.querySelectorAll('.page').length };
  });
  if (opts.shots) { const n = await p.locator('.page').count(); for (let i = 0; i < n; i++) await p.locator('.page').nth(i).screenshot({ path: path.join(opts.shots, `p${String(i + 1).padStart(2, '0')}.png`) }); }
  await b.close();
  return res;
}
module.exports = { check };
if (require.main === module) {
  const file = process.argv[2]; const si = process.argv.indexOf('--shots');
  check(file, { shots: si > 0 ? process.argv[si + 1] : null }).then((r) => {
    // 承認版と同じ設計上の例外：P01表紙（重ね配置）、P10–P12の表の右余白
    const EXC = { p01: ['minGap'], p10: ['right'], p11: ['right'], p12: ['right'] };
    const bad = r.pages.filter((x) => x.over > 0 || (x.right > 1 && !(EXC[x.id] || []).includes('right')) || (x.minGap < 0 && !(EXC[x.id] || []).includes('minGap')) || x.clipped.length || Math.abs(x.h - 1123) > 2);
    console.log(path.basename(file), 'pages', r.count, 'bad', bad.length, 'p12oneLine', r.p12oneLine,
      'axisHeads oneLine', r.axisCards.every((c) => c.oneLine), 'nameOnce', r.axisCards.every((c) => c.nameCount === 1 && c.hidden === 0), 'imgs', r.imgs.length, r.imgs.every((i) => i.ok && !i.svg));
    bad.forEach((x) => console.log('  ', JSON.stringify(x)));
    r.axisCards.filter((c) => !(c.oneLine && c.nameCount === 1 && c.hidden === 0)).forEach((c) => console.log('   axis', JSON.stringify(c)));
  });
}
