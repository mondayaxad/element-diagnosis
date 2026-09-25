// マイページから、購入済みレポートを安全に再表示するためのURLを再発行する。
//
// クライアントから診断コードや権利ハッシュは受け取らない。ログイン中の本人が所有する
// diagnosis_sessions.idだけを受け取り、サーバー側で診断コード・世代・購入権利を確認する。
// 発行したトークンは既存のreport.html / api/report-data.jsで処理される。

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SECRET = process.env.REPORT_TOKEN_SECRET;
const REISSUED_TOKEN_TTL_MS = 15 * 60 * 1000;
const CORE1_PRODUCT_TYPES = new Set(['core1', 'complete']);

function hashDiagnosisCode(reference) {
  return crypto.createHash('sha256').update(reference).digest('hex');
}

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function deriveCodeEncryptionKey() {
  return Buffer.from(
    crypto.hkdfSync('sha256', SECRET, Buffer.alloc(0), 'report-token-code-encryption-v1', 32)
  );
}

function encryptDiagnosisCode(reference) {
  const key = deriveCodeEncryptionKey();
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

function serviceHeaders() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

async function getUserIdFromAccessToken(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

async function fetchOwnedDiagnosisSession(userId, diagnosisSessionId) {
  const url =
    `${SUPABASE_URL}/rest/v1/diagnosis_sessions` +
    `?id=eq.${encodeURIComponent(diagnosisSessionId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,diagnosis_version,diagnosis_answers(encoded_answers)`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`diagnosis_sessions lookup failed: ${res.status} ${body}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

async function fetchActiveCore1Entitlement(diagnosisCodeHash) {
  const url =
    `${SUPABASE_URL}/rest/v1/purchase_entitlements` +
    `?diagnosis_code_hash=eq.${encodeURIComponent(diagnosisCodeHash)}` +
    `&status=eq.active` +
    `&select=product_type`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`purchase_entitlements lookup failed: ${res.status} ${body}`);
  }
  const rows = await res.json();
  return rows.find((row) => CORE1_PRODUCT_TYPES.has(row.product_type)) || null;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async (req, res) => {
  if (!SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !SECRET) {
    console.error('my-report-link error: required server environment variable is not set');
    res.status(500).json({ error: 'server_configuration_error' });
    return;
  }

  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
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
    const userId = await getUserIdFromAccessToken(accessToken);
    if (!userId) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }

    const session = await fetchOwnedDiagnosisSession(userId, diagnosisSessionId);
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
    const entitlement = await fetchActiveCore1Entitlement(hashDiagnosisCode(reference));
    if (!entitlement) {
      res.status(403).json({ error: 'report_not_purchased' });
      return;
    }

    // purchaseブロックは付けない。再表示のたびにGA4 purchaseを再計測しないため。
    // access_modeによりreport-data.jsの旧形式トークン向けlegacy_floorとも区別する。
    const token = signToken({
      exp: Date.now() + REISSUED_TOKEN_TTL_MS,
      diagnosis_version: diagnosisVersion,
      access_mode: 'mypage_entitlement_reissue',
      enc: encryptDiagnosisCode(reference),
    });

    res.status(200).json({
      url: `/report.html?token=${encodeURIComponent(token)}`,
      expires_in: Math.floor(REISSUED_TOKEN_TTL_MS / 1000),
    });
  } catch (err) {
    console.error('my-report-link error:', err);
    res.status(500).json({ error: 'report_link_issue_failed' });
  }
};
