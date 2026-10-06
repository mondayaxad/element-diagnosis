// api/subscribe.js
// 登録完了で同意を記録した本人だけを、Kit（旧ConvertKit）へ購読者として登録する。
// KIT_API_KEYはVercelの環境変数にのみ置く。ブラウザ側には絶対に渡さない。
//
// 安全化（2026-10-06 統合指示書 §13 を、2026-10-07 の登録完了の仕様に合わせて更新）：
//   1. ブラウザは Supabase のアクセストークンを Authorization: Bearer で送る。サーバー側で検証する
//   2. request body のメールアドレスは登録先として一切使わない（body は consentVersion だけを見る）
//   3. 登録先は、トークンから取得した認証済みユーザー本人のメールアドレス
//   4. DB（profiles）で、登録完了（onboarding_status=completed）・newsletter_opted_in === true・
//      同意の版（2026-10-07-v1）・取得経路（registration_onboarding）を確認できた場合だけ Kit を呼ぶ。
//      列が無い・型が違う・読めない場合は Kit を呼ばない（fail-closed）。既存ユーザー（legacy_exempt）は対象外
//   5. Kit 側で既に存在する購読者は作り直さない。配信停止済み（active 以外）の人を active へ戻さない
//   6. Preview（VERCEL_ENV !== 'production'）では、KIT_PREVIEW_ALLOWED_EMAILS に明示したテスト用
//      メールだけを送る。それ以外は Kit を呼ばずに終える（本番Kitリストへテスト登録しない）
//   7. 秘密・メールアドレス・Kit の応答本文をログやレスポンスへ出さない
//   8. 環境ガード（lib/server-env.js）を Supabase へ接続する前に通す。環境不明・Ref の取り違え・
//      設定不足のときは 503 で止める（Kit も呼ばない）
//   9. 同期の結果を profiles.newsletter_sync_status（synced／failed／skipped）に記録する。
//      送るのは「試行0回」または「前回から24時間以上・試行3回未満」で、synced でないときだけ
//      （再ログインのたびに無条件に再送しない。diagnosis-save.js の newsletterSyncDue と同じ条件）。
//      Kit を呼ぶ前に試行回数を条件付きで1つ進めて「試行の権利」を取り、同時の二重送信を防ぐ。
//
// service role の利用は、本人の profiles 1行の読み取りと、その行の newsletter_sync_* の更新だけに限る。
// トークン検証（/auth/v1/user）は公開キー＋本人のトークンで行う。
// テストでは createHandler({ fetchImpl, env, now }) に偽の fetch・時刻を渡す（実行時に mock を有効にする設定は持たない）。

const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');

const KIT_SUBSCRIBERS_URL = 'https://api.kit.com/v4/subscribers';
const CONSENT_VERSION = '2026-10-07-v1';
const CONSENT_SOURCE = 'registration_onboarding';
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return typeof req.body === 'object' ? req.body : null;
}

// 送ってよいか（diagnosis-save.js の newsletterSyncDue と同じ条件）
function syncDue(profile, nowMs) {
  if (profile.newsletter_sync_status === 'synced') return false;
  const attempts = Number(profile.newsletter_sync_attempts) || 0;
  if (attempts === 0) return true;
  if (attempts >= MAX_ATTEMPTS) return false;
  const last = Date.parse(profile.newsletter_sync_attempted_at || '');
  if (!Number.isFinite(last)) return true;
  return (nowMs - last) >= RETRY_INTERVAL_MS;
}

function createHandler({ fetchImpl, env, now = () => Date.now() }) {
  // ログインユーザー本人としてのアクセス：公開キー＋ユーザーの access token（サーバー用キーは使わない）
  async function getVerifiedUser(conn, accessToken) {
    const res = await fetchImpl(`${conn.supabaseUrl}/auth/v1/user`, {
      headers: conn.userHeaders(accessToken),
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    if (!user || typeof user.id !== 'string' || !user.id) return null;
    if (typeof user.email !== 'string' || !user.email.includes('@')) return { id: user.id, email: null };
    return { id: user.id, email: user.email };
  }

  function profileUrl(conn, userId) {
    return `${conn.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
  }

  // 本人の行だけを読む。列が存在しない等で読めない場合は null（＝同意を確認できない）。
  async function readConsent(conn, userId) {
    const url = profileUrl(conn, userId) +
      '&select=onboarding_status,newsletter_opted_in,newsletter_consent_version,newsletter_consent_source,' +
      'newsletter_sync_status,newsletter_sync_attempts,newsletter_sync_attempted_at';
    const res = await fetchImpl(url, {
      headers: conn.adminHeaders(), // 管理者アクセス（本人の行だけを id で絞る）
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return null;
    return rows[0] || null;
  }

  // 試行の権利を取る：試行回数が読んだ値のままのときだけ1つ進める（同時の二重送信を防ぐ）。
  // 戻り値：true＝取れた／false＝ほかのリクエストが先に取った／null＝更新できなかった
  async function claimAttempt(conn, userId, attempts) {
    const res = await fetchImpl(`${profileUrl(conn, userId)}&newsletter_sync_attempts=eq.${attempts}`, {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, conn.adminHeaders()),
      body: JSON.stringify({ newsletter_sync_attempts: attempts + 1, newsletter_sync_attempted_at: new Date(now()).toISOString() }),
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return null;
    return rows.length === 1;
  }

  // 結果を記録する。記録に失敗しても Kit の結果（レスポンス）は変えない（次回の判定で扱う）。
  async function recordSyncStatus(conn, userId, status) {
    try {
      const res = await fetchImpl(profileUrl(conn, userId), {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, conn.adminHeaders()),
        body: JSON.stringify({ newsletter_sync_status: status }),
      });
      if (!res.ok) console.error('subscribe error: sync status not recorded', res.status);
    } catch (e) {
      console.error('subscribe error: sync status not recorded');
    }
  }

  function previewAllows(email) {
    if (env.VERCEL_ENV === 'production') return true;
    const allowed = String(env.KIT_PREVIEW_ALLOWED_EMAILS || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return allowed.includes(email.toLowerCase());
  }

  function kitHeaders() {
    return { 'Content-Type': 'application/json', 'X-Kit-Api-Key': env.KIT_API_KEY };
  }

  // Kit への登録（既存の購読者は作り直さない・配信停止済みを戻さない）。戻り値：{ status, code, body }
  async function syncToKit(email) {
    const lookup = await fetchImpl(
      `${KIT_SUBSCRIBERS_URL}?email_address=${encodeURIComponent(email)}&status=all`,
      { method: 'GET', headers: kitHeaders() }
    );
    if (!lookup.ok) {
      console.error('subscribe error: Kit lookup failed', lookup.status);
      return { status: 'failed', code: 502, body: { error: 'kit_error' } };
    }
    const found = await lookup.json().catch(() => null);
    const subscribers = found && Array.isArray(found.subscribers) ? found.subscribers : null;
    if (!subscribers) return { status: 'failed', code: 502, body: { error: 'kit_error' } };
    if (subscribers.length > 0) {
      const active = subscribers.some((s) => s && s.state === 'active');
      return active
        ? { status: 'synced', code: 200, body: { ok: true, already: true } }
        : { status: 'skipped', code: 200, body: { ok: true, skipped: 'not_reactivated' } };
    }
    const kitRes = await fetchImpl(KIT_SUBSCRIBERS_URL, {
      method: 'POST',
      headers: kitHeaders(),
      body: JSON.stringify({ email_address: email, state: 'active' }),
    });
    if (!kitRes.ok) {
      console.error('subscribe error: Kit create failed', kitRes.status);
      return { status: 'failed', code: 502, body: { error: 'kit_error' } };
    }
    return { status: 'synced', code: 200, body: { ok: true } };
  }

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }
    // 環境ガード：Supabase へ接続する前に、環境・接続先を確かめる。
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true });
    if (!guard.ok) {
      const incidentId = logEnvDenied('subscribe', guard);
      res.status(503).json({ error: 'service_unavailable', incident_id: incidentId });
      return;
    }

    const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!accessToken) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const body = parseBody(req);
    if (!body || body.consentVersion !== CONSENT_VERSION) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    let claimed = false;
    let userId = null;
    try {
      const user = await getVerifiedUser(guard, accessToken);
      if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      userId = user.id;

      const consent = await readConsent(guard, user.id);
      if (!consent || consent.onboarding_status !== 'completed' || consent.newsletter_opted_in !== true
        || consent.newsletter_consent_version !== CONSENT_VERSION || consent.newsletter_consent_source !== CONSENT_SOURCE) {
        res.status(403).json({ error: 'consent_required' });
        return;
      }
      if (consent.newsletter_sync_status === 'synced') {
        res.status(200).json({ ok: true, already: true });
        return;
      }
      if (!syncDue(consent, now())) {
        res.status(200).json({ ok: true, skipped: 'not_due' });
        return;
      }

      const claim = await claimAttempt(guard, user.id, Number(consent.newsletter_sync_attempts) || 0);
      if (claim === null) {
        res.status(500).json({ error: 'server_error' });
        return;
      }
      if (claim === false) {
        res.status(200).json({ ok: true, skipped: 'in_progress' });
        return;
      }
      claimed = true;

      if (!user.email) {
        await recordSyncStatus(guard, user.id, 'skipped');
        res.status(200).json({ ok: true, skipped: 'email_unavailable' });
        return;
      }
      if (!previewAllows(user.email)) {
        // Preview ガード：本番Kitリストへテスト登録しない
        await recordSyncStatus(guard, user.id, 'skipped');
        res.status(200).json({ ok: true, skipped: 'preview_guard' });
        return;
      }
      if (!env.KIT_API_KEY) {
        console.error('subscribe error: Kit is not configured');
        await recordSyncStatus(guard, user.id, 'failed');
        res.status(503).json({ error: 'kit_not_configured' });
        return;
      }

      const result = await syncToKit(user.email);
      await recordSyncStatus(guard, user.id, result.status);
      res.status(result.code).json(result.body);
    } catch (err) {
      console.error('subscribe error:', err && err.name ? err.name : 'unknown');
      if (claimed && userId) await recordSyncStatus(guard, userId, 'failed');
      res.status(500).json({ error: 'server_error' });
    }
  };
}

module.exports = createHandler({ fetchImpl: (...args) => fetch(...args), env: process.env });
module.exports.createHandler = createHandler;
module.exports.CONSENT_VERSION = CONSENT_VERSION;
module.exports.syncDue = syncDue;
