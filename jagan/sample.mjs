// jagan/sample.mjs — 邪眼解析レポートのサンプル（架空の回答例「表出抑制が多い仮例」。docs/jagan/spec_v1_0_rc1/examples.json と同じ回答）。
//   人が受検した結果ではありません。本文の組み立ては販売開始後の本人のレポートと同じ renderReport を使います。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE, COPY } from './engine/data.mjs';
import { renderReport } from './view.mjs';

export const SAMPLE_RESULT_ID = "fictional-case-4";
export const SAMPLE_ANSWERS = Object.freeze({"JG001":3,"JG002":3,"JG003":3,"JG004":3,"JG005":3,"JG006":3,"JG007":3,"JG008":3,"JG009":3,"JG010":3,"JG011":3,"JG012":3,"JG013":3,"JG014":3,"JG015":3,"JG016":3,"JG017":3,"JG018":3,"JG019":3,"JG020":3,"JG021":3,"JG022":3,"JG023":3,"JG024":3,"JG025":3,"JG026":3,"JG027":3,"JG028":3,"JG029":3,"JG030":5,"JG031":5,"JG032":5,"JG033":5,"JG034":5,"JG035":3,"JG036":3,"JG037":3,"JG038":3,"JG039":3,"JG040":3,"JG041":3,"JG042":3,"JG043":3,"JG044":3,"JG045":3,"JG046":3,"JG047":3,"JG048":3,"JG049":3,"JG050":3});

export function sampleResult() {
  return computeDiagnosis({ answers: SAMPLE_ANSWERS, resultId: SAMPLE_RESULT_ID, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
}

if (typeof document !== 'undefined' && document.getElementById('sampleBody')) {
  document.getElementById('sampleBody').innerHTML = renderReport(sampleResult(), BUNDLE, COPY);
}
