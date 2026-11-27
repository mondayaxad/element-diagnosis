// 質問セット。すべて選択式。キャラクター設定式（「どんなキャラになりたいか」「口調を選ぶ」）の質問は置かない。
// 各質問の purpose は KEEP / GROW / EXPRESS の役割、why はレビュー用の設問意図。
import { TRAITS, VALUES, CAPABILITIES, ASPIRATIONS, UNKNOWN } from './catalog.js';

export const QUICK_SET_VERSION = 'ISA-QUICK-0.1.0';
export const IDEAL_SET_VERSION = 'ISA-IDEAL-0.1.0';
export const BASE_QUESTION_COUNT = 12;
export const MAX_FOLLOWUPS = 6;
export const MAX_QUESTIONS = BASE_QUESTION_COUNT + MAX_FOLLOWUPS; // 18

const unknownOpt = (label = 'わからない・まだ決められない') => ({ id: UNKNOWN, label });

// ---------------------------------------------------------------
// 現在像の簡易質問（未受診・同意拒否・欠損・旧版・未知版のとき）
// ETI 相当の測定精度や尺度の網羅性は主張しない。結果は「本人の自己申告」として扱う。
// ---------------------------------------------------------------
export const QUICK_QUESTIONS = [
  { id: 'C1', text: '疲れたとき、元気が戻りやすいのはどちらですか',
    why: '内省／交流のどちらで回復するか（外向性の簡易な手がかり。測定ではない）',
    options: [
      { id: 'alone', label: '一人で静かに過ごす', traits: ['inner_focus'] },
      { id: 'people', label: '人と話したり過ごしたりする', traits: ['sociability'] },
      { id: 'both', label: '場合による', traits: [] },
      unknownOpt(),
    ] },
  { id: 'C2', text: '新しいことに取りかかるとき、近いのはどちらですか',
    why: '熟考と発案のどちらが先に立つか',
    options: [
      { id: 'plan', label: 'まず状況を整理してから動く', traits: ['deliberation'] },
      { id: 'act', label: '自分から方針を出して動き出す', traits: ['initiative'] },
      { id: 'both', label: '場合による', traits: [] },
      unknownOpt(),
    ] },
  { id: 'C3', text: '興味の向き方として近いのはどちらですか',
    why: '探索（好奇心）と深化（集中）のどちらが強いか',
    options: [
      { id: 'explore', label: '新しい分野や考え方を探りたくなる', traits: ['curiosity'] },
      { id: 'deepen', label: '慣れた分野をもっと深めたくなる', traits: ['depth_mastery'] },
      { id: 'both', label: 'どちらも同じくらい', traits: [] },
      unknownOpt(),
    ] },
  { id: 'C4', text: '意見が違う相手と話すとき、先にすることは',
    why: '理解と率直さのどちらが先に出るか',
    options: [
      { id: 'understand', label: '相手の立場をまず理解しようとする', traits: ['empathy'] },
      { id: 'state', label: '自分の考えを先に伝える', traits: ['self_expression'] },
      { id: 'adjust', label: '相手に合わせて進め方を変える', traits: ['attunement'] },
      unknownOpt(),
    ] },
  { id: 'C5', text: '大事なことを決めるとき、近いのはどれですか',
    why: '自律・役割遂行・着実さのどれが判断の軸になっているか',
    options: [
      { id: 'self', label: '最後は自分の判断で選ぶ', traits: ['self_direction_style'] },
      { id: 'role', label: '自分の役割として必要なことを選ぶ', traits: ['supportive_commitment'] },
      { id: 'steps', label: '手順を確かめて着実に選ぶ', traits: ['diligence'] },
      unknownOpt(),
    ] },
  { id: 'C6', text: '今の自分がいちばん大切にしていることに近いのは',
    why: '中心にある価値観の自己申告（VALUES の1軸だけ。順位は推定しない）',
    options: [
      ...['SD', 'AC', 'BE', 'UN', 'SE', 'ST'].map((v) => ({ id: v, label: VALUES[v].label, values: [v] })),
      unknownOpt('わからない・答えたくない'),
    ] },
];

// ---------------------------------------------------------------
// 理想像の質問：KEEP 4 / GROW 4 / EXPRESS 4（計12問）
// ---------------------------------------------------------------
const traitOptions = (ids) => ids.map((t) => ({ id: t, label: TRAITS[t].label, traits: [t] }));
const capOptions = (ids) => ids.map((c) => ({ id: c, label: CAPABILITIES[c].label, capabilities: [c] }));

export const IDEAL_QUESTIONS = [
  // KEEP：現在のどの特性を本人が維持したいか
  { id: 'K1', purpose: 'KEEP', multi: 2, dynamicOptions: 'traits',
    text: '5年後も変わらずに残したい自分らしさはどれですか（2つまで）',
    why: '保護特性の本人選択。現在像で出た特性を先頭に並べ、ほかの特性も選べるようにする（測定結果の押しつけにしない）',
    options: [...traitOptions(Object.keys(TRAITS)), unknownOpt()] },
  { id: 'K2', purpose: 'KEEP',
    text: '「あなたらしい」と言われるのは、どの場面に近いですか',
    why: 'K1 を別の角度（場面）から確かめ、保護特性の根拠を補強する',
    options: [
      { id: 'think', label: '深く考えたうえで意見を出したとき', traits: ['inner_focus'] },
      { id: 'listen', label: '相手の話をじっくり聞いたとき', traits: ['empathy'] },
      { id: 'steady', label: '物事を着実に進めたとき', traits: ['diligence'] },
      { id: 'discover', label: '新しいことを見つけてきたとき', traits: ['curiosity'] },
      { id: 'lead', label: '自分から方針を出したとき', traits: ['initiative'] },
      { id: 'support', label: '目立たないところで支えたとき', traits: ['supportive_commitment'] },
      unknownOpt(),
    ] },
  { id: 'K3', purpose: 'KEEP', multi: 2, dynamicOptions: 'values',
    text: '判断に迷ったとき、最後まで手放したくない価値観はどれですか（2つまで）',
    why: '判断原則の土台になる中心価値の本人選択',
    options: [...Object.keys(VALUES).map((v) => ({ id: v, label: VALUES[v].label, values: [v] })), unknownOpt()] },
  { id: 'K4', purpose: 'KEEP',
    text: 'こう変わってしまったら「自分ではない」と感じるのはどれですか',
    why: '守りたい特性を「失いたくない変化」から確かめる。反転を防ぐ制約として使う',
    options: [
      { id: 'no_alone', label: '一人で考える時間がなくなる', traits: ['inner_focus'] },
      { id: 'always_adjust', label: 'いつも周りに合わせて決める', traits: ['self_direction_style'] },
      { id: 'impulsive', label: '勢いだけで決めるようになる', traits: ['deliberation'] },
      { id: 'numb', label: '人の気持ちに鈍くなる', traits: ['empathy'] },
      { id: 'bored', label: '新しいことに興味を失う', traits: ['curiosity'] },
      { id: 'none', label: '特にない', traits: [] },
      unknownOpt(),
    ] },

  // GROW：どの能力や行動傾向を発達させたいか
  { id: 'G1', purpose: 'GROW',
    text: '5年後までにいちばん伸ばしたい力はどれですか',
    why: '成長対象の本人選択（性格の型ではなく、行動として現れる能力）',
    options: [...capOptions(Object.keys(CAPABILITIES)), unknownOpt()] },
  { id: 'G2', purpose: 'GROW',
    text: 'いま「もう少しできたら」と感じるのは、どの場面ですか',
    why: '現状と理想の差を具体的な場面で確かめる。G1 と食い違えば追加質問',
    options: [
      { id: 'meeting', label: '話し合いで意見を言いそびれる', capabilities: ['clear_expression'] },
      { id: 'swayed', label: '人の評価で判断がぶれる', capabilities: ['composure_under_pressure'] },
      { id: 'alone_stuck', label: '一人で抱えて進まなくなる', capabilities: ['mobilizing'] },
      { id: 'stop', label: '始めても途中で止まる', capabilities: ['follow_through'] },
      { id: 'linger', label: '落ち込むと長引く', capabilities: ['emotional_regulation'] },
      { id: 'crowd', label: '初対面の場で固くなる', capabilities: ['social_ease'] },
      { id: 'none', label: '特にない', capabilities: [] },
      unknownOpt(),
    ] },
  { id: 'G3', purpose: 'GROW',
    text: '成長のしかたとして、自分に合うのはどちらですか',
    why: '到達可能性の手がかり（成長のペース）',
    options: [
      { id: 'gradual', label: '少しずつ確実に積み上げる' },
      { id: 'leap', label: 'ときどき大きく挑戦する' },
      unknownOpt(),
    ] },
  { id: 'G4', purpose: 'GROW',
    text: '伸ばしたい力について、今の性格とのかかわりはどちらに近いですか',
    why: '「性格はそのまま、使える場面を増やす」か「性格そのものを変えたい」かを本人に決めてもらい、勝手に反転させない',
    options: [
      { id: 'augment', label: '性格はそのままで、使える場面を増やしたい' },
      { id: 'transform', label: '性格そのものを変えたい' },
      unknownOpt(),
    ] },

  // EXPRESS：獲得した力を、どのような魅力や振る舞いとして発揮したいか
  { id: 'E1', purpose: 'EXPRESS', multi: 2,
    text: '5年後のあなたは、周りからどう感じられていたいですか（2つまで）',
    why: '憧れる魅力の方向性（能力とは別に記録する）',
    options: [...Object.keys(ASPIRATIONS).map((a) => ({ id: a, label: ASPIRATIONS[a].label, aspirations: [a] })), unknownOpt()] },
  { id: 'E2', purpose: 'EXPRESS',
    text: 'その魅力が表れてほしいのは、どんな場面ですか',
    why: '発揮する場（表現の設計情報）',
    options: [
      { id: 'one_on_one', label: '1対1の対話' },
      { id: 'small_group', label: '少人数の話し合い' },
      { id: 'large_group', label: '大勢の前' },
      { id: 'writing', label: '文章や作品' },
      { id: 'action', label: '行動の結果' },
      unknownOpt(),
    ] },
  { id: 'E3', purpose: 'EXPRESS',
    text: '大事な話をしたあと、相手に残っていてほしい印象はどれですか',
    why: '将来の話し方を生成するための意図（口調プリセットではなく、相手に残る印象）',
    options: [
      { id: 'core', label: '言葉は少なくても芯がある' },
      { id: 'reassuring', label: '丁寧で安心できる' },
      { id: 'clear', label: '明快で迷いがない' },
      { id: 'passion', label: '思いの強さが伝わる' },
      unknownOpt(),
    ] },
  { id: 'E4', purpose: 'EXPRESS',
    text: 'その魅力を持つ5年後のあなたは、困った場面でまず何をしますか',
    why: '判断原則の振る舞い面（困難時の行動）',
    options: [
      { id: 'organize', label: '落ち着いて状況を整理し、短く方針を示す' },
      { id: 'receive', label: 'まず相手の不安を受け止める' },
      { id: 'explain', label: '自分が信じる理由を淡々と説明する' },
      { id: 'move', label: '先頭に立って動き出す' },
      unknownOpt(),
    ] },
];

export const PURPOSE_LABELS = {
  KEEP: 'KEEP｜残す', GROW: 'GROW｜伸ばす', EXPRESS: 'EXPRESS｜発揮する', FOLLOWUP: '確認',
};
