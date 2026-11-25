// lib/jagan-og-card.mjs — 邪眼診断（DTI）の共有カード（1200×630）の組み立て。api/jagan-og.mjs が ImageResponse で描く。
//   ・ETI の結果カード（額縁・左に主結果・右に紋様）の情報整理を踏まえ、黒・深い赤・控えめな金で作る。
//   ・左：「邪眼診断 — MY RESULT」と DTI、主見出し「水 × 依存」、コードと漢字三文字の呼び名、邪眼／異相のラベル、
//     下段の枠にあなたのファトゥスと一致度（人物を保留した結果は枠ごと省く）。
//   ・右：暗い赤の光、邪眼を思わせるオリジナルの幾何学模様、微細な星屑（画像ファイルは使わない）。
//   ・値は parseOg（許可された ID から解決した名前）だけ。null なら汎用カード。
import { ELEMENT_COLOR, ISOU_COLOR, CHARACTER_ELEMENTS } from '../jagan/site-copy.mjs';

// あなたのファトゥスの2色（完了ページの人物名のグラデーション characterGradient と同じ決め方）
export function fatuiStops(id) {
  const els = CHARACTER_ELEMENTS[id] || [];
  if (els.length >= 2) return [ELEMENT_COLOR[els[0]].main, ELEMENT_COLOR[els[1]].main];
  if (els.length === 1) return [ELEMENT_COLOR[els[0]].main, '#F4E6EA'];
  return ['#E2C08C', '#C8405C'];
}

const GOLD = '#D8B878', GOLD_DIM = '#B08A6A', TEXT = '#F4E6EA', SUB = '#BFA8B0';
const h = (type, style, children, extra = {}) => ({ type, props: { style, children, ...extra } });

// 弧を描く曲線の四芒星
const sparkle = (x, y, r, fill, op = 1) => `<path d="M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z" fill="${fill}" opacity="${op}"/>`;

// eye：中央の目（内側の輪・瞳・光）の2色。あなたのファトゥスの色にする（人物を保留した結果・汎用カードは従来の色）
export function ornamentSvg(accent = '#A52A43', eye = null) {
  const e0 = eye ? eye[0] : accent, e1 = eye ? eye[1] : accent;
  const S = 560, c = S / 2;
  let seed = 20261104;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const dust = Array.from({ length: 90 }, () => `<circle cx="${(rnd() * S).toFixed(1)}" cy="${(rnd() * S).toFixed(1)}" r="${(0.5 + rnd() * 1.3).toFixed(2)}" fill="#F2D9C0" opacity="${(0.15 + rnd() * 0.55).toFixed(2)}"/>`).join('');
  const ring = Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    // 円の上の印は菱形（ユーザー指定）
    const x = c + 205 * Math.cos(a), y = c + 205 * Math.sin(a), r = i % 2 ? 7 : 9;
    return `<path d="M${x.toFixed(1)},${(y - r).toFixed(1)} L${(x + r * 0.72).toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y + r).toFixed(1)} L${(x - r * 0.72).toFixed(1)},${y.toFixed(1)}Z" fill="${i % 2 ? accent : GOLD}" opacity="${i % 2 ? 0.9 : 0.85}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#7A1A2E" stop-opacity=".55"/><stop offset="55%" stop-color="#3A0C18" stop-opacity=".35"/><stop offset="100%" stop-color="#07050A" stop-opacity="0"/></radialGradient>
      <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFE9C8" stop-opacity=".95"/><stop offset="40%" stop-color="${eye ? e0 : GOLD}" stop-opacity="${eye ? '.6' : '.45'}"/><stop offset="100%" stop-color="${eye ? e1 : GOLD}" stop-opacity="0"/></radialGradient>
      <linearGradient id="iris" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${e0}"/><stop offset="100%" stop-color="${e1}"/></linearGradient>
      <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${e0}" stop-opacity="${eye ? '.45' : '0'}"/><stop offset="100%" stop-color="${e1}" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="${c}" cy="${c}" r="${c}" fill="url(#g)"/>
    ${dust}
    <line x1="${c}" y1="18" x2="${c}" y2="${S - 18}" stroke="${GOLD}" stroke-opacity=".18"/>
    <line x1="18" y1="${c}" x2="${S - 18}" y2="${c}" stroke="${GOLD}" stroke-opacity=".12"/>
    <circle cx="${c}" cy="${c}" r="205" fill="none" stroke="${GOLD}" stroke-opacity=".38" stroke-width="1.3"/>
    <circle cx="${c}" cy="${c}" r="150" fill="none" stroke="${accent}" stroke-opacity=".45" stroke-dasharray="2 7"/>
    <circle cx="${c}" cy="${c}" r="236" fill="none" stroke="${GOLD}" stroke-opacity=".12"/>
    <path d="M${c - 150},${c} Q${c},${c - 108} ${c + 150},${c} Q${c},${c + 108} ${c - 150},${c} Z" fill="none" stroke="${GOLD}" stroke-opacity=".55" stroke-width="1.4"/>
    <circle cx="${c}" cy="${c}" r="96" fill="url(#halo)"/>
    <circle cx="${c}" cy="${c}" r="44" fill="none" stroke="url(#iris)" stroke-opacity="${eye ? '.95' : '.75'}" stroke-width="${eye ? '2.4' : '1.6'}"/>
    <ellipse cx="${c}" cy="${c}" rx="8" ry="32" fill="url(#iris)" opacity=".9"/>
    <circle cx="${c}" cy="${c}" r="70" fill="url(#core)"/>
    ${sparkle(c, c, 30, '#FFE9C8', 0.95)}
    ${ring}
  </svg>`;
}
const svgDataUri = (svg) => `data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(svg))) : Buffer.from(svg).toString('base64')}`;

function chip(text) {
  return h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 20, color: SUB, border: '1px solid rgba(216,184,120,.38)', borderRadius: 999, padding: '6px 18px', marginRight: 12 }, text);
}

export function buildCardTree(v) {
  const elColor = v ? ELEMENT_COLOR[v.elementId].main : '#C8405C';
  const isouColor = v ? ISOU_COLOR[v.isouId] : GOLD;
  const root = {
    // 背景は赤黒（青みのない黒に、深い赤の光を全体へ）
    width: 1200, height: 630, display: 'flex', position: 'relative', background: '#0D0507',
    backgroundImage: 'radial-gradient(ellipse 70% 95% at 78% 50%, rgba(150,30,54,.55) 0%, rgba(13,5,7,0) 72%), radial-gradient(ellipse 75% 85% at 18% 35%, rgba(92,16,32,.42) 0%, rgba(13,5,7,0) 75%), radial-gradient(ellipse 80% 60% at 30% 110%, rgba(120,24,44,.35) 0%, rgba(13,5,7,0) 70%)',
    fontFamily: 'JaganSerif', color: TEXT,
  };
  const eye = v && v.character ? fatuiStops(v.character.id) : null;
  const ornament = h('img', { position: 'absolute', right: 26, top: 35, width: 560, height: 560 }, undefined, { src: svgDataUri(ornamentSvg(undefined, eye)), width: 560, height: 560 });
  const frame = h('div', { position: 'absolute', left: 22, top: 22, width: 1156, height: 586, border: '1.5px solid rgba(216,184,120,.32)', borderRadius: 22, display: 'flex' }, '');
  const kicker = h('div', { display: 'flex', alignItems: 'center' }, [
    h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 20, letterSpacing: 4, color: GOLD_DIM }, '邪眼診断 — MY RESULT'),
    h('div', { display: 'flex', fontFamily: 'JaganSerif', fontSize: 16, letterSpacing: 3, color: GOLD, border: '1px solid rgba(216,184,120,.5)', borderRadius: 6, padding: '2px 10px', marginLeft: 16 }, 'DTI'),
  ]);

  if (!v) {
    return h('div', root, [ornament, frame,
      h('div', { position: 'absolute', left: 74, top: 70, width: 640, display: 'flex', flexDirection: 'column' }, [
        kicker,
        h('div', { display: 'flex', fontSize: 108, marginTop: 40, color: TEXT, letterSpacing: 8 }, '邪眼診断'),
        h('div', { display: 'flex', fontSize: 30, marginTop: 14, color: GOLD, letterSpacing: 2 }, 'Delusion Type Indicator'),
        h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 26, marginTop: 46, color: SUB }, 'あなたの願いは、どんな深淵を映すのか。'),
      ]),
    ]);
  }

  const isouSize = v.isou.length >= 4 ? 84 : 112;
  const left = h('div', { position: 'absolute', left: 74, top: 62, width: 660, display: 'flex', flexDirection: 'column' }, [
    kicker,
    h('div', { display: 'flex', alignItems: 'center', marginTop: 26 }, [
      h('div', { display: 'flex', fontSize: 112, color: elColor, lineHeight: 1.1 }, v.element),
      h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 52, color: '#7A4656', margin: '0 22px' }, '×'),
      h('div', { display: 'flex', fontSize: isouSize, color: isouColor, lineHeight: 1.1 }, v.isou),
    ]),
    h('div', { display: 'flex', alignItems: 'center', marginTop: 18 }, [
      h('div', { display: 'flex', fontSize: 46, color: GOLD, letterSpacing: 6 }, v.code),
      h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 34, color: '#6E3A4A', margin: '0 14px' }, '｜'),
      h('div', { display: 'flex', fontSize: 56, color: TEXT, letterSpacing: 8 }, v.name),
    ]),
    h('div', { display: 'flex', marginTop: 22 }, [chip(`邪眼  ${v.element}`), chip(`異相  ${v.isou}`)]),
  ]);
  const children = [ornament, frame, left];
  if (v.character) {
    const nameSize = v.character.name.length >= 6 ? 38 : 44;
    children.push(h('div', {
      position: 'absolute', left: 74, bottom: 56, width: 620, height: 118, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      border: '1px solid rgba(216,184,120,.32)', borderRadius: 16, background: 'rgba(26,8,14,.78)', padding: '0 30px',
    }, [
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 18, color: GOLD_DIM, letterSpacing: 3 }, 'あなたのファトゥス'),
        // 名前は完了ページと同じグラデーション（文字の形で切り抜く）
        h('div', { display: 'flex', fontSize: nameSize, marginTop: 6, color: 'transparent', backgroundClip: 'text',
          backgroundImage: `linear-gradient(100deg, ${fatuiStops(v.character.id)[0]} 0%, ${fatuiStops(v.character.id)[1]} 100%)` }, v.character.name),
      ]),
      h('div', { display: 'flex', alignItems: 'baseline' }, [
        h('div', { display: 'flex', fontSize: 66, color: GOLD }, String(v.character.match)),
        h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 22, color: SUB, marginLeft: 6 }, '%一致'),
      ]),
    ]));
  }
  return h('div', root, children);
}
