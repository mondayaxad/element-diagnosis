// jagan/complete-sample.mjs — 邪眼完全解析「DIPPER」のサンプル。架空の回答（解析レポートのサンプルと同じ回答）1種類で、23ページから6ページだけを見せる。
//   sampleComplete(seed) は検査用（全ページ・別の回答）。ページでは回答を変えられない。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE } from './engine/data.mjs';
import { SAMPLE_ANSWERS } from './sample.mjs';
import { buildComplete } from './complete/model.mjs';
import { renderComplete, fitPages } from './complete/view.mjs';
import { mountSampleBuy } from './sample-buy.mjs';

export function answersForSeed(seed) {
  if (!seed) return { ...SAMPLE_ANSWERS };
  let s = seed >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  return Object.fromEntries(BUNDLE.items.items.map((i) => [i.id, 1 + Math.floor(rnd() * 5)]));
}
export function sampleComplete(seed = 0) {
  const result = computeDiagnosis({ answers: answersForSeed(seed), resultId: `sample-dipper-${seed}`, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
  return { result, html: renderComplete(buildComplete(result, BUNDLE, { diagnosedAt: '2026.11.07' })) };
}

// サンプルで見せるページ：表紙・あなたの影・邪眼×異相・上位3名のファトゥスとの交わり・あなたの反応領域・再読
export const SAMPLE_PAGES = ['dp01', 'dp03', 'dp15', 'dp16', 'dp18', 'dp20'];

if (typeof document !== 'undefined' && document.getElementById('dpBook')) {
  const { result, html } = sampleComplete(0);
  const book = document.getElementById('dpBook');
  book.innerHTML = html;
  book.querySelectorAll('.dp-page').forEach((pg) => { if (!SAMPLE_PAGES.includes(pg.id)) pg.remove(); });
  // 紙面は全ページ同じ大きさ（1240×1754）。画面では組み替えずに、幅に合わせて縮小する
  const fit = () => book.style.setProperty('--z', String(Math.min(1, (document.documentElement.clientWidth - 16) / 1240)));
  fit(); addEventListener('resize', fit);
  const fill = () => fitPages(book);
  fill();
  // 字形（Web フォント）が後から届くと行の折り返しが変わり、合わせた倍率のままでは見切れる。フォントが届くたび・読み込み完了・少し後にも合わせ直す
  if (document.fonts) { document.fonts.ready.then(fill); document.fonts.addEventListener('loadingdone', fill); }
  addEventListener('load', fill); setTimeout(fill, 1500); setTimeout(fill, 4000);
  document.getElementById('dpInfo').textContent = `邪眼完全解析「DIPPER」のサンプル（架空の回答・${result.dti.code}｜${result.dti.name}）。実際の23ページから、6ページを抜き出しています。`;
  // 最後：結果ページ・マイページから開いた時はその記録でそのまま申し込める。直接開いた時は、まず診断を案内する
  mountSampleBuy(document.getElementById('sampleBuy'), { page: 'complete' });
}
