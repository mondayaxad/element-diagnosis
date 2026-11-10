// 同じ回答に対して、無料の結果ページ・解析レポート（¥1,000）・完全解析（¥3,000）の表示が一致することを、多数の回答で確かめる。
//   DTI・邪眼・異相・人物・一致度、12特性の得点、邪眼の内訳（重み×特性の得点＝邪眼の得点）、人物の並び（1位＝あなたのファトゥス）
import { computeDiagnosis } from '../jagan/engine/runtime.mjs';
import { BUNDLE } from '../jagan/engine/data.mjs';
import { renderResultPage, renderReport } from '../jagan/view.mjs';
import { buildComplete } from '../jagan/complete/model.mjs';
import { renderComplete } from '../jagan/complete/view.mjs';
import { traitBandText } from '../jagan/site-copy.mjs';
const N = Number(process.argv[2] || 300);
let s = 12345; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
const problems = []; const bands = { hi: 0, mid: 0, lo: 0 };
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (let n = 0; n < N; n++) {
  // 一様・偏り（全体に低い／高い）を混ぜる
  const mode = n % 3; const answers = Object.fromEntries(BUNDLE.items.items.map((i) => [i.id, Math.max(1, Math.min(5, mode === 0 ? 1 + Math.floor(rnd() * 5) : mode === 1 ? 1 + Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 3)))]));
  const r = computeDiagnosis({ answers, resultId: `c-${n}`, itemSetVersion: BUNDLE.items.item_set_version }, BUNDLE);
  const ch = r.character;
  const free = strip(renderResultPage(r, BUNDLE)), rep = renderReport(r, BUNDLE), repT = strip(rep);
  const m = buildComplete(r, BUNDLE, { diagnosedAt: '2026.11.10' }); const dp = strip(renderComplete(m));
  const P = (cond, msg) => { if (!cond) problems.push(`#${n} ${msg}`); };
  for (const [name, t] of [['free', free], ['report', repT], ['dipper', dp]]) {
    P(t.includes(r.dti.code), `${name}: DTI ${r.dti.code}`);
    P(t.includes(r.element.label) && t.includes(r.isou.label), `${name}: 邪眼・異相`);
    if (ch.status === 'available') P(t.includes(ch.name) && t.includes(`${ch.match}%`), `${name}: 人物 ${ch.name} ${ch.match}%`);
  }
  // 1位＝あなたのファトゥス、表示の一致度＝並びの値（前後しない）
  const co = r.characterOrder;
  if (ch.status === 'available') { P(co[0].id === ch.id && co[0].displayScore === ch.match, '1位とあなたのファトゥス'); }
  for (let i = 1; i < co.length; i++) P(co[i - 1].displayScore >= co[i].displayScore, '一致度の並び');
  P(m.fatui.map((f) => f.id).join() === co.map((c) => c.id).join(), '完全解析 TOP11 の並び');
  P(m.fatui.every((f, i) => f.match === co[i].displayScore), '完全解析 TOP11 の一致度');
  // 12特性の得点（解析レポートの棒）と区分の説明
  for (const t of Object.values(r.traits)) {
    const re = new RegExp(`${t.label}<small>${t.id}</small></span><b>${t.displayScore}</b>`);
    P(re.test(rep), `report: ${t.id} ${t.displayScore}`);
    const bt = traitBandText(t.id, t.score); P(rep.includes(bt.text), `report: ${t.id} の区分の説明`);
    bands[t.score >= 60 ? 'hi' : t.score <= 40 ? 'lo' : 'mid']++;
  }
  // 邪眼の内訳：邪眼の得点 ＝ Σ 重み × 特性の得点（全7邪眼）
  for (const e of r.element.ranking) {
    const w = BUNDLE.core.elements.find((x) => x.id === e.id).weights;
    const v = Object.entries(w).reduce((a, [k, x]) => a + x * r.traits[k].score, 0);
    P(Math.abs(v - e.score) < 1e-6, `邪眼 ${e.id} の内訳 ${v} ≠ ${e.score}`);
  }
}
console.log(JSON.stringify({ cases: N, problems: problems.length, sample: problems.slice(0, 8), bands }));
process.exit(problems.length ? 1 : 0);
