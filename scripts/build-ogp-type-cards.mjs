// scripts/build-ogp-type-cards.mjs
// タイプ解説ページ（type/<code>.html）の OGP 画像を作る（元素7×武器5＝35枚）。
//   描き方は js/ogp-type-card.mjs（診断結果の共有カードとは別。共有カードの下地 assets/ogp/bases/ は触らない）。
//   出力：assets/ogp/types/<タイプコード>.jpg（1200×630・JPEG）
//   タイプ名・元素・武器種は api/_og-data.mjs、タイプの軸（「一閃の宿命 × 独力で断つ型」など）は type/<code>.html の .axis から読む。
//
// 実行（開発用）：
//   npm i --no-save @vercel/og@0.6.3   … まだ無い場合
//   node scripts/build-ogp-type-cards.mjs [--only ELCM,PYCM,HYPL] [--out <dir>] [--quality 88]
//   JPEG への変換には ImageMagick（convert）を使う。
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ImageResponse } from '@vercel/og';
import { createRequire } from 'module';
import { buildTypeCardTree, typeCardTexts } from '../js/ogp-type-card.mjs';
import { ELEMENT_KEY } from '../js/ogp-theme.mjs';
import { ELEMENT_CODE, WEAPON_CODE, TYPE_NAME, PACK_ELEMENTS, PACK_WEAPONS } from '../api/_og-data.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const OUT = path.resolve(arg('--out') || path.join(ROOT, 'assets/ogp/types'));
const ONLY = arg('--only') ? new Set(arg('--only').split(',')) : null;
const QUALITY = Number(arg('--quality') || 88);
// フォント：Noto Serif JP 700 のサブセット（SIL Open Font License）。カードに出る文字（見出し・下帯・35のタイプ名・軸・元素・武器種・英数字）だけを含む。
//   共有カード用のサブセット（noto-serif-jp-700-og.woff）には軸の文字が無いため別に持つ。文字が欠けると @vercel/og が外部から代替フォントを
//   読みに行き、結果が環境で変わるため、タイプ名・軸・見出しを変えた時は Google Fonts の text= 指定で取り直す。
const font = fs.readFileSync(path.join(ROOT, 'assets/ogp/fonts/noto-serif-jp-700-type.woff'));
const fonts = [{ name: 'Noto Serif JP', data: font, weight: 700, style: 'normal' }];
const { missingChars } = createRequire(import.meta.url)('./woff-cmap.js');
// 外部への通信を禁止する（文字が欠けた時に @vercel/og が代替フォントを取りに行くと、結果が環境で変わるため。欠けていれば下で止める）
globalThis.fetch = async (u) => { throw new Error(`外部への通信は禁止（${u}）。フォントに無い文字がある可能性`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ogp-types-'));
fs.mkdirSync(OUT, { recursive: true });

for (const el of PACK_ELEMENTS) {
  const bg = fs.readFileSync(path.join(ROOT, `assets/ogp/backgrounds/${ELEMENT_KEY[el]}.jpg`));
  const backgroundUrl = 'data:image/jpeg;base64,' + bg.toString('base64');
  for (const w of PACK_WEAPONS) {
    const code = ELEMENT_CODE[el] + WEAPON_CODE[w];
    if (ONLY && !ONLY.has(code)) continue;
    const html = fs.readFileSync(path.join(ROOT, `type/${code.toLowerCase()}.html`), 'utf8');
    const axis = (/<div class="axis">([^<]+)<\/div>/.exec(html) || [])[1] || '';
    const d = { code, typeName: TYPE_NAME[el][w], element: el, weapon: w, axis };
    const miss = missingChars(font, typeCardTexts(d).join(''));
    if (miss.length) throw new Error(`${code}: 同梱フォントに無い文字 ${miss.join('')}（Google Fonts の text= 指定でフォントを取り直す。docs/seo/OGP_TYPE_CARDS.md）`);
    const tree = buildTypeCardTree(d, { backgroundUrl, fontSerif: 'Noto Serif JP' });
    const png = Buffer.from(await new ImageResponse(tree, { width: 1200, height: 630, fonts }).arrayBuffer());
    const pngPath = path.join(tmp, code + '.png');
    fs.writeFileSync(pngPath, png);
    const out = path.join(OUT, code + '.jpg');
    execFileSync('convert', [pngPath, '-strip', '-interlace', 'none', '-sampling-factor', '4:4:4', '-quality', String(QUALITY), out]);
    console.log(code, fs.statSync(out).size, axis);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
