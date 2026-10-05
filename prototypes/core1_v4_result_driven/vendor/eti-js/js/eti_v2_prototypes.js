// eti_v2_prototypes.js
// ETI v2.0 FINAL 設計書§6.1〜6.3で確定した、元素・武器・国家のプロトタイプ表。
// index.html・report.html・各テストファイルは、すべてこのファイルを唯一の
// ソースとして読み込む（値を直書き・二重管理しない）。
//
// この値を変更する場合は、必ず TRANSLATION_MODEL_VERSION を更新すること
// （心理データ→世界観への翻訳ロジックのバージョン管理。設計書の方針通り）。

const TRANSLATION_MODEL_VERSION = 'ETI-TRANS-2.0.0';

// 元素 — Big Five(O/C/E/A/N) → 7元素（設計書§6.1）
const ELEMENT_PROTOTYPES_V2 = {
  '炎': { O: 50, C: 90, E: 90, A: 70, N: 50 },
  '水': { O: 70, C: 70, E: 50, A: 70, N: 70 },
  '氷': { O: 50, C: 70, E: 10, A: 30, N: 90 },
  '雷': { O: 70, C: 70, E: 70, A: 30, N: 70 },
  '風': { O: 90, C: 30, E: 50, A: 70, N: 50 },
  '岩': { O: 30, C: 90, E: 50, A: 90, N: 30 },
  '草': { O: 90, C: 70, E: 50, A: 90, N: 50 },
};

// 武器 — STYLE(AGY/REL/ROL/REF/AUT) → 5武器（設計書§6.2）
const WEAPON_PROTOTYPES_V2 = {
  '片手剣': { AGY: 50, REL: 90, ROL: 60, REF: 45, AUT: 30 },
  '両手剣': { AGY: 90, REL: 30, ROL: 60, REF: 30, AUT: 90 },
  '長柄':   { AGY: 55, REL: 70, ROL: 90, REF: 45, AUT: 45 },
  '法器':   { AGY: 30, REL: 45, ROL: 55, REF: 90, AUT: 65 },
  '弓':     { AGY: 45, REL: 35, ROL: 55, REF: 65, AUT: 90 },
};

// 国家 — VALUES(SD/ST/HE/AC/PO/SE/CO/TR/BE/UN) → 8国家（設計書§6.3）
const NATION_PROTOTYPES_V2 = {
  'モンド':       { SD: 90, ST: 80, HE: 65, AC: 45, PO: 25, SE: 35, CO: 20, TR: 25, BE: 55, UN: 70 },
  '璃月':         { SD: 45, ST: 35, HE: 40, AC: 85, PO: 60, SE: 70, CO: 65, TR: 85, BE: 60, UN: 50 },
  '稲妻':         { SD: 25, ST: 20, HE: 30, AC: 50, PO: 55, SE: 90, CO: 85, TR: 95, BE: 60, UN: 45 },
  'スメール':     { SD: 85, ST: 55, HE: 35, AC: 60, PO: 25, SE: 45, CO: 35, TR: 40, BE: 70, UN: 95 },
  'フォンテーヌ': { SD: 55, ST: 45, HE: 50, AC: 60, PO: 45, SE: 65, CO: 80, TR: 55, BE: 65, UN: 95 },
  'ナタ':         { SD: 70, ST: 95, HE: 90, AC: 75, PO: 55, SE: 25, CO: 30, TR: 45, BE: 70, UN: 55 },
  'スネージナヤ': { SD: 65, ST: 65, HE: 40, AC: 90, PO: 95, SE: 55, CO: 35, TR: 40, BE: 35, UN: 30 },
  'ナドクライ':   { SD: 90, ST: 60, HE: 25, AC: 30, PO: 20, SE: 60, CO: 20, TR: 35, BE: 50, UN: 70 },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRANSLATION_MODEL_VERSION,
    ELEMENT_PROTOTYPES_V2,
    WEAPON_PROTOTYPES_V2,
    NATION_PROTOTYPES_V2,
  };
}
