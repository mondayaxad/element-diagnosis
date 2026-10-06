// マイページから、購入済みレポートを安全に再表示するためのURLを再発行する。
//
// クライアントから診断コードや権利ハッシュは受け取らない。ログイン中の本人が所有する
// diagnosis_sessions.idだけを受け取り、サーバー側で診断コード・世代・購入権利を確認する。
// 発行したトークンは既存のreport.html / api/report-data.jsで処理される。
//
// 環境ガード（lib/server-env.js）を Supabase へ接続する前に通す。環境不明・Ref の取り違え・
// 設定不足のときは 503 で止める。発行するトークンには環境名（env）を入れ、
// 別環境の report-data.js では受け付けられないようにする（REPORT_TOKEN_SECRET は環境ごとに別の値にする前提）。

const crypto = require('crypto');
const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');

const REISSUED_TOKEN_TTL_MS = 15 * 60 * 1000;
const CORE1_PRODUCT_TYPES = new Set(['core1', 'complete']);

function hashDiagnosisCode(reference) {
  return crypto.createHash('sha256').update(reference).digest('hex');
}

function signToken(secret, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function deriveCodeEncryptionKey(secret) {
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'report-token-code-encryption-v1', 32)
  );
}

function encryptDiagnosisCode(secret, reference) {
  const key = deriveCodeEncryptionKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(reference, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: encrypted.toString('base64url'),
  };
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function createHandler({ env, fetchImpl }) {
  // ログインユーザー本人としてのアクセス：公開キー＋ユーザーの access token（サーバー用キーは使わない）
  async function getUserIdFromAccessToken(conn, accessToken) {
    const res = await fetchImpl(`${conn.supabaseUrl}/auth/v1/user`, {
      headers: conn.userHeaders(accessToken),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user.id : null;
  }

  async function fetchOwnedDiagnosisSession(conn, userId, diagnosisSessionId) {
    const url =
      `${conn.supabaseUrl}/rest/v1/diagnosis_sessions` +
      `?id=eq.${encodeURIComponent(diagnosisSessionId)}` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&select=id,diagnosis_version,diagnosis_answers(encoded_answers)`;
    const res = await fetchImpl(url, { headers: conn.adminHeaders() });
    if (!res.ok) {
      throw new Error(`diagnosis_sessions lookup failed: ${res.status}`);
    }
    const rows = await res.json();
    return rows[0] || null;
  }

  async function fetchActiveCore1Entitlement(conn, diagnosisCodeHash) {
    const url =
      `${conn.supabaseUrl}/rest/v1/purchase_entitlements` +
      `?diagnosis_code_hash=eq.${encodeURIComponent(diagnosisCodeHash)}` +
      `&status=eq.active` +
      `&select=product_type`;
    const res = await fetchImpl(url, { headers: conn.adminHeaders() });
    if (!res.ok) {
      throw new Error(`purchase_entitlements lookup failed: ${res.status}`);
    }
    const rows = await res.json();
    return rows.find((row) => CORE1_PRODUCT_TYPES.has(row.product_type)) || null;
  }

  return async function handler(req, res) {
    // 環境ガード：Supabase へ接続する前に、環境・接続先・署名鍵を確かめる。
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true, reportSecret: true });
    if (!guard.ok) {
      const incidentId = logEnvDenied('my-report-link', guard);
      res.status(503).json({ error: 'service_unavailable', incident_id: incidentId });
      return;
    }
    const { appEnv } = guard;
    const secret = env.REPORT_TOKEN_SECRET;

    if (req.method && req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    const authHeader = (req.headers && req.headers.authorization) || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }

    const diagnosisSessionId = parseBody(req).diagnosis_session_id;
    if (typeof diagnosisSessionId !== 'string' || !diagnosisSessionId) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    try {
      const userId = await getUserIdFromAccessToken(guard, accessToken);
      if (!userId) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
      }

      const session = await fetchOwnedDiagnosisSession(guard, userId, diagnosisSessionId);
      if (!session) {
        // 他人のsession idを推測されても、存在の有無を明かさない。
        res.status(404).json({ error: 'diagnosis_not_found' });
        return;
      }

      const answers = Array.isArray(session.diagnosis_answers)
        ? session.diagnosis_answers[0]
        : session.diagnosis_answers;
      const code = answers && answers.encoded_answers;
      if (typeof code !== 'string' || !code) {
        res.status(409).json({ error: 'diagnosis_code_unavailable' });
        return;
      }

      const diagnosisVersion = session.diagnosis_version === 'ETI-2.0' ? 'ETI-2.0' : 'element-v1';
      const reference = diagnosisVersion === 'ETI-2.0' ? `v2_${code}` : code;
      const entitlement = await fetchActiveCore1Entitlement(guard, hashDiagnosisCode(reference));
      if (!entitlement) {
        res.status(403).json({ error: 'report_not_purchased' });
        return;
      }

      // purchaseブロックは付けない。再表示のたびにGA4 purchaseを再計測しないため。
      // access_modeによりreport-data.jsの旧形式トークン向けlegacy_floorとも区別する。
      const token = signToken(secret, {
        exp: Date.now() + REISSUED_TOKEN_TTL_MS,
        env: appEnv,
        diagnosis_version: diagnosisVersion,
        access_mode: 'mypage_entitlement_reissue',
        enc: encryptDiagnosisCode(secret, reference),
      });

      res.status(200).json({
        url: `/report.html?token=${encodeURIComponent(token)}`,
        expires_in: Math.floor(REISSUED_TOKEN_TTL_MS / 1000),
      });
    } catch (err) {
      console.error('my-report-link error:', err && err.message);
      res.status(500).json({ error: 'report_link_issue_failed' });
    }
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
