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

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const el = searchParams.get('el') || '風';
  const w = searchParams.get('w') || '法器';
  const nat = searchParams.get('nat') || 'モンド';
  const charName = searchParams.get('char') || '';
  const match = searchParams.get('match') || '';

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

  const dotColors = ['#c9a860', '#8fd0ec', '#d0a0f0', '#9cd070'];
  const dotPos = [[150,140],[380,120],[140,400],[380,420]];
  const dotSizes = [26, 20, 30, 22];

  const dots = dotPos.map(([x, y], i) =>
    h('div', {
      style: abs({
        top: y, left: x, width: dotSizes[i], height: dotSizes[i], borderRadius: '50%',
        border: `2.5px solid ${dotColors[i]}`, background: `${dotColors[i]}30`,
      }),
    })
  );

  return new ImageResponse(
    h('div', {
      style: {
        width: '1200px', height: '630px', display: 'flex',
        background: `radial-gradient(ellipse 70% 90% at 78% 45%, ${pal.glow} 0%, transparent 55%), #07060c`,
        position: 'relative', fontFamily: fonts.length ? 'Noto Sans JP' : 'sans-serif',
      },
    },
      h('div', { style: abs({ top: 44, left: 64, fontSize: 20, letterSpacing: 4, color: '#c9a860' }) }, '元素診断 — MY RESULT'),
      h('div', { style: abs({ top: 96, left: 60, fontSize: 150, fontWeight: 800, color: pal.text, lineHeight: 1 }) }, code),
      h('div', { style: abs({ top: 270, left: 64, fontSize: 52, fontWeight: 700, color: '#f4eefc' }) }, typeName),

      h('div', { style: abs({ top: 346, left: 64, gap: 10 }) },
        h('div', { style: { display: 'flex', fontSize: 19, padding: '8px 18px', borderRadius: 20, border: `1.5px solid ${pal.main}`, color: pal.text, background: pal.glow } }, el),
        h('div', { style: { display: 'flex', fontSize: 19, padding: '8px 18px', borderRadius: 20, border: `1.5px solid ${pal.main}`, color: pal.text, background: pal.glow } }, w),
        h('div', { style: { display: 'flex', fontSize: 19, padding: '8px 18px', borderRadius: 20, border: '1.5px solid #c9a860', color: '#e0c890', background: '#c9a86020' } }, nat),
      ),

      charName ? h('div', {
        style: abs({
          bottom: 44, left: 64, width: 640, padding: '20px 26px', borderRadius: 14,
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
        h('div', {
          style: abs({
            top: 155, left: 100, width: 280, height: 280, borderRadius: '50%',
            border: `1.5px solid ${pal.main}`, opacity: 0.5,
          }),
        }),
        h('div', {
          style: abs({
            top: 195, left: 140, width: 200, height: 200, borderRadius: '50%',
            background: `${pal.main}30`, border: `2px solid ${pal.text}`,
          }),
        }),
        ...dots,
      ),
    ),
    { width: 1200, height: 630, fonts }
  );
}
