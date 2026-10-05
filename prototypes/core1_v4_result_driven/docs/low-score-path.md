# 低得点軸・中央域が本文へ変換される処理

入口は `src/polarity.js`（本文化）と `src/judgments.js`（neutral 判定と核の候補選び）です。辞書は `src/content/axes.json` です。

## src/polarity.js

```js
// polarity.js — 軸の高得点側・低得点側を本文へ変換する唯一の場所（CORE1-POLARITY-1.0.0）。
// 規則：
//   1. 低得点は「弱い」「出にくい」ではなく、低得点側の方向（lo_pole）とその現れ方（lo_reading）として書く。
//   2. 軸名には必ず方向を添える（例：誠実性（即興・可変側））。
//   3. 谷・山の文は「数値の谷は○○です。これは、〜方向として現れます。」の形に統一する。
//   4. P/S は表示値と50の比較、VALUES は表示値の centered（本人の10価値平均との差）で側を決める。
//   5. 中央域（P/S 36〜64、VALUES centered ±8 未満）と neutral（50・centered 0）は方向として扱わず、「○○側」を付けない。
'use strict';
const POLARITY_VERSION = 'CORE1-POLARITY-1.0.0';

function makePolarity(snap, axesDict) {
  const A = snap.axes, AX = axesDict.axes, B = axesDict.text_bands;
  const layerOf = (ax) => (ax in A.personality ? 'personality' : ax in A.style ? 'style' : 'values');
  const isV = (ax) => layerOf(ax) === 'values';
  const VA = Object.keys(A.values);
  const vMean = VA.reduce((s, k) => s + A.values[k], 0) / VA.length;
  const score = (ax) => A[layerOf(ax)][ax];
  const centered = (ax) => (isV(ax) ? A.values[ax] - vMean : score(ax) - 50);
  // ちょうど 50（VALUES は centered 0）は neutral。方向として扱わない
  const side = (ax) => { const c = centered(ax); return Math.abs(c) < 1e-9 ? 'neutral' : c > 0 ? 'hi' : 'lo'; };
  const band = (ax) => {
    const c = centered(ax);
    if (isV(ax)) return c >= B.v_centered_high ? 'high' : c <= B.v_centered_low ? 'low' : 'mid';
    const v = score(ax); return v >= B.high_min ? 'high' : v <= B.low_max ? 'low' : 'mid';
  };
  const pole = (ax, s = side(ax)) => (s === 'lo' ? AX[ax].lo_pole : AX[ax].hi_pole);
  const reading = (ax, s = side(ax)) => (s === 'lo' ? AX[ax].lo_reading : AX[ax].hi_reading);
  // 中央域（P/S 36〜64、VALUES |centered| < 8）と neutral には「○○側」を付けない
  const directional = (ax) => band(ax) !== 'mid' && side(ax) !== 'neutral';
  const label = (ax, s) => (s || directional(ax) ? `${AX[ax].name}（${pole(ax, s || side(ax))}）` : `${AX[ax].name}（中央域）`);
  const noun = (ax, s) => (s || directional(ax) ? ((s || side(ax)) === 'lo' ? AX[ax].lo_noun : AX[ax].hi_noun) : `<b>${AX[ax].name}</b>（中央域）`);
  // 「○○は〜側として現れやすい」/ 中央域は「○○は中央域で、強い偏りはない」
  const tendencyPhrase = (ax) => (directional(ax) ? `${AX[ax].name}は${pole(ax)}` : `${AX[ax].name}は中央域で強い偏りがなく`);
  const name = (ax) => AX[ax].name;
  // 「数値の谷は○○です。これは、〜方向として現れます。」
  function extremeSentence(kind, axes) {
    const head = kind === 'valley' ? '数値の谷' : '数値の山';
    const want = kind === 'valley' ? 'lo' : 'hi';
    const one = (ax, lead) => {
      const s = side(ax);
      // 中央域・neutral には方向（○○側）を付けない
      if (s === 'neutral' || band(ax) === 'mid') return `${lead}中央域にあり、どちらの方向にも強くは偏っていません。この層の中で相対的に${kind === 'valley' ? '低い' : '高い'}位置にあたります。`;
      // 相対的な谷でも、値そのものが高得点側にある時は低得点側の意味を当てない（極性を反転させない）
      if (s !== want) return `${lead}この層の中では相対的に${kind === 'valley' ? '低い' : '高い'}位置ですが、値は${pole(ax, s)}にあり、${reading(ax, s)}方向として現れます。`;
      return `${lead}${reading(ax, s)}方向として現れます。`;
    };
    if (axes.length === 1) return `${head}は${name(axes[0])}です。` + one(axes[0], 'これは、');
    return `${head}は${axes.map(name).join('と')}です。` + axes.map((ax) => one(ax, `${name(ax)}は、`)).join('');
  }
  // 核（主要一致軸）の保存形式
  function coreRecord(ax, dir, reason) {
    const s = dir === 'low' ? 'lo' : 'hi';
    return { core_axis_code: ax, core_axis_score: score(ax), core_axis_pole: pole(ax, s), core_axis_phrase: label(ax, s), core_selection_reason: reason };
  }
  return { version: POLARITY_VERSION, layerOf, isV, score, centered, side, band, directional, pole, reading, label, noun, name, tendencyPhrase, extremeSentence, coreRecord };
}

module.exports = { makePolarity, POLARITY_VERSION };
```

## src/judgments.js（neutral・帯・核の候補）

```js
const NEUTRAL = Object.freeze({ version: 'CORE1-NEUTRAL-1.0.0', ps_neutral: 50, v_neutral: 0, ps_low_max: 35, ps_high_min: 65, v_abs_min: 8, eps: 1e-9 });
const LAYER_OF = {};
  // 本人の側：ちょうど 50（VALUES は centered 0）は 'neutral'。どちらの側にも数えない
  const sideOfValue = (v, isValues) => { const c = isValues ? v : v - 50; return Math.abs(c) < NEUTRAL.eps ? 'neutral' : c > 0 ? 'hi' : 'lo'; };
  const side = (ax) => sideOfValue(isV(ax) ? userCentered[ax] : av(ax), isV(ax));
  // 帯：P/S は 65/35、VALUES は centered ±8
  const band = (ax) => {
    if (isV(ax)) { const c = userCentered[ax]; return c >= NEUTRAL.v_abs_min ? 'high' : c <= -NEUTRAL.v_abs_min ? 'low' : 'mid'; }
    const v = av(ax); return v >= NEUTRAL.ps_high_min ? 'high' : v <= NEUTRAL.ps_low_max ? 'low' : 'mid';
  };
  const strong = (ax) => band(ax) !== 'mid';
  // 12.5 形づくる核：辞書の core_axes の中で、方向が一致し、かつ中央域でない（強い側にある）軸のうち、型との差が最小の軸。
  // 条件を満たす軸が無ければ核を選ばない（無理に作らない）。中央域・neutral の軸は核にも支える軸にも採らない。
  function coreOf(kind, row, item) {
    const diffs = Object.fromEntries(protoDiffs(kind, row).map((d) => [d.axis, d]));
    const cands = item.core_axes.map((c, order) => {
      const d = diffs[c.axis];
      const dirOk = c.dir === 'high' ? d.userSide === 'hi' : d.userSide === 'lo';
      const status = d.userSide === 'neutral' ? 'excluded_neutral' : !dirOk ? 'excluded_direction' : d.band === 'mid' ? 'excluded_mid_band' : 'eligible';
      return { ...c, order, d, status };
    });
    const aligned = cands.filter((c) => c.status === 'eligible');
    aligned.sort((a, b) => (a.d.absDiff - b.d.absDiff) || (a.order - b.order));
    aligned.forEach((c, k) => { c.status = k === 0 ? 'adopted_primary' : 'adopted_supporting'; });
    const thresholds = kind === 'nation' ? `VALUES |centered| >= ${NEUTRAL.v_abs_min}（centered 0 は neutral）` : `P/S <= ${NEUTRAL.ps_low_max} または >= ${NEUTRAL.ps_high_min}（50 は neutral）`;
    return {
      primary: aligned[0] ? aligned[0].axis : null,
      supporting: aligned.slice(1).map((c) => c.axis),
      misaligned: cands.filter((c) => c.status === 'excluded_direction').map((c) => c.axis),
      candidates: item.core_axes.map((c) => c.axis),
      rule_id: RULES.core, neutral_rule: NEUTRAL.version, thresholds,
      candidate_trace: cands.map((c) => ({ axis: c.axis, dir: c.dir, user: Math.round(c.d.user * 10) / 10, band: c.d.band, side: c.d.userSide, status: c.status })),
      no_core_reason: aligned.length ? null : `core_axes 候補（${cands.map((c) => `${c.axis}:${c.status}`).join(', ')}）に、型と同じ向きで中央域の外（${thresholds}）にある軸が無いため、核を選ばない。`,
      evidence: cands.map((c) => ({ path: `rankings.${kind}[${row.rank - 1}].evidence.${c.axis}`, value: Math.round(c.d.user * 10) / 10, prototype: Math.round(c.d.proto * 10) / 10, band: c.d.band, side: c.d.userSide, status: c.status })),
    };
  }
  // 型と本人が反対側にあり、差が最も大きい軸（無ければ null）
```

## 呼び出し箇所（src/build-claims.js）

```
67:  const noun = (ax) => PL.noun(ax);
75:    const dir = axes.filter((a) => PL.directional(a)), mid = axes.filter((a) => !PL.directional(a));
77:    if (dir.length) parts.push(`${dir.map((a) => `${nm(a)}は${PL.pole(a)}`).join('、')}として現れやすい`);
145:    return { t: { id: `C_GENERIC_${hi}_${lo}`, type: 'coexist', text: `${PL.label(hi)}と${PL.label(lo)}が、並存しています。`, axes: [hi, lo],
146:      question: `${nm(hi)}と${nm(lo)}は、今日どちらの比重が大きかったか。`, switch: `場面によって、${PL.label(hi)}と${PL.label(lo)}の比重が変わる。` },
175:      C('P03', 'PEAKS', `数値の山は${PL.label(highs[0])}と${PL.label(highs[1])}です。${PL.extremeSentence('valley', lows)}`,
182:      { text: C('P03', 'FACT-2', `数値の山は${nm(highs[0])}と${nm(highs[1])}。${factTail(highs)}`, { kind: 'calculated_fact', rule: 'CORE1-POLARITY-1.0.0.peak', evidence: evAx(...highs) }),
184:      { text: C('P03', 'FACT-3', `数値の谷は${nm(lows[0])}と${nm(lows[1])}。${factTail(lows)}`, { kind: 'calculated_fact', rule: 'CORE1-POLARITY-1.0.0.valley', evidence: evAx(...lows) }),
206:      ? `${bottoms.map((r) => r.name).join('と')}。${bottoms[bottoms.length - 1].name}の型は${strip(pred(bDev.axis, bDev.protoSide))}${tendency(bDev.axis)}ですが、${youAt(bDev.axis, bDev.userSide)}。`
212:      : C(page, 'BAND', `この層の数値の山は${PL.label(order[0])}と${PL.label(order[1])}です。${PL.extremeSentence('valley', [order[order.length - 1]])}${kind === 'nation' ? '国家は価値の絶対的な高さではなく、この山と谷の並びの向きで決まります。' : '元の型の名前は、この山と谷の組み合わせが、どの型に近いかを表しています。'.replace('元の型の名前', KIND_JA[kind] + 'の名前')}`,
248:      ? `一方で、${ch.name}は${strip(pred(d.axis, d.charSide))}側、${youAt(d.axis, d.userSide).replace(/^あなたは/, 'あなたは')}。`
361:      core.records = [core.primary, ...core.supporting].filter(Boolean).map((ax, k) => PL.coreRecord(ax, dirOf(ax),
374:        ? `ただし、${row.name}の型は${strip(pred(dev.axis, dev.protoSide))}${tendency(dev.axis)}ですが、${youAt(dev.axis, dev.userSide)}。この違いが、${row.name}の中でのあなた固有の輪郭になります。`
449:      ? C('P25', 'UNIQUE', `${item(devAll.kind, top[devAll.kind].key).display_name}の型は${strip(pred(devAll.axis, devAll.protoSide))}${tendency(devAll.axis)}ですが、${youAt(devAll.axis, devAll.userSide)}。三つの結果名だけでは見えない、あなた固有の差です。`, { rule: 'CORE1-DEVIATION-1.0.0', kind: 'model_interpretation', evidence: [{ path: axPath(devAll.axis), value: Math.round(devAll.user * 10) / 10, prototype: Math.round(devAll.proto * 10) / 10 }] })
485:        : C('P27', `${r.rank}-OVERLOOK`, `${PL.label(uShape.personality.valley.axis)}は、絶対値ではなく相対配置を見ると${r.name}と同じ谷の位置にあり、形の一部として意味を持ちます。`, { rule: 'SHAPE_VALLEY', kind: 'model_interpretation', evidence: evAx(uShape.personality.valley.axis) }), 'own'],
511:      const s2 = dv ? `${r.name}の型は${strip(pred(dv.axis, dv.protoSide))}${tendency(dv.axis)}で、${youAt(dv.axis, dv.userSide)}。` : `${r.name}の型とは、いくつかの軸で少しずつ離れています。`;
608:    hidden: { ...LE.HIDDEN, text: C('P38', 'HIDDEN', LE.HIDDEN.how.replace('{valley}', PL.label(valleyAx)), { content: 'LENS_EXP.HIDDEN', evidence: evAx(valleyAx) }) },
611:    logs: [['火', `${mir[0].name}との共通点を、自分の場面で一つ書いた。`], ['木', `${PL.label(valleyAx)}の動き方が、行き違いを防いでいた場面があった。`], ['日', vm.p09 ? `「${strip(vm.p09.borrows[0].text)}」を一度試した。` : '広げてみたい振る舞いを一つ書き出した。']],
```
