// 現在像（observed_traits の元）を作る。
// ETI 経路：尺度値そのもの（measurements）だけが「観測」(observed)。そこから規則で導いた特性・価値観の候補は
//           アプリの解釈なので「システムの推論」(system_inferred) とし、根拠として観測値（value_status: observed）を持たせる。
// 簡易質問経路：本人の自己申告（user_answer）。
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
        inference_status: 'system_inferred',
        derivation: 'eti_rule',
        evidence: {
          kind: 'eti_scale', domain: r.domain, axis: r.axis, axis_label: AXIS_LABELS[r.axis],
          value: v, value_status: 'observed', rule: `${r.axis} ${r.op} ${r.threshold}`, rule_status: 'system_inferred',
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
      value: x.value, inference_status: 'system_inferred', derivation: 'eti_rule',
      evidence: { kind: 'eti_values_centered', axis: x.value, centered: round3(x.centered), value_status: 'observed', rank: i + 1, rule: `centered > ${VALUE_CENTERED_MIN}・上位${VALUE_TOP_N}`, rule_status: 'system_inferred' },
    }));
  return {
    source: 'eti_v2',
    measurements: measurementsFrom(imported.scales),
    traits,
    values,
    unknowns: [],
    scales: imported.scales,
    provenance: imported.provenance,
    note: '観測値は ETI v2 の尺度値だけです。特性・価値観の候補は、その値からアプリが規則で解釈したもの（推論）で、尺度から人格表現を一意に決められるとは扱いません。',
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
    measurements: [],
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

// 尺度の観測値（ETI がそのまま保存している値。解釈を含まない）
function measurementsFrom(sc) {
  const out = [];
  for (const d of ['personality', 'style']) for (const [axis, value] of Object.entries(sc[d])) out.push({ domain: d, axis, axis_label: AXIS_LABELS[axis], value, scale: 'display_0_100', inference_status: 'observed' });
  for (const [axis, value] of Object.entries(sc.valuesCentered)) out.push({ domain: 'values', axis, value: round3(value), scale: 'centered', inference_status: 'observed' });
  return out;
}

function round3(x) { return Math.round(x * 1000) / 1000; }
