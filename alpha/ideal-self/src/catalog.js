// Ideal Self Agent α — 特性・能力・魅力・価値観の語彙（ルール版 ISA-RULE-0.1.0 と対）
// ここにある閾値と対応づけは「設計上の仮説」であり、心理測定として検証済みのものではない。

export const RULE_VERSION = 'ISA-RULE-0.1.0';
export const CATALOG_VERSION = 'ISA-CATALOG-0.1.0';

// CORE：現在の特性候補（中立・肯定的な言い方にし、どちらの極も欠点として扱わない）
export const TRAITS = {
  inner_focus:           { label: '一人で深く考える力', short: '内省' },
  sociability:           { label: '人と関わって元気になる性質', short: '交流' },
  curiosity:             { label: '新しい考えに惹かれる知的好奇心', short: '好奇心' },
  depth_mastery:         { label: '慣れた分野を深く掘り下げる集中力', short: '深化' },
  diligence:             { label: '順序立てて着実に進める誠実さ', short: '着実さ' },
  empathy:               { label: '相手の立場をまず理解しようとする姿勢', short: '理解' },
  sensitivity:           { label: '物事を丁寧に考え続ける感受性', short: '感受性' },
  steadiness:            { label: '動じにくい落ち着き', short: '落ち着き' },
  deliberation:          { label: '動く前に状況を整理する慎重さ', short: '整理' },
  initiative:            { label: '自分から方針を出す行動力', short: '発案' },
  attunement:            { label: '相手に合わせて進め方を調整する柔軟さ', short: '調整' },
  supportive_commitment: { label: '目立たなくても役割を支え続ける責任感', short: '支える力' },
  self_direction_style:  { label: '最終的には自分で選ぶ主体性', short: '主体性' },
  self_expression:       { label: '自分の考えを先に言葉にする率直さ', short: '率直さ' },
};

// 同じ人の中で同時に「はっきり強い」とは記録しない組（観測と自己申告の食い違い検出に使う）
export const OPPOSING_TRAITS = [
  ['inner_focus', 'sociability'],
  ['steadiness', 'sensitivity'],
  ['curiosity', 'depth_mastery'],
];

// ETI v2 の尺度（display 0–100）から特性候補を出す規則。中間帯は「目立った傾向なし」として何も出さない。
export const ETI_TRAIT_RULES = [
  { domain: 'personality', axis: 'O',   op: '>=', threshold: 65, trait: 'curiosity' },
  { domain: 'personality', axis: 'C',   op: '>=', threshold: 65, trait: 'diligence' },
  { domain: 'personality', axis: 'E',   op: '<=', threshold: 35, trait: 'inner_focus' },
  { domain: 'personality', axis: 'E',   op: '>=', threshold: 65, trait: 'sociability' },
  { domain: 'personality', axis: 'A',   op: '>=', threshold: 65, trait: 'empathy' },
  { domain: 'personality', axis: 'N',   op: '>=', threshold: 65, trait: 'sensitivity' },
  { domain: 'personality', axis: 'N',   op: '<=', threshold: 35, trait: 'steadiness' },
  { domain: 'style',       axis: 'AGY', op: '>=', threshold: 65, trait: 'initiative' },
  { domain: 'style',       axis: 'REL', op: '>=', threshold: 65, trait: 'attunement' },
  { domain: 'style',       axis: 'ROL', op: '>=', threshold: 65, trait: 'supportive_commitment' },
  { domain: 'style',       axis: 'REF', op: '>=', threshold: 65, trait: 'deliberation' },
  { domain: 'style',       axis: 'AUT', op: '>=', threshold: 65, trait: 'self_direction_style' },
];
// VALUES は中心化値（各軸平均 − 全軸平均）。この値を超える上位3軸までを価値観候補にする
export const VALUE_CENTERED_MIN = 0.25;
export const VALUE_TOP_N = 3;

export const AXIS_LABELS = {
  O: '開放性', C: '誠実性', E: '外向性', A: '協調性', N: '神経症傾向（情緒の揺れやすさ）',
  AGY: '主導', REL: '関係調整', ROL: '役割遂行', REF: '熟考', AUT: '自律',
};

export const VALUES = {
  SD: { label: '自分の生き方を自分で選べること', short: '自己決定' },
  ST: { label: '新しい経験や変化', short: '刺激' },
  HE: { label: '楽しさや心地よさを味わうこと', short: '享受' },
  AC: { label: '能力を発揮し成果を形にすること', short: '達成' },
  PO: { label: '大事な決定に影響を与えられること', short: '影響力' },
  SE: { label: '安心できる安定した環境', short: '安定' },
  CO: { label: '周囲に迷惑をかけないよう自分を律すること', short: '節度' },
  TR: { label: '受け継がれてきた習慣や文化の尊重', short: '伝統' },
  BE: { label: '身近な人が幸せに暮らせること', short: '身近な人の幸せ' },
  UN: { label: '立場にかかわらず人が公平に扱われること', short: '公平' },
};

// GROWTH：発達させたい能力。behaviors は保護特性ごとの「性格を反転させない」具体的な振る舞い。
// default は該当する保護特性が無いときの振る舞い。
export const CAPABILITIES = {
  clear_expression: {
    label: '必要な場面で自分の意思をはっきり伝える力',
    behaviors: {
      inner_focus: '考えを一人でまとめてから、要点を短く言葉にして伝える',
      empathy: '相手の立場を受け止めたうえで、自分の結論も省かずに伝える',
      attunement: '相手に合わせる前に、自分の希望を一度はっきり言う',
      default: '大事な場面では、結論と理由を先に伝える',
    },
  },
  composure_under_pressure: {
    label: '周囲に流されず判断を保つ力',
    behaviors: {
      deliberation: '急かされても、判断の前に整理する時間を短くても確保する',
      sensitivity: '揺れを感じたら、それを判断材料の一つとして書き出してから決める',
      empathy: '相手の気持ちは受け止めつつ、判断の基準は自分の価値観に置く',
      default: '周りの評価ではなく、事前に決めた基準で判断する',
    },
  },
  mobilizing: {
    label: '人を巻き込んで物事を動かす力',
    behaviors: {
      inner_focus: '大勢を引っぱるのではなく、考え抜いた方針を少人数に示して協力を得る',
      supportive_commitment: '支える役割を保ちながら、必要な人に具体的に頼む',
      default: '目的を共有し、役割を分けて進める',
    },
  },
  follow_through: {
    label: '決めたことを続ける力',
    behaviors: {
      curiosity: '新しい関心は記録して残し、今の取り組みを区切りまで終えてから移る',
      sensitivity: '続けられなかった日も責めすぎず、翌日に小さく再開する',
      default: '小さな単位に分けて、区切りごとに確かめる',
    },
  },
  emotional_regulation: {
    label: '気持ちが揺れても立て直す力',
    behaviors: {
      sensitivity: '感じやすさは保ったまま、立て直すための手順を決めておく',
      inner_focus: '一人で考える時間を、反すうではなく整理の時間として使う',
      default: '揺れに気づいたら、間を置いてから次の行動を選ぶ',
    },
  },
  social_ease: {
    label: '初めての相手とも落ち着いて関われる力',
    behaviors: {
      inner_focus: '社交的に振る舞うのではなく、関わる場面を選び、短い対話を落ち着いて行う',
      default: '相手への関心を一つ持って話しかける',
    },
  },
};

// ASPIRATION：本人が魅力を感じる人物像の方向性（能力ではない）
export const ASPIRATIONS = {
  quiet_presence:        { label: '静かな存在感', compatible: ['inner_focus', 'deliberation', 'steadiness', 'depth_mastery'] },
  warmth_capacity:       { label: '包容力', compatible: ['empathy', 'attunement', 'supportive_commitment'] },
  intellectual_calm:     { label: '知的な落ち着き', compatible: ['curiosity', 'inner_focus', 'deliberation', 'steadiness'] },
  unwavering_conviction: { label: '揺るがない信念', compatible: ['self_direction_style', 'diligence', 'inner_focus'] },
  radiance:              { label: '場を明るくする力', compatible: ['sociability', 'self_expression', 'initiative'] },
  dependable_drive:      { label: '頼れる実行力', compatible: ['diligence', 'initiative', 'supportive_commitment'] },
};

// 成長・憧れが、保護特性を「反転」させるおそれのある組。該当すると追加質問で本人に確かめる。
export const INVERSION_RISKS = {
  social_ease: ['inner_focus'],
  radiance: ['inner_focus', 'deliberation'],
  mobilizing: [],
};

export const UNKNOWN = 'unknown';
