// content-store.js — 内容辞書の読み込みと完全性チェック（欠損・空文・TODO があれば生成しない）
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'content');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

let cached = null;
function loadContent() {
  if (cached) return cached;
  const c = {
    axes: read('axes.json'), elements: read('elements.json'), weapons: read('weapons.json'), nations: read('nations.json'),
    pairEW: read('pair-element-weapon.json'), pairEN: read('pair-element-nation.json'), pairWN: read('pair-weapon-nation.json'),
    chars: read('character-language.json'), rules: read('experiments.json'), goals: read('mentor-goals.json'), coping: read('lower-coping.json'),
  };
  assertComplete(c);
  cached = c;
  return c;
}
const BAD = /TODO|TBD|lorem|ipsum|XXX|\?\?\?/i;
function walkStrings(o, pth, out) {
  if (typeof o === 'string') out.push([pth, o]);
  else if (Array.isArray(o)) o.forEach((x, i) => walkStrings(x, pth + '[' + i + ']', out));
  else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => walkStrings(v, pth + '.' + k, out));
  return out;
}
function assertComplete(c) {
  const errs = [];
  if (Object.keys(c.elements.items).length !== 7) errs.push('elements != 7');
  if (Object.keys(c.weapons.items).length !== 5) errs.push('weapons != 5');
  if (Object.keys(c.nations.items).length !== 8) errs.push('nations != 8');
  const pairs = Object.keys(c.pairEW.items).length + Object.keys(c.pairEN.items).length + Object.keys(c.pairWN.items).length;
  if (pairs !== 131) errs.push('pairs != 131 (' + pairs + ')');
  if (Object.keys(c.axes.axes).length !== 20) errs.push('axes != 20');
  Object.entries(c).forEach(([k, v]) => walkStrings(v, k, []).forEach(([p, s]) => {
    if (!s.trim() && !/compass_title|word|value/.test(p)) errs.push('empty string ' + p);
    if (BAD.test(s)) errs.push('placeholder text ' + p);
  }));
  if (errs.length) { const e = new Error('content incomplete: ' + errs.slice(0, 10).join('; ')); e.contentErrors = errs; throw e; }
}
module.exports = { loadContent };
