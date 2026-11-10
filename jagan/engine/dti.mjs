// jagan/engine/dti.mjs — DTI（邪眼タイプ指標）の選定：異相と邪眼元素を必ず一つずつ決める（2026-11-04 指示書 3章）。
//   ・異相：丸める前の特性平均が最高のもの。同点なら「5と答えた割合」→「4と答えた割合」→固定ハッシュの順で一つに。
//     平均・割合はその特性の設問数を分母にし、整数の交差積で比べる（浮動小数の誤差・表示の丸めで同点を作らない）。
//   ・邪眼元素：基礎モデルの係数・順位のまま。最高点が厳密に同点のときだけ固定ハッシュで一つに。
//   ・固定ハッシュ：全設問を設問ID順に並べ「ID:回答」を「|」で連結し、末尾に「|isou:候補ID」（元素は「|element:候補ID」）を
//     付けた UTF-8 文字列の FNV-1a 32bit（unsigned）。最小値を採用し、同値なら候補IDの ASCII 昇順。
//     候補IDは内部ID（異相は ANX などの特性ID、元素は PY など）。乱数・時刻・ユーザーID・回答オブジェクトのキー順は使わない。
//   ・これは表示のための選定で、特性の強さの差を示すものではない。人物判定には使わない（人物は judge.mjs の基礎版のまま）。
const EPS = 1e-8; // 元素の得点（重み付きの小数）の「厳密な同点」の判定。judge.mjs と同じ値
const enc = new TextEncoder();

export function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (const b of enc.encode(text)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function normalizedAnswers(answers, items) {
  return items.items.map((i) => i.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((id) => `${id}:${answers[id]}`).join('|');
}

const ascii = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function byHash(base, kind, ids) {
  return [...ids].sort((a, b) => fnv1a32(`${base}|${kind}:${a}`) - fnv1a32(`${base}|${kind}:${b}`) || ascii(a, b));
}

// 各特性の回答の集計（整数）
export function traitTallies(answers, items) {
  return items.traits.map((t) => {
    const vals = items.items.filter((i) => i.trait === t.id).map((i) => answers[i.id]);
    return { id: t.id, n: vals.length, sum: vals.reduce((s, v) => s + v, 0), c5: vals.filter((v) => v === 5).length, c4: vals.filter((v) => v === 4).length };
  });
}

// 比率 a.x/a.n と b.x/b.n を交差積で比べる（正なら a が大きい）
const cmp = (a, b, key) => a[key] * b.n - b[key] * a.n;

export function selectIsou(answers, items) {
  const t = traitTallies(answers, items);
  let cand = t.filter((x) => t.every((y) => cmp(x, y, 'sum') >= 0));
  let stage = 'unique';
  for (const key of ['c5', 'c4']) {
    if (cand.length < 2) break;
    stage = key === 'c5' ? 'ratio5' : 'ratio4';
    cand = cand.filter((x) => cand.every((y) => cmp(x, y, key) >= 0));
  }
  let id = cand[0].id;
  if (cand.length > 1) { stage = 'hash'; id = byHash(normalizedAnswers(answers, items), 'isou', cand.map((c) => c.id))[0]; }
  return { id, tieBreak: stage };
}

// 元素の並び：得点の降順。厳密な同点の中は固定ハッシュの順（1位の選定と同じ規則で、上位3の表示もそろえる）
export function orderElements(elementRanking, answers, items) {
  const base = normalizedAnswers(answers, items);
  const out = [];
  const rows = [...elementRanking].sort((a, b) => b.score - a.score || ascii(a.id, b.id));
  for (let i = 0; i < rows.length;) {
    let j = i + 1;
    while (j < rows.length && Math.abs(rows[i].score - rows[j].score) < EPS) j++;
    const group = rows.slice(i, j);
    const ids = group.length > 1 ? byHash(base, 'element', group.map((g) => g.id)) : [group[0].id];
    for (const id of ids) out.push({ ...group.find((g) => g.id === id), rank: i + 1, tied: group.length > 1 });
    i = j;
  }
  return out;
}

export function dtiPattern(dti, elementId, traitId) {
  const p = dti.patterns.find((x) => x.element_id === elementId && x.trait_id === traitId);
  if (!p) throw new Error('dti_pattern_missing');
  return p;
}

// 異相の全体の並び（完全解析の「異相の全体順位」）：selectIsou と同じ規則で12特性すべてを並べる。
//   平均（交差積）→ 5の割合 → 4の割合 → 固定ハッシュ。1位は必ず selectIsou の結果と同じ。
export function orderIsou(answers, items) {
  const t = traitTallies(answers, items);
  const hashOrder = byHash(normalizedAnswers(answers, items), 'isou', t.map((x) => x.id));
  const hi = (id) => hashOrder.indexOf(id);
  return [...t].sort((a, b) => cmp(b, a, 'sum') || cmp(b, a, 'c5') || cmp(b, a, 'c4') || hi(a.id) - hi(b.id))
    .map((x, i) => ({ id: x.id, rank: i + 1, mean: x.sum / x.n }));
}
