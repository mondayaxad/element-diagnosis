// scripts/build-ogp-bases.mjs
// シェアカード（api/og-image）の「下地」35枚（元素7×武器5）を作る。実行時の CPU を減らすための事前生成。
//   下地＝タイプ（元素×武器）だけで決まる部分：正式背景・暗いoverlay・枠と内側の光・見出し・光彩つきのタイプコード・タイプ名・下帯の地。
//   描き方は js/ogp-card.mjs の buildOgpCardTree(part:'base') で、api/og-image と同じ Satori（@vercel/og）を使う。
//   出力：assets/ogp/bases/<タイプコード>.jpg（1200×630・JPEG）
//         assets/ogp/bases/mirror-<元素キー>.png（MIRROR 欄の地・枠・内側の光。キャラクターの元素ごと7枚・透過 PNG）
//         api/_og-font.mjs（assets/ogp/fonts/noto-serif-jp-700-og.woff を base64 で関数に同梱するモジュール）
//
// 実行（開発用。デザイン・背景・フォント・タイプ名を変えた時だけ作り直してコミットする）：
//   npm i --no-save @vercel/og@0.6.3   … まだ無い場合
//   node scripts/build-ogp-bases.mjs [--quality 90]
//   JPEG への変換には ImageMagick（convert）を使う。
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ImageResponse } from '@vercel/og';
import { buildOgpCardTree, buildMirrorPlateTree, MIRROR_PLATE_MARGIN } from '../js/ogp-card.mjs';
import { ELEMENT_KEY, OGP_LAYOUT } from '../js/ogp-theme.mjs';
import { ELEMENT_CODE, WEAPON_CODE, TYPE_NAME, PACK_ELEMENTS, PACK_WEAPONS } from '../api/_og-data.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/ogp/bases');
const qi = process.argv.indexOf('--quality');
const QUALITY = qi > 0 ? Number(process.argv[qi + 1]) : 90;
const font = fs.readFileSync(path.join(ROOT, 'assets/ogp/fonts/noto-serif-jp-700-og.woff'));
const fonts = [{ name: 'Noto Serif JP', data: font, weight: 700, style: 'normal' }];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ogp-bases-'));
fs.mkdirSync(OUT, { recursive: true });

for (const el of PACK_ELEMENTS) {
  const bg = fs.readFileSync(path.join(ROOT, `assets/ogp/backgrounds/${ELEMENT_KEY[el]}.jpg`));
  const backgroundUrl = 'data:image/jpeg;base64,' + bg.toString('base64');
  for (const w of PACK_WEAPONS) {
    const code = ELEMENT_CODE[el] + WEAPON_CODE[w];
    const tree = buildOgpCardTree({ code, typeName: TYPE_NAME[el][w], element: el, weapon: w }, {
      part: 'base', backgroundUrl, showBackground: true, fontSerif: 'Noto Serif JP', fontSans: 'Noto Serif JP',
    });
    const png = Buffer.from(await new ImageResponse(tree, { width: 1200, height: 630, fonts }).arrayBuffer());
    const pngPath = path.join(tmp, code + '.png');
    fs.writeFileSync(pngPath, png);
    const out = path.join(OUT, code + '.jpg');
    // baseline・4:4:4（色のにじみを抑える）・メタデータなし
    execFileSync('convert', [pngPath, '-strip', '-interlace', 'none', '-sampling-factor', '4:4:4', '-quality', String(QUALITY), out]);
    console.log(code, fs.statSync(out).size);
  }
}
const { width: MW, height: MH } = OGP_LAYOUT.mirror;
for (const el of PACK_ELEMENTS) {
  const m = MIRROR_PLATE_MARGIN;
  const png = Buffer.from(await new ImageResponse(buildMirrorPlateTree(el), { width: MW + m * 2, height: MH + m * 2, fonts }).arrayBuffer());
  const pngPath = path.join(tmp, `mirror-${ELEMENT_KEY[el]}.png`);
  fs.writeFileSync(pngPath, png);
  const out = path.join(OUT, `mirror-${ELEMENT_KEY[el]}.png`);
  execFileSync('convert', [pngPath, '-crop', `${MW}x${MH}+${m}+${m}`, '+repage', '-strip', `PNG32:${out}`]);
  console.log(path.basename(out), fs.statSync(out).size);
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(ROOT, 'api/_og-font.mjs'),
  '// api/_og-font.mjs（自動生成：scripts/build-ogp-bases.mjs）\n'
  + '// assets/ogp/fonts/noto-serif-jp-700-og.woff（Noto Serif JP 700 のサブセット。SIL Open Font License）を base64 で同梱したもの。\n'
  + '// 先頭が _ のファイルは Vercel の API ルートにならない。\n'
  + `export const OG_FONT_SHA256 = '${crypto.createHash('sha256').update(font).digest('hex')}';\n`
  + `export const OG_FONT_WOFF_BASE64 = '${font.toString('base64')}';\n`);
console.log('api/_og-font.mjs', font.length);
