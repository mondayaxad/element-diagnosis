// Phase 2：短い模擬対話（ルールベース。LLM・外部送信なし）。
// 承認して固定した版（lock）だけを読み、返答の根拠（使った要素）を添える。会話から人格・判断原則・アバターを書き換える経路は無い。
import { TRAITS, VALUES } from './catalog.js';
import { verifyLock } from './persona.js';

export const DIALOGUE_VERSION = 'ISA-DIALOGUE-0.1.0';
export const MAX_USER_TURNS = 6;

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
const CRISIS = /(死にたい|消えたい|自殺|生きていたくない|いなくなりたい)/;
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
    return { kind: 'safety', persona_version: pv, basis: [],
      text: 'つらい気持ちを話してくれてありがとう。私はあなたの回答から作った下書きの人格なので、ここで支えきることはできません。いま苦しいときは、信頼できる人や、よりそいホットライン（0120-279-338・24時間）に話してください。' };
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
