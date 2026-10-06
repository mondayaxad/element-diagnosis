// api/subscribe.js
// メール配信に同意した本人だけを、Kit（旧ConvertKit）へ購読者として登録する。
// KIT_API_KEYはVercelの環境変数にのみ置く。ブラウザ側には絶対に渡さない。
//
// 安全化（2026-10-06 統合指示書 §13）：
//   1. ブラウザは Supabase のアクセストークンを Authorization: Bearer で送る。サーバー側で検証する
//   2. request body のメールアドレスは登録先として一切使わない（body は consentVersion だけを見る）
//   3. 登録先は、トークンから取得した認証済みユーザー本人のメールアドレス
//   4. DB（profiles）の newsletter_opted_in === true と同意版を確認できた場合だけ Kit を呼ぶ。
//      列が無い・型が違う・読めない場合は Kit を呼ばない（fail-closed）
//   5. Kit 側で既に存在する購読者は作り直さない。配信停止済み（active 以外）の人を active へ戻さない
//   6. Preview（VERCEL_ENV !== 'production'）では、KIT_PREVIEW_ALLOWED_EMAILS に明示したテスト用
//      メールだけを送る。それ以外は Kit を呼ばずに終える（本番Kitリストへテスト登録しない）
//   7. 秘密・メールアドレス・Kit の応答本文をログやレスポンスへ出さない
//
//   8. 環境ガード（lib/server-env.js）を Supabase へ接続する前に通す。環境不明・Ref の取り違え・
//      設定不足のときは 503 で止める（Kit も呼ばない）
//
// service role の利用は、トークン検証（/auth/v1/user）と、本人の profiles 1行の2列の読み取りだけに限る。
// テストでは createHandler({ fetchImpl, env }) に偽の fetch を渡す（実行時に mock を有効にする設定は持たない）。

const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');

const KIT_SUBSCRIBERS_URL = 'https://api.kit.com/v4/subscribers';
const CONSENT_VERSION = '2026-10-06-v1';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return typeof req.body === 'object' ? req.body : null;
}

function createHandler({ fetchImpl, env }) {
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

  // 本人の行だけを読む。列が存在しない等で読めない場合は null（＝同意を確認できない）。
  async function readConsent(conn, userId) {
    const url = `${conn.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}` +
      '&select=newsletter_opted_in,newsletter_consent_version';
    const res = await fetchImpl(url, {
      headers: conn.adminHeaders(), // 管理者アクセス（本人の行だけを id で絞る）
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows)) return null;
    return rows[0] || { newsletter_opted_in: null, newsletter_consent_version: null };
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

    try {
      const user = await getVerifiedUser(guard, accessToken);
      if (!user) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      if (!user.email) {
        res.status(400).json({ error: 'email_unavailable' });
        return;
      }

      const consent = await readConsent(guard, user.id);
      if (!consent || consent.newsletter_opted_in !== true || consent.newsletter_consent_version !== CONSENT_VERSION) {
        res.status(403).json({ error: 'consent_required' });
        return;
      }

      if (!env.KIT_API_KEY) {
        console.error('subscribe error: Kit is not configured');
        res.status(503).json({ error: 'kit_not_configured' });
        return;
      }

      if (!previewAllows(user.email)) {
        // Preview ガード：本番Kitリストへテスト登録しない
        res.status(200).json({ ok: true, skipped: 'preview_guard' });
        return;
      }

      // 既存の購読者を確認する。配信停止済み等（active 以外）は再登録しない。確認できなければ送らない。
      const lookup = await fetchImpl(
        `${KIT_SUBSCRIBERS_URL}?email_address=${encodeURIComponent(user.email)}&status=all`,
        { method: 'GET', headers: kitHeaders() }
      );
      if (!lookup.ok) {
        console.error('subscribe error: Kit lookup failed', lookup.status);
        res.status(502).json({ error: 'kit_error' });
        return;
      }
      const found = await lookup.json().catch(() => null);
      const subscribers = found && Array.isArray(found.subscribers) ? found.subscribers : null;
      if (!subscribers) {
        res.status(502).json({ error: 'kit_error' });
        return;
      }
      if (subscribers.length > 0) {
        const active = subscribers.some((s) => s && s.state === 'active');
        res.status(200).json(active ? { ok: true, already: true } : { ok: true, skipped: 'not_reactivated' });
        return;
      }

      const kitRes = await fetchImpl(KIT_SUBSCRIBERS_URL, {
        method: 'POST',
        headers: kitHeaders(),
        body: JSON.stringify({ email_address: user.email, state: 'active' }),
      });
      if (!kitRes.ok) {
        console.error('subscribe error: Kit create failed', kitRes.status);
        res.status(502).json({ error: 'kit_error' });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('subscribe error:', err && err.name ? err.name : 'unknown');
      res.status(500).json({ error: 'server_error' });
    }
  };
}

module.exports = createHandler({ fetchImpl: (...args) => fetch(...args), env: process.env });
module.exports.createHandler = createHandler;
module.exports.CONSENT_VERSION = CONSENT_VERSION;
