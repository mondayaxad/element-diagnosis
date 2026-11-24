// js/ogp-type-card.mjs
// タイプ解説ページ（/type/<code>）の OGP 画像（1200×630）の要素ツリー。
//   ・診断結果の共有カード（js/ogp-card.mjs・api/og-image）とは別物。共有カードの見た目・処理は変えない。
//   ・同じ元素別の正式背景・暗い overlay・枠・タイプコードの元素色グラデーション・配置の数値（OGP_LAYOUT）を使い、ブランドをそろえる。
//   ・個人の結果を示す表現（MY RESULT・国家・最も近しいキャラクター・一致度・「私の結果は」）は描かない。
//   ・描くのは：見出し（元素診断 — TYPE PROFILE）・タイプコード・タイプ名・元素と武器種のタグ・タイプの軸（既存の定義文）・下帯。
import { OGP_COLORS, OGP_LAYOUT as L, themeFor, codeGradient } from './ogp-theme.mjs';

function h(type, props, ...children) {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids } };
}
const box = (style, ...children) => h('div', { style: { display: 'flex', ...style } }, ...children);
const abs = (style, ...children) => box({ position: 'absolute', ...style }, ...children);

export const TYPE_CARD_HEADER = '元素診断 — TYPE PROFILE';
export const TYPE_CARD_BAND = '原神 元素診断　｜　35タイプの性格・特徴';

/**
 * @param {object} d  { code, typeName, element, weapon, axis }
 * @param {object} o  { backgroundUrl, fontSerif }
 */
export function buildTypeCardTree(d, o = {}) {
  const t = themeFor(d.element);
  const serif = o.fontSerif || 'Noto Serif JP';
  const tag = (color, border) => ({
    fontSize: L.tags.size, color, padding: `${L.tags.padY}px ${L.tags.padX}px`, borderRadius: 999,
    border: `1px solid ${border}`, background: OGP_COLORS.tagBg, letterSpacing: 2, fontFamily: serif,
  });
  return box({ width: L.width, height: L.height, position: 'relative', overflow: 'hidden', background: OGP_COLORS.base, fontFamily: serif },
    o.backgroundUrl ? h('img', { src: o.backgroundUrl, width: L.width, height: L.height, style: { position: 'absolute', top: 0, left: 0, width: L.width, height: L.height } }) : null,
    abs({ top: 0, left: 0, width: L.width, height: L.height, background: 'rgba(3,5,12,.25)' }),
    abs({ top: 0, left: 0, width: L.width, height: L.height, background: 'linear-gradient(90deg, rgba(4,6,15,.84) 0%, rgba(4,7,16,.62) 42%, rgba(5,8,18,.18) 62%, rgba(5,8,18,.10) 100%)' }),
    abs({ top: L.frameInset, left: L.frameInset, width: L.width - L.frameInset * 2, height: L.height - L.frameInset * 2,
      border: `1px solid ${OGP_COLORS.frame}`, borderRadius: 10, boxShadow: `inset 0 0 28px ${OGP_COLORS.frameGlow}` }),
    abs({ top: L.header.top, left: L.padLeft, fontSize: L.header.size, letterSpacing: L.header.tracking, color: OGP_COLORS.header }, TYPE_CARD_HEADER),
    abs({ top: L.code.top, left: L.padLeft - 6, fontSize: L.code.size, lineHeight: 1, letterSpacing: L.code.tracking, fontWeight: 700,
      color: 'transparent', backgroundImage: codeGradient(t), backgroundClip: 'text', WebkitBackgroundClip: 'text', textShadow: `0 0 26px ${t.glow}` }, d.code),
    abs({ top: L.typeName.top, left: L.padLeft, fontSize: L.typeName.size, lineHeight: 1.2, letterSpacing: 6, fontWeight: 700, color: OGP_COLORS.typeName }, d.typeName),
    abs({ top: L.tags.top, left: L.padLeft, gap: L.tags.gap },
      box(tag(t.accent, t.accent + '66'), d.element),
      box(tag(OGP_COLORS.weapon, 'rgba(195,205,220,.34)'), d.weapon),
    ),
    d.axis ? abs({ top: L.mirror.top + 18, left: L.padLeft, fontSize: 26, letterSpacing: 4, color: t.textTint }, d.axis) : null,
    abs({ left: 0, bottom: 0, width: L.width, height: L.band.height, alignItems: 'center', justifyContent: 'center',
      background: OGP_COLORS.bandBg, borderTop: '1px solid rgba(150,180,235,.14)', fontSize: 21, letterSpacing: 3, color: OGP_COLORS.bandText }, TYPE_CARD_BAND),
  );
}
