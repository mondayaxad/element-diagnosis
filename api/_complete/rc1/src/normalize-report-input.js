// normalize-report-input.js — 入力データ契約（指示書§6）の検証。欠損を0で補わない。
'use strict';
const { EXPECTED_VERSIONS } = require('./engine');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function fail(errors) { const e = new Error('invalid report input: ' + errors.join('; ')); e.validationErrors = errors; throw e; }

function normalizeReportInput(input, engine) {
  const errors = [];
  if (!input || typeof input !== 'object') fail(['input must be an object']);
  for (const k of ['session_id', 'display_name']) if (typeof input[k] !== 'string' || !input[k].trim()) errors.push(`${k} must be a non-empty string`);
  for (const k of ['diagnosed_at', 'generated_at']) if (typeof input[k] !== 'string' || !ISO.test(input[k])) errors.push(`${k} must be ISO-8601`);
  // 回答：Q001〜Q100 が一度ずつ、整数 -2..2 の時だけ受理（正本 validateAnswersV2 で判定）
  if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers)) errors.push('answers must be an object keyed by item id');
  else {
    const v = engine.E.validateAnswersV2(input.answers, engine.Q);
    if (!v.valid) v.errors.forEach((x) => errors.push(`answers.${x.type}: ${x.items.slice(0, 5).join(',')}${x.items.length > 5 ? '…' : ''}`));
  }
  const vers = input.versions || {};
  Object.keys(EXPECTED_VERSIONS).forEach((k) => { if (vers[k] !== EXPECTED_VERSIONS[k]) errors.push(`versions.${k} must be ${EXPECTED_VERSIONS[k]} (got ${vers[k]})`); });
  const g = input.mentor_goal;
  if (g !== null && g !== undefined) {
    if (typeof g !== 'object') errors.push('mentor_goal must be null or an object');
    else {
      if (typeof g.goal_id !== 'string' || !g.goal_id) errors.push('mentor_goal.goal_id required');
      if (typeof g.label !== 'string' || !g.label) errors.push('mentor_goal.label required');
      if (!['user', 'fixture'].includes(g.selected_by)) errors.push('mentor_goal.selected_by must be "user" or "fixture"');
      if (typeof g.selected_at !== 'string' || !ISO.test(g.selected_at)) errors.push('mentor_goal.selected_at must be ISO-8601');
      if (!g.deltas || typeof g.deltas !== 'object' || !Object.keys(g.deltas).length) errors.push('mentor_goal.deltas required');
    }
  }
  if (errors.length) fail(errors);
  return {
    session_id: input.session_id, display_name: input.display_name, diagnosed_at: input.diagnosed_at, generated_at: input.generated_at,
    answers: Object.fromEntries(engine.Q.map((q) => [q.id, input.answers[q.id]])),
    versions: { ...EXPECTED_VERSIONS },
    mentor_goal: g ? JSON.parse(JSON.stringify(g)) : null,
  };
}
module.exports = { normalizeReportInput };
