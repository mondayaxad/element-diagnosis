import * as S from '../src/state.js';
import * as F from '../fixtures/synthetic_eti.js';
import { UNKNOWN } from '../src/catalog.js';

// §3 の例：内向的・思慮深い人が「静かな存在感・揺るがない信念」を望む
export const QUIET_CHARISMA = {
  K1: ['inner_focus', 'curiosity'], K2: ['think'], K3: ['SD', 'UN'], K4: ['no_alone'],
  G1: ['clear_expression'], G2: ['meeting'], G3: ['gradual'], G4: ['augment'],
  E1: ['quiet_presence', 'unwavering_conviction'], E2: ['small_group'], E3: ['core'], E4: ['organize'],
};
// 同じ現在像で、理想だけ違う（包容力・頼れる実行力）
export const WARM_DRIVE = {
  K1: ['empathy'], K2: ['support'], K3: ['BE'], K4: ['numb'],
  G1: ['follow_through'], G2: ['stop'], G3: ['leap'], G4: ['augment'],
  E1: ['warmth_capacity', 'dependable_drive'], E2: ['action'], E3: ['reassuring'], E4: ['receive'],
};
export const ALL_UNKNOWN = Object.fromEntries(['K1', 'K2', 'K3', 'K4', 'G1', 'G2', 'G3', 'G4', 'E1', 'E2', 'E3', 'E4'].map((k) => [k, [UNKNOWN]]));
export const QUICK_INTROVERT = { C1: ['alone'], C2: ['plan'], C3: ['explore'], C4: ['understand'], C5: ['self'], C6: ['SD'] };

export function consented(opts = { eti_import: true, memory: false }) {
  return S.submitConsent(S.initialState(F.SYNTHETIC_SUBJECT_ID), opts);
}
export function etiCurrent(record = F.OWN_INTROVERT) {
  let s = S.chooseRoute(consented(), 'eti');
  s = S.verifyIdentity(s, true);
  return S.attemptImport(s, record, 'r');
}
export function quickCurrent(answers = QUICK_INTROVERT) {
  let s = S.chooseRoute(consented({ eti_import: false, memory: false }), 'quick');
  for (const [k, v] of Object.entries(answers)) s = S.answerQuick(s, k, v[0]);
  return S.finishQuick(s);
}
// 基本12問を答え、出てきた追加質問には answerFor(f) の回答を返す（既定は「わからない」）
export function answerAll(state, base, answerFor = () => UNKNOWN) {
  let s = S.startIdeal(state);
  for (const [k, v] of Object.entries(base)) s = S.answerIdeal(s, k, v);
  for (let guard = 0; guard < 20 && !S.idealDone(s); guard++) {
    const q = S.idealQueue(s).find((x) => !s.idealAnswers[x.id]);
    s = S.answerIdeal(s, q.id, [answerFor(q)]);
  }
  return s;
}
export { S, F };
