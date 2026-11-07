// jagan/view.mjs — 邪眼診断の表示（HTML 文字列を返す純粋な関数。ブラウザとテストで共通）。
//   ・数値は computeDiagnosis の結果（保存時のスナップショット）だけから作る。例示の人物名・数値で穴埋めしない。
//   ・人物の物語（作品の描写）と、利用者の数値が参照に近い項目（explainCharacter）を分けて書く。
//   ・無料の結果では 12 特性の数値を出さない（傾向の言葉だけ）。数値・項目別の読み解きはレポート（ロックの先）。
import { explainCharacter, shareTextFromSummary } from './engine/runtime.mjs';
import {
  ELEMENT_COLOR, NEUTRAL_COLOR, ELEMENT_NAME, ISOU_COLOR, ELEMENT_TEXT, ISOU_TEXT, ISOU_SHORT, ELEMENT_STORY, TRAIT_COPY, GROUPS, GROUP_OF,
  CHARACTER_ELEMENTS, CHARACTER_COPY, METHOD, METHOD_KEYS, BALANCE_NOTE, CHARACTER_GLOBAL_NOTICE, CHARACTER_NO_ALIGNED, CHARACTER_NO_DIFFERENT,
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
    .map((x) => ({ word: traitLabel(bundle, x.id), color: GROUPS.find((g) => g.id === GROUP_OF[x.id]).color }));
}

function locks(words) {
  return `<div class="rx-locks">${words.map((w) => `<div class="rx-lock" style="--lc:${w.color}"><span class="rx-lock-ring">${lockSvg}</span><span class="rx-lock-word">${esc(w.word)}</span></div>`).join('')}</div>`;
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
  return `<svg class="rp-radar" viewBox="0 0 200 200">${[1, 0.66, 0.33].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="rgba(255,255,255,.08)"/>`).join('')}
    <polygon points="${poly}" fill="${color}" fill-opacity=".28" stroke="${color}"/>
    ${ids.map((id, i) => { const [x, y] = pt(i, R + 18); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${esc(traitLabel(bundle, id))}</text>`; }).join('')}</svg>`;
}
function groupPreview(_result, bundle, g) {
  const p = previewResult(bundle);
  return radar(p, bundle, g.traits, g.color) + g.traits.map((id) => traitBar(p, id, g.color)).join('');
}
function characterPreview(result, bundle) {
  const ch = { id: result.character.id, name: result.character.name, match: PREVIEW_MATCH };
  const ex = explainCharacter(previewResult(bundle), bundle, ch.id);
  const copy = CHARACTER_COPY[ch.id];
  const row = (x) => `${esc(traitLabel(bundle, x.axis))}（あなた ${Math.round(x.userScore)}／参照 ${Math.round(x.referenceScore)}）`;
  return `<div class="rp-match"><p class="rp-match-h"><b>${esc(ch.name)}</b><em>${ch.match}%</em></p>
      <p class="rp-text sm">${esc(copy.story_context)}</p>
      <p class="rp-text sm"><b class="near">近い特性：</b>${ex.aligned.length ? ex.aligned.map(row).join('、') : esc(CHARACTER_NO_ALIGNED)}</p>
      <p class="rp-text sm"><b class="far">差のある特性：</b>${ex.different.length ? ex.different.map(row).join('、') : esc(CHARACTER_NO_DIFFERENT)}</p>
      <p class="rp-text sm">${esc(copy.limit)}</p><p class="rp-q">${esc(copy.reflection)}</p></div>`;
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
  const el = result.element, isou = result.isou, d = result.dti;
  const color = ISOU_COLOR[isou.id];
  const summary = `つまり<b style="color:var(--ec)">${esc(d.name)}（${esc(d.code)}）</b>は、「${esc(ELEMENT_TEXT[el.id].essence)}」邪眼の力が、「${esc(ISOU_TEXT[isou.id].essence)}」かたちで表に現れている姿です。今回の回答に表れた姿であり、固定的な性格ではありません。`;
  return `<section class="rx-card rx-main" style="${elementStyle(el.id)}">
      <div class="rx-main-head"><span class="rx-kicker">邪眼診断 — DTI</span></div>
      <div class="rx-eye">${gemSvg(ELEMENT_COLOR[el.id].main, 'main', 20)}</div>
      <p class="rx-abyss">あなたの深淵</p>
      <h2 class="rx-title"><span class="rx-el">${esc(el.label)}</span><span class="rx-x">×</span><span class="rx-type" style="--tc:${color}">${esc(isou.label)}</span></h2>
      <p class="rx-dti"><b>${esc(d.code)}</b><span class="rx-dti-sep">｜</span><span class="rx-dti-name">${esc(d.name)}</span></p>
      <p class="rx-sub">邪眼：${esc(el.label)} ／ 異相：${esc(isou.label)}</p>
      <div class="rx-pair">
        <p><b style="color:var(--ec)">邪眼（${esc(el.label)}）</b>${esc(ELEMENT_NAME[el.id])}——${esc(ELEMENT_TEXT[el.id].essence)}邪眼。</p>
        <p><b style="color:${color}">異相（${esc(isou.label)}）</b>${esc(ISOU_SHORT[isou.id])}</p>
      </div>
      <blockquote class="rx-summary">${summary}</blockquote>
    </section>`;
}

function fatuiCard(result) {
  const ch = result.character;
  if (ch.status !== 'available') {
    return `<section class="rx-card rx-fatui"><p class="rx-kicker">最も近しいファトゥス</p>
      <p class="jg-pending-block">今回の回答では、人物の比較に使える特性の差が小さく、特定の人物を示せませんでした。無理に誰かへ当てはめることはしません。</p></section>`;
  }
  return `<section class="rx-card rx-fatui">
      <p class="rx-kicker">最も近しいファトゥス</p>
      <div class="rx-fatui-row">
        <div>
          <p class="rx-fatui-name${ch.name.length >= 6 ? ' is-long' : ''}" style="background-image:${characterGradient(ch.id)}">${esc(ch.name)}</p>
          <div class="rx-tags">${ch.tags.map((t) => `<span class="rx-tag rx-tag-type">${esc(t)}</span>`).join('')}<span class="rx-tag">${esc(ch.region)}</span></div>
        </div>
        <div class="rx-pct"><b>${esc(ch.match)}<small>%</small></b><span>一致度</span></div>
      </div>
      <p class="rx-fatui-link"><a href="/jagan/about">一致度と人物の選び方について ›</a></p>
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

function actions() {
  return `<section class="rx-card rx-save">
      <p class="rx-save-k">診断記録</p>
      <p class="rx-save-text">この結果を、今のあなたの深淵として残しませんか。<br>マイページに保存すると、いつでも見返せます。</p>
      <button type="button" class="rx-save-btn" id="saveBtn">マイページに保存する</button>
      <p class="jg-status rx-status" id="actionStatus" role="status" aria-live="polite"></p>
      <p class="jg-small jg-center" id="pendingFix" hidden><button type="button" class="jg-linkbtn" id="fixAnswersBtn">回答を見直す</button></p>
    </section>
    <p class="rx-free-line">— ここまでが無料診断の結果です —</p>
    <div class="rx-share-row">
      <button type="button" class="rx-share rx-share-img" id="imageBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>画像を保存</button>
      <button type="button" class="rx-share rx-share-x" id="shareBtn"><b>𝕏</b>でシェア</button>
    </div>`;
}

function seeingCard() {
  const open = ['邪眼元素と異相（DTIコード・呼び名）', '最も近しいファトゥス1名', '欲求が導くあなたの影'];
  const locked = ['12特性のスコアと、それぞれの読み解き', ...GROUPS.map((g) => `${g.short}（4特性）の詳細`), '近しいファトゥス3名との共通点・相違点', '判定根拠（なぜその組み合わせになったか）'];
  return `<section class="rx-card rx-seeing">
      <p class="rx-seeing-k">今、あなたが見ているもの</p>
      <ul>${open.map((t) => `<li class="on"><span>${checkSvg}</span>${esc(t)}</li>`).join('')}${locked.map((t) => `<li><span class="lk">${lockSvg}</span>${esc(t)}</li>`).join('')}</ul>
      <p class="rx-seeing-foot">ここで見えているのは、あなたの一部分に過ぎません。</p>
    </section>`;
}

function whyCard(result, bundle) {
  const ch = result.character;
  if (ch.status !== 'available') return '';
  const ex = explainCharacter(result, bundle, ch.id);
  const aligned = ex.aligned.map((x) => `「${traitLabel(bundle, x.axis)}」`);
  const nameStyle = `background-image:${characterGradient(ch.id)}`;
  const text = aligned.length
    ? `<b class="rx-grad" style="${nameStyle}">${esc(ch.name)}</b>との一致度は<b>${esc(ch.match)}%</b>。特に${esc(aligned.join(''))}が、${esc(ch.name)}の参照とあなたとで近い値を示しています。`
    : `<b class="rx-grad" style="${nameStyle}">${esc(ch.name)}</b>との一致度は<b>${esc(ch.match)}%</b>。参照した特性の中に際立って近い項目は限られますが、比較できる特性の中では最も近い参照です。`;
  const bars = [['参照した特性との近さ', ch.agreement, '#C98A5A'], ['あなたの目立つ特性との重なり', ch.coverage * 100, '#8E7CD0']];
  return `<section class="rx-card rx-why">
      <p class="rx-sec-h"><i></i>なぜあなたは似ているか</p>
      ${constellation('#E2C08C', 'CONSTELLATION OF SHADOWS')}
      <p class="rx-text">${text}</p>
      ${bars.map(([label, v, c]) => `<div class="rx-sim" style="--sc:${c}"><p><span>${label}</span><b>${Math.round(v)}<small>%</small></b></p><span class="rx-sim-bar"><i style="width:${Math.max(0, Math.min(100, v)).toFixed(1)}%"></i></span></div>`).join('')}
      <p class="jg-note">一致度は、この二つを合わせた近さです（補正を足す前の値）。比較に使えるのは、作品の描写から対応を置けた特性だけです。</p>
      <hr class="rx-hr">
      <p class="rx-h4">あなたの影の特性</p>
      ${locks(tendencyWords(result, bundle, null, 4))}
      ${unlockCard('最も近しいファトゥスとあなたの、重なる特性と離れている特性を、物語とあわせて読み解きます。', `${ch.name}との共通点と相違点`, characterPreview(result, bundle), '#E2C08C')}
    </section>`;
}

function foundationCard(result, bundle, g) {
  const ts = g.traits.map((id) => ({ id, s: result.traits[id].score }));
  const stand = ts.slice().sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))[0];
  const standText = stand.s >= 60 ? `今回のあなたの回答では、この土台のうち<b>「${esc(traitLabel(bundle, stand.id))}」</b>が比較的はっきり表れています。`
    : stand.s > 40 ? `今回のあなたの回答では、この土台の特性は、<b>「${esc(traitLabel(bundle, stand.id))}」</b>を含めて中程度に収まっています。`
      : '今回のあなたの回答では、この土台の特性は全体として控えめに表れています。';
  const tags = tendencyWords(result, bundle, g.id, 3).map((w) => `<span class="rx-tag">${esc(w.word)}</span>`).join('');
  return `<section class="rx-card rx-found">
      <p class="rx-sec-h" style="--dot:${g.color}"><i></i>${esc(g.title)}</p>
      ${constellation(g.color, g.en)}
      <p class="rx-text">${esc(g.intro)}</p>
      <p class="rx-text">${standText}</p>
      <div class="rx-tags">${tags}</div>
      <hr class="rx-hr">
      <p class="rx-h4">${esc(g.lockTitle)}</p>
      ${locks(tendencyWords(result, bundle, g.id, 4))}
      ${unlockCard(g.unlock, g.preview, groupPreview(result, bundle, g), g.color)}
    </section>`;
}

function unlockAll() {
  const items = [
    ['12特性のスコアと読み解き', '三つの土台の全特性を、数値と意味・読み方の限界とともに解説'],
    ...GROUPS.map((g) => [g.short, `${g.traits.length}つの特性が、強みとして働く面と負担になる面`]),
    ['邪眼元素と異相の判定根拠', 'なぜその組み合わせに至ったか、寄与した特性から解説'],
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
    </section>`;
}

export function renderResultPage(result, bundle) {
  // 指示書 5章の順：1〜2 あなたの深淵 → 3 最も近しいファトゥス → 4 欲求が導くあなたの影 → 5 渇望する邪眼 → 6 保存・画像・X →
  //   7 見えているのは一部分（土台ごとのロックと解除の案内）→ 8 内容と価値、最後に金額
  return [mainCard(result, bundle), fatuiCard(result), desireCard(result, bundle), cravingCard(result), actions(), seeingCard(), whyCard(result, bundle),
    ...GROUPS.map((g) => foundationCard(result, bundle, g)), unlockAll()].join('\n');
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
      <p class="rp-bar-t">${esc(c.meaning)}。<em class="lv-${level(t.score)}">${level(t.score)}</em> — ${esc(c.limit)}</p>
      <p class="rp-bar-q">${esc(c.reflection)}</p>
    </div>`;
}
function listItems(result, ids, mark, note) {
  return ids.map((id) => {
    const c = TRAIT_COPY[id], t = result.traits[id];
    return `<div class="rp-li"><span class="rp-mark rp-mark-${mark}">${mark === 'up' ? '✓' : '!'}</span><div><b>${esc(t.label)}（${t.displayScore}点）</b>
      <p>${esc(c.meaning)}${note}</p><small>${esc(c.limit)}</small></div></div>`;
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
      ${el.id ? `<div class="rp-rings">${contrib.map(([axis, w]) => ring(result.traits[axis].score, ec.main, `${traitLabel(bundle, axis)}（重み${Math.round(w * 100)}%）`)).join('')}</div>
      <p class="rp-note">邪眼（${esc(el.label)}）の得点は、これらの特性の得点を重みに従って合わせた値です（重みは作者の設計値）。</p>` : ''}
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
      <p class="rp-text">11名の参照との照合結果です。比較先は、作品の描写を参考に作者が設計した部分的な参照（人物ごとに2〜3の特性）で、人物本人の心理得点ではありません。未対応の特性は、中立値で補わず、比較に含めていません。</p>
      ${constellation('#E2C08C', 'CONSTELLATION OF SHADOWS')}
      ${picks.map((c, i) => {
        const meta = bundle.characters.characters.find((x) => x.id === c.id);
        const copy = CHARACTER_COPY[c.id];
        const ex = explainCharacter(result, bundle, c.id);
        const row = (x) => `${esc(traitLabel(bundle, x.axis))}（あなた ${Math.round(x.userScore)}／参照 ${Math.round(x.referenceScore)}）`;
        return `<div class="rp-match">
          <p class="rp-match-h"><span class="rp-match-no">${i + 1}</span><b class="rx-grad" style="background-image:${characterGradient(c.id)}">${esc(c.name)}</b><em>${c.displayScore}%</em></p>
          <div class="rx-tags"><span class="rx-tag">「${esc(meta.title)}」</span>${meta.tags.map((t) => `<span class="rx-tag rx-tag-type">${esc(t)}</span>`).join('')}<span class="rx-tag">${esc(meta.region_label)}</span></div>
          <p class="rp-text sm">${esc(copy.story_context)}</p>
          <p class="rp-text sm"><b class="near">近い特性：</b>${ex.aligned.length ? ex.aligned.map(row).join('、') : esc(CHARACTER_NO_ALIGNED)}</p>
          <p class="rp-text sm"><b class="far">差のある特性：</b>${ex.different.length ? ex.different.map(row).join('、') : esc(CHARACTER_NO_DIFFERENT)}</p>
          <p class="rp-text sm">${esc(copy.limit)}</p>
          <p class="rp-q">${esc(copy.reflection)}</p>
        </div>`;
      }).join('')}
      <p class="rp-note">${esc(CHARACTER_GLOBAL_NOTICE)}15点・20点は説明のための設計値で、心理学上の基準ではありません。</p>
      <p class="rp-note">順位は、人物ごとの出現の偏りを抑える固定の補正を含む選定の順です。一致度は補正を足す前の近さのため、順位と一致度の大小が一致しないことがあります。</p>
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
      <div class="rp-final">この3つの層が重なって、<b style="color:${ec.main}">【${esc(el.label)}×${esc(isou.label)}】</b>という深淵の輪郭が描かれています。${ch.status === 'available' ? `最も近しい参照は<b>${esc(ch.name)}</b>（${ch.match}%）です。` : ''}${isou.id ? esc(TRAIT_COPY[isou.id].reflection) : '無理に一つの傾向に当てはめず、場面ごとの表れ方に目を向けてみてください。'}</div>
      <p class="rp-note">${esc(METHOD.short_notice)}${esc(METHOD.development_notice)}</p>
    </section>`;

  return cover + s01 + groups + s05 + s06;
}

export function renderMethod() {
  return METHOD_KEYS.map((k) => `<p>${esc(METHOD[k])}</p>`).join('') + `<p class="jg-small">${esc(METHOD.reference)}</p>`;
}
