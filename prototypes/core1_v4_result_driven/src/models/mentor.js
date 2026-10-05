// CORE1-MENTOR-1.0.0 — 本人が選んだ方向へ一部の軸だけを動かした目標座標に、正本 MIRROR 式（40/30/30）を適用する。
// 方向（mentor_goal）は本人入力が必須。未入力なら順位を作らない（最下位軸などから自動決定しない）。
'use strict';
const MENTOR_MODEL = Object.freeze({ version: 'CORE1-MENTOR-1.0.0', min: 0, max: 100, topN: 10 });
const LAYER_KEYS = { personality: 'personalityAxes', style: 'styleAxes', values: 'valueAxes' };

function parseDeltaKey(key, meta) {
  const m = /^(personality|style|values)\.([A-Z]+)$/.exec(key);
  if (!m || !meta[LAYER_KEYS[m[1]]].includes(m[2])) throw new Error(`mentor_goal.deltas: unknown axis path ${key}`);
  return { layer: m[1], axis: m[2] };
}

function mentorTarget(user, goal, meta) {
  const target = { personality: { ...user.personality }, style: { ...user.style }, values: { ...user.values } };
  const changes = [];
  Object.keys(goal.deltas).forEach((key) => {
    const { layer, axis } = parseDeltaKey(key, meta);
    const d = goal.deltas[key];
    if (typeof d !== 'number' || !Number.isFinite(d) || d === 0) throw new Error(`mentor_goal.deltas: ${key} must be a non-zero finite number`);
    const before = user[layer][axis];
    const after = Math.max(MENTOR_MODEL.min, Math.min(MENTOR_MODEL.max, before + d));
    target[layer][axis] = after;
    changes.push({ path: key, layer, axis, before, delta: d, after, clamped: after !== before + d });
  });
  const changed = new Set(changes.map((c) => c.axis));
  const all = [...meta.personalityAxes, ...meta.styleAxes, ...meta.valueAxes];
  return { target, changes, unchangedAxes: all.filter((ax) => !changed.has(ax)) };
}

function mentor(user, goal, characters, meta, engine) {
  if (!goal) return { model: MENTOR_MODEL.version, status: 'goal_not_selected', goal: null, ranking: [] };
  if (!goal.deltas || !Object.keys(goal.deltas).length) throw new Error('mentor_goal.deltas is empty');
  const t = mentorTarget(user, goal, meta);
  const ranking = engine.computeMirrorV2(t.target, characters, meta); // 正本式と正本の同率規則（pSim→sSim→vSim→canonical）
  return { model: MENTOR_MODEL.version, status: 'ok', goal, changes: t.changes, unchangedAxes: t.unchangedAxes, target: t.target, ranking };
}

module.exports = { MENTOR_MODEL, mentorTarget, mentor };
