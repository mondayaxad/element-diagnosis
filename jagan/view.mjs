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

// 邪眼解析レポートの本文（サンプルページと、販売開始後の本人のレポートで共通）
export function renderReport(result, bundle, copy) {
  const chars = result.characters.status === 'available' ? result.characters.rankings.slice(0, 3) : [];
  return `<section class="jg-card">${renderHeadline(result)}<div class="jg-explain">${renderExplanation(result, bundle, copy)}</div></section>
    <section class="jg-card"><h3 class="jg-h3">12項目のスコア</h3><p class="jg-note">${esc(copy.report.score_notice)}</p>${renderDomainTable(result, bundle, copy)}</section>
    <section class="jg-card"><h3 class="jg-h3">元素の順位</h3>${result.elements.status === 'available'
      ? `<ol class="jg-ranklist">${result.elements.rankings.map((e) => `<li>${esc(e.rank)}. ${esc(e.label)}（${esc(e.displayScore)}）</li>`).join('')}</ol>` : '<p class="jg-pending-block">回答不足のため判定保留</p>'}
      ${result.elements.status === 'available' ? `<p class="jg-reflect">${esc(copy.result.element[result.elements.primary].reflection)}</p>` : ''}</section>
    <section class="jg-card"><h3 class="jg-h3">近しい人物候補と相違</h3>${chars.length ? chars.map((c) =>
      `<details class="jg-details"${c.rank === 1 ? ' open' : ''}><summary>${esc(c.rank)}. ${esc(c.label)}（${esc(c.displayScore)}%一致）</summary>${renderCharacterDetail(result, bundle, copy, c.id)}</details>`).join('')
      : '<p class="jg-pending-block">回答不足のため判定保留</p>'}</section>
    <section class="jg-card"><h3 class="jg-h3">方法について</h3>${renderMethod(copy)}</section>`;
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
