'use strict';
const fs = require('fs');
const path = require('path');
const { buildOne } = require('../src/build-report');
const FX = path.join(__dirname, '..', 'fixtures');
const fixtures = fs.readdirSync(path.join(FX, 'answers')).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(FX, 'answers', f), 'utf8')));
const cache = {};
function built(id) { if (!cache[id]) cache[id] = buildOne(fixtures.find((f) => f.fixture_id === id).input); return cache[id]; }
// 画面に出る文字だけ（style/script/コメント/タグを除く）
function visibleText(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
}
function pageText(html, n) {
  const id = 'p' + String(n).padStart(2, '0');
  const a = html.indexOf(`id="${id}"`); const b = html.indexOf('<section class="page', a + 10);
  return visibleText(html.slice(a, b < 0 ? undefined : b));
}
module.exports = { fixtures, built, visibleText, pageText, FX };
