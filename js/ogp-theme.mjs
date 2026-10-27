// js/ogp-theme.mjs
// OGP / シェアカードの「見た目の正本」。Webプレビュー（ogp-card-demo.html）と
// OGP生成（api/og-image.mjs、@vercel/og = Satori）の両方から import して、色・レイアウト・円環を共有する。
//
// 役割分担（崩さない）：
//   背景（夜空・雲・霧・水面）＝ 画像アセット（assets/ogp/backgrounds/*.webp）
//   UI装飾（枠・細線・円環・ノード・中央の元素光の輪郭）＝ ここで生成する SVG / CSS
//   情報（ETI・タイプ名・元素・武器・国家・MIRROR・一致度・シェア文）＝ 呼び出し側が動的に流し込む
//
// Satoriの制約に合わせて、ここで使う表現は flex レイアウト・linear/radial-gradient・
// 単純なSVG（circle/line/path/radialGradient）に限定している。CSS filter は使わない（明るさはoverlayで調整）。

// ---- 7元素テーマ（差分はすべてここに集約する） ----
export const OGP_ELEMENT_THEME = {
  hydro:   { label: '水', accent: '#8fd8ff', accentSoft: '#bfe9ff', glow: 'rgba(90,180,255,.22)',  textTint: '#d8f1ff', motif: 'ripple' },
  pyro:    { label: '炎', accent: '#ff9774', accentSoft: '#ffc2ae', glow: 'rgba(255,100,75,.20)',  textTint: '#ffe0d6', motif: 'orb' },
  anemo:   { label: '風', accent: '#7ddcc3', accentSoft: '#b8eee0', glow: 'rgba(95,215,185,.18)',  textTint: '#d8f5ed', motif: 'orb' },
  electro: { label: '雷', accent: '#bb8cff', accentSoft: '#ddc5ff', glow: 'rgba(165,105,255,.20)', textTint: '#eee1ff', motif: 'orb' },
  dendro:  { label: '草', accent: '#8fcf7a', accentSoft: '#c6eab9', glow: 'rgba(125,195,95,.18)',  textTint: '#e0f2d8', motif: 'orb' },
  cryo:    { label: '氷', accent: '#a9ddff', accentSoft: '#dbf1ff', glow: 'rgba(150,215,255,.20)', textTint: '#ebf8ff', motif: 'orb' },
  geo:     { label: '岩', accent: '#d7ad68', accentSoft: '#ecd4a7', glow: 'rgba(210,165,90,.18)',  textTint: '#f4e6c7', motif: 'orb' },
};
// 既存データ（元素は日本語1文字で保存されている）からテーマキーへ
export const ELEMENT_KEY = { '水': 'hydro', '炎': 'pyro', '風': 'anemo', '雷': 'electro', '草': 'dendro', '氷': 'cryo', '岩': 'geo' };
export function themeFor(elementLabel) {
  const key = ELEMENT_KEY[elementLabel] || 'hydro';
  return { key, ...OGP_ELEMENT_THEME[key] };
}

// ---- 正式背景（元素ごと）。夜空・雲・水面・円環・ノード・中央光はすべて画像に含まれる ----
// @vercel/og 0.6.3 は WebP を描画できないため JPEG（baseline）。キーは OGP_ELEMENT_THEME と同じ。
export const OGP_BACKGROUND = {
  pyro: '/assets/ogp/backgrounds/pyro.jpg',
  hydro: '/assets/ogp/backgrounds/hydro.jpg',
  electro: '/assets/ogp/backgrounds/electro.jpg',
  cryo: '/assets/ogp/backgrounds/cryo.jpg',
  anemo: '/assets/ogp/backgrounds/anemo.jpg',
  dendro: '/assets/ogp/backgrounds/dendro.jpg',
  geo: '/assets/ogp/backgrounds/geo.jpg',
};
export function backgroundFor(elementLabel) {
  return OGP_BACKGROUND[ELEMENT_KEY[elementLabel]] || OGP_BACKGROUND.hydro;
}

// ---- 円環上の7元素の位置（正本・固定。並べ替え・自動再配置はしない） ----
// 12時：炎 ／ 10時：草 ／ 8時：岩 ／ 7時：風 ／ 5時：雷 ／ 4時：氷 ／ 2時：水
// ※ 正式背景の画像ではノードの実位置はおおよそ 2時=1.9・4時=3.5・8時=8.5 付近（画像の作図どおり）。
export const OGP_NODE_CLOCK = { pyro: 12, dendro: 10, geo: 8, anemo: 7, electro: 5, cryo: 4, hydro: 2 };

// ---- 固定色（元素に依存しない） ----
export const OGP_COLORS = {
  base: '#05070f',            // 背景画像の下地（画像が無いときもこの色）
  frame: 'rgba(150,180,235,.22)',
  frameGlow: 'rgba(110,140,220,.10)',
  header: '#dccb9e',          // 「元素診断 — MY RESULT」淡い金〜暖白
  typeName: '#eef3ff',        // タイプ名：白〜淡い青白
  weapon: '#c3cddc',          // 武器タグ：青灰〜銀
  nation: '#e0c890',          // 国家タグ：淡い金
  tagBg: 'rgba(7,11,24,.62)',
  label: '#9fb0cc',           // MIRROR見出し
  cardBg: 'rgba(6,9,20,.64)',
  bandBg: 'rgba(3,5,12,.74)', // 下部シェア文の帯
  bandText: '#f2f5ff',
  ringBase: '#1a2440',        // 消灯ノード
};

// ---- 一致度：数値の高さで明るさを変える ----
export function getMatchStyle(match) {
  const m = Number(match);
  if (m >= 90) return { color: '#fff1bd', glow: 'rgba(255,225,150,.26)' };
  if (m >= 80) return { color: '#f4dda0', glow: 'rgba(245,210,120,.18)' };
  if (m >= 70) return { color: '#dbc78d', glow: 'rgba(220,190,115,.12)' };
  return { color: '#aab6c9', glow: 'rgba(165,180,205,.08)' };
}

// ---- ETIコードの文字色：4文字とも元素色が分かる、白を混ぜた元素色のグラデーション ----
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
export function mixWithWhite(hex, colorRatio) {
  const [r, g, b] = hexToRgb(hex);
  const k = colorRatio;
  const to = c => Math.round(255 * (1 - k) + c * k).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
// 4文字すべてに元素色が乗るよう、左端から白を薄く混ぜた元素色で始め、右へ向かって元素色を深める
// （白だけの区間を作らない。元素色 35% → 60% → 80%。純色100%にはしない）
// 氷だけは水（淡い水色→水色）と区別するため、白寄り・低彩度の「白青→淡い氷青」にする
const CODE_GRADIENT_OVERRIDE = {
  cryo: { base: '#b3cde2', mix: [0.22, 0.45, 0.68] },  // 彩度を一段落とした氷青をベースに、白を多めに混ぜる
};
export function codeGradient(theme) {
  const o = CODE_GRADIENT_OVERRIDE[theme.key];
  const base = o ? o.base : theme.accent;
  const [m0, m1, m2] = o ? o.mix : [0.35, 0.60, 0.80];
  return `linear-gradient(90deg, ${mixWithWhite(base, m0)} 0%, ${mixWithWhite(base, m1)} 50%, ${mixWithWhite(base, m2)} 100%)`;
}

// ---- レイアウト（1200×630。Webプレビューとサトリで同じ数値を使う） ----
export const OGP_LAYOUT = {
  width: 1200, height: 630,
  frameInset: 14,
  padLeft: 66,
  header: { top: 52, size: 18, tracking: 5 },
  code: { top: 80, size: 142, tracking: 4 },
  typeName: { top: 238, size: 56 },
  tags: { top: 326, size: 19, gap: 12, padX: 18, padY: 7 },
  mirror: { top: 396, width: 590, height: 118, padX: 28, labelSize: 15, nameSize: 42, matchSize: 56, unitSize: 22 },
  band: { height: 62, size: 23 },
  ring: { cx: 930, cy: 282, size: 470 },   // 右側の円環（中心座標とSVGの一辺）
};

// ---- 右側の円環（SVG文字列）。背景は描かない：円・ノード・軸・線・中央の元素光だけ ----
export function ringSvg(theme, opts = {}) {
  const S = OGP_LAYOUT.ring.size, c = S / 2;
  const R = 196, r2 = 128, r3 = 162;
  const a = theme.accent, s = theme.accentSoft;
  const parts = [];
  parts.push(`<defs>
    <radialGradient id="core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="18%" stop-color="${s}" stop-opacity="0.75"/>
      <stop offset="45%" stop-color="${a}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${a}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${a}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${a}" stop-opacity="0"/>
    </radialGradient>
  </defs>`);
  // 円環のごく淡い内側の空気
  parts.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="url(#halo)"/>`);
  // 縦横の軸（外周より少し外まで）と、微細な補助線（斜め45°・短い目盛り）
  parts.push(`<line x1="${c - R - 18}" y1="${c}" x2="${c + R + 18}" y2="${c}" stroke="${a}" stroke-opacity="0.16" stroke-width="1"/>`);
  parts.push(`<line x1="${c}" y1="${c - R - 18}" x2="${c}" y2="${c + R + 18}" stroke="${a}" stroke-opacity="0.16" stroke-width="1"/>`);
  for (const deg of [45, 135]) {
    const rad = deg * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
    parts.push(`<line x1="${c - dx * r2}" y1="${c - dy * r2}" x2="${c + dx * r2}" y2="${c + dy * r2}" stroke="${a}" stroke-opacity="0.07" stroke-width="1"/>`);
  }
  for (let i = 0; i < 72; i++) {
    const ang = i * 5 * Math.PI / 180, long = i % 6 === 0;
    const r0 = R + 4, r1 = R + (long ? 11 : 7);
    parts.push(`<line x1="${c + Math.cos(ang) * r0}" y1="${c + Math.sin(ang) * r0}" x2="${c + Math.cos(ang) * r1}" y2="${c + Math.sin(ang) * r1}" stroke="${a}" stroke-opacity="${long ? 0.30 : 0.12}" stroke-width="1"/>`);
  }
  // 外周円・中間の破線円・内側円
  parts.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${a}" stroke-opacity="0.34" stroke-width="1.2"/>`);
  parts.push(`<circle cx="${c}" cy="${c}" r="${r3}" fill="none" stroke="${a}" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="2 6"/>`);
  parts.push(`<circle cx="${c}" cy="${c}" r="${r2}" fill="none" stroke="${a}" stroke-opacity="0.22" stroke-width="1"/>`);
  // 外周ノード：正本の7元素配置。該当元素だけ強く点灯し、他は淡い青白〜ごく弱い紫の低輝度
  for (const [key, hour] of Object.entries(OGP_NODE_CLOCK)) {
    const ang = (hour % 12) / 12 * 2 * Math.PI - Math.PI / 2;
    const x = c + Math.cos(ang) * R, y = c + Math.sin(ang) * R;
    if (key === theme.key) {
      parts.push(`<circle cx="${x}" cy="${y}" r="13" fill="${a}" fill-opacity="0.20"/>`);
      parts.push(`<circle cx="${x}" cy="${y}" r="6" fill="${s}" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1"/>`);
    } else {
      parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="#b9c6ee" fill-opacity="0.22" stroke="#c8c0f0" stroke-opacity="0.35" stroke-width="1"/>`);
    }
  }
  // 中央の元素光（輪郭はSVG。光そのものは radialGradient の淡い光）
  parts.push(motifSvg(theme, c));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${parts.join('')}</svg>`;
}

// 元素ごとの中央モチーフ。まず水（静かな渦・波紋）だけ作り、他元素は共通の光球で仮置き。
function motifSvg(theme, c) {
  const a = theme.accent, s = theme.accentSoft;
  const glow = `<circle cx="${c}" cy="${c}" r="86" fill="url(#core)"/>`;
  if (theme.motif === 'ripple') {
    // 波紋：中心から少しずつ間隔の開く同心の輪（外ほど淡い）＋ 静かな渦の2本の弧
    const rings = [[18, 0.65], [30, 0.42], [44, 0.26], [60, 0.14], [78, 0.07]]
      .map(([r, o]) => `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s}" stroke-opacity="${o}" stroke-width="1"/>`).join('');
    // 静かな渦：中心から外へゆっくり開く2本の螺旋（180°ずらし、外側ほど淡く見えるよう細く）
    const spiral = (phase, op) => {
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const th = (i / 64) * Math.PI * 2.1;
        const r = 14 + th * 7.2;
        pts.push(`${(c + Math.cos(th + phase) * r).toFixed(1)} ${(c + Math.sin(th + phase) * r * 0.82).toFixed(1)}`);
      }
      return `<path d="M ${pts.join(' L ')}" fill="none" stroke="${s}" stroke-opacity="${op}" stroke-width="1" stroke-linecap="round"/>`;
    };
    const swirl = spiral(0, 0.42) + spiral(Math.PI, 0.30);
    const core = `<circle cx="${c}" cy="${c}" r="6" fill="#ffffff" fill-opacity="0.95"/><circle cx="${c}" cy="${c}" r="12" fill="${s}" fill-opacity="0.35"/>`;
    return glow + rings + swirl + core;
  }
  return glow + `<circle cx="${c}" cy="${c}" r="34" fill="none" stroke="${s}" stroke-opacity="0.4" stroke-width="1"/>` +
    `<circle cx="${c}" cy="${c}" r="7" fill="#ffffff" fill-opacity="0.9"/>`;
}

// SVG文字列 → <img src> 用の data URI（Satori・ブラウザ共通）
export function svgDataUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
