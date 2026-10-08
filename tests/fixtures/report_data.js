// テスト用：100問の回答から、index.html が保存するのと同じ保存値（answers_v2・encoded_answers・v2_scores・v2_rankings・mirror_snapshot）を作る。
'use strict';
const eng = require('../../api/_complete/rc1/src/engine').loadEngine();
const SAMPLE_ANSWERS = require('./complete_report_F01.json').input.answers;

function savedRecord(answers = SAMPLE_ANSWERS) {
  const res = eng.E.computeResultsV2(answers, { questions: eng.Q, meta: eng.META, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
  const mir = eng.resolver.computeMirror(res, 'ETI-MIRROR-2.1.0');
  return {
    answers_v2: JSON.parse(JSON.stringify(answers)),
    encoded_answers: eng.E.encodeAnswersV2(answers, eng.Q),
    v2_scores: { personality: res.personality, style: res.style, values: res.values, valuesCentered: res.valuesCentered },
    v2_rankings: { element: res.elementRanking, weapon: res.weaponRanking, nation: res.nationRanking },
    mirror_snapshot: eng.resolver.buildMirrorSnapshot(mir),
  };
}

// 回答を1問だけ変えた別の記録（同じ診断コードにならない）
function variantAnswers(n) {
  const a = JSON.parse(JSON.stringify(SAMPLE_ANSWERS));
  const ids = Object.keys(a).sort();
  for (let i = 0; i < 6; i++) { const id = ids[(n * 7 + i * 13) % ids.length]; a[id] = ((a[id] + 3 + n + i) % 5) - 2; }
  return a;
}

module.exports = { savedRecord, variantAnswers, SAMPLE_ANSWERS };
