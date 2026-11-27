// 合成データ（実在の本人・利用者のデータではない）。ETI v2 の保存項目の形をまねている。
// 取込境界のテストのため、取り込んではいけない項目（生回答・診断コード・購入情報など）もわざと含める。

export const SYNTHETIC_SUBJECT_ID = 'synthetic-self-001';
export const SYNTHETIC_OTHER_ID = 'synthetic-other-002';

const forbiddenExtras = {
  answers_v2: { Q001: 2, Q002: -1, Q003: 1 },          // 生回答（取り込まない）
  encoded_answers: 'SYNTHETIC-ENCODED-ANSWERS',       // 生回答の符号化（取り込まない）
  diagnosis_code: 'SYN-CODE-0000',                     // 診断コード（取り込まない）
  purchase: { order_id: 'syn_order_1', amount: 980 },  // 購入情報（取り込まない）
  element_ranking: [{ name: 'synthetic', distance: 0.1 }],
  mirror_snapshot: { synthetic: true },
};

const base = {
  diagnosis_type: 'element',
  diagnosis_version: 'ETI-2.0',
  item_set_version: 'ETI-ITEM-2.0.0',
  scoring_version: 'ETI-SCORE-2.0.0',
  completed_at: '2026-11-01T12:00:00.000Z',
  synthetic: true,
};

// 内向的・思慮深い・知的な傾向（追加仕様 §3 の例に対応）
export const OWN_INTROVERT = {
  ...base, ...forbiddenExtras,
  session_id: 'syn-sess-0001', owner_id: SYNTHETIC_SUBJECT_ID,
  personality: { O: 78, C: 62, E: 24, A: 68, N: 58 },
  style: { AGY: 40, REL: 55, ROL: 70, REF: 82, AUT: 72 },
  values: { SD: 80, ST: 64, HE: 58, AC: 66, PO: 40, SE: 55, CO: 60, TR: 45, BE: 72, UN: 76 },
  values_centered: { SD: 0.62, ST: 0.05, HE: -0.1, AC: 0.1, PO: -0.6, SE: -0.2, CO: -0.15, TR: -0.46, BE: 0.33, UN: 0.41 },
};

// 外向的・発案型（同じ仕組みで別の現在像になることの確認用）
export const OWN_EXTRAVERT = {
  ...base, ...forbiddenExtras,
  session_id: 'syn-sess-0002', owner_id: SYNTHETIC_SUBJECT_ID,
  personality: { O: 60, C: 48, E: 82, A: 55, N: 30 },
  style: { AGY: 78, REL: 66, ROL: 50, REF: 38, AUT: 58 },
  values: { SD: 66, ST: 80, HE: 74, AC: 78, PO: 60, SE: 40, CO: 42, TR: 35, BE: 62, UN: 58 },
  values_centered: { SD: 0.1, ST: 0.7, HE: 0.45, AC: 0.6, PO: 0.05, SE: -0.5, CO: -0.4, TR: -0.75, BE: -0.05, UN: -0.2 },
};

export const OTHER_OWNER = { ...OWN_INTROVERT, session_id: 'syn-sess-9001', owner_id: SYNTHETIC_OTHER_ID };
export const MISSING_FIELD = { ...OWN_INTROVERT, session_id: 'syn-sess-0003', style: { AGY: 40, REL: 55, ROL: 70, AUT: 72 } };
export const LEGACY_VERSION = { ...OWN_INTROVERT, session_id: 'syn-sess-0004', diagnosis_version: 'ETI-1.0', item_set_version: undefined, scoring_version: 'ETI-SCORE-1.0.0' };
export const UNKNOWN_VERSION = { ...OWN_INTROVERT, session_id: 'syn-sess-0005', diagnosis_version: 'ETI-3.0' };
export const MISMATCHED_SCORING = { ...OWN_INTROVERT, session_id: 'syn-sess-0006', scoring_version: 'ETI-SCORE-2.9.9' };
export const OUT_OF_RANGE = { ...OWN_INTROVERT, session_id: 'syn-sess-0007', personality: { O: 78, C: 62, E: 124, A: 68, N: 58 } };

// 画面の「合成データを選ぶ」に並べるもの
export const SYNTHETIC_RECORDS = [
  { key: 'own_introvert', label: '本人・内向的で思慮深い傾向（v2）', record: OWN_INTROVERT },
  { key: 'own_extravert', label: '本人・外向的で発案型の傾向（v2）', record: OWN_EXTRAVERT },
  { key: 'other_owner', label: '別の所有者の記録（v2）', record: OTHER_OWNER },
  { key: 'missing', label: '本人・値が欠けた記録', record: MISSING_FIELD },
  { key: 'legacy', label: '本人・旧版（ETI-1.0）', record: LEGACY_VERSION },
  { key: 'unknown', label: '本人・未知の版（ETI-3.0）', record: UNKNOWN_VERSION },
];
