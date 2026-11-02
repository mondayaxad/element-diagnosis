// Pure reference implementation. No persistence, network, payment, or ETI mutation.
export const ENGINE_VERSION = 'jagan-engine-1.0.0-rc1';

const finiteScore = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
function stableHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function rankEntries(entries, resultId, epsilon = 1e-9) {
  if (typeof resultId !== 'string' || !resultId || resultId.length > 256) throw new Error('invalid_result_id');
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error('invalid_epsilon');
  if (entries.some(e => typeof e.id !== 'string' || !e.id || !finiteScore(e.score))) throw new Error('invalid_ranking_entry');
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('duplicate_ranking_id');
  const sorted = entries.map(e => ({...e})).sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
  const output = [];
  for (let i = 0; i < sorted.length;) {
    let end = i+1;
    while (end < sorted.length && Math.abs(sorted[i].score-sorted[end].score) <= epsilon) end++;
    const group = sorted.slice(i,end).sort((a,b) => stableHash(`${resultId}|${a.id}`)-stableHash(`${resultId}|${b.id}`) || a.id.localeCompare(b.id));
    output.push(...group.map(e => ({...e, rank:i+1, displayScore:Math.round(e.score)})));
    i = end;
  }
  return output;
}

export function scoreDomains(answers, itemSet) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('invalid_answers');
  const known = new Set(itemSet.items.map(i => i.id));
  if (Object.keys(answers).some(k => !known.has(k))) throw new Error('unknown_item_id');
  if (known.size !== itemSet.items.length) throw new Error('duplicate_item_id');
  const groups = Object.fromEntries(itemSet.domains.map(d => [d.id, []]));
  const normalizedAnswers = {};
  for (const item of itemSet.items) {
    const value = Object.hasOwn(answers,item.id) ? answers[item.id] : null;
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) throw new Error(`invalid_answer:${item.id}`);
    if (!groups[item.domain] || item.direction !== 1) throw new Error('invalid_item_definition');
    normalizedAnswers[item.id] = value;
    if (value !== null) groups[item.domain].push(value);
  }
  const domains = {};
  for (const d of itemSet.domains) {
    const vals = groups[d.id];
    const defined = itemSet.items.filter(i => i.domain === d.id).length;
    if (defined !== d.item_count || !Number.isInteger(d.minimum_answered) || d.minimum_answered < 1 || d.minimum_answered > defined) throw new Error('invalid_domain_definition');
    const valid = vals.length >= d.minimum_answered;
    const mean = valid ? vals.reduce((s,v) => s+v,0)/vals.length : null;
    const score = valid ? (mean-1)*25 : null;
    domains[d.id] = {mean, score, displayScore:valid?Math.round(score):null,
      answered:vals.length,total:d.item_count,missing:d.item_count-vals.length,
      status:!valid?'insufficient':vals.length===d.item_count?'complete':'partial'};
  }
  return {answers:normalizedAnswers, domains};
}

export function weightedSimilarity(user, reference, axes, weights) {
  if (!Array.isArray(axes) || !axes.length || new Set(axes).size !== axes.length) throw new Error('invalid_common_axes');
  let total = 0, squared = 0;
  for (const axis of axes) {
    const w = weights[axis];
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || !finiteScore(user[axis]) || !finiteScore(reference[axis])) throw new Error(`invalid_comparison_axis:${axis}`);
    squared += w*((user[axis]-reference[axis])/100)**2;
    total += w;
  }
  return 100*(1-Math.sqrt(squared/total));
}

export function scoreInterpretations(domainResults, interpretation, resultId) {
  const get = d => domainResults[d]?.score;
  const required = [...new Set(interpretation.elements.flatMap(e => Object.keys(e.weights)))];
  const missingElementAxes = required.filter(d => !finiteScore(get(d)));
  let elements;
  if (missingElementAxes.length) elements = {status:'insufficient',missingAxes:missingElementAxes,rankings:[],primary:null,top3:[]};
  else {
    const entries = interpretation.elements.map(e => {
      const pairs = Object.entries(e.weights);
      const sum = pairs.reduce((s,[,w]) => s+Math.abs(w),0);
      if (sum <= 0 || !Number.isFinite(sum)) throw new Error('invalid_element_weights');
      const score = pairs.reduce((s,[axis,w]) => s+Math.abs(w)*(w<0?100-get(axis):get(axis)),0)/sum;
      return {id:e.id,label:e.label,score};
    });
    const rankings = rankEntries(entries,resultId,interpretation.tie_epsilon);
    const ties = rankings.filter(r => r.rank === 1).map(r => r.id);
    const close = rankings.filter(r => rankings[0].score-r.score <= interpretation.close_gap_points).map(r => r.id);
    elements = {status:'available',primary:rankings[0].id,top3:rankings.slice(0,3).map(r => r.id),rankings,ties,close,
      differentiation:close.length>1?'close':'distinct'};
  }
  const missingTypeAxes = interpretation.types.map(t => t.domain).filter(d => !finiteScore(get(d)));
  let types;
  if (missingTypeAxes.length) types = {status:'insufficient',missingAxes:missingTypeAxes,primary:null,rankings:[]};
  else {
    const rankings=rankEntries(interpretation.types.map(t => ({id:t.id,label:t.label,score:get(t.domain)})),resultId,interpretation.tie_epsilon);
    const active = rankings.filter(r => r.score >= interpretation.type_minimum_score);
    const close = active.filter(r => rankings[0].score-r.score <= interpretation.close_gap_points).map(r => r.id);
    types = {status:active.length?'available':'no_marked_pattern',primary:active.length?rankings[0].id:null,rankings,close,
      differentiation:close.length>1?'co_dominant':active.length?'distinct':'none',
      label:active.length?rankings[0].label:'明確な偏りなし'};
  }
  return {elements,types};
}

