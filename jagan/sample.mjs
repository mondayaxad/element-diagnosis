// jagan/sample.mjs — 解析レポートのサンプル（開発用に作った架空の回答。人が受検した結果ではありません）。
//   表出抑制が強く、関係性の阻害と感情受容の困難がやや高く、衝動・行動維持の困難は低い、という架空の回答パターン。
//   本文の組み立ては、販売開始後の本人のレポートと同じ renderReport を使います。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE, COPY } from './engine/data.mjs';
import { renderReport } from './view.mjs';

export const SAMPLE_RESULT_ID = 'sample-fictional-jagan-01';
export const SAMPLE_ANSWERS = Object.freeze({"JG001":3,"JG002":3,"JG003":4,"JG004":3,"JG005":4,"JG006":4,"JG007":3,"JG008":4,"JG009":4,"JG010":3,"JG011":4,"JG012":4,"JG013":3,"JG014":2,"JG015":3,"JG016":3,"JG017":3,"JG018":2,"JG019":3,"JG020":2,"JG021":4,"JG022":3,"JG023":4,"JG024":4,"JG025":3,"JG026":3,"JG027":2,"JG028":3,"JG029":3,"JG030":5,"JG031":5,"JG032":4,"JG033":5,"JG034":4,"JG035":3,"JG036":2,"JG037":3,"JG038":3,"JG039":4,"JG040":3,"JG041":4,"JG042":4,"JG043":2,"JG044":1,"JG045":2,"JG046":2,"JG047":2,"JG048":3,"JG049":2,"JG050":2});

export function sampleResult() {
  return computeDiagnosis({ answers: SAMPLE_ANSWERS, resultId: SAMPLE_RESULT_ID, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
}

if (typeof document !== 'undefined' && document.getElementById('sampleBody')) {
  document.getElementById('sampleBody').innerHTML = renderReport(sampleResult(), BUNDLE, COPY);
  const pdf = document.getElementById('printBtn');
  if (pdf) pdf.addEventListener('click', () => window.print());
}
