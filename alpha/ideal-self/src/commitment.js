// Phase 3：模擬約束（純粋関数）。金額は本人の模擬入力だけ。自動見積もり・実際の支払い・外部の購入の停止は扱わない。
// 時刻は呼び出し側から now（ミリ秒）で渡す（期限・二重操作をテストで再現できるように）。
//
// 約束の決まり
//   ・作る：狙う対象・手持ちの石・追加で必要と見積もった金額・理由を整理 → 「出せるか」「出す価値があるか」を確認 → 事前の予算と期限を確定
//     約束は「事前に決めた予算は X 円。足りなくても、期限まで追加で課金しない」（cap_yen＝事前に決めた予算）
//   ・期限まで：予算の引下げだけ受け付ける。引上げ・解除は不可。有効な約束がある間は、新しい約束も作れない（作り直しで上げられないように）
//   ・期限を過ぎると自動で終わる（status: ended）。終わった約束も変更できない（振り返りだけ記録できる）
//   ・更新は版（version）付き。古い版からの操作（二重送信・別の画面からの操作）は拒否する
//   ・削除は「データの削除」。約束中でもできる（解除ではなく、記録そのものを消す）

import { ruleText } from './commitment_text.js';

export const COMMITMENT_VERSION = 'ISA-COMMIT-0.2.0'; // 0.2.0：「事前に決めた予算」と「期限まで追加で課金しない」を分けた文言
export const DAY = 24 * 60 * 60 * 1000;
export const DEADLINE_DAYS = [3, 7, 14, 30];
export const MAX_YEN = 10_000_000;
export const MAX_STONES = 10_000_000;

export const REASONS = [
  { id: 'living', label: '生活費を守りたい' },
  { id: 'saving', label: '貯めたいお金がある' },
  { id: 'regret', label: '後で後悔したくない' },
  { id: 'other_use', label: 'ほかに使いたいことがある' },
  { id: 'own', label: '自分の言葉で書く' },
];
export const CHECK_ANSWERS = { yes: 'はい', no: 'いいえ', unsure: 'わからない' };
export const OUTCOMES = { kept: '守れた', partial: '一部守れた', not_kept: '守れなかった', unknown: '不明' };
export const HELPED = [
  { id: 'saw_commitment', label: '約束を画面で見た' },
  { id: 'future_self', label: '5年後の自分の言葉' },
  { id: 'closed_screen', label: '購入画面を閉じた' },
  { id: 'waited', label: '時間を置いた' },
  { id: 'remembered_reason', label: '自分で決めた理由を思い出した' },
  { id: 'talked', label: '誰かに話した' },
  { id: 'nothing', label: '特になし' },
];

// 拒否の理由（画面に出す文）。個別の文を渡さなかったときに使う
export const MESSAGES = {
  active_exists: '有効な約束があるあいだは、新しい約束を作れません',
  no_draft: '確定する下書きがありません（二重の確定は受け付けません）',
  facts_required: '先に状況を整理してください',
  check_required: '「出せるか」「出す価値があるか」の両方に答えてください',
  invalid_cap: '予算は0以上の整数（円）で入力してください',
  invalid_deadline: '期限を選んでください',
  not_found: '約束が見つかりません',
  stale_version: '画面の内容が古くなっています。もう一度開き直してください（二重の操作は受け付けません）',
  ended: '期限を過ぎた約束は変更できません',
  not_lower: '期限までは、予算を下げることだけができます',
  raise_forbidden: '期限までは予算を上げられません（足りなくても追加で課金しない約束です）',
  cancel_forbidden: '期限までは約束を解除できません（データの削除はできます）',
  not_ended: '振り返りは期限の後に記録できます',
  invalid_outcome: '結果を選んでください',
  invalid_helped: '助けになったことの選び方を確かめてください',
};
export class CommitmentError extends Error {
  constructor(code, message) { super(message || MESSAGES[code] || code); this.code = code; }
}
const fail = (code, msg) => { throw new CommitmentError(code, msg); };

const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const cleanText = (t, max) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function initialCommitments() {
  return { seq: 0, draft: null, items: [] };
}

// 状態：期限前は active、期限を過ぎたら ended（自動）
export const statusAt = (c, now) => (now < c.deadline_at ? 'active' : 'ended');
export const activeCommitment = (slice, now) => slice.items.find((c) => statusAt(c, now) === 'active') || null;

// ---------------------------------------------------------------- 作る（1）整理
export function startDraft(slice, now) {
  if (activeCommitment(slice, now)) fail('active_exists', '有効な約束があるあいだは、新しい約束を作れません');
  return { ...slice, draft: { step: 'facts' } };
}

export function setFacts(slice, facts, now) {
  if (!slice.draft) fail('no_draft');
  if (activeCommitment(slice, now)) fail('active_exists');
  const target = cleanText(facts.target, 40);
  if (!target) fail('invalid_target', '狙う対象を入力してください');
  if (!isInt(facts.stones_have, 0, MAX_STONES)) fail('invalid_stones_have', '手持ちの石は0以上の整数で入力してください');
  if (!isInt(facts.stones_needed, 0, MAX_STONES)) fail('invalid_stones_needed', '必要な石は0以上の整数で入力してください');
  if (!isInt(facts.estimate_yen, 0, MAX_YEN)) fail('invalid_estimate', '見積もった金額は0以上の整数（円）で入力してください');
  const reason = REASONS.find((r) => r.id === facts.reason_id);
  if (!reason) fail('invalid_reason', '理由を選んでください');
  const reasonText = reason.id === 'own' ? cleanText(facts.reason_text, 80) : reason.label;
  if (!reasonText) fail('invalid_reason', '理由を書いてください');
  return {
    ...slice,
    draft: {
      step: 'check',
      target, stones_have: facts.stones_have, stones_needed: facts.stones_needed,
      stones_short: Math.max(0, facts.stones_needed - facts.stones_have),
      estimate_yen: facts.estimate_yen, estimate_source: 'self_mock_input',
      reason_id: reason.id, reason: reasonText,
    },
  };
}

// ---------------------------------------------------------------- 作る（2）確認 → 事前の予算と期限を確定
// 「その金額を出せるか」「出す価値があるか」の両方に答えるまで確定できない。
// 「いいえ」「わからない」のときは予算 0 円を勧める（決めるのは本人）。
export function suggestedCap(draft, check) {
  if (!check || check.can_afford !== 'yes' || check.worth_it !== 'yes') return 0;
  return draft.estimate_yen;
}

export function confirmDraft(slice, { can_afford, worth_it, cap_yen, deadline_days }, now) {
  const d = slice.draft;
  if (!d) fail('no_draft', '確定する下書きがありません（二重の確定は受け付けません）');
  if (d.step !== 'check') fail('facts_required');
  if (activeCommitment(slice, now)) fail('active_exists');
  if (!(can_afford in CHECK_ANSWERS) || !(worth_it in CHECK_ANSWERS)) fail('check_required', '「出せるか」「出す価値があるか」の両方に答えてください');
  if (!isInt(cap_yen, 0, MAX_YEN)) fail('invalid_cap');
  if (!DEADLINE_DAYS.includes(deadline_days)) fail('invalid_deadline', '期限を選んでください');
  const seq = slice.seq + 1;
  const c = {
    id: `c${seq}`, schema: COMMITMENT_VERSION, version: 1,
    target: d.target, stones_have: d.stones_have, stones_needed: d.stones_needed, stones_short: d.stones_short,
    estimate_yen: d.estimate_yen, estimate_source: d.estimate_source,
    reason_id: d.reason_id, reason: d.reason,
    check: { can_afford, worth_it, suggested_cap_yen: suggestedCap(d, { can_afford, worth_it }) },
    cap_yen, deadline_days, created_at: now, deadline_at: now + deadline_days * DAY,
    rule: ruleText(cap_yen),
    history: [{ type: 'created', at: now, cap_yen }],
    reflection: null,
  };
  return { ...slice, seq, draft: null, items: [...slice.items, c] };
}

export const discardDraft = (slice) => ({ ...slice, draft: null });

// ---------------------------------------------------------------- 守る
function findFor(slice, id, now, expectedVersion) {
  const c = slice.items.find((x) => x.id === id);
  if (!c) fail('not_found', '約束が見つかりません');
  if (expectedVersion !== c.version) fail('stale_version', '画面の内容が古くなっています。もう一度開き直してください（二重の操作は受け付けません）');
  if (statusAt(c, now) !== 'active') fail('ended', '期限を過ぎた約束は変更できません');
  return c;
}
const replace = (slice, c) => ({ ...slice, items: slice.items.map((x) => (x.id === c.id ? c : x)) });

// 予算の引下げだけ受け付ける
export function lowerCap(slice, id, newCap, expectedVersion, now) {
  const c = findFor(slice, id, now, expectedVersion);
  if (!isInt(newCap, 0, MAX_YEN)) fail('invalid_cap');
  if (newCap >= c.cap_yen) fail('not_lower');
  const next = {
    ...c, version: c.version + 1, cap_yen: newCap,
    rule: ruleText(newCap),
    history: [...c.history, { type: 'lowered', at: now, from: c.cap_yen, to: newCap }],
  };
  return replace(slice, next);
}

// 引上げ・解除は期限まで不可（期限後は約束が終わっているので、やはり変更しない）
export function raiseCap(slice, id, _newCap, expectedVersion, now) {
  findFor(slice, id, now, expectedVersion);
  fail('raise_forbidden');
}
export function cancelCommitment(slice, id, expectedVersion, now) {
  findFor(slice, id, now, expectedVersion);
  fail('cancel_forbidden', '期限までは約束を解除できません（データの削除はできます）');
}

// ---------------------------------------------------------------- 振り返る
export function reflect(slice, id, { outcome, helped = [], note = '' }, now) {
  const c = slice.items.find((x) => x.id === id);
  if (!c) fail('not_found');
  if (statusAt(c, now) !== 'ended') fail('not_ended', '振り返りは期限の後に記録できます');
  if (!(outcome in OUTCOMES)) fail('invalid_outcome');
  const h = [...new Set(helped)];
  if (!h.every((x) => HELPED.some((y) => y.id === x))) fail('invalid_helped');
  if (h.includes('nothing') && h.length > 1) fail('invalid_helped', '「特になし」はほかと一緒に選べません');
  const r = { outcome, helped: h, note: cleanText(note, 200), recorded_at: now, self_reported: true };
  return replace(slice, { ...c, reflection: r });
}

// 集計：未記録は失敗に数えない（守れなかった＝本人が「守れなかった」を選んだものだけ）
export function summarize(slice, now) {
  const s = { active: 0, ended: 0, kept: 0, partial: 0, not_kept: 0, unknown: 0, unrecorded: 0 };
  for (const c of slice.items) {
    if (statusAt(c, now) === 'active') { s.active += 1; continue; }
    s.ended += 1;
    if (c.reflection) s[c.reflection.outcome] += 1; else s.unrecorded += 1;
  }
  return s;
}

// ---------------------------------------------------------------- 削除（約束中でも可）
export function deleteCommitment(slice, id) {
  if (!slice.items.some((x) => x.id === id)) fail('not_found');
  return { ...slice, items: slice.items.filter((x) => x.id !== id) };
}
export const deleteAll = (slice) => ({ ...slice, draft: null, items: [] });
