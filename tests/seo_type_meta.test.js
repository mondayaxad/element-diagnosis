// タイプ解説35ページのメタデータ・OGP 画像・診断への導線の回帰テスト（SEO Phase 2）。
//   ・title・description・og:title・og:description・JSON-LD の description が、決めた形で一致する（35件すべて異なる）
//   ・元素・武器種・タイプ名・タイプコードが既存の定義（api/_og-data.mjs）と一致する
//   ・og:image・twitter:image が assets/ogp/types/<CODE>.jpg を指し、dist に 1200×630 の JPEG（300KB 以下）がある
//   ・OGP 画像に描く文字が、同梱フォントにすべてある（欠けると生成時に外部の代替フォントを読みに行くため）
//   ・上の導線（タイプコードの直下）・末尾の既存ボタン・関連（邪眼）の計測属性と、js/type-page.js の読み込み
//   実行: node --test tests/seo_type_meta.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../scripts/build-public.js');
const P = require('../scripts/seo-policy.js');
const W = require('../scripts/woff-cmap.js');

const ROOT = path.join(__dirname, '..');
const O = P.ORIGIN;
const EK = { '炎': 'pyro', '水': 'hydro', '氷': 'cryo', '雷': 'electro', '風': 'anemo', '岩': 'geo', '草': 'dendro' };
const WK = { '片手剣': 'sword', '両手剣': 'claymore', '長柄': 'polearm', '法器': 'catalyst', '弓': 'bow' };

let DIST, DATA, CARD;
test.before(async () => {
  DIST = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ed-seo-type-')), 'dist');
  const r = B.build({ outDir: DIST });
  assert.deepEqual(r.problems, []);
  DATA = await import('../api/_og-data.mjs');
  CARD = await import('../js/ogp-type-card.mjs');
});
test.after(() => { if (DIST) fs.rmSync(path.dirname(DIST), { recursive: true, force: true }); });

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const meta = (html, attr, name) => { const m = new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`).exec(html); return m ? decode(m[1]) : null; };
function types() {
  const out = [];
  for (const el of DATA.PACK_ELEMENTS) for (const w of DATA.PACK_WEAPONS) {
    const code = DATA.ELEMENT_CODE[el] + DATA.WEAPON_CODE[w];
    out.push({ el, w, code, name: DATA.TYPE_NAME[el][w], html: fs.readFileSync(path.join(ROOT, `type/${code.toLowerCase()}.html`), 'utf8') });
  }
  return out;
}
// JPEG の寸法（SOF0〜SOF3 のマーカーから読む）
function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'JPEG ではありません');
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const marker = buf[p + 1];
    const len = buf.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
    p += 2 + len;
  }
  throw new Error('SOF がありません');
}

test('35件：元素・武器種・タイプ名・タイプコードが既存の定義（api/_og-data.mjs）と一致する', () => {
  const ts = types();
  assert.equal(ts.length, 35);
  for (const t of ts) {
    // H1 は1つだけ。文字の内容（タグを除く）が「炎×片手剣タイプ「殉愛者」」（type-v2 は見た目のため span で分けている）
    const h1s = [...t.html.matchAll(/<h1>([\s\S]*?)<\/h1>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    assert.deepEqual(h1s, [`${t.el}×${t.w}タイプ「${t.name}」`], `${t.code} の H1`);
    assert.ok(t.html.includes(`<div class="code">タイプコード：${t.code}</div>`), `${t.code} のタイプコード`);
    assert.ok(t.html.includes(`"name": "${t.el}×${t.w}「${t.name}」（${t.code}型）"`), `${t.code} の JSON-LD の name`);
  }
});

test('35件：title・description は決めた形で、og:title・og:description・JSON-LD の description と一致し、35件すべて異なる', () => {
  const titles = new Set(); const descs = new Set();
  for (const t of types()) {
    const tags = [...t.html.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((m) => m[1]);
    assert.equal(tags.length, 6, `${t.code} のタグ`);
    const title = `${t.el}×${t.w}「${t.name}」の性格・特徴｜原神 元素診断`;
    const desc = `原神の元素と武器種をモチーフにした性格診断「元素診断」（100問・無料）。${t.el}×${t.w}タイプ「${t.name}」の性格傾向（${tags[0]}・${tags[1]}・${tags[4]}）や強み、人との関わり方を解説します。`;
    assert.ok(t.html.includes(`<title>${title}</title>`), `${t.code} の title`);
    assert.equal(meta(t.html, 'name', 'description'), desc, `${t.code} の description`);
    assert.equal(meta(t.html, 'property', 'og:title'), title, `${t.code} の og:title`);
    assert.equal(meta(t.html, 'property', 'og:description'), desc, `${t.code} の og:description`);
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(t.html)[1]);
    assert.equal(ld.description, desc, `${t.code} の JSON-LD の description`);
    assert.doesNotMatch(t.html, /エニアグラム|Enneagram/, `${t.code} にエニアグラムの表記`);
    titles.add(title); descs.add(desc);
  }
  assert.equal(titles.size, 35); assert.equal(descs.size, 35);
});

test('35件：og:image・twitter:image は assets/ogp/types/<CODE>.jpg。dist に 1200×630 の JPEG（300KB 以下）がある', () => {
  const files = fs.readdirSync(path.join(DIST, 'assets/ogp/types')).filter((f) => f.endsWith('.jpg'));
  assert.equal(files.length, 35);
  for (const t of types()) {
    const url = `${O}/assets/ogp/types/${t.code}.jpg`;
    assert.equal(meta(t.html, 'property', 'og:image'), url, `${t.code} の og:image`);
    assert.equal(meta(t.html, 'name', 'twitter:image'), url, `${t.code} の twitter:image`);
    assert.equal(meta(t.html, 'property', 'og:image:width'), '1200');
    assert.equal(meta(t.html, 'property', 'og:image:height'), '630');
    assert.equal(meta(t.html, 'property', 'og:image:alt'), `元素診断 ${t.el}×${t.w}タイプ「${t.name}」（${t.code}）`);
    const buf = fs.readFileSync(path.join(DIST, `assets/ogp/types/${t.code}.jpg`));
    assert.deepEqual(jpegSize(buf), { width: 1200, height: 630 }, `${t.code}.jpg の寸法`);
    assert.ok(buf.length <= 300 * 1024, `${t.code}.jpg が 300KB を超えています（${buf.length}）`);
    assert.doesNotMatch(t.html, /thumbs\/x_card_/, `${t.code} に旧い thumbs の参照`);
  }
});

test('OGP 画像に描く文字（見出し・タイプ名・元素・武器種・軸・下帯）は、すべて同梱フォントにある', () => {
  const font = fs.readFileSync(path.join(ROOT, 'assets/ogp/fonts/noto-serif-jp-700-type.woff'));
  assert.ok(fs.existsSync(path.join(ROOT, 'assets/ogp/fonts/OFL.txt')), 'フォントのライセンス（OFL.txt）');
  for (const t of types()) {
    const axis = (/<div class="axis">([^<]+)<\/div>/.exec(t.html) || [])[1];
    assert.ok(axis, `${t.code} の軸`);
    const text = CARD.typeCardTexts({ code: t.code, typeName: t.name, element: t.el, weapon: t.w, axis }).join('');
    assert.doesNotMatch(text, /MY RESULT|私の結果/);
    assert.deepEqual(W.missingChars(font, text), [], `${t.code} の文字がフォントにありません`);
  }
});

test('35件：body にページの値。関連（邪眼）に計測の属性。js/type-page.js を1回読み込む。旧テンプレートは上の導線と末尾のボタン、type-v2 は無料診断のボタンを置かずレポートへの導線', () => {
  for (const t of types()) {
    const h = t.html;
    const v2 = h.includes('<!-- template: type-v2');
    assert.ok(h.includes(`<body data-type-code="${t.code}" data-element="${EK[t.el]}" data-weapon-type="${WK[t.w]}">`), `${t.code} の body`);
    assert.ok(h.includes(`<a href="${O}/jagan/" data-type-cta="related" data-destination="jagan_top">邪眼診断（50問・無料）</a>`), `${t.code} の関連`);
    assert.equal((h.match(/<script src="\/js\/type-page\.js" defer><\/script>/g) || []).length, 1);
    assert.equal((h.match(/<script src="\/js\/ga\.js"><\/script>/g) || []).length, 1, `${t.code} の ga.js（page_view）`);
    assert.ok(h.indexOf('/js/ga.js') < h.indexOf('/js/type-page.js'), 'ga.js の後に type-page.js');
    if (v2) {
      // type-v2（タイプ別レポートの購入が目的）：無料診断のボタンは置かず、上部はレポートの欄へ移る導線
      assert.doesNotMatch(h, /class="pre-cta"|class="cta"|data-type-cta="(top|bottom)"/, `${t.code} に無料診断のボタン`);
      assert.equal((h.match(/data-type-cta=/g) || []).length, 1);
      assert.match(h, /<a class="hero-buy" href="#report" data-preview-only hidden>/);
      assert.match(h, /\.hero-buy \{[^}]*min-height:48px/, '押せる範囲は 44px 以上');
    } else {
      const top = `<div class="code">タイプコード：${t.code}</div>\n  <a class="pre-cta" href="${O}/" data-type-cta="top" data-destination="eti_top">元素診断（100問・無料）で、あなたのタイプを確かめる<span class="arw" aria-hidden="true">→</span></a>`;
      assert.ok(h.includes(top), `${t.code} の上の導線`);
      assert.equal((h.match(/class="pre-cta"/g) || []).length, 1);
      assert.ok(h.includes(`<a class="cta" href="${O}/" data-type-cta="bottom" data-destination="eti_top">無料の元素診断で、あなたのタイプを確かめる</a>`), `${t.code} の末尾のボタン`);
      assert.equal((h.match(/data-type-cta=/g) || []).length, 3);
      assert.match(h, /\.pre-cta \{[^}]*min-height:44px/, '押せる範囲は 44px 以上');
    }
  }
});
