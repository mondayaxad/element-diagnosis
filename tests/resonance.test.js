// 共鳴診断（RESONANCE。旧 元素診断 Mini）C-0 の試験：
//   758 は3問だけで決まり、選んだ人物（SELF IMAGE）で変わらない／回答に映る人物（MIRROR）は 280 固定割当
//   シェア m2（2人表示）・旧 m1 の互換・/mini → /resonance・候補の差し替え口
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const plain = (x) => JSON.parse(JSON.stringify(x));
const SHARE_CODE = require('../js/eti_mini_share.js');
const SHARE_PAGE = require('../api/share.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAP_JSON = JSON.parse(read('docs/eti-mini/handoff_v1/data/eti_mini_758_5star_280_mapping.json'));

function loadPage() {
  const ctx = {}; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  const files = ['js/characters118_v2_1.js', 'js/eti_mini_auto_map_v1.js', 'js/eti_v2_prototypes.js', 'js/eti_mini_choices_v1.js', 'js/eti_mini_core.js', 'js/eti_mini_share.js', 'js/resonance_candidates.js'];
  vm.runInContext(files.map(read).join('\n;\n'), ctx, { filename: 'resonance-scripts.js' });
  return ctx;
}
function callShare(query) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, body: b }); } };
    SHARE_PAGE({ url: '/api/share?' + query, headers: { host: 'example.test' } }, res);
  });
}
const idx = (n) => CHARS.findIndex((c) => c.name === n);

test('758 は3問だけで決まる：選んだ人物（118名・選ばない）で 758・MIRROR が変わらない（280×119 通り）', () => {
  const ctx = loadPage();
  const M = ctx.ETIMini;
  assert.equal(M.isManualSelectionReady(), false); // 50:50 の結合はページに読み込まれていない
  const byKey = Object.fromEntries(MAP_JSON.rows.map((r) => [r.key, r.mirror_character]));
  let n = 0;
  for (const element of M.ELEMENT_KEYS) for (const weapon of M.WEAPON_KEYS) for (const nation of M.NATION_KEYS) {
    const a = { element, weapon, nation };
    for (const self of [null, ...CHARS.map((c) => ({ name: c.name }))]) {
      const r = M.resonanceResult(a, self);
      assert.deepEqual([r.element, r.weapon, r.nation], [element, weapon, nation]);
      assert.equal(r.mirror.name, byKey[`${element}|${weapon}|${nation}`]);
      assert.deepEqual(plain(r.self), self ? { name: self.name, role: 'self' } : null);
      assert.equal(r.versions.resonance, 'RESONANCE-C0');
      assert.ok(!('character' in r));
      n++;
    }
  }
  assert.equal(n, 280 * 119);
  assert.throws(() => M.resonanceResult({ element: '炎', weapon: '弓', nation: 'モンド' }, { name: '' }), (e) => e.code === 'INVALID_CHARACTER');
  assert.throws(() => M.resonanceResult({ element: '炎', weapon: '弓' }, null), (e) => e.code === 'INVALID_ANSWERS');
});

test('m2 の符号：ブラウザ・画像（_og-data.mjs）・シェアページ（share.js）の計算が全 3,931,760 通りで一致し、正規形だけを受け付ける', async () => {
  const D = await imp('api/_og-data.mjs');
  assert.equal(SHARE_CODE.TOTAL2, 280 * 118 * 119);
  let n = 0;
  for (const element of SHARE_CODE.ELEMENTS) for (const weapon of SHARE_CODE.WEAPONS) for (const nation of SHARE_CODE.NATIONS) for (let m = 0; m < 118; m++) for (let s = -1; s < 118; s++) {
    const self = s < 0 ? null : s;
    const code = SHARE_CODE.packResonance(element, weapon, nation, m, self);
    const b = SHARE_CODE.unpackResonance(code);
    if (b.element !== element || b.weapon !== weapon || b.nation !== nation || b.mirrorIndex !== m || b.selfIndex !== self) assert.fail(`browser ${code}`);
    const o = D.unpackResonanceShare(code);
    if (o.el !== element || o.w !== weapon || o.nat !== nation || o.mirrorIdx !== m || o.selfIdx !== self) assert.fail(`og ${code}`);
    const p = SHARE_PAGE._unpackResonanceShare(code);
    if (p.el !== element || p.w !== weapon || p.nat !== nation || p.mirrorIdx !== m || p.selfIdx !== self) assert.fail(`share ${code}`);
    if (code.length > 5) assert.fail(`long ${code}`);
    n++;
  }
  assert.equal(n, SHARE_CODE.TOTAL2);
  const one = SHARE_CODE.packResonance('炎', '弓', 'モンド', 3, 5);
  for (const bad of ['', '0' + one, one.toUpperCase(), (SHARE_CODE.TOTAL2).toString(36), 'zzzzz', 'zzzzzz', '-1', 'a b']) {
    assert.equal(SHARE_CODE.unpackResonance(bad), null, bad);
    assert.equal(D.unpackResonanceShare(bad), null, bad);
    assert.equal(SHARE_PAGE._unpackResonanceShare(bad), null, bad);
  }
  assert.equal(SHARE_CODE.packResonance('炎', '弓', 'モンド', 118, null), null);
  assert.equal(SHARE_CODE.packResonance('炎', '弓', 'モンド', 0, 119), null);
  assert.equal(SHARE_CODE.packResonance('炎', '弓', 'ナド・クライ', 0, null), null);
});

test('シェアページ（/api/share?m2=）：2人表示の画像、人は /resonance?r= へ。「最も近しい」と断定しない・数値なし', async () => {
  const code = SHARE_CODE.packResonance('水', '法器', 'ナドクライ', idx('アルベド'), idx('アイノ'));
  const r = await callShare('m2=' + code);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`<meta property="og:image" content="https://example\\.test/api/og-image\\?m2=${code}">`));
  assert.match(r.body, new RegExp(`window\\.location\\.replace\\("https://example\\.test/resonance\\?r=${code}"\\)`));
  assert.match(r.body, /<title>共鳴診断 — 私の結果は【水 × 法器 × ナド・クライ】<\/title>/);
  assert.match(r.body, /私が選んだ人物：アイノ／回答に映る人物：アルベド/);
  assert.doesNotMatch(r.body, /最も近しい|近しいキャラクター|一致|%/);
  const none = await callShare('m2=' + SHARE_CODE.packResonance('炎', '弓', 'モンド', 0, null));
  assert.match(none.body, /content="回答に映る人物：ディルック。/);
  assert.doesNotMatch(none.body, /私が選んだ人物/);
  const bad = await callShare('m2=zzzzz');
  assert.match(bad.body, /window\.location\.replace\("https:\/\/example\.test\/resonance"\)/);
  assert.doesNotMatch(bad.body, /og-image\?m2=/);
  // 旧 m1 は従来の画像（og-image?m1=）のまま、人は /resonance?s= へ
  const m1 = SHARE_CODE.pack('水', '法器', 'ナドクライ', idx('アイノ'), true);
  const old = await callShare('m1=' + m1);
  assert.match(old.body, new RegExp(`og-image\\?m1=${m1}`));
  assert.match(old.body, new RegExp(`/resonance\\?s=${m1}`));
});

test('画像（/api/og-image?m2=）：本家と同じ描き方に、SELF IMAGE と MIRROR を並べる（m2 の判定は本家の p より先）', async () => {
  const src = read('api/og-image.mjs');
  const iM2 = src.indexOf("searchParams.get('m2')"), iP = src.indexOf("searchParams.get('p')");
  assert.ok(iM2 > 0 && iM2 < iP);
  assert.match(src, /\[person\(u\.selfIdx, 'SELF IMAGE'\), person\(u\.mirrorIdx, 'MIRROR'\)\] : \[person\(u\.mirrorIdx, 'MIRROR'\)\]/);
  assert.match(src, /brand: '共鳴診断 RESONANCE'/);
  assert.match(src, /Location: `\$\{origin\}\/api\/og-image\?m2=\$\{m2\}`/);
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const base = { code: 'HYCT', typeName: '深識者', element: '水', weapon: '法器', nation: 'ナド・クライ', mirrorName: '', match: '', brand: '共鳴診断 RESONANCE' };
  for (const o of [{}, { part: 'overlay', baseUrl: 'data:,' }]) {
    const two = texts(buildOgpCardTree({ ...base, pair: [{ label: 'SELF IMAGE', name: 'アイノ', element: '水' }, { label: 'MIRROR', name: 'アルベド', element: '岩' }] }, o)).join('|');
    assert.match(two, /SELF IMAGE\|アイノ\|MIRROR\|アルベド/);
    assert.match(two, /共鳴診断 RESONANCE — 私の結果は【水 × 法器 × ナド\|クライ】/);
    assert.doesNotMatch(two, /最も近しい|一致|・/);
    const one = texts(buildOgpCardTree({ ...base, pair: [{ label: 'MIRROR', name: 'アルベド', element: '岩' }] }, o)).join('|');
    assert.match(one, /MIRROR\|アルベド/);
    assert.doesNotMatch(one, /SELF IMAGE|最も近しい/);
  }
});

test('画像のフォント：共鳴診断で新しく描く文字は、同梱フォントに収録済みの文字だけ（日本語の見出しは使わず英字）', async () => {
  const D = await imp('api/_og-data.mjs');
  const covered = new Set([...Object.keys(D.ELEMENT_CODE), ...Object.keys(D.WEAPON_CODE), ...D.PACK_NATIONS, ...Object.values(D.TYPE_NAME).flatMap(Object.values),
    ...D.CHAR_NAMES, '最も近しいキャラクター', '元素診断 — 私の結果は【】×', '元素診断 — MY RESULT', '0123456789%一致', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '].join(''));
  for (const s of ['共鳴診断 RESONANCE', 'SELF IMAGE', 'MIRROR']) for (const ch of s) assert.ok(covered.has(ch), `「${ch}」（${s}）`);
});

test('/mini は /resonance へ恒久転送（クエリは Vercel の既定で引き継ぐ：旧リンク /mini?s= も開ける）', () => {
  const v = JSON.parse(read('vercel.json'));
  for (const src of ['/mini', '/mini.html']) {
    const r = (v.redirects || []).find((x) => x.source === src);
    assert.ok(r, src);
    assert.equal(r.destination, '/resonance');
    assert.equal(r.permanent, true);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'mini.html')));
  assert.ok(fs.existsSync(path.join(ROOT, 'resonance.html')));
  // 共鳴診断のページは r（m2）と s（旧 m1）の両方を表示できる
  const html = read('resonance.html');
  assert.match(html, /params\.get\('r'\), s1 = params\.get\('s'\)/);
  assert.match(html, /S\.unpackResonance\(r2\)/);
  assert.match(html, /u = S\.unpack\(s1\)/);
  assert.match(html, /if \(u\.userPicked\) \{ type\.self = \{ name: name, role: 'self' \}; type\.mirror = null; \}/);
});

test('名称：共鳴診断・RESONANCE・ELEMENT DIAGNOSIS PRESENTS、¥500 のレポートは準備中（購入の導線なし）', () => {
  const html = read('resonance.html');
  assert.match(html, /<title>共鳴診断 — RESONANCE<\/title>/);
  assert.match(html, /<h1 class="title">共鳴診断<\/h1>/);
  assert.match(html, /<p class="sub">RESONANCE<\/p>/);
  assert.match(html, />Element Diagnosis Presents</);
  assert.match(html, /共鳴診断｜人物像レポート<\/h2>/);
  assert.match(html, /税込500円・買い切り/);
  assert.match(html, /準備中/);
  assert.doesNotMatch(html, /1,?000円|checkout|stripe/i);
  assert.doesNotMatch(html, /元素診断 Mini|最も近しいキャラクター/);
  assert.match(html, /<h2>アナタが選んだ人物<\/h2>/);
  assert.match(html, /<h2>回答に映る人物<\/h2>/);
});

test('候補：3つの答えの 758 で現れる人物（js/type_reading_chars.js）だけ。280 タイプすべてに 1 人以上、名簿の中。差し替え口は名簿にない名前・重複を落とす', () => {
  const ctx = {}; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(['js/type_reading_chars.js', 'js/resonance_candidates.js'].map(read).join('\n;\n'), ctx);
  const C = ctx.ResonanceCandidates, T = ctx.EdTypeReadingChars;
  const names = CHARS.map((c) => c.name);
  let total = 0;
  for (const element of SHARE_CODE.ELEMENTS) for (const weapon of SHARE_CODE.WEAPONS) for (const nation of SHARE_CODE.NATIONS) {
    const r = C.candidatesFor({ element, weapon, nation }, names);
    assert.equal(r.version, 'RESONANCE-CANDIDATES-TYPE-1');
    assert.deepEqual(plain(r.names), plain(T.TYPES[`${element}|${weapon}|${nation}`].map((x) => x[0])));
    assert.ok(r.names.length >= 1);
    for (const n of r.names) assert.ok(names.includes(n), n);
    total++;
  }
  assert.equal(total, 280);
  C.setProvider(() => ({ version: 'TEST', names: ['ナヒーダ', 'ナヒーダ', '存在しない人', '胡桃'] }));
  assert.deepEqual(plain(C.candidatesFor({ element: '炎', weapon: '弓', nation: 'モンド' }, names)), { version: 'TEST', names: ['ナヒーダ', '胡桃'] });
  C.setProvider(null);
  assert.equal(C.candidatesFor({ element: '炎', weapon: '弓', nation: 'モンド' }, names).version, 'RESONANCE-CANDIDATES-TYPE-1');
});

test('画像の見出し：共鳴診断（m2）は「共鳴診断 — MY RESULT」の下地35枚を使い、本家・旧 m1 は従来の「元素診断 — MY RESULT」のまま', async () => {
  const D = await imp('api/_og-data.mjs');
  for (const el of D.PACK_ELEMENTS) for (const w of D.PACK_WEAPONS) {
    const code = D.ELEMENT_CODE[el] + D.WEAPON_CODE[w];
    assert.ok(fs.existsSync(path.join(ROOT, `assets/ogp/bases-resonance/${code}.jpg`)), code);
    assert.ok(fs.existsSync(path.join(ROOT, `assets/ogp/bases/${code}.jpg`)), code);
  }
  assert.equal(fs.readdirSync(path.join(ROOT, 'assets/ogp/bases-resonance')).length, 35);
  const B = require('../scripts/build-public.js');
  assert.ok(B.PUBLIC_DIRS.some((d) => d.dir === 'assets/ogp/bases-resonance' && d.ext === '.jpg'));
  const src = read('api/og-image.mjs');
  assert.match(src, /header: '共鳴診断 — MY RESULT',\n    baseDir: 'bases-resonance',/);
  assert.match(src, /\/assets\/ogp\/\$\{data\.baseDir \|\| 'bases'\}\/\$\{code\}\.jpg/);
  assert.match(read('scripts/build-ogp-bases.mjs'), /RESONANCE_HEADER = '共鳴診断 — MY RESULT'/);
  // カードの見出し：省略時は本家と同じ。共鳴診断の値を渡した時だけ変わる（下地が取れず1枚描く時も同じ見出し）
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const d = { code: 'HYCT', typeName: '深識者', element: '水', weapon: '法器', nation: 'モンド' };
  assert.ok(texts(buildOgpCardTree(d, { part: 'base' })).includes('元素診断 — MY RESULT'));
  assert.ok(texts(buildOgpCardTree({ ...d, header: '共鳴診断 — MY RESULT' }, { part: 'base' })).includes('共鳴診断 — MY RESULT'));
  assert.ok(!texts(buildOgpCardTree({ ...d, header: '共鳴診断 — MY RESULT' }, { part: 'base' })).includes('元素診断 — MY RESULT'));
});
