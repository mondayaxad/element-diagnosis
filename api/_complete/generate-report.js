// api/_complete/generate-report.js
// 完全解析（COMPLETE-RC1 candidate）の46ページ HTML をサーバーで生成する。Vercel の独立した関数ではない（_ で始まるため）。
// まだどの API からも呼ばない（Storage・生成ジョブの工程で接続する）。販売は閉じたまま（RC1 candidate / sales closed）。
//
//   generateCompleteReport(input) → { html, bytes, sha256, inputSha256, pages, templateVersion, contentVersion, ... }
//
// 入力（サーバーが DB から取得したものだけ。下の INPUT_KEYS 以外の項目があれば生成しない）
//   answers           diagnosis_answers.answers_v2（Q001〜Q100 → -2..2 の整数）
//   encodedAnswers    diagnosis_answers.encoded_answers（answers を正本で符号化したものと一致すること）
//   savedScores       diagnosis_results.v2_scores（personality・style・values・valuesCentered）
//   savedRankings     diagnosis_results.v2_rankings（element・weapon・nation の順位）
//   mirrorSnapshot    diagnosis_results.mirror_snapshot（選ばれた MIRROR を含む上位）
//   versions          RC1 の6つの版（diagnosis_sessions・diagnosis_results の値）
//   mentorGoal        { goalId, goalCatalogVersion, selectedAt }（注文に固定した MENTOR 目標）
//   diagnosedAt       diagnosis_sessions.completed_at
//
// 方針
//   ・数値は正本エンジン（rc1/vendor/eti-js。リポジトリの js/ と同一であることを MANIFEST で確かめる）で回答から算出し直し、
//     保存済みのスコア・順位・MIRROR と一致しなければ生成しない（保存値とレポートが食い違わない）。
//   ・本文の呼称は「あなた」。メール・本名・表示名・Stripe ID・user ID・記録 ID・診断コードは入力に無く、HTML にも出さない。
//   ・同じ入力・同じ素材からは常に同じ HTML（バイト単位で同じ SHA-256）。現在時刻・乱数を本文に入れない
//     （生成日時は DB のメタデータ側に持つ）。
//   ・出力の検査に1つでも通らなければ例外（理由コード）で止める：46ページ・順序、script・イベント属性・外部 URL・
//     未置換の記号・識別子の混入、画像の重複、CSP、最大サイズ。
'use strict';
const crypto = require('crypto');
const { calculateResult, REPORT_CONTENT_VERSION, REPORT_TEMPLATE_VERSION } = require('./rc1/src/calculate-result');
const { buildClaims } = require('./rc1/src/build-claims');
const { loadContent } = require('./rc1/src/content-store');
const { render, TOTAL, CSP } = require('./rc1/src/templates/report-46p');
const { loadEngine, EXPECTED_VERSIONS } = require('./rc1/src/engine');
const MENTOR_GOALS = require('./rc1/src/content/mentor-goals.json');
const CE = require('../../lib/complete-eligibility');
const CP = require('../../lib/complete-payment');

const GENERATOR_RELEASE = 'COMPLETE-RC1';
const RELEASE_STATUS = 'RC1 candidate / sales closed';
const MAX_HTML_BYTES = 1536 * 1024; // 1.5 MiB（代表例は約 0.75 MiB。画像は承認済みの JPEG を data: で埋め込む）
const INPUT_KEYS = ['answers', 'encodedAnswers', 'savedScores', 'savedRankings', 'mirrorSnapshot', 'versions', 'mentorGoal', 'diagnosedAt'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
// DB の版の列名 → 正本エンジンの版の名前
const VERSION_FIELDS = Object.freeze({
  diagnosis_version: 'diagnosis', item_set_version: 'items', scoring_version: 'scoring',
  translation_model_version: 'translation', character_profile_version: 'characters', mirror_model_version: 'mirror',
});

class ReportGenerationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const stop = (code) => { throw new ReportGenerationError(code); };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// 診断日：保存済みの completed_at を Asia/Tokyo へ（lib/complete-payment.js の jstIso）。テンプレートは日付部分（YYYY-MM-DD）だけを出す。
// 入力ハッシュに入れる日付（CP.jstDate）も同じ jstIso から作るため、HTML の日付とハッシュの日付は必ず一致する。
function toJstIso(value) {
  const iso = CP.jstIso(value);
  if (!iso) stop('invalid_diagnosed_at');
  return iso;
}

function mentorGoalOf(goal) {
  if (!goal || typeof goal !== 'object' || Array.isArray(goal)) stop('mentor_goal_required');
  const keys = Object.keys(goal).sort().join(',');
  if (keys !== 'goalCatalogVersion,goalId,selectedAt') stop('invalid_mentor_goal');
  if (goal.goalCatalogVersion !== CE.MENTOR_CATALOG_VERSION || MENTOR_GOALS.version !== CE.MENTOR_CATALOG_VERSION) stop('mentor_catalog_mismatch');
  if (!CE.isMentorGoalId(goal.goalId)) stop('unknown_mentor_goal');
  const g = MENTOR_GOALS.goals.find((x) => x.goal_id === goal.goalId);
  if (!g) stop('unknown_mentor_goal');
  if (typeof goal.selectedAt !== 'string' || !ISO_RE.test(goal.selectedAt)) stop('invalid_mentor_goal');
  // 目標の文言と動かす軸はサーバーのカタログから取る（入力の文言は受け取らない）
  return { goal_id: g.goal_id, label: g.label, selected_by: 'user', selected_at: goal.selectedAt, deltas: { ...g.deltas } };
}

function versionsOf(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) stop('invalid_versions');
  if (Object.keys(v).sort().join(',') !== Object.keys(VERSION_FIELDS).sort().join(',')) stop('invalid_versions');
  for (const [dbKey, engineKey] of Object.entries(VERSION_FIELDS)) {
    if (v[dbKey] !== CE.RC1_REQUIRED_VERSIONS[dbKey] || v[dbKey] !== EXPECTED_VERSIONS[engineKey]) stop('version_mismatch');
  }
  return Object.fromEntries(Object.entries(VERSION_FIELDS).map(([dbKey, engineKey]) => [engineKey, v[dbKey]]));
}

const sameNumber = (a, b) => typeof a === 'number' && typeof b === 'number' && a === b;
function sameAxes(saved, computed) {
  if (!saved || typeof saved !== 'object') return false;
  const keys = Object.keys(computed);
  return Object.keys(saved).length === keys.length && keys.every((k) => sameNumber(saved[k], computed[k]));
}
const namesOf = (rows) => (Array.isArray(rows) ? rows.map((r) => (r && typeof r.name === 'string' ? r.name : null)) : null);

// 保存済みの結果（ブラウザが保存したもの）と、回答から正本で算出し直した結果が一致することを確かめる
function verifySaved(input, eng) {
  if (eng.E.encodeAnswersV2(input.answers, eng.Q) !== input.encodedAnswers) stop('saved_code_mismatch');
  const res = eng.E.computeResultsV2(input.answers, { questions: eng.Q, meta: eng.META, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
  const s = input.savedScores;
  if (!s || typeof s !== 'object' || !sameAxes(s.personality, res.personality) || !sameAxes(s.style, res.style)
      || !sameAxes(s.values, res.values) || !sameAxes(s.valuesCentered, res.valuesCentered)) stop('saved_scores_mismatch');
  const r = input.savedRankings;
  const same = (a, b) => JSON.stringify(namesOf(a)) === JSON.stringify(namesOf(b));
  if (!r || typeof r !== 'object' || !same(r.element, res.elementRanking) || !same(r.weapon, res.weaponRanking) || !same(r.nation, res.nationRanking)) {
    stop('saved_rankings_mismatch');
  }
  const mir = eng.resolver.computeMirror(res, EXPECTED_VERSIONS.mirror);
  const saved = eng.resolver.mirrorFromSnapshot(input.mirrorSnapshot);
  if (!saved || saved.selected !== true || saved.name !== mir.mirror.name) stop('saved_mirror_mismatch');
  const sel = saved.selection || {};
  if (sel.mirror_model_version !== EXPECTED_VERSIONS.mirror || sel.character_profile_version !== EXPECTED_VERSIONS.characters) stop('saved_mirror_mismatch');
}

// 入力のハッシュ（complete_reports.input_sha256 と同じ規則。lib/complete-payment.js）
function reportInputSha256(input) {
  return CP.inputSha256({
    encodedAnswers: input.encodedAnswers,
    result: input.versions,
    mentorGoalCatalogVersion: input.mentorGoal && input.mentorGoal.goalCatalogVersion,
    mentorGoalId: input.mentorGoal && input.mentorGoal.goalId,
    diagnosedDate: CP.jstDate(input.diagnosedAt),
  });
}

// ---- 出力の検査
const FORBIDDEN_MARKUP = [
  [/<script\b/i, 'script'], [/<\/script/i, 'script'], [/<iframe\b/i, 'iframe'], [/<frame\b/i, 'iframe'], [/<object\b/i, 'object'],
  [/<embed\b/i, 'object'], [/<form\b/i, 'form'], [/<input\b/i, 'form'], [/<button\b/i, 'form'], [/<link\b/i, 'link'], [/<base\b/i, 'base'],
  [/<meta[^>]+http-equiv=["']?refresh/i, 'refresh'], [/\son[a-z]+\s*=/i, 'event_handler'], [/javascript:/i, 'javascript_url'],
  [/@import/i, 'css_import'], [/@font-face/i, 'font_face'], [/\b(src|href|srcset|action|poster|data)\s*=\s*["']?(https?:)?\/\//i, 'external_url'],
  [/url\(\s*["']?(https?:)?\/\//i, 'external_url'], [/https?:\/\//i, 'external_url'],
];
const PLACEHOLDERS = [/\$\{/, /\{\{/, /\}\}/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, />\s*null\s*</, /TODO|TBD|FIXME|lorem/i, /サンプル用の仮/];
const IDENTIFIERS = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'uuid'], [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email'],
  [/\b(cs|pi|ch|py|re|du|evt|cus|sub|in|price|prod)_(test|live)_[A-Za-z0-9]/, 'stripe_id'], [/\b(cs|pi|ch|du|evt)_[A-Za-z0-9]{14,}/, 'stripe_id'],
];

function inspectHtml(html, input) {
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_HTML_BYTES) stop('html_too_large');
  if (!html.startsWith('<!DOCTYPE html>\n<html lang="ja">')) stop('html_shape');
  if ((html.match(/<meta http-equiv="Content-Security-Policy"/g) || []).length !== 1 || !html.includes(`content="${CSP}"`)) stop('csp_missing');
  for (const [re, code] of FORBIDDEN_MARKUP) if (re.test(html)) stop(`forbidden_${code}`);
  // 文字の検査は画像（data: の base64）を除いた本文で行う（base64 の中の偶然の並びで誤検出しない）
  const text = html.replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, 'data:image/jpeg;base64,');
  for (const re of PLACEHOLDERS) if (re.test(text)) stop('unreplaced_placeholder');
  for (const [re, code] of IDENTIFIERS) if (re.test(text)) stop(`identifier_${code}`);
  if (text.includes(input.encodedAnswers)) stop('identifier_diagnosis_code');
  // 画像：<img> は使わない。data: の JPEG を CSS の --img-N に1回ずつ定義し、使う所は var(--img-N) で参照する
  if (/<img\b/i.test(html)) stop('image_not_inline');
  // data: の URI（CSP の "img-src data:" は MIME が無いので含まない）
  const uris = [...html.matchAll(/data:[a-z]+\/[^"')\s]+/gi)].map((m) => m[0]);
  if (uris.some((u) => !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u))) stop('image_not_inline');
  if (new Set(uris).size !== uris.length) stop('image_duplicated');
  const defined = new Set([...html.matchAll(/--img-(\d+):url\("data:image\/jpeg;base64,/g)].map((m) => m[1]));
  const used = new Set([...html.matchAll(/var\(--img-(\d+)\)/g)].map((m) => m[1]));
  if (defined.size !== uris.length || [...used].some((n) => !defined.has(n)) || [...defined].some((n) => !used.has(n))) stop('image_reference');
  // 46ページ・順序
  const pages = [...html.matchAll(/<section class="page [^"]*" id="p(\d{2})" data-page="(\d+)" aria-label="P(\d{2})"/g)];
  if (pages.length !== TOTAL) stop('page_count');
  pages.forEach((m, i) => { const n = i + 1; if (Number(m[1]) !== n || Number(m[2]) !== n || Number(m[3]) !== n) stop('page_order'); });
  if ((html.match(/<section\b/g) || []).length !== TOTAL) stop('page_count');
  return { bytes, pages: pages.length };
}

function generateCompleteReport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) stop('invalid_input');
  const extra = Object.keys(raw).filter((k) => !INPUT_KEYS.includes(k));
  const missing = INPUT_KEYS.filter((k) => !(k in raw));
  if (extra.length || missing.length) stop('invalid_input');
  const eng = loadEngine();
  const versions = versionsOf(raw.versions);
  const mentorGoal = mentorGoalOf(raw.mentorGoal);
  const diagnosedAt = toJstIso(raw.diagnosedAt);
  if (!raw.answers || typeof raw.answers !== 'object' || Array.isArray(raw.answers)) stop('invalid_answers');
  if (!eng.E.validateAnswersV2(raw.answers, eng.Q).valid || Object.keys(raw.answers).length !== 100) stop('invalid_answers');
  if (typeof raw.encodedAnswers !== 'string' || !raw.encodedAnswers) stop('saved_code_mismatch');
  verifySaved(raw, eng);

  // テンプレートが表示しない識別子の欄は固定値にする（ID・生成日は HTML に出さない）
  const snapshotInput = {
    session_id: 'complete-report', display_name: 'あなた', diagnosed_at: diagnosedAt, generated_at: diagnosedAt,
    answers: Object.fromEntries(eng.Q.map((q) => [q.id, raw.answers[q.id]])), versions, mentor_goal: mentorGoal,
  };
  let html;
  try {
    const snap = calculateResult(snapshotInput);
    html = render(buildClaims(snap), loadContent());
  } catch (err) {
    stop(err && err.stop ? 'generator_stopped' : 'generator_failed');
  }
  const { bytes, pages } = inspectHtml(html, raw);
  return {
    html,
    bytes,
    sha256: sha256(html),
    inputSha256: reportInputSha256(raw),
    pages,
    generatorRelease: GENERATOR_RELEASE,
    releaseStatus: RELEASE_STATUS,
    contentVersion: REPORT_CONTENT_VERSION,
    templateVersion: REPORT_TEMPLATE_VERSION,
    contentSha256: CP.MATERIALS.contentSha256,
    templateSha256: CP.MATERIALS.templateSha256,
  };
}

module.exports = {
  generateCompleteReport, reportInputSha256, inspectHtml, ReportGenerationError,
  GENERATOR_RELEASE, RELEASE_STATUS, MAX_HTML_BYTES, INPUT_KEYS, CSP, TOTAL,
};
