// 現在像（observed_traits の元）を作る。ETI 経路は「尺度の観測値」、簡易質問経路は「本人の自己申告」。
import { ETI_TRAIT_RULES, VALUE_CENTERED_MIN, VALUE_TOP_N, AXIS_LABELS, UNKNOWN } from './catalog.js';
import { QUICK_QUESTIONS, QUICK_SET_VERSION } from './questions.js';

function cmp(op, v, t) { return op === '>=' ? v >= t : v <= t; }

// imported は eti_import.js の importEtiResult() が返した ok:true の data
export function currentFromEti(imported) {
  const traits = [];
  for (const r of ETI_TRAIT_RULES) {
    const v = imported.scales[r.domain][r.axis];
    if (cmp(r.op, v, r.threshold)) {
      traits.push({
        trait: r.trait,
        inference_status: 'observed',
        evidence: {
          kind: 'eti_scale', domain: r.domain, axis: r.axis, axis_label: AXIS_LABELS[r.axis],
          value: v, rule: `${r.axis} ${r.op} ${r.threshold}`,
        },
      });
    }
  }
  const vc = imported.scales.valuesCentered;
  const values = Object.keys(vc)
    .map((k) => ({ value: k, centered: vc[k] }))
    .sort((a, b) => b.centered - a.centered || (a.value < b.value ? -1 : 1))
    .filter((x) => x.centered > VALUE_CENTERED_MIN)
    .slice(0, VALUE_TOP_N)
    .map((x, i) => ({
      value: x.value, inference_status: 'observed',
      evidence: { kind: 'eti_values_centered', axis: x.value, centered: round3(x.centered), rank: i + 1, rule: `centered > ${VALUE_CENTERED_MIN}・上位${VALUE_TOP_N}` },
    }));
  return {
    source: 'eti_v2',
    traits,
    values,
    unknowns: [],
    scales: imported.scales,
    provenance: imported.provenance,
    note: 'ETI v2 の尺度値から規則で導いた特性候補。尺度から人格表現を一意に決められるとは扱わない。',
  };
}

export function currentFromQuick(answers) {
  const traits = [];
  const values = [];
  const unknowns = [];
  for (const q of QUICK_QUESTIONS) {
    const sel = answers[q.id];
    if (!sel || sel.length === 0 || sel.includes(UNKNOWN)) { unknowns.push(q.id); continue; }
    for (const oid of sel) {
      const opt = q.options.find((o) => o.id === oid);
      if (!opt) continue;
      for (const t of opt.traits || []) {
        traits.push({ trait: t, inference_status: 'user_answer', evidence: { kind: 'quick_question', question: q.id, option: oid, question_text: q.text, option_label: opt.label } });
      }
      for (const v of opt.values || []) {
        values.push({ value: v, inference_status: 'user_answer', evidence: { kind: 'quick_question', question: q.id, option: oid, question_text: q.text, option_label: opt.label } });
      }
    }
  }
  return {
    source: 'quick_questions',
    traits,
    values,
    unknowns,
    scales: null,
    provenance: { question_set_version: QUICK_SET_VERSION },
    note: '簡易質問（6問）への本人の自己申告。ETI 相当の測定精度や尺度の網羅性はない。',
  };
}

export function validQuickAnswers(answers) {
  return QUICK_QUESTIONS.every((q) => Array.isArray(answers[q.id]) && answers[q.id].length === 1
    && q.options.some((o) => o.id === answers[q.id][0]));
}

function round3(x) { return Math.round(x * 1000) / 1000; }
