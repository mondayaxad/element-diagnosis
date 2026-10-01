// api/og-image.mjs
// 診断コードから、その人専用の結果サムネイル画像を動的に生成する。
// 例: /api/og-image?el=氷&w=法器&nat=モンド&char=放浪者&match=73
//
// 注：@vercel/og の ImageResponse は、公式ドキュメントに明記されている通り
//     「Edge Runtimeでのみ動作し、Node.jsランタイムでは動作しない」ため、
//     このファイルだけは .mjs 拡張子（ESモジュール）＋ Edge Runtime を使用する。
//     （他のAPIファイルはCommonJS形式・Node.jsランタイムのまま）
import { ImageResponse } from '@vercel/og';
// 新デザイン（7元素の正式背景＋情報レイヤー）。Webプレビュー（ogp-card-demo.html）と同じ組み立てを使う。
import { buildOgpCardTree } from '../js/ogp-card.mjs';
import { ELEMENT_KEY } from '../js/ogp-theme.mjs';
import { CHAR_ELEMENT } from './_ogp-char-element.mjs';

export const config = { runtime: 'edge' };

// ---- 最低限必要なデータ（index.html/report.htmlと同一の定義） ----
const ELEMENT_CODE = { "炎":"PY", "水":"HY", "氷":"CR", "雷":"EL", "風":"AN", "岩":"GE", "草":"DE" };
const WEAPON_CODE = { "片手剣":"SW", "両手剣":"CM", "長柄":"PL", "法器":"CT", "弓":"BW" };
const TYPE_NAME = {
  "炎": { "片手剣":"殉愛者", "両手剣":"猛進者", "長柄":"殉衛者", "法器":"信奉者", "弓":"貫徹者" },
  "水": { "片手剣":"同調者", "両手剣":"孤淵者", "長柄":"静衛者", "法器":"深識者", "弓":"静観者" },
  "氷": { "片手剣":"宿縁者", "両手剣":"破氷者", "長柄":"氷壁者", "法器":"透徹者", "弓":"凍眼者" },
  "雷": { "片手剣":"共鳴者", "両手剣":"破天者", "長柄":"雷衛者", "法器":"電導者", "弓":"疾光者" },
  "風": { "片手剣":"随風者", "両手剣":"疾風者", "長柄":"客衛者", "法器":"漂識者", "弓":"追風者" },
  "岩": { "片手剣":"包容者", "両手剣":"破岩者", "長柄":"護衛者", "法器":"礎識者", "弓":"遠護者" },
  "草": { "片手剣":"縁結者", "両手剣":"芽吹者", "長柄":"育衛者", "法器":"叡結者", "弓":"見守者" },
};
// URL短縮のため、シェア元（index.html）からはコード・インデックスで渡される。ここで日本語に復元する。
const ELEMENT_NAME = { PY:"炎", HY:"水", CR:"氷", EL:"雷", AN:"風", GE:"岩", DE:"草" };
const WEAPON_NAME = { SW:"片手剣", CM:"両手剣", PL:"長柄", CT:"法器", BW:"弓" };
const NATION_NAME = { M:"モンド", L:"璃月", I:"稲妻", S:"スメール", F:"フォンテーヌ", N:"ナタ", Z:"スネージナヤ", D:"ナドクライ" };
const CHAR_NAMES = ["ディルック","マーヴィカ","嘉明","ディシア","辛炎","ベネット","胡桃","香菱","トーマ","シュヴルーズ","アルレッキーノ","ニコ","煙緋","クレー","リネ","アンバー","宵宮","ドゥリン","フリーナ","ニィロウ","神里綾人","行秋","タルタリヤ","夜蘭","シグウィン","モナ","珊瑚宮心海","ヌヴィレット","コロンビーナ","ムアラニ","バーバラ","アイノ","ダリア","キャンディス","オデット","神里綾華","スカーク","七七","レイラ","ガイア","申鶴","ロサリア","ミカ","エスコフィエ","ローエン","甘雨","ディオナ","アーロイ","リオセスリ","シャルロット","シトラリ","アリョーシャ","刻晴","クロリンデ","久岐忍","雷電将軍","セノ","イアンサ","フィッシュル","九条裟羅","オロルン","セトス","八重神子","リサ","ヴァレサ","レザー","北斗","ドリー","楓原万葉","ジン","リネット","ファルカ","早柚","ウェンティ","チャスカ","ファルザン","ヤフォダ","スクロース","放浪者","閑雲","藍硯","鹿野院平蔵","夢見月瑞希","イファ","プルーネ","鍾離","イルーガ","カチーナ","雲菫","ナヴィア","荒瀧一斗","ノエル","アルベド","茲白","千織","シロネン","ゴロー","リンネア","凝光","ナヒーダ","白朮","ラウマ","ネフェル","ティナリ","コレイ","アルハイゼン","綺良々","カーヴェ","キィニチ","エミリエ","ヨォーヨ","サンドローネ","魈","エウルア","重雲","フレミネ","フリンズ","イネファ"];

// URL短縮版：5値を1つの整数にビット単位で詰め込んだ「p」パラメータのデコード
const PACK_ELEMENTS = ["炎","水","氷","雷","風","岩","草"];
const PACK_WEAPONS = ["片手剣","両手剣","長柄","法器","弓"];
const PACK_NATIONS = ["モンド","璃月","稲妻","スメール","フォンテーヌ","ナタ","スネージナヤ","ナドクライ"];
function unpackShareParams(p) {
  const n = parseInt(p, 36);
  if (isNaN(n)) return null;
  const elI = (n >> 20) & 0x7;
  const wI = (n >> 17) & 0x7;
  const natI = (n >> 14) & 0x7;
  const cI = (n >> 7) & 0x7F;
  const mI = n & 0x7F;
  return {
    el: PACK_ELEMENTS[elI] || '風',
    w: PACK_WEAPONS[wI] || '法器',
    nat: PACK_NATIONS[natI] || 'モンド',
    charIdx: cI,
    match: mI,
  };
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  let el, w, nat, charIdx, match;
  const packed = searchParams.get('p');
  if (packed) {
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

  // ---- 日本語フォント（表示する文字だけをサブセット取得。Satori は TTF/OTF/WOFF のみ対応） ----
  const labelText = '元素診断—MYRESULT最も近しいキャラクター%一致私の結果は【】×';
  const allText = Array.from(new Set((labelText + code + typeName + el + w + nat + charName + matchText + '0123456789').split(''))).join('');
  const fonts = [];
  for (const [family, name] of [['Noto+Serif+JP', 'Noto Serif JP'], ['Noto+Sans+JP', 'Noto Sans JP']]) {
    try {
      // 古いブラウザを装って WOFF2 ではなく TTF の URL を返させる（既存実装と同じ方法）
      const cssRes = await fetch(
        `https://fonts.googleapis.com/css2?family=${family}:wght@700&text=${encodeURIComponent(allText)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko' } }
      );
      const css = await cssRes.text();
      const fontUrlMatch = css.match(/src: url\(([^)]+)\)/);
      if (fontUrlMatch) {
        const fontRes = await fetch(fontUrlMatch[1]);
        fonts.push({ name, data: await fontRes.arrayBuffer(), weight: 700, style: 'normal' });
      }
    } catch (e) {
      // フォント取得に失敗しても画像生成は続ける（真っ白は避ける）
    }
  }

  // ---- 背景：主結果の元素の正式背景（JPEG。@vercel/og は WebP 非対応）。取得できなければ背景なし（SVG円環）で描く ----
  const origin = new URL(req.url).origin;
  const bgKey = ELEMENT_KEY[el] || 'anemo';
  let backgroundUrl = null;
  try {
    const bgRes = await fetch(`${origin}/assets/ogp/backgrounds/${bgKey}.jpg`);
    if (bgRes.ok && (bgRes.headers.get('content-type') || '').includes('image')) {
      backgroundUrl = 'data:image/jpeg;base64,' + toBase64(await bgRes.arrayBuffer());
    }
  } catch (e) {
    // 背景が取れない場合（Previewの保護など）も、情報と円環だけで生成を続ける
  }

  return new ImageResponse(
    buildOgpCardTree(data, {
      backgroundUrl,
      showBackground: !!backgroundUrl,
      fontSerif: fonts.some(f => f.name === 'Noto Serif JP') ? 'Noto Serif JP' : (fonts[0] ? fonts[0].name : 'sans-serif'),
      fontSans: fonts.some(f => f.name === 'Noto Sans JP') ? 'Noto Sans JP' : (fonts[0] ? fonts[0].name : 'sans-serif'),
    }),
    { width: 1200, height: 630, fonts }
  );
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
