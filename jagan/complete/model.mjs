// jagan/complete/model.mjs — 邪眼完全解析「DIPPER」（叩き台）の中身を、DTI の算出結果（computeDiagnosis の結果）から組み立てる。
//   画面（view.mjs）はこの中身だけを使う。数値・順位はすべて結果と同じ版の計算から取る（新しい採点はしない）。
//   ・邪眼元素の全体順位：result.element.ranking（1位の選定と同じ規則）
//   ・異相の全体順位：orderIsou（1位は必ず result.isou と同じ）
//   ・ファトゥスの順位：result.characterOrder（人物ごとの出やすさの偏りを補正した順）。1位の一致度は結果ページと同じ character.match
import { orderIsou } from '../engine/dti.mjs';
import { explainCharacter } from '../engine/runtime.mjs';
import { ELEMENT_TEXT, ELEMENT_NAME, ELEMENT_STORY, ELEMENT_COLOR, ISOU_TEXT, ISOU_SHORT, ISOU_COLOR, TRAIT_COPY, GROUPS, CHARACTER_COPY, FATUI_TONE, FATUI_TONE_EXTRA } from '../site-copy.mjs';
import { PRODUCT, ELEMENT_DEEP, TRAIT_DEEP, FATUI_DEEP, DOMAIN_DEEP, FIXED, PANEL, typeOverview, ELEMENT_LIVE, TRAIT_READ, LIVE_INTRO, LIVE_ROWS, READ_INTRO, READ_ROWS, DETAIL_LABELS, TRAIT_PHRASE, ELEMENT_DETAIL, TRAIT_DETAIL, COMBO_LABELS, ELEMENT_COMBO, TRAIT_COMBO, ELEMENT_LIVE as _EL_LIVE } from './copy.mjs';

const r1 = (x) => Math.round(x * 10) / 10;

export function buildComplete(result, bundle, { diagnosedAt = null } = {}) {
  if (!result || result.schemaVersion !== 'jagan-result-3') throw new Error('result_not_supported');
  const traitLabel = (id) => bundle.items.traits.find((t) => t.id === id).label;
  const score = (id) => result.traits[id].score;
  const el = result.element, is = result.isou;

  const elements = el.ranking.map((e, i) => ({
    id: e.id, label: e.label, rank: i + 1, score: Math.round(e.score), name: ELEMENT_NAME[e.id], color: ELEMENT_COLOR[e.id],
    text: ELEMENT_TEXT[e.id], deep: ELEMENT_DEEP[e.id], live: ELEMENT_LIVE[e.id], story: ELEMENT_STORY[e.id],
    parts: Object.entries(bundle.core.elements.find((x) => x.id === e.id).weights).sort((a, b) => b[1] - a[1])
      .map(([t, w]) => ({ id: t, label: traitLabel(t), weight: Math.round(w * 100), score: Math.round(score(t)) })),
  }));
  const isous = orderIsou(result.answers, bundle.items).map((x) => ({
    id: x.id, label: traitLabel(x.id), rank: x.rank, score: Math.round(score(x.id)), color: ISOU_COLOR[x.id],
    text: ISOU_TEXT[x.id], short: ISOU_SHORT[x.id], copy: TRAIT_COPY[x.id], deep: TRAIT_DEEP[x.id], read: TRAIT_READ[x.id],
    aspect: bundle.dti.aspects.find((a) => a.trait_id === x.id),
  }));
  if (isous[0].id !== is.id) throw new Error('isou_order_mismatch');

  const ch = result.character.status === 'available' ? result.character : null;
  const fatui = result.characterOrder.map((c, i) => {
    const ex = explainCharacter(result, bundle, c.id);
    const meta = bundle.characters.characters.find((x) => x.id === c.id);
    return {
      id: c.id, name: c.name, rank: i + 1, title: meta.title, tags: meta.tags, region: meta.region_label,
      match: i === 0 && ch && ch.id === c.id ? ch.match : Math.round(c.rawSimilarity),
      // 人物名の色：オーナー指定の組み合わせ（マイページと同じ）。黒で終わる人物は、文字が読める暗さまで
      elements: (FATUI_TONE[c.id] || []).map((k) => (ELEMENT_COLOR[k] ? ELEMENT_COLOR[k].main : FATUI_TONE_EXTRA[k] === FATUI_TONE_EXTRA.BLACK ? '#7a2a2a' : FATUI_TONE_EXTRA[k])),
      tone: FATUI_TONE[c.id] || [],
      aligned: ex.aligned.map((x) => ({ label: traitLabel(x.axis), you: Math.round(x.userScore), ref: Math.round(x.referenceScore) })),
      different: ex.different.map((x) => ({ label: traitLabel(x.axis), you: Math.round(x.userScore), ref: Math.round(x.referenceScore) })),
      copy: CHARACTER_COPY[c.id], deep: FATUI_DEEP[c.id], selected: !!(ch && ch.id === c.id),
    };
  });

  const avg = (ids) => ids.reduce((s, id) => s + score(id), 0) / ids.length;
  const overall = avg(bundle.items.traits.map((t) => t.id));
  const domains = GROUPS.map((g) => {
    const traits = g.traits.map((id) => ({ id, label: traitLabel(id), score: Math.round(score(id)), color: ISOU_COLOR[id], deep: TRAIT_DEEP[id] }))
      .sort((a, b) => b.score - a.score);
    const a = avg(g.traits);
    return { id: g.id, label: g.short, color: g.color, title: g.title, intro: g.intro, deep: DOMAIN_DEEP[g.id], traits, avg: r1(a), diff: r1(a - overall) };
  });
  const domainOrder = [...domains].sort((a, b) => b.avg - a.avg);

  const topI = isous.slice(0, 3), lowI = isous.slice(-3).reverse();
  const topE = elements.slice(0, 3), lowE = elements.slice(-2).reverse();
  const topF = fatui.slice(0, 3);
  // 各邪眼元素に連なるファトゥス（色の組み合わせにその元素を含む人物。順位の高い順）
  for (const e of elements) e.fatui = fatui.filter((f) => f.tone.includes(e.id)).slice(0, 3).map((f) => ({ name: f.name, rank: f.rank, elements: f.elements }));
  // 7日間の観察：上位の異相から順に（足りなければ次の順位へ）
  const days = isous.slice(0, 7).map((x, i) => ({ day: i + 1, label: x.label, color: x.color, q: x.deep.exp }));

  // 12特性の山（上位2）・谷（下位2）：数値の高い順（異相の選定の規則ではなく、得点そのもの）
  const byScore = bundle.items.traits.map((t) => ({ id: t.id, label: t.label, score: Math.round(score(t.id)), color: ISOU_COLOR[t.id], copy: TRAIT_COPY[t.id] }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const peaks = byScore.slice(0, 2), valleys = byScore.slice(-2).reverse();
  // ファトゥスのタグ（色の組み合わせの元素）と、上位5名に繰り返し現れる物語のテーマ
  for (const f of fatui) f.chips = f.tone.filter((k) => ELEMENT_COLOR[k]).map((k) => ({ label: bundle.core.elements.find((e) => e.id === k).label, color: ELEMENT_COLOR[k].main }));
  const tagCount = {};
  fatui.slice(0, 5).forEach((f) => f.tags.forEach((t) => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const themes = Object.entries(tagCount).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 3);
  // TOP3 の比較の文（重なる特性・離れている特性から）
  for (const f of fatui.slice(0, 3)) {
    const al = f.aligned.map((x) => x.label), df = f.different[0];
    f.compare = `${f.name}とは、${al.length ? `${al.join('・')}の数値が近く、影の向きが重なります。` : '参照した特性の中で、明確に重なる項目は限られています。'}`
      + (df ? `一方で、${df.label}は${df.ref > df.you ? `${f.name}の方がはっきりしています` : 'あなたの方がはっきりしています'}（あなた ${df.you}／参照 ${df.ref}）。` : '大きく離れている特性はありません。');
  }
  // P12–P17 個別ページ：見出しの次点との差、根拠、「あなたの場合」の冒頭（今回の得点から組み立てる）
  for (const e of topE) e.detail = elementDetail(e, elements[e.rank]);
  for (const x of topI) x.detail = isouDetail(x, isous, topE, r1(overall));
  const combo = comboOf(elements[0], isous[0]);
  return {
    product: PRODUCT, detailLabels: DETAIL_LABELS, combo, fixed: FIXED, panel: PANEL, diagnosedAt,
    live: { intro: LIVE_INTRO, rows: LIVE_ROWS }, read: { intro: READ_INTRO, rows: READ_ROWS },
    peaks, valleys, themes,
    gapE: { a: elements[0], b: elements[1], d: elements[0].score - elements[1].score },
    gapI: { a: isous[0], b: isous[1], d: isous[0].score - isous[1].score },
    dti: { code: result.dti.code, name: result.dti.name },
    element: elements[0], isou: isous[0], character: ch ? fatui[0] : null,
    overview: typeOverview({ name: result.dti.name, code: result.dti.code, element: el.label, isou: is.label, elText: ELEMENT_TEXT[el.id], isouText: ISOU_TEXT[is.id] }),
    elements, isous, fatui, fatuiTop: fatui.slice(0, 6), fatuiRest: fatui.slice(6),
    topE, lowE, topI, lowI, topF,
    domains, domainOrder, overall: r1(overall), days,
    emblem: { PY: 'pyro', HY: 'hydro', CR: 'cryo', EL: 'electro', AN: 'anemo', GE: 'geo', DE: 'dendro' }[el.id],
  };
}

const N = (id) => TRAIT_PHRASE[id].noun, ONLY = (id) => TRAIT_PHRASE[id].only;
const CLOSE = 5;

// 邪眼：構成特性（計算上の重みの順）の得点の並びから、今回の現れ方の文を選ぶ（オーナー案の水・草・岩の書き方を一般化）
//   ①上位2つが近く、3つ目が離れている → 「主に A と B」＋「C だけで説明することはできない」
//   ②得点が最も高い特性が、重みの最も大きい特性ではない → 「A が比較的高い。B や C に加え、A が〜の一因になっていないか」
//   ③それ以外 → 高い特性と低い特性の配置
export function elementYou(e, d) {
  const L = e.label, parts = e.parts, core = parts[0];
  const s = [...parts].sort((a, b) => b.score - a.score || b.weight - a.weight);
  const out = [];
  if (s[0].score - s[1].score <= CLOSE && s[1].score - s[2].score >= 10) {
    out.push(`今回の${L}を形づくっているのは、主に${s[0].label}と${s[1].label}です。${N(s[0].id)}と、${N(s[1].id)}が、近い得点で表れています。`);
    out.push(`一方、${s[2].label}の得点は二つより低く、今回の${L}を「${ONLY(s[2].id)}」だけで説明することはできません。`);
  } else if (s[0].id !== core.id && s[0].score > core.score) {
    const others = parts.filter((p) => p.id !== s[0].id).map((p) => N(p.id));
    out.push(`今回の${L}では、構成特性の中で${s[0].label}の得点が比較的高く出ています（計算上の重みが最も大きいのは${core.label}）。${others.join('や、')}に加え、${N(s[0].id)}が、${d.loop}一因になっていないかを検討できます。`);
  } else if (s[0].score - s[2].score >= 10) {
    out.push(`今回の${L}は、構成特性の中では${s[0].label}が高く、${s[2].label}が低い配置です。そのため、「${ONLY(s[2].id)}」だけでなく、${N(s[0].id)}から来る反応に目を向けます。`);
  } else {
    out.push(`今回の${L}では、${parts.map((p) => p.label).join('・')}の三つが近い得点で重なっています。どれか一つではなく、${N(s[0].id)}と、${N(s[1].id)}が組み合わさって表れていないかを見ていきます。`);
  }
  return out;
}
function elementDetail(e, next) {
  const d = ELEMENT_DETAIL[e.id];
  return { ...d, you: [...elementYou(e, d), ...d.read], next: next ? { label: next.label, score: next.score, d: e.score - next.score } : null, core: e.parts[0].id };
}

// 異相：12特性の中での位置（隣の順位との近さ）と、上位の邪眼の計算に含まれているか
export function isouYou(x, isous, topE) {
  const r = x.rank, out = [];
  const nb = r === 1 ? isous[1] : isous[r - 2];
  const gap = Math.abs(x.score - nb.score), close = gap <= CLOSE;
  if (r === 1) out.push(`今回の回答では${x.label}が最上位で、${close ? `${nb.label}も近い得点です。` : `2位の${nb.label}とは${gap}点の差があります。`}`);
  else out.push(`今回の回答で${x.label}は${r}位です。${close ? `${r - 1}位の${nb.label}と近い得点です。` : `${r - 1}位の${nb.label}とは${gap}点の差があります。`}`);
  if (close) out.push(`${N(x.id)}と、${N(nb.id)}が重なって表れていないかを確かめます。`);
  const inc = topE.filter((e) => e.parts.some((p) => p.id === x.id));
  if (inc.length) out.push(`${x.label}は、上位の邪眼のうち${inc.map((e) => e.label).join('と')}の計算にも含まれています。${inc.length >= 2 ? '複数の結果に同じ特性が現れていますが、それぞれ独立した証拠ではありません。' : ''}`);
  return { lines: out, inc: inc.map((e) => ({ label: e.label, color: e.color.main })) };
}
function isouDetail(x, isous, topE, overall) {
  const d = TRAIT_DETAIL[x.id], y = isouYou(x, isous, topE), next = isous[x.rank];
  const near = isous.slice(Math.max(0, x.rank - 2), x.rank + 1).map((t) => ({ label: t.label, rank: t.rank, score: t.score, color: t.color, self: t.id === x.id }));
  return { ...d, you: [y.lines.join(''), d.read], inc: y.inc, near, overall,
    next: next ? { label: next.label, score: next.score, d: x.score - next.score } : null };
}

// P18 邪眼×異相：計算上の関係（異相が邪眼の構成特性に含まれるか）→ 重なりの読み方 → 日常の例 → 根拠
export function comboOf(e, x) {
  const L = e.label, X = x.label, ec = ELEMENT_COMBO[e.id], tc = TRAIT_COMBO[x.id], ed = ELEMENT_DETAIL[e.id], td = TRAIT_DETAIL[x.id];
  const parts = e.parts, part = parts.find((p) => p.id === x.id), inc = !!part;
  const list = parts.map((p) => `${p.label}${p.score}`).join('・');
  const you = [];
  let relation, headline, day, heavy, q, rows;
  if (inc) {
    const w = parts[0].id === x.id ? `最も大きな重み（${part.weight}%）を持ち` : `${part.weight}%の重みを持ち`;
    relation = `異相の${X}は、${L}の計算に使われる三つの特性の一つです（重み${part.weight}%）。同じ特性が、邪眼の得点にも直接使われています。`;
    headline = `${ec.ctx}、${N(x.id)}が目立つ組み合わせです。`;
    you.push(`今回の${L}は、${list}から計算されています。その中で、${X}は${L}の計算に${w}、12特性の中でも最上位に選ばれています。`);
    const others = parts.filter((p) => p.id !== x.id).sort((a, b) => a.score - b.score);
    const nb = others.find((p) => Math.abs(p.score - x.score) <= CLOSE);
    you.push(`そのため、今回の${L}を理解する入口は、${N(others[0].id)}だけでなく、${N(x.id)}にあります。${nb ? `${nb.label}の得点も近いため、${N(nb.id)}にも目を向けられます。` : ''}`);
    you.push(`${L}と${X}は、同じ回答の一部を共有しています。二つの結果がそろったことから、さらに深い性格が証明されたという意味ではありません。全体のまとまりを、${X}という特性から具体的に読み直す関係です。`);
    day = [{ text: td.day }, { text: `この場面が自分に重なるなら、次の問いで振り返れます。「${_EL_LIVE[e.id].ask}」`, note: true }];
    heavy = td.signs;
    q = ec.q;
    rows = parts.map((p) => ({ label: p.label, score: p.score, see: N(p.id), self: p.id === x.id, color: x.color }));
  } else {
    const top = [...parts].sort((a, b) => b.score - a.score)[0];
    relation = `異相の${X}は、${L}の計算に使われる三つの特性（${parts.map((p) => p.label).join('・')}）には含まれていません。別の特性が最上位にありながら、合成した得点では${L}が上位になっています。`;
    headline = `${ec.about}に関する反応と、${N(x.id)}が、どちらも表れた組み合わせです。`;
    you.push(`${L}は${list}から計算されていますが、個別の特性では${X}（${x.score}）が最上位になっています。${L}の構成特性の中で最も高いのは${top.label}（${top.score}）です。`);
    you.push(`したがって、「${L}の反応があるから${X}が表れる」と、二つを原因と結果で結ぶことはできません。`);
    you.push(`同じ場面で重なることもあれば、別々の場面でそれぞれに表れている可能性もあります。「日常の例」にある二つの場面を見比べ、同じときに起きているかを確かめてください。`);
    day = [{ head: `${L}の場面`, text: ed.day }, { head: `${X}の場面`, text: td.day }];
    heavy = `${ed.signs}${td.signs}`;
    q = `${ec.when}ときほど、${tc.want}か。それとも、別々の場面で起きているか。`;
    rows = [...parts.map((p) => ({ label: p.label, score: p.score, see: N(p.id), color: e.color.main })), { label: X, score: x.score, see: N(x.id), self: true, sep: true, color: x.color }];
  }
  return {
    labels: COMBO_LABELS, inc, tag: inc ? COMBO_LABELS.incTag : COMBO_LABELS.sepTag, relation, headline, you, day, rows, heavy, q,
    e: { label: L, color: e.color.main, sub: `${parts.map((p) => p.label).join('・')}をまとめた、${ec.about}に関する反応。` },
    x: { label: X, color: x.color, sub: `${ISOU_TEXT[x.id].essence}。` },
    aware: ec.aware, accept: `${tc.feel}自分を否定せず、その気持ちをどう表しているかまで見つめる。`,
  };
}
