// Phase 2：人格の版・初対面の台詞・3軸評価・見直し・承認と固定（純粋関数）。
// 方針：評価と承認は「表示した版（persona_version）」に紐づける。承認した版は人格・判断原則・アバターごと固定し、
//       内容のハッシュで改変を検出する。会話や後からの回答変更では書き換えない（新しい版を作って改めて承認するだけ）。
import { TRAITS } from './catalog.js';
import { canonical, fnv1a } from './profile.js';

export const PERSONA_LIFECYCLE_VERSION = 'ISA-PERSONA-0.1.0';

// 固定の仮アバター。人格や尺度から外見を作らない（性別・顔立ち・年齢などを推測しない）。
export const AVATAR = Object.freeze({
  id: 'placeholder-night-v1',
  kind: 'fixed_placeholder',
  file: 'assets/avatar-placeholder.svg',
  content_fnv1a: '79eccbf0', // ファイルを変えたらテストが失敗する（承認済みの版の見た目を黙って変えない）
  derived_from_profile: false,
  note: 'Phase 2 α の固定仮アバター。理想化されたオリジナルの象徴で、実在の人物・既存作品を模していない。',
});

// ---------------------------------------------------------------- 初対面の台詞
const CLOSINGS = {
  core: '急がなくていい。少しずつ話そう。',
  reassuring: 'ゆっくりで大丈夫です。よかったら、少し話しませんか。',
  clear: '話したいことがあれば、ひとつずつ整理しよう。',
  passion: 'あなたと話せるのを、ずっと楽しみにしていました。',
  unknown: 'よかったら、少し話しませんか。',
};

export function buildGreeting(profile) {
  const lines = [];
  const basis = [];
  const keep = profile.protected_traits; // 確定した保護特性だけ（候補は台詞に使わない）
  lines.push('はじめまして。5年後のあなたです。');
  if (keep.length) {
    lines.push(`${keep.slice(0, 2).map((t) => t.label).join('と、')}は、いまも私の真ん中にあります。`);
    basis.push(...keep.slice(0, 2).map((t) => ({ element: 'protected_traits', id: t.trait })));
  } else {
    lines.push('あなたが何を残したいのか、まだ一緒に確かめている途中です。');
  }
  const g = profile.growth_targets[0];
  if (g) { lines.push(`この5年で、${g.behavior.text}ようになりました。`); basis.push({ element: 'growth_targets', id: g.capability }); }
  const asp = profile.aspirational_traits;
  if (asp.length) {
    const tail = keep.length ? `それは、${TRAITS[keep[0].trait].short}を手放さなかったからだと思っています。` : '';
    lines.push(`「${asp.map((a) => a.label).join('」「')}」と言ってもらえることも増えました。${tail}`);
    basis.push(...asp.map((a) => ({ element: 'aspirational_traits', id: a.aspiration })));
  }
  const intent = profile.expression_profile.impression_intent.id;
  lines.push(CLOSINGS[intent] || CLOSINGS.unknown);
  basis.push({ element: 'expression_profile', id: `impression_intent:${intent}` });
  return { lines, basis, inference_status: 'system_inferred', status: 'draft', note: 'あなたの回答から組み立てた台詞です。予測ではありません。' };
}

// ---------------------------------------------------------------- 3軸評価と見直しの理由
export const AXES = [
  { id: 'self_continuity', label: '自分らしさ', question: '自分と本質的につながっていると感じますか' },
  { id: 'aspiration', label: '憧れ', question: 'この人物のように成長したいと思えますか' },
  { id: 'attainability', label: '到達可能性', question: '5年後の自分として想像できますか' },
];
export const LOW_RATING_MAX = 2; // 1・2 を「違和感がある」とみなす

// 違和感の理由 → 見直す質問（選択式）と、対応する下書きの要素。該当部分だけを見直す。
export const REVIEW_REASONS = [
  { id: 'SC_KEEP', axis: 'self_continuity', label: '残す自分らしさが、自分と違う', questions: ['K1', 'K4'], candidates: true, elements: ['protected_traits'] },
  { id: 'SC_VALUES', axis: 'self_continuity', label: '大切にしている価値観が違う', questions: ['K3'], elements: ['core_values', 'decision_principles'] },
  { id: 'SC_EXPRESSION', axis: 'self_continuity', label: '話し方や雰囲気が自分らしくない', questions: ['E3', 'E2'], elements: ['expression_profile'] },
  { id: 'AS_CHARM', axis: 'aspiration', label: '憧れる魅力が違う', questions: ['E1'], elements: ['aspirational_traits'] },
  { id: 'AS_GROWTH', axis: 'aspiration', label: '伸ばしたい力が違う', questions: ['G1', 'G2'], elements: ['growth_targets'] },
  { id: 'AT_TOO_MUCH', axis: 'attainability', label: '変わり方が大きすぎて想像できない', questions: ['G4', 'G3'], elements: ['growth_targets'] },
  { id: 'AT_PRESSURE', axis: 'attainability', label: '困ったときの振る舞いが想像できない', questions: ['E4'], elements: ['decision_principles'] },
];

export function validateRatings(ratings) {
  if (!ratings || typeof ratings !== 'object') return false;
  return AXES.every((a) => Number.isInteger(ratings[a.id]) && ratings[a.id] >= 1 && ratings[a.id] <= 5)
    && Object.keys(ratings).every((k) => AXES.some((a) => a.id === k));
}
export const lowAxes = (ratings) => AXES.filter((a) => ratings[a.id] <= LOW_RATING_MAX).map((a) => a.id);
export const reasonsFor = (axisIds) => REVIEW_REASONS.filter((r) => axisIds.includes(r.axis));

// 選んだ理由から、見直す質問を基本12問の順に並べる
export function revisionQuestions(reasonIds, idealOrder) {
  const qs = new Set(reasonIds.flatMap((id) => {
    const r = REVIEW_REASONS.find((x) => x.id === id);
    if (!r) throw new Error(`unknown review reason: ${id}`);
    return r.questions;
  }));
  return idealOrder.filter((q) => qs.has(q));
}

// ---------------------------------------------------------------- 承認と固定
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const lockContent = (l) => ({ persona_version: l.persona_version, profile: l.profile, decision_principles: l.decision_principles, avatar: l.avatar, greeting: l.greeting, approved_with: l.approved_with });

export function createLock(profile, evaluation) {
  const copy = JSON.parse(JSON.stringify({ ...profile, approval_status: 'approved' }));
  const lock = {
    lifecycle_version: PERSONA_LIFECYCLE_VERSION,
    persona_version: profile.persona_version,
    profile: copy,
    decision_principles: copy.decision_principles,
    avatar: { ...AVATAR },
    greeting: buildGreeting(copy),
    approved_with: { evaluation_seq: evaluation.seq, ratings: { ...evaluation.ratings } },
  };
  lock.content_hash = fnv1a(canonical(lockContent(lock)));
  return deepFreeze(lock);
}

export function verifyLock(lock) {
  if (!lock) return false;
  return lock.persona_version === lock.profile.persona_version
    && lock.profile.approval_status === 'approved'
    && lock.avatar.id === AVATAR.id && lock.avatar.content_fnv1a === AVATAR.content_fnv1a
    && fnv1a(canonical(lockContent(lock))) === lock.content_hash;
}

// 端末保存から戻したときは凍結が外れているので、検証してから凍結し直す（改変されていたら使わない）
export function restoreLock(raw) {
  if (!raw) return null;
  return verifyLock(raw) ? deepFreeze(raw) : null;
}
