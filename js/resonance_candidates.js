// resonance_candidates.js — 共鳴診断：「アナタが選んだ人物（SELF IMAGE）」の候補（差し替え可能な部品）。
//
// 現在の方針（2026-11-06 オーナー指示）：候補は、3つの答えの 758 で現れる可能性のある人物だけ。
//   ＝本家「以前の結果から読む」と同じ表 js/type_reading_chars.js（EdTypeReadingChars.TYPES['元素|武器|国家']：
//     そのタイプのまま100問の診断で「最も近しいキャラクター」になり得る人物。1タイプ 1〜67 名・280 タイプすべてにいる）。
//   「選ばない」は無く、この中から必ず1人を選ぶ。118 名すべてを並べる「ほかの人物を見る」は無い。
//   判定（758）・回答に映る人物（MIRROR）には一切使わない。
//
// 差し替え方：ResonanceCandidates.setProvider(function (answers) { return { version, names: [名前…] }; })
//   answers は { element, weapon, nation }（内部キー）。names は候補の名前（ETI-CHAR-2.1.0 の名前）。
(function (root) {
  'use strict';
  var TYPE_VERSION = 'RESONANCE-CANDIDATES-TYPE-1';

  function typeTable() {
    /* global EdTypeReadingChars */
    if (typeof EdTypeReadingChars !== 'undefined') return EdTypeReadingChars;
    return root.EdTypeReadingChars || null;
  }
  // 既定：758 で現れる人物（js/type_reading_chars.js の表の順。画面は五十音で並べ直す）
  function typeProvider(answers) {
    var T = typeTable();
    var a = answers || {};
    var rows = T && T.TYPES ? T.TYPES[a.element + '|' + a.weapon + '|' + a.nation] : null;
    return { version: TYPE_VERSION, names: (rows || []).map(function (x) { return x[0]; }) };
  }
  var provider = typeProvider;

  function setProvider(fn) { provider = typeof fn === 'function' ? fn : typeProvider; }
  // 候補を返す。名簿（knownNames）に無い名前・重複は落とす（不正な候補を画面に出さない）
  function candidatesFor(answers, knownNames) {
    var r = provider(answers) || {};
    var known = {};
    (knownNames || []).forEach(function (n) { known[n] = true; });
    var seen = {};
    var names = (Array.isArray(r.names) ? r.names : []).filter(function (n) {
      if (!known[n] || seen[n]) return false;
      seen[n] = true;
      return true;
    });
    return { version: typeof r.version === 'string' && r.version ? r.version : TYPE_VERSION, names: names };
  }
  var api = { TYPE_VERSION: TYPE_VERSION, setProvider: setProvider, candidatesFor: candidatesFor };
  root.ResonanceCandidates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
