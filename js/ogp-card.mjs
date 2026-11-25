// js/ogp-card.mjs
// シェアカード（1200×630）の要素ツリーを組み立てる。
// 返す形は @vercel/og（Satori）がそのまま受け取れる { type, props: { style, children } }。
// Webプレビューでは同じツリーを treeToDom() でDOMにするので、OGPとプレビューの見た目が一致する。
//
// 使える表現は Satori に合わせて限定：display:flex／absolute配置／linear・radial-gradient／
// border・borderRadius・boxShadow／backgroundClip:text／<img>（背景画像・円環SVG）。CSS filter は使わない。
import { OGP_COLORS, OGP_LAYOUT as L, themeFor, backgroundFor, getMatchStyle, codeGradient, ringSvg, svgDataUri } from './ogp-theme.mjs';

function h(type, props, ...children) {
  const kids = children.flat().filter(c => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids } };
}
const box = (style, ...children) => h('div', { style: { display: 'flex', ...style } }, ...children);
const abs = (style, ...children) => box({ position: 'absolute', ...style }, ...children);

/**
 * @param {object} d  { code, typeName, element, weapon, nation, mirrorName, mirrorElement, match }
 * @param {object} o  { origin, backgroundUrl, showBackground=true, fontSerif, fontSans, part='all', baseUrl }
 *   正式背景（元素別JPEG）には円環・ノード・中央光が描き込まれているため、背景を使う場合は
 *   円環SVGと元素光のにじみを重ねない（二重描画しない）。背景なし（fallback）のときだけSVGで描く。
 *
 *   part（OGP 生成の CPU を減らすための分割。見た目は 'all' と同じ）：
 *     'all'     … 1枚をすべて描く（Webプレビュー・下地が無い時の OGP）
 *     'base'    … 元素×武器（＝タイプ）だけで決まる部分：背景・overlay・枠と内側の光・見出し・タイプコード（光彩つき）・
 *                 タイプ名・下帯の地。scripts/build-ogp-bases.mjs が35枚の下地 JPEG として事前に作る
 *     'overlay' … 下地（o.baseUrl）の上に、人ごとに変わる部分だけを描く：元素・武器・国家のタグ・MIRROR・一致度・下帯の文
 *                 o.mirrorPlateUrl があれば、MIRROR 欄の地・枠・内側の光は事前に作った札（buildMirrorPlateTree）を置き、文字だけ描く
 *                 （全体の overflow:hidden も付けない。下地も重ねる要素も 1200×630 の内側にあり、見た目は同じ）
 */
export function buildOgpCardTree(d, o = {}) {
  const part = o.part || 'all';
  const drawPerson = part !== 'base';
  const t = themeFor(d.element);
  const charTheme = themeFor(d.mirrorElement || d.element);
  const ms = getMatchStyle(d.match);
  const serif = o.fontSerif || 'Noto Serif JP';
  const sans = o.fontSans || 'Noto Sans JP';
  const bgUrl = o.backgroundUrl || ((o.origin || '') + backgroundFor(d.element));
  const showBg = o.showBackground !== false && !!bgUrl;
  const tagStyle = (color, border) => ({
    fontSize: L.tags.size, color, padding: `${L.tags.padY}px ${L.tags.padX}px`, borderRadius: 999,
    border: `1px solid ${border}`, background: OGP_COLORS.tagBg, letterSpacing: 2, fontFamily: serif,
  });

  const bandStyle = { left: 0, bottom: 0, width: L.width, height: L.band.height, alignItems: 'center', justifyContent: 'center',
    background: OGP_COLORS.bandBg, borderTop: '1px solid rgba(150,180,235,.14)', fontSize: L.band.size, letterSpacing: 2, color: OGP_COLORS.bandText, fontFamily: serif };
  const bandText = `元素診断 — 私の結果は【${d.element} × ${d.weapon} × ${d.nation}】`;

  if (part === 'overlay') {
    // 下地の上に人ごとの情報だけ。下帯は地と線を下地に任せ、同じ箱（線は透明で幅を保つ）に文字だけ置く
    return box({ width: L.width, height: L.height, position: 'relative', background: OGP_COLORS.base, fontFamily: sans },
      h('img', { src: o.baseUrl, width: L.width, height: L.height, style: { position: 'absolute', top: 0, left: 0, width: L.width, height: L.height } }),
      d.mirrorName && o.mirrorPlateUrl ? h('img', { src: o.mirrorPlateUrl, width: L.mirror.width, height: L.mirror.height,
        style: { position: 'absolute', top: L.mirror.top, left: L.padLeft, width: L.mirror.width, height: L.mirror.height } }) : null,
      ...personLayers(),
      abs({ ...bandStyle, background: 'transparent', borderTop: '1px solid rgba(0,0,0,0)' }, bandText),
    );
  }

  // 人ごとに変わる情報（タグ・MIRROR・一致度）
  function personLayers() {
    return [
    abs({ top: L.tags.top, left: L.padLeft, gap: L.tags.gap },
      box(tagStyle(t.accent, t.accent + '66'), d.element),
      box(tagStyle(OGP_COLORS.weapon, 'rgba(195,205,220,.34)'), d.weapon),
      box(tagStyle(OGP_COLORS.nation, 'rgba(224,200,144,.40)'), d.nation),
    ),
    d.mirrorName ? abs({ top: L.mirror.top, left: L.padLeft, width: L.mirror.width, height: L.mirror.height, padding: `0 ${L.mirror.padX}px`,
      alignItems: 'center', justifyContent: 'space-between',
      // 札（事前生成）を下に置く時は、地・光を描かず、枠は透明で幅だけ保つ（文字の位置を変えない）
      ...(part === 'overlay' && o.mirrorPlateUrl ? { border: '1px solid rgba(0,0,0,0)' } : mirrorPlateStyle(charTheme)) },
      box({ flexDirection: 'column' },
        box({ fontSize: L.mirror.labelSize, letterSpacing: 3, color: OGP_COLORS.label, marginBottom: 6, fontFamily: serif }, '最も近しいキャラクター'),
        box({ fontSize: L.mirror.nameSize, fontWeight: 700, fontFamily: serif, color: charTheme.accent, letterSpacing: 2 }, d.mirrorName),
      ),
      d.match !== undefined && d.match !== '' ? box({ alignItems: 'baseline', color: ms.color, textShadow: `0 0 18px ${ms.glow}`, fontFamily: serif },
        box({ fontSize: L.mirror.matchSize, fontWeight: 700, lineHeight: 1 }, String(d.match)),
        box({ fontSize: L.mirror.unitSize, marginLeft: 6 }, '%一致'),
      ) : null,
    ) : null,
    ];
  }

  return box({ width: L.width, height: L.height, position: 'relative', overflow: 'hidden', background: OGP_COLORS.base, fontFamily: sans },
    // ---- Layer 1：背景画像（夜空・雲・霧・水面は画像の担当） ----
    showBg ? h('img', { src: bgUrl, width: L.width, height: L.height, style: { position: 'absolute', top: 0, left: 0, width: L.width, height: L.height } }) : null,
    // 明るさを落とす（filter の代わりに暗いoverlay。Satoriでも同じ見え方にするため）。
    // 右側（円環の中心付近）は 全体overlay .25 と左グラデ約 .13 で、実効の明るさ ≒ .65
    abs({ top: 0, left: 0, width: L.width, height: L.height, background: 'rgba(3,5,12,.25)' }),
    // 左の情報エリアを暗く。文字が終わる辺り（約55%）を過ぎたら急に薄くして、右の円環と中央光は背景のまま見せる
    abs({ top: 0, left: 0, width: L.width, height: L.height, background: 'linear-gradient(90deg, rgba(4,6,15,.84) 0%, rgba(4,7,16,.62) 42%, rgba(5,8,18,.18) 62%, rgba(5,8,18,.10) 100%)' }),
    // 右側：元素の光のにじみ（背景なしのfallbackのみ。正式背景には中央光が含まれる）
    showBg ? null : abs({ top: 0, left: 0, width: L.width, height: L.height, background: `radial-gradient(circle at ${L.ring.cx}px ${L.ring.cy}px, ${t.glow} 0%, rgba(0,0,0,0) 34%)` }),

    // ---- Layer 2：UI装飾（全体フレーム・円環） ----
    abs({ top: L.frameInset, left: L.frameInset, width: L.width - L.frameInset * 2, height: L.height - L.frameInset * 2,
      border: `1px solid ${OGP_COLORS.frame}`, borderRadius: 10, boxShadow: `inset 0 0 28px ${OGP_COLORS.frameGlow}` }),
    showBg ? null : h('img', { src: svgDataUri(ringSvg(t)), width: L.ring.size, height: L.ring.size,
      style: { position: 'absolute', left: L.ring.cx - L.ring.size / 2, top: L.ring.cy - L.ring.size / 2, width: L.ring.size, height: L.ring.size } }),

    // ---- Layer 3：情報 ----
    abs({ top: L.header.top, left: L.padLeft, fontSize: L.header.size, letterSpacing: L.header.tracking, color: OGP_COLORS.header, fontFamily: serif }, '元素診断 — MY RESULT'),
    abs({ top: L.code.top, left: L.padLeft - 6, fontSize: L.code.size, lineHeight: 1, letterSpacing: L.code.tracking, fontWeight: 700, fontFamily: serif,
      color: 'transparent', backgroundImage: codeGradient(t), backgroundClip: 'text', WebkitBackgroundClip: 'text',
      textShadow: `0 0 26px ${t.glow}` }, d.code),
    abs({ top: L.typeName.top, left: L.padLeft, fontSize: L.typeName.size, lineHeight: 1.2, letterSpacing: 6, fontWeight: 700, fontFamily: serif, color: OGP_COLORS.typeName }, d.typeName),
    ...(drawPerson ? personLayers() : []),
    drawPerson ? abs(bandStyle, bandText) : abs(bandStyle),
  );
}

// MIRROR 欄の地・枠・内側の光（キャラクターの元素で決まる）
function mirrorPlateStyle(charTheme) {
  return { borderRadius: 12, background: OGP_COLORS.cardBg, border: `1px solid ${charTheme.accent}40`, boxShadow: `inset 0 0 22px ${charTheme.glow}` };
}
// MIRROR 欄の札だけ（透明な地に、欄の大きさで描く）。scripts/build-ogp-bases.mjs が元素ごとに事前生成する
//   キャンバスの端に接すると Satori が内側の光を描かないため、margin の余白を付けたキャンバスに描く（作る側で欄の大きさに切り出す）
export const MIRROR_PLATE_MARGIN = 40;
export function buildMirrorPlateTree(mirrorElement) {
  const m = MIRROR_PLATE_MARGIN;
  return box({ width: L.mirror.width + m * 2, height: L.mirror.height + m * 2, position: 'relative' },
    abs({ top: m, left: m, width: L.mirror.width, height: L.mirror.height, ...mirrorPlateStyle(themeFor(mirrorElement)) }));
}

// 円環だけのツリー（確認用）
export function buildRingOnlyTree(element, size = 470) {
  const t = themeFor(element);
  return box({ width: size, height: size, background: OGP_COLORS.base, position: 'relative' },
    abs({ top: 0, left: 0, width: size, height: size, background: `radial-gradient(circle at 50% 50%, ${t.glow} 0%, rgba(0,0,0,0) 60%)` }),
    h('img', { src: svgDataUri(ringSvg(t)), width: size, height: size, style: { position: 'absolute', top: 0, left: 0, width: size, height: size } }));
}

// ---- ブラウザ専用：Satori用ツリー → DOM ----
const UNITLESS = new Set(['fontWeight', 'lineHeight', 'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink']);
export function treeToDom(node, doc = document) {
  if (node === null || node === undefined) return doc.createTextNode('');
  if (typeof node === 'string' || typeof node === 'number') return doc.createTextNode(String(node));
  const el = doc.createElement(node.type);
  const { style = {}, children, ...attrs } = node.props || {};
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const [k, v] of Object.entries(style)) {
    const prop = k === 'WebkitBackgroundClip' ? '-webkit-background-clip' : k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    el.style.setProperty(prop, typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : String(v));
  }
  if (node.type === 'div' && !style.display) el.style.display = 'flex';
  [].concat(children === undefined ? [] : children).forEach(c => el.appendChild(treeToDom(c, doc)));
  return el;
}
