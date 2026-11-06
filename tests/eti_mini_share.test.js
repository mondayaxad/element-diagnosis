// 元素診断 Mini：Xシェア・画像（本家と同じ /api/share → /api/og-image の仕組み）と、キャラクター候補（3つの答えのタイプで現れる人物）の試験。
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
const BROWSER = require('../js/eti_mini_share.js');
const SHARE = require('../api/share.js');
const CHARS = require('../js/characters118_v2_1.js');

function constFrom(file, name) {
  const text = read(file);
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*').exec(text);
  let i = m.index + m[0].length, depth = 0, j = i, str = null;
  for (; j < text.length; j++) {
    const ch = text[j];
    if (str) { if (ch === '\\') { j++; continue; } if (ch === str) str = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return vm.runInNewContext('(' + text.slice(i, j + 1) + ')');
}
function callShare(query) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); } };
    SHARE({ url: '/api/share?' + query, headers: { host: 'example.test' } }, res);
  });
}

test('シェアの符号：ブラウザ・画像（_og-data.mjs）・シェアページ（share.js）の計算が全 66,080 通りで一致し、正規形だけを受け付ける', async () => {
  const D = await imp('api/_og-data.mjs');
  let n = 0;
  for (const el of BROWSER.ELEMENTS) for (const w of BROWSER.WEAPONS) for (const nat of BROWSER.NATIONS) for (const picked of [false, true]) for (let c = 0; c < 118; c++) {
    const code = BROWSER.pack(el, w, nat, c, picked);
    assert.equal(D.packMiniShare(el, w, nat, c, picked), code);
    const want = { element: el, weapon: w, nation: nat, charIndex: c, userPicked: picked };
    assert.deepEqual(BROWSER.unpack(code), want);
    const og = D.unpackMiniShare(code), sh = SHARE._unpackMiniShare(code);
    assert.deepEqual({ element: og.el, weapon: og.w, nation: og.nat, charIndex: og.charIdx, userPicked: og.userPicked }, want);
    assert.deepEqual({ element: sh.el, weapon: sh.w, nation: sh.nat, charIndex: sh.charIdx, userPicked: sh.userPicked }, want);
    n++;
  }
  assert.equal(n, BROWSER.TOTAL);
  for (const bad of ['', '0' + BROWSER.pack('炎', '弓', 'モンド', 3, false), BROWSER.pack('炎', '弓', 'モンド', 3, false).toUpperCase() + 'Z', '1z4k', 'zzzz', '-1', 'a b', '12345']) {
    if (bad === '1z4k' && BROWSER.unpack(bad)) continue; // 範囲内の正規形ならよい
    assert.equal(BROWSER.unpack(bad), null, bad);
    assert.equal(D.unpackMiniShare(bad), null, bad);
    assert.equal(SHARE._unpackMiniShare(bad), null, bad);
  }
  assert.equal(BROWSER.pack('光', '弓', 'モンド', 0, false), null);
  assert.equal(BROWSER.pack('炎', '弓', 'モンド', 118, false), null);
  assert.equal(BROWSER.pack('炎', '弓', 'ナド・クライ', 0, false), null); // 内部キーだけ
});

test('キャラクターの番号：画像・シェアページ・ブラウザとも ETI-CHAR-2.1.0 の並び', async () => {
  const D = await imp('api/_og-data.mjs');
  const names = CHARS.map((c) => c.name);
  assert.deepEqual(D.CHAR_NAMES, names);
  const shareNames = vm.runInNewContext('(' + /const CHAR_NAMES = (\[[^\]]+\]);/.exec(read('api/share.js'))[1] + ')');
  assert.deepEqual(Array.from(shareNames), names);
  assert.equal(BROWSER.CHAR_COUNT, names.length);
});

test('シェアページ（/api/share?m1=）：Mini の画像と、人を /mini?s= へ移す。一致率を出さない', async () => {
  const code = BROWSER.pack('水', '法器', 'ナドクライ', CHARS.findIndex((c) => c.name === 'アイノ'), true);
  const r = await callShare('m1=' + code);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`<meta property="og:image" content="https://example\\.test/api/og-image\\?m1=${code}">`));
  assert.match(r.body, new RegExp(`window\\.location\\.replace\\("https://example\\.test/mini\\?s=${code}"\\)`));
  assert.match(r.body, /twitter:card" content="summary_large_image"/);
  assert.match(r.body, /【水 × 法器 × ナド・クライ】/);
  assert.match(r.body, /私のキャラクター：アイノ/);
  assert.doesNotMatch(r.body, /一致|%/);
  const auto = await callShare('m1=' + BROWSER.pack('炎', '弓', 'モンド', 0, false));
  assert.match(auto.body, /近しいキャラクター：ディルック/);
  // 壊れた値：Mini のトップへ（結果の画像は出さない）
  const bad = await callShare('m1=zzzz');
  assert.match(bad.body, /window\.location\.replace\("https:\/\/example\.test\/mini"\)/);
  assert.doesNotMatch(bad.body, /og-image\?m1=/);
  // 本家のシェア（p）は従来どおり
  const main = await callShare('dv=ETI-2.0&code=abc&mv=2.1.0&p=' + ((1 << 20) | (0 << 17) | (4 << 14) | (10 << 7) | 75).toString(36));
  assert.match(main.body, /og-image\?p=/);
  assert.match(main.body, /75%一致/);
  assert.match(main.body, /\/\?dv=ETI-2\.0&amp;code=abc&amp;mv=2\.1\.0/);
});

test('画像（/api/og-image?m1=）：本家と同じ描き方へ、Mini 用の値で渡す（m1 の判定は本家の p より先）', () => {
  const src = read('api/og-image.mjs');
  const iMini = src.indexOf("searchParams.get('m1')"), iP = src.indexOf("searchParams.get('p')");
  assert.ok(iMini > 0 && iMini < iP);
  assert.match(src, /match: '', \/\/ Mini は一致率を出さない/);
  assert.match(src, /return renderCard\(data, origin\);[\s\S]*async function miniImage[\s\S]*return renderCard\(data, origin\);/);
  assert.match(src, /Location: `\$\{origin\}\/api\/og-image\?m1=\$\{m1\}`/);
});

test('画像の中身：Mini は見出し・下帯だけ変わり、一致率なし。本家の既定は従来どおり', async () => {
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const base = { code: 'HYCT', typeName: '深識者', element: '水', weapon: '法器', nation: 'ナドクライ', mirrorName: 'アイノ', mirrorElement: '水' };
  const mini = texts(buildOgpCardTree({ ...base, match: '', mirrorLabel: '私のキャラクター', brand: '元素診断 MINI' }, { part: 'overlay', baseUrl: 'data:,' })).join('|');
  assert.match(mini, /私のキャラクター/);
  assert.match(mini, /元素診断 MINI — 私の結果は【水 × 法器 × ナドクライ】/);
  assert.doesNotMatch(mini, /一致/);
  const main = texts(buildOgpCardTree({ ...base, match: '80' }, { part: 'overlay', baseUrl: 'data:,' })).join('|');
  assert.match(main, /最も近しいキャラクター/);
  assert.match(main, /\|元素診断 — 私の結果は【水 × 法器 × ナドクライ】/);
  assert.match(main, /%一致/);
});

test('画像のフォント：Mini で新しく描く文字は、同梱フォントに収録済みの文字だけ', async () => {
  const D = await imp('api/_og-data.mjs');
  // docs/ogp-fonts.md：収録文字＝元素・武器・国家・タイプ名・キャラクター名・カードの固定文言・数字・英大文字
  const covered = new Set([...Object.keys(D.ELEMENT_CODE), ...Object.keys(D.WEAPON_CODE), ...D.PACK_NATIONS, ...Object.values(D.TYPE_NAME).flatMap(Object.values),
    ...D.CHAR_NAMES, '最も近しいキャラクター', '元素診断 — 私の結果は【】×', '元素診断 — MY RESULT', '0123456789%一致', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '].join(''));
  for (const s of ['私のキャラクター', '元素診断 MINI']) for (const ch of s) assert.ok(covered.has(ch), `「${ch}」（${s}）`);
});

test('結果画面の画像を保存：本家と同じ色・同じ 1080×1080 の構成。Xの投稿文はシェア専用 URL 付き・一致率なし', () => {
  const html = read('mini.html');
  const EL = constFrom('index.html', 'ELEMENTS'), W = constFrom('index.html', 'WEAPONS');
  const elColor = vm.runInNewContext('(' + /var SHARE_EL_COLOR = (\{[^}]+\});/.exec(html)[1] + ')');
  const wColor = vm.runInNewContext('(' + /var SHARE_WP_COLOR = (\{[^}]+\});/.exec(html)[1] + ')');
  for (const k of Object.keys(EL)) assert.equal(elColor[k], EL[k].color, k);
  for (const k of Object.keys(W)) assert.equal(wColor[k], W[k].color, k);
  assert.match(html, /<canvas id="share-canvas-el" width="1080" height="1080"/);
  assert.match(html, /id="saveImgBtn"/);
  assert.match(html, /id="tweetShareBtn"/);
  assert.match(html, /'\/api\/share\?m1=' \+ code/);
  assert.match(html, /https:\/\/twitter\.com\/intent\/tweet\?text=/);
  assert.match(html, /#元素診断 #' \+ r\.typeCode4/);
  assert.doesNotMatch(html, /%一致|一 致|matchPct/);
  assert.match(html, /<script src="js\/eti_mini_share\.js"><\/script>/);
});

test('キャラクター候補：3つの答えのタイプで現れる人物（本家 js/type_reading_chars.js）。全 280 タイプにいて、登録 118 名の中', () => {
  const ctx = {}; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('js/type_reading_chars.js') + ';globalThis.__T = EdTypeReadingChars;', ctx);
  const T = ctx.__T;
  assert.equal(T.MIRROR_VERSION, 'ETI-MIRROR-2.1.0');
  const names = new Set(CHARS.map((c) => c.name));
  let total = 0;
  for (const el of BROWSER.ELEMENTS) for (const w of BROWSER.WEAPONS) for (const nat of BROWSER.NATIONS) {
    const rows = T.TYPES[`${el}|${w}|${nat}`];
    assert.ok(Array.isArray(rows) && rows.length > 0, `${el}|${w}|${nat}`);
    for (const [n] of rows) assert.ok(names.has(n), n);
    total++;
  }
  assert.equal(total, 280);
  const html = read('mini.html');
  assert.match(html, /EdTypeReadingChars\.TYPES\[a\.element \+ '\|' \+ a\.weapon \+ '\|' \+ a\.nation\]/);
  assert.match(html, /<script src="js\/type_reading_chars\.js"><\/script>/);
  assert.match(html, /元素診断（100問）を受けたことがあれば/);
});

test('配信：Mini のシェアの JS とキャラクター候補の表は公開ビルドに入る', () => {
  const B = require('../scripts/build-public.js');
  for (const f of ['js/eti_mini_share.js', 'js/type_reading_chars.js', 'assets/ogp/ogp-top-20261009.jpg']) assert.ok(B.PUBLIC_FILES.includes(f), f);
});
