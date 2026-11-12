// lib/jagan-api.mjs
// 邪眼診断のサーバー処理（保存・公開共有・共有ページ・レポートの購入権限の確認）。api/jagan-*.mjs から使う。
//
// 方針（docs/jagan/spec_v1_0_rc1/API_CONTRACT.md）
//   ・所有者はアクセストークンからサーバーが決める。ブラウザが送る user_id・人物・一致率・購入済みは使わない。
//   ・受け取るのは resultId・itemSetVersion・answers だけ。サーバーが同じ版（jagan/engine）で再計算する。
//     未知の設問 ID・不正な回答・存在しない版は 400。
//   ・保存は同じ本人・同じ resultId なら冪等（重複しない）。別の本人の resultId は 409（上書きしない）。
//   ・公開共有の値は publicSummary（許可リスト）だけ。公開 ID と非公開の resultId を分ける（DB には resultId のハッシュだけ）。
//   ・Production では JAGAN_PRODUCTION_ENABLED=true のときだけ動く（Preview の確認前に本番の DB へ書かない）。
//   ・環境ガード（lib/server-env.js）を Supabase へ接続する前に通す。
import crypto from 'node:crypto';
import serverEnv from './server-env.js';
import { computeDiagnosis, publicSummary, sharePath, ogQuery, OG_DESIGN_VERSION, RESULT_SCHEMA_VERSION, PUBLIC_SUMMARY_KIND } from '../jagan/engine/runtime.mjs';
import { parseOg } from './jagan-og-params.mjs';
import { BUNDLE } from '../jagan/engine/data.mjs';
import { BALANCE_NOTE } from '../jagan/site-copy.mjs';

const { requireServerEnv, requestHost, logEnvDenied } = serverEnv;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const REVOKE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_KEYS = 60;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomId = (bytes) => crypto.randomBytes(bytes).toString('base64url');

// ---- 入力の検査と再計算（DB に接続しない純粋な処理。テストで直接使う） ----
export function recompute(body, bundle = BUNDLE) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' };
  const { resultId, itemSetVersion, answers } = body;
  if (typeof resultId !== 'string' || !UUID_RE.test(resultId)) return { ok: false, error: 'invalid_result_id' };
  if (itemSetVersion !== bundle.items.item_set_version) return { ok: false, error: 'item_set_version_mismatch' };
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length > MAX_BODY_KEYS) {
    return { ok: false, error: 'invalid_answers' };
  }
  try {
    const result = computeDiagnosis({ resultId, itemSetVersion, answers }, bundle);
    return { ok: true, result };
  } catch (e) {
    const msg = String(e && e.message || '');
    // 50問すべて 1〜5 の整数が必要（欠測・補完はしない）。未知の設問・不正な値は 400
    if (/^(invalid_answers|unknown_item_or_version|all_50_answers_required|item_set_version_mismatch)/.test(msg)) return { ok: false, error: msg === 'unknown_item_or_version' ? 'unknown_item_id' : msg === 'all_50_answers_required' ? 'invalid_answer' : msg };
    throw e;
  }
}

// マイページの一覧に出す見出し（保存時の値。後から係数が変わっても書き換えない）
export function headlineOf(result) {
  const ch = result.character.status === 'available' ? result.character : null;
  return {
    element: result.element.label,
    type: result.isou.label,
    code: result.dti ? result.dti.code : null,
    name: result.dti ? result.dti.name : null,
    character: ch ? ch.name : null,
    matchPercent: ch ? ch.match : null,
  };
}

export function shareableSummary(result) {
  try { return publicSummary(result); } catch (e) { return null; }
}

// 公開要約の値を、許可された ID からだけ表示名へ解決する（保存された文字列をそのまま画面・画像へ出さない）
export function resolveSummary(s, bundle = BUNDLE) {
  if (!s || s.kind !== PUBLIC_SUMMARY_KIND || !s.element || !s.isou) return null;
  const el = bundle.core.elements.find((e) => e.id === s.element.id);
  const asp = bundle.dti.aspects.find((a) => a.trait_id === s.isou.id);
  if (!el || !asp) return null;
  const p = bundle.dti.patterns.find((x) => x.element_id === el.id && x.trait_id === asp.trait_id);
  let character = null;
  if (s.character) {
    const c = bundle.characters.characters.find((x) => x.id === s.character.id);
    const m = s.character.matchPercent;
    if (!c || !Number.isInteger(m) || m < 0 || m > 100) return null;
    character = { id: c.id, label: c.name, matchPercent: m };
  }
  return { kind: PUBLIC_SUMMARY_KIND, element: { id: el.id, label: el.label }, isou: { id: asp.trait_id, code: asp.code, label: asp.label }, dti: { code: p.code, name: p.name }, character };
}

// 共有ページ・OGP の URL に載せる値（列挙値と整数だけ）。runtime の shareQuery と同じ（v に呼び名とデザインの版）
export { OG_DESIGN_VERSION };
export function ogParams(summary) {
  return ogQuery({ ...summary, namingVersion: summary.namingVersion || BUNDLE.dti.version });
}
// 共有ページの正規の URL（投稿に載る最短の形 /j/<4文字>）
export function sharePagePath(summary) {
  return sharePath({ ...summary, namingVersion: summary.namingVersion || BUNDLE.dti.version });
}

// ---- HTTP の共通処理 ----
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 32 * 1024) return null; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return null; }
}

function bearer(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return h.startsWith('Bearer ') && h.length > 7 ? h.slice(7) : null;
}

// Production では明示的に有効にしたときだけ動かす（Preview・development は動く）
export function jaganEnabled(env, appEnv) {
  if (appEnv === 'preview' || appEnv === 'development') return true;
  return appEnv === 'production' && env.JAGAN_PRODUCTION_ENABLED === 'true';
}

function guardOr503(env, req, res, api, opts) {
  const guard = requireServerEnv(env, { host: requestHost(req), ...opts });
  if (!guard.ok) {
    const incidentId = logEnvDenied(api, guard);
    send(res, 503, { error: 'service_unavailable', incident_id: incidentId });
    return null;
  }
  if (!jaganEnabled(env, guard.appEnv)) { send(res, 503, { error: 'jagan_not_enabled' }); return null; }
  return guard;
}

function makeDb(conn, fetchImpl) {
  const base = `${conn.supabaseUrl}/rest/v1`;
  return {
    async select(path) {
      const r = await fetchImpl(`${base}/${path}`, { headers: conn.adminHeaders() });
      if (!r.ok) throw new Error(`select_failed_${r.status}`);
      return r.json();
    },
    // 一意制約の衝突は { conflict: true }
    async insert(table, row) {
      const r = await fetchImpl(`${base}/${table}`, {
        method: 'POST',
        headers: { ...conn.adminHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      });
      if (r.status === 409) return { conflict: true };
      if (!r.ok) throw new Error(`insert_failed_${r.status}`);
      return { ok: true };
    },
    async update(path, patch) {
      const r = await fetchImpl(`${base}/${path}`, {
        method: 'PATCH',
        headers: { ...conn.adminHeaders(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`update_failed_${r.status}`);
      return r.json();
    },
    async userId(accessToken) {
      const r = await fetchImpl(`${conn.supabaseUrl}/auth/v1/user`, { headers: conn.userHeaders(accessToken) });
      if (!r.ok) return null;
      const u = await r.json().catch(() => null);
      return u && typeof u.id === 'string' && /^[0-9a-f-]{36}$/.test(u.id) ? u.id : null;
    },
  };
}

// 登録完了（利用規約・プライバシーポリシーへの同意）の人だけ保存する（diagnosis-save.js と同じ判定。読めなければ保存しない）
async function registrationOk(db, userId) {
  const rows = await db.select(`profiles?id=eq.${encodeURIComponent(userId)}&select=onboarding_status`);
  const s = Array.isArray(rows) && rows[0] ? rows[0].onboarding_status : null;
  return s === 'completed' || s === 'legacy_exempt';
}

// ---- POST /api/jagan-save ----
export function createSaveHandler({ env, fetchImpl = fetch }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
    const conn = guardOr503(env, req, res, 'jagan-save', { admin: true, user: true });
    if (!conn) return;
    const token = bearer(req);
    if (!token) return send(res, 401, { error: 'not_authenticated' });
    const body = await readJson(req);
    const rc = recompute(body);
    if (!rc.ok) return send(res, 400, { error: rc.error });
    const db = makeDb(conn, fetchImpl);
    try {
      const userId = await db.userId(token);
      if (!userId) return send(res, 401, { error: 'not_authenticated' });
      if (!(await registrationOk(db, userId))) return send(res, 403, { error: 'registration_required' });
      const r = rc.result;
      const existing = await db.select(`jagan_results?result_id=eq.${r.resultId}&select=user_id,created_at`);
      if (Array.isArray(existing) && existing[0]) {
        if (existing[0].user_id !== userId) return send(res, 409, { error: 'result_id_conflict' });
        return send(res, 200, { ok: true, resultId: r.resultId, duplicate: true, createdAt: existing[0].created_at });
      }
      const ins = await db.insert('jagan_results', {
        result_id: r.resultId,
        user_id: userId,
        schema_version: RESULT_SCHEMA_VERSION,
        engine_version: r.versions.engine,
        item_set_version: r.versions.itemSet,
        scoring_version: r.versions.scoring,
        interpretation_version: r.versions.interpretation,
        character_model_version: r.versions.characterModel,
        dti_code: r.dti.code,
        naming_version: r.versions.naming,
        answers: r.answers,
        snapshot: r,
        headline: headlineOf(r),
      });
      if (ins.conflict) {
        // 同時の再送：もう一度確かめる（同じ本人なら成功、別の本人なら 409）
        const again = await db.select(`jagan_results?result_id=eq.${r.resultId}&select=user_id`);
        if (Array.isArray(again) && again[0] && again[0].user_id === userId) return send(res, 200, { ok: true, resultId: r.resultId, duplicate: true });
        return send(res, 409, { error: 'result_id_conflict' });
      }
      return send(res, 200, { ok: true, resultId: r.resultId, duplicate: false });
    } catch (e) {
      console.error('jagan-save failed', e && e.message);
      return send(res, 500, { error: 'save_failed' });
    }
  };
}

// ---- POST /api/jagan-share（作成）・DELETE /api/jagan-share（取消） ----
//   作成：本人の操作でだけ呼ばれる。ログイン中で保存済みなら保存時のスナップショットから、それ以外は送られた回答から再計算する。
//   同じ resultId の再作成は同じ公開 ID を返す（取消用の秘密値は最初の作成のときだけ返す）。
//   取消：ログイン中は本人の共有、ログインなしは取消用の秘密値が必要（公開 ID だけでは取り消せない）。
export function createShareHandler({ env, fetchImpl = fetch }) {
  return async function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'DELETE') { res.setHeader('Allow', 'POST, DELETE'); return send(res, 405, { error: 'method_not_allowed' }); }
    const conn = guardOr503(env, req, res, 'jagan-share', { admin: true, user: true });
    if (!conn) return;
    const db = makeDb(conn, fetchImpl);
    const token = bearer(req);
    const body = await readJson(req);
    try {
      const userId = token ? await db.userId(token) : null;
      if (token && !userId) return send(res, 401, { error: 'not_authenticated' });

      if (req.method === 'DELETE') {
        const publicId = body && body.publicId;
        if (typeof publicId !== 'string' || !PUBLIC_ID_RE.test(publicId)) return send(res, 400, { error: 'invalid_public_id' });
        const rows = await db.select(`jagan_shares?public_id=eq.${publicId}&select=user_id,revoke_token_hash,revoked_at`);
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) return send(res, 404, { error: 'not_found' });
        const byOwner = userId && row.user_id === userId;
        const rt = body && body.revokeToken;
        const byToken = typeof rt === 'string' && REVOKE_TOKEN_RE.test(rt) && row.revoke_token_hash &&
          crypto.timingSafeEqual(Buffer.from(sha256(rt)), Buffer.from(row.revoke_token_hash));
        if (!byOwner && !byToken) return send(res, 403, { error: 'forbidden' });
        if (!row.revoked_at) await db.update(`jagan_shares?public_id=eq.${publicId}`, { revoked_at: new Date().toISOString() });
        return send(res, 200, { ok: true });
      }

      if (!body || typeof body.resultId !== 'string' || !UUID_RE.test(body.resultId)) return send(res, 400, { error: 'invalid_result_id' });
      let result = null;
      let owner = null;
      if (userId) {
        const saved = await db.select(`jagan_results?result_id=eq.${body.resultId}&select=user_id,snapshot`);
        if (Array.isArray(saved) && saved[0]) {
          if (saved[0].user_id !== userId) return send(res, 409, { error: 'result_id_conflict' });
          result = saved[0].snapshot;
          owner = userId;
        }
      }
      if (!result) {
        const rc = recompute(body);
        if (!rc.ok) return send(res, 400, { error: rc.error });
        result = rc.result;
      }
      const summary = shareableSummary(result);
      if (!summary) return send(res, 422, { error: 'result_not_shareable' });
      const resultKey = sha256(`jagan-share|${body.resultId}`);
      const existing = await db.select(`jagan_shares?result_key=eq.${resultKey}&select=public_id,revoked_at`);
      if (Array.isArray(existing) && existing[0] && !existing[0].revoked_at) {
        return send(res, 200, { ok: true, publicId: existing[0].public_id, summary, existing: true });
      }
      if (Array.isArray(existing) && existing[0] && existing[0].revoked_at) {
        // 取り消した共有は戻さない（新しい公開 ID を作るため、古い行の印を外す）
        await db.update(`jagan_shares?result_key=eq.${resultKey}`, { result_key: sha256(`revoked|${resultKey}|${randomId(16)}`) });
      }
      const publicId = randomId(16).slice(0, 22);
      const revokeToken = owner ? null : randomId(32);
      const ins = await db.insert('jagan_shares', {
        public_id: publicId,
        result_key: resultKey,
        user_id: owner,
        summary,
        item_set_version: result.versions.itemSet,
        revoke_token_hash: revokeToken ? sha256(revokeToken) : null,
      });
      if (ins.conflict) {
        const again = await db.select(`jagan_shares?result_key=eq.${resultKey}&select=public_id,revoked_at`);
        if (Array.isArray(again) && again[0] && !again[0].revoked_at) return send(res, 200, { ok: true, publicId: again[0].public_id, summary, existing: true });
        return send(res, 409, { error: 'share_conflict' });
      }
      return send(res, 200, { ok: true, publicId, summary, revokeToken, existing: false });
    } catch (e) {
      console.error('jagan-share failed', e && e.message);
      return send(res, 500, { error: 'share_failed' });
    }
  };
}

// ---- GET /jagan/s/<公開ID>（vercel.json で /api/jagan-share-page?id= へ） ----
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderSharePage({ origin, publicId, summary: raw, pageUrl }) {
  const summary = raw ? resolveSummary(raw) : null;
  const title = summary ? `${summary.element.label}×${summary.isou.label}「${summary.dti.name}」（${summary.dti.code}）｜邪眼診断` : '共有が見つかりません｜邪眼診断';
  const ogImage = summary ? `${origin}/api/jagan-og?${ogParams(summary)}` : `${origin}/api/jagan-og?v=${encodeURIComponent(`${BUNDLE.dti.version}.${OG_DESIGN_VERSION}`)}`;
  const desc = summary
    ? (summary.character ? `あなたのファトゥス：${summary.character.label}（${summary.character.matchPercent}%一致）。` : '') + 'あなたの願いは、どんな深淵を映すのか。'
    : 'あなたの願いは、どんな深淵を映すのか。';
  const body = summary ? `
    <p class="kicker">邪眼診断 — DTI</p>
    <h1 class="headline">${esc(summary.element.label)}<span class="x">×</span>${esc(summary.isou.label)}</h1>
    <p class="dti-line"><b>${esc(summary.dti.code)}</b>｜${esc(summary.dti.name)}</p>
    <p class="small">邪眼：${esc(summary.element.label)} ／ 異相：${esc(summary.isou.label)}</p>
    ${summary.character ? `<p class="fatui">あなたのファトゥス：<strong>${esc(summary.character.label)}</strong>（${esc(summary.character.matchPercent)}%一致）</p>` : ''}
    <p class="small">${esc(BALANCE_NOTE)}</p>` : `
    <p class="kicker">共有が見つかりません</p>
    <h1 class="headline small-h">この共有は、取り消されたか、存在しません。</h1>
    <p class="small">共有された結果の代わりに、あなた自身の深淵を確かめられます。</p>`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
${summary ? `<meta property="og:url" content="${esc(pageUrl || `${origin}/jagan/s/${publicId}`)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&family=IM+Fell+English:ital@0;1&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/jagan/jagan.css">
<script src="/js/ga.js"></script>
</head><body class="jg-share">
<div class="night" aria-hidden="true"><div class="photo"></div><div class="tint"></div></div>
<main class="jg-wrap" id="app">
  <section class="jg-card jg-share-card">${body}
    <a class="jg-btn jg-btn-primary" href="/jagan/">診断をはじめる</a>
    <p class="small"><a href="/jagan/about">邪眼診断について</a></p>
  </section>
</main>
</body></html>`;
}

export function createSharePageHandler({ env, fetchImpl = fetch }) {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://x');
    const publicId = url.searchParams.get('id') || '';
    const host = requestHost(req);
    const origin = `https://${host}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    let summary = null;
    let pageUrl = null;
    // 元素診断と同じ、URL に公開の値だけを載せた共有（DB を使わない）。値は許可された ID から解決する
    if (!url.searchParams.has('id')) {
      const v = parseOg(url.searchParams);
      if (v) {
        summary = { kind: PUBLIC_SUMMARY_KIND, element: { id: v.elementId }, isou: { id: v.isouId }, character: v.character ? { id: v.character.id, matchPercent: v.character.match } : null };
        pageUrl = `${origin}${sharePagePath(resolveSummary(summary))}`;
      }
    } else if (PUBLIC_ID_RE.test(publicId)) {
      const guard = requireServerEnv(env, { host, admin: true });
      if (guard.ok && jaganEnabled(env, guard.appEnv)) {
        try {
          const rows = await makeDb(guard, fetchImpl).select(`jagan_shares?public_id=eq.${publicId}&revoked_at=is.null&select=summary`);
          const s = Array.isArray(rows) && rows[0] ? rows[0].summary : null;
          if (s && resolveSummary(s)) summary = s;
        } catch (e) { console.error('jagan-share-page lookup failed'); }
      }
    }
    res.statusCode = summary ? 200 : 404;
    res.setHeader('Cache-Control', summary ? 'public, max-age=60, s-maxage=300' : 'no-store');
    res.end(renderSharePage({ origin, publicId, summary, pageUrl }));
  };
}

// ---- GET /api/jagan-report?resultId= （購入権限の土台） ----
//   販売前（product.sales_open=false・JAGAN_SALES_OPEN≠true）は、誰にも本文を返さない（403 sales_closed）。
//   販売後も、本人の保存結果かつ本人の jagan_entitlements（active）がある時だけ。ETI の購入では開かない。
export function createReportHandler({ env, fetchImpl = fetch, bundle = BUNDLE }) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method_not_allowed' }); }
    const conn = guardOr503(env, req, res, 'jagan-report', { admin: true, user: true });
    if (!conn) return;
    const token = bearer(req);
    if (!token) return send(res, 401, { error: 'not_authenticated' });
    const salesOpen = bundle.product.sales_open === true && env.JAGAN_SALES_OPEN === 'true' && Number.isInteger(bundle.product.price);
    if (!salesOpen) return send(res, 403, { error: 'sales_closed' });
    const resultId = new URL(req.url || '/', 'http://x').searchParams.get('resultId') || '';
    if (!UUID_RE.test(resultId)) return send(res, 400, { error: 'invalid_result_id' });
    const db = makeDb(conn, fetchImpl);
    try {
      const userId = await db.userId(token);
      if (!userId) return send(res, 401, { error: 'not_authenticated' });
      const ent = await db.select(`jagan_entitlements?user_id=eq.${userId}&result_id=eq.${resultId}&product_key=eq.${bundle.product.product_key}&status=eq.active&select=id`);
      if (!Array.isArray(ent) || !ent[0]) return send(res, 403, { error: 'not_purchased' });
      const rows = await db.select(`jagan_results?result_id=eq.${resultId}&user_id=eq.${userId}&select=snapshot`);
      if (!Array.isArray(rows) || !rows[0]) return send(res, 404, { error: 'not_found' });
      return send(res, 200, { ok: true, snapshot: rows[0].snapshot });
    } catch (e) {
      console.error('jagan-report failed', e && e.message);
      return send(res, 500, { error: 'report_failed' });
    }
  };
}
