// jagan/view.mjs — 邪眼診断の表示（HTML 文字列を返す純粋な関数。ブラウザとテストで共通）。
//   ・数値は computeDiagnosis の結果（保存時のスナップショット）だけから作る。例示の人物名・数値で穴埋めしない。
//   ・人物の物語（character.copy）と、利用者の数値が参照パターンに近い項目（explainCharacter）を分けて書く。
//   ・同率（計算上の真の同率）と、丸めて同じ%になっただけの場合を区別する。
import { explainCharacter } from './engine/runtime.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const domainLabel = (bundle, id) => (bundle.items.domains.find((d) => d.id === id) || {}).label || id;
const jaList = (xs) => xs.join('・');

// 元素の判定に大きく寄与した領域（重みの大きい順に2つ）。負の重みは「低いほど寄与」と書く
export function elementContributions(result, bundle, elementId) {
  const def = bundle.interpretation.elements.find((e) => e.id === elementId);
  if (!def) return [];
  return Object.entries(def.weights)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([axis, w]) => ({ axis, label: domainLabel(bundle, axis), score: result.domains[axis].displayScore, inverse: w < 0 }));
}

function tieNote(names, kind) {
  return `<p class="jg-note">計算上の同率候補があります（${esc(jaList(names))}）。代表は、この結果に固有の値で安定して選んでいます。${kind}の優劣を示すものではありません。</p>`;
}

export function renderHeadline(result) {
  const el = result.elements.status === 'available' ? result.elements.rankings.find((r) => r.id === result.elements.primary) : null;
  const typeLabel = result.types.status === 'insufficient' ? null : (result.types.primary ? result.types.label : '型の偏りなし');
  const elText = el ? esc(el.label) : '<span class="jg-pending">判定保留</span>';
  const typeText = typeLabel ? esc(typeLabel) : '<span class="jg-pending">判定保留</span>';
  return `<p class="jg-kicker">あなたの深淵</p>
    <h2 class="jg-headline"><span>${elText}</span><span class="jg-x">×</span><span>${typeText}</span></h2>`;
}

export function renderExplanation(result, bundle, copy) {
  const parts = [];
  if (result.elements.status === 'available') {
    const id = result.elements.primary;
    const c = copy.result.element[id];
    const contrib = elementContributions(result, bundle, id)
      .map((x) => `「${esc(x.label)}」（${esc(x.score)}${x.inverse ? '・低いほど寄与' : ''}）`).join('と');
    parts.push(`<p><strong class="jg-sub">${esc(c.subtitle)}</strong>${esc(c.paragraph)}今回の判定には、主に${contrib}が関わっています。各項目がすべて高いという意味ではありません。</p>`);
    if (result.elements.ties.length > 1) {
      parts.push(tieNote(result.elements.ties.map((i) => result.elements.rankings.find((r) => r.id === i).label), '元素'));
    } else if (result.elements.differentiation === 'close') {
      parts.push(`<p class="jg-note">近い得点の元素があります（${esc(jaList(result.elements.close.map((i) => result.elements.rankings.find((r) => r.id === i).label)))}）。一つの象徴だけで説明し切れるとは限りません。</p>`);
    }
  } else {
    parts.push(`<p class="jg-pending-block">${esc(copy.result.insufficient)}（元素）</p>`);
  }
  if (result.types.status === 'insufficient') {
    parts.push(`<p class="jg-pending-block">${esc(copy.result.insufficient)}（型）</p>`);
  } else if (!result.types.primary) {
    parts.push(`<p>${esc(copy.result.no_marked_pattern)}</p>`);
  } else {
    const t = copy.result.type[result.types.primary];
    const top = result.types.rankings[0];
    const domain = bundle.interpretation.types.find((x) => x.id === result.types.primary).domain;
    parts.push(`<p><strong class="jg-sub">${esc(t.label)}</strong>${esc(t.paragraph)}今回の回答では「${esc(domainLabel(bundle, domain))}」が${esc(top.displayScore)}でした。${esc(t.notice)}</p>`);
    const tied = result.types.rankings.filter((r) => r.rank === 1);
    if (tied.length > 1) parts.push(tieNote(tied.map((r) => r.label), '型'));
    else if (result.types.differentiation === 'co_dominant') {
      parts.push(`<p class="jg-note">${esc(copy.result.co_dominant)}（${esc(jaList(result.types.close.map((i) => result.types.rankings.find((r) => r.id === i).label)))}）</p>`);
    }
  }
  return parts.join('\n');
}

export function renderFatui(result, bundle, copy) {
  const ch = result.characters;
  if (ch.status !== 'available') {
    return `<p class="jg-fatui">最も近しいファトゥス：<span class="jg-pending">回答不足のため判定保留</span></p>
      <p class="jg-note">人物との比較には12項目すべての回答が必要です。</p>`;
  }
  const top = ch.rankings[0];
  const second = ch.rankings[1];
  const story = copy.character.characters[top.id];
  const lines = [`<p class="jg-fatui">最も近しいファトゥス：<strong>${esc(top.label)}</strong>${story ? `<span class="jg-title">「${esc(story.title)}」</span>` : ''}（${esc(top.displayScore)}%一致）</p>`];
  if (ch.ties.length > 1) {
    lines.push(tieNote(ch.ties.map((i) => ch.rankings.find((r) => r.id === i).label), '人物'));
  } else if (ch.closeCandidates.length > 1) {
    const others = ch.closeCandidates.filter((i) => i !== top.id).map((i) => ch.rankings.find((r) => r.id === i).label);
    const roundedSame = second && second.displayScore === top.displayScore;
    lines.push(`<p class="jg-note">${esc(copy.character.close_candidates)}近い候補：${esc(jaList(others))}（2位との差 ${ch.gapToSecond < 0.05 ? '0.1点未満' : esc(ch.gapToSecond.toFixed(1)) + '点'}${roundedSame ? '。表示上は同じ%ですが、計算上は同率ではありません' : ''}）。</p>`);
  }
  lines.push(`<p class="jg-note"><a href="/jagan/about">一致率の意味</a>：${esc(bundle.characters.notice)}</p>`);
  return lines.join('\n');
}

export function renderCharacterDetail(result, bundle, copy, characterId) {
  const ex = explainCharacter(result, bundle.characters, characterId);
  if (ex.status !== 'available') return '';
  const story = copy.character.characters[ex.characterId];
  const row = (x) => `<li>${esc(domainLabel(bundle, x.axis))}：あなた ${esc(Math.round(x.userScore))} ／ 参照 ${esc(Math.round(x.referenceScore))}</li>`;
  return `<div class="jg-char">
    <h3>${esc(story.name)}<span class="jg-title">「${esc(story.title)}」</span></h3>
    <p class="jg-label">物語（作品の描写の要約）</p>
    <p>${esc(story.story_context)}</p>
    <p>${esc(story.association_theme)}</p>
    <p class="jg-label">参照パターンに近い項目</p>
    ${ex.aligned.length ? `<ul>${ex.aligned.map(row).join('')}</ul>` : `<p>${esc(copy.character.no_aligned_axes)}</p>`}
    <p class="jg-label">参照パターンと差のある項目</p>
    ${ex.different.length ? `<ul>${ex.different.map(row).join('')}</ul>` : `<p>${esc(copy.character.no_different_axes)}</p>`}
    <p class="jg-note">${esc(ex.caution)}${esc(ex.thresholdMeaning)}${esc(story.limit)}</p>
    <p class="jg-reflect">${esc(story.reflection)}</p>
  </div>`;
}

export function renderTop3(result) {
  if (result.elements.status !== 'available') return '<p class="jg-pending-block">回答不足のため判定保留</p>';
  const r = result.elements.rankings;
  const top = r.slice(0, 3);
  const items = top.map((e) => {
    const tied = r.filter((x) => x.rank === e.rank).length > 1;
    return `<li><span class="jg-rank">${esc(e.rank)}</span><span>${esc(e.label)}</span>${tied ? '<span class="jg-badge">同率</span>' : ''}</li>`;
  }).join('');
  const lastRank = top[top.length - 1].rank;
  const more = r.slice(3).some((x) => x.rank === lastRank);
  return `<ol class="jg-top3">${items}</ol>${more ? '<p class="jg-note">他にも同率候補があります。</p>' : ''}`;
}

export function renderResult(result, bundle, copy) {
  return `<section class="jg-card jg-result-main">
      ${renderHeadline(result)}
      <div class="jg-explain">${renderExplanation(result, bundle, copy)}</div>
    </section>
    <section class="jg-card">
      ${renderFatui(result, bundle, copy)}
      ${result.characters.status === 'available' ? `<details class="jg-details"><summary>人物との比較を読む</summary>${renderCharacterDetail(result, bundle, copy, result.characters.primary)}</details>` : ''}
    </section>
    <section class="jg-card">
      <h3 class="jg-h3">あなたの渇望する邪眼</h3>
      ${renderTop3(result)}
    </section>`;
}

// 12項目（レポート・サンプルで使う）
export function renderDomainTable(result, bundle, copy) {
  const blocks = { need: '欲求の充足と阻害', strategy: '感情の扱い方', difficulty: 'つらいときの難しさ' };
  return Object.entries(blocks).map(([block, title]) => `<h4 class="jg-h4">${esc(title)}</h4>
    <ul class="jg-domains">${bundle.items.domains.filter((d) => d.block === block).map((d) => {
      const r = result.domains[d.id];
      const c = copy.report.domains[d.id];
      const val = r.score === null ? '<span class="jg-pending">回答不足</span>' : `${esc(r.displayScore)}${r.status === 'partial' ? '<small>（参考値）</small>' : ''}`;
      const bar = r.score === null ? '' : `<span class="jg-bar"><span style="width:${Math.max(0, Math.min(100, r.score)).toFixed(1)}%"></span></span>`;
      return `<li><div class="jg-domain-head"><span>${esc(c.label)}</span><span class="jg-val">${val}</span></div>${bar}
        <p>${esc(c.meaning)}。${esc(c.limit)}</p><p class="jg-reflect">${esc(c.reflection)}</p></li>`;
    }).join('')}</ul>`).join('');
}

export function renderMethod(copy) {
  const m = copy.method;
  return ['short_notice', 'score_notice', 'element_type_notice', 'character_notice', 'balance_notice', 'timeframe_notice', 'development_notice']
    .map((k) => `<p>${esc(m[k])}</p>`).join('');
}

// X の共有文の確認用（publicSummary だけから作る。runtime の makeShareText と同じ形式）
export function shareTextFromSummary(s, url) {
  const notes = [];
  if (s.element.hasExactTie) notes.push('※元素に同率候補があります。');
  if (s.type.hasExactTie) notes.push('※型に同率候補があります。');
  if (s.character.hasExactTie) notes.push('※人物に同率候補があります。');
  const tie = notes.length ? '\n' + notes.join('\n') : '';
  return `邪眼診断をやってみました。\n私の結果は、【${s.element.label}×${s.type.label}】\n\n最も近しいファトゥス：${s.character.label}（${s.character.matchPercent}%一致）${tie}\n\n${url}\n#邪眼診断 #原神`;
}

// =====================================================================
// 結果ページ（元素診断の結果ページと同じ構成：土台カード→最も近しい人物→渇望する邪眼→保存・共有→
//   今見えているもの→なぜ似ているか→土台ごとの解説と鍵→全てのロックを解除）
// =====================================================================
import { weightedSimilarity } from './engine/math.mjs';
import { ELEMENT_COLOR, ELEMENT_NAME, TYPE_COLOR, ELEMENT_TEXT, TYPE_TEXT, CHARACTER_ELEMENTS, DOMAIN_WORD, BLOCK_COLOR, FOUNDATION } from './site-copy.mjs';

const PRICE_LABEL = '¥1,000';
const lockSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor"/></svg>';
const checkSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function elementStyle(id) {
  const c = ELEMENT_COLOR[id];
  return c ? `--ec:${c.main};--ed:${c.dark};--eg:${c.glow}` : '';
}
export function characterGradient(id) {
  const els = CHARACTER_ELEMENTS[id] || [];
  const stops = els.length >= 2 ? [ELEMENT_COLOR[els[0]].main, ELEMENT_COLOR[els[1]].main]
    : els.length === 1 ? [ELEMENT_COLOR[els[0]].main, '#F4E6EA'] : ['#E2C08C', '#C8405C'];
  return `linear-gradient(100deg, ${stops[0]} 0%, ${stops[1]} 100%)`;
}

// 人物の参照パターンが示す型（参照値の六つの型の項目で最も高いもの。60未満なら偏りなし）
export function referenceTypeLabel(bundle, characterId) {
  const c = bundle.characters.characters.find((x) => x.id === characterId);
  if (!c) return null;
  const ts = bundle.interpretation.types.map((t) => ({ label: t.label, score: c.reference[t.domain] })).sort((a, b) => b.score - a.score);
  return ts[0].label; // 参照パターンで最も高い型（人物ごとのラベル。60未満でも最上位を示す）
}

// 三つの土台ごとの類似度（全体と同じ式・同じ重みを、その土台の項目に限って計算する）
export function groupSimilarity(result, bundle, characterId) {
  const model = bundle.characters;
  const c = model.characters.find((x) => x.id === characterId);
  const user = Object.fromEntries(model.axes.map((a) => [a, result.domains[a].score]));
  const out = {};
  for (const block of ['need', 'strategy', 'difficulty']) {
    const axes = bundle.items.domains.filter((d) => d.block === block).map((d) => d.id);
    out[block] = weightedSimilarity(user, c.reference, axes, model.weights);
  }
  return out;
}

// 傾向の言葉（50点から遠い順）。数値は出さない
export function tendencyWords(result, bundle, block, n) {
  return bundle.items.domains.filter((d) => !block || d.block === block)
    .filter((d) => result.domains[d.id].score !== null)
    .map((d) => ({ id: d.id, block: d.block, s: result.domains[d.id].score }))
    .sort((a, b) => Math.abs(b.s - 50) - Math.abs(a.s - 50) || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((x) => ({ word: DOMAIN_WORD[x.id][x.s >= 50 ? 0 : 1], color: BLOCK_COLOR[x.block] }));
}

function locks(words) {
  return `<div class="rx-locks">${words.map((w) => `<div class="rx-lock" style="--lc:${w.color}"><span class="rx-lock-ring">${lockSvg}</span><span class="rx-lock-word">${esc(w.word)}</span></div>`).join('')}</div>`;
}

function unlockCard(text, previewTitle) {
  return `<div class="rx-unlock">
      <span class="rx-unlock-icon">${lockSvg}</span>
      <p class="rx-unlock-title">今すぐロックを解除</p>
      <p class="rx-unlock-text">${esc(text)}</p>
      <p class="rx-unlock-price">${PRICE_LABEL}</p>
      <button type="button" class="rx-buy" data-buy disabled aria-disabled="true">全てのロックを解除する<small>準備中</small></button>
      <div class="rx-preview" aria-hidden="true">
        <p class="rx-preview-head">ロックの先にある内容 — <b>${esc(previewTitle)}</b></p>
        <div class="rx-blur">${'<i></i>'.repeat(7)}</div>
      </div>
    </div>`;
}

// 星座の図（赤黒。データの位置に依存しない装飾）
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

function mainCard(result, bundle) {
  const elOk = result.elements.status === 'available';
  const elId = elOk ? result.elements.primary : null;
  const el = elOk ? result.elements.rankings.find((r) => r.id === elId) : null;
  const typeOk = result.types.status !== 'insufficient';
  const typeId = typeOk ? (result.types.primary || 'NONE') : null;
  const typeLabel = typeOk ? (result.types.primary ? result.types.label : '型の偏りなし') : null;
  const et = elOk ? ELEMENT_TEXT[elId] : null;
  const tt = typeOk ? TYPE_TEXT[typeId] : null;
  const pending = '<span class="jg-pending">判定保留</span>';
  // 一言（データに基づく）
  const contrib = elOk ? elementContributions(result, bundle, elId)[0] : null;
  const elLine = contrib ? `最も寄与：${contrib.label}${contrib.inverse ? '（低さ）' : ''}` : '回答不足のため保留';
  let typeLine = '回答不足のため保留';
  if (typeOk) {
    const top = result.types.rankings[0];
    const dom = bundle.interpretation.types.find((t) => t.id === top.id).domain;
    typeLine = result.types.primary ? `${domainLabel(bundle, dom)}が最も強く表れた` : '六つの扱い方がいずれも基準未満';
  }
  const tieEl = elOk && result.elements.ties.length > 1;
  const tieType = typeOk && result.types.primary && result.types.rankings.filter((r) => r.rank === 1).length > 1;
  const summary = elOk && typeOk
    ? `つまり<b style="color:var(--ec)">【${esc(el.label)}×${esc(typeLabel)}】</b>は、「${esc(et.essence)}」という影を抱えながら、「${esc(tt.essence)}」かたちで揺れを扱っている状態——というのが、今回の回答が示す組み合わせの意味です。固定的な性格ではなく、最近1か月ほどのあなたの心の動きの表れです。`
    : '回答が足りない項目があるため、組み合わせのまとめは保留しています。';
  return `<section class="rx-card rx-main" style="${elOk ? elementStyle(elId) : ''}">
      <div class="rx-main-head"><span class="rx-kicker">あなたの邪眼</span><span class="rx-badge">JAGAN</span></div>
      <div class="rx-eye">${gemSvg(elOk ? ELEMENT_COLOR[elId].main : '#C8405C', 'main', 20)}</div>
      <h2 class="rx-title"><span class="rx-el">${elOk ? esc(el.label) : pending}</span><span class="rx-x">×</span><span class="rx-type" style="--tc:${typeOk ? TYPE_COLOR[typeId] : '#BDA9B0'}">${typeOk ? esc(typeLabel) : pending}</span></h2>
      <p class="rx-sub">${elOk ? esc(ELEMENT_NAME[elId]) : '判定保留'} ／ ${typeOk ? esc(tt.axis) : '判定保留'}</p>
      ${tieEl ? `<p class="jg-note">元素に計算上の同率候補があります（${esc(jaList(result.elements.ties.map((i) => result.elements.rankings.find((r) => r.id === i).label)))}）。</p>` : ''}
      ${tieType ? '<p class="jg-note">型に計算上の同率候補があります。</p>' : ''}
      <details class="rx-more">
        <summary>もっと詳しく見る <span class="arw">▾</span></summary>
        <p class="rx-more-h">邪眼と型とは</p>
        <p class="rx-more-lead">邪眼元素は、12項目の回答の組み合わせから導いた「心の影の象徴」。型は、六つの感情の扱い方のうち、今回もっとも強く表れたものです。</p>
        <div class="rx-tiles">
          <div class="rx-tile rx-tile-el"><b>邪眼（${elOk ? esc(el.label) : '保留'}）</b><span>——気質の軸</span><em>${esc(elLine)}</em></div>
          <div class="rx-tile rx-tile-ty" style="--tc:${typeOk ? TYPE_COLOR[typeId] : '#BDA9B0'}"><b>${typeOk ? esc(typeLabel) : '型（保留）'}</b><span>——感情の扱い方の軸</span><em>${esc(typeLine)}</em></div>
        </div>
        ${elOk ? `<p class="rx-sec-label">気質｜邪眼（${esc(el.label)}）</p>
        <p class="rx-text"><b style="color:var(--ec)">${esc(el.label)}の邪眼</b>——${esc(et.body.replace(/^.{1,4}の邪眼は、/, ''))}</p>` : ''}
        ${typeOk ? `<p class="rx-sec-label">感情の扱い方｜${esc(typeLabel)}</p>
        <p class="rx-text"><b style="color:${TYPE_COLOR[typeId]}">${esc(typeLabel)}</b>——${esc(tt.body.replace(/^.{1,6}は、/, ''))}</p>` : ''}
        <blockquote class="rx-summary">${summary}</blockquote>
      </details>
    </section>`;
}

function fatuiCard(result, bundle, copy) {
  const ch = result.characters;
  if (ch.status !== 'available') {
    return `<section class="rx-card rx-fatui"><p class="rx-kicker">最も近しいファトゥス</p><p class="jg-pending-block">人物との比較には12項目すべての回答が必要なため、判定を保留しています。</p></section>`;
  }
  const top = ch.rankings[0];
  const story = copy.character.characters[top.id];
  const second = ch.rankings[1];
  let note = '';
  if (ch.ties.length > 1) note = `計算上の同率候補があります（${jaList(ch.ties.map((i) => ch.rankings.find((r) => r.id === i).label))}）。`;
  else if (ch.closeCandidates.length > 1) note = `近い候補：${jaList(ch.closeCandidates.filter((i) => i !== top.id).map((i) => ch.rankings.find((r) => r.id === i).label))}（2位との差 ${ch.gapToSecond < 0.05 ? '0.1点未満' : ch.gapToSecond.toFixed(1) + '点'}${second && second.displayScore === top.displayScore ? '。表示上は同じ%ですが同率ではありません' : ''}）`;
  return `<section class="rx-card rx-fatui">
      <p class="rx-kicker">最も近しいファトゥス</p>
      <div class="rx-fatui-row">
        <div>
          <p class="rx-fatui-name${top.label.length >= 6 ? ' is-long' : ''}" style="background-image:${characterGradient(top.id)}">${esc(top.label)}</p>
          <div class="rx-tags"><span class="rx-tag">「${esc(story.title)}」</span><span class="rx-tag rx-tag-type">${esc(referenceTypeLabel(bundle, top.id))}</span></div>
        </div>
        <div class="rx-pct"><b>${esc(top.displayScore)}<small>%</small></b><span>一致度</span></div>
      </div>
      ${note ? `<p class="jg-note">${esc(note)}</p>` : ''}
      <p class="jg-note">作品の描写を参考に設計した回答参照パターンとの近さです。<a href="/jagan/about">一致度の意味</a></p>
    </section>`;
}

function cravingCard(result) {
  if (result.elements.status !== 'available') return `<section class="rx-card"><p class="rx-h3">あなたの渇望する邪眼</p><p class="jg-pending-block">回答不足のため判定保留</p></section>`;
  const r = result.elements.rankings;
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
  const open = ['邪眼元素と型の判定結果', '最も近しいファトゥス1名', 'なぜ似ているかの簡易な理由'];
  const locked = ['12項目のスコアと、それぞれの読み解き', '欲求の充足と阻害（6項目）の詳細', '感情の扱い方と困難（6項目）の詳細', '近しいファトゥス3名との共通点・相違点', '判定根拠（なぜその組み合わせになったか）'];
  return `<section class="rx-card rx-seeing">
      <p class="rx-seeing-k">今、あなたが見ているもの</p>
      <ul>${open.map((t) => `<li class="on"><span>${checkSvg}</span>${esc(t)}</li>`).join('')}${locked.map((t) => `<li><span class="lk">${lockSvg}</span>${esc(t)}</li>`).join('')}</ul>
      <p class="rx-seeing-foot">ここで見えているのは、あなたの深淵の一部分に過ぎません。</p>
    </section>`;
}

function whyCard(result, bundle) {
  const ch = result.characters;
  if (ch.status !== 'available') return '';
  const top = ch.rankings[0];
  const ex = explainCharacter(result, bundle.characters, top.id);
  const aligned = ex.aligned.map((x) => `「${domainLabel(bundle, x.axis)}」`);
  const sim = groupSimilarity(result, bundle, top.id);
  const bars = [['need', '欲求の類似度', '#C98A5A'], ['strategy', '感情の扱い方の類似度', '#8E7CD0'], ['difficulty', '困難の類似度', '#C8405C']];
  const nameStyle = `background-image:${characterGradient(top.id)}`;
  const text = aligned.length
    ? `<b class="rx-grad" style="${nameStyle}">${esc(top.label)}</b>との一致度は<b>${esc(top.displayScore)}%</b>。特に${esc(aligned.join(''))}が、${esc(top.label)}の参照パターンとあなたとで近い値を示しています。`
    : `<b class="rx-grad" style="${nameStyle}">${esc(top.label)}</b>との一致度は<b>${esc(top.displayScore)}%</b>。個別に際立って近い項目は限られますが、12項目全体の距離が最も近い参照パターンです。`;
  const others = ch.rankings.slice(1, 4);
  return `<section class="rx-card rx-why">
      <p class="rx-sec-h"><i></i>なぜあなたは似ているか</p>
      ${constellation('#E2C08C', 'CONSTELLATION OF SHADOWS')}
      <p class="rx-text">${text}</p>
      ${bars.map(([k, label, c]) => `<div class="rx-sim" style="--sc:${c}"><p><span>${label}</span><b>${Math.round(sim[k])}<small>%</small></b></p><span class="rx-sim-bar"><i style="width:${Math.max(0, Math.min(100, sim[k])).toFixed(1)}%"></i></span></div>`).join('')}
      <hr class="rx-hr">
      <p class="rx-h4">あなたの影の特性</p>
      <p class="rx-lead">次に近しいファトゥス 3名</p>
      <div class="rx-top-locked">${others.map((o, i) => `<div><span>${i + 2}位</span><b>${'■'.repeat(Math.max(3, Math.min(6, o.label.length)))}</b><em>${'--'}%</em></div>`).join('')}</div>
      ${locks(tendencyWords(result, bundle, null, 4))}
      ${unlockCard('近しいファトゥス3名とあなたの、重なる項目と離れている項目を、物語とあわせて読み解きます。', '近しいファトゥス3名の共通点と相違点')}
    </section>`;
}

function foundationCard(result, bundle, block, color) {
  const f = FOUNDATION[block];
  const domains = bundle.items.domains.filter((d) => d.block === block);
  const avail = domains.filter((d) => result.domains[d.id].score !== null);
  // 相対的に目立つ項目（数値は出さない）
  const stand = avail.slice().sort((a, b) => Math.abs(result.domains[b.id].score - 50) - Math.abs(result.domains[a.id].score - 50))[0];
  const standText = stand
    ? `今回のあなたの回答では、この土台のうち<b>「${esc(stand.label)}」</b>が${result.domains[stand.id].score >= 50 ? '比較的強く' : '比較的弱く'}表れています。`
    : 'この土台は回答不足のため、読み解きを保留しています。';
  const tags = tendencyWords(result, bundle, block, block === 'strategy' ? 2 : 3).map((w) => `<span class="rx-tag">${esc(w.word)}</span>`).join('');
  return `<section class="rx-card rx-found">
      <p class="rx-sec-h" style="--dot:${color}"><i></i>${esc(f.title)}</p>
      ${constellation(color, f.en)}
      <p class="rx-text">${esc(f.intro)}</p>
      <p class="rx-text">${standText}</p>
      <div class="rx-tags">${tags}</div>
      <hr class="rx-hr">
      <p class="rx-h4">${esc(f.lockTitle)}</p>
      ${locks(tendencyWords(result, bundle, block, block === 'strategy' ? 2 : 4))}
      ${unlockCard(f.unlock, f.preview)}
    </section>`;
}

function unlockAll() {
  const items = [
    ['12項目のスコアと読み解き', '欲求・感情の扱い方・困難の全項目を、数値と意味・読み方の限界とともに解説'],
    ['欲求の充足と阻害', '三つの欲求が、どこで満たされ、どこで阻まれているか'],
    ['感情の扱い方と困難', '捉え直し・表出抑制と、つらいときの四つの難しさ'],
    ['邪眼元素と型の判定根拠', 'なぜその組み合わせに至ったか、寄与した項目から解説'],
    ['近しいファトゥス3名', '参照パターンとの共通点・相違点と、物語からの振り返りの問い'],
  ];
  return `<section class="rx-card rx-all">
      <p class="rx-all-en">UNLOCK EVERYTHING</p>
      <p class="rx-all-h">あなたの邪眼と型とファトゥスについての<br>全てを解放</p>
      <p class="rx-lead jg-center">ここまでは、あなたの深淵の輪郭だけです。その先にあるものを、12項目のデータから解き明かします。</p>
      <div class="rx-all-list"><p class="rx-all-k">ご利用いただける内容</p>${items.map(([h, d]) => `<p><b>✓ ${esc(h)}</b><span>${esc(d)}</span></p>`).join('')}</div>
      <p class="rx-all-price">${PRICE_LABEL}<small>買い切り</small></p>
      <button type="button" class="rx-buy rx-buy-all" data-buy disabled aria-disabled="true">全てのロックを解除する<small>準備中</small></button>
      <p class="jg-small jg-center">販売開始の準備中です。現在は購入できません。</p>
      <p class="jg-center"><a class="rx-link" href="/jagan/sample">内容のサンプルを見る</a></p>
    </section>`;
}

export function renderResultPage(result, bundle, copy) {
  return [
    mainCard(result, bundle),
    fatuiCard(result, bundle, copy),
    cravingCard(result),
    actions(),
    seeingCard(),
    whyCard(result, bundle),
    foundationCard(result, bundle, 'need', BLOCK_COLOR.need),
    foundationCard(result, bundle, 'strategy', BLOCK_COLOR.strategy),
    foundationCard(result, bundle, 'difficulty', BLOCK_COLOR.difficulty),
    unlockAll(),
  ].join('\n');
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
// 解析レポート（元素診断の解析レポートと同じ構成：表紙→01 土台→02〜04 データの深層→05 近しい人物→06 総括）
//   サンプルと、販売開始後の本人のレポートで共通。
// =====================================================================
const BLOCK_INFO = {
  need: { no: '02', title: '欲求の充足と阻害', en: 'Basic Psychological Needs', fig: 'THREE BASIC NEEDS' },
  strategy: { no: '03', title: '感情の扱い方', en: 'Emotion Regulation', fig: 'TWO STRATEGIES' },
  difficulty: { no: '04', title: '感情調整の困難', en: 'Regulation Difficulties', fig: 'FOUR DIFFICULTIES' },
};
const SCALE_NOTE = '数値は0〜100。<b class="hi">60以上</b>＝はっきり表れている、41〜59＝場面によって表れる、<b class="lo">40以下</b>＝控えめ、として説明しています。一般の人の中での順位ではなく、この診断の設計上の目安です。';
const level = (s) => (s >= 60 ? '高め' : s <= 40 ? '控えめ' : '中程度');

function ring(score, color, label) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score));
  return `<div class="rp-ring" style="--rc:${color}"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="5"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle">${Math.round(v)}%</text></svg><span>${esc(label)}</span></div>`;
}
function bar(result, bundle, copy, d, color) {
  const r = result.domains[d.id];
  const c = copy.report.domains[d.id];
  if (r.score === null) return `<div class="rp-bar"><p class="rp-bar-h"><span>${esc(c.label)}</span><b>保留</b></p><p class="rp-bar-t">回答不足のため計算していません。</p></div>`;
  return `<div class="rp-bar" style="--bc:${color}">
      <p class="rp-bar-h"><span>${esc(c.label)}<small>${esc(d.id.replace('_', '-'))}</small></span><b>${r.displayScore}${r.status === 'partial' ? '<small>参考</small>' : ''}</b></p>
      <span class="rp-track"><i style="width:${Math.max(2, r.score).toFixed(1)}%"></i></span>
      <p class="rp-bar-t">${esc(c.meaning)}。<em class="lv-${level(r.score)}">${level(r.score)}</em> — ${esc(c.limit)}</p>
      <p class="rp-bar-q">${esc(c.reflection)}</p>
    </div>`;
}
function listItems(result, bundle, copy, ids, mark, note) {
  return ids.map((id) => {
    const c = copy.report.domains[id];
    return `<div class="rp-li"><span class="rp-mark rp-mark-${mark}">${mark === 'up' ? '✓' : '!'}</span><div><b>${esc(c.label)}（${result.domains[id].displayScore}点）</b>
      <p>${esc(c.meaning)}${note}</p><small>${esc(c.limit)}</small></div></div>`;
  }).join('');
}

export function renderReport(result, bundle, copy) {
  const elOk = result.elements.status === 'available';
  const typeOk = result.types.status !== 'insufficient';
  const elId = elOk ? result.elements.primary : null;
  const el = elOk ? result.elements.rankings.find((r) => r.id === elId) : null;
  const typeId = typeOk ? (result.types.primary || 'NONE') : null;
  const typeLabel = typeOk ? (result.types.primary ? result.types.label : '型の偏りなし') : '判定保留';
  const et = elOk ? ELEMENT_TEXT[elId] : null;
  const tt = typeOk ? TYPE_TEXT[typeId] : null;
  const chOk = result.characters.status === 'available';
  const top = chOk ? result.characters.rankings[0] : null;
  const ec = elOk ? ELEMENT_COLOR[elId] : { main: '#C8405C', dark: '#5E1426' };
  const scored = bundle.items.domains.filter((d) => result.domains[d.id].score !== null);
  const sorted = scored.slice().sort((a, b) => result.domains[b.id].score - result.domains[a.id].score || a.id.localeCompare(b.id));
  const highs = sorted.slice(0, 3).map((d) => d.id);
  const lows = sorted.slice(-3).reverse().map((d) => d.id);
  // 元素の判定に寄与した4項目（重みの大きい順）
  const contrib = elOk ? Object.entries(bundle.interpretation.elements.find((e) => e.id === elId).weights)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([axis, w]) => ({ axis, w })) : [];

  const cover = `<section class="rp-cover" style="--ec:${ec.main};--ed:${ec.dark}">
      <div class="rp-emblem"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="84" fill="none" stroke="color-mix(in srgb, var(--ec) 45%, transparent)"/><circle cx="100" cy="100" r="60" fill="none" stroke="rgba(255,255,255,.06)"/>
        ${[[16, 100], [184, 100], [100, 16], [148, 168], [52, 168], [160, 40]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${i % 2 ? '#E2C08C' : ec.main}"/>`).join('')}</svg>
        <b>${elOk ? esc(el.label) : '—'}</b></div>
      <p class="rp-cover-en">DELUSION DIAGNOSIS — ${elOk ? esc(el.label) : ''}</p>
      <h1 class="rp-cover-title">邪眼診断<br>解析レポート</h1>
      <p class="rp-cover-code">${elOk ? esc(ELEMENT_NAME[elId]) : '判定保留'}</p>
      <p class="rp-cover-type">${esc(typeLabel)}</p>
      <p class="rp-cover-sub">${elOk ? esc(el.label) : '保留'} × ${esc(typeLabel)}${top ? ` × ${esc(top.label)}` : ''}</p>
    </section>`;

  const s01 = `<section class="rp-card">
      <p class="rp-no">01</p>
      <h2 class="rp-h2">あなたの邪眼 — ${elOk ? `<span style="color:${ec.main}">${esc(el.label)}</span>` : '保留'} × ${esc(typeLabel)}</h2>
      ${elOk ? `<p class="rp-text">${esc(et.body)}</p>` : '<p class="jg-pending-block">回答不足のため元素の判定を保留しています。</p>'}
      ${typeOk ? `<p class="rp-text">${esc(tt.body)}</p>` : ''}
      ${elOk && typeOk ? `<blockquote class="rp-quote" style="--ec:${ec.main}">この二つが重なるとき、「${esc(et.essence)}」という影が、「${esc(tt.essence)}」かたちを通して表に現れます。</blockquote>` : ''}
      ${constellation(ec.main, 'DELUSION RESONANCE MAP')}
    </section>
    ${elOk ? `<section class="rp-card">
      <p class="rp-en">CONNECTING FACTORS</p>
      <h3 class="rp-h3">あなたの邪眼（${esc(el.label)}）を形作る項目</h3>
      <div class="rp-rings">${contrib.map((c) => ring(c.w < 0 ? 100 - result.domains[c.axis].score : result.domains[c.axis].score, c.w < 0 ? '#7A6A8A' : ec.main, domainLabel(bundle, c.axis) + (c.w < 0 ? '（低さ）' : ''))).join('')}</div>
      <p class="rp-note">（低さ）の項目は、値が低いほどこの邪眼に寄与します（リングは 100−得点 で表示）。</p>
      <p class="rp-sub-h up">◆ はっきり表れている項目（上位3）</p>
      ${listItems(result, bundle, copy, highs, 'up', '。この項目の高さが、今回の結果に関わっています。')}
      <p class="rp-sub-h down">◆ 控えめな項目（下位3）</p>
      ${listItems(result, bundle, copy, lows, 'down', '。この項目は、今回の回答では控えめに表れています。')}
    </section>` : ''}`;

  const blocks = ['need', 'strategy', 'difficulty'].map((block) => {
    const info = BLOCK_INFO[block];
    const f = FOUNDATION[block];
    const color = BLOCK_COLOR[block];
    const ds = bundle.items.domains.filter((d) => d.block === block);
    const av = ds.filter((d) => result.domains[d.id].score !== null);
    const hi = av.slice().sort((a, b) => result.domains[b.id].score - result.domains[a.id].score)[0];
    const lo = av.slice().sort((a, b) => result.domains[a.id].score - result.domains[b.id].score)[0];
    const quote = hi && lo && hi.id !== lo.id
      ? `この領域でいちばん強く表れているのは<b style="color:${color}">「${esc(hi.label)}」</b>（${result.domains[hi.id].displayScore}）、いちばん控えめなのは<b style="color:${color}">「${esc(lo.label)}」</b>（${result.domains[lo.id].displayScore}）です。${esc(copy.report.domains[hi.id].reflection)}`
      : '回答不足の項目があるため、この領域の比較は保留しています。';
    return `<section class="rp-card">
      <p class="rp-no">${info.no}</p>
      <h2 class="rp-h2" style="color:${color}">${esc(info.title)} — <span class="rp-h2-en">${esc(info.en)}</span></h2>
      <p class="rp-text">${esc(f.intro)}</p>
      <blockquote class="rp-quote" style="--ec:${color}">${quote}</blockquote>
      ${ds.map((d) => bar(result, bundle, copy, d, color)).join('')}
      <p class="rp-note">${SCALE_NOTE}</p>
    </section>`;
  }).join('');

  const s05 = chOk ? `<section class="rp-card">
      <p class="rp-no">05</p>
      <h2 class="rp-h2">近しいファトゥス — <span class="rp-h2-en">Character Match</span></h2>
      <p class="rp-text">11名の回答参照パターンとの照合結果です。比較先は、作品の描写を参考に作者が設計した「回答の参照パターン」で、人物本人の心理得点ではありません。</p>
      ${constellation('#E2C08C', 'CONSTELLATION OF SHADOWS')}
      ${result.characters.rankings.slice(0, 3).map((c, i) => {
        const story = copy.character.characters[c.id];
        const ex = explainCharacter(result, bundle.characters, c.id);
        const row = (x) => `${esc(domainLabel(bundle, x.axis))}（あなた ${Math.round(x.userScore)}／参照 ${Math.round(x.referenceScore)}）`;
        return `<div class="rp-match">
          <p class="rp-match-h"><span class="rp-match-no">${c.rank}</span><b class="rx-grad" style="background-image:${characterGradient(c.id)}">${esc(c.label)}</b><em>${c.displayScore}%</em></p>
          <div class="rx-tags"><span class="rx-tag">「${esc(story.title)}」</span><span class="rx-tag rx-tag-type">${esc(referenceTypeLabel(bundle, c.id))}</span></div>
          <p class="rp-text sm">${esc(story.story_context)}</p>
          <p class="rp-text sm"><b class="near">近い項目：</b>${ex.aligned.length ? ex.aligned.map(row).join('、') : esc(copy.character.no_aligned_axes)}</p>
          <p class="rp-text sm"><b class="far">差のある項目：</b>${ex.different.length ? ex.different.map(row).join('、') : esc(copy.character.no_different_axes)}</p>
          <p class="rp-q">${esc(story.reflection)}</p>
        </div>`;
      }).join('')}
      <p class="rp-note">${esc(copy.character.global_notice)}15点・20点は説明のための設計値で、心理学上の基準ではありません。</p>
    </section>` : '';

  const sentence = (block) => {
    const ds = bundle.items.domains.filter((d) => d.block === block && result.domains[d.id].score !== null);
    const hi = ds.slice().sort((a, b) => result.domains[b.id].score - result.domains[a.id].score)[0];
    return hi ? `「${esc(hi.label)}」（${result.domains[hi.id].displayScore}）がもっとも強く表れています。` : '回答不足のため保留しています。';
  };
  const s06 = `<section class="rp-card">
      <p class="rp-no">06</p>
      <h2 class="rp-h2">総括 — 欲求・扱い方・困難の統合</h2>
      <p class="rp-en gold">NEEDS × REGULATION × DIFFICULTIES</p>
      <div class="rp-sum" style="--bc:${BLOCK_COLOR.need}"><p class="k">NEEDS<span>何を求め、何に阻まれているか</span></p><p>欲求の領域では、${sentence('need')}</p></div>
      <div class="rp-sum" style="--bc:${BLOCK_COLOR.strategy}"><p class="k">REGULATION<span>揺れをどう扱うか</span></p><p>感情の扱い方では、${sentence('strategy')}</p></div>
      <div class="rp-sum" style="--bc:${BLOCK_COLOR.difficulty}"><p class="k">DIFFICULTIES<span>つらいときに何が難しいか</span></p><p>感情調整の困難では、${sentence('difficulty')}</p></div>
      <div class="rp-final">${elOk && typeOk ? `この3つの層が重なって、<b style="color:${ec.main}">【${esc(el.label)}×${esc(typeLabel)}】</b>という深淵の輪郭が描かれています。${esc(copy.result.element[elId].reflection)}` : '回答不足の項目があるため、統合の説明は保留しています。'}</div>
      ${elOk ? '' : ''}
      <p class="rp-note">${esc(copy.method.short_notice)}${esc(copy.method.development_notice)}</p>
    </section>`;

  return cover + s01 + blocks + s05 + s06;
}
