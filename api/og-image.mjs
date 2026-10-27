// api/og-image.mjs
// 診断コードから、その人専用の結果サムネイル画像を動的に生成する。
// 例: /api/og-image?el=氷&w=法器&nat=モンド&char=放浪者&match=73
//
// 注：@vercel/og の ImageResponse は、公式ドキュメントに明記されている通り
//     「Edge Runtimeでのみ動作し、Node.jsランタイムでは動作しない」ため、
//     このファイルだけは .mjs 拡張子（ESモジュール）＋ Edge Runtime を使用する。
//     （他のAPIファイルはCommonJS形式・Node.jsランタイムのまま）
//
// CPU を減らす工夫（2026-10-27。見た目と URL は従来どおり）：
//   ・タイプ（元素×武器）だけで決まる部分（背景・暗いoverlay・枠と内側の光・見出し・光彩つきのタイプコード・タイプ名・下帯の地）は
//     scripts/build-ogp-bases.mjs で35枚の下地 JPEG（assets/ogp/bases/）に事前に描いておき、実行時は人ごとの情報だけを重ねる。
//     MIRROR 欄の地・枠・内側の光も、キャラクターの元素ごとの札（7枚の透過 PNG）を事前に作っておく。
//     光彩（textShadow・inset boxShadow）の描画が CPU の大半だったため。
//   ・フォントは Google Fonts を毎回取得せず、必要な文字だけのサブセット（assets/ogp/fonts/）を関数に同梱して読む。
//   ・同じ診断結果は同じ URL（p の正規形）にそろえ、CDN に長期キャッシュさせる（同じ画像を作り直さない）。
//   ・下地が取れない時（Preview の保護など）は、従来どおり1枚をすべて描く。
import { ImageResponse } from '@vercel/og';
// 新デザイン（7元素の正式背景＋情報レイヤー）。Webプレビュー（ogp-card-demo.html）と同じ組み立てを使う。
import { buildOgpCardTree } from '../js/ogp-card.mjs';
import { ELEMENT_KEY } from '../js/ogp-theme.mjs';
import { CHAR_ELEMENT } from './_ogp-char-element.mjs';
import { ELEMENT_CODE, WEAPON_CODE, TYPE_NAME, ELEMENT_NAME, WEAPON_NAME, NATION_NAME, CHAR_NAMES, unpackShareParams, canonicalShareP } from './_og-data.mjs';

export const config = { runtime: 'edge' };

// 同じ URL は同じ画像（日時・乱数を含まない）。ブラウザ・CDN とも1年。Vercel の CDN にも明示する
const CACHE_HEADERS = {
  'cache-control': 'public, immutable, no-transform, max-age=31536000, s-maxage=31536000',
  'cdn-cache-control': 'public, max-age=31536000, immutable',
  'vercel-cdn-cache-control': 'public, max-age=31536000, immutable',
};

// 必要な文字だけの明朝（Noto Serif JP 700。SIL Open Font License）。関数に同梱し、同じ実行環境の中では読み直さない
const FONT_FILE = 'noto-serif-jp-700-og.woff';
const FONT_URL = new URL('../assets/ogp/fonts/' + FONT_FILE, import.meta.url);
let fontCache = null;
async function loadFont(origin) {
  if (fontCache) return fontCache;
  for (const u of [FONT_URL, `${origin}/assets/ogp/fonts/${FONT_FILE}`]) {
    try {
      const r = await fetch(u);
      if (r.ok) { fontCache = await r.arrayBuffer(); return fontCache; }
    } catch (e) { /* 次を試す */ }
  }
  return null;
}

async function fetchImageDataUri(url) {
  try {
    const r = await fetch(url);
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (r.ok && /^image\/(jpeg|png)$/.test(type)) return `data:${type};base64,` + toBase64(await r.arrayBuffer());
  } catch (e) { /* 取れない時は呼び出し側で代わりの描き方にする */ }
  return null;
}

export default async function handler(req) {
  const reqUrl = new URL(req.url);
  const { searchParams } = reqUrl;
  const origin = reqUrl.origin;
  let el, w, nat, charIdx, match;
  const packed = searchParams.get('p');
  if (packed !== null) {
    // 正規形でない p・余分なパラメータは、正規形の URL へ転送する（同じ結果の画像を別の URL で作り直さない）
    const canon = canonicalShareP(packed);
    if (!canon) return new Response('invalid', { status: 400, headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } });
    if (canon !== packed || [...searchParams.keys()].some((k) => k !== 'p')) {
      return new Response(null, { status: 308, headers: { Location: `${origin}/api/og-image?p=${canon}`, ...CACHE_HEADERS } });
    }
    const unpacked = unpackShareParams(packed);
    el = unpacked.el; w = unpacked.w; nat = unpacked.nat; charIdx = unpacked.charIdx; match = unpacked.match;
  } else {
    // 旧形式（後方互換）
    const elCode = searchParams.get('el') || 'AN';
    const wCode = searchParams.get('w') || 'CT';
    const natCode = searchParams.get('nat') || 'M';
    charIdx = searchParams.get('c');
    match = searchParams.get('m') || '';
    el = ELEMENT_NAME[elCode] || '風';
    w = WEAPON_NAME[wCode] || '法器';
    nat = NATION_NAME[natCode] || 'モンド';
  }
  const charName = (charIdx !== null && CHAR_NAMES[Number(charIdx)]) ? CHAR_NAMES[Number(charIdx)] : '';

  const code = (ELEMENT_CODE[el] || 'AN') + (WEAPON_CODE[w] || 'CT');
  const typeName = (TYPE_NAME[el] && TYPE_NAME[el][w]) || '';
  const matchText = (match === null || match === undefined || match === '') ? '' : String(match);
  const data = {
    code, typeName, element: el, weapon: w, nation: nat,
    mirrorName: charName,
    // キャラクター名は本人の元素色（既存キャラクターデータの element。新しい判定はしない）
    mirrorElement: CHAR_ELEMENT[charName] || el,
    match: matchText,
  };

  const font = await loadFont(origin);
  const fonts = font ? [{ name: 'Noto Serif JP', data: font, weight: 700, style: 'normal' }] : [];
  const fontOpts = { fontSerif: 'Noto Serif JP', fontSans: 'Noto Serif JP' };

  // 下地（タイプ別・事前生成）があれば、人ごとの情報だけを重ねる
  const baseUrl = await fetchImageDataUri(`${origin}/assets/ogp/bases/${code}.jpg`);
  let tree;
  if (baseUrl) {
    // MIRROR 欄の地・枠・内側の光も事前生成の札（キャラクターの元素ごと）。取れなければその場で描く
    const mirrorPlateUrl = charName ? await fetchImageDataUri(`${origin}/assets/ogp/bases/mirror-${ELEMENT_KEY[data.mirrorElement] || 'anemo'}.png`) : null;
    tree = buildOgpCardTree(data, { ...fontOpts, part: 'overlay', baseUrl, mirrorPlateUrl });
  } else {
    // 下地が取れない：従来どおり正式背景から1枚をすべて描く（背景も取れなければ SVG 円環）
    const backgroundUrl = await fetchImageDataUri(`${origin}/assets/ogp/backgrounds/${ELEMENT_KEY[el] || 'anemo'}.jpg`);
    tree = buildOgpCardTree(data, { ...fontOpts, backgroundUrl, showBackground: !!backgroundUrl });
  }
  return new ImageResponse(tree, { width: 1200, height: 630, fonts, headers: CACHE_HEADERS });
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
