// ETI v2 -> 現行完了ページ用の共通表示モデル変換層。
// UI本文やレポートをここへ持ち込まない。新採点結果の形だけを整える。
(function (root) {
  'use strict';

  function scoreRows(rows, nameKey) {
    return (rows || []).map(function (row) {
      var out = { score: row.closenessScore };
      out[nameKey] = row.name;
      return out;
    });
  }

  function mirrorRows(rows) {
    return (rows || []).map(function (row) {
      return {
        name: row.name,
        match: row.mirrorScore,
        el: row.element,
        w: row.weapon,
        nation: row.region,
        personalitySim: Math.round((row.pSim || 0) * 100),
        styleSim: Math.round((row.sSim || 0) * 100),
        valuesSim: Math.round((row.vSim || 0) * 100),
      };
    });
  }

  function buildV2ViewModel(results, mirrorRowsInput, encodedCode) {
    if (!results || !results.elementRanking || !results.weaponRanking || !results.nationRanking) {
      throw new Error('ETI v2 view model: rankings are required');
    }
    return {
      schemaVersion: 'ETI-2.0',
      diagnosisVersion: results.meta && results.meta.diagnosisVersion,
      encodedCode: encodedCode || '',
      // 現行のBig Five表示はPERSONALITYの同一5軸をそのまま利用できる。
      big5: results.personality,
      personality: results.personality,
      style: results.style,
      values: results.values,
      valuesCentered: results.valuesCentered,
      elementScores: scoreRows(results.elementRanking, 'element'),
      weaponScores: scoreRows(results.weaponRanking, 'weapon'),
      nationScores: scoreRows(results.nationRanking, 'nation'),
      charMatches: mirrorRows(mirrorRowsInput),
      gaps: {
        element: results.elementTopGap,
        weapon: results.weaponTopGap,
        nation: results.nationTopGap,
      },
      // ETI v2はエニアグラムを測定しない。互換値を捏造しない。
      enneaTop: null,
      enneaWing: null,
      enneaSorted: null,
    };
  }

  function detectResultVersion(search) {
    var params = new URLSearchParams(search || '');
    var explicit = params.get('dv');
    if (explicit === 'ETI-2.0') return 'ETI-2.0';
    // 既存の ?code=... は常にlegacyとして扱い、過去URLを壊さない。
    if (params.get('code')) return 'legacy-v1';
    return 'ETI-2.0';
  }

  var api = { buildV2ViewModel: buildV2ViewModel, detectResultVersion: detectResultVersion };
  root.ETIv2LegacyAdapter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
