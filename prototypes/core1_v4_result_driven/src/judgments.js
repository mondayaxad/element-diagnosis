// judgments.js — スナップショットから「文章を選ぶための判定」を作る（数値はここで新たに計算しない。読むだけ）。
// すべて決定論的。閾値は文章選択用の暫定版（CORE1-TEXT-BANDS-0.1.0 / CORE1-GAP-LABELS-CANDIDATE-0.1.0）。
'use strict';

const RULES = Object.freeze({
  textBands: 'CORE1-TEXT-BANDS-0.1.0',
  gapLabels: 'CORE1-GAP-LABELS-CANDIDATE-0.1.0',
  core: 'CORE1-CORE-AXIS-1.0.0',
  pairRelation: 'CORE1-PAIR-RELATION-0.1.0',
  charDiff: 'CORE1-CHAR-DIFF-1.0.0',
  tension: 'CORE1-TENSION-1.0.0',
  weakness: 'CORE1-WEAKNESS-1.0.0',
});
const GAP = { close: 2, clear: 8 };      // 表示点の差。人口規準ではない（候補版）
const DEV_MIN = 15;                       // 型との違いとして語る最小差（表示点）
// 中立と中央域（CORE1-NEUTRAL-1.0.0）：P/S は 50、VALUES は centered 0 を neutral（方向なし）とする。
// 核・支える軸の候補は「強い側」にある軸だけ：P/S は 35以下または65以上、VALUES は |centered| >= 8。
const NEUTRAL = Object.freeze({ version: 'CORE1-NEUTRAL-1.0.0', ps_neutral: 50, v_neutral: 0, ps_low_max: 35, ps_high_min: 65, v_abs_min: 8, eps: 1e-9 });
const LAYER_OF = {};
['O', 'C', 'E', 'A', 'N'].forEach((a) => { LAYER_OF[a] = 'personality'; });
['AGY', 'REL', 'ROL', 'REF', 'AUT'].forEach((a) => { LAYER_OF[a] = 'style'; });
['SD', 'ST', 'HE', 'AC', 'PO', 'SE', 'CO', 'TR', 'BE', 'UN'].forEach((a) => { LAYER_OF[a] = 'values'; });
const KIND_LAYER = { element: 'personality', weapon: 'style', nation: 'values' };

function makeJudge(snap) {
  const A = snap.axes;
  const av = (ax) => A[LAYER_OF[ax]][ax];
  const vc = (ax) => snap.values_centered[ax];
  const isV = (ax) => LAYER_OF[ax] === 'values';
  const userCentered = {};
  const VA = Object.keys(A.values);
  const vMean = VA.reduce((s, k) => s + A.values[k], 0) / VA.length;
  VA.forEach((k) => { userCentered[k] = A.values[k] - vMean; });
  // 本人の側：P/S は 50 を境に、VALUES は centered の符号で（回答尺度ではなく表示値の centered を使う）
  // 本人の側：ちょうど 50（VALUES は centered 0）は 'neutral'。どちらの側にも数えない
  const sideOfValue = (v, isValues) => { const c = isValues ? v : v - 50; return Math.abs(c) < NEUTRAL.eps ? 'neutral' : c > 0 ? 'hi' : 'lo'; };
  const side = (ax) => sideOfValue(isV(ax) ? userCentered[ax] : av(ax), isV(ax));
  // 帯：P/S は 65/35、VALUES は centered ±8
  const band = (ax) => {
    if (isV(ax)) { const c = userCentered[ax]; return c >= NEUTRAL.v_abs_min ? 'high' : c <= -NEUTRAL.v_abs_min ? 'low' : 'mid'; }
    const v = av(ax); return v >= NEUTRAL.ps_high_min ? 'high' : v <= NEUTRAL.ps_low_max ? 'low' : 'mid';
  };
  const strong = (ax) => band(ax) !== 'mid';

  function cond(expr) {
    const m = /^(vc:)?([A-Z]+)(>=|<=)(-?[\d.]+)$/.exec(expr);
    if (!m) throw new Error('bad rule condition ' + expr);
    const val = m[1] ? vc(m[2]) : av(m[2]);
    const lim = Number(m[4]);
    const ok = m[3] === '>=' ? val >= lim : val <= lim;
    // 余裕（どれだけ条件を超えているか）。P/S と VALUES を同じ尺度にするため VALUES は25倍（回答1点＝表示25点）
    const margin = (m[3] === '>=' ? val - lim : lim - val) * (m[1] ? 25 : 1);
    return { ok, margin, path: m[1] ? `values_centered.${m[2]}` : `axes.${LAYER_OF[m[2]]}.${m[2]}`, value: val };
  }
  function matchRule(rule) {
    const cs = rule.when.map(cond);
    return { ok: cs.every((c) => c.ok), strength: cs.reduce((s, c) => s + Math.max(0, c.margin), 0), evidence: cs.map((c) => ({ path: c.path, value: c.value })) };
  }

  // カテゴリ行の「型との差」を軸ごとに（P/S は表示値、VALUES は表示値の centered どうし）
  function protoDiffs(kind, row) {
    const ev = row.evidence;
    if (kind === 'nation') return ev.map((e) => ({ axis: e.axis, user: e.userCentered, proto: e.protoCentered, absDiff: Math.abs(e.userCentered - e.protoCentered),
      userSide: sideOfValue(e.userCentered, true), protoSide: e.protoCentered >= 0 ? 'hi' : 'lo', contribution: e.contribution, band: band(e.axis) }));
    return ev.map((e) => ({ axis: e.axis, user: e.user, proto: e.prototype, absDiff: e.absDiff, userSide: sideOfValue(e.user, false), protoSide: e.prototype >= 50 ? 'hi' : 'lo', band: band(e.axis) }));
  }

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
  function deviationOf(kind, row) {
    const ds = protoDiffs(kind, row).filter((d) => d.userSide !== 'neutral' && d.userSide !== d.protoSide && d.absDiff >= DEV_MIN);
    ds.sort((a, b) => b.absDiff - a.absDiff);
    return ds[0] || null;
  }
  // 型と同じ側で、差が最も小さい意味のある軸（共通点）
  function sharedOf(kind, row) {
    const ds = protoDiffs(kind, row).filter((d) => d.userSide === d.protoSide && (kind === 'nation' ? Math.abs(d.proto) >= 8 : Math.abs(d.proto - 50) >= 10));
    ds.sort((a, b) => a.absDiff - b.absDiff);
    return ds[0] || null;
  }
  function gapState(row, dir) {
    const g = dir === 'next' ? row.gapToNext : row.gapToPrev;
    if (!g) return null;
    return { display: g.display, raw: g.raw, state: g.display <= GAP.close ? 'close' : g.display >= GAP.clear ? 'clear' : 'moderate', rule_id: RULES.gapLabels };
  }

  // 人物との差（P/S は表示値、VALUES は centered どうし）
  function charDiffs(ch) {
    const out = [];
    ['personality', 'style'].forEach((L) => Object.keys(A[L]).forEach((ax) => {
      const u = A[L][ax], c = ch[L][ax];
      out.push({ axis: ax, layer: L, user: u, char: c, absDiff: Math.abs(u - c), userSide: sideOfValue(u, false), userBand: band(ax), charSide: c >= 50 ? 'hi' : 'lo', meaningful: Math.abs(u - 50) >= 10 && Math.abs(c - 50) >= 10 });
    }));
    const cm = VA.reduce((s, k) => s + ch.values[k], 0) / VA.length;
    VA.forEach((ax) => {
      const u = userCentered[ax], c = ch.values[ax] - cm;
      out.push({ axis: ax, layer: 'values', user: u, char: c, absDiff: Math.abs(u - c), userSide: sideOfValue(u, true), userBand: band(ax), charSide: c >= 0 ? 'hi' : 'lo', meaningful: Math.abs(u) >= 8 && Math.abs(c) >= 8 });
    });
    return out;
  }
  function charCommon(ch, k = 2) {
    const ds = charDiffs(ch).filter((d) => d.userSide === d.charSide && d.meaningful);
    ds.sort((a, b) => (a.absDiff - b.absDiff) || a.axis.localeCompare(b.axis));
    return ds.slice(0, k);
  }
  function charDifference(ch) {
    const ds = charDiffs(ch).filter((d) => d.layer !== 'values');
    ds.sort((a, b) => (b.absDiff - a.absDiff) || a.axis.localeCompare(b.axis));
    return ds[0];
  }
  // 中心化した山（最上位）と谷（最下位）
  function shapeOf(obj) {
    const ks = Object.keys(obj); const m = ks.reduce((s, k) => s + obj[k], 0) / ks.length;
    const c = ks.map((k) => ({ axis: k, c: obj[k] - m })).sort((a, b) => (b.c - a.c) || a.axis.localeCompare(b.axis));
    return { peak: c[0], valley: c[c.length - 1], centered: Object.fromEntries(c.map((x) => [x.axis, x.c])) };
  }
  function sharedShape(ch) {
    return ['personality', 'style', 'values'].map((L) => {
      const u = shapeOf(A[L]), c = shapeOf(ch[L]);
      return { layer: L, peak: u.peak.axis, valley: u.valley.axis, peakShared: c.centered[u.peak.axis] > 0, valleyShared: c.centered[u.valley.axis] < 0 };
    });
  }

  return { snap, NEUTRAL, strong, sideOfValue, av, vc, side, band, isV, userCentered, cond, matchRule, protoDiffs, coreOf, deviationOf, sharedOf, gapState, charDiffs, charCommon, charDifference, shapeOf, sharedShape };
}

module.exports = { makeJudge, NEUTRAL, RULES, LAYER_OF, KIND_LAYER, GAP, DEV_MIN };
