// lib/complete-report-job.js
// 完全解析レポートの生成ジョブ（支払い後の queued → 生成 → 非公開 Storage へ保存 → ready）と、閲覧用の短時間トークン。
// API（api/stripe-webhook.js・api/complete-status.js）からだけ使う。静的には公開しない。
//
//   ・生成は complete_06 の SQL 関数で1行ごとに貸し出し（lease）を取って行う。同時に呼ばれても1つだけが生成する。
//   ・保存先は非公開 bucket（complete-reports）の reports/<report_id>/<試行回数>-<乱数32桁>.html。
//     取得のたびに reports/<report_id>/ の下を消してから保存する（中断した試行の残りを残さない）。
//     ready にするのは保存の成功後だけ（complete_finish_report）。lease を失った・revoked になった・失敗した時は保存した物を消す。
//   ・生成の入力は DB の保存値だけ（api/_complete/generate-report.js）。生成した入力ハッシュ・素材ハッシュが
//     complete_reports に凍結した値と違えば生成しない（再試行もしない）。
//   ・閲覧トークン：AES-256-GCM で暗号化した { report_id・user_id・記録 ID・期限 }（300秒）。中身は読めず、改ざんできない。
//     閲覧のたびに DB で権利を確かめる（complete_report_for_view）。保存先・注文 ID・user ID を応答・ログに出さない。
//   ・ログは理由コードと照合 ID だけ。
'use strict';
const crypto = require('crypto');
const CE = require('./complete-eligibility');
const CP = require('./complete-payment');

const BUCKET = 'complete-reports';
const VIEW_TTL_SEC = 300;
const LEASE_SECONDS = 120;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const OBJECT_KEY_RE = /^reports\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{1,2})-([0-9a-f]{32})\.html$/;
const VIEW_TOKEN_RE = /^[A-Za-z0-9_-]{60,400}$/;

// 生成器は使う時に初めて読み込む（状態確認だけの要求では読み込まない）
let generatorModule = null;
function generator() {
  if (!generatorModule) generatorModule = require('../api/_complete/generate-report');
  return generatorModule;
}

// ---- 非公開 Storage（Supabase Storage の REST。サーバー用キーだけで使う）
function storageClient(conn, fetchImpl) {
  const base = `${conn.supabaseUrl}/storage/v1`;
  const enc = (key) => key.split('/').map(encodeURIComponent).join('/');
  const call = async (url, opts) => {
    let res;
    try {
      res = await fetchImpl(url, opts);
    } catch {
      throw new CP.PaymentError('storage_unavailable', true);
    }
    return res;
  };
  return {
    async upload(key, body) {
      const res = await call(`${base}/object/${BUCKET}/${enc(key)}`, {
        method: 'POST',
        headers: Object.assign({}, conn.adminHeaders(), { 'Content-Type': 'text/html; charset=utf-8', 'x-upsert': 'false', 'cache-control': 'no-store' }),
        body,
      });
      if (!res.ok) throw new CP.PaymentError(res.status >= 500 || res.status === 429 ? 'storage_unavailable' : 'storage_rejected', res.status >= 500 || res.status === 429);
    },
    async list(prefix) {
      const res = await call(`${base}/object/list/${BUCKET}`, {
        method: 'POST',
        headers: Object.assign({}, conn.adminHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
      });
      if (!res.ok) throw new CP.PaymentError('storage_unavailable', true);
      const rows = await res.json().catch(() => null);
      if (!Array.isArray(rows)) throw new CP.PaymentError('storage_unavailable', true);
      return rows.map((r) => (r && typeof r.name === 'string' ? `${prefix}/${r.name}` : null)).filter(Boolean);
    },
    async remove(keys) {
      if (!keys.length) return;
      const res = await call(`${base}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: Object.assign({}, conn.adminHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: keys }),
      });
      if (!res.ok) throw new CP.PaymentError('storage_unavailable', true);
    },
    async download(key) {
      const res = await call(`${base}/object/authenticated/${BUCKET}/${enc(key)}`, { headers: conn.adminHeaders() });
      if (res.status === 404 || res.status === 400) throw new CP.PaymentError('storage_object_missing', false);
      if (!res.ok) throw new CP.PaymentError('storage_unavailable', true);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_REPORT_BYTES) throw new CP.PaymentError('storage_object_too_large', false);
      return buf;
    },
  };
}

function objectKey(reportId, attempt) {
  return `reports/${reportId}/${attempt}-${crypto.randomBytes(16).toString('hex')}.html`;
}

// ---- 生成の入力（サーバーが DB から読む保存値だけ）
async function loadGenerationInput(fetchImpl, conn, reportId) {
  const rid = encodeURIComponent(reportId);
  const reports = await CP.selectRows(fetchImpl, conn, `complete_reports?id=eq.${rid}&select=id,user_id,diagnosis_session_id,source_order_id,` +
    'status,input_sha256,content_sha256,template_sha256,content_version,template_version,mentor_goal_catalog_version,mentor_goal_id,' +
    'diagnosis_version,item_set_version,scoring_version,translation_model_version,character_profile_version,mirror_model_version');
  const report = reports[0];
  if (!report) throw new CP.PaymentError('report_not_found', false);
  const sid = encodeURIComponent(report.diagnosis_session_id);
  const [orders, sessions, answers, results] = await Promise.all([
    CP.selectRows(fetchImpl, conn, `complete_orders?id=eq.${encodeURIComponent(report.source_order_id)}&select=mentor_goal_selected_at,mentor_goal_id,mentor_goal_catalog_version`),
    CP.selectRows(fetchImpl, conn, `diagnosis_sessions?id=eq.${sid}&select=completed_at,user_id`),
    CP.selectRows(fetchImpl, conn, `diagnosis_answers?session_id=eq.${sid}&select=answers_v2,encoded_answers`),
    CP.selectRows(fetchImpl, conn, `diagnosis_results?session_id=eq.${sid}&select=diagnosis_version,item_set_version,scoring_version,` +
      'translation_model_version,character_profile_version,mirror_model_version,v2_scores,v2_rankings,mirror_snapshot'),
  ]);
  const order = orders[0];
  const session = sessions[0];
  const answer = answers[0];
  const result = results[0];
  if (!order || !session || !answer || !result || session.user_id !== report.user_id) throw new CP.PaymentError('record_data_missing', false);
  const versions = Object.fromEntries(Object.keys(CE.RC1_REQUIRED_VERSIONS).map((k) => [k, result[k]]));
  for (const k of Object.keys(versions)) if (versions[k] !== report[k]) throw new CP.PaymentError('frozen_versions_mismatch', false);
  if (order.mentor_goal_id !== report.mentor_goal_id || order.mentor_goal_catalog_version !== report.mentor_goal_catalog_version) {
    throw new CP.PaymentError('frozen_goal_mismatch', false);
  }
  return {
    report,
    input: {
      answers: answer.answers_v2,
      encodedAnswers: answer.encoded_answers,
      savedScores: result.v2_scores,
      savedRankings: result.v2_rankings,
      mirrorSnapshot: result.mirror_snapshot,
      versions,
      mentorGoal: { goalId: report.mentor_goal_id, goalCatalogVersion: report.mentor_goal_catalog_version, selectedAt: new Date(order.mentor_goal_selected_at).toISOString() },
      diagnosedAt: new Date(session.completed_at).toISOString(),
    },
  };
}

// ---- 生成ジョブ1件。戻り値：ready／none（取得できる行が無い）／failed／stopped／lost_lease／revoked
async function processReport({ conn, fetchImpl, storage, reportId = null, logger = console, hooks = {} }) {
  const claimed = await CP.rpc(fetchImpl, conn, 'complete_claim_report', { p_report_id: reportId, p_lease_seconds: LEASE_SECONDS });
  const job = Array.isArray(claimed) ? claimed[0] : null;
  if (!job || !CE.isUuid(job.report_id) || !CE.isUuid(job.lease_token)) return 'none';
  const st = storage || storageClient(conn, fetchImpl);
  const prefix = `reports/${job.report_id}`;
  let uploaded = null;
  const fail = async (code, retryable) => {
    const incident = CE.incidentId();
    CP.logError(logger, 'complete-report', code, incident);
    if (uploaded) { try { await st.remove([uploaded]); uploaded = null; } catch { /* 次の試行の掃除で消す */ } }
    try {
      return await CP.rpc(fetchImpl, conn, 'complete_fail_report', { p_report_id: job.report_id, p_lease_token: job.lease_token, p_error_code: code, p_retryable: retryable });
    } catch {
      return 'failed'; // lease が切れれば再取得される
    }
  };
  try {
    // 中断した試行の残り（同じ report の下）を先に消す
    const stale = await st.list(prefix);
    await st.remove(stale.filter((k) => OBJECT_KEY_RE.test(k)));
    const { report, input } = await loadGenerationInput(fetchImpl, conn, job.report_id);
    const m = CP.MATERIALS;
    if (report.content_sha256 !== m.contentSha256 || report.template_sha256 !== m.templateSha256
        || report.content_version !== m.contentVersion || report.template_version !== m.templateVersion) {
      return await fail('materials_changed', false);
    }
    let out;
    try {
      out = generator().generateCompleteReport(input);
    } catch (err) {
      return await fail(err && err.code ? `gen_${err.code}`.slice(0, 60) : 'gen_failed', false);
    }
    if (out.inputSha256 !== report.input_sha256) return await fail('input_mismatch', false);
    if (hooks.beforeUpload) await hooks.beforeUpload(job);
    const key = objectKey(job.report_id, job.attempt);
    uploaded = key;
    await st.upload(key, Buffer.from(out.html, 'utf8'));
    if (hooks.afterUpload) await hooks.afterUpload(job);
    const done = await CP.rpc(fetchImpl, conn, 'complete_finish_report', {
      p_report_id: job.report_id, p_lease_token: job.lease_token, p_storage_path: key, p_output_sha256: out.sha256,
    });
    if (done === 'ready') return 'ready';
    // lease を失った・revoked：保存した物を消す（ready にはしない）
    try { await st.remove([key]); } catch { /* 次の試行の掃除で消す */ }
    uploaded = null;
    return done === 'revoked' ? 'revoked' : 'lost_lease';
  } catch (err) {
    const code = err instanceof CP.PaymentError ? err.code : 'internal_error';
    const retryable = err instanceof CP.PaymentError ? err.transient : true;
    return fail(code, retryable);
  }
}

// ---- 応答の後で生成を始める（Vercel の waitUntil。使えない環境では何もしない：取り残しは状態確認の時に回収する）
function defaultWaitUntil() {
  try {
    const { waitUntil } = require('@vercel/functions');
    return (p) => { try { waitUntil(p); } catch { /* 文脈が無い */ } };
  } catch {
    return null;
  }
}

function scheduleReport(waitUntil, task, logger = console) {
  if (typeof waitUntil !== 'function') return false;
  const p = Promise.resolve().then(task).catch(() => {
    const incident = CE.incidentId();
    CP.logError(logger, 'complete-report', 'background_failed', incident);
  });
  waitUntil(p);
  return true;
}

// 期限の来た生成（取り残し）か
function isDue(report, now = Date.now()) {
  if (!report) return false;
  if (report.status === 'queued') return true;
  if (report.status === 'failed') return report.attempts < report.max_attempts && report.next_retry_at && Date.parse(report.next_retry_at) <= now;
  if (report.status === 'generating') return report.lease_expires_at && Date.parse(report.lease_expires_at) < now && report.attempts < report.max_attempts;
  return false;
}

// ---- 閲覧トークン（AES-256-GCM。中身は report_id・user_id・記録 ID・期限）
// 秘密値は暗号学的乱数 32バイト以上を base64url（パディングなし・43文字以上）で表したもの
const VIEW_SECRET_RE = /^[A-Za-z0-9_-]{43,}$/;
const VIEW_SECRET_MIN_BYTES = 32;

function viewKey(secret) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'base64url'), Buffer.alloc(0), Buffer.from('complete-view-token-v1'), 32));
}

function viewSecretOk(secret) {
  return typeof secret === 'string' && VIEW_SECRET_RE.test(secret) && Buffer.from(secret, 'base64url').length >= VIEW_SECRET_MIN_BYTES;
}

function issueViewToken(secret, { reportId, userId, sessionId }, nowSec = Math.floor(Date.now() / 1000)) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', viewKey(secret), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ v: 1, r: reportId, u: userId, s: sessionId, e: nowSec + VIEW_TTL_SEC }), 'utf8'), c.final()]);
  return { token: Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url'), expiresAt: nowSec + VIEW_TTL_SEC };
}

function readViewToken(secret, token, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || !VIEW_TOKEN_RE.test(token)) return { ok: false, reason: 'token_malformed' };
  const buf = Buffer.from(token, 'base64url');
  if (buf.length < 12 + 16 + 2) return { ok: false, reason: 'token_malformed' };
  let payload;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', viewKey(secret), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    payload = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'token_invalid' };
  }
  if (!payload || payload.v !== 1 || !CE.isUuid(payload.r) || !CE.isUuid(payload.u) || !CE.isUuid(payload.s) || !Number.isInteger(payload.e)) {
    return { ok: false, reason: 'token_invalid' };
  }
  if (payload.e < nowSec) return { ok: false, reason: 'token_expired' };
  if (payload.e > nowSec + VIEW_TTL_SEC + 5) return { ok: false, reason: 'token_invalid' };
  return { ok: true, reportId: payload.r, userId: payload.u, sessionId: payload.s, expiresAt: payload.e };
}

module.exports = {
  BUCKET, VIEW_TTL_SEC, LEASE_SECONDS, MAX_REPORT_BYTES, OBJECT_KEY_RE,
  storageClient, objectKey, loadGenerationInput, processReport, defaultWaitUntil, scheduleReport, isDue,
  viewSecretOk, issueViewToken, readViewToken,
};
