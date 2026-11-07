// jagan/complete-sample.mjs — 邪眼完全解析「DIPPER」の叩き台を、架空の回答で表示する（?seed=<数> で別の回答。0 は解析レポートのサンプルと同じ回答）。
import { computeDiagnosis } from './engine/runtime.mjs';
import { BUNDLE } from './engine/data.mjs';
import { SAMPLE_ANSWERS } from './sample.mjs';
import { buildComplete } from './complete/model.mjs';
import { renderComplete } from './complete/view.mjs';

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

if (typeof document !== 'undefined' && document.getElementById('dpBook')) {
  const seed = Number(new URLSearchParams(location.search).get('seed') || 0) || 0;
  const { result, html } = sampleComplete(seed);
  document.getElementById('dpBook').innerHTML = html;
  document.getElementById('dpInfo').textContent = `邪眼完全解析「DIPPER」の叩き台（架空の回答・seed ${seed}：${result.dti.code}｜${result.dti.name}。販売していません）`;
  document.getElementById('dpNext').addEventListener('click', () => { location.search = `?seed=${seed + 1}`; });
  document.getElementById('dpPrint').addEventListener('click', () => window.print());
}
