// polarity.js — 軸の高得点側・低得点側を本文へ変換する唯一の場所（CORE1-POLARITY-1.0.0）。
// 規則：
//   1. 低得点は「弱い」「出にくい」ではなく、低得点側の方向（lo_pole）とその現れ方（lo_reading）として書く。
//   2. 軸名には必ず方向を添える（例：誠実性（即興・可変側））。
//   3. 谷・山の文は「数値の谷は○○です。これは、〜方向として現れます。」の形に統一する。
//   4. P/S は表示値と50の比較、VALUES は表示値の centered（本人の10価値平均との差）で側を決める。
//   5. 中央域（P/S 36〜64、VALUES centered ±8 未満）と neutral（50・centered 0）は方向として扱わず、「○○側」を付けない。
'use strict';
const POLARITY_VERSION = 'CORE1-POLARITY-1.0.0';

function makePolarity(snap, axesDict) {
  const A = snap.axes, AX = axesDict.axes, B = axesDict.text_bands;
  const layerOf = (ax) => (ax in A.personality ? 'personality' : ax in A.style ? 'style' : 'values');
  const isV = (ax) => layerOf(ax) === 'values';
  const VA = Object.keys(A.values);
  const vMean = VA.reduce((s, k) => s + A.values[k], 0) / VA.length;
  const score = (ax) => A[layerOf(ax)][ax];
  const centered = (ax) => (isV(ax) ? A.values[ax] - vMean : score(ax) - 50);
  // ちょうど 50（VALUES は centered 0）は neutral。方向として扱わない
  const side = (ax) => { const c = centered(ax); return Math.abs(c) < 1e-9 ? 'neutral' : c > 0 ? 'hi' : 'lo'; };
  const band = (ax) => {
    const c = centered(ax);
    if (isV(ax)) return c >= B.v_centered_high ? 'high' : c <= B.v_centered_low ? 'low' : 'mid';
    const v = score(ax); return v >= B.high_min ? 'high' : v <= B.low_max ? 'low' : 'mid';
  };
  const pole = (ax, s = side(ax)) => (s === 'lo' ? AX[ax].lo_pole : AX[ax].hi_pole);
  const reading = (ax, s = side(ax)) => (s === 'lo' ? AX[ax].lo_reading : AX[ax].hi_reading);
  // 中央域（P/S 36〜64、VALUES |centered| < 8）と neutral には「○○側」を付けない
  const directional = (ax) => band(ax) !== 'mid' && side(ax) !== 'neutral';
  const label = (ax, s) => (s || directional(ax) ? `${AX[ax].name}（${pole(ax, s || side(ax))}）` : `${AX[ax].name}（中央域）`);
  const noun = (ax, s) => (s || directional(ax) ? ((s || side(ax)) === 'lo' ? AX[ax].lo_noun : AX[ax].hi_noun) : `<b>${AX[ax].name}</b>（中央域）`);
  // 「○○は〜側として現れやすい」/ 中央域は「○○は中央域で、強い偏りはない」
  const tendencyPhrase = (ax) => (directional(ax) ? `${AX[ax].name}は${pole(ax)}` : `${AX[ax].name}は中央域で強い偏りがなく`);
  const name = (ax) => AX[ax].name;
  // 「数値の谷は○○です。これは、〜方向として現れます。」
  function extremeSentence(kind, axes) {
    const head = kind === 'valley' ? '数値の谷' : '数値の山';
    const want = kind === 'valley' ? 'lo' : 'hi';
    const one = (ax, lead) => {
      const s = side(ax);
      // 中央域・neutral には方向（○○側）を付けない
      if (s === 'neutral' || band(ax) === 'mid') return `${lead}中央域にあり、どちらの方向にも強くは偏っていません。この層の中で相対的に${kind === 'valley' ? '低い' : '高い'}位置にあたります。`;
      // 相対的な谷でも、値そのものが高得点側にある時は低得点側の意味を当てない（極性を反転させない）
      if (s !== want) return `${lead}この層の中では相対的に${kind === 'valley' ? '低い' : '高い'}位置ですが、値は${pole(ax, s)}にあり、${reading(ax, s)}方向として現れます。`;
      return `${lead}${reading(ax, s)}方向として現れます。`;
    };
    if (axes.length === 1) return `${head}は${name(axes[0])}です。` + one(axes[0], 'これは、');
    return `${head}は${axes.map(name).join('と')}です。` + axes.map((ax) => one(ax, `${name(ax)}は、`)).join('');
  }
  // 核（主要一致軸）の保存形式
  function coreRecord(ax, dir, reason) {
    const s = dir === 'low' ? 'lo' : 'hi';
    return { core_axis_code: ax, core_axis_score: score(ax), core_axis_pole: pole(ax, s), core_axis_phrase: label(ax, s), core_selection_reason: reason };
  }
  return { version: POLARITY_VERSION, layerOf, isV, score, centered, side, band, directional, pole, reading, label, noun, name, tendencyPhrase, extremeSentence, coreRecord };
}

module.exports = { makePolarity, POLARITY_VERSION };
