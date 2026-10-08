// calculate-result.js — 100 answers → 正本エンジン → 派生モデル → 不変スナップショット。
// HTML 側では再計算しない。テンプレートへ渡す前に、この1件分のスナップショットを完成させる。
'use strict';
const { loadEngine, displayName, sha256 } = require('./engine');
const { normalizeReportInput } = require('./normalize-report-input');
const { HIDDEN_MODEL, hiddenShape } = require('./models/hidden-shape');
const { MENTOR_MODEL, mentor } = require('./models/mentor');
const { DOMAIN_MODEL, domains } = require('./models/domains');
const { center } = require('./models/vector');

const SNAPSHOT_SCHEMA = 'CORE1-REPORT-SNAPSHOT-1.0.0';
const RANKBAND_MODEL = Object.freeze({ version: 'CORE1-RANKBAND-1.1.0', bands: { element: [3, 2, 2], weapon: [3, 0, 2], nation: [3, 3, 2] } });
const REPORT_CONTENT_VERSION = 'CORE1-CONTENT-1.0.0';
const REPORT_TEMPLATE_VERSION = 'CORE1-TEMPLATE-46P-WEB-1.0.0'; // Web 版（サーバー生成器）。prototypes の版は CORE1-TEMPLATE-46P-1.0.0
const TOP_N = 10;

function deepFreeze(o) { Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }); return Object.freeze(o); }

function bandOf(kind, i, n) {
  const [top, mid] = RANKBAND_MODEL.bands[kind];
  return i < top ? 'top' : i < top + mid ? 'middle' : 'bottom';
}

// 元素・武器種：各軸の二乗誤差（0..1尺度）とその寄与。合計から距離が再現できる。
function distanceEvidence(user, proto, axes) {
  const rows = axes.map((ax) => { const d = user[ax] - proto[ax]; return { axis: ax, user: user[ax], prototype: proto[ax], diff: d, absDiff: Math.abs(d), sq: (d / 100) ** 2 }; });
  const total = rows.reduce((s, r) => s + r.sq, 0);
  rows.forEach((r) => { r.shareOfSquaredError = total ? r.sq / total : 0; });
  return rows;
}
// 国家：centered VALUES の cosine を軸ごとの積へ分解（合計が cosine に一致）。
function cosineEvidence(user, proto, axes) {
  const u = center(user, axes), p = center(proto, axes);
  const nu = Math.sqrt(u.reduce((s, x) => s + x * x, 0)), np = Math.sqrt(p.reduce((s, x) => s + x * x, 0));
  return axes.map((ax, i) => ({ axis: ax, userCentered: u[i], protoCentered: p[i], absDiff: Math.abs(u[i] - p[i]), contribution: nu && np ? (u[i] * p[i]) / (nu * np) : 0 }));
}

function categoryRows(kind, ranking, protos, user, axes, evidenceFn) {
  return ranking.map((r, i) => {
    const prev = ranking[i - 1], next = ranking[i + 1];
    return {
      rank: i + 1, key: r.name, name: displayName(r.name), band: bandOf(kind, i, ranking.length),
      distance: r.distance, display: r.closenessScore,
      cosine: r.cosineSimilarity === undefined ? null : r.cosineSimilarity,
      gapToPrev: prev ? { raw: r.distance - prev.distance, display: prev.closenessScore - r.closenessScore } : null,
      gapToNext: next ? { raw: next.distance - r.distance, display: r.closenessScore - next.closenessScore } : null,
      prototype: { ...protos[r.name] },
      evidence: evidenceFn(user, protos[r.name], axes),
    };
  });
}

function charRow(r, c, meta) {
  return {
    rank: r.rank, name: c.name, canonicalIndex: r.canonicalIndex,
    element: c.element, weapon: c.weapon, region: displayName(c.region || ''),
    basis_tags: [...c.basis_tags], evidence_confidence: c.evidence_confidence, source_url: c.source_url,
    personality: { ...c.personality }, style: { ...c.style }, values: { ...c.values },
    ...r.extra,
  };
}

function calculateResult(rawInput, opts = {}) {
  const eng = loadEngine(opts.repoRoot);
  const input = normalizeReportInput(rawInput, eng);
  const meta = eng.META;
  const res = eng.E.computeResultsV2(input.answers, { questions: eng.Q, meta, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
  const user = { personality: res.personality, style: res.style, values: res.values };
  const axisValue = (ax) => user.personality[ax] ?? user.style[ax] ?? user.values[ax];

  // MIRROR：正本 resolver の .mirror と .selectionMeta を使う（rankings[0] を MIRROR と決めつけない）
  const mir = eng.resolver.computeMirror(res, 'ETI-MIRROR-2.1.0');
  const C = eng.CHARS;
  const mirrorTop = mir.rankings.slice(0, TOP_N).map((r, i) => charRow({ rank: i + 1, canonicalIndex: r.canonicalIndex,
    extra: { raw: r.mirrorScoreRaw, display: r.mirrorScore, pSim: r.pSim, sSim: r.sSim, vSim: r.vSim, selected: r.canonicalIndex === mir.mirror.canonicalIndex } }, C[r.canonicalIndex], meta));
  const selRank = mir.rankings.findIndex((r) => r.canonicalIndex === mir.mirror.canonicalIndex) + 1;

  const hid = hiddenShape(user, C, meta).slice(0, TOP_N).map((r, i) => charRow({ rank: i + 1, canonicalIndex: r.canonicalIndex,
    extra: { raw: r.raw, display: r.display, Pshape: r.Pshape, Sshape: r.Sshape, Vshape: r.Vshape } }, C[r.canonicalIndex], meta));

  const men = mentor(user, input.mentor_goal, C, meta, eng.E);
  const mentorBlock = men.status !== 'ok' ? { model: MENTOR_MODEL.version, status: men.status, goal: null, top10: [] } : {
    model: MENTOR_MODEL.version, status: 'ok', goal: men.goal, changes: men.changes, unchangedAxes: men.unchangedAxes, target: men.target,
    top10: men.ranking.slice(0, TOP_N).map((r, i) => charRow({ rank: i + 1, canonicalIndex: r.canonicalIndex,
      extra: { raw: r.mirrorScoreRaw, display: r.mirrorScore, pSim: r.pSim, sSim: r.sSim, vSim: r.vSim } }, C[r.canonicalIndex], meta)),
  };

  const valuesFlat = meta.valueAxes.every((ax) => res.valuesCentered[ax] === 0);
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    session_id: input.session_id, display_name: input.display_name, diagnosed_at: input.diagnosed_at, generated_at: input.generated_at,
    answers_hash: 'sha256:' + sha256(eng.Q.map((q) => q.id + '=' + input.answers[q.id]).join(';')),
    diagnosis_code: eng.E.encodeAnswersV2(input.answers, eng.Q),
    versions: {
      ...input.versions,
      hidden: HIDDEN_MODEL.version, mentor: MENTOR_MODEL.version, domain: DOMAIN_MODEL.version, rankband: RANKBAND_MODEL.version,
      report_content_version: REPORT_CONTENT_VERSION, report_template_version: REPORT_TEMPLATE_VERSION,
    },
    axes: { personality: { ...res.personality }, style: { ...res.style }, values: { ...res.values } },
    values_centered: { ...res.valuesCentered },
    values_flat: valuesFlat,
    rankings: {
      element: categoryRows('element', res.elementRanking, eng.EP, res.personality, meta.personalityAxes, distanceEvidence),
      weapon: categoryRows('weapon', res.weaponRanking, eng.WP, res.style, meta.styleAxes, distanceEvidence),
      nation: categoryRows('nation', res.nationRanking, eng.NP, res.values, meta.valueAxes, cosineEvidence),
    },
    rankband_rule: RANKBAND_MODEL,
    mirror: { model: mir.mirrorModelVersion, characterProfileVersion: mir.characterProfileVersion, top10: mirrorTop,
      selected: { name: mir.mirror.name, canonicalIndex: mir.mirror.canonicalIndex, rawRank: selRank }, selectionMeta: JSON.parse(JSON.stringify(mir.selectionMeta)),
      weights: { P: 0.40, S: 0.30, V: 0.30 } },
    hidden: { model: HIDDEN_MODEL.version, weights: { ...HIDDEN_MODEL.weights }, tieBreak: 'raw → Pshape → Sshape → Vshape → canonicalIndex', top10: hid },
    mentor: mentorBlock,
    domains: { model: DOMAIN_MODEL.version, excludedAxes: [...DOMAIN_MODEL.excludedAxes], items: domains(axisValue) },
    engine_provenance: eng.provenance,
  };
  return deepFreeze(snapshot);
}

module.exports = { calculateResult, SNAPSHOT_SCHEMA, RANKBAND_MODEL, REPORT_CONTENT_VERSION, REPORT_TEMPLATE_VERSION };
