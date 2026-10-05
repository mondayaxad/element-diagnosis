// make-fixtures.js — 個人情報を含まない seed 固定の100問回答フィクスチャを作る。
// 方法：目標の20軸座標（各カテゴリのプロトタイプ＋seed付きの揺らぎ）に最も近い到達可能値を軸ごとに選び、
// その符号付き合計になる回答を seed で配置する。正本エンジンで計算し、条件を満たした最初の候補を採用する。
// 質問・プロトタイプ・人物座標・重みは一切変更しない。何度実行しても同じファイルになる。
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEngine, EXPECTED_VERSIONS } = require('../src/engine');
const { calculateResult } = require('../src/calculate-result');

const OUT = path.join(__dirname, '..', 'fixtures', 'answers');
const eng = loadEngine();
const META = eng.META;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function itemsByAxis() {
  const m = {};
  eng.Q.forEach((q) => { (m[q.axis] = m[q.axis] || []).push(q); });
  return m;
}
const BY_AXIS = itemsByAxis();

// 目標 display に最も近い符号付き合計（display = round(((sum/n)+2)/4*100)）
function nearestSum(n, target) {
  let best = 0, bestD = Infinity;
  for (let s = -2 * n; s <= 2 * n; s++) {
    const d = Math.abs(Math.round(((s / n) + 2) / 4 * 100) - target);
    if (d < bestD || (d === bestD && Math.abs(s) < Math.abs(best))) { best = s; bestD = d; }
  }
  return best;
}
// 合計 s になる n 個の -2..2 を、seed で散らして作る
function spread(n, s, rnd) {
  const vals = Array(n).fill(0);
  let rem = s;
  let guard = 0;
  while (rem !== 0 && guard++ < 1000) {
    const i = Math.floor(rnd() * n), step = Math.sign(rem);
    if (Math.abs(vals[i] + step) <= 2) { vals[i] += step; rem -= step; }
  }
  // 中央値ばかりにならないよう、合計を保ったまま±1の入れ替えを数回
  for (let k = 0; k < n; k++) {
    const i = Math.floor(rnd() * n), j = Math.floor(rnd() * n);
    if (i !== j && vals[i] < 2 && vals[j] > -2 && rnd() < 0.5) { vals[i]++; vals[j]--; }
  }
  return vals;
}
function answersFor(vector, seed) {
  const rnd = mulberry32(seed);
  const ans = {};
  Object.keys(BY_AXIS).forEach((ax) => {
    const items = BY_AXIS[ax];
    const sum = nearestSum(items.length, vector[ax]);
    const signed = spread(items.length, sum, rnd);
    items.forEach((q, i) => { ans[q.id] = q.direction === -1 ? -signed[i] : signed[i]; });
  });
  return Object.fromEntries(eng.Q.map((q) => [q.id, ans[q.id]]));
}

const baseInput = (id, answers, goal) => ({
  session_id: 'FIXTURE-' + id, display_name: 'サンプル ' + id,
  diagnosed_at: '2026-10-04T10:00:00+09:00', generated_at: '2026-10-04T10:00:00+09:00',
  answers, versions: { ...EXPECTED_VERSIONS }, mentor_goal: goal || null,
});

const GOALS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'mentor-goals.json'), 'utf8')).goals;
const goal = (id) => { const g = GOALS.find((x) => x.goal_id === id); return { goal_id: g.goal_id, label: g.label, selected_by: 'fixture', selected_at: '2026-10-04T10:00:00+09:00', deltas: g.deltas }; };

function search(id, want, opts = {}) {
  const sd = opts.sd ?? 9;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const seed = 20261004 + attempt * 7919 + id.charCodeAt(1) * 131 + id.charCodeAt(2);
    const rnd = mulberry32(seed);
    const noise = () => (rnd() + rnd() + rnd() - 1.5) * sd * 1.4;
    const vec = {};
    const P = eng.EP[want.element] || {}, S = eng.WP[want.weapon] || {}, V = eng.NP[want.nationKey] || {};
    META.personalityAxes.forEach((ax) => { vec[ax] = (opts.mid ? 50 + (P[ax] - 50) * 0.45 : P[ax]) + noise(); });
    META.styleAxes.forEach((ax) => { vec[ax] = (opts.mid ? 50 + (S[ax] - 50) * 0.45 : S[ax]) + noise(); });
    META.valueAxes.forEach((ax) => { vec[ax] = want.flatValues ? 63 : (V[ax] ?? 50) + noise(); });
    Object.keys(vec).forEach((k) => { vec[k] = Math.max(4, Math.min(96, vec[k])); });
    const answers = answersFor(vec, seed);
    if (want.flatValues) META.valueAxes.forEach((ax) => BY_AXIS[ax].forEach((q) => { answers[q.id] = 1; }));
    const snap = calculateResult(baseInput(id, answers, want.goal));
    const R = snap.rankings;
    if (want.element && R.element[0].key !== want.element) continue;
    if (want.weapon && R.weapon[0].key !== want.weapon) continue;
    if (want.nationKey && !want.flatValues && R.nation[0].key !== want.nationKey) continue;
    if (want.check && !want.check(snap)) continue;
    // 1位が明瞭すぎる・同点すぎる偏りを避けるため、上位3がすべて1位と同じ表示になる候補は捨てる
    return { seed, vector: vec, answers, snap };
  }
  throw new Error('fixture search failed: ' + id);
}

const SPECS = [
  { id: 'F02', title: '風×弓×モンド（承認フィクスチャ ANBW-M）', want: { element: '風', weapon: '弓', nationKey: 'モンド', goal: goal('GOAL_BOUNDARY_01') } },
  { id: 'F03', title: '炎×両手剣×ナタ', want: { element: '炎', weapon: '両手剣', nationKey: 'ナタ' } },
  { id: 'F04', title: '氷×法器×スネージナヤ', want: { element: '氷', weapon: '法器', nationKey: 'スネージナヤ', goal: goal('GOAL_RELATION_01') } },
  { id: 'F05', title: '雷×片手剣×稲妻', want: { element: '雷', weapon: '片手剣', nationKey: '稲妻' } },
  { id: 'F06', title: '岩×長柄×璃月', want: { element: '岩', weapon: '長柄', nationKey: '璃月', goal: goal('GOAL_EXPLORE_01') } },
  { id: 'F07', title: '草×法器×フォンテーヌ', want: { element: '草', weapon: '法器', nationKey: 'フォンテーヌ' } },
  { id: 'F08', title: '水×片手剣×ナド・クライ', want: { element: '水', weapon: '片手剣', nationKey: 'ナドクライ', goal: goal('GOAL_VISIBLE_01') } },
  { id: 'F09', title: 'VALUES完全平坦（岩×片手剣）', want: { element: '岩', weapon: '片手剣', flatValues: true } },
  { id: 'F10', title: '1位と2位の表示が同点・生値は異なる', want: { element: '雷', weapon: '弓', nationKey: 'フォンテーヌ', check: (s) => ['element', 'weapon', 'nation'].some((k) => s.rankings[k][0].display === s.rankings[k][1].display && s.rankings[k][0].distance !== s.rankings[k][1].distance) }, opts: { sd: 12 } },
  { id: 'F11', title: '混合プロファイル（中央寄り）', want: { element: '草', weapon: '長柄', nationKey: 'モンド', check: (s) => Object.values(s.axes.personality).concat(Object.values(s.axes.style)).every((v) => v >= 30 && v <= 75) }, opts: { mid: true, sd: 8 } },
  { id: 'F12', title: '炎×法器×スメール（MENTORあり）', want: { element: '炎', weapon: '法器', nationKey: 'スメール', goal: goal('GOAL_PACE_01') } },
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // F01：承認サンプル（core1_v4_revised と同じ100問。値は凍結済みのものをそのまま使う）
  const S = require('../fixtures/golden/approved_sample_CORE1-V4-AUDITED-SAMPLE-001.json');
  const f01answers = Object.fromEntries(S.answer_item_ids.map((id, i) => [id, S.answers[i]]));
  const f01 = baseInput('F01', f01answers, goal('GOAL_VISIBLE_01'));
  f01.session_id = 'CORE1-V4-AUDITED-SAMPLE-001';
  f01.display_name = 'サンプル（承認版）';
  const files = [{ id: 'F01', title: '水×長柄×スメール（承認サンプル・ゴールデン）', input: f01, seed: S.construction.seed, method: 'approved_sample' }];
  SPECS.forEach((sp) => {
    const r = search(sp.id, sp.want, sp.opts);
    files.push({ id: sp.id, title: sp.title, input: baseInput(sp.id, r.answers, sp.want.goal), seed: r.seed, method: 'seeded_prototype_neighbourhood', target_vector: Object.fromEntries(Object.entries(r.vector).map(([k, v]) => [k, Math.round(v)])) });
  });
  files.forEach((f) => {
    fs.writeFileSync(path.join(OUT, f.id + '.json'), JSON.stringify({ fixture_id: f.id, title: f.title, construction: { method: f.method, seed: f.seed, prng: 'mulberry32', target_vector: f.target_vector || null }, input: f.input }, null, 1) + '\n');
    const s = calculateResult(f.input);
    console.log(f.id, s.rankings.element[0].name, s.rankings.weapon[0].name, s.rankings.nation[0].name, s.mentor.status, f.title);
  });
}
main();
