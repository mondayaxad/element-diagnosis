// シェアカード（api/og-image）の CPU 削減（2026-10-27）の試験。
//   ・同じ診断結果は1つの URL（p の正規形）にそろえ、長期 CDN キャッシュにする
//   ・タイプ別の下地35枚・MIRROR 欄の札7枚・同梱フォントがそろっている（公開ビルドにも入る）
//   ・Google Fonts を実行時に取得しない
//   ・下地＋人ごとの情報（overlay）は、従来の1枚描き（all）と見た目が同じ（@vercel/og がある時だけ画素で比べる）
//   実行: node --test tests/og_image.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);

test('p の正規形：同じ見た目になる p は同じ文字列。範囲外は従来の既定（風・法器・モンド・キャラクターなし）に読み替える', async () => {
  const D = await imp('api/_og-data.mjs');
  const P = (el, w, nat, c, m) => ((el << 20) | (w << 17) | (nat << 14) | (c << 7) | m).toString(36);
  for (const p of [P(1, 0, 4, 10, 75), P(0, 1, 5, 0, 99), P(6, 4, 7, 117, 0), P(4, 3, 0, 127, 100)]) {
    assert.equal(D.canonicalShareP(p), p, 'share.js が作る p はそのまま');
  }
  assert.equal(D.canonicalShareP(P(1, 0, 4, 10, 75).toUpperCase()), P(1, 0, 4, 10, 75));
  assert.equal(D.canonicalShareP('000' + P(1, 0, 4, 10, 75)), P(1, 0, 4, 10, 75));
  // 範囲外の元素・武器・キャラクター番号：描かれる内容（既定）と同じ正規形へ
  assert.equal(D.canonicalShareP(P(7, 6, 3, 120, 5)), P(4, 3, 3, 127, 5));
  for (const bad of ['', 'abc!', 'x'.repeat(13), '-1']) assert.equal(D.canonicalShareP(bad), null, bad);
  // 旧形式の値から作る p も同じ正規形
  assert.equal(D.packShareParams('水', '片手剣', 'フォンテーヌ', 10, 75), P(1, 0, 4, 10, 75));
  // 正規形は、描く値が同じ
  const a = D.unpackShareParams(P(7, 6, 3, 120, 5)), b = D.unpackShareParams(P(4, 3, 3, 127, 5));
  assert.deepEqual([a.el, a.w, a.nat, D.CHAR_NAMES[a.charIdx] || '', a.match], [b.el, b.w, b.nat, D.CHAR_NAMES[b.charIdx] || '', b.match]);
});

test('og-image：Google Fonts を実行時に取得しない・同梱フォント・長期 CDN キャッシュ・正規形でなければ 308', () => {
  const src = read('api/og-image.mjs');
  assert.doesNotMatch(src, /fonts\.googleapis|fonts\.gstatic/);
  // フォントは base64 のモジュールで同梱（Edge 関数で import.meta.url 基準の読み込みが使えないため）
  assert.match(src, /import \{ OG_FONT_WOFF_BASE64 \} from '\.\/_og-font\.mjs';/);
  assert.doesNotMatch(src, /import\.meta\.url/);
  assert.match(src, /'vercel-cdn-cache-control': 'public, max-age=31536000, immutable'/);
  assert.match(src, /s-maxage=31536000/);
  assert.match(src, /status: 308/);
  assert.match(src, /'x-og-render': render/);
  // 旧形式（el・w・nat・c・m）も、p で表せる時は正規形へ転送する（順序・余分なパラメータで作り直さない）
  assert.match(src, /packShareParams\(el, w, nat, name \? CHAR_NAMES\.indexOf\(name\) : 0x7F, Number\(match\)\)/);
  assert.match(src, /export const config = \{ runtime: 'edge' \}/);
  // シェアの経路（/api/share → /api/og-image?p=）は変えない
  assert.match(read('api/share.js'), /\/api\/og-image\?p=\$\{encodeURIComponent\(packed\)\}/);
});

test('下地35枚（元素7×武器5）・MIRROR 欄の札7枚・フォントがあり、公開ビルドの対象', async () => {
  const D = await imp('api/_og-data.mjs');
  const T = await imp('js/ogp-theme.mjs');
  for (const el of D.PACK_ELEMENTS) {
    for (const w of D.PACK_WEAPONS) {
      const f = `assets/ogp/bases/${D.ELEMENT_CODE[el]}${D.WEAPON_CODE[w]}.jpg`;
      const b = fs.readFileSync(path.join(ROOT, f));
      assert.equal(b.readUInt16BE(0), 0xffd8, f + ' は JPEG');
      // 1200×630（SOF0 の高さ・幅）
      const i = b.indexOf(Buffer.from([0xff, 0xc0]));
      assert.ok(i > 0, f + ' は baseline');
      assert.deepEqual([b.readUInt16BE(i + 5), b.readUInt16BE(i + 7)], [630, 1200], f);
    }
    const png = fs.readFileSync(path.join(ROOT, `assets/ogp/bases/mirror-${T.ELEMENT_KEY[el]}.png`));
    assert.equal(png.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [T.OGP_LAYOUT.mirror.width, T.OGP_LAYOUT.mirror.height]);
  }
  assert.equal(fs.readdirSync(path.join(ROOT, 'assets/ogp/bases')).filter((n) => n.endsWith('.jpg')).length, 35);
  const font = fs.readFileSync(path.join(ROOT, 'assets/ogp/fonts/noto-serif-jp-700-og.woff'));
  assert.equal(font.toString('latin1', 0, 4), 'wOFF', 'Satori が読める WOFF（WOFF2 ではない）');
  const F = await imp('api/_og-font.mjs');
  assert.ok(Buffer.from(F.OG_FONT_WOFF_BASE64, 'base64').equals(font), '同梱のフォントは assets のフォントと同じ');
  assert.equal(F.OG_FONT_SHA256, require('crypto').createHash('sha256').update(font).digest('hex'));
  const { listPublicFiles } = require('../scripts/build-public.js');
  const files = listPublicFiles().files;
  for (const el of D.PACK_ELEMENTS) {
    for (const w of D.PACK_WEAPONS) assert.ok(files.includes(`assets/ogp/bases/${D.ELEMENT_CODE[el]}${D.WEAPON_CODE[w]}.jpg`));
    assert.ok(files.includes(`assets/ogp/bases/mirror-${T.ELEMENT_KEY[el]}.png`));
  }
});

test('カードの組み立て：all（従来の1枚描き）は人ごとの情報もすべて含み、overlay は下地の上に人ごとの情報だけ', async () => {
  const C = await imp('js/ogp-card.mjs');
  const d = { code: 'HYSW', typeName: '同調者', element: '水', weapon: '片手剣', nation: 'フォンテーヌ', mirrorName: 'イファ', mirrorElement: '風', match: '75' };
  const text = (n) => (n == null || typeof n !== 'object' ? String(n ?? '') : [].concat(n.props.children ?? []).map(text).join('|'));
  const all = text(C.buildOgpCardTree(d, { showBackground: false }));
  const base = text(C.buildOgpCardTree(d, { part: 'base', backgroundUrl: 'data:x', showBackground: true }));
  const over = text(C.buildOgpCardTree(d, { part: 'overlay', baseUrl: 'data:x', mirrorPlateUrl: 'data:y' }));
  for (const s of ['HYSW', '同調者', 'イファ', '75', 'フォンテーヌ']) assert.ok(all.includes(s), 'all ' + s);
  for (const s of ['HYSW', '同調者', 'MY RESULT']) assert.ok(base.includes(s) && !over.includes(s), 'タイプで決まる文字は下地だけ ' + s);
  for (const s of ['イファ', '75', 'フォンテーヌ', '%一致']) assert.ok(over.includes(s) && !base.includes(s), '人ごとの文字は overlay だけ ' + s);
});

// @vercel/og がある環境（scripts/build-ogp-bases.mjs を動かせる環境）だけ：従来の1枚描きと画素で比べる
let og = null;
try { require.resolve('@vercel/og', { paths: [ROOT] }); og = true; } catch (e) { og = null; }
test('画素比較：下地＋overlay と従来の1枚描きがほぼ同じ（PSNR 40dB 以上）・CPU が 1/2 以下', { skip: !og && '@vercel/og が無いため skip' }, async () => {
  const { ImageResponse } = await import('@vercel/og');
  const C = await imp('js/ogp-card.mjs');
  const T = await imp('js/ogp-theme.mjs');
  const fonts = [{ name: 'Noto Serif JP', data: fs.readFileSync(path.join(ROOT, 'assets/ogp/fonts/noto-serif-jp-700-og.woff')), weight: 700, style: 'normal' }];
  const uri = (f, t) => `data:${t};base64,` + fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const fo = { fontSerif: 'Noto Serif JP', fontSans: 'Noto Serif JP' };
  const d = { code: 'PYCM', typeName: '猛進者', element: '炎', weapon: '両手剣', nation: 'ナタ', mirrorName: 'ディルック', mirrorElement: '炎', match: '88' };
  const render = async (tree) => { const t = process.cpuUsage(); const b = Buffer.from(await new ImageResponse(tree, { width: 1200, height: 630, fonts }).arrayBuffer()); const u = process.cpuUsage(t); return { b, ms: (u.user + u.system) / 1000 }; };
  const allTree = C.buildOgpCardTree(d, { ...fo, backgroundUrl: uri('assets/ogp/backgrounds/pyro.jpg', 'image/jpeg'), showBackground: true });
  const overTree = C.buildOgpCardTree(d, { ...fo, part: 'overlay', baseUrl: uri('assets/ogp/bases/PYCM.jpg', 'image/jpeg'), mirrorPlateUrl: uri(`assets/ogp/bases/mirror-${T.ELEMENT_KEY['炎']}.png`, 'image/png') });
  await render(allTree); await render(overTree); // 初回（読み込み）を除く
  const a = await render(allTree), o = await render(overTree);
  // PNG を画素へ（node:zlib で IDAT を展開。フィルタは各行先頭の1バイト）
  const pixels = (png) => {
    const zlib = require('zlib');
    let p = 8, idat = []; let w, h, ct;
    while (p < png.length) { const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8); const data = png.subarray(p + 8, p + 8 + len); if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } if (type === 'IDAT') idat.push(data); p += 12 + len; }
    const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), stride = w * bpp;
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? out[y * stride + x - bpp] : 0, up = y ? out[(y - 1) * stride + x] : 0, ul = y && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
        let v = line[x];
        if (f === 1) v += left; else if (f === 2) v += up; else if (f === 3) v += (left + up) >> 1;
        else if (f === 4) { const pp = left + up - ul, pa = Math.abs(pp - left), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul; }
        out[y * stride + x] = v & 255;
      }
    }
    return { out, bpp };
  };
  const A = pixels(a.b), O = pixels(o.b);
  let se = 0, n = 0;
  for (let i = 0; i < A.out.length / A.bpp; i++) for (let c = 0; c < 3; c++) { const e = A.out[i * A.bpp + c] - O.out[i * O.bpp + c]; se += e * e; n++; }
  const psnr = 10 * Math.log10(255 * 255 / (se / n));
  assert.ok(psnr >= 40, 'PSNR ' + psnr.toFixed(1));
  assert.ok(o.ms <= a.ms / 2, `CPU ${o.ms.toFixed(0)}ms（従来 ${a.ms.toFixed(0)}ms）`);
});
