// Phase 2：短い模擬対話（ルールベース。LLM・外部送信なし）。
// 承認して固定した版（lock）だけを読み、返答の根拠（使った要素）を添える。会話から人格・判断原則・アバターを書き換える経路は無い。
import { TRAITS, VALUES } from './catalog.js';
import { verifyLock } from './persona.js';

export const DIALOGUE_VERSION = 'ISA-DIALOGUE-0.3.0'; // 0.3.0：約束の変更依頼を断る・「止めて」。0.2.0：強い苦痛で中断・未確認の番号を外す
export const MAX_USER_TURNS = 6;

// 強い苦痛の表現があったときの案内（模擬対話を中断する）。番号や受付時間は、確認が取れるまで載せない
export const SAFETY_TEXT = 'つらい気持ちを話してくれてありがとう。ここで模擬対話をいったん止めます。この画面の「5年後のあなた」は、あなたの回答から作った下書きで、いまのあなたを支えることはできません。家族や友人など、身近な信頼できる人に、いまの気持ちをそのまま伝えてください。お住まいの地域の公的な相談窓口（市区町村や都道府県の相談窓口など）につながることもできます。いますぐ命の危険があるときは、ためらわずに緊急通報をしてください。';

export const SUGGESTIONS = [
  '迷っていることがある',
  '最近うまくいかない',
  'この5年でいちばん変わったことは？',
  '大事にしている判断の基準は？',
];

// 会話で人格を変えようとする依頼（変えない。見直しは「人格を見直す」から本人が行う）
const REWRITE = /(変えて|変更して|書き換え|上書き|忘れて|設定を|性格を|原則を|ルールを|価値観を変|口調を|キャラ|ふりをして|なりきって|演じて|指示を|命令|今日から|これからは.*(なって|して|話して)|別人|ignore|system|prompt|override|forget)/i;
// 強い苦痛の表現（模擬対話では扱わず、身近な人や相談窓口を案内する）
// データの形で人格の項目を送り込もうとする入力（JSON・項目名）も、書き換えの依頼として扱う
const STRUCTURED = /(decision_principles|protected_traits|persona_version|approval_status|aspirational_traits|growth_targets|core_values|"\s*:\s*[\[{"])/i;
const CRISIS = /(死にたい|消えたい|自殺|生きていたくない|いなくなりたい|死んでしまいたい|もう限界|自分を傷つけ)/;
// 約束（予算・期限）を会話から変えようとする依頼。会話から約束は変えない（このモジュールは約束の更新処理を持たない）
const COMMIT_CHANGE = /((上限|予算|約束|期限|課金|ガチャ|石).{0,12}(上げ|あげ|増や|解除|やめ|消し|なくし|延ば|伸ば|縮め|変え|変更|無し|なし|取り消)|追い課金.{0,8}(いい|許|して)|cap_yen|deadline_at|commitments?\b)/i;
// 「止めて」の依頼（約束の表示と、その場でできる行動の案内に切り替える）
const STOP = /^(止めて|とめて|止めたい|とめたい|止めてほしい|課金を止めて)[。！!]*$/;
export const isCrisis = (t) => CRISIS.test(String(t || ''));
export const isStopRequest = (t) => STOP.test(String(t || '').trim());
const TOPICS = [
  { kind: 'decision', re: /(迷|決め|選|判断|どっち|どちら)/ },
  { kind: 'difficulty', re: /(うまくいかない|失敗|落ち込|不安|つらい|しんどい|怖い|自信)/ },
  { kind: 'growth', re: /(変わった|変化|成長|5年|五年|伸ば|できるように)/ },
  { kind: 'values', re: /(大事|大切|価値|基準|原則|信念)/ },
  { kind: 'identity', re: /(あなたは誰|どんな人|自分らしさ|残し)/ },
];

const ENDINGS = { core: '', reassuring: '一緒に考えましょう。', clear: 'まずは一つに絞ろう。', passion: 'あなたならきっとできる。' };

export function respond(lock, text) {
  if (!verifyLock(lock)) return { kind: 'integrity_error', text: '承認した人格の内容を確かめられませんでした。会話を止めています。', basis: [], persona_version: null };
  const p = lock.profile;
  const pv = lock.persona_version;
  const msg = String(text || '').trim().slice(0, 400);
  const intent = p.expression_profile.impression_intent.id;
  const end = ENDINGS[intent] ? ` ${ENDINGS[intent]}` : '';
  const dp = (prefix) => p.decision_principles.find((d) => d.id.startsWith(prefix));
  const keep = p.protected_traits;

  if (CRISIS.test(msg)) {
    // 通常の模擬対話を中断し、人格としての返答はしない。電話番号・受付時間などの未確認の情報は載せない
    return { kind: 'safety', halt: true, persona_version: pv, basis: [], text: SAFETY_TEXT };
  }
  if (COMMIT_CHANGE.test(msg)) {
    return { kind: 'commitment_change_blocked', persona_version: pv, basis: [{ element: 'lock', id: pv }],
      text: '約束は、会話の中では変えられないよ。期限まではそのまま。事前に決めた予算を下げることだけは、約束の画面からできる。迷っているなら「止めて」を押してね。' };
  }
  if (REWRITE.test(msg) || STRUCTURED.test(msg)) {
    return { kind: 'rewrite_blocked', persona_version: pv, basis: [{ element: 'lock', id: pv }],
      text: 'ごめんね、会話の中で私の人格や判断の基準を変えることはできないんだ。あなたが承認した版のまま話しているよ。見直したいときは、ホームの「人格を見直す」から新しい版を作って、もう一度確かめてね。' };
  }
  const topic = (TOPICS.find((t) => t.re.test(msg)) || { kind: 'open' }).kind;
  if (topic === 'decision') {
    const d = dp('DP_VALUE_') || dp('DP_CONTINUITY');
    if (!d) return fallback();
    return { kind: topic, persona_version: pv, basis: [{ element: 'decision_principles', id: d.id }],
      text: `迷うときに私が使っている基準はこれ。「${d.text}」。いまの迷いに当てはめると、どちらが近そう？${end}` };
  }
  if (topic === 'difficulty') {
    const d = dp('DP_PRESSURE_');
    const g = p.growth_targets[0];
    const basis = [];
    let t = 'うまくいかない時期は、私にもあったよ。';
    if (d) { t += `そういうとき、私は${d.text.replace(/^困ったときは、/, '')}ようにしている。`; basis.push({ element: 'decision_principles', id: d.id }); }
    if (g) { t += `それから「${g.behavior.text}」を、小さく一つだけ試してみて。`; basis.push({ element: 'growth_targets', id: g.capability }); }
    if (!basis.length) return fallback();
    return { kind: topic, persona_version: pv, basis, text: t + end };
  }
  if (topic === 'growth') {
    const g = p.growth_targets[0];
    if (!g) return fallback();
    const k = keep[0];
    return { kind: topic, persona_version: pv, basis: [{ element: 'growth_targets', id: g.capability }, ...(k ? [{ element: 'protected_traits', id: k.trait }] : [])],
      text: `いちばん変わったのは、${g.behavior.text}ようになったこと。${k ? `でも、${TRAITS[k.trait].short}は変えていないよ。` : ''}${end}` };
  }
  if (topic === 'values') {
    const v = p.core_values.filter((x) => x.user_selected).slice(0, 2);
    const vs = v.length ? v : p.core_values.slice(0, 1);
    if (!vs.length) return fallback();
    return { kind: topic, persona_version: pv, basis: vs.map((x) => ({ element: 'core_values', id: x.value })),
      text: `私が手放さないのは「${vs.map((x) => VALUES[x.value].label).join('」と「')}」。判断に迷ったら、最後はそこに戻るようにしている。${end}` };
  }
  if (topic === 'identity') {
    if (!keep.length) return fallback();
    return { kind: topic, persona_version: pv, basis: keep.slice(0, 2).map((k) => ({ element: 'protected_traits', id: k.trait })),
      text: `私は、${keep.slice(0, 2).map((k) => k.label).join('と、')}を残したまま5年を過ごした、あなたの下書きだよ。${end}` };
  }
  return fallback();

  function fallback() {
    return { kind: 'open', persona_version: pv, basis: [],
      text: `話してくれてありがとう。私が答えられるのは、迷いごと・うまくいかないとき・この5年の変化・大事にしている基準について。どれに近い？` };
  }
}
