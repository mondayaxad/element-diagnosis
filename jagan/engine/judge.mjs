// jagan/engine/judge.mjs — 12特性の採点・邪眼元素・異相・人物の選定。
//   docs/jagan/spec_v0_3_balanced/runtime.mjs の計算をそのまま移したもの（データは引数で受け取る。ブラウザとサーバーで共通）。
//   tests/jagan.test.mjs が、仕様の runtime.mjs と同じ結果になること（ランダムな回答・128例）を確かめる。計算の式は変えない。
export const ENGINE_VERSION = 'jagan-engine-2.0.0-balanced-v03';
const EPS = 1e-8;
const rank = (rows) => [...rows].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
function hash(s) { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0; return n; }

export function scoreAnswers(answers, items) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw Error('invalid_answers');
  const ids = new Set(items.items.map((i) => i.id));
  if (Object.keys(answers).some((k) => !ids.has(k))) throw Error('unknown_item_or_version');
  for (const id of ids) if (!Number.isInteger(answers[id]) || answers[id] < 1 || answers[id] > 5) throw Error('all_50_answers_required');
  return Object.fromEntries(items.traits.map((t) => {
    const rows = items.items.filter((i) => i.trait === t.id);
    return [t.id, (rows.reduce((s, i) => s + answers[i.id], 0) / rows.length - 1) * 25];
  }));
}

// 0.6.0：表示する一致度は、近さに均等化の補正（±5ポイント以内）を加えた値。順位と同じ値なので、順位と一致度が前後しない
export const displayMatch = (v) => Math.max(0, Math.min(100, Math.round(v)));
export function characterRanking(scores, characters) {
  for (const k of characters.axes) if (!Number.isFinite(scores[k]) || scores[k] < 0 || scores[k] > 100) throw Error('invalid_trait_score');
  const salient = Object.fromEntries(characters.axes.map((k) => [k, Math.max(scores[k] - characters.salience_start, 0)]));
  const total = Object.values(salient).reduce((a, b) => a + b, 0);
  return characters.characters.map((c) => {
    const keys = Object.keys(c.anchors);
    const rmse = Math.sqrt(keys.reduce((s, k) => s + ((scores[k] - c.anchors[k]) / 100) ** 2, 0) / keys.length);
    const agreement = 100 * (1 - rmse);
    // 0.7.0：目立つ特性の割合は、事前値（coverage_prior）へ寄せたなだらかな値。目立つ特性がない／照合外の特性が少し50を超える、の境界で急変しない
    const coverage = (keys.reduce((s, k) => s + salient[k], 0) + characters.coverage_prior_strength * characters.coverage_prior) / (total + characters.coverage_prior_strength);
    const similarity = characters.anchor_agreement_weight * agreement + characters.salience_coverage_weight * 100 * coverage;
    return { id: c.id, name: c.name, score: similarity, selectionScore: similarity + c.selection_offset, agreement, coverage, usedAxes: keys, selectionOffset: c.selection_offset };
  }).sort((a, b) => b.selectionScore - a.selectionScore || a.id.localeCompare(b.id));
}

export function judge(answers, bundle) {
  const { items, core, characters } = bundle;
  const scores = scoreAnswers(answers, items);
  const traitRanking = rank(items.traits.map((t) => ({ id: t.id, label: t.label, score: scores[t.id] })));
  const top = traitRanking[0];
  const ties = traitRanking.filter((t) => Math.abs(t.score - top.score) < EPS);
  const isou = top.score < core.isou_minimum_candidate ? { id: null, label: '未顕', reason: 'no_marked_trait' }
    : ties.length > 1 ? { id: null, label: '複合', reason: 'top_tie', tiedIds: ties.map((t) => t.id) }
      : { ...top, reason: 'unique_highest', nearTie: top.score - traitRanking[1].score <= core.near_gap_candidate };
  const elements = rank(core.elements.map((e) => ({ id: e.id, label: e.label, score: Object.entries(e.weights).reduce((s, [k, w]) => s + scores[k] * w, 0) })));
  const eties = elements.filter((e) => Math.abs(e.score - elements[0].score) < EPS);
  const element = eties.length > 1 ? { id: null, label: '未分化', reason: 'top_tie', tiedIds: eties.map((e) => e.id) }
    : { ...elements[0], reason: 'unique_highest', nearTie: elements[0].score - elements[1].score <= core.near_gap_candidate };
  const ranked = characterRanking(scores, characters);
  const mapped = characters.mapped_axes.map((k) => scores[k]);
  const spread = Math.max(...mapped) - Math.min(...mapped);
  let character = null;
  if (spread >= characters.minimum_mapped_spread) {
    const best = ranked[0].selectionScore;
    const same = ranked.filter((c) => Math.abs(c.selectionScore - best) < EPS);
    const key = items.items.map((i) => `${i.id}:${answers[i.id]}`).join('|');
    const win = [...same].sort((a, b) => hash(key + a.id) - hash(key + b.id) || a.id.localeCompare(b.id))[0];
    const meta = characters.characters.find((c) => c.id === win.id);
    character = { id: win.id, name: win.name, title: meta.title, tags: meta.tags, region: meta.region_label, match: displayMatch(win.selectionScore), rawSimilarity: win.score, adjustedScore: win.selectionScore, usedAxes: win.usedAxes, selectionMethod: 'fixed_balance_offset_displayed', rawGap: Math.max(...ranked.map((c) => c.score)) - win.score };
  }
  return { itemSetVersion: items.item_set_version, coreVersion: core.version, characterVersion: characters.version, scores, isou, element, elementRanking: elements, character, characterStatus: character ? 'authored_story_association' : 'insufficient_mapped_profile_contrast', headline: `${element.label} × ${isou.label}`, privateDiagnostics: { characterRanking: ranked, mappedSpread: spread }, validated: false };
}

// 表示用：特性の得点順（同点は ID 順）。判定の計算には使わない
export function rankTraits(scores, items) { return rank(items.traits.map((t) => ({ id: t.id, label: t.label, score: scores[t.id] }))); }
