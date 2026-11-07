// jagan/complete/model.mjs — 邪眼完全解析「DIPPER」（叩き台）の中身を、DTI の算出結果（computeDiagnosis の結果）から組み立てる。
//   画面（view.mjs）はこの中身だけを使う。数値・順位はすべて結果と同じ版の計算から取る（新しい採点はしない）。
//   ・邪眼元素の全体順位：result.element.ranking（1位の選定と同じ規則）
//   ・異相の全体順位：orderIsou（1位は必ず result.isou と同じ）
//   ・ファトゥスの順位：result.characterOrder（人物ごとの出やすさの偏りを補正した順）。1位の一致度は結果ページと同じ character.match
import { orderIsou } from '../engine/dti.mjs';
import { explainCharacter } from '../engine/runtime.mjs';
import { ELEMENT_TEXT, ELEMENT_NAME, ELEMENT_STORY, ELEMENT_COLOR, ISOU_TEXT, ISOU_SHORT, ISOU_COLOR, TRAIT_COPY, GROUPS, CHARACTER_COPY, FATUI_TONE, FATUI_TONE_EXTRA } from '../site-copy.mjs';
import { PRODUCT, ELEMENT_DEEP, TRAIT_DEEP, FATUI_DEEP, DOMAIN_DEEP, FIXED, typeOverview } from './copy.mjs';

const r1 = (x) => Math.round(x * 10) / 10;

export function buildComplete(result, bundle, { diagnosedAt = null } = {}) {
  if (!result || result.schemaVersion !== 'jagan-result-3') throw new Error('result_not_supported');
  const traitLabel = (id) => bundle.items.traits.find((t) => t.id === id).label;
  const score = (id) => result.traits[id].score;
  const el = result.element, is = result.isou;

  const elements = el.ranking.map((e, i) => ({
    id: e.id, label: e.label, rank: i + 1, score: Math.round(e.score), name: ELEMENT_NAME[e.id], color: ELEMENT_COLOR[e.id],
    text: ELEMENT_TEXT[e.id], deep: ELEMENT_DEEP[e.id], story: ELEMENT_STORY[e.id],
    parts: Object.entries(bundle.core.elements.find((x) => x.id === e.id).weights).sort((a, b) => b[1] - a[1])
      .map(([t, w]) => ({ id: t, label: traitLabel(t), weight: Math.round(w * 100), score: Math.round(score(t)) })),
  }));
  const isous = orderIsou(result.answers, bundle.items).map((x) => ({
    id: x.id, label: traitLabel(x.id), rank: x.rank, score: Math.round(score(x.id)), color: ISOU_COLOR[x.id],
    text: ISOU_TEXT[x.id], short: ISOU_SHORT[x.id], copy: TRAIT_COPY[x.id], deep: TRAIT_DEEP[x.id],
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

  return {
    product: PRODUCT, fixed: FIXED, diagnosedAt,
    dti: { code: result.dti.code, name: result.dti.name },
    element: elements[0], isou: isous[0], character: ch ? fatui[0] : null,
    overview: typeOverview({ name: result.dti.name, code: result.dti.code, element: el.label, isou: is.label, elText: ELEMENT_TEXT[el.id], isouText: ISOU_TEXT[is.id] }),
    elements, isous, fatui, fatuiTop: fatui.slice(0, 6), fatuiRest: fatui.slice(6),
    topE, lowE, topI, lowI, topF,
    domains, domainOrder, overall: r1(overall), days,
    emblem: { PY: 'pyro', HY: 'hydro', CR: 'cryo', EL: 'electro', AN: 'anemo', GE: 'geo', DE: 'dendro' }[el.id],
  };
}
