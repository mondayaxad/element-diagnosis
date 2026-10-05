/* ETI-MIRROR-2.1.0 selection reference. No change to raw similarity or report rankings. */
var ETIMirrorSelectionV21 = (function () {
  'use strict';
  const MIRROR_VERSION = 'ETI-MIRROR-2.1.0';
  const RAW_SCORE_EPSILON_PT = 1e-10; // equals 1e-12 on the 0..1 scale
  const ATTRIBUTE_DISTANCE_EPSILON = 1e-12;
  function topAttributeNames(rows) {
    if (!Array.isArray(rows) || rows.length === 0 || rows.some(r => !Number.isFinite(r.distance))) {
      throw new Error('Missing or invalid ETI v2 attribute ranking');
    }
    const best = Math.min(...rows.map(r => r.distance));
    return rows.filter(r => Math.abs(r.distance - best) <= ATTRIBUTE_DISTANCE_EPSILON).map(r => r.name);
  }
  function deriveAttributes(userResults, options) {
    const { engine, meta, elementPrototypes, nationPrototypes, weaponPrototypes } = options;
    if (!engine || !meta || !elementPrototypes || !nationPrototypes || !weaponPrototypes) {
      throw new Error('Explicit canonical ETI v2 engine, axes, and prototypes are required');
    }
    return {
      element: topAttributeNames(engine.rankByDistance(elementPrototypes, userResults.personality, meta.personalityAxes).ranking),
      nation: topAttributeNames(engine.rankNationsByCenteredValues(nationPrototypes, userResults.values, meta.valueAxes).ranking),
      weapon: topAttributeNames(engine.rankByDistance(weaponPrototypes, userResults.style, meta.styleAxes).ranking),
    };
  }
  function selectFromRankings(rankings, attributes) {
    if (!Array.isArray(rankings) || rankings.length === 0 ||
        rankings.some(r => !Number.isFinite(r.mirrorScoreRaw) || !Number.isInteger(r.canonicalIndex)) ||
        new Set(rankings.map(r => r.name)).size !== rankings.length ||
        new Set(rankings.map(r => r.canonicalIndex)).size !== rankings.length) {
      throw new Error('Invalid raw MIRROR rankings or canonical indices');
    }
    for (const key of ['element', 'nation', 'weapon']) {
      if (!Array.isArray(attributes[key])) throw new Error('Missing attribute top set: ' + key);
    }
    const best = Math.max(...rankings.map(r => r.mirrorScoreRaw));
    let candidates = rankings.filter(r => Math.abs(r.mirrorScoreRaw - best) <= RAW_SCORE_EPSILON_PT);
    const rawTieCount = candidates.length;
    const trace = [];
    let selectedBy = candidates.length === 1 ? 'highest_raw_score' : 'canonical_index';
    if (candidates.length > 1) {
      for (const [attribute, field] of [['element', 'element'], ['nation', 'region'], ['weapon', 'weapon']]) {
        const before = candidates.length;
        const hits = candidates.filter(r => attributes[attribute].includes(r[field]));
        if (hits.length > 0) candidates = hits;
        trace.push({ attribute, before, matching: hits.length, after: candidates.length });
        if (candidates.length === 1) { selectedBy = attribute + '_match'; break; }
      }
    }
    const mirror = [...candidates].sort((a, b) => a.canonicalIndex - b.canonicalIndex)[0];
    return {
      mirror,
      rankings, // retain original array and report score ordering; caller must not assume rankings[0] is MIRROR
      selectionMeta: {
        mirrorModelVersion: MIRROR_VERSION,
        characterProfileVersion: 'ETI-CHAR-2.1.0',
        rawScoreEpsilonPt: RAW_SCORE_EPSILON_PT,
        tiedAtTopCount: rawTieCount,
        selectedBy,
        topAttributes: attributes,
        trace,
      },
    };
  }
  function selectMirrorV21(userResults, rankings, options) {
    return selectFromRankings(rankings, deriveAttributes(userResults, options));
  }
  return { MIRROR_VERSION, RAW_SCORE_EPSILON_PT, ATTRIBUTE_DISTANCE_EPSILON, topAttributeNames, deriveAttributes, selectFromRankings, selectMirrorV21 };
}());
if (typeof module !== 'undefined' && module.exports) module.exports = ETIMirrorSelectionV21;
