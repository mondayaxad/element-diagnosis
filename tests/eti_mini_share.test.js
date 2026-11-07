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

test('旧 Mini のシェアページ（/api/share?m1=）：従来の画像のまま、人は共鳴診断の /resonance?s= へ移す。一致率を出さない', async () => {
  const code = BROWSER.pack('水', '法器', 'ナドクライ', CHARS.findIndex((c) => c.name === 'アイノ'), true);
  const r = await callShare('m1=' + code);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`<meta property="og:image" content="https://example\\.test/api/og-image\\?m1=${code}">`));
  assert.match(r.body, new RegExp(`window\\.location\\.replace\\("https://example\\.test/resonance\\?s=${code}"\\)`));
  assert.match(r.body, /twitter:card" content="summary_large_image"/);
  assert.match(r.body, /【水 × 法器 × ナド・クライ】/);
  assert.match(r.body, /私のキャラクター：アイノ/);
  assert.doesNotMatch(r.body, /一致|%/);
  const auto = await callShare('m1=' + BROWSER.pack('炎', '弓', 'モンド', 0, false));
  assert.match(auto.body, /近しいキャラクター：ディルック/);
  // 壊れた値：Mini のトップへ（結果の画像は出さない）
  const bad = await callShare('m1=zzzz');
  assert.match(bad.body, /window\.location\.replace\("https:\/\/example\.test\/resonance"\)/);
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

test('画像の中身：Mini は見出し・下帯・「ナド・クライ」（中黒は小さな丸で描く）だけ変わり、一致率なし。本家の既定は従来どおり', async () => {
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const base = { code: 'HYCT', typeName: '深識者', element: '水', weapon: '法器', mirrorName: 'アイノ', mirrorElement: '水' };
  const miniTree = buildOgpCardTree({ ...base, nation: 'ナド・クライ', match: '', mirrorLabel: '私のキャラクター', brand: '元素診断 MINI' }, { part: 'overlay', baseUrl: 'data:,' });
  const mini = texts(miniTree).join('|');
  assert.match(mini, /私のキャラクター/);
  assert.match(mini, /\|ナド\|クライ\|/); // タグ：「ナド」丸「クライ」
  assert.match(mini, /元素診断 MINI — 私の結果は【水 × 法器 × ナド\|クライ】/); // 下帯も同じ
  assert.doesNotMatch(mini, /・|一致/); // 中黒の文字は描かない（同梱フォントに無い）
  const dots = JSON.stringify(miniTree).match(/"borderRadius":999,"background":"[^"]+","margin"/g) || [];
  assert.equal(dots.length, 2);
  const main = texts(buildOgpCardTree({ ...base, nation: 'ナドクライ', match: '80' }, { part: 'overlay', baseUrl: 'data:,' })).join('|');
  assert.match(main, /最も近しいキャラクター/);
  assert.match(main, /\|ナドクライ\|/);
  assert.match(main, /\|元素診断 — 私の結果は【水 × 法器 × ナドクライ】/);
  assert.match(main, /%一致/);
  // 画像の関数：Mini の国家はナド・クライで渡す
  assert.match(read('api/og-image.mjs'), /nation: u\.nat === 'ナドクライ' \? 'ナド・クライ' : u\.nat/);
});

test('画像のフォント：Mini で新しく描く文字は、同梱フォントに収録済みの文字だけ', async () => {
  const D = await imp('api/_og-data.mjs');
  // docs/ogp-fonts.md：収録文字＝元素・武器・国家・タイプ名・キャラクター名・カードの固定文言・数字・英大文字
  const covered = new Set([...Object.keys(D.ELEMENT_CODE), ...Object.keys(D.WEAPON_CODE), ...D.PACK_NATIONS, ...Object.values(D.TYPE_NAME).flatMap(Object.values),
    ...D.CHAR_NAMES, '最も近しいキャラクター', '元素診断 — 私の結果は【】×', '元素診断 — MY RESULT', '0123456789%一致', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '].join(''));
  for (const s of ['私のキャラクター', '元素診断 MINI']) for (const ch of s) assert.ok(covered.has(ch), `「${ch}」（${s}）`);
});

test('結果画面のシェア：Xの大きなボタン1つ（m3 のシェア URL・人物名入り・数値なし）。画像保存・人物選び・2人比較は無い', () => {
  const html = read('resonance.html');
  assert.equal((html.match(/id="tweetShareBtn"/g) || []).length, 1);
  assert.match(html, /class="xshare" id="tweetShareBtn"/);
  assert.match(html, /'\/api\/share\?m3=' \+ code/);
  assert.match(html, /S\.packReveal\(r\.element, r\.weapon, r\.nation, CHAR_INDEX\[name\]\)/);
  assert.match(html, /https:\/\/twitter\.com\/intent\/tweet\?text=/);
  assert.match(html, /#共鳴診断 #元素診断 #' \+ r\.person\.name/);
  // 削除した機能：画像保存・人物を選ぶ工程（候補一覧・五十音・名前検索・選ばない）・2人比較・タイプ解説へのリンク・50:50 の接続
  assert.doesNotMatch(html, /saveImgBtn|share-canvas-el|画像を保存/);
  assert.doesNotMatch(html, /charSearch|charList|kana-row|選ばない|ResonanceCandidates|type_reading_chars/);
  assert.doesNotMatch(html, /SELF IMAGE|アナタが選んだ人物|あなたの申告/);
  assert.doesNotMatch(html, /rTypeLink|このタイプの解説を読む/);
  assert.doesNotMatch(html, /eti_mini_manual_v1|manualResult/);
  assert.doesNotMatch(html, /%一致|一 致|matchPct|最も近しいキャラクター/);
});

test('配信：共鳴診断のシェアの JS は公開ビルドに入る', () => {
  const B = require('../scripts/build-public.js');
  for (const f of ['js/eti_mini_share.js', 'resonance.html', 'assets/ogp/ogp-top-20261009.jpg']) assert.ok(B.PUBLIC_FILES.includes(f), f);
  assert.ok(!B.PUBLIC_FILES.includes('js/resonance_candidates.js'));
  assert.ok(!fs.existsSync(path.join(ROOT, 'js/resonance_candidates.js')));
  assert.ok(B.PUBLIC_DIRS.some((d) => d.dir === 'assets/ogp/backgrounds' && d.ext === '.jpg')); // 登場演出の元素の円（正式背景）
  assert.ok(!B.PUBLIC_FILES.includes('mini.html'));
});
