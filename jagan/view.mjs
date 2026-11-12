// jagan/view.mjs — 邪眼診断の表示（HTML 文字列を返す純粋な関数。ブラウザとテストで共通）。
//   ・数値は computeDiagnosis の結果（保存時のスナップショット）だけから作る。例示の人物名・数値で穴埋めしない。
//   ・人物の物語（作品の描写）と、利用者の数値が参照に近い項目（explainCharacter）を分けて書く。
//   ・無料の結果では 12 特性の数値を出さない（傾向の言葉だけ）。数値・項目別の読み解きはレポート（ロックの先）。
import { explainCharacter, shareTextFromSummary } from './engine/runtime.mjs';
import {
  ELEMENT_COLOR, NEUTRAL_COLOR, ELEMENT_NAME, ISOU_COLOR, ELEMENT_TEXT, ISOU_TEXT, ISOU_SHORT, ELEMENT_STORY, TRAIT_COPY, GROUPS, GROUP_OF,
  CHARACTER_ELEMENTS, CHARACTER_COPY, METHOD, METHOD_KEYS, BALANCE_NOTE, CHARACTER_GLOBAL_NOTICE, CHARACTER_NO_ALIGNED, CHARACTER_NO_DIFFERENT, traitBandText, TRAIT_BAND, bandOf, FATUI_PORTRAIT,
} from './site-copy.mjs';

export { shareTextFromSummary };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jaList = (xs) => xs.join('・');
const PRICE_LABEL = '¥1,000';
const traitLabel = (bundle, id) => (bundle.items.traits.find((t) => t.id === id) || {}).label || id;
const level = (s) => (s >= 60 ? '高め' : s <= 40 ? '控えめ' : '中程度');
const lockSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor"/></svg>';
const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function elementStyle(id) {
  const c = ELEMENT_COLOR[id] || NEUTRAL_COLOR;
  return `--ec:${c.main};--ed:${c.dark};--eg:${c.glow}`;
}
export function characterGradient(id) {
  const els = CHARACTER_ELEMENTS[id] || [];
  const stops = els.length >= 2 ? [ELEMENT_COLOR[els[0]].main, ELEMENT_COLOR[els[1]].main]
    : els.length === 1 ? [ELEMENT_COLOR[els[0]].main, '#F4E6EA'] : ['#E2C08C', '#C8405C'];
  return `linear-gradient(100deg, ${stops[0]} 0%, ${stops[1]} 100%)`;
}
// 人物名のグラデーション。印刷（PDF）では背景の切り抜きに細い枠が出るため、文字ごとに色を補間した版に差し替える（完全解析と同じ）
export function gradNameHtml(id, name) {
  const m = characterGradient(id).match(/#[0-9A-Fa-f]{6}/g) || ['#E2C08C', '#C8405C'];
  const ch = [...String(name)], n = Math.max(1, ch.length - 1);
  const pr = ch.map((c, i) => `<span style="color:color-mix(in srgb, ${m[0]} ${Math.round(100 - (100 * i) / n)}%, ${m[1] || m[0]})">${esc(c)}</span>`).join('');
  return `<b class="rx-grad" style="background-image:${characterGradient(id)}">${esc(name)}</b><b class="rx-grad-p" aria-hidden="true">${pr}</b>`;
}
// 弧を描く曲線の四芒星（菱形の辺を内側へ反らせた形）。中心(x,y)・半径 r
export function sparklePath(x, y, r) {
  return `M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z`;
}

// 邪眼元素の判定に最も寄与した特性（重みが最大のもの）
export function topContribution(result, bundle) {
  if (!result.element.id) return null;
  const def = bundle.core.elements.find((e) => e.id === result.element.id);
  const [axis] = Object.entries(def.weights).sort((a, b) => b[1] - a[1])[0];
  return { axis, label: traitLabel(bundle, axis), score: result.traits[axis].displayScore };
}

// 鍵マークの言葉：特性の名前（単語一語）。50点から遠い順。数値は出さない。色は土台のカテゴリ別。groupId を渡すとその土台の特性だけ
export function tendencyWords(result, bundle, groupId, n) {
  const ids = groupId ? GROUPS.find((g) => g.id === groupId).traits : bundle.items.traits.map((t) => t.id);
  return ids.map((id) => ({ id, s: result.traits[id].score }))
    .sort((a, b) => Math.abs(b.s - 50) - Math.abs(a.s - 50) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((x) => ({ word: traitLabel(bundle, x.id), color: traitShade(x.id) }));
}
// 鍵マークの色：領域の色を基に、4つの特性で色相と明るさを少しずつずらした同系色（同じ領域の4つが同じ色にならないように）
const SHADE_STEPS = [[-16, 4], [-5, 12], [6, -4], [17, 8]]; // [色相のずれ（度）, 明るさのずれ（%）]
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
export function traitShade(id) {
  const g = GROUPS.find((x) => x.id === GROUP_OF[id]);
  const [h, s, l] = hexToHsl(g.color); const [dh, dl] = SHADE_STEPS[g.traits.indexOf(id)] || [0, 0];
  return `hsl(${Math.round((h + dh + 360) % 360)} ${Math.round(Math.min(90, s + 6))}% ${Math.round(Math.max(38, Math.min(76, l + dl)))}%)`;
}

function locks(words) {
  return `<div class="rx-locks">${words.map((w) => `<div class="rx-lock" style="--lc:${w.color}"><span class="rx-lock-ring">${lockSvg}</span><span class="rx-lock-word">${esc(w.word)}</span></div>`).join('')}</div>`;
}
// 各領域の鍵：領域の4特性を全員同じに並べるのではなく、あなたの回答で目立つ特性だけを並べる。
//   目立つ＝高め（60以上）。上位2つが同じくらいなら2位も含める。高めが無い時は中ほど（41〜59）の上位2つ、それも無い時は最も高い1つ。
//   4つに満たない時は、目立つ特性に連なる漢字2〜3字の言葉を、強い特性から順に足して4つにする（特性と同じ色・同じ見た目）
const RELATED_WORDS = {
  ANX: ['憂慮', '予兆', '緊張'], SEP: ['愛着', '渇望', '寂寥'], SUS: ['警戒', '洞察', '防壁'], WDR: ['孤高', '内省', '静寂'],
  IMP: ['即断', '瞬発', '奔流'], RSK: ['挑戦', '冒険', '昂揚'], PSV: ['執念', '信念', '継続'], PRF: ['美学', '精緻', '規律'],
  HOS: ['反骨', '闘志', '憤怒'], ATT: ['光彩', '主張', '演出'], MAN: ['策略', '掌握', '誘導'], CAL: ['冷静', '合理', '達観'],
};
// 4つとも控えめな領域：控えめな側を表す漢字の言葉
const CALM_WORDS = { ANX: '平静', SEP: '自立', SUS: '信頼', WDR: '社交', IMP: '熟慮', RSK: '慎重', PSV: '柔軟', PRF: '寛容', HOS: '温和', ATT: '謙虚', MAN: '率直', CAL: '共感' };
export function prominentTraits(result, g) {
  const ts = g.traits.map((id) => ({ id, s: result.traits[id].score })).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  const hi = ts.filter((x) => x.s >= 60);
  // 上位2つが同じくらい（差が10以内・2位も中ほど以上）の時は、2位も目立つ特性に含める（2つ＋それぞれに1語ずつ）
  if (hi.length === 1 && ts[1].s > 40 && ts[0].s - ts[1].s <= 10) return ts.slice(0, 2);
  if (hi.length) return hi;
  const mid = ts.filter((x) => x.s > 40);
  return mid.length ? mid.slice(0, 2) : ts.slice(0, 1);
}
export function groupLockWords(result, bundle, g, n = 4) {
  const top = prominentTraits(result, g).slice(0, n);
  // 領域の4つがすべて控えめ：控えめな側の言葉（穏やかな見通し など）を、控えめな順に並べる
  if (top.length === 1 && top[0].s <= 40) {
    return g.traits.map((id) => ({ id, s: result.traits[id].score })).sort((a, b) => a.s - b.s || a.id.localeCompare(b.id)).slice(0, n)
      .map((x) => ({ word: CALM_WORDS[x.id], color: traitShade(x.id) }));
  }
  const words = top.map((x) => ({ word: traitLabel(bundle, x.id), color: traitShade(x.id) }));
  // 足す言葉の色：同じ領域でまだ使っていない特性の色（同系色で、4つが同じ色にならないように）
  const spare = g.traits.filter((id) => !top.some((x) => x.id === id)).map(traitShade);
  for (let i = 0; words.length < n && i < 3; i++) {
    for (const x of top) { if (words.length < n) words.push({ word: RELATED_WORDS[x.id][i], color: spare.shift() || traitShade(x.id), related: true }); }
  }
  return words;
}
// ロック解除の案内。背景には、その人の実際のレポートの該当部分をモザイク（ぼかし）で敷く（元素診断と同じ見せ方）。
//   ぼかした部分は読み上げ・操作の対象から外す（aria-hidden・inert）。2位以下の人物名は伏せる。
function unlockCard(text, previewTitle, previewHtml, color = '#C8405C') {
  return `<div class="rx-unlock">
      <span class="rx-unlock-icon">${lockSvg}</span>
      <p class="rx-unlock-title">今すぐロックを解除</p>
      <p class="rx-unlock-text">${esc(text)}</p>
      <p class="rx-unlock-price">${PRICE_LABEL}</p>
      <button type="button" class="rx-buy" data-buy disabled aria-disabled="true">全てのロックを解除する<small>準備中</small></button>
      <div class="rx-preview" style="--pc:${color}">
        <p class="rx-preview-head" aria-hidden="true">レポートより — <b>${esc(previewTitle)}</b></p>
        <div class="rx-mosaic" aria-hidden="true" inert>${previewHtml}</div>
        <button type="button" class="rx-preview-btn" data-buy disabled aria-disabled="true">${lockSvg}今すぐロックを解除</button>
      </div>
    </div>`;
}
// ぼかし背景に敷く値は、その人の実際の得点ではなく固定の見本値（HTML から本人の結果を読み取れないように）。
//   文章（特性の説明・人物の物語）は誰にでも同じ公開の文言。人物の一致度も固定値。
export const PREVIEW_SCORES = Object.freeze({ ANX: 68, SEP: 74, SUS: 57, WDR: 46, IMP: 38, PSV: 61, PRF: 66, HOS: 33, ATT: 42, MAN: 49, RSK: 27, CAL: 35 });
export const PREVIEW_MATCH = 72;
function previewResult(bundle) {
  return { traits: Object.fromEntries(bundle.items.traits.map((t) => [t.id, { id: t.id, label: t.label, score: PREVIEW_SCORES[t.id], displayScore: PREVIEW_SCORES[t.id] }])) };
}
// 4〜6特性のレーダー（レポートのぼかし背景用）
function radar(result, bundle, ids, color) {
  const n = ids.length, R = 70, cx = 100, cy = 100;
  const pt = (i, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const ring = (f) => ids.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = ids.map((id, i) => pt(i, R * Math.max(0.04, result.traits[id].score / 100)).map((v) => v.toFixed(1)).join(',')).join(' ');
  // 4文字の特性名（危険志向など）が枠外で見切れないよう、左右の名前は外向きに揃え、描画範囲も左右に広げる
  return `<svg class="rp-radar" viewBox="-36 -4 272 208">${[1, 0.66, 0.33].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="rgba(255,255,255,.08)"/>`).join('')}
    <polygon points="${poly}" fill="${color}" fill-opacity=".28" stroke="${color}"/>
    ${ids.map((id, i) => { const [x, y] = pt(i, R + 12); const anchor = x > cx + 4 ? 'start' : x < cx - 4 ? 'end' : 'middle'; return `<text x="${x.toFixed(1)}" y="${(y + (Math.abs(x - cx) < 4 ? (y < cy ? -4 : 4) : 0)).toFixed(1)}" text-anchor="${anchor}">${esc(traitLabel(bundle, id))}</text>`; }).join('')}</svg>`;
}

// 解析レポートの「近しいファトゥス」：あなたの回答を軸に、人物の物語の姿を重ねる（自分を重ねて読めるように。守りの注記は書かない）
function fatuiOverlapHtml(result, bundle, id, name) {
  const ex = explainCharacter(result, bundle, id);
  const portrait = FATUI_PORTRAIT[id] || {};
  const lab = (x) => `<b style="color:${traitShade(x.axis)}">「${esc(traitLabel(bundle, x.axis))}」</b>（${Math.round(x.userScore)}）`;
  const near = ex.aligned.length ? ex.aligned : ex.rows.slice().sort((a, b) => a.difference - b.difference).slice(0, 1);
  const rest = ex.rows.filter((x) => !near.includes(x));
  const lines = near.map((x) => `あなたの${lab(x)}は、${esc(name)}が${esc(portrait[x.axis] || '')}姿と、同じ向きに表れています。`);
  for (const x of rest) {
    const word = TRAIT_COPY[x.axis][x.userScore > 40 ? 'hi' : 'lo'];
    lines.push(`${lab(x)}には、あなたらしい<b style="color:${traitShade(x.axis)}">${esc(word)}</b>が出ています。${esc(name)}が${esc(portrait[x.axis] || '')}姿を、あなた自身の${esc(word)}と重ねて読んでみてください。`);
  }
  return lines.map((t) => `<p class="rp-text sm">${t}</p>`).join('');
}
function groupPreview(_result, bundle, g) {
  const p = previewResult(bundle);
  return radar(p, bundle, g.traits, g.color) + g.traits.map((id) => traitBar(p, id, g.color)).join('');
}
function characterPreview(result, bundle) {
  const ch = { id: result.character.id, name: result.character.name, match: PREVIEW_MATCH };
  const copy = CHARACTER_COPY[ch.id];
  return `<div class="rp-match"><p class="rp-match-h"><b>${esc(ch.name)}</b><em>${ch.match}%</em></p>
      <p class="rp-text sm">${esc(copy.story_context)}</p>
      ${fatuiOverlapHtml(previewResult(bundle), bundle, ch.id, ch.name)}
      <p class="rp-q">${esc(copy.reflection)}</p></div>`;
}
function constellation(color, label) {
  const pts = [[100, 22], [168, 62], [160, 140], [100, 176], [40, 140], [32, 62]];
  return `<div class="rx-figure" aria-hidden="true"><svg viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(200,64,92,.18)"/>
      <circle cx="100" cy="100" r="54" fill="none" stroke="rgba(200,64,92,.14)" stroke-dasharray="2 5"/>
      ${pts.map(([x, y]) => `<line x1="100" y1="100" x2="${x}" y2="${y}" stroke="rgba(220,110,135,.28)"/>`).join('')}
      <polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="rgba(220,110,135,.18)"/>
      ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${color}"/>`).join('')}
      <circle cx="100" cy="100" r="7" fill="#FFE3EA"/><circle cx="100" cy="100" r="16" fill="none" stroke="rgba(255,200,215,.35)"/>
    </svg><span>${esc(label)}</span></div>`;
}

// 元素診断と同じカット入りの宝石（姉妹サイトとしての共通モチーフ）。色は邪眼の元素カラー
export function gemSvg(color, seed, ringAngle = null) {
  return `<svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <defs><linearGradient id="jgm-${seed}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="45%" stop-color="${color}"/><stop offset="100%" stop-color="${color}" stop-opacity="0.55"/></linearGradient></defs>
      ${ringAngle === null ? '' : `<ellipse cx="28" cy="28" rx="26" ry="8" fill="none" stroke="${color}" stroke-width="1.3" opacity="0.55" transform="rotate(${ringAngle} 28 28)"/><ellipse cx="28" cy="28" rx="26" ry="8" fill="none" stroke="${color}" stroke-width="0.6" stroke-dasharray="1 3" opacity="0.35" transform="rotate(${ringAngle} 28 28)"/>`}
      <g stroke="#ffffffa0" stroke-width="0.6" stroke-linejoin="round">
        <polygon points="28,10 36,20 28,24 20,20" fill="url(#jgm-${seed})"/>
        <polygon points="20,20 28,24 26,40 15,30" fill="${color}" opacity="0.88"/>
        <polygon points="36,20 28,24 30,40 41,30" fill="${color}" opacity="0.72"/>
        <polygon points="26,40 30,40 28,46" fill="${color}" opacity="0.6"/>
        <polygon points="28,10 36,20 32,17" fill="#ffffff" opacity="0.4"/>
      </g></svg>`;
}
export function heroGemsHtml() {
  const pos = [
    { top: '8%', left: '10%', size: 26, op: 0.40 }, { top: '14%', left: '82%', size: 20, op: 0.32 }, { top: '40%', left: '4%', size: 16, op: 0.26 },
    { top: '58%', left: '88%', size: 22, op: 0.34 }, { top: '78%', left: '14%', size: 18, op: 0.28 }, { top: '85%', left: '70%', size: 15, op: 0.26 },
    { top: '28%', left: '92%', size: 14, op: 0.22 },
  ];
  return Object.keys(ELEMENT_COLOR).map((id, i) => {
    const p = pos[i];
    return `<div class="jt-gem" style="top:${p.top};left:${p.left};opacity:${p.op};transform:scale(${(p.size / 56).toFixed(2)});--gc:${ELEMENT_COLOR[id].main}80">${gemSvg(ELEMENT_COLOR[id].main, 'hero' + i)}</div>`;
  }).join('');
}

// =====================================================================
// 結果ページ（元素診断の結果ページと同じ構成：土台カード→最も近しい人物→渇望する邪眼→保存・共有→
//   今見えているもの→なぜ似ているか→土台ごとの解説と鍵→全てのロックを解除）
// =====================================================================
function mainCard(result, bundle) {
  // 元素診断の「あなたの土台」と同じ並び：見出し（DTI）→ コードと名前 → 邪眼×異相 → 一行の要約 → 「もっと詳しく見る」（コードの意味・邪眼・異相の説明）
  const el = result.element, isou = result.isou, d = result.dti;
  const color = ISOU_COLOR[isou.id];
  const et = ELEMENT_TEXT[el.id], it = ISOU_TEXT[isou.id];
  const elCode = String(d.code).slice(0, 2), isCode = String(d.code).slice(2);
  const summary = `つまり<b style="color:var(--ec)">${esc(d.name)}（${esc(d.code)}）</b>は、「${esc(et.essence)}」邪眼の力が、「${esc(it.essence)}」かたちで表に現れている姿です。今回の回答に表れた姿であり、固定的な性格ではありません。`;
  return `<section class="rx-card rx-main" style="${elementStyle(el.id)}">
      <div class="rx-eye">${gemSvg(ELEMENT_COLOR[el.id].main, 'main', 20)}</div>
      <div class="rx-main-head"><span class="rx-abyss">あなたの深淵</span><span class="rx-badge">DTI</span></div>
      <p class="rx-dti"><b>${esc(d.code)}</b><span class="rx-dti-name">${esc(d.name)}</span></p>
      <h2 class="rx-title"><span class="rx-el">${esc(el.label)}</span><span class="rx-x">×</span><span class="rx-type" style="--tc:${color}">${esc(isou.label)}</span></h2>
      <p class="rx-sub">${esc(ELEMENT_NAME[el.id])} ／ ${esc(it.axis)}</p>
      <details class="rx-more-main">
        <summary>もっと詳しく見る ▾</summary>
        <div class="rx-more-body">
          <p class="rx-more-h">${esc(d.code)}（${esc(d.name)}）とは</p>
          <p class="rx-more-lead">このタイプコードは、あなたの邪眼（いくつかの特性が組み合わさった反応のまとまり）と、異相（最も目立った一つの特性）をもとに組み立てられています。二つが重なることで、あなたの深淵の輪郭が立ち上がります。</p>
          <div class="rx-codes">
            <div class="rx-code" style="--cc:var(--ec)"><b>${esc(elCode)}</b><span>${esc(el.label)}——邪眼の軸</span></div>
            <div class="rx-code" style="--cc:${color}"><b>${esc(isCode)}</b><span>${esc(isou.label)}——異相の軸</span></div>
          </div>
          <p class="rx-more-k" style="color:var(--ec)">邪眼｜${esc(el.label)}（${esc(ELEMENT_NAME[el.id])}）</p>
          <p class="rx-more-t">${esc(et.body)}</p>
          <p class="rx-more-k" style="color:${color}">異相｜${esc(isou.label)}</p>
          <p class="rx-more-t">${esc(ISOU_SHORT[isou.id])}${esc(it.body)}</p>
          <p class="rx-more-t rx-more-join">この二つが重なる時、「<b style="color:var(--ec)">${esc(d.name)}</b>」という深淵の輪郭が立ち上がります。</p>
          <blockquote class="rx-summary">${summary}</blockquote>
        </div>
      </details>
    </section>`;
}

function fatuiCard(result) {
  const ch = result.character;
  if (ch.status !== 'available') {
    return `<section class="rx-card rx-fatui"><p class="rx-kicker">あなたのファトゥス</p>
      <p class="jg-pending-block">今回の回答では、人物の比較に使える特性の差が小さく、特定の人物を示せませんでした。無理に誰かへ当てはめることはしません。</p></section>`;
  }
  return `<section class="rx-card rx-fatui">
      <p class="rx-kicker">あなたのファトゥス</p>
      <div class="rx-fatui-row">
        <div>
          <p class="rx-fatui-name${ch.name.length >= 6 ? ' is-long' : ''}" style="background-image:${characterGradient(ch.id)}">${esc(ch.name)}</p>
          <div class="rx-tags">${ch.tags.map((t) => `<span class="rx-tag rx-tag-type">${esc(t)}</span>`).join('')}<span class="rx-tag">${esc(ch.region)}</span></div>
        </div>
        <div class="rx-pct"><b>${esc(ch.match)}<small>%</small></b><span>一致度</span></div>
      </div>
    </section>`;
}

// 4. 欲求が導くあなたの影（邪眼元素の説明。専門用語を使わず、欲求・力・代償で）と、あなたの欲求特性（単語一語・カテゴリ別の色）
function desireCard(result, bundle) {
  const el = result.element;
  const top4 = result.traitRanking.slice(0, 4).map((t) => ({ word: t.label, color: GROUPS.find((g) => g.id === GROUP_OF[t.id]).color }));
  return `<section class="rx-card rx-desire" style="${elementStyle(el.id)}">
      <p class="rx-sec-h" style="--dot:var(--ec)"><i></i>欲求が導くあなたの影</p>
      <p class="rx-text">${esc(ELEMENT_STORY[el.id])}</p>
      <hr class="rx-hr">
      <p class="rx-h4">あなたの欲求特性</p>
      <p class="rx-lead">今回の回答で強く表れた4つ。読み解きはロックの先にあります。</p>
      ${locks(top4)}
      <div class="rx-legend">${GROUPS.map((g) => `<span style="--lc:${g.color}">${esc(g.short)}</span>`).join('')}</div>
    </section>`;
}

function cravingCard(result) {
  const r = result.element.ranking;
  const top = r.slice(0, 3);
  const max = Math.max(1, r[0].score);
  const lastRank = top[top.length - 1].rank;
  const more = r.slice(3).some((x) => x.rank === lastRank);
  return `<section class="rx-card">
      <p class="rx-h3">あなたの渇望する邪眼</p>
      <p class="rx-lead">強い順に並ぶ、あなたの深淵に灯る邪眼の傾向。</p>
      ${top.map((e, i) => {
        const tied = r.filter((x) => x.rank === e.rank).length > 1;
        return `<div class="rx-crave" style="${elementStyle(e.id)}">
          <p class="rx-crave-name"><span class="rx-crave-mark">${i === 0 ? '◆' : ['①', '②', '③'][i]}</span><b>${esc(e.label)}</b><span>${esc(ELEMENT_NAME[e.id])}</span>${tied ? '<em>同率</em>' : ''}</p>
          <span class="rx-crave-bar"><i style="width:${Math.max(6, (e.score / max) * 100).toFixed(1)}%"></i></span>
        </div>`;
      }).join('')}
      ${more ? '<p class="jg-note">他にも同率候補があります。</p>' : ''}
    </section>`;
}

// 元素診断と同じく、画像の保存・X シェアは人物と邪眼の順位の直後、診断記録への保存はページの最後
function shareRow() {
  return `<div class="rx-share-row">
      <button type="button" class="rx-share rx-share-img" id="imageBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>画像を保存</button>
      <button type="button" class="rx-share rx-share-x" id="shareBtn"><b>𝕏</b>でシェア</button>
    </div>`;
}
function saveCard() {
  return `<section class="rx-card rx-save">
      <p class="rx-save-k">診断記録</p>
      <p class="rx-save-text">この結果を、今のあなたの深淵として残しませんか。<br>マイページに保存すると、いつでも見返せます。</p>
      <button type="button" class="rx-save-btn" id="saveBtn">マイページに保存する</button>
      <p class="jg-status rx-status" id="actionStatus" role="status" aria-live="polite"></p>
      <p class="jg-small jg-center" id="pendingFix" hidden><button type="button" class="jg-linkbtn" id="fixAnswersBtn">回答を見直す</button></p>
    </section>`;
}

function seeingCard() {
  const open = ['邪眼元素と異相（DTIコード・呼び名）', 'あなたのファトゥス1名', '欲求が導くあなたの影'];
  const locked = ['12特性のスコアと、それぞれの読み解き', ...GROUPS.map((g) => `${g.short}（4特性）の詳細`), '近しいファトゥス3名との共通点・相違点', '判定根拠（なぜその組み合わせになったか）'];
  return `<section class="rx-card rx-seeing">
      <p class="rx-seeing-k">今、あなたが見ているもの</p>
      <ul>${open.map((t) => `<li class="on"><span>${checkSvg}</span>${esc(t)}</li>`).join('')}${locked.map((t) => `<li><span class="lk">${lockSvg}</span>${esc(t)}</li>`).join('')}</ul>
      <p class="rx-seeing-foot">ここで見えているのは、あなたの一部分に過ぎません。</p>
    </section>`;
}


// 「なぜあなたは似ているか」：一致度の計算の説明ではなく、あなたの回答と人物の描写が、どの特性で、どちら向きに重なるかを具体的に言う。
//   得点（数値）は解析レポートで読む内容のため、ここでは「高め・中ほど・控えめ」の言葉で示す
const BAND_WORD = { hi: '高め', mid: '中ほど', lo: '控えめ' };
function whyText(result, bundle, ch, ex) {
  // 本人のパーソナリティを軸に、人物の物語を重ねる。人物の特性の高低を言い切らない・「重ならない」などの否定は書かない
  const name = esc(ch.name);
  const nameHtml = `<b class="rx-grad" style="background-image:${characterGradient(ch.id)}">${name}</b>`;
  const tb = (id) => `<b style="color:${traitShade(id)}">「${esc(traitLabel(bundle, id))}」</b>`;
  const pick = (ex.aligned.length ? ex.aligned : ex.rows.slice().sort((a, b) => a.difference - b.difference)).slice(0, 3);
  // 本人の回答で目立つ順（高い特性を先に）
  const rows = pick.slice().sort((a, b) => b.userScore - a.userScore);
  const strong = rows.filter((x) => bandOf(x.userScore) !== 'lo');
  const story = CHARACTER_COPY[ch.id] && CHARACTER_COPY[ch.id].story_context;
  const head = strong.length
    ? `あなたと${nameHtml}の一致度は<b>${esc(ch.match)}%</b>。あなたの回答に表れた${strong.map((x) => tb(x.axis)).join('')}が、${name}の姿と響き合っています。`
    : `あなたと${nameHtml}の一致度は<b>${esc(ch.match)}%</b>。あなたの回答の落ち着いた向きが、${name}の姿と響き合っています。`;
  const items = rows.map((x) => {
    const band = bandOf(x.userScore), c = traitShade(x.axis);
    const word = TRAIT_COPY[x.axis][band === 'lo' ? 'lo' : 'hi'];
    const body = band === 'hi' ? `${TRAIT_COPY[x.axis].meaning}に当てはまる回答が多く、<b style="color:${c}">${esc(word)}</b>がはっきり表れています。`
      : band === 'mid' ? `${TRAIT_COPY[x.axis].meaning}が、場面によって表に出る回答です。必要なときに<b style="color:${c}">${esc(word)}</b>が働きます。`
        : `${TRAIT_COPY[x.axis].meaning}に引きずられにくく、<b style="color:${c}">${esc(word)}</b>があなたの持ち味として表れています。`;
    return `<li style="--wc:${c}"><b style="color:${c}">${esc(traitLabel(bundle, x.axis))}<small>あなた：${BAND_WORD[band]}</small></b><span>${body}</span></li>`;
  }).join('');
  const tail = story ? `<p class="rx-text">${esc(story)}${strong.length ? `あなたの${strong.slice(0, 2).map((x) => tb(x.axis)).join('と')}は、この物語のどこと重なるのか。` : 'あなたの回答の向きは、この物語のどこと重なるのか。'}レポートでは、あなたの回答と${name}の物語を照らし合わせて読み解きます。</p>` : '';
  return `<p class="rx-text">${head}</p>
      <ul class="rx-why-list">${items}</ul>
      ${tail}`;
}

// 各領域の解説：特性の一般的な説明ではなく、あなたの回答で突出している特性と、控えめな特性を、具体的な場面とともに言う
function foundationText(result, bundle, g) {
  const ts = g.traits.map((id) => ({ id, s: result.traits[id].score })).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  const top = ts[0], second = ts[1], low = ts[ts.length - 1];
  const lab = (id) => `<b style="color:${traitShade(id)}">「${esc(traitLabel(bundle, id))}」</b>`;
  const band = (x) => TRAIT_BAND[x.id][bandOf(x.s)];
  const out = [];
  if (bandOf(top.s) === 'lo') {
    out.push(`あなたの回答では、${esc(g.traits.map((id) => traitLabel(bundle, id)).join('・'))}の4つはいずれも控えめです。中でも比較的高い${lab(top.id)}も、${esc(band(top)[0])}${esc(band(top)[1])}`);
    out.push('この領域で心が大きく揺れる場面は、今回の回答には多く見られません。');
  } else {
    out.push(`あなたの回答で、この4つのうち最も強く出ているのは${lab(top.id)}です。${esc(band(top)[0])}${esc(band(top)[1])}`);
    if (bandOf(second.s) !== 'lo' && second.s >= top.s - 15) out.push(`次いで${lab(second.id)}も${BAND_WORD[bandOf(second.s)]}で、${esc(band(second)[0])}二つが同じ場面で重なると、反応がより表に出やすくなります。`);
    if (bandOf(low.s) === 'lo' && low.id !== top.id) out.push(`反対に${lab(low.id)}は控えめで、${esc(TRAIT_BAND[low.id].lo[1])}`);
  }
  return out.map((t) => `<p class="rx-text">${t}</p>`).join('');
}

function whyCard(result, bundle) {
  const ch = result.character;
  if (ch.status !== 'available') return '';
  const ex = explainCharacter(result, bundle, ch.id);
  const text = whyText(result, bundle, ch, ex);
  const bars = [['参照した特性との近さ', ch.agreement, '#C98A5A'], ['あなたの目立つ特性との重なり', ch.coverage * 100, '#8E7CD0']];
  return `<section class="rx-card rx-why">
      <p class="rx-sec-h"><i></i>なぜあなたは似ているか</p>
      ${constellation('#E2C08C', 'CONSTELLATION OF SHADOWS')}
      ${text}
      ${bars.map(([label, v, c]) => `<div class="rx-sim" style="--sc:${c}"><p><span>${label}</span><b>${Math.round(v)}<small>%</small></b></p><span class="rx-sim-bar"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(1)}%"></i></span></div>`).join('')}
      <hr class="rx-hr">
      <p class="rx-h4">あなたの影の特性</p>
      ${locks(tendencyWords(result, bundle, null, 4))}
      ${unlockCard('あなたのファトゥスとあなたの、重なる特性と離れている特性を、物語とあわせて読み解きます。', `${ch.name}との共通点と相違点`, characterPreview(result, bundle), '#E2C08C')}
    </section>`;
}

function foundationCard(result, bundle, g) {
  // 札：目立つ特性の言葉（高めなら強みの言葉、控えめなら穏やかな側の言葉）
  const tags = prominentTraits(result, g).slice(0, 3).map((x) => `<span class="rx-tag" style="color:${traitShade(x.id)}">${esc(TRAIT_COPY[x.id][x.s > 40 ? 'hi' : 'lo'])}</span>`).join('');
  return `<section class="rx-card rx-found">
      <p class="rx-sec-h" style="--dot:${g.color}"><i></i>${esc(g.title)}</p>
      ${constellation(g.color, g.en)}
      ${foundationText(result, bundle, g)}
      <div class="rx-tags">${tags}</div>
      <hr class="rx-hr">
      <p class="rx-h4">${esc(g.lockTitle)}</p>
      ${locks(groupLockWords(result, bundle, g))}
      ${unlockCard(g.unlock, g.preview, groupPreview(result, bundle, g), g.color)}
    </section>`;
}

// ---- 完全解析「DIPPER」（¥3,000）の案内（元素診断の「BEYOND THE RESULT｜この先にあるもの」と同じ組み立て・2026-11-10）
//   閉じた状態：予告・三つの視点・価格・サンプルへの入口だけ。「その先を見る」を開くと、星図・三つの視点・ご利用いただける内容・申込。
//   ¥1,000 の主導線（解析レポート）の後に置く。決済ボタンは data-buy="complete"（販売中だけ有効。app.mjs・report.mjs が配線）。
export const DIPPER_LENSES = [
  { key: 'shadow', en: 'SHADOW', head: '邪眼×異相──あなたの影はどう表れるか', body: '上位3つの邪眼と異相を一つずつ読み解き、二つが重なる場面・受け止め方・気持ちと行動・負担のサインまで、5段の流れでたどります。' },
  { key: 'fatui', en: 'FATUI', head: '上位3名のファトゥスとの交わり', body: 'あなたの回答と重なる反応を、人物の具体的な姿と、あなた自身の場面に重ねて読みます。TOP11の全員との一致度も収録します。' },
  { key: 'next', en: 'NEXT', head: '四つの反応領域と、次の一手', body: '12特性を四つの反応領域で捉え直し、あなたの影に合わせた次の一手と、7日間の記録・読み直しの問いへつなげます。' },
];
export const DIPPER_CONTENTS = [
  ['上位3つの邪眼・異相を、1つずつ詳しく', 'あなたの得点から組み立てる「あなたの場合」・場面・負担のサイン・付き合い方'],
  ['邪眼×異相の重なり', '二つの結果が同じ場面でどう表れるかを、5段の流れで'],
  ['ファトゥスTOP11と、上位3名との交わり', '重なるところ・人物の姿・自分に重ねて読む問い'],
  ['四つの反応領域と、あなたの配置', '不安と対人警戒・衝動と刺激・固執と基準・他者への働きかけ'],
  ['あなたの影に、次の一手を', '一つ選び、決めて、確かめる。7日間の記録と再読の問い'],
  ['邪眼辞典・異相辞典', '7邪眼・12特性を、あなたの得点と順位つきで'],
];
const DIPPER_MAP = `<svg class="dp-map" viewBox="0 0 320 180" role="img" aria-label="SHADOW・FATUI・NEXT の三つの視点を結ぶ星図">
  <defs>
    <radialGradient id="dpm-g1"><stop offset="0" stop-color="#ff9fb6"/><stop offset=".4" stop-color="#c8405c" stop-opacity=".7"/><stop offset="1" stop-color="#c8405c" stop-opacity="0"/></radialGradient>
    <radialGradient id="dpm-g2"><stop offset="0" stop-color="#e6d0ff"/><stop offset=".4" stop-color="#9a6cd8" stop-opacity=".7"/><stop offset="1" stop-color="#9a6cd8" stop-opacity="0"/></radialGradient>
    <radialGradient id="dpm-g3"><stop offset="0" stop-color="#fff1cc"/><stop offset=".4" stop-color="#e2c08c" stop-opacity=".7"/><stop offset="1" stop-color="#e2c08c" stop-opacity="0"/></radialGradient>
    <radialGradient id="dpm-c"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#f0b9c6" stop-opacity=".8"/><stop offset="1" stop-color="#c8405c" stop-opacity="0"/></radialGradient>
  </defs>
  <g fill="#fff" opacity=".55"><circle cx="22" cy="30" r=".8"/><circle cx="60" cy="150" r=".7"/><circle cx="110" cy="22" r=".6"/><circle cx="150" cy="160" r=".8"/><circle cx="210" cy="18" r=".7"/><circle cx="268" cy="150" r=".6"/><circle cx="300" cy="40" r=".8"/><circle cx="182" cy="110" r=".5"/><circle cx="96" cy="96" r=".5"/></g>
  <g stroke-width=".8" fill="none" stroke-dasharray="2 3">
    <path d="M70 118 Q120 70 160 90" stroke="#c8405c" opacity=".7"/><path d="M160 90 Q200 60 252 52" stroke="#e2c08c" opacity=".7"/><path d="M160 90 Q190 130 236 136" stroke="#9a6cd8" opacity=".7"/>
  </g>
  <circle cx="160" cy="90" r="26" fill="url(#dpm-c)"/><path d="M160 76 L164 90 L160 104 L156 90 Z" fill="#fff4f7" opacity=".9"/>
  <circle cx="70" cy="118" r="16" fill="url(#dpm-g1)"/><circle cx="70" cy="118" r="2.4" fill="#ffd9e2"/>
  <circle cx="236" cy="136" r="16" fill="url(#dpm-g2)"/><circle cx="236" cy="136" r="2.4" fill="#efe2ff"/>
  <circle cx="252" cy="52" r="16" fill="url(#dpm-g3)"/><circle cx="252" cy="52" r="2.4" fill="#fff4d8"/>
  <g font-family="IM Fell English, serif" font-size="8.5" letter-spacing="2">
    <text x="30" y="146" fill="#f0a3b6">SHADOW</text><text x="214" y="164" fill="#c9a8f0">FATUI</text><text x="268" y="40" fill="#e2c08c">NEXT</text>
    <text x="160" y="128" fill="#efe1e6" text-anchor="middle" opacity=".75">YOU</text>
  </g>
</svg>`;
export function dipperLensListHtml() {
  return `<ul class="dp-lens-list" aria-label="完全解析の三つの視点">${DIPPER_LENSES.map((l) => `<li class="dp-lens dp-lens--${l.key}"><span class="dp-lens-en">${l.en}</span><span class="dp-lens-head">${esc(l.head)}</span><span class="dp-lens-body">${esc(l.body)}</span></li>`).join('')}</ul>`;
}
export function dipperContentsHtml() {
  return `<div class="rx-all-list dp-contents"><p class="rx-all-k">完全解析でご利用いただける内容</p>${DIPPER_CONTENTS.map(([h, d]) => `<p><b>✓ ${esc(h)}</b><span>${esc(d)}</span></p>`).join('')}</div>`;
}
export function dipperMapHtml() { return DIPPER_MAP; }
// 申込のボタン（販売前は押せない「準備中」。app.mjs・report.mjs が販売中なら有効にする）
export function dipperBuyButtonHtml(cls = '') {
  return `<button type="button" class="dp-buy ${cls}" data-buy="complete" disabled aria-disabled="true"><span class="dp-buy-main">まだ見えていない深淵を読む</span><span class="dp-buy-sub">完全解析「DIPPER」 ¥3,000<small class="dp-buy-pending">（準備中）</small></span></button>`;
}
export function dipperFoldHtml({ where = 'result' } = {}) {
  const report = where === 'report';
  return `<div class="dp-fold" data-dipper-fold="${where}">
      <div class="dp-fold-teaser">
        <span class="dp-fold-eyebrow">${report ? 'BEYOND THE REPORT' : 'BEYOND THE RESULT'}｜この先にあるもの</span>
        <span class="dp-fold-lead">${report ? 'このレポートが描いたのは、あなたの深淵の輪郭。<br>その奥にある影の表れ方を、23ページで読み解く。' : 'まだ、ここには現れていない深淵があります。<br>三つの視点から、あなたの影を最後まで読む。'}</span>
        <span class="dp-fold-lens">SHADOW・FATUI・NEXT</span>
        <span class="dp-fold-price">完全解析「DIPPER」｜全23ページ｜¥3,000</span>
        <a class="dp-sample-link" href="/jagan/complete-sample" data-dipper-sample>
          <span class="dp-sample-icon" aria-hidden="true"></span><span class="dp-sample-text"><b>完全解析のサンプルを読む</b><small>実際の23ページから、6ページをそのまま抜き出しています</small></span><span class="dp-sample-go" aria-hidden="true">→</span></a>
      </div>
      <details class="dp-reveal" data-dipper-reveal>
        <summary><span class="dp-reveal-more">その先を見る</span></summary>
        <div class="dp-fold-body">
          <div class="dp-reveal-stars" aria-hidden="true"><i></i><i></i><i></i></div>
          <p class="dp-fold-text">${report ? 'このレポートでは、12特性と三つの土台、判定の根拠を読み解きました。' : 'この結果が示すのは、あなたの深淵の入り口です。'}</p>
          <p class="dp-fold-text">完全解析では、<br>邪眼と異相が重なって表れる場面、<br>あなたと重なるファトゥスの姿、<br>そして次に打てる一手を、<br>三つの視点からひとつの記録へ結びます。</p>
          ${DIPPER_MAP}
          ${dipperLensListHtml()}
          ${dipperContentsHtml()}
          <p class="dp-fold-pages">全23ページの完全解析（A4・PDFで保存できます）</p>
          <div data-dipper-cta>${dipperBuyButtonHtml()}</div>
          <p class="dp-fold-note">解析レポート（¥1,000）とは別の商品です。お支払いの後、すぐにお読みいただけます。</p>
          <p class="jg-small dp-fold-msg" data-dipper-msg role="status"></p>
        </div>
      </details>
    </div>`;
}

function unlockAll() {
  const items = [
    ['12特性のスコアと読み解き', '三つの土台の全特性を、数値と、今回の得点に応じた傾向・振り返りの問いとともに解説'],
    ...GROUPS.map((g) => [g.short, `${g.traits.length}つの特性が、どんな場面で表れ、どんな負担につながるか`]),
    ['邪眼元素と異相の判定根拠', 'なぜその組み合わせに至ったか、形づくる特性から解説'],
    ['近しいファトゥス3名', '参照した特性との共通点・相違点と、物語からの振り返りの問い'],
  ];
  return `<section class="rx-card rx-all">
      <p class="rx-all-en">UNLOCK EVERYTHING</p>
      <p class="rx-all-h">あなたの邪眼と異相とファトゥスについての<br>全てを解放</p>
      <p class="rx-lead jg-center">ここまでは、あなたの深淵の輪郭だけです。その先にあるものを、12特性のデータから解き明かします。</p>
      <div class="rx-all-list"><p class="rx-all-k">ご利用いただける内容</p>${items.map(([h, d]) => `<p><b>✓ ${esc(h)}</b><span>${esc(d)}</span></p>`).join('')}</div>
      <p class="rx-all-price">${PRICE_LABEL}<small>買い切り</small></p>
      <button type="button" class="rx-buy rx-buy-all" data-buy disabled aria-disabled="true">全てのロックを解除する<small>準備中</small></button>
      <p class="jg-small jg-center rx-sales-note">販売開始の準備中です。現在は購入できません。</p>
      <p class="jg-center"><a class="rx-link" href="/jagan/sample">内容のサンプルを見る</a></p>
      ${dipperFoldHtml({ where: 'result' })}
    </section>`;
}

export function renderResultPage(result, bundle) {
  // 元素診断の完了ページと同じ並び：あなたの深淵（土台）→ あなたのファトゥス（最も近しいキャラクター）→ 渇望する邪眼（あなたに響く元素）→
  //   画像を保存・X シェア → ロックの欄（人物像 → 邪眼 → 三つの土台）→ 今あなたが見ているもの → 全てを解放（¥1,000・その先 ¥3,000）→ 診断記録への保存
  return [mainCard(result, bundle), fatuiCard(result), cravingCard(result), shareRow(), whyCard(result, bundle), desireCard(result, bundle),
    ...GROUPS.map((g) => foundationCard(result, bundle, g)), seeingCard(), unlockAll(), saveCard()].join('\n');
}

// =====================================================================
// 解析レポート（元素診断の解析レポートと同じ構成：表紙→01 土台→02〜04 土台ごとの深層→05 近しい人物→06 総括）
//   サンプルと、販売開始後の本人のレポートで共通。
// =====================================================================
const SCALE_NOTE = '数値は0〜100。<b class="hi">60以上</b>＝はっきり表れている、41〜59＝場面によって表れる、<b class="lo">40以下</b>＝控えめ、として説明しています。一般の人の中での順位ではなく、この診断の設計上の目安です。';

function ring(score, color, label) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score));
  return `<div class="rp-ring" style="--rc:${color}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="5"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle">${Math.round(v)}%</text></svg><span>${esc(label)}</span></div>`;
}
function traitBar(result, id, color) {
  const t = result.traits[id], c = TRAIT_COPY[id];
  return `<div class="rp-bar" style="--bc:${color}">
      <p class="rp-bar-h"><span>${esc(t.label)}<small>${esc(id)}</small></span><b>${t.displayScore}</b></p>
      <span class="rp-track"><i style="width:${Math.max(2, t.score).toFixed(1)}%"></i></span>
      <p class="rp-bar-t"><em class="lv-${level(t.score)}">${level(t.score)}</em> — ${esc(traitBandText(id, t.score).text)}</p>
      <p class="rp-bar-q">${esc(traitBandText(id, t.score).question)}</p>
    </div>`;
}
function listItems(result, ids, mark, note) {
  return ids.map((id) => {
    const c = TRAIT_COPY[id], t = result.traits[id];
    return `<div class="rp-li"><span class="rp-mark rp-mark-${mark}">${mark === 'up' ? '✓' : '!'}</span><div><b>${esc(t.label)}（${t.displayScore}点）</b>
      <p>${esc(c.meaning)}${note}</p><small>${esc(traitBandText(id, t.score).text)}</small></div></div>`;
  }).join('');
}

export function renderReport(result, bundle) {
  const el = result.element, isou = result.isou;
  const et = ELEMENT_TEXT[el.id], it = ISOU_TEXT[isou.id];
  const ec = ELEMENT_COLOR[el.id];
  const d = result.dti;
  const ch = result.character;
  const sorted = result.traitRanking;
  const highs = sorted.slice(0, 3).map((t) => t.id);
  const lows = sorted.slice(-3).reverse().map((t) => t.id);
  const contrib = el.id ? Object.entries(bundle.core.elements.find((e) => e.id === el.id).weights).sort((a, b) => b[1] - a[1]) : [];

  const cover = `<section class="rp-cover" style="--ec:${ec.main};--ed:${ec.dark}">
      <div class="rp-emblem"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="84" fill="none" stroke="color-mix(in srgb, var(--ec) 45%, transparent)"/><circle cx="100" cy="100" r="60" fill="none" stroke="rgba(255,255,255,.06)"/>
        ${[[16, 100], [184, 100], [100, 16], [148, 168], [52, 168], [160, 40]].map(([x, y], i) => `<path d="${sparklePath(x, y, 8)}" fill="${i % 2 ? '#E2C08C' : ec.main}"/>`).join('')}</svg>
        <b>${esc(el.label)}</b></div>
      <p class="rp-cover-en">DELUSION DIAGNOSIS — ${esc(el.label)}</p>
      <h1 class="rp-cover-title">邪眼診断<br>解析レポート</h1>
      <p class="rp-cover-code">${esc(d.code)}</p>
      <p class="rp-cover-type">${esc(d.name)}</p>
      <p class="rp-cover-sub">${esc(el.label)} × ${esc(isou.label)}${ch.status === 'available' ? ` × ${esc(ch.name)}` : ''}</p>
    </section>`;

  const topBottom = `<p class="rp-sub-h up">◆ 12特性の中で相対的に高い特性（上位3）</p>
      ${listItems(result, highs, 'up', '。あなたの12特性の中で、相対的に高く表れています。')}
      <p class="rp-sub-h down">◆ 12特性の中で相対的に控えめな特性（下位3）</p>
      ${listItems(result, lows, 'down', '。あなたの12特性の中で、相対的に控えめに表れています。')}`;
  const s01 = `<section class="rp-card">
      <p class="rp-no">01</p>
      <h2 class="rp-h2">あなたの深淵 — <span style="color:${ec.main}">${esc(el.label)}</span> × ${esc(isou.label)}｜${esc(d.code)} ${esc(d.name)}</h2>
      <p class="rp-text">${esc(et.body)}</p>
      <p class="rp-text">${esc(it.body)}</p>
      <blockquote class="rp-quote" style="--ec:${ec.main}">この二つが重なるとき、「${esc(et.essence)}」状態に、「${esc(it.essence)}」傾向が重なった姿として表に現れます。</blockquote>
      ${constellation(ec.main, 'DELUSION RESONANCE MAP')}
    </section>
    <section class="rp-card">
      <p class="rp-en">CONNECTING FACTORS</p>
      <h3 class="rp-h3">${el.id ? `あなたの邪眼（${esc(el.label)}）を形作る特性` : '相対的に高い特性・控えめな特性'}</h3>
      ${el.id ? `<div class="rp-rings">${contrib.map(([axis, w]) => ring(result.traits[axis].score, ec.main, traitLabel(bundle, axis))).join('')}</div>
      <p class="rp-note">邪眼（${esc(el.label)}）は、これらの特性の組み合わせです。</p>` : ''}
      ${topBottom}
    </section>`;

  const groups = GROUPS.map((g) => {
    const ts = g.traits.map((id) => result.traits[id]).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const hi = ts[0], lo = ts[ts.length - 1];
    const quote = hi.score === lo.score ? 'この領域の特性は、同じ程度に表れています。'
      : `この領域でいちばん強く表れているのは<b style="color:${g.color}">「${esc(hi.label)}」</b>（${hi.displayScore}）、いちばん控えめなのは<b style="color:${g.color}">「${esc(lo.label)}」</b>（${lo.displayScore}）です。${esc(TRAIT_COPY[hi.id].reflection)}`;
    return `<section class="rp-card">
      <p class="rp-no">${g.no}</p>
      <h2 class="rp-h2" style="color:${g.color}">${esc(g.short)} — <span class="rp-h2-en">${esc(g.en)}</span></h2>
      <p class="rp-text">${esc(g.intro)}</p>
      <blockquote class="rp-quote" style="--ec:${g.color}">${quote}</blockquote>
      ${radar(result, bundle, g.traits, g.color)}
      ${g.traits.map((id) => traitBar(result, id, g.color)).join('')}
      <p class="rp-note">${SCALE_NOTE}</p>
    </section>`;
  }).join('');

  let s05;
  if (ch.status !== 'available') {
    s05 = `<section class="rp-card"><p class="rp-no">05</p><h2 class="rp-h2">近しいファトゥス — <span class="rp-h2-en">Character Match</span></h2>
      <p class="jg-pending-block">人物の比較に使える特性の得点差が小さいため、人物の判定を保留しています。無理に誰かへ当てはめることはしません。</p>
      <p class="rp-note">${esc(METHOD.holdback_notice)}</p></section>`;
  } else {
    const picks = [result.characterOrder.find((c) => c.id === ch.id), ...result.characterOrder.filter((c) => c.id !== ch.id).slice(0, 2)];
    s05 = `<section class="rp-card">
      <p class="rp-no">05</p>
      <h2 class="rp-h2">近しいファトゥス — <span class="rp-h2-en">Character Match</span></h2>
      <p class="rp-text">あなたの回答と重なる、上位3名のファトゥスです。物語の中で彼らが見せる姿に、あなた自身の反応を重ねて読んでみてください。</p>
      ${constellation('#E2C08C', 'CONSTELLATION OF SHADOWS')}
      ${picks.map((c, i) => {
        const meta = bundle.characters.characters.find((x) => x.id === c.id);
        const copy = CHARACTER_COPY[c.id];
        return `<div class="rp-match">
          <p class="rp-match-h"><span class="rp-match-no">${i + 1}</span>${gradNameHtml(c.id, c.name)}<em>${c.displayScore}%</em></p>
          <div class="rx-tags"><span class="rx-tag">「${esc(meta.title)}」</span>${meta.tags.map((t) => `<span class="rx-tag rx-tag-type">${esc(t)}</span>`).join('')}<span class="rx-tag">${esc(meta.region_label)}</span></div>
          <p class="rp-text sm">${esc(copy.story_context)}</p>
          ${fatuiOverlapHtml(result, bundle, c.id, c.name)}
          <p class="rp-q">${esc(copy.reflection)}</p>
        </div>`;
      }).join('')}
      <p class="rp-note">順位は一致度の高い順です。</p>
    </section>`;
  }

  const sentence = (g) => {
    const t = g.traits.map((id) => result.traits[id]).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
    return `「${esc(t.label)}」（${t.displayScore}）がもっとも強く表れています。`;
  };
  const s06 = `<section class="rp-card">
      <p class="rp-no">06</p>
      <h2 class="rp-h2">総括 — 不安と距離・行動のくせ・他者との向き合い</h2>
      <p class="rp-en gold">DISTANCE × ACTION × RELATING</p>
      ${GROUPS.map((g, i) => `<div class="rp-sum" style="--bc:${g.color}"><p class="k">${['DISTANCE', 'ACTION', 'RELATING'][i]}<span>${esc(g.short)}</span></p><p>${esc(g.short)}の領域では、${sentence(g)}</p></div>`).join('')}
      <div class="rp-final">この3つの層が重なって、<b style="color:${ec.main}">【${esc(el.label)}×${esc(isou.label)}】</b>という深淵の輪郭が描かれています。${ch.status === 'available' ? `あなたのファトゥスは<b>${esc(ch.name)}</b>（${ch.match}%）です。` : ''}${isou.id ? esc(TRAIT_COPY[isou.id].reflection) : '無理に一つの傾向に当てはめず、場面ごとの表れ方に目を向けてみてください。'}</div>
      <p class="rp-note">${esc(METHOD.short_notice)}${esc(METHOD.development_notice)}</p>
    </section>`;

  return cover + s01 + groups + s05 + s06;
}

// 理論のページ：各邪眼の中核となる特性（重みの大きい順に名前だけ。重みの値は出さない）
export function renderElementCores(bundle) {
  return bundle.core.elements.map((e) => {
    const ids = Object.entries(e.weights).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return `<li style="--ec:${ELEMENT_COLOR[e.id].main}"><b>${esc(e.label)}<small>${esc(ELEMENT_NAME[e.id])}</small></b><span>${esc(ids.map((id) => traitLabel(bundle, id)).join('・'))}</span><em>${esc(ELEMENT_TEXT[e.id].essence)}</em></li>`;
  }).join('');
}
export function renderMethod() {
  return METHOD_KEYS.map((k) => `<p>${esc(METHOD[k])}</p>`).join('') + `<p class="jg-small">${esc(METHOD.reference)}</p>`;
}
