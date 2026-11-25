// タイプ別レポート用の「標準の回答」（35タイプ）を作る。レポートは既存の解析レポートの仕組み（回答の符号 → computeResultsV2）にそのまま流す。
//   ・気質（Big Five）＝元素の設計値（ELEMENT_PROTOTYPES_V2）
//   ・関わり方（行動スタイル）＝武器種の設計値（WEAPON_PROTOTYPES_V2）
//   ・価値観＝元素の代表国家の設計値（NATION_PROTOTYPES_V2）。代表国家は REPRESENTATIVE_NATION（元素ごと）
//   ・各軸の回答（-2〜+2 の整数）の平均が、表示値 ((平均+2)/4)*100 で設計値に最も近くなるように配る
//   ・作った回答を診断エンジンに通し、元素・武器種・国家がすべて狙いどおり1位になることを確かめてから書き出す（外れたら止まる）
//   出力：lib/type-standard-answers.json（サーバーの購入 API が読む）（タイプコード → 符号・再現した得点・判定）
//   実行: node scripts/build-type-standard-answers.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// 元素の代表国家（原神の各国の元素神に対応）。ナドクライは元素に対応する国家ではないため使わない
export const REPRESENTATIVE_NATION = { 炎: 'ナタ', 水: 'フォンテーヌ', 氷: 'スネージナヤ', 雷: '稲妻', 風: 'モンド', 岩: '璃月', 草: 'スメール' };
const EL_CODE = { 炎: 'PY', 水: 'HY', 氷: 'CR', 雷: 'EL', 風: 'AN', 岩: 'GE', 草: 'DE' };
const WP_CODE = { 片手剣: 'SW', 両手剣: 'CM', 長柄: 'PL', 法器: 'CT', 弓: 'BW' };

const ctx = { console, Math };
vm.createContext(ctx);
for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
vm.runInContext('this.__x = { Q: ETI_V2_QUESTIONS, EP: ELEMENT_PROTOTYPES_V2, WP: WEAPON_PROTOTYPES_V2, NP: NATION_PROTOTYPES_V2, E: ETIv2, TV: TRANSLATION_MODEL_VERSION, META: ETI_V2_META };', ctx);
const { Q, EP, WP, NP, E, TV } = ctx.__x;

// 1つの軸の項目に、回答の平均が target（表示値）に最も近くなる整数（-2〜+2）を配る
function spread(qs, target, A) {
  let total = Math.round((target / 100 * 4 - 2) * qs.length);
  const vals = Array(qs.length).fill(0); let i = 0;
  while (total !== 0) { const s = Math.sign(total); if (Math.abs(vals[i] + s) <= 2) { vals[i] += s; total -= s; } i = (i + 1) % qs.length; }
  qs.forEach((q, j) => { A[q.id] = q.direction === -1 ? -vals[j] : vals[j]; });
}
export function standardAnswers(el, wp) {
  const target = { PERSONALITY: EP[el], STYLE: WP[wp], VALUES: NP[REPRESENTATIVE_NATION[el]] };
  const byAx = {};
  for (const q of Q) (byAx[`${q.domain}:${q.axis}`] = byAx[`${q.domain}:${q.axis}`] || []).push(q);
  const A = {};
  for (const [k, qs] of Object.entries(byAx)) { const [dom, ax] = k.split(':'); spread(qs, target[dom][ax], A); }
  return A;
}

export function buildAll() {
  const out = {};
  for (const el of Object.keys(EP)) for (const wp of Object.keys(WP)) {
    const code = EL_CODE[el] + WP_CODE[wp];
    const A = standardAnswers(el, wp);
    const R = E.computeResultsV2(A, { elementPrototypes: EP, weaponPrototypes: WP, nationPrototypes: NP });
    const nation = REPRESENTATIVE_NATION[el];
    const got = { element: R.elementRanking[0].name, weapon: R.weaponRanking[0].name, nation: R.nationRanking[0].name };
    if (got.element !== el || got.weapon !== wp || got.nation !== nation) throw new Error(`${code}: 判定が狙いと違います ${JSON.stringify(got)}`);
    const encoded = E.encodeAnswersV2(A, Q);
    // 符号から戻して、同じ結果になること（レポートの入口と同じ経路）
    const back = E.computeResultsV2(E.decodeAnswersV2(encoded, Q), { elementPrototypes: EP, weaponPrototypes: WP, nationPrototypes: NP });
    if (JSON.stringify(back.personality) !== JSON.stringify(R.personality)) throw new Error(`${code}: 符号の往復で結果が変わりました`);
    out[code] = {
      element: el, weapon: wp, nation, diagnosis_code: encoded,
      personality: R.personality, style: R.style,
      closeness: { element: R.elementRanking[0].closenessScore, weapon: R.weaponRanking[0].closenessScore, nation: R.nationRanking[0].closenessScore },
      top_gap: { element: R.elementTopGap, weapon: R.weaponTopGap, nation: R.nationTopGap },
    };
  }
  return { translation_model_version: TV, item_set_version: ctx.__x.META.itemSetVersion, scoring_version: ctx.__x.META.scoringVersion, representative_nation: REPRESENTATIVE_NATION, types: out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const data = buildAll();
  fs.writeFileSync(path.join(ROOT, 'lib/type-standard-answers.json'), JSON.stringify(data, null, 1) + '\n');
  const t = Object.values(data.types);
  console.log('types', t.length, 'closeness min', ['element', 'weapon', 'nation'].map((k) => `${k}:${Math.min(...t.map((x) => x.closeness[k]))}`).join(' '),
    'top_gap min', ['element', 'weapon', 'nation'].map((k) => `${k}:${Math.min(...t.map((x) => x.top_gap[k]))}`).join(' '));
}
