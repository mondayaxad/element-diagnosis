// タイプ解説35ページの「{元素}×{武器種}のキャラクター」欄（原神で元素と武器種が共通するプレイアブルキャラ。性格タイプの判定ではない）。
//   ・名前は静的な ul/li（hidden・data-preview-only・JS の切り替えなし）。見出しは固定、補足の一文は置かない
//   ・名前は診断用キャラマスター（js/characters118_v2_1.js）の元素・武器種から決まり、scripts/type-characters.json の追加分を足す（旅人は載せない）
//   ・35区分すべてに1人以上・同じページに重複なし・マスターの全員がちょうど1ページに載る
//   ・欄は強み・つまずきの後、標準プロフィール（レポートの案内）の前
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const EL = { PY: '炎', HY: '水', CR: '氷', EL: '雷', AN: '風', GE: '岩', DE: '草' };
const WP = { SW: '片手剣', CM: '両手剣', PL: '長柄', CT: '法器', BW: '弓' };
const CODES = Object.keys(EL).flatMap((e) => Object.keys(WP).map((w) => e + w));
const EXTRA = JSON.parse(read('scripts/type-characters.json'));
const MASTER = (() => { const c = {}; vm.runInNewContext(`${read('js/characters118_v2_1.js')}\n;this.C = ETI_V2_CHARACTERS_2_1_0;`, c); return JSON.parse(JSON.stringify(c.C)); })();
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function listOf(code) {
  const h = read(`type/${code.toLowerCase()}.html`);
  const m = /<section class="card" aria-labelledby="ch-chars">\s*<div class="card-h"><h2 id="ch-chars">([^<]+)<\/h2><\/div>\s*<ul class="chars">([\s\S]*?)<\/ul>\s*<\/section>/.exec(h);
  return m && { h, heading: m[1], names: [...m[2].matchAll(/<li>([^<]+)<\/li>/g)].map((x) => decode(x[1])), at: m.index };
}

test('35ページすべてに、見出しと静的な名前の一覧がある（補足の一文なし・表示の切り替えなし）', () => {
  for (const code of CODES) {
    const l = listOf(code);
    assert.ok(l, `${code} に欄がない`);
    assert.equal(l.heading, `${EL[code.slice(0, 2)]}×${WP[code.slice(2)]}のキャラクター`);
    assert.doesNotMatch(l.h, /原神で元素と武器種が共通するキャラクターを掲載しています/, `${code}：補足の一文は置かない`);
    assert.ok(l.names.length >= 1, `${code} に名前がない`);
    assert.equal(new Set(l.names).size, l.names.length, `${code} に重複`);
    const sec = l.h.slice(l.at, l.h.indexOf('</section>', l.at));
    assert.doesNotMatch(sec, /hidden|data-preview-only|<script|<a |<button|<img/, `${code} の欄は静的な名前だけ`);
    // 位置：強み・つまずき（ch-type の欄）の後、標準プロフィールの前
    assert.ok(l.at > l.h.indexOf('力を発揮するとき') && l.at < l.h.indexOf('<section class="prof"'), `${code} の位置`);
    assert.doesNotMatch(sec, /判定|性格タイプ/, `${code}：判定された人物という表示にしない`);
  }
});

test('名前はマスターの元素・武器種どおり（全員がちょうど1ページ）＋追加分。旅人は載せない', () => {
  const placed = {};
  for (const code of CODES) for (const n of listOf(code).names) (placed[n] = placed[n] || []).push(code);
  assert.equal(MASTER.length, 118);
  for (const c of MASTER) {
    const code = Object.keys(EL).find((k) => EL[k] === c.element) + Object.keys(WP).find((k) => WP[k] === c.weapon);
    assert.deepEqual(placed[c.name], [code], `${c.name}（${c.element}×${c.weapon}）`);
  }
  for (const a of EXTRA.additions) {
    const want = a.elements.map((e) => Object.keys(EL).find((k) => EL[k] === e) + Object.keys(WP).find((k) => WP[k] === a.weapon)).sort();
    assert.deepEqual([...placed[a.name]].sort(), want, a.name);
  }
  assert.equal(placed['旅人'], undefined, '旅人は載せない');
  const total = Object.values(placed).reduce((n, v) => n + v.length, 0);
  assert.equal(Object.keys(placed).length, 118 + EXTRA.additions.length, '実人数');
  assert.equal(total, 118 + EXTRA.additions.reduce((n, a) => n + a.elements.length, 0), '掲載のべ数');
  // 並びはマスターの順（生成のたびに変わらない）
  const pycm = listOf('PYCM').names;
  assert.deepEqual(pycm, MASTER.filter((c) => c.element === '炎' && c.weapon === '両手剣').map((c) => c.name));
});

test('補完データ：参照日・照合状態・追加の理由と根拠を持つ（未照合は未照合と記録）', () => {
  assert.match(EXTRA.reference_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(EXTRA.base.file, 'js/characters118_v2_1.js');
  for (const a of EXTRA.additions) {
    assert.ok(a.reason && a.basis && ['verified', 'unverified'].includes(a.official_check), a.name);
    assert.notEqual(a.name, '旅人');
    assert.ok(Array.isArray(a.elements) && a.elements.every((e) => Object.values(EL).includes(e)) && Object.values(WP).includes(a.weapon), a.name);
  }
  assert.ok(['done', 'not_done', 'partial'].includes(EXTRA.official_check.status));
});
