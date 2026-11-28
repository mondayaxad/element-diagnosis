// Phase 3：「止めて」からの介入（純粋関数・読み取りだけ）。
// 最初に有効な約束を示し、承認済みの「5年後の自分」が、本人の決めた理由を踏まえて、その場でできる行動を一つだけ伝える。
// このアプリは外部の購入を止められない。止めたとは言わず、閉じるのは本人の手であることを伝える。
import { verifyLock } from './persona.js';

export const INTERVENTION_VERSION = 'ISA-STOP-0.1.0';
export const NOT_STOPPED_NOTICE = 'このアプリは、ほかのアプリやお店での購入を止めることはできません。画面を閉じるのは、あなたの手です。';

// その場でできる行動（一つだけ選ぶ）。どれも最初に購入画面を閉じる
const ACTIONS = {
  organize: { id: 'close_and_think', text: 'いま開いている購入画面を閉じて、5分だけ一人で考える時間をとろう' },
  receive: { id: 'close_and_breathe', text: 'いま開いている購入画面を閉じて、ゆっくり深呼吸を3回しよう' },
  explain: { id: 'close_and_read_reason', text: 'いま開いている購入画面を閉じて、決めた理由を声に出して読もう' },
  move: { id: 'close_and_stand', text: 'いま開いている購入画面を閉じて、立ち上がって水を一杯飲みに行こう' },
  default: { id: 'close_screen', text: 'いま開いている購入画面を閉じよう' },
};

export function chooseAction(lock) {
  if (!lock) return ACTIONS.default;
  const p = lock.profile;
  const pressure = p.expression_profile.under_pressure.id;
  if (ACTIONS[pressure]) return ACTIONS[pressure];
  const keep = p.protected_traits.map((t) => t.trait);
  if (keep.includes('inner_focus') || keep.includes('deliberation')) return ACTIONS.organize;
  return ACTIONS.default;
}

const yen = (n) => `${n.toLocaleString('ja-JP')} 円`;
const day = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// lock：承認済みの固定内容（無ければアプリとして話す）。commitment：有効な約束（無ければ null）
export function buildIntervention(lock, commitment) {
  const persona = lock && verifyLock(lock) ? lock : null;
  const action = chooseAction(persona);
  const speaker = persona ? 'future_self' : 'app';
  const basis = [{ element: 'action', id: action.id }];
  let text;
  if (commitment) {
    basis.unshift({ element: 'commitment', id: commitment.id, version: commitment.version }, { element: 'commitment_reason', id: commitment.reason_id });
    const head = persona ? '止めに来たよ。' : '';
    text = `${head}${commitment.target}を狙っているんだね。あなたは「${commitment.reason}」と決めて、${day(commitment.deadline_at)}まで上限 ${yen(commitment.cap_yen)} と約束した。いまできることを一つだけ。${action.text}。`;
  } else {
    text = `${persona ? '止めに来たよ。' : ''}いま有効な約束はないけれど、迷っているなら、いまできることを一つだけ。${action.text}。`;
  }
  if (persona) basis.push({ element: 'lock', id: persona.persona_version });
  return {
    kind: 'stop_intervention', speaker, text, action, basis, notice: NOT_STOPPED_NOTICE,
    commitment_id: commitment ? commitment.id : null, persona_version: persona ? persona.persona_version : null,
  };
}
