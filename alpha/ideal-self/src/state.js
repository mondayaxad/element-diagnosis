// 初回設定の状態遷移（純粋関数）。画面（app.js）とテストの両方から使う。
// 方針：前の回答を変えたら、それに依存する後段（追加質問の回答・下書き）を必ず作り直す。
import { initialConsents, setConsent, isGranted, judgeRevocation } from './consent.js';
import { importEtiResult } from './eti_import.js';
import { currentFromEti, currentFromQuick, validQuickAnswers } from './current.js';
import { idealQuestionsFor, computeFollowups } from './adaptive.js';
import { buildFutureSelfProfile, setApproval } from './profile.js';
import { QUICK_QUESTIONS, IDEAL_QUESTIONS, BASE_QUESTION_COUNT, MAX_QUESTIONS } from './questions.js';
import { UNKNOWN } from './catalog.js';

export const STEPS = ['consent', 'current_select', 'eti_import', 'quick', 'current_review', 'ideal', 'draft'];

export function initialState(subjectId) {
  return {
    step: 'consent',
    consents: initialConsents(),
    subject: { id: subjectId, identityVerified: false },
    importAttempt: null, imported: null, current: null,
    quickAnswers: {}, quickIndex: 0,
    idealAnswers: {}, idealIndex: 0,
    followups: [], overflow: [],
    profile: null,
    log: [],
  };
}

const withLog = (s, ev) => ({ ...s, log: [...s.log, ev] });

export function submitConsent(state, { eti_import, memory }) {
  let c = state.consents;
  c = setConsent(c, 'eti_import', !!eti_import);
  c = setConsent(c, 'memory', !!memory);
  return withLog({ ...state, consents: c, step: 'current_select' }, { type: 'consent', eti_import: c.eti_import.status, memory: c.memory.status });
}

export function chooseRoute(state, route) {
  if (route === 'eti') return { ...state, step: 'eti_import' };
  return { ...state, step: 'quick', quickIndex: 0 };
}

export function verifyIdentity(state, verified) {
  return { ...state, subject: { ...state.subject, identityVerified: !!verified } };
}

export function attemptImport(state, record, key) {
  const r = importEtiResult(record, { subjectId: state.subject.id, identityVerified: state.subject.identityVerified, consent: state.consents.eti_import });
  if (!r.ok) {
    return withLog({ ...state, importAttempt: { key, ok: false, reason: r.reason, message: r.message, detail: r.detail } }, { type: 'import_rejected', key, reason: r.reason });
  }
  return setCurrent(withLog({ ...state, importAttempt: { key, ok: true }, imported: r.data }, { type: 'import_ok', key }), currentFromEti(r.data));
}

export function answerQuick(state, qid, optionId) {
  const quickAnswers = { ...state.quickAnswers, [qid]: [optionId] };
  const idx = QUICK_QUESTIONS.findIndex((q) => q.id === qid);
  return { ...state, quickAnswers, quickIndex: Math.min(idx + 1, QUICK_QUESTIONS.length) };
}

export function finishQuick(state) {
  if (!validQuickAnswers(state.quickAnswers)) throw new Error('quick answers incomplete');
  return setCurrent({ ...state, imported: null }, currentFromQuick(state.quickAnswers));
}

function setCurrent(state, current) {
  // 現在像が変わったら、追加質問と下書きを作り直す（基本12問の回答は本人の選択なので残す）
  return recompute({ ...state, current, step: 'current_review' });
}

export function startIdeal(state) {
  return { ...state, step: 'ideal', idealIndex: Math.min(state.idealIndex, idealQueue(state).length - 1) };
}

export function baseComplete(answers) {
  return IDEAL_QUESTIONS.every((q) => Array.isArray(answers[q.id]) && answers[q.id].length > 0);
}

// いま出す質問の並び（基本12問 → 必要なときだけ追加質問）
export function idealQueue(state) {
  if (!state.current) return [];
  const base = idealQuestionsFor(state.current);
  return baseComplete(state.idealAnswers) ? [...base, ...state.followups] : base;
}

function recompute(state) {
  if (!state.current) return { ...state, followups: [], overflow: [], profile: null };
  let followups = []; let overflow = [];
  if (baseComplete(state.idealAnswers)) ({ followups, overflow } = computeFollowups(state.current, state.idealAnswers));
  // 出なくなった追加質問の回答は捨てる（古い分岐の回答が下書きに混ざらないように）
  const keepIds = new Set([...IDEAL_QUESTIONS.map((q) => q.id), ...followups.map((f) => f.id)]);
  const idealAnswers = Object.fromEntries(Object.entries(state.idealAnswers).filter(([k]) => keepIds.has(k)));
  // 追加質問の文面・選択肢が変わったら、その回答も捨てる
  for (const f of followups) {
    const a = idealAnswers[f.id];
    if (a && !a.every((oid) => f.options.some((o) => o.id === oid))) delete idealAnswers[f.id];
  }
  return { ...state, idealAnswers, followups, overflow, profile: null, step: state.step === 'draft' ? 'ideal' : state.step };
}

export function answerIdeal(state, qid, optionIds) {
  const queue = idealQueue(state);
  const q = queue.find((x) => x.id === qid);
  if (!q) throw new Error(`unknown question ${qid}`);
  let sel = [...new Set(optionIds)];
  if (sel.includes(UNKNOWN)) sel = [UNKNOWN];
  const max = q.multi || 1;
  if (sel.length === 0 || sel.length > max) throw new Error(`invalid selection count for ${qid}`);
  if (!sel.every((oid) => q.options.some((o) => o.id === oid))) throw new Error(`invalid option for ${qid}`);
  const next = recompute({ ...state, idealAnswers: { ...state.idealAnswers, [qid]: sel } });
  const newQueue = idealQueue(next);
  if (newQueue.length > MAX_QUESTIONS) throw new Error('question limit exceeded');
  const idx = newQueue.findIndex((x) => x.id === qid);
  return { ...next, step: 'ideal', idealIndex: Math.min(idx + 1, newQueue.length) };
}

export function idealDone(state) {
  const queue = idealQueue(state);
  return baseComplete(state.idealAnswers) && queue.every((q) => Array.isArray(state.idealAnswers[q.id]) && state.idealAnswers[q.id].length > 0);
}

export function buildDraft(state) {
  if (!idealDone(state)) throw new Error('ideal questions not complete');
  const profile = buildFutureSelfProfile({ current: state.current, answers: state.idealAnswers, followups: state.followups, overflow: state.overflow });
  return withLog({ ...state, profile, step: 'draft' }, { type: 'draft_built', persona_version: profile.persona_version });
}

export function markApproval(state, status) {
  if (!state.profile) throw new Error('no profile');
  return { ...state, profile: setApproval(state.profile, status) };
}

export function goBack(state) {
  switch (state.step) {
    case 'current_select': return { ...state, step: 'consent' };
    case 'eti_import': return { ...state, step: 'current_select', importAttempt: null };
    case 'quick': return state.quickIndex > 0 ? { ...state, quickIndex: state.quickIndex - 1 } : { ...state, step: 'current_select' };
    case 'current_review': return { ...state, step: state.current && state.current.source === 'eti_v2' ? 'eti_import' : 'quick', quickIndex: Math.max(0, QUICK_QUESTIONS.length - 1) };
    case 'ideal': return state.idealIndex > 0 ? { ...state, idealIndex: state.idealIndex - 1 } : { ...state, step: 'current_review' };
    case 'draft': return { ...state, step: 'ideal', idealIndex: Math.max(0, idealQueue(state).length - 1) };
    default: return state;
  }
}

export function revoke(state, purpose) {
  const actions = judgeRevocation(purpose, state);
  let s = { ...state, consents: setConsent(state.consents, purpose, false) };
  for (const a of actions) {
    if (a.target === 'imported_eti' && a.action === 'delete') s = { ...s, imported: null, importAttempt: null };
    if (a.target === 'current' && a.action === 'delete') s = { ...s, current: null };
    if (a.target === 'profile' && a.action === 'delete_and_regenerate') s = { ...s, profile: null, followups: [], overflow: [] };
    if (a.target === 'route' && a.action === 'goto_current_select') s = { ...s, step: 'current_select' };
  }
  return withLog(s, { type: 'revoke', purpose, actions: actions.map((a) => `${a.target}:${a.action}`) });
}

export const canPersist = (state) => isGranted(state.consents, 'memory');

export { BASE_QUESTION_COUNT, MAX_QUESTIONS };
