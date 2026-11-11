// jagan/sample.mjs — 解析レポートのサンプル（開発用に作った架空の回答。人が受検した結果ではありません）。
//   依存（分離不安）と不安が高め、衝動・敵意・冷淡・危険志向が低め、という架空の回答パターン。
//   本文の組み立ては、販売開始後の本人のレポートと同じ renderReport を使います。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE } from './engine/data.mjs';
import { renderReport, dipperFoldHtml } from './view.mjs';
import { mountSampleBuy } from './sample-buy.mjs';

export const SAMPLE_RESULT_ID = 'sample-fictional-jagan-02';
export const SAMPLE_ANSWERS = Object.freeze({"ANX01":4,"ANX02":3,"ANX03":4,"ANX05":4,"SEP01":4,"SEP02":4,"SEP03":3,"SEP04":4,"SEP05":4,"SUS01":3,"SUS02":3,"SUS03":2,"SUS05":3,"WDR02":2,"WDR03":2,"WDR04":3,"WDR05":2,"IMP01":2,"IMP02":2,"IMP03":1,"IMP04":2,"IMP05":2,"PSV01":3,"PSV02":3,"PSV04":2,"PSV05":3,"PRF01":3,"PRF02":3,"PRF04":4,"PRF05":3,"HOS01":2,"HOS03":2,"HOS04":1,"HOS05":2,"ATT01":2,"ATT02":1,"ATT03":2,"ATT05":2,"MAN01":2,"MAN02":2,"MAN03":2,"MAN04":3,"RSK01":1,"RSK02":2,"RSK03":1,"RSK04":1,"CAL01":1,"CAL02":2,"CAL03":1,"CAL04":1});

export function sampleResult() {
  return computeDiagnosis({ answers: SAMPLE_ANSWERS, resultId: SAMPLE_RESULT_ID, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
}

if (typeof document !== 'undefined' && document.getElementById('sampleBody')) {
  document.getElementById('sampleBody').innerHTML = renderReport(sampleResult(), BUNDLE);
  const dp = document.getElementById('sampleDipper');
  if (dp) dp.innerHTML = dipperFoldHtml({ where: 'report' });
  // 下部の申込（結果ページ・マイページから開いた時だけ、その記録で）。完全解析の欄のボタンも同じ記録で申し込む
  mountSampleBuy(document.getElementById('sampleBuy'), { page: 'report',
    extra: dp ? [{ button: dp.querySelector('[data-buy="complete"]'), product: 'complete', msg: dp.querySelector('[data-dipper-msg]') }] : [] });
  const pdf = document.getElementById('printBtn');
  if (pdf) pdf.addEventListener('click', () => window.print());
}
