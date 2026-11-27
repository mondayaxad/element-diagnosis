// FutureSelfProfile をルールで組み立てる（LLM は使わない）。
// 原則：自己連続性・憧れ・到達可能性・一貫性。固定比率の平均化ではなく、保護特性を守ったうえで憧れの方向へ伸ばす制約付き生成。
// 同じ入力・同じルール版なら同じ出力（時刻・乱数を使わない）。不明は「不明」とし、恣意的に補わない。
import {
  RULE_VERSION, CATALOG_VERSION, TRAITS, VALUES, CAPABILITIES, ASPIRATIONS, OPPOSING_TRAITS, INVERSION_RISKS, UNKNOWN,
} from './catalog.js';
import { IDEAL_QUESTIONS, IDEAL_SET_VERSION, QUICK_SET_VERSION } from './questions.js';
import { CONSENT_VERSION } from './consent.js';
import { resolveGrowthCaps } from './adaptive.js';

export const PROFILE_SCHEMA_VERSION = 'ISA-PROFILE-0.3.0'; // 0.3.0：protected_trait_candidates（K2・K4・現在像からの候補）を分離。0.2.0：observed_measurements・protection_check
export const FUTURE_HORIZON_YEARS = 5;
export const INFERENCE_STATUSES = {
  observed: '尺度の観測値（ETI）',
  user_answer: '本人の回答・選択',
  system_inferred: 'システムの推論（下書き・本人未確認）',
  unknown: '不明',
};
export const APPROVAL_STATUSES = ['unconfirmed', 'needs_revision', 'approved'];
export const DISCLAIMER = 'これは実際の未来の予測でも、検証済みの人格測定でもありません。ETIの結果（または簡易質問）と選択式の回答から、ルールで組み立てた設計上の仮説（下書き）です。';

const VALUE_PRINCIPLES = {
  SD: '最後は自分で選ぶ。選んだ理由を自分の言葉で説明できるようにする',
  ST: '迷ったら、新しい経験につながる選択肢を一度は検討する',
  HE: '自分が心地よく続けられるかを、判断の条件に入れる',
  AC: '成果として形になるかどうかで、取り組む順番を決める',
  PO: '影響を与えられる場面では、引き受ける責任も含めて判断する',
  SE: '安心して続けられる土台を崩さない選択を優先する',
  CO: '周りへの影響を考え、行き過ぎない範囲で選ぶ',
  TR: '受け継がれてきたやり方の意味を確かめてから変える',
  BE: '身近な人の暮らしに与える影響を、判断の前に考える',
  UN: '立場にかかわらず、公平に扱われているかを確かめてから決める',
};
const TRAIT_MODIFIERS = {
  deliberation: '選ぶ前に、状況を整理する時間を短くても確保する',
  inner_focus: '大事な判断は、一人で考える時間を経てから下す',
  empathy: '相手の立場を確かめたうえで判断する',
  self_direction_style: '周囲の期待は聞くが、最終判断は自分で引き受ける',
};
const PRESSURE_PRINCIPLES = {
  organize: '困ったときは、落ち着いて状況を整理し、短く方針を示す',
  receive: '困ったときは、まず相手の不安を受け止めてから動く',
  explain: '困ったときは、自分が信じる理由を淡々と説明する',
  move: '困ったときは、先頭に立って最初の一歩を出す',
};
const AVOID_BY_TRAIT = {
  inner_focus: ['常に場の中心にいることを前提にした振る舞い', '誰とでも積極的に交流することを理想の標準とする話し方'],
  deliberation: ['考える間を置かずに即断を迫る押しの強さ'],
  empathy: ['相手の気持ちを置き去りにする断定'],
  self_direction_style: ['周囲の期待にそのまま従う受け身の態度'],
  curiosity: ['新しい考えを頭ごなしに退ける態度'],
};

const qById = Object.fromEntries(IDEAL_QUESTIONS.map((q) => [q.id, q]));

// ---- 決定的なハッシュ（FNV-1a 32bit）。キー順をそろえた JSON で計算する
export function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function answerRef(q, oid) {
  const opt = q.options.find((o) => o.id === oid);
  return { kind: 'answer', status: 'user_answer', question: q.id, option: oid, question_text: q.text, option_label: opt ? opt.label : oid };
}
function selectedOptions(q, answers) {
  const sel = (answers[q.id] || []).filter((x) => x !== UNKNOWN);
  return sel.map((oid) => q.options.find((o) => o.id === oid)).filter(Boolean);
}
const isUnknownAns = (answers, qid) => { const a = answers[qid]; return !a || a.length === 0 || a.includes(UNKNOWN); };

/**
 * @param {object} input
 *   current   : currentFromEti / currentFromQuick の結果
 *   answers   : { [questionId]: optionId[] }（基本12問＋追加質問）
 *   followups : 実際に出した追加質問（computeFollowups().followups）
 *   overflow  : 上限で出せなかった追加質問
 *   confirmations : 初対面画面での候補の確認 { [trait]: 'keep' | 'not_keep' }（候補にだけ効く）
 */
export function buildFutureSelfProfile({ current, answers, followups = [], overflow = [], confirmations = {} }) {
  const unresolved = [];
  const unknowns = [];
  const fq = Object.fromEntries(followups.map((f) => [f.id, f]));
  const allQ = { ...qById, ...fq };

  // ---------- 現在像
  // observed_measurements：ETI の尺度値そのもの（観測）。observed_traits：現在像の特性候補。
  // ETI 経路の特性候補は尺度値からアプリが規則で解釈したもの（system_inferred。根拠の尺度値は value_status: observed）。
  const observed_measurements = current.measurements || [];
  const observed_traits = current.traits.map((t) => ({
    trait: t.trait, label: TRAITS[t.trait].label, inference_status: t.inference_status, derivation: t.derivation || 'quick_answer',
    source: current.source, evidence: t.evidence,
  }));
  const derivationRef = (t) => ({ kind: 'observed_trait', status: t.inference_status, trait: t.trait, evidence: t.evidence });
  for (const qid of current.unknowns || []) unknowns.push({ field: 'observed_traits', ref: qid, why: '簡易質問で「わからない」と回答' });

  // ---------- protected_traits（CORE）
  // 保護特性（protected_traits）になるのは、本人が直接選んだもの（K1・F_KEEP）と、初対面画面で本人が「残したい」と確かめた候補だけ。
  // K2（場面）・K4（失いたくない変化）の回答から読み取った特性や、現在像から導いた特性は「候補」（protected_trait_candidates・推論）。
  const prot = new Map(); // trait -> entry
  const entry = (trait) => {
    if (!prot.has(trait)) prot.set(trait, { trait, label: TRAITS[trait].label, inference_status: 'system_inferred', confirmed: false, basis: null, user_decision: 'undecided', sources: [], notes: [] });
    return prot.get(trait);
  };
  const addDirect = (trait, ref) => { const e = entry(trait); e.inference_status = 'user_answer'; e.confirmed = true; e.basis = 'direct_choice'; e.sources.push(ref); };
  const addInterpreted = (trait, ref) => { const e = entry(trait); if (!e.basis) e.basis = 'inferred_from_answer'; e.sources.push({ ...ref, mapping: 'interpreted', mapping_status: 'system_inferred' }); };
  for (const qid of ['K1', 'F_KEEP']) {
    const q = allQ[qid]; if (!q || !answers[qid]) continue;
    for (const o of selectedOptions(q, answers)) for (const t of o.traits || []) addDirect(t, { ...answerRef(q, o.id), mapping: 'direct' });
  }
  for (const qid of ['K2', 'K4']) {
    const q = allQ[qid]; if (!q || !answers[qid]) continue;
    for (const o of selectedOptions(q, answers)) for (const t of o.traits || []) addInterpreted(t, answerRef(q, o.id));
  }
  // 現在像にもある特性は、その導出（推論）を別の根拠として並べる（本人の選択とは区別して追える）
  for (const t of observed_traits) if (prot.has(t.trait)) prot.get(t.trait).sources.push(derivationRef(t));
  const released = [];
  const release = (trait, ref, why) => {
    if (prot.has(trait)) prot.delete(trait);
    if (!released.some((r) => r.trait === trait)) released.push({ trait, label: TRAITS[trait].label, inference_status: 'user_answer', why, source: ref });
  };
  for (const f of followups) {
    const a = (answers[f.id] || [])[0];
    if (f.kind === 'inversion') {
      if (a === 'release') release(f.trait, answerRef(f, a), '成長・憧れのために手放すことを本人が選択');
      else if (a === 'augment' && prot.has(f.trait)) prot.get(f.trait).notes.push(`「${(CAPABILITIES[f.target] || ASPIRATIONS[f.target]).label}」は、この特性を保ったまま加える（本人の選択）`);
      else if (!a || a === UNKNOWN) unresolved.push({ field: 'protected_traits', ref: f.id, why: `「${TRAITS[f.trait].label}」と「${(CAPABILITIES[f.target] || ASPIRATIONS[f.target]).label}」の関係が未確定。反転させず、保護したままにしている` });
    }
    if (f.kind === 'observed_mismatch') {
      const e = prot.get(f.trait);
      if (a === 'observed') {
        // 直接選んでいても、本人が「ふだんは逆」と答えたら候補に戻し、初対面画面で確かめる
        if (e) { e.confirmed = false; e.inference_status = 'system_inferred'; e.basis = 'demoted_by_answer'; e.notes.push(`本人は「ふだんは${TRAITS[f.observed].short}のほうが近い」と回答。現在の特性ではなく憧れの可能性があるため要確認`); }
        unresolved.push({ field: 'protected_traits', ref: f.id, why: `「${TRAITS[f.trait].label}」は残す特性か憧れかが未確定` });
      } else if (a === 'chosen' || a === 'both') {
        if (e) e.notes.push(a === 'chosen' ? `現在像（${current.source === 'eti_v2' ? 'ETI' : '簡易質問'}）とは逆向きだが、本人は「こちらが近い」と回答` : '本人は「場面によって両方ある」と回答');
      } else {
        unresolved.push({ field: 'protected_traits', ref: f.id, why: '現在像と本人の選択の食い違いが未解決' });
      }
    }
    if (f.kind === 'transform_target') {
      for (const o of selectedOptions(f, answers)) for (const t of o.traits || []) release(t, answerRef(f, o.id), '「性格そのものを変えたい」部分として本人が選択');
      if (isUnknownAns(answers, f.id)) unresolved.push({ field: 'protected_traits', ref: f.id, why: '変えたい部分が未確定。変更せずに保護している' });
    }
  }
  // 現在像の特性で、まだ無く、手放してもおらず、本人が直接選んだ特性と逆向きでもないものは「候補」
  const releasedIds = new Set(released.map((r) => r.trait));
  const directNow = () => new Set([...prot.values()].filter((e) => e.confirmed).map((e) => e.trait));
  for (const t of observed_traits) {
    if (prot.has(t.trait) || releasedIds.has(t.trait)) continue;
    const d = directNow();
    if (OPPOSING_TRAITS.some(([a, b]) => (a === t.trait && d.has(b)) || (b === t.trait && d.has(a)))) continue;
    const e = entry(t.trait); e.basis = 'derived_from_current'; e.sources.push(derivationRef(t));
  }
  // 初対面画面での本人の確認（候補だけに効く）
  const appliedConfirmations = {};
  for (const e of prot.values()) {
    if (e.confirmed) continue;
    const d = confirmations[e.trait];
    if (d === 'keep') {
      e.confirmed = true; e.inference_status = 'user_answer'; e.user_decision = 'keep'; e.basis_before = e.basis; e.basis = 'confirmed_at_first_meeting';
      e.sources.push({ kind: 'first_meeting_confirmation', status: 'user_answer', trait: e.trait, decision: 'keep' });
      appliedConfirmations[e.trait] = 'keep';
    } else if (d === 'not_keep') {
      e.user_decision = 'not_keep';
      e.sources.push({ kind: 'first_meeting_confirmation', status: 'user_answer', trait: e.trait, decision: 'not_keep' });
      appliedConfirmations[e.trait] = 'not_keep';
    }
  }
  for (const e of prot.values()) if (e.confirmed) e.user_decision = 'keep';
  const sortT = (a, b) => order(a.trait, b.trait, TRAITS);
  const protected_traits = [...prot.values()].filter((e) => e.confirmed).sort(sortT);
  const protected_trait_candidates = [...prot.values()].filter((e) => !e.confirmed).sort(sortT);
  if (!protected_traits.length) unknowns.push({ field: 'protected_traits', why: '本人が選んだ・確かめた保護特性がない' });
  const keepIds = protected_traits.map((p) => p.trait);
  // 反転を避ける制約や振る舞いの土台には、本人が「残さない」と答えた候補以外を使う（確かめるまでは慎重に扱う）
  const keepAll = [...keepIds, ...protected_trait_candidates.filter((c) => c.user_decision !== 'not_keep').map((c) => c.trait)];

  // ---------- growth_targets（GROWTH）
  const capRefs = new Map();
  const addCap = (c, ref) => { if (!capRefs.has(c)) capRefs.set(c, []); capRefs.get(c).push(ref); };
  const g1 = selectedOptions(qById.G1, answers).flatMap((o) => o.capabilities || []);
  const g2opts = selectedOptions(qById.G2, answers);
  const g2 = g2opts.flatMap((o) => o.capabilities || []);
  const pri = fq.F_GROW_PRIORITY;
  if (pri) {
    const a = (answers[pri.id] || [])[0];
    const o = pri.options.find((x) => x.id === a);
    if (o && o.capabilities) for (const c of o.capabilities) addCap(c, answerRef(pri, a));
    else { for (const c of [...g1, ...g2]) addCap(c, answerRef(qById[g1.includes(c) ? 'G1' : 'G2'], (answers[g1.includes(c) ? 'G1' : 'G2'] || [])[0])); unresolved.push({ field: 'growth_targets', ref: pri.id, why: '優先する能力が未確定（両方を候補として残す）' }); }
  } else {
    for (const c of g1) addCap(c, answerRef(qById.G1, answers.G1[0]));
    for (const c of g2) addCap(c, answerRef(qById.G2, answers.G2[0]));
  }
  if (fq.F_GROW) for (const o of selectedOptions(fq.F_GROW, answers)) for (const c of o.capabilities || []) addCap(c, answerRef(fq.F_GROW, o.id));
  const g4 = (answers.G4 || [])[0];
  const mode = g4 === 'augment' ? 'augment' : g4 === 'transform' ? 'transform' : UNKNOWN;
  // 最終的に採用した目標が adaptive.js の判定と一致することを確かめる（追加回答で決まった目標も確認の対象にするため）
  const resolved = resolveGrowthCaps(answers);
  if (!resolved.pending) for (const c of resolved.caps) if (!capRefs.has(c)) throw new Error(`growth target mismatch: ${c}`);
  const asked = new Set(followups.map((f) => f.id));
  const notAsked = new Map(overflow.map((f) => [f.id, f]));
  // 保護特性と逆向きになりうる目標・憧れについて、本人の確認の状態をまとめる
  const protectionCheck = (target, field) => (INVERSION_RISKS[target] || []).filter((t) => keepAll.includes(t) || releasedIds.has(t)).map((t) => {
    const qid = `F_INV_${target}_${t}`;
    const a = (answers[qid] || [])[0];
    let resolution;
    if (releasedIds.has(t) && !(asked.has(qid) && a)) return { trait: t, question: null, resolution: 'release', status: 'user_answer' }; // 別の質問で手放すと選択済み
    if (asked.has(qid) && a && a !== UNKNOWN) resolution = a;
    else if (asked.has(qid)) resolution = UNKNOWN; // 「まだ決められない」は上の inversion 処理で未確定に記録済み
    else {
      // 確認の質問が上限で出せなかった、または上限で成長目標の優先度を確かめられず確認自体が作られなかった
      const limit = notAsked.has(qid) || overflow.length > 0;
      resolution = limit ? 'not_asked_question_limit' : 'not_asked';
      unresolved.push({ field, ref: qid, kind: 'protection_check', trait: t, target, why: `「${TRAITS[t].label}」と「${(CAPABILITIES[target] || ASPIRATIONS[target]).label}」の関係を${limit ? '質問の上限（18問）のため' : ''}確認できなかった。反転させず、「${TRAITS[t].short}」は保護したまま未確定にしている` });
    }
    return { trait: t, question: qid, resolution, status: resolution.startsWith('not_asked') || resolution === UNKNOWN ? 'unknown' : 'user_answer' };
  });
  const growth_targets = [...capRefs.keys()].sort((a, b) => order(a, b, CAPABILITIES)).map((c) => {
    const def = CAPABILITIES[c];
    const basisTrait = keepAll.find((t) => def.behaviors[t]);
    const constraints = (INVERSION_RISKS[c] || []).filter((t) => keepAll.includes(t)).map((t) => `「${TRAITS[t].label}」を保ったまま（反転させない）`);
    const gapScene = g2opts.find((o) => (o.capabilities || []).includes(c));
    return {
      capability: c, label: def.label, inference_status: 'user_answer', sources: capRefs.get(c),
      mode, mode_status: mode === UNKNOWN ? 'unknown' : 'user_answer',
      gap: { current_scene: gapScene ? gapScene.label : null, desired: def.label, current_scene_status: gapScene ? 'user_answer' : 'unknown' },
      behavior: { text: basisTrait ? def.behaviors[basisTrait] : def.behaviors.default, built_on: basisTrait || null, inference_status: 'system_inferred' },
      constraints,
      protection_check: protectionCheck(c, 'growth_targets'),
    };
  });
  if (!growth_targets.length) unknowns.push({ field: 'growth_targets', why: '伸ばしたい力が未回答・不明' });
  if (mode === UNKNOWN && growth_targets.length) unknowns.push({ field: 'growth_targets.mode', why: '性格を保つか変えるかが不明（保つ前提で下書きしている）' });

  // ---------- aspirational_traits（ASPIRATION）
  const aspRefs = new Map();
  for (const qid of ['E1', 'F_ASPIRATION']) {
    const q = allQ[qid]; if (!q || !answers[qid]) continue;
    for (const o of selectedOptions(q, answers)) for (const a of o.aspirations || []) { if (!aspRefs.has(a)) aspRefs.set(a, []); aspRefs.get(a).push(answerRef(q, o.id)); }
  }
  const aspirational_traits = [...aspRefs.keys()].sort((a, b) => order(a, b, ASPIRATIONS)).map((a) => {
    const def = ASPIRATIONS[a];
    const compatible_with = def.compatible.filter((t) => keepAll.includes(t));
    const tension = protectionCheck(a, 'aspirational_traits');
    let integration;
    const tensionKeep = tension.filter((x) => x.resolution !== 'release');
    if (tensionKeep.length) integration = `「${tensionKeep.map((x) => TRAITS[x.trait].short).join('・')}」を保ったまま、必要な場面で表れる${def.label}`;
    else if (compatible_with.length) integration = `「${compatible_with.map((t) => TRAITS[t].short).join('・')}」を土台にした${def.label}`;
    else integration = `${def.label}（今の特性との結びつきは本人の確認待ち）`;
    return {
      aspiration: a, label: def.label, inference_status: 'user_answer', sources: aspRefs.get(a),
      compatible_with, tension,
      integration: { text: integration, inference_status: 'system_inferred' },
    };
  });
  if (!aspirational_traits.length) unknowns.push({ field: 'aspirational_traits', why: '憧れる魅力が未回答・不明' });

  // ---------- core_values
  const vmap = new Map();
  const addVal = (v, status, ref) => {
    if (!vmap.has(v)) vmap.set(v, { value: v, label: VALUES[v].label, statuses: [], sources: [] });
    const e = vmap.get(v); if (!e.statuses.includes(status)) e.statuses.push(status); e.sources.push(ref);
  };
  for (const qid of ['K3', 'F_VALUES']) {
    const q = allQ[qid]; if (!q || !answers[qid]) continue;
    for (const o of selectedOptions(q, answers)) for (const v of o.values || []) addVal(v, 'user_answer', answerRef(q, o.id));
  }
  for (const v of current.values) addVal(v.value, v.inference_status, { kind: v.evidence.kind, evidence: v.evidence });
  const core_values = [...vmap.values()].map((e) => ({
    ...e, inference_status: e.statuses.includes('user_answer') ? 'user_answer' : e.statuses[0],
    user_selected: e.sources.some((s) => s.kind === 'answer'),
  })).sort((a, b) => Number(b.user_selected) - Number(a.user_selected) || order(a.value, b.value, VALUES));
  if (!core_values.length) unknowns.push({ field: 'core_values', why: '価値観が未回答・不明' });

  // ---------- decision_principles（下書き・システム推論）
  const decision_principles = [];
  const modTrait = keepIds.find((t) => TRAIT_MODIFIERS[t]) || keepAll.find((t) => TRAIT_MODIFIERS[t]);
  core_values.slice(0, 3).forEach((v, i) => {
    let text = VALUE_PRINCIPLES[v.value];
    const basis = [{ element: 'core_values', id: v.value }];
    if (i === 0 && modTrait) { text += `。${TRAIT_MODIFIERS[modTrait]}`; basis.push({ element: keepIds.includes(modTrait) ? 'protected_traits' : 'protected_trait_candidates', id: modTrait }); }
    decision_principles.push({ id: `DP_VALUE_${v.value}`, text, basis, inference_status: 'system_inferred', status: 'draft' });
  });
  const e4 = (answers.E4 || [])[0];
  if (e4 && PRESSURE_PRINCIPLES[e4]) decision_principles.push({ id: `DP_PRESSURE_${e4}`, text: PRESSURE_PRINCIPLES[e4], basis: [{ element: 'answer', id: 'E4', option: e4 }], inference_status: 'system_inferred', status: 'draft' });
  if (keepIds.length) {
    decision_principles.push({
      id: 'DP_CONTINUITY', text: `成長のために「${keepIds.map((t) => TRAITS[t].short).join('」「')}」を手放す選択はしない（本人が変更を承認した場合を除く）`,
      basis: keepIds.map((t) => ({ element: 'protected_traits', id: t })), inference_status: 'system_inferred', status: 'draft',
    });
  }
  if (!decision_principles.length) unknowns.push({ field: 'decision_principles', why: '価値観・行動の回答が不足しており、判断原則を下書きできない' });

  // ---------- expression_profile（Phase 2 の口調・振る舞い・視覚表現の設計情報。口調そのものは作らない）
  const pick1 = (qid) => { const a = (answers[qid] || [])[0]; return a && a !== UNKNOWN ? { id: a, label: qById[qid].options.find((o) => o.id === a).label, inference_status: 'user_answer' } : { id: UNKNOWN, inference_status: 'unknown' }; };
  const avoid = [...new Set(keepAll.filter((t) => !releasedIds.has(t)).flatMap((t) => AVOID_BY_TRAIT[t] || []))];
  const expression_profile = {
    presence: aspirational_traits.map((a) => a.aspiration),
    channel: pick1('E2'),
    impression_intent: pick1('E3'),
    under_pressure: pick1('E4'),
    growth_pace: pick1('G3'),
    preserve: keepIds,
    preserve_candidates: keepAll.filter((t) => !keepIds.includes(t)),
    avoid: { items: avoid, inference_status: 'system_inferred' },
    phase2_constraints: {
      tone_presets: 'not_used',
      avatar: 'original_idealized_character',
      do_not_infer_from_scales: ['gender', 'face', 'ethnicity', 'age'],
      identity_lock_after_approval: true,
    },
  };

  // ---------- 下書きの要約（仮説として表示する）
  const summary = composeSummary(protected_traits, growth_targets, aspirational_traits);

  for (const o of overflow.filter((x) => x.kind !== 'inversion')) unresolved.push({ field: 'question_limit', ref: o.id, why: `質問の上限（18問）で確認できなかった：${o.reason}` });

  // ---------- 出所・版
  const source_provenance = {
    current_source: current.source,
    eti: current.source === 'eti_v2' ? current.provenance : null,
    quick_question_set_version: current.source === 'quick_questions' ? QUICK_SET_VERSION : null,
    ideal_question_set_version: IDEAL_SET_VERSION,
    rule_version: RULE_VERSION,
    catalog_version: CATALOG_VERSION,
    consent_version: CONSENT_VERSION,
    profile_schema_version: PROFILE_SCHEMA_VERSION,
    followups_asked: followups.map((f) => ({ id: f.id, kind: f.kind, reason: f.reason })),
  };

  const inputForHash = { current: { source: current.source, measurements: current.measurements, traits: current.traits, values: current.values, unknowns: current.unknowns, scales: current.scales, provenance: current.provenance }, answers, followups: followups.map((f) => f.id), overflow: overflow.map((f) => f.id), confirmations: appliedConfirmations, rule: RULE_VERSION };
  const input_hash = fnv1a(canonical(inputForHash));

  return {
    schema_version: PROFILE_SCHEMA_VERSION,
    future_horizon_years: FUTURE_HORIZON_YEARS,
    summary,
    observed_measurements,
    observed_traits,
    observed_scales: current.scales || null,
    protected_traits,
    protected_trait_candidates,
    released_traits: released,
    growth_targets,
    aspirational_traits,
    core_values,
    decision_principles,
    expression_profile,
    source_provenance,
    inference_status: { legend: INFERENCE_STATUSES, unknowns, unresolved },
    persona_version: `${RULE_VERSION}+draft.${input_hash}`,
    input_hash,
    approval_status: 'unconfirmed',
    evaluation: {
      phase: 2, scale: [1, 5], ratings: null,
      axes: [
        { id: 'self_continuity', label: '自分らしさ', question: '自分と本質的につながっていると感じるか', elements: ['protected_traits', 'core_values'] },
        { id: 'aspiration', label: '憧れ', question: 'この人物のように成長したいと思えるか', elements: ['aspirational_traits', 'growth_targets'] },
        { id: 'attainability', label: '到達可能性', question: '5年後の自分として想像できるか', elements: ['growth_targets', 'expression_profile'] },
      ],
      on_low_rating: 'adjust_only_linked_elements_via_choice_followups',
    },
    disclaimer: DISCLAIMER,
  };
}

function composeSummary(prot, growth, asp) {
  const keep = prot.filter((p) => p.confirmed).map((p) => p.label);
  const parts = [];
  if (keep.length) parts.push(`${keep.join('と')}を保ちながら`);
  if (growth.length) parts.push(`${growth[0].behavior.text}ことができ`);
  const head = parts.length ? parts.join('、') : '';
  const aspText = asp.length ? `${asp.map((a) => a.label).join('と')}を備えた人物` : '人物（憧れる魅力は未確定）';
  const text = `${head}${head ? '、' : ''}${aspText}。`;
  return { text, inference_status: 'system_inferred', status: 'draft', note: '設計上の仮説。本人の確認前' };
}

function order(a, b, catalog) { const k = Object.keys(catalog); return k.indexOf(a) - k.indexOf(b); }

export function setApproval(profile, status) {
  if (!APPROVAL_STATUSES.includes(status)) throw new Error(`invalid approval status: ${status}`);
  return { ...profile, approval_status: status };
}
