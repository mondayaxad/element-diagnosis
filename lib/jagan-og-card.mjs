// lib/jagan-og-card.mjs — 邪眼診断（DTI）の共有カード（1200×630）の組み立て。api/jagan-og.mjs が ImageResponse で描く。
//   ・ETI の結果カード（額縁・左に主結果・右に紋様）の情報整理を踏まえ、黒・深い赤・控えめな金で作る。
//   ・左：「邪眼診断 — MY RESULT」と DTI、主見出し「水 × 依存」、コードと漢字三文字の呼び名、邪眼／異相のラベル、
//     下段の枠に最も近しいファトゥスと一致度（人物を保留した結果は枠ごと省く）。
//   ・右：暗い赤の光、邪眼を思わせるオリジナルの幾何学模様、微細な星屑（画像ファイルは使わない）。
//   ・値は parseOg（許可された ID から解決した名前）だけ。null なら汎用カード。
import { ELEMENT_COLOR, ISOU_COLOR } from '../jagan/site-copy.mjs';

const GOLD = '#D8B878', GOLD_DIM = '#B08A6A', TEXT = '#F4E6EA', SUB = '#BFA8B0';
const h = (type, style, children, extra = {}) => ({ type, props: { style, children, ...extra } });

// 弧を描く曲線の四芒星
const sparkle = (x, y, r, fill, op = 1) => `<path d="M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z" fill="${fill}" opacity="${op}"/>`;

export function ornamentSvg(accent = '#A52A43') {
  const S = 560, c = S / 2;
  let seed = 20261104;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const dust = Array.from({ length: 90 }, () => `<circle cx="${(rnd() * S).toFixed(1)}" cy="${(rnd() * S).toFixed(1)}" r="${(0.5 + rnd() * 1.3).toFixed(2)}" fill="#F2D9C0" opacity="${(0.15 + rnd() * 0.55).toFixed(2)}"/>`).join('');
  const ring = Array.from({ length: 8 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    return sparkle(c + 205 * Math.cos(a), c + 205 * Math.sin(a), i % 2 ? 7 : 9, i % 2 ? accent : GOLD, i % 2 ? 0.9 : 0.85);
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#7A1A2E" stop-opacity=".55"/><stop offset="55%" stop-color="#3A0C18" stop-opacity=".35"/><stop offset="100%" stop-color="#07050A" stop-opacity="0"/></radialGradient>
      <radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFE9C8" stop-opacity=".95"/><stop offset="40%" stop-color="${GOLD}" stop-opacity=".45"/><stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>
    </defs>
    <circle cx="${c}" cy="${c}" r="${c}" fill="url(#g)"/>
    ${dust}
    <line x1="${c}" y1="18" x2="${c}" y2="${S - 18}" stroke="${GOLD}" stroke-opacity=".18"/>
    <line x1="18" y1="${c}" x2="${S - 18}" y2="${c}" stroke="${GOLD}" stroke-opacity=".12"/>
    <circle cx="${c}" cy="${c}" r="205" fill="none" stroke="${GOLD}" stroke-opacity=".38" stroke-width="1.3"/>
    <circle cx="${c}" cy="${c}" r="150" fill="none" stroke="${accent}" stroke-opacity=".45" stroke-dasharray="2 7"/>
    <circle cx="${c}" cy="${c}" r="236" fill="none" stroke="${GOLD}" stroke-opacity=".12"/>
    <path d="M${c - 150},${c} Q${c},${c - 108} ${c + 150},${c} Q${c},${c + 108} ${c - 150},${c} Z" fill="none" stroke="${GOLD}" stroke-opacity=".55" stroke-width="1.4"/>
    <circle cx="${c}" cy="${c}" r="44" fill="none" stroke="${accent}" stroke-opacity=".75" stroke-width="1.6"/>
    <ellipse cx="${c}" cy="${c}" rx="8" ry="32" fill="${accent}" opacity=".85"/>
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
    width: 1200, height: 630, display: 'flex', position: 'relative', background: '#07050A',
    backgroundImage: 'radial-gradient(ellipse 70% 90% at 78% 50%, rgba(122,26,46,.42) 0%, rgba(7,5,10,0) 70%), radial-gradient(ellipse 60% 60% at 10% 100%, rgba(90,20,40,.25) 0%, rgba(7,5,10,0) 70%)',
    fontFamily: 'JaganSerif', color: TEXT,
  };
  const ornament = h('img', { position: 'absolute', right: 26, top: 35, width: 560, height: 560 }, undefined, { src: svgDataUri(ornamentSvg()), width: 560, height: 560 });
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
      border: '1px solid rgba(216,184,120,.32)', borderRadius: 16, background: 'rgba(22,10,16,.78)', padding: '0 30px',
    }, [
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 18, color: GOLD_DIM, letterSpacing: 3 }, '最も近しいファトゥス'),
        h('div', { display: 'flex', fontSize: nameSize, color: TEXT, marginTop: 6 }, v.character.name),
      ]),
      h('div', { display: 'flex', alignItems: 'baseline' }, [
        h('div', { display: 'flex', fontSize: 66, color: GOLD }, String(v.character.match)),
        h('div', { display: 'flex', fontFamily: 'JaganSans', fontSize: 22, color: SUB, marginLeft: 6 }, '%一致'),
      ]),
    ]));
  }
  return h('div', root, children);
}
