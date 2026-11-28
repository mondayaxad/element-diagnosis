// 初回設定の状態遷移（純粋関数）。画面（app.js）とテストの両方から使う。
// 方針：前の回答を変えたら、それに依存する後段（追加質問の回答・下書き）を必ず作り直す。
import { initialConsents, setConsent, isGranted, judgeRevocation } from './consent.js';
import { importEtiResult } from './eti_import.js';
import { currentFromEti, currentFromQuick, validQuickAnswers } from './current.js';
import { idealQuestionsFor, computeFollowups } from './adaptive.js';
import { buildFutureSelfProfile } from './profile.js';
import { AXES, validateRatings, lowAxes, REVIEW_REASONS, revisionQuestions, createLock, verifyLock, restoreLock, buildGreeting } from './persona.js';
import { respond, MAX_USER_TURNS, isCrisis, isStopRequest } from './dialogue.js';
import * as C from './commitment.js';
import { buildIntervention } from './intervention.js';
import { QUICK_QUESTIONS, IDEAL_QUESTIONS, BASE_QUESTION_COUNT, MAX_QUESTIONS } from './questions.js';
import { UNKNOWN } from './catalog.js';

export const STEPS = ['consent', 'current_select', 'eti_import', 'quick', 'current_review', 'ideal', 'draft', 'meet', 'evaluate', 'revise', 'home', 'dialogue', 'locked_view', 'commit_new', 'commit_check', 'commit_view', 'stop', 'reflect', 'records'];

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
    // Phase 2：人格の版・評価・承認・固定。seq は時刻の代わりの通し番号（同じ操作なら同じ結果になるように）
    persona: emptyPersona(),
    dialogue: { persona_version: null, messages: [] },
    // Phase 3：模擬約束。会話（dialogue）とは別の領域で、更新は下の commit* 関数からだけ行う
    commitments: C.initialCommitments(),
    log: [],
  };
}
const emptyPersona = () => ({ seq: 0, confirmations: {}, versions: [], evaluations: [], approvals: [], locked: null, revision: null });

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
  return { ...rebuild(state, 'draft'), step: 'draft' };
}

// 下書きを作り直し、表示する版として記録する（同じ内容なら同じ版）
function rebuild(state, origin) {
  if (!idealDone(state)) throw new Error('ideal questions not complete');
  const persona = state.persona || emptyPersona();
  const profile = buildFutureSelfProfile({ current: state.current, answers: state.idealAnswers, followups: state.followups, overflow: state.overflow, confirmations: persona.confirmations });
  const seq = persona.seq + 1;
  const last = persona.versions[persona.versions.length - 1];
  const versions = last && last.persona_version === profile.persona_version ? persona.versions
    : [...persona.versions, { persona_version: profile.persona_version, seq, origin, status: 'unconfirmed' }];
  return withLog({ ...state, profile, persona: { ...persona, seq, versions } }, { type: 'draft_built', origin, persona_version: profile.persona_version });
}

// ================================================================ Phase 2
const needProfile = (s) => { if (!s.profile) throw new Error('no profile'); };
const versionStatus = (persona, pv, status) => ({ ...persona, versions: persona.versions.map((v) => (v.persona_version === pv ? { ...v, status } : v)) });

// 初対面
export function meet(state) { needProfile(state); return { ...state, step: 'meet' }; }
export const greetingOf = (state) => buildGreeting(state.profile);

// 候補を「残したい」「残さない」「まだ決めない」。候補だけに効く。変えたら新しい版になる
export function decideCandidate(state, trait, decision) {
  needProfile(state);
  if (!['keep', 'not_keep', 'undecided'].includes(decision)) throw new Error(`invalid decision ${decision}`);
  if (!state.profile.protected_trait_candidates.some((c) => c.trait === trait) && !(state.persona.confirmations[trait])) throw new Error(`not a candidate: ${trait}`);
  const confirmations = { ...state.persona.confirmations };
  if (decision === 'undecided') delete confirmations[trait]; else confirmations[trait] = decision;
  return { ...rebuild({ ...state, persona: { ...state.persona, confirmations } }, 'first_meeting_confirmation'), step: 'meet' };
}

export function toEvaluate(state) { needProfile(state); return { ...state, step: 'evaluate' }; }

// 3軸評価。表示している版にだけ記録できる
export function submitEvaluation(state, { persona_version, ratings, reasons = [] }) {
  needProfile(state);
  if (persona_version !== state.profile.persona_version) throw new Error('evaluation must be for the displayed persona version');
  if (!validateRatings(ratings)) throw new Error('ratings must be integers 1-5 for all three axes');
  const low = lowAxes(ratings);
  for (const r of reasons) {
    const def = REVIEW_REASONS.find((x) => x.id === r);
    if (!def) throw new Error(`unknown reason ${r}`);
  }
  const seq = state.persona.seq + 1;
  const ev = { persona_version, ratings: { ...ratings }, low_axes: low, reasons: [...reasons], seq };
  return withLog({ ...state, persona: { ...state.persona, seq, evaluations: [...state.persona.evaluations, ev] } }, { type: 'evaluated', persona_version, low_axes: low });
}

export const latestEvaluation = (state, pv) => [...state.persona.evaluations].reverse().find((e) => e.persona_version === pv) || null;
export function canApprove(state) {
  if (!state.profile) return false;
  const ev = latestEvaluation(state, state.profile.persona_version);
  return !!ev && ev.low_axes.length === 0 && !(state.persona.locked && state.persona.locked.persona_version === state.profile.persona_version);
}

// 承認：表示している版・その版の評価（違和感の軸が無いもの）に紐づけて固定する
export function approve(state, persona_version) {
  needProfile(state);
  if (persona_version !== state.profile.persona_version) throw new Error('approval must be for the displayed persona version');
  const ev = latestEvaluation(state, persona_version);
  if (!ev) throw new Error('evaluate the displayed version before approval');
  if (ev.low_axes.length) throw new Error('resolve low-rated axes (review) before approval');
  if (state.persona.locked && state.persona.locked.persona_version === persona_version) throw new Error('already approved');
  const lock = createLock(state.profile, ev);
  const seq = state.persona.seq + 1;
  let persona = { ...state.persona, seq, locked: lock, approvals: [...state.persona.approvals, { persona_version, evaluation_seq: ev.seq, seq, content_hash: lock.content_hash, superseded: state.persona.locked ? state.persona.locked.persona_version : null }] };
  if (state.persona.locked) persona = versionStatus(persona, state.persona.locked.persona_version, 'superseded');
  persona = versionStatus(persona, persona_version, 'approved');
  return withLog({ ...state, profile: { ...state.profile, approval_status: 'approved' }, persona, dialogue: { persona_version, messages: [] }, step: 'home' }, { type: 'approved', persona_version, content_hash: lock.content_hash });
}

// 違和感の理由を選んで、該当する質問だけを見直す
export function startRevision(state, reasonIds) {
  needProfile(state);
  if (!reasonIds.length) throw new Error('choose at least one reason');
  const questions = revisionQuestions(reasonIds, IDEAL_QUESTIONS.map((q) => q.id));
  const pv = state.profile.persona_version;
  // キャンセルで戻すための、開始前の状態（回答・表示していた下書き・評価・候補の確認・版の履歴）。
  // 承認済みの固定内容・承認の記録・会話はここに含めない（見直しの間もキャンセル後も、そのまま使い続ける）
  const before = {
    step: state.step,
    idealAnswers: state.idealAnswers, idealIndex: state.idealIndex, followups: state.followups, overflow: state.overflow,
    profile: state.profile,
    persona: { seq: state.persona.seq, confirmations: state.persona.confirmations, versions: state.persona.versions, evaluations: state.persona.evaluations },
  };
  let persona = { ...state.persona, revision: { from_version: pv, reasons: [...reasonIds], questions, index: 0, touched: [], before } };
  if (!(state.persona.locked && state.persona.locked.persona_version === pv)) persona = versionStatus(persona, pv, 'needs_revision');
  return withLog({ ...state, profile: { ...state.profile, approval_status: state.profile.approval_status === 'approved' ? 'approved' : 'needs_revision' }, persona, step: 'revise' }, { type: 'revision_started', from: pv, reasons: reasonIds });
}

// 見直しで出す質問：選んだ理由の質問 → 回答の変化で必要になった追加質問。
// 追加質問は「まだ答えていないもの」と「この見直しの中で答えたもの」を並べる（答えた途端に並びから消えて、
// 次の未回答の質問を飛ばさないように）。出なくなった追加質問は自然に外れる。
export function reviseQueue(state) {
  const r = state.persona.revision;
  if (!r) return [];
  const all = idealQueue(state);
  const base = r.questions.map((id) => all.find((q) => q.id === id)).filter(Boolean);
  const touched = new Set(r.touched || []);
  const extra = state.followups.filter((f) => !state.idealAnswers[f.id] || touched.has(f.id));
  return [...base, ...extra];
}

const answered = (state, q) => Array.isArray(state.idealAnswers[q.id]) && state.idealAnswers[q.id].length > 0;

// 見直しが終わったか：並びの質問がすべて回答済みで、追加質問も含めて理想像の質問がそろっている
export function revisionComplete(state) {
  return !!state.persona.revision && reviseQueue(state).every((q) => answered(state, q)) && idealDone(state);
}

// 表示する質問の位置。範囲外になっていても、未回答が残っていればそこを指す
export function revisionIndex(state) {
  const r = state.persona.revision;
  if (!r) return 0;
  const q = reviseQueue(state);
  if (r.index < q.length) return r.index;
  const firstOpen = q.findIndex((x) => !answered(state, x));
  return firstOpen >= 0 ? firstOpen : q.length;
}

export function answerRevision(state, qid, optionIds) {
  const r = state.persona.revision;
  if (!r) throw new Error('no revision in progress');
  if (!reviseQueue(state).some((q) => q.id === qid)) throw new Error(`question ${qid} is not part of this revision`);
  const next = answerIdeal(state, qid, optionIds);
  const touched = [...new Set([...(r.touched || []), qid])];
  const withTouched = { ...next, persona: { ...next.persona, revision: { ...next.persona.revision, touched } } };
  const q2 = reviseQueue(withTouched);
  const at = q2.findIndex((q) => q.id === qid);
  // 次は、答えた質問より後ろの最初の未回答。無ければ前に残った未回答。どちらも無ければ終わり
  let index = q2.findIndex((q, i) => i > at && !answered(withTouched, q));
  if (index < 0) index = q2.findIndex((q) => !answered(withTouched, q));
  if (index < 0) index = q2.length;
  return { ...withTouched, step: 'revise', idealIndex: state.idealIndex, persona: { ...withTouched.persona, revision: { ...withTouched.persona.revision, index } } };
}

export function finishRevision(state) {
  if (!state.persona.revision) throw new Error('no revision in progress');
  if (!revisionComplete(state)) throw new Error('revision has unanswered questions');
  const s = rebuild(state, 'revision');
  return withLog({ ...s, persona: { ...s.persona, revision: null }, step: 'meet' }, { type: 'revision_finished', persona_version: s.profile.persona_version });
}

// キャンセル：開始前の回答・表示していた下書き・評価に戻す。承認済みの固定内容・承認の記録・会話には触れない
export function cancelRevision(state) {
  const r = state.persona.revision;
  if (!r) return state;
  const b = r.before;
  return withLog({
    ...state,
    idealAnswers: b.idealAnswers, idealIndex: b.idealIndex, followups: b.followups, overflow: b.overflow,
    profile: b.profile,
    persona: { ...state.persona, ...b.persona, revision: null },
    step: b.step === 'revise' ? 'evaluate' : (b.step || 'evaluate'),
  }, { type: 'revision_cancelled', from: r.from_version });
}

// 承認後：ホーム・固定した人格の表示・模擬対話
export const goHome = (state) => { if (!state.persona.locked) throw new Error('no approved persona'); return { ...state, step: 'home' }; };
export const viewLocked = (state) => ({ ...goHome(state), step: 'locked_view' });
export const openDialogue = (state) => ({ ...goHome(state), step: 'dialogue' });
// 承認済みの版から新しい版を作る（固定した版は、新しい版を承認するまで会話に使い続ける）
export function reviseApproved(state, reasonIds) {
  if (!state.persona.locked) throw new Error('no approved persona');
  return startRevision(state, reasonIds);
}

// 模擬対話：固定した版だけを読み、会話の記録だけを足す（人格・判断原則・アバター・回答・同意には触れない）
export function sendMessage(state, text, opts = {}) {
  const lock = state.persona.locked;
  if (!lock) throw new Error('no approved persona');
  if (!verifyLock(lock)) throw new Error('approved persona failed integrity check');
  const d = state.dialogue.persona_version === lock.persona_version ? state.dialogue : { persona_version: lock.persona_version, messages: [] };
  if (d.halted) throw new Error('dialogue halted for safety');
  const turns = d.messages.filter((m) => m.role === 'user').length;
  if (turns >= MAX_USER_TURNS) throw new Error('dialogue turn limit reached');
  const msg = String(text || '').trim();
  if (!msg) throw new Error('empty message');
  // 「止めて」は、約束を読むだけの介入に切り替える（約束は更新しない）。強い苦痛の表現は respond の中断処理を優先
  const reply = isStopRequest(msg) && !isCrisis(msg)
    ? buildIntervention(lock, (() => { const sl = state.commitments || C.initialCommitments(); const t = opts.now ?? Date.now(); return C.activeCommitment(sl, t) || C.activePractice(sl, t); })())
    : respond(lock, msg);
  const messages = [...d.messages, { role: 'user', text: msg.slice(0, 400) }, { role: 'future_self', ...reply }];
  // 強い苦痛の表現があったら、この会話はここで止める（続けるときは本人が新しく始める）
  return { ...state, dialogue: { persona_version: lock.persona_version, messages, halted: reply.halt ? { reason: 'safety' } : null } };
}
export function restartDialogue(state) {
  const lock = state.persona.locked;
  if (!lock) throw new Error('no approved persona');
  return { ...state, dialogue: { persona_version: lock.persona_version, messages: [], halted: null }, step: 'dialogue' };
}
// ================================================================ Phase 3：模擬約束（会話とは別の更新処理）
const slice = (state) => state.commitments || C.initialCommitments();
const withC = (state, commitments, ev) => withLog({ ...state, commitments }, ev);
export const activeCommitment = (state, now) => C.activeCommitment(slice(state), now);
export function commitStart(state, now, opts = {}) { return { ...withC(state, C.startDraft(slice(state), now, opts), { type: 'commit_draft', practice: !!opts.practice }), step: 'commit_new' }; }
export const activePractice = (state, now) => C.activePractice(slice(state), now);
export function commitFacts(state, facts, now) { return { ...withC(state, C.setFacts(slice(state), facts, now), { type: 'commit_facts' }), step: 'commit_check' }; }
export function commitConfirm(state, choice, now) {
  const next = C.confirmDraft(slice(state), choice, now);
  const c = next.items[next.items.length - 1];
  return { ...withC(state, next, { type: 'commit_confirmed', id: c.id, cap_yen: c.cap_yen, deadline_at: c.deadline_at }), step: 'commit_view', viewCommitment: c.id };
}
export function commitDiscard(state) { return { ...withC(state, C.discardDraft(slice(state)), { type: 'commit_draft_discarded' }), step: state.persona.locked ? 'home' : 'records' }; }
export function commitLower(state, id, cap, version, now) { return withC(state, C.lowerCap(slice(state), id, cap, version, now), { type: 'commit_lowered', id, cap_yen: cap }); }
export function commitRaise(state, id, cap, version, now) { return withC(state, C.raiseCap(slice(state), id, cap, version, now), { type: 'commit_raised' }); }
export function commitCancel(state, id, version, now) { return withC(state, C.cancelCommitment(slice(state), id, version, now), { type: 'commit_cancelled' }); }
export function commitReflect(state, id, record, now) { return { ...withC(state, C.reflect(slice(state), id, record, now), { type: 'commit_reflected', id }), step: 'records' }; }
export const viewCommitment = (state, id) => { if (!slice(state).items.some((c) => c.id === id)) throw new Error('not found'); return { ...state, step: 'commit_view', viewCommitment: id }; };
export const openRecords = (state) => ({ ...state, step: 'records' });
export const openReflect = (state, id) => ({ ...state, step: 'reflect', viewCommitment: id });

// 削除（約束中でも可）。その約束に触れた会話の記録（「止めて」の案内）も一緒に消す
const purgeDialogue = (state, pred) => ({ ...state.dialogue, messages: (state.dialogue.messages || []).filter((m) => !pred(m)) });
export function commitDelete(state, id) {
  const next = C.deleteCommitment(slice(state), id);
  const log = state.log.filter((e) => !((e.id === id && String(e.type).startsWith('commit_')) || (e.type === 'stop' && e.commitment === id)));
  const stopView = state.stopView && state.stopView.commitment_id === id ? null : state.stopView;
  return { ...state, commitments: next, dialogue: purgeDialogue(state, (m) => m.commitment_id === id), log, stopView, step: 'records', viewCommitment: null };
}
export function commitDeleteAll(state) {
  const log = state.log.filter((e) => !(String(e.type).startsWith('commit_') || (e.type === 'stop' && e.commitment)));
  return { ...state, commitments: C.deleteAll(slice(state)), dialogue: purgeDialogue(state, (m) => !!m.commitment_id), log, stopView: null, step: 'records', viewCommitment: null };
}

// 「止めて」：最初に有効な約束を示し、承認済みの5年後の自分が、その場でできる行動を一つ伝える。
// 会話が強い苦痛で中断されているときは、人格の言葉は出さず、Phase 2 の案内を続ける
export function stop(state, now) {
  const lock = state.persona.locked && verifyLock(state.persona.locked) ? state.persona.locked : null;
  // 通常の約束を優先する。通常の約束が無いときだけ、進行中の練習の約束を示す
  const commitment = C.activeCommitment(slice(state), now) || C.activePractice(slice(state), now);
  const d = lock && state.dialogue.persona_version === lock.persona_version ? state.dialogue : { persona_version: lock ? lock.persona_version : null, messages: [] };
  if (d.halted) return { ...state, step: 'stop', stopView: { halted: true, commitment_id: commitment ? commitment.id : null } };
  const iv = buildIntervention(lock, commitment);
  const dialogue = lock ? { ...d, persona_version: lock.persona_version, messages: [...d.messages, { role: 'future_self', ...iv }] } : state.dialogue;
  return withLog({ ...state, dialogue, step: 'stop', stopView: { halted: false, intervention: iv, commitment_id: iv.commitment_id } }, { type: 'stop', commitment: iv.commitment_id, action: iv.action.id });
}

// 「止めて」の後に本人が実際に取った行動（任意）。提案された行動は stopView から別の項目として添えるだけ
export function recordTakenAction(state, { action_id, note = '' }, now) {
  const v = state.stopView;
  if (!v || !v.commitment_id) throw new C.CommitmentError('not_found');
  const suggested = v.intervention && v.intervention.action ? v.intervention.action.id : null;
  const next = C.recordAction(slice(state), v.commitment_id, { action_id, note, suggested_action_id: suggested }, now);
  return { ...withC(state, next, { type: 'commit_action_recorded', id: v.commitment_id }), stopView: { ...v, recorded: true } };
}

export const dialogueTurnsLeft = (state) => MAX_USER_TURNS - state.dialogue.messages.filter((m) => m.role === 'user').length;
export { AXES };

export function goBack(state) {
  switch (state.step) {
    case 'current_select': return { ...state, step: 'consent' };
    case 'eti_import': return { ...state, step: 'current_select', importAttempt: null };
    case 'quick': return state.quickIndex > 0 ? { ...state, quickIndex: state.quickIndex - 1 } : { ...state, step: 'current_select' };
    case 'current_review': return { ...state, step: state.current && state.current.source === 'eti_v2' ? 'eti_import' : 'quick', quickIndex: Math.max(0, QUICK_QUESTIONS.length - 1) };
    case 'ideal': return state.idealIndex > 0 ? { ...state, idealIndex: state.idealIndex - 1 } : { ...state, step: 'current_review' };
    case 'draft': return { ...state, step: 'ideal', idealIndex: Math.max(0, idealQueue(state).length - 1) };
    case 'meet': return { ...state, step: 'draft' };
    case 'evaluate': return { ...state, step: 'meet' };
    case 'revise': {
      const r = state.persona.revision;
      const i = revisionIndex(state);
      if (r && i > 0) return { ...state, persona: { ...state.persona, revision: { ...r, index: i - 1 } } };
      return cancelRevision(state); // 最初の質問から戻る＝見直しをやめて、開始前に戻す
    }
    case 'dialogue': case 'locked_view': case 'stop': return { ...state, step: state.persona.locked ? 'home' : 'records' };
    case 'records': return { ...state, step: state.persona.locked ? 'home' : (state.current ? 'current_review' : 'current_select') };
    case 'commit_new': return commitDiscard(state);
    case 'commit_check': return { ...state, step: 'commit_new', commitments: { ...slice(state), draft: { ...slice(state).draft, step: 'facts' } } };
    case 'commit_view': case 'reflect': return { ...state, step: 'records' };
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
    if (a.target === 'persona_lifecycle' && a.action === 'delete') {
      // 消す版を参照している操作の記録（下書き・評価・承認・見直し）も残さない
      const gone = new Set([...(s.persona.versions || []).map((v) => v.persona_version), s.persona.locked && s.persona.locked.persona_version].filter(Boolean));
      const log = s.log.filter((e) => ![...gone].some((pv) => JSON.stringify(e).includes(pv)));
      s = { ...s, persona: emptyPersona(), dialogue: { persona_version: null, messages: [] }, log };
    }
  }
  // 消した人格の版で作った「止めて」の介入も残さない（本人が入力した約束はそのまま残す）
  s = dropStaleIntervention(s);
  return withLog(s, { type: 'revoke', purpose, actions: actions.map((a) => `${a.target}:${a.action}`) });
}

export const canPersist = (state) => isGranted(state.consents, 'memory');

// 「止めて」の介入のうち、いまの承認済みの版で作られていないもの（撤回・置き換えで消えた版）を取り除く。
// アプリとして伝えた介入（persona_version: null）は人格に由来しないので残す
export function dropStaleIntervention(state) {
  const iv = state.stopView && state.stopView.intervention;
  if (!iv || !iv.persona_version) return state;
  const lock = state.persona && state.persona.locked;
  if (lock && lock.persona_version === iv.persona_version) return state;
  return withLog({ ...state, stopView: { halted: false, intervention: null, commitment_id: state.stopView.commitment_id }, step: state.step === 'stop' ? (lock ? 'home' : 'records') : state.step },
    { type: 'stale_intervention_dropped' }); // 消えた版の識別子は記録に残さない
}

// 端末保存から戻す。承認した人格は検証し直し（改変されていれば使わない）、古い版の介入は取り除く
export function restoreSaved(saved, subjectId) {
  const base = initialState(subjectId);
  if (!(saved && saved.consents && saved.consents.memory && saved.consents.memory.status === 'granted')) return base;
  const persona = { ...base.persona, ...(saved.persona || {}) };
  persona.locked = restoreLock(persona.locked);
  const st = { ...base, ...saved, persona, dialogue: saved.dialogue || base.dialogue, commitments: saved.commitments || base.commitments };
  // 承認済みの版と違う版の会話の記録は使わない（介入の文も含む）
  if (!persona.locked || st.dialogue.persona_version !== persona.locked.persona_version) st.dialogue = { persona_version: null, messages: [] };
  if (!persona.locked && ['home', 'dialogue', 'locked_view'].includes(st.step)) st.step = st.profile ? 'meet' : 'consent';
  return dropStaleIntervention(st);
}

export { BASE_QUESTION_COUNT, MAX_QUESTIONS };
