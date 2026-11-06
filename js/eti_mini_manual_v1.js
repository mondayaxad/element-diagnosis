// eti_mini_manual_v1.js — 元素診断 Mini：キャラクター手動選択時の再判定（ETI-MINI-MANUAL-1.0.0）。
//
// 正本：docs/eti-mini/phase_b_v1/CLAUDE_PHASE_B_実装指示書.md §3（ChatGPT 確定）
//   merged[axis] = 0.50 × 回答した属性の ETI v2 代表座標[axis] ＋ 0.50 × 選んだキャラの ETI-CHAR-2.1.0 座標[axis]
//   元素（PERSONALITY 5軸）・武器（STYLE 5軸）：正規化 RMSE が最小の代表
//   国家（VALUES 10軸）：結合後のベクトルと各代表をそれぞれ平均で中心化したコサイン類似度が最大の代表
//   同じ距離・同じ類似度：代表の表（js/eti_v2_prototypes.js）の挿入順で先のもの
//
// 実装の注意（式は変えない。同点の判定だけを厳密にする）
//   ・50:50 の配合では結合後の座標が半整数になり、2つの代表への距離が数学的に完全に同じになる組み合わせが多い
//     （280×118 のうち元素 1,840・武器 336 件）。浮動小数点で計算すると、計算の順序による誤差で同点の勝ち負けが
//     入れ替わり、「挿入順で先」という規則が守られない（本家の rankByDistance・同梱の参照実装とも）。
//   ・そこで座標がすべて整数であることを確かめたうえで、2×merged = 代表 + キャラ（整数）を使い、
//     RMSE は二乗和の整数比較、コサインは BigInt による分数の厳密比較で順位を決める。
//     RMSE・コサインの大小関係はこの整数比較と一致する（平方根・定数倍・共通の |A| は順位を変えない）。
//   ・点数・類似度は外に出さない（判定結果の元素・武器・国家だけを返す）。
(function (root) {
  'use strict';

  var MANUAL_VERSION = 'ETI-MINI-MANUAL-1.0.0';
  var WEIGHT = 0.5; // 固定（指示書 §3）。2×merged = 代表 + キャラ の整数計算はこの重みが前提
  var AXES = {
    element: ['O', 'C', 'E', 'A', 'N'],
    weapon: ['AGY', 'REL', 'ROL', 'REF', 'AUT'],
    nation: ['SD', 'ST', 'HE', 'AC', 'PO', 'SE', 'CO', 'TR', 'BE', 'UN'],
  };
  var DOMAIN = { element: 'personality', weapon: 'style', nation: 'values' };

  function fail(code, message) { var e = new Error(message || code); e.name = 'EtiMiniError'; e.code = code; return e; }
  function isInt0to100(v) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100; }

  // 2×merged（整数）。代表・キャラの軸が欠けている・整数でない場合は止める
  function doubledMerged(proto, charDomain, axes) {
    return axes.map(function (ax) {
      var p = proto[ax], c = charDomain ? charDomain[ax] : undefined;
      if (!isInt0to100(p)) throw fail('INVALID_PROTOTYPE', '代表座標が不正: ' + ax);
      if (!isInt0to100(c)) throw fail('INVALID_CHARACTER_COORDINATES', 'キャラクター座標が不正: ' + ax);
      return p + c;
    });
  }

  // 元素・武器：二乗和 Σ(2m − 2q)² が最小（= 正規化 RMSE 最小）。同値は表の挿入順で先
  function pickByRmse(table, m2, axes) {
    var bestKey = null, best = null;
    Object.keys(table).forEach(function (k) {
      var s = 0;
      for (var i = 0; i < axes.length; i++) { var d = m2[i] - 2 * table[k][axes[i]]; s += d * d; }
      if (best === null || s < best) { best = s; bestKey = k; }
    });
    return bestKey;
  }

  // 中心化（n 倍して整数のまま）：A_i = n·x_i − Σx
  function centeredScaled(values) {
    var n = BigInt(values.length), sum = 0n;
    values.forEach(function (v) { sum += BigInt(v); });
    return values.map(function (v) { return n * BigInt(v) - sum; });
  }
  function sign(b) { return b > 0n ? 1 : (b < 0n ? -1 : 0); }
  // dot1/√norm1 と dot2/√norm2 の大小（左が大きければ 1）
  function compareDotOverNorm(dot1, norm1, dot2, norm2) {
    var s1 = sign(dot1), s2 = sign(dot2);
    if (s1 !== s2) return s1 > s2 ? 1 : -1;
    if (s1 === 0) return 0;
    var l = dot1 * dot1 * norm2, r = dot2 * dot2 * norm1;
    var c = l > r ? 1 : (l < r ? -1 : 0);
    return s1 > 0 ? c : -c;
  }
  // 国家：中心化コサイン類似度が最大。結合後のベクトルが平坦（中心化で全0）なら全代表が類似度0で同点 → 挿入順で先
  function pickByCenteredCosine(table, m2, axes) {
    var A = centeredScaled(m2);
    var flat = A.every(function (x) { return x === 0n; });
    var bestKey = null, bestDot = null, bestNorm = null;
    Object.keys(table).forEach(function (k) {
      if (flat) { if (bestKey === null) bestKey = k; return; }
      var B = centeredScaled(axes.map(function (ax) { return table[k][ax]; }));
      var norm = 0n, dot = 0n;
      for (var i = 0; i < B.length; i++) { norm += B[i] * B[i]; dot += A[i] * B[i]; }
      if (norm === 0n) throw fail('INVALID_PROTOTYPE', '国家の代表座標が平坦: ' + k);
      if (bestKey === null || compareDotOverNorm(dot, norm, bestDot, bestNorm) > 0) { bestKey = k; bestDot = dot; bestNorm = norm; }
    });
    return bestKey;
  }

  // answers: { element, weapon, nation }（内部キー）／ character: ETI-CHAR-2.1.0 の1件
  // prototypes: { element: ELEMENT_PROTOTYPES_V2, weapon: WEAPON_PROTOTYPES_V2, nation: NATION_PROTOTYPES_V2 }
  function computeManual(answers, character, prototypes) {
    if (!prototypes || !prototypes.element || !prototypes.weapon || !prototypes.nation) throw fail('PROTOTYPES_MISSING', '代表座標が読み込まれていません');
    if (!character || typeof character.name !== 'string') throw fail('INVALID_CHARACTER', 'キャラクターが不明です');
    var a = answers || {};
    var out = {};
    ['element', 'weapon', 'nation'].forEach(function (dim) {
      var table = prototypes[dim];
      if (!Object.prototype.hasOwnProperty.call(table, a[dim])) throw fail('INVALID_ANSWERS', '未回答または不明な回答: ' + dim);
      var axes = AXES[dim];
      var m2 = doubledMerged(table[a[dim]], character[DOMAIN[dim]], axes);
      out[dim] = dim === 'nation' ? pickByCenteredCosine(table, m2, axes) : pickByRmse(table, m2, axes);
    });
    out.version = MANUAL_VERSION;
    out.weight = WEIGHT;
    return out;
  }

  // ブラウザ：本家の代表座標（js/eti_v2_prototypes.js の const）とキャラ座標（js/characters118_v2_1.js）を使い、
  // js/eti_mini_core.js の差し込み口へ接続する。
  function browserPrototypes() {
    /* global ELEMENT_PROTOTYPES_V2, WEAPON_PROTOTYPES_V2, NATION_PROTOTYPES_V2 */
    if (typeof ELEMENT_PROTOTYPES_V2 === 'undefined') return null;
    return { element: ELEMENT_PROTOTYPES_V2, weapon: WEAPON_PROTOTYPES_V2, nation: NATION_PROTOTYPES_V2 };
  }
  var api = { MANUAL_VERSION: MANUAL_VERSION, WEIGHT: WEIGHT, AXES: AXES, computeManual: computeManual };
  root.ETIMiniManual = api;
  if (root.ETIMini && typeof root.ETIMini.setManualCombiner === 'function') {
    root.ETIMini.setManualCombiner(function (input) {
      var protos = browserPrototypes();
      return computeManual(input.answers, input.character, protos);
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
