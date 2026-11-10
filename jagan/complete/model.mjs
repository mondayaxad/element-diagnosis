// jagan/complete/model.mjs — 邪眼完全解析「DIPPER」（叩き台）の中身を、DTI の算出結果（computeDiagnosis の結果）から組み立てる。
//   画面（view.mjs）はこの中身だけを使う。数値・順位はすべて結果と同じ版の計算から取る（新しい採点はしない）。
//   ・邪眼元素の全体順位：result.element.ranking（1位の選定と同じ規則）
//   ・異相の全体順位：orderIsou（1位は必ず result.isou と同じ）
//   ・ファトゥスの順位と一致度：result.characterOrder（50問の回答から、11名が偏りなく現れるよう補正した値の高い順。表示する一致度も同じ値。1位＝あなたのファトゥス）
import { orderIsou } from '../engine/dti.mjs';
import { explainCharacter } from '../engine/runtime.mjs';
import { ELEMENT_TEXT, ELEMENT_NAME, ELEMENT_STORY, ELEMENT_COLOR, ISOU_TEXT, ISOU_SHORT, ISOU_COLOR, TRAIT_COPY, GROUPS, CHARACTER_COPY, FATUI_TONE, FATUI_TONE_EXTRA } from '../site-copy.mjs';
import { PRODUCT, ELEMENT_DEEP, TRAIT_DEEP, FATUI_DEEP, DOMAIN_DEEP, FIXED, PANEL, typeOverview, ELEMENT_LIVE, TRAIT_READ, LIVE_INTRO, LIVE_ROWS, READ_INTRO, READ_ROWS, DETAIL_LABELS, TRAIT_PHRASE, ELEMENT_DETAIL, TRAIT_DETAIL, COMBO_LABELS, ELEMENT_COMBO, TRAIT_COMBO, MIRROR_LABELS, RESPONSE_DOMAINS, TRAIT_SHORT, NEXT_PAGE, NEXT_EXAMPLE, REREAD_PAGE, REREAD_EXAMPLE, DICT_PAGE, ELEMENT_MISREAD, TRAIT_DICT_HL, OVERVIEW_COPY, FATUI_SPLIT, TRAIT_SCENE, GUIDE_PAGE, ELEMENT_LINE, TRAIT_LINE, FATUI_LINE, COMBO_FLOW, TRAIT_RECEIVE, ELEMENT_LIVE as _EL_LIVE } from './copy.mjs';

const r1 = (x) => Math.round(x * 10) / 10;

export function buildComplete(result, bundle, { diagnosedAt = null } = {}) {
  if (!result || result.schemaVersion !== 'jagan-result-3') throw new Error('result_not_supported');
  const traitLabel = (id) => bundle.items.traits.find((t) => t.id === id).label;
  const score = (id) => result.traits[id].score;
  const el = result.element, is = result.isou;

  const elements = el.ranking.map((e, i) => ({
    id: e.id, label: e.label, rank: i + 1, score: Math.round(e.score), name: ELEMENT_NAME[e.id], color: ELEMENT_COLOR[e.id],
    text: ELEMENT_TEXT[e.id], line: ELEMENT_LINE[e.id], deep: ELEMENT_DEEP[e.id], live: ELEMENT_LIVE[e.id], story: ELEMENT_STORY[e.id],
    parts: Object.entries(bundle.core.elements.find((x) => x.id === e.id).weights).sort((a, b) => b[1] - a[1])
      .map(([t, w]) => ({ id: t, label: traitLabel(t), weight: Math.round(w * 100), score: Math.round(score(t)) })),
  }));
  const isous = orderIsou(result.answers, bundle.items).map((x) => ({
    id: x.id, label: traitLabel(x.id), rank: x.rank, score: Math.round(score(x.id)), color: ISOU_COLOR[x.id],
    text: ISOU_TEXT[x.id], line: TRAIT_LINE[x.id], short: ISOU_SHORT[x.id], copy: TRAIT_COPY[x.id], deep: TRAIT_DEEP[x.id], read: TRAIT_READ[x.id],
    aspect: bundle.dti.aspects.find((a) => a.trait_id === x.id),
  }));
  if (isous[0].id !== is.id) throw new Error('isou_order_mismatch');

  const ch = result.character.status === 'available' ? result.character : null;
  const fatui = result.characterOrder.map((c, i) => {
    const ex = explainCharacter(result, bundle, c.id);
    const meta = bundle.characters.characters.find((x) => x.id === c.id);
    return {
      id: c.id, name: c.name, rank: i + 1, title: meta.title, tags: meta.tags, region: meta.region_label,
      match: c.displayScore, raw: c.rawSimilarity, adj: c.adjustedScore,
      // 人物名の色：オーナー指定の組み合わせ（マイページと同じ）。黒で終わる人物は、文字が読める暗さまで
      // 人物名の文字色だけは、オーナー指定の組み合わせ（マイページと同じ）を使う。元素の札や、邪眼との結びつけはレポートで扱わない（2026-11-08 オーナー指定）
      elements: (FATUI_TONE[c.id] || []).map((k) => (ELEMENT_COLOR[k] ? ELEMENT_COLOR[k].main : FATUI_TONE_EXTRA[k] === FATUI_TONE_EXTRA.BLACK ? '#7a2a2a' : FATUI_TONE_EXTRA[k])),
      tone: FATUI_TONE[c.id] || [], line: FATUI_LINE[c.id],
      aligned: ex.aligned.map((x) => ({ label: traitLabel(x.axis), you: Math.round(x.userScore), ref: Math.round(x.referenceScore) })),
      rows: ex.rows.map((x) => ({ id: x.axis, label: traitLabel(x.axis), you: Math.round(x.userScore), ref: Math.round(x.referenceScore), diff: Math.round(Math.abs(x.userScore - x.referenceScore)) })).sort((a, b) => a.diff - b.diff),
      different: ex.different.map((x) => ({ label: traitLabel(x.axis), you: Math.round(x.userScore), ref: Math.round(x.referenceScore) })),
      copy: CHARACTER_COPY[c.id], deep: FATUI_DEEP[c.id], meta, selected: !!c.selected,
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
  // 上位3名：順位の1〜3位（1位＝あなたのファトゥス）
  const selF = fatui.find((f) => f.selected);
  const topF = fatui.slice(0, 3);
  // 各邪眼元素に連なるファトゥス（色の組み合わせにその元素を含む人物。順位の高い順）
  // 7日間の観察：上位の異相から順に（足りなければ次の順位へ）
  const days = isous.slice(0, 7).map((x, i) => ({ day: i + 1, label: x.label, color: x.color, q: x.deep.exp }));

  // 12特性の山（上位2）・谷（下位2）：数値の高い順（異相の選定の規則ではなく、得点そのもの）
  const byScore = bundle.items.traits.map((t) => ({ id: t.id, label: t.label, score: Math.round(score(t.id)), color: ISOU_COLOR[t.id], copy: TRAIT_COPY[t.id] }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const peaks = byScore.slice(0, 2), valleys = byScore.slice(-2).reverse();
  // ファトゥスのタグ（色の組み合わせの元素）と、上位5名に繰り返し現れる物語のテーマ
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
  const mirror = mirrorOf(topF, elements[0], isous);
  const rdom = responseDomains(score, traitLabel, isous);
  const next = { ...NEXT_PAGE, example: NEXT_EXAMPLE[isous[0].id], exampleFor: isous[0].label, hints: [...isous.slice(0, 3).map((x) => ({ label: x.label, color: x.color })), { label: `邪眼・${elements[0].label}`, color: elements[0].color.main }] };
  return {
    product: PRODUCT, detailLabels: DETAIL_LABELS, combo, mirror, rdom, next, guide: GUIDE_PAGE, reread: rereadOf(elements[0], isous, byScore), dict: dictOf(elements, isous), ov: overviewOf(elements, isous, byScore, peaks, valleys), fixed: FIXED, panel: PANEL, diagnosedAt,
    live: { intro: LIVE_INTRO, rows: LIVE_ROWS }, read: { intro: READ_INTRO, rows: READ_ROWS },
    peaks, valleys, themes,
    gapE: { a: elements[0], b: elements[1], d: elements[0].score - elements[1].score },
    gapI: { a: isous[0], b: isous[1], d: isous[0].score - isous[1].score },
    dti: { code: result.dti.code, name: result.dti.name },
    element: elements[0], isou: isous[0], character: ch ? selF : null,
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
    out.push(`今回の${L}では、構成特性の中で${s[0].label}の得点が比較的高く出ています（算出の重みが最も大きいのは${core.label}）。${others.join('や、')}に加え、${N(s[0].id)}が、${d.loop}一因になっていないかを検討できます。`);
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
    const w = parts[0].id === x.id ? `最も大きな算出の重み（${part.weight}%）を持ち` : `${part.weight}%の算出の重みを持ち`;
    relation = `異相の${X}は、${L}の計算に使われる三つの特性の一つです（算出の重み${part.weight}%）。同じ特性が、邪眼の得点にも直接使われています。`;
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
  // 今回の得点から読む流れ。受け止め方の冒頭は、邪眼の構成特性のうち低いものと異相を比べる（今回の回答での強弱）
  const lowPart = [...parts].filter((p) => p.id !== x.id).sort((a, b) => a.score - b.score)[0];
  const closeP = parts.find((p) => p.id !== x.id && Math.abs(p.score - x.score) <= CLOSE);
  const receive = (inc && lowPart && x.score - lowPart.score >= 10 ? `${N(lowPart.id)}より、${N(x.id)}のほうが、回答に強く表れています。` : '')
    + (closeP ? `${x.label}${x.score}と${closeP.label}${closeP.score}は近い得点で、どちらかが際立っているわけではありません。` : '')
    + TRAIT_RECEIVE[x.id];
  const flow = { ...COMBO_FLOW, items: [td.scenes, receive, TRAIT_READ[x.id].daily, td.signs, `「${_EL_LIVE[e.id].ask}」${td.coexist}`] };
  return {
    flow,
    labels: COMBO_LABELS, inc, tag: inc ? COMBO_LABELS.incTag : COMBO_LABELS.sepTag, relation, headline, you, day, rows, heavy, q,
    e: { label: L, color: e.color.main, sub: `${parts.map((p) => p.label).join('・')}をまとめた、${ec.about}に関する反応。` },
    x: { label: X, color: x.color, sub: `${ISOU_TEXT[x.id].essence}。` },
    aware: ec.aware, accept: `${tc.feel}自分を否定せず、その気持ちをどう表しているかまで見つめる。`,
  };
}

// P19 上位3名のファトゥスとの交わり。explainCharacter と同じ閾値：重なる＝差15以内、異なる＝差20以上
const level = (v) => (v <= 35 ? 'low' : v >= 65 ? 'high' : 'mid');
const LEVEL_WORD = { low: '低め', high: '高め', mid: '中ほど' };
export function mirrorOf(topF, e, isous) {
  const M = { ...MIRROR_LABELS, split: FATUI_SPLIT };
  const x = isous[0];
  const mainIds = [...new Set([...e.parts.map((p) => p.id), x.id])];
  const mainLabels = mainIds.map((id) => (e.parts.find((p) => p.id === id) || x).label);
  const usedQ = new Set();
  const people = topF.map((f) => {
    const rows = f.rows, al = rows.filter((r) => r.diff <= 15), df = rows.filter((r) => r.diff >= 20).sort((a, b) => b.diff - a.diff);
    const nameOf = (r) => `${r.label}はあなた${r.you}／参照${r.ref}`;
    // 重なる特性
    let aligned;
    if (al.length) {
      const lv = [...new Set(al.flatMap((r) => [level(r.you), level(r.ref)]))];
      const how = lv.length === 1 ? `${al.length >= 2 ? (al.length === rows.length ? `この${'一二三四五'[al.length - 1]}特性がいずれも` : 'これらがいずれも') : 'この特性が'}${LEVEL_WORD[lv[0]]}の値で近づいている` : `${al.length >= 2 ? 'これらの特性の' : 'この特性の'}数値が近い`;
      aligned = `${al.map(nameOf).join('、')}です。今回の近さは、${how}ことから生じています。${al.map((r) => N(r.id)).join('、')}についての回答が、人物の参照値に近い配置です。`;
    } else {
      const r = rows[0];
      aligned = `比較している特性の中に、15点以内まで近いものはありません。最も近いのは${r.label}（あなた${r.you}／参照${r.ref}）です。近さは、ほかの人物と比べた相対的なものです。`;
    }
    // 異なる特性
    let different;
    if (df.length) {
      different = df.map((r) => `${r.label}は${r.ref > r.you ? `${f.name}の参照値の方が高く` : 'あなたの方が高く'}（あなた${r.you}／参照${r.ref}）`).join('、') + `、ここに違いがあります。同じ人物に近いと出ても、${df.length >= 2 ? 'これらの特性' : 'この特性'}での反応の表れ方は異なると読めます。`;
    } else {
      const r = [...rows].sort((a, b) => b.diff - a.diff)[0];
      const n = `${'一二三四五'[rows.length - 1]}特性`;
      different = r.diff > 15
        ? `比較している${n}に、20点以上離れているものはありません。ただし、${r.label}は差が${r.diff}点あり（あなた${r.you}／参照${r.ref}）、${r.you > r.ref ? 'あなた' : `${f.name}の参照値`}の方が高く出ています。この差だけで、人物との人柄の違いまでは判断できません。`
        : `比較している${n}に、大きな数値差はありません。` + (r.diff >= 8 ? `${r.label}は${r.you < r.ref ? 'あなたの方が低い' : 'あなたの方が高い'}ものの、この差だけで、人物との人柄の違いまでは判断できません。` : '');
    }
    // 邪眼・異相との関係
    const ov = rows.filter((r) => mainIds.includes(r.id));
    let main;
    if (!ov.length) {
      main = `あなたの主結果は${e.label}×${x.label}ですが、${f.name}との比較には${mainLabels.join('・')}を使用していません。${ELEMENT_COMBO[e.id].about}への近さではなく、${rows.map((r) => r.label).join('・')}という別の側面で近づいています。`;
    } else {
      const role = (r) => [e.parts.some((p) => p.id === r.id) ? `邪眼（${e.label}）の構成特性` : '', r.id === x.id ? '異相' : ''].filter(Boolean).join('であり、');
      main = `${f.name}との比較に使う特性のうち、${ov.map((r) => `${r.label}は${role(r)}`).join('、')}でもあります。`;
      const ovAl = ov.filter((r) => r.diff <= 15), rest = al.filter((r) => !mainIds.includes(r.id));
      main += ovAl.length ? `${ovAl.map((r) => r.label).join('・')}が近いため、主結果と同じ側面でも人物に近づいています。` : `ただし、この特性は数値が離れており、近さは${rest.length ? `主に${rest.map((r) => r.label).join('・')}` : '主結果とは別の特性'}によるものです。`;
    }
    // 比較から見えるあなた（今回の得点配置から。人物の美点を当てはめない）
    const top2 = isous.slice(0, 2).map((t) => t.label).join('や');
    const lows = al.filter((r) => level(r.you) === 'low' && !mainIds.includes(r.id)), highs = al.filter((r) => level(r.you) === 'high');
    let you;
    if (lows.length && !ov.some((r) => r.diff <= 15)) you = `今回の回答には、${top2}が上位にある一方、${lows.map((r) => r.label).join('・')}は低いという配置があります。上位の特性として内側で感じている反応と、外へ表れにくい反応を分けて振り返ることが、自分を理解する手がかりになります。`;
    else if (highs.length) you = `${highs.map((r) => r.label).join('・')}が高く、人物の参照値とも近い配置です。${highs.some((r) => mainIds.includes(r.id)) ? `${highs.filter((r) => mainIds.includes(r.id)).map((r) => r.label).join('・')}は主結果（${e.label}×${x.label}）を形づくる特性でもあり、今回の結果の中心にある反応が、この人物との比較にも表れています。` : '主結果とは別に、この特性もあなたの回答で目立っています。'}ただし、人物と同じ動機や経験を持つという意味ではありません。`;
    else you = `${f.name}との比較では、${al.length ? `${al.map((r) => r.label).join('・')}が近く` : '近い特性が限られ'}${df.length ? `、${df.map((r) => r.label).join('・')}が離れています` : 'ています'}。同じ人物に近いと出ても、どの特性で近いかによって、自分の読み方は変わります。`;
    // 文章（数値を出さない）版：06 の下部と 16 で使う
    const sideW = (r) => ({ low: '控えめ', high: 'はっきり', mid: '中ほど' }[level(r.you)]);
    const lvs = [...new Set(al.flatMap((r) => [level(r.you), level(r.ref)]))];
    const proseAl = al.length ? `${f.name}と重なるのは、${al.map((r) => N(r.id)).join('、')}についての回答です。${lvs.length === 1 ? `${al.length >= 2 ? 'いずれも' : ''}${LEVEL_WORD[lvs[0]]}の側で近づいています。` : 'それぞれの高さが近い配置です。'}`
      : `${f.name}とは、比較した特性の中にはっきり近いものはありません。${rows.filter((r) => r.diff <= 25).length ? `${rows.filter((r) => r.diff <= 25).map((r) => r.label).join('・')}がやや近い配置です。` : `最も近い${rows[0].label}でも、配置には差があります。`}`;
    const mild = [...rows].sort((a, b) => b.diff - a.diff)[0];
    const proseDf = df.length ? `一方で、${df.map((r) => r.label).join('と')}は${df.every((r) => r.ref > r.you) ? `${f.name}の参照の方がはっきりしており` : df.every((r) => r.ref < r.you) ? 'あなたの方がはっきりしており' : 'あなたと参照で向きが分かれており'}、この点での反応の表れ方は異なると読めます。`
      : mild && mild.diff >= 8 ? `比較している特性に大きな違いはありません。${mild.label}はあなたの方が${mild.you < mild.ref ? '控えめ' : 'はっきりしています'}${mild.you < mild.ref ? 'ですが' : 'が'}、この差だけで人柄の違いまでは判断できません。` : '比較している特性に、目立った違いはありません。';
    const proseOverlap = `${proseAl}${al.length ? `振り返る候補として、${al.map((r) => `「${TRAIT_SCENE[r.id][level(r.you) === 'high' ? 'hi' : 'lo']}」`).join('や')}が挙げられます。` : ''}`;
    void sideW;
    // 06 用（要点）：近さに寄与した特性・主な違い
    const lvAll = [...new Set(al.flatMap((r) => [level(r.you), level(r.ref)]))];
    const shortAl = al.length ? `${al.map((r) => `${r.label}（あなた${r.you}／参照${r.ref}）`).join('・')}。${lvAll.length === 1 ? `${al.length >= 2 ? 'いずれも' : ''}${LEVEL_WORD[lvAll[0]]}の値で近い配置です。` : '数値の近さが一致度に寄与しています。'}`
      : `15点以内まで近い特性はありません。最も近いのは${rows[0].label}（あなた${rows[0].you}／参照${rows[0].ref}）です。`;
    const big = df[0];
    const shortDf = big ? `${big.label}（あなた${big.you}／参照${big.ref}、差${big.diff}）。${big.ref > big.you ? `${f.name}の参照値の方が高い特性です。` : 'あなたの方が高い特性です。'}` : '比較した特性に、20点以上の差はありません。';
    // 16 用：人物の描写（作品の描写と DTI の解釈を分ける）・重なるところ（振り返る候補）・自分に戻す問い
    const meta = f.meta;
    const overlap = al.length ? `${aligned}${al.length ? `振り返る候補として、${al.map((r) => `「${TRAIT_SCENE[r.id][level(r.you) === 'high' ? 'hi' : 'lo']}」`).join('や')}が挙げられます。` : ''}` : aligned;
    // 三人で同じ問いにならないよう、まだ使っていない重なる特性 → なければ差の目立つ特性 → なければ人物の問い
    const sc = (r) => TRAIT_SCENE[r.id][level(r.you) === 'high' ? 'hi' : 'lo'];
    const qT = al.find((r) => !usedQ.has(r.id)), qD = df.find((r) => !usedQ.has(r.id));
    let question;
    if (qT) { usedQ.add(qT.id); question = `${sc(qT)}を、最近の出来事から一つ思い出せますか。そのとき、相手や状況はどうでしたか。`; }
    else if (qD) { usedQ.add(qD.id); question = `${f.name}との比較で差があった${qD.label}について、${sc(qD)}を思い出せますか。人物の参照とは違う、あなた自身の場面として説明してみてください。`; }
    else question = f.copy.reflection;
    // 16 の各項目（主語は回答者。比較していない特性は「扱っていない」とする）
    const topUser = isous.slice(0, 2);
    const feature = `${topUser[0].score <= 35 ? `全体に低めの回答の中では、${topUser.map((t) => t.label).join('と')}が相対的に高く出ています。` : `あなたの回答では、${topUser.map((t) => t.label).join('と')}が目立っています。`}${main}`;
    const notCompared = isous.slice(0, 3).filter((t) => !rows.some((r) => r.id === t.id)).map((t) => t.label);
    const differ = `${proseDf}${notCompared.length ? `なお、${notCompared.join('・')}は、${f.name}との照合では扱っていません。` : ''}`;
    const scene = `${f.copy.story_context}（照合に使う特性：${rows.map((r) => r.label).join('・')}）`;
    // 06 の要点：差15以内＝近い、16〜25＝やや近い、それ以上＝離れている（本文の判定と同じ閾値）
    const midR = rows.filter((r) => r.diff > 15 && r.diff <= 25), farR = rows.filter((r) => r.diff > 25);
    const seg = [al.length ? `${al.map((r) => r.label).join('・')}が近${rows.length === 1 ? 'い' : 'く'}` : '', midR.length ? `${midR.map((r) => r.label).join('・')}がやや近${rows.length === 1 ? 'い' : 'く'}` : ''].filter(Boolean);
    const proseShort = `${seg.length ? seg.join('、') : '照合に使う特性はいずれも離れており'}${farR.length && seg.length ? `、${farR.map((r) => r.label).join('・')}は離れています。` : seg.length ? (rows.length === 1 ? '配置です（照合に使う特性はこの一つだけです）。' : al.length === rows.length ? '、照合に使う特性のすべてで配置が重なります。' : '、ほかの特性も大きくは離れていません。') : '、一致度は相対的な近さにとどまります。'}`;
    return { f, rows, aligned, different, main, you, shortAl, shortDf, proseAl, proseDf, proseOverlap, feature, differ, scene, proseShort, story: { fact: f.copy.story_context, dti: meta.rationale }, overlap, question };
  });
  // まとめ：繰り返し近さの根拠になる特性と、人物ごとの一致理由
  const cnt = {};
  people.forEach((p) => p.rows.filter((r) => r.diff <= 15).forEach((r) => { (cnt[r.id] = cnt[r.id] || { label: r.label, names: [] }).names.push(p.f.name); }));
  const rep = Object.values(cnt).filter((v) => v.names.length >= 2);
  const reasons = people.map((p) => { const al = p.rows.filter((r) => r.diff <= 15); return `${p.f.name}：${al.length ? al.map((r) => r.label).join('・') : `最も近い${p.rows[0].label}`}`; }).join('／');
  const sum = [];
  if (rep.length) sum.push(`${rep.map((v) => `${v.label}は${v.names.join('・')}との比較`).join('、')}で、近さの根拠になっています。同じ特性を繰り返し参照しているため、それぞれを独立した証拠として数えることはできません。`);
  else sum.push('三人との近さは、それぞれ異なる特性で表れています。');
  const anyMain = people.some((p) => p.rows.some((r) => r.diff <= 15 && mainIds.includes(r.id)));
  sum.push(anyMain ? `主結果（${e.label}×${x.label}）を形づくる特性が近さに含まれる人物と、別の特性で近い人物を分けて読むと、どの反応が人物との比較に表れているかが見えます。`
    : `三人とも、主結果（${e.label}×${x.label}）を形づくる特性とは別の側面で近づいています。主結果で見た反応とは別に、どんな特性が人物との比較に表れているかを確かめてください。`);
  return { labels: M, people, sum };
}

// 四つの反応領域：各領域の特性の得点と、その違いから「あなたの場合」を組み立てる（領域平均の順位はつけない）
const SH = (id) => TRAIT_SHORT[id];
export function responseDomains(score, traitLabel, isous) {
  const R = RESPONSE_DOMAINS, top3 = isous.slice(0, 3).map((x) => x.id);
  const list = R.list.map((d) => {
    const ts = d.traits.map((id) => ({ id, label: traitLabel(id), score: Math.round(score(id)) }));
    const s = [...ts].sort((a, b) => b.score - a.score);
    const koto = (arr) => arr.map((t) => `${SH(t.id).verb}こと`).join('や');
    const you = [];
    if (ts.length >= 3 && !top3.includes(s[0].id) && s[0].score - s[1].score >= 8) {
      // 領域内で最も高いが、今回の上位特性ではない
      you.push(`${'一二三四五'[ts.length - 1]}特性の中では${s[0].label}が高いものの、今回の上位特性ではありません。領域内で最も高いという理由だけで、${SH(s[0].id).judgeNot}とは判断しません。各特性の意味と、実際の関わりを照らして読みます。`);
    } else if (s[0].score <= 35) {
      you.push(`${koto(ts)}への当てはまりは少ない配置です。これは、${d.lowNot}という意味ではありません。`);
    } else if (ts.length === 2) {
      const [a, b] = s;
      you.push(a.score - b.score >= 10 ? `この二特性では、${a.label}の得点が上回っています。${d.pair[a.id]}` : d.pair.close);
    } else {
      let cut = 0, gap = -1;
      for (let i = 0; i < s.length - 1; i++) if (s[i].score - s[i + 1].score > gap) { gap = s[i].score - s[i + 1].score; cut = i + 1; }
      if (gap >= 10) {
        const hi = s.slice(0, cut), lo = s.slice(cut);
        you.push(`今回は、${hi.map((t) => SH(t.id).short).join('と、')}が目立っています。${lo.length >= 3 ? `${lo.map((t) => t.label).join('・')}への当てはまり` : koto(lo)}よりも、${hi.length === 1 ? `${SH(hi[0].id).verb}反応` : `${hi.map((t) => t.label).join('と')}をめぐる反応`}から、自分の経験を振り返れます。`);
      } else {
        you.push(`${s.map((t) => t.label).join('・')}が、近い得点で並んでいます。どれか一つではなく、それぞれがどの場面で表れるかを見ていきます。`);
      }
      if (d.caution) you.push(d.caution);
    }
    if (d.id === 'anx' && score('SEP') >= 55 && score('WDR') >= 55) you.push('依存と撤退がともに高めです。得点だけで「近づきたいのに離れる」と決めず、同じ相手との間で起きるのか、別の場面なのかを確かめます。');
    return { ...d, ts, you, line: s.map((t) => `${t.label}${t.score}`).join('・') };
  });
  // この配置から考えること：内側で感じる反応（不安と対人警戒）と、外に表す反応（衝動・敵意）の違い
  const inner = R.list[0].traits.map((id) => ({ id, label: traitLabel(id), score: score(id) })).sort((a, b) => b.score - a.score);
  const outerMax = Math.max(score('IMP'), score('HOS'));
  const outerAll = ['IMP', 'RSK', 'HOS', 'ATT', 'MAN', 'CAL'].map((id) => ({ id, label: traitLabel(id), score: score(id) })).sort((a, b) => b.score - a.score);
  let think;
  if (inner[0].score >= outerMax + 15) think = `今回の回答では、${inner[0].label}や${inner[1].label}への当てはまりと、衝動や敵意への当てはまりに違いがあります。心の内側で感じることと、外に表す行動を分けて振り返ると、自分の経験をより具体的に理解できます。`;
  else if (outerAll[0].score >= inner[0].score + 15) think = `今回の回答では、${outerAll[0].label}や${outerAll[1].label}への当てはまりが、${inner[0].label}など不安や距離をめぐる反応より高く出ています。外に表れる反応と、その手前で感じていることを分けて振り返ると、自分の経験をより具体的に理解できます。`;
  else think = '今回の回答では、領域の間で大きな偏りは見られません。どの領域の反応が、どんな場面で表れるかを一つずつ照らし合わせると、自分の経験をより具体的に理解できます。';
  return { ...R, list, think };
}


// 再読：①今回の結果で覚えておきたいこと（得点配置から読めることと、読めないこと）を組み立てる
export function rereadOf(e, isous, byScore) {
  const x = isous[0], L = e.label, X = x.label, parts = e.parts;
  const s = [...parts].sort((a, b) => b.score - a.score);
  const r1 = [`${L}は、${parts.map((p) => `${p.label}${p.score}`).join('・')}を組み合わせた結果です。`];
  let cut = 0, gap = -1;
  for (let i = 0; i < s.length - 1; i++) if (s[i].score - s[i + 1].score > gap) { gap = s[i].score - s[i + 1].score; cut = i + 1; }
  if (gap >= 10) r1.push(`今回は、${s.slice(cut).map((t) => `${SH(t.id).verb}こと`).join('や')}よりも、${s.slice(0, cut).map((t) => SH(t.id).short).join('や')}への当てはまりが目立ちました。`);
  else r1.push('三つの特性が近い得点で重なっています。');
  const inc = parts.some((p) => p.id === x.id);
  const r2 = inc ? `${L}と${X}は、別々の証拠が一致した結果ではありません。${X}は、${L}の算出にも使われている特性です。「${ELEMENT_COMBO[e.id].when}場面」を振り返るための、二つの見方として読んでください。`
    : `${X}は、${L}の算出には含まれていない特性です。二つを一つの理由にまとめず、それぞれが表れる場面を別々に振り返ってください。`;
  const other = isous.slice(1, 3).find((t) => !parts.some((p) => p.id === t.id));
  const more = other ? { label: other.label, score: other.score, color: other.color,
    text: `${X}や${L}とは別に、${SH(other.id).verb}場面も、振り返る候補です。同じ場面で重なるか、別の場面に現れるかは、実際の経験から確かめます。` } : null;
  const low = byScore[byScore.length - 1];
  const lowText = `${low.label}${low.score}のような低い得点は、その反応への当てはまりが少なかったことを示すだけで、測っていない長所を示すものではありません。`;
  return { ...REREAD_PAGE, head: `邪眼：${L}／異相：${X}`, eColor: e.color.main, xColor: x.color, r1: r1.join(''), r2, more, lowText, ex: REREAD_EXAMPLE[x.id], exFor: X };
}

// 辞典：邪眼7（あなたの順位の順）と、異相12（四つの反応領域の順。I＝前半2領域、II＝後半2領域）
export function dictOf(elements, isous) {
  for (const e of elements) { e.misread = ELEMENT_MISREAD[e.id]; e.detail2 = ELEMENT_DETAIL[e.id]; }
  const doms = RESPONSE_DOMAINS.list.map((d) => ({ en: d.en, label: d.label, color: d.color, items: d.traits.map((id) => ({ ...isous.find((x) => x.id === id), hl: TRAIT_DICT_HL[id] })) }));
  return { ...DICT_PAGE, groups: [doms.slice(0, 2), doms.slice(2)] };
}

// 03・04・05 の下部：得点から長所への読み替えをせず、「当てはまりが多い／少ない」で書く
export function contrastOf(e) {
  const s = [...e.parts].sort((a, b) => b.score - a.score);
  let cut = 0, gap = -1;
  for (let i = 0; i < s.length - 1; i++) if (s[i].score - s[i + 1].score > gap) { gap = s[i].score - s[i + 1].score; cut = i + 1; }
  return gap >= 10 ? `今回の${e.label}では、${s.slice(cut).map((t) => `${SH(t.id).verb}こと`).join('や')}よりも、${s.slice(0, cut).map((t) => SH(t.id).short).join('や')}への当てはまりが目立ちます。`
    : `今回の${e.label}では、${s.map((t) => t.label).join('・')}が近い得点で重なっています。`;
}
export function overviewOf(elements, isous, byScore, peaks, valleys) {
  const O = OVERVIEW_COPY, e = elements[0], x = isous[0];
  const pin = peaks.filter((p) => e.parts.some((q) => q.id === p.id)), rest = e.parts.filter((q) => !peaks.some((p) => p.id === q.id));
  const three = [
    peaks[0].score <= 35 ? `全体に低めの回答の中では、${peaks.map((p) => `${p.label}${p.score}`).join('・')}が相対的に高く出ています。強い傾向という意味ではありません。` : `${peaks.map((p) => `${p.label}${p.score}`).join('・')}が、12特性の中で目立っています。`,
    pin.length === peaks.length ? `${e.label}${e.score}は、その${'一二三'[pin.length - 1]}特性に${rest.map((q) => `${q.label}${q.score}`).join('・')}を加えて算出しています。` : `${e.label}${e.score}は、${e.parts.map((q) => `${q.label}${q.score}`).join('・')}を組み合わせて算出しています。`,
    `${valleys.map((v) => `${v.label}${v.score}`).join('・')}への当てはまりは少なく、すべての特性が同じ強さで表れている配置ではありません。`,
  ];
  const other = isous.slice(1, 3).find((t) => !e.parts.some((p) => p.id === t.id) && !peaks.some((p) => p.id === t.id));
  const check = `${SH(peaks[0].id).short}と、${SH(peaks[1].id).short}が、同じ場面で重なることはあるでしょうか。`
    + (other ? `一方、${other.label}${other.score}が表す「${SH(other.id).short}」は、別の場面に現れる可能性もあります。` : '')
    + '得点だけで一つの原因にまとめず、経験と照らして読みます。';
  // 04：1位の邪眼の算出と、次点との関係
  const [a, b, c] = elements;
  const eRead = [`${a.label}${a.score}は、${a.parts.map((q) => q.label).join('・')}の得点を、それぞれの算出の重みに従って組み合わせた結果です。${contrastOf(a)}`,
    `${a.parts.map((q) => `「${SH(q.id).verb}こと」`).join('、')}は、同じ反応ではありません。${a.label}という名前だけでまとめず、どの反応が自分の経験に重なるかを確認してください。`];
  const shared = [b, c].map((z) => ({ z, sh: z.parts.filter((q) => a.parts.some((p) => p.id === q.id)).map((q) => q.label) }));
  const eNext = `2位の${b.label}${b.score}、3位の${c.label}${c.score}は、${[...new Set([b, c].flatMap((z) => z.parts.map((q) => q.label)))].join('・')}を含む、別の特性の組み合わせです。`
    + (shared.some((v) => v.sh.length) ? `${shared.filter((v) => v.sh.length).map((v) => `${v.z.label}は${v.sh.join('・')}を${a.label}と共有しています`).join('。')}。` : '')
    + O.eNextFixed;
  const d = a.score - b.score;
  const eGap = `${a.label}${a.score}と${b.label}${b.score}の差は${d}です。今回の算出では${a.label}が上回っていますが、この差だけで性格の確かさや、生活への影響の大きさは判断できません。`;
  const lowE = elements.slice(-2), lowI = isous.slice(-3);
  const eLow = `${lowE.map((z) => z.label).join('と')}が下位です。これは、${[...new Set(lowE.flatMap((z) => z.parts.map((q) => q.label)))].join('・')}など、その邪眼を構成する反応への当てはまりが相対的に少なかったことを示します。反対の性質があるという意味ではありません。`;
  const iLow = `${lowI.map((z) => z.label).join('・')}が下位です。これらの反応への当てはまりが、今回の回答では相対的に少なかったことを示します。反対の長所があるという意味ではありません。`;
  return { ...O, three, check, eRead, eNext, eGap, eLow, iLow, eTop: `${e.text.essence}。${e.parts.map((q) => q.label).join('・')}を組み合わせた邪眼です。` };
}
