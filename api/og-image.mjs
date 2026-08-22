// api/og-image.mjs
// 診断コードから、その人専用の結果サムネイル画像を動的に生成する。
// 例: /api/og-image?el=氷&w=法器&nat=モンド&char=放浪者&match=73
//
// 注：@vercel/og の ImageResponse は、公式ドキュメントに明記されている通り
//     「Edge Runtimeでのみ動作し、Node.jsランタイムでは動作しない」ため、
//     このファイルだけは .mjs 拡張子（ESモジュール）＋ Edge Runtime を使用する。
//     （他のAPIファイルはCommonJS形式・Node.jsランタイムのまま）
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// ---- 最低限必要なデータ（index.html/report.htmlと同一の定義） ----
const ELEMENT_CODE = { "炎":"PY", "水":"HY", "氷":"CR", "雷":"EL", "風":"AN", "岩":"GE", "草":"DE" };
const WEAPON_CODE = { "片手剣":"SW", "両手剣":"CM", "長柄":"PL", "法器":"CT", "弓":"BW" };
const ELEMENT_PALETTE = {
  "炎": { main:"#c84a20", text:"#f0a878", glow:"#c84a2060" },
  "水": { main:"#2a7aaa", text:"#8fd0ec", glow:"#2a7aaa60" },
  "氷": { main:"#4a80c0", text:"#a8c8ec", glow:"#4a80c060" },
  "雷": { main:"#9040d0", text:"#d0a0f0", glow:"#9040d060" },
  "風": { main:"#3a8a60", text:"#8fd8b0", glow:"#3a8a6060" },
  "岩": { main:"#a07830", text:"#e0c088", glow:"#a0783060" },
  "草": { main:"#4a8020", text:"#9cd070", glow:"#4a802060" },
};
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
const NATION_NAME = { M:"モンド", L:"璃月", I:"稲妻", S:"スメール", F:"フォンテーヌ", N:"ナタ", Z:"スネージナヤ" };
const CHAR_NAMES = ["ディルック","マーヴィカ","嘉明","ディシア","辛炎","ベネット","胡桃","香菱","トーマ","シュヴルーズ","アルレッキーノ","ニコ","煙緋","クレー","リネ","アンバー","宵宮","ドゥリン","フリーナ","ニィロウ","神里綾人","行秋","タルタリヤ","夜蘭","シグウィン","モナ","珊瑚宮心海","ヌヴィレット","コロンビーナ","ムアラニ","バーバラ","アイノ","ダリア","キャンディス","オデット","神里綾華","スカーク","七七","レイラ","ガイア","申鶴","ロサリア","ミカ","エスコフィエ","ローエン","甘雨","ディオナ","アーロイ","リオセスリ","シャルロット","シトラリ","アリョーシャ","刻晴","クロリンデ","久岐忍","雷電将軍","セノ","イアンサ","フィッシュル","九条裟羅","オロルン","セトス","八重神子","リサ","ヴァレサ","レザー","北斗","ドリー","楓原万葉","ジン","リネット","ファルカ","早柚","ウェンティ","チャスカ","ファルザン","ヤフォダ","スクロース","放浪者","閑雲","藍硯","鹿野院平蔵","夢見月瑞希","イファ","プルーネ","鍾離","イルーガ","カチーナ","雲菫","ナヴィア","荒瀧一斗","ノエル","アルベド","茲白","千織","シロネン","ゴロー","リンネア","凝光","ナヒーダ","白朮","ラウマ","ネフェル","ティナリ","コレイ","アルハイゼン","綺良々","カーヴェ","キィニチ","エミリエ","ヨォーヨ","サンドローネ","魈","エウルア","重雲","フレミネ","フリンズ","イネファ"];

// URL短縮版：5値を1つの整数にビット単位で詰め込んだ「p」パラメータのデコード
const PACK_ELEMENTS = ["炎","水","氷","雷","風","岩","草"];
const PACK_WEAPONS = ["片手剣","両手剣","長柄","法器","弓"];
const PACK_NATIONS = ["モンド","璃月","稲妻","スメール","フォンテーヌ","ナタ","スネージナヤ"];
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

  const pal = ELEMENT_PALETTE[el] || ELEMENT_PALETTE['風'];
  const code = (ELEMENT_CODE[el] || 'AN') + (WEAPON_CODE[w] || 'CT');
  const typeName = (TYPE_NAME[el] && TYPE_NAME[el][w]) || '';

  // ---- 日本語フォントの読み込み（表示する文字だけをサブセット取得し、軽量化する） ----
  const labelText = '元素診断—MYRESULT最も近しいキャラクター%一致';
  const allText = Array.from(new Set((el + w + nat + typeName + charName + labelText + code + (match||'')).split(''))).join('');
  let fonts = [];
  try {
    // 重要：Satoriは TTF/OTF/WOFF のみ対応し、WOFF2は非対応。
    // Google Fontsは通常WOFF2を返すため、古いブラウザ（WOFF2非対応）を装う
    // User-Agentを送ることで、TTF形式のURLを強制的に取得する。
    const cssRes = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(allText)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko' } }
    );
    const css = await cssRes.text();
    const fontUrlMatch = css.match(/src: url\(([^)]+)\)/);
    if (fontUrlMatch) {
      const fontRes = await fetch(fontUrlMatch[1]);
      const fontData = await fontRes.arrayBuffer();
      fonts = [{ name: 'Noto Sans JP', data: fontData, weight: 700, style: 'normal' }];
    }
  } catch (e) {
    // フォント取得に失敗しても、画像自体は生成を続ける（文字化けする可能性はあるが真っ白は避ける）
  }

  // h() は React.createElement 相当のヘルパー。JSXを使わずSatoriが認識できる形にする。
  function h(type, props, ...children) {
    return { type, props: { ...props, children: children.length === 1 ? children[0] : children } };
  }
  const abs = (extra) => ({ position: 'absolute', display: 'flex', ...extra });

  const ELEMENTS_ORDER = ["炎", "水", "氷", "雷", "風", "岩", "草"];
  const centerX = 260, centerY = 275, R = 190;

  // レポート画面の「SEVEN NATIONS COMPASS」と同じ構造：
  // 円の外周に7要素を等間隔で配置し、中心から線で結ぶ。実際の元素だけを一回り大きく光らせる。
  const nodePos = ELEMENTS_ORDER.map((e, i) => {
    const ang = (i / 7) * 2 * Math.PI - Math.PI / 2;
    return { el: e, x: centerX + R * Math.cos(ang), y: centerY + R * Math.sin(ang) };
  });

  const lines = nodePos.map(({ x, y }) => {
    const dx = x - centerX, dy = y - centerY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return h('div', {
      style: abs({
        top: centerY, left: centerX, width: length, height: 1,
        background: `linear-gradient(90deg, #4a3d7090, #4a3d7010)`,
        transform: `rotate(${angle}deg)`, transformOrigin: '0 0',
      }),
    });
  });

  const nodes = nodePos.map(({ el: nodeEl, x, y }) => {
    const isActive = nodeEl === el;
    const nodeColor = (ELEMENT_PALETTE[nodeEl] || ELEMENT_PALETTE['風']).main;
    const size = isActive ? 26 : 14;
    return h('div', {
      style: abs({
        top: y - size / 2, left: x - size / 2, width: size, height: size, borderRadius: '50%',
        background: isActive ? nodeColor : '#3a3050',
        border: isActive ? `2.5px solid #ffffffc0` : `1.5px solid ${nodeColor}80`,
      }),
    });
  });

  return new ImageResponse(
    h('div', {
      style: {
        width: '1200px', height: '630px', display: 'flex',
        backgroundColor: '#07060c',
        backgroundImage: `radial-gradient(ellipse 70% 90% at 78% 45%, ${pal.glow} 0%, transparent 55%)`,
        position: 'relative', fontFamily: fonts.length ? 'Noto Sans JP' : 'sans-serif',
      },
    },
      h('div', { style: abs({ top: 44, left: 64, fontSize: 20, letterSpacing: 4, color: '#c9a860' }) }, '元素診断 — MY RESULT'),
      h('div', { style: abs({ top: 96, left: 60, fontSize: 150, fontWeight: 800, color: pal.text, lineHeight: 1 }) }, code),
      h('div', { style: abs({ top: 270, left: 64, alignItems: 'baseline', gap: 16 }) },
        h('div', { style: { display: 'flex', fontSize: 52, fontWeight: 700, color: '#f4eefc' } }, typeName),
        h('div', { style: { display: 'flex', fontSize: 17, padding: '6px 15px', borderRadius: 18, border: `1.5px solid ${pal.main}`, color: pal.text, background: pal.glow } }, el),
        h('div', { style: { display: 'flex', fontSize: 17, padding: '6px 15px', borderRadius: 18, border: `1.5px solid ${pal.main}`, color: pal.text, background: pal.glow } }, w),
        h('div', { style: { display: 'flex', fontSize: 17, padding: '6px 15px', borderRadius: 18, border: '1.5px solid #c9a860', color: '#e0c890', background: '#c9a86020' } }, nat),
      ),

      charName ? h('div', {
        style: abs({
          top: 366, left: 64, width: 640, padding: '20px 26px', borderRadius: 14,
          border: `1.5px solid ${pal.main}`, background: `linear-gradient(135deg, ${pal.glow}, #100e1a)`,
          alignItems: 'center', justifyContent: 'space-between',
        }),
      },
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          h('div', { style: { display: 'flex', fontSize: 15, letterSpacing: 2, color: '#8870b0', marginBottom: 6 } }, '最も近しいキャラクター'),
          h('div', { style: { display: 'flex', fontSize: 42, fontWeight: 700, color: pal.text } }, charName),
        ),
        match ? h('div', { style: { display: 'flex', alignItems: 'baseline', fontSize: 56, fontWeight: 800, color: '#f4eefc' } },
          h('span', {}, match), h('span', { style: { display: 'flex', fontSize: 26, marginLeft: 4 } }, '%一致')
        ) : h('div', { style: { display: 'none' } }),
      ) : h('div', { style: { display: 'none' } }),

      h('div', { style: abs({ top: 0, right: 0, width: 480, height: 630 }) },
        // 外周の円環（レポート画面と同じ、7ノードの位置に合わせた半径）
        h('div', {
          style: abs({
            top: centerY - R, left: centerX - R, width: R * 2, height: R * 2, borderRadius: '50%',
            border: `1px solid #4a3d70`, opacity: 0.5,
          }),
        }),
        ...lines,
        ...nodes,
        h('div', {
          style: abs({
            top: centerY + R + 26, left: centerX - 140, width: 280, justifyContent: 'center',
            fontSize: 12, letterSpacing: 3, color: pal.text, opacity: 0.85,
          }),
        }, 'ELEMENTAL RESONANCE MAP'),
      ),
    ),
    { width: 1200, height: 630, fonts }
  );
}
