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
const PS = require('../lib/purchase-state');
const RD = require('./report-data');

const REISSUED_TOKEN_TTL_MS = 15 * 60 * 1000;
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

  async function selectRows(conn, path) {
    const res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/${path}`, { headers: conn.adminHeaders() });
    if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('lookup failed');
    return rows;
  }

  // 解析レポートの閲覧権：同じ本人・同じ診断結果の記録のどれかに、新 Checkout の有効な解析権、または本人に結び付け済みの
  // 有効な旧購入があること（lib/purchase-state.js と同じ規則。診断コードのハッシュの一致だけの旧購入は数えない：complete_10）
  async function hasAnalysisAccess(conn, userId, diagnosisSessionId) {
    const st = PS.computeStates(await PS.loadUserFacts((path) => selectRows(conn, path), userId))[diagnosisSessionId];
    return !!(st && st.analysisAccess);
  }

  // ---- 旧版（element-v1）の購入のマイページへの引き継ぎ（op=legacy_handoff） ----
  //   購入時の署名付きリンク（verify・旧形式）を持つ人が、ログインした状態で押す。リンクの署名を確かめ、その診断コードの
  //   有効な旧購入を、ログイン中の本人が保存した同じ診断コードの記録へ結び付ける（complete_bind_legacy_purchase。
  //   照合方式 link_possession）。1つの購入は1人・1記録にだけ結び付く（先に結び付けた人が優先）。
  //   現在の診断（v2）・旧版でないリンクは扱わない。診断コード・購入の ID は応答に出さない。
  async function legacyHandoff(conn, secret, userId, tokenStr) {
    const data = RD.verifyToken(secret, tokenStr);
    if (!data || (data.env !== undefined && data.env !== conn.appEnv)) return [403, { error: 'invalid_or_expired_token' }];
    const kind = RD.tokenKind(data);
    if (kind !== 'verify' && kind !== 'legacy_floor') return [403, { error: 'invalid_or_expired_token' }];
    const reference = RD.resolveDiagnosisCode(secret, data);
    if (typeof reference !== 'string' || !/^[0-9a-z]{20,80}$/.test(reference) || data.diagnosis_version === 'ETI-2.0') {
      return [403, { error: 'invalid_or_expired_token' }];
    }
    const hash = RD.hashDiagnosisCode(reference);
    // 有効な旧購入（停止・取消されていないもの）
    const blocked = await PS.blockedLegacyHashes((path) => selectRows(conn, path), [hash]);
    if (blocked.has(hash)) return [403, { error: 'not_entitled' }];
    const ents = await selectRows(conn, `purchase_entitlements?diagnosis_code_hash=eq.${hash}&status=eq.active&product_type=in.(core1,complete)&select=id&order=purchased_at.asc`);
    if (!ents.length) return [403, { error: 'not_entitled' }];
    // 本人が保存した、同じ診断コード（旧版）の記録
    //   旧版の行は diagnosis_version が空のことがある（空は旧版）。PostgREST の neq は空を落とすため、版は読んでから判定する
    const sessions = await selectRows(conn, `diagnosis_sessions?user_id=eq.${encodeURIComponent(userId)}` +
      '&select=id,diagnosis_version,diagnosis_answers(encoded_answers)');
    const mine = sessions.find((x) => x.diagnosis_version !== 'ETI-2.0' && PS.keyOf(x) === hash);
    if (!mine) return [409, { error: 'record_not_saved' }];
    // すでに結び付いているか（本人のこの記録なら成功。ほかの人・ほかの記録なら不可）
    const bound = await selectRows(conn, `complete_legacy_bindings?legacy_entitlement_id=in.(${ents.map((e) => e.id).join(',')})&select=legacy_entitlement_id,user_id,diagnosis_session_id`);
    if (bound.some((b) => b.user_id === userId && b.diagnosis_session_id === mine.id)) return [200, { ok: true, bound: 'already' }];
    const free = ents.find((e) => !bound.some((b) => b.legacy_entitlement_id === e.id));
    if (!free) return [409, { error: 'already_bound' }];
    const rpc = await fetchImpl(`${conn.supabaseUrl}/rest/v1/rpc/complete_bind_legacy_purchase`, {
      method: 'POST',
      headers: { ...conn.adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_diagnosis_session_id: mine.id, p_legacy_entitlement_id: free.id, p_match_method: 'link_possession' }),
    });
    if (!rpc.ok) {
      const text = await rpc.text().catch(() => '');
      if (/complete_legacy_(record_)?already_bound/.test(text)) return [409, { error: 'already_bound' }];
      throw new Error(`bind failed: ${rpc.status}`);
    }
    return [200, { ok: true, bound: 'applied' }];
  }

  return async function handler(req, res) {
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'private, no-store');
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

    const body = parseBody(req);
    if (body.op === 'legacy_handoff') {
      try {
        const userId = await getUserIdFromAccessToken(guard, accessToken);
        if (!userId) { res.status(401).json({ error: 'not_authenticated' }); return; }
        const [status, payload] = await legacyHandoff(guard, secret, userId, body.token);
        res.status(status).json(payload);
      } catch (err) {
        console.error('my-report-link legacy_handoff error:', err && err.message);
        res.status(500).json({ error: 'handoff_failed' });
      }
      return;
    }
    const diagnosisSessionId = body.diagnosis_session_id;
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
      const entitlement = await hasAnalysisAccess(guard, userId, diagnosisSessionId);
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
        // 閲覧のたびに report-data.js がこの本人・この記録の権利を確かめる（期限内でも返金・停止後は読めない）
        sid: diagnosisSessionId,
        uid: userId,
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
