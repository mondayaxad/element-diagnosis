// resonance_candidates.js — 共鳴診断：「アナタが選んだ人物（SELF IMAGE）」の候補の出し方（差し替え可能な部品）。
//
// 正式な方針（2026-11-06 承認・数値は未検証）：118名の心理座標から基本候補5名
//   （総合 MIRROR が近い2名・PERSONALITY が近い1名・STYLE が近い1名・VALUES が近い1名。重複は次順位から補充。
//     各領域の候補にも総合類似性の下限を設ける）＋「ほかの人物を見る」で5名以外からも選べる。
// 下限値・補充順序・最終候補一覧は未検証のため、ここでは実装しない（独断で固定しない）。
// 現在の中身は暫定（INTERIM）：基本候補なし＝登録 118 名すべてから選ぶ。判定（758）・回答に映る人物には一切使わない。
//
// 差し替え方：ResonanceCandidates.setProvider(function (answers) { return { version, primary: [名前…] }; })
//   answers は { element, weapon, nation }（内部キー）。primary は表示順の名前（ETI-CHAR-2.1.0 の名前）。
//   画面は primary を先に並べ、「ほかの人物を見る」で 118 名すべて（検索つき）を出す。primary が空なら最初から 118 名。
(function (root) {
  'use strict';
  var INTERIM_VERSION = 'RESONANCE-CANDIDATES-INTERIM-0';
  function interimProvider() { return { version: INTERIM_VERSION, primary: [] }; }
  var provider = interimProvider;

  function setProvider(fn) { provider = typeof fn === 'function' ? fn : interimProvider; }
  // 候補を返す。names に無い名前・重複は落とす（不正な候補を画面に出さない）
  function candidatesFor(answers, names) {
    var r = provider(answers) || {};
    var known = {};
    (names || []).forEach(function (n) { known[n] = true; });
    var seen = {};
    var primary = (Array.isArray(r.primary) ? r.primary : []).filter(function (n) {
      if (!known[n] || seen[n]) return false;
      seen[n] = true;
      return true;
    });
    return { version: typeof r.version === 'string' && r.version ? r.version : INTERIM_VERSION, primary: primary };
  }
  var api = { INTERIM_VERSION: INTERIM_VERSION, setProvider: setProvider, candidatesFor: candidatesFor };
  root.ResonanceCandidates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
