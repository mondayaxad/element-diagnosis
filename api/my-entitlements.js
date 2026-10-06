// api/my-entitlements.js（新規）
// マイページ（mypage.html）専用。ログイン済みユーザー自身の診断履歴に対応する
// CORE1購入状態だけを返す。
//
// 設計方針（既存のverify.js/report-data.jsと同じ考え方）：
//   - purchase_entitlements・diagnosis_sessions等の生データをクライアントへ返さない
//   - 呼び出し元から任意のハッシュ・診断コードを受け取らない。
//     本人のアクセストークンから auth.uid() を特定し、
//     「本人が保存している診断コード」をサーバー側で導出した範囲だけを検索する
//   - Stripeの識別子・金額・通貨はレスポンスに含めない
//
// 返却形式：{ "purchased_by_version": { "element-v1:<コード>": true,
//                                              "ETI-2.0:<コード>": true } }
// 世代をキーへ含めることで、v1とv2の権利を誤って相互利用しない。
//
// 環境ガード（lib/server-env.js）を Supabase へ接続する前に通す（アクセストークンの検証を含む）。
// 環境不明・Ref の取り違え・設定不足のときは 503 で止める。

const crypto = require('crypto');
const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');

function hashDiagnosisCode(diagnosisCode) {
  return crypto.createHash('sha256').update(diagnosisCode).digest('hex');
}

// product_type → CORE1閲覧権限を持つかどうか（report-data.jsのPRODUCT_PERMISSIONSと同じ考え方）。
// CORE2のみの購入はCORE1のロックを解除しない。
// 旧購入者へのv2無料配布方針は撤回済み。core1_v2_repassを新規権利として扱わない。
const CORE1_PRODUCT_TYPES = new Set(['core1', 'complete']);

function createHandler({ env, fetchImpl }) {
  // アクセストークンを検証し、本人のuser_idを取得する（GoTrueの/auth/v1/userを使用。
  // 新たなnpm依存を増やさず、verify.js/report-data.jsと同じ「素のfetch」スタイルに揃える）。
  // ログインユーザー本人としてのアクセス：公開キー＋ユーザーの access token（サーバー用キーは使わない）
  async function getUserIdFromAccessToken(conn, accessToken) {
    const res = await fetchImpl(`${conn.supabaseUrl}/auth/v1/user`, {
      headers: conn.userHeaders(accessToken),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user.id : null;
  }

  // 本人が保存している診断セッションから、encoded_answers（診断コード）一覧を取得する。
  // service roleで検索するが、対象はuserIdで厳密に絞り込む（他人の行は対象にならない）。
  async function fetchOwnDiagnosisCodes(conn, userId) {
    const url =
      `${conn.supabaseUrl}/rest/v1/diagnosis_sessions` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=diagnosis_version,diagnosis_answers(encoded_answers)`;

    const res = await fetchImpl(url, { headers: conn.adminHeaders() });
    if (!res.ok) {
      throw new Error(`diagnosis_sessions lookup failed: ${res.status}`);
    }
    const rows = await res.json();
    const codes = [];
    rows.forEach((row) => {
      const a = Array.isArray(row.diagnosis_answers) ? row.diagnosis_answers[0] : row.diagnosis_answers;
      if (a && a.encoded_answers) {
        const diagnosisVersion = row.diagnosis_version === 'ETI-2.0' ? 'ETI-2.0' : 'element-v1';
        codes.push({
          code: a.encoded_answers,
          diagnosisVersion,
          reference: diagnosisVersion === 'ETI-2.0' ? `v2_${a.encoded_answers}` : a.encoded_answers,
        });
      }
    });
    return codes;
  }

  async function fetchPurchasedHashes(conn, hashes) {
    if (hashes.length === 0) return new Set();
    const url =
      `${conn.supabaseUrl}/rest/v1/purchase_entitlements` +
      `?diagnosis_code_hash=in.(${hashes.join(',')})` +
      `&status=eq.active&select=diagnosis_code_hash,product_type`;

    const res = await fetchImpl(url, { headers: conn.adminHeaders() });
    if (!res.ok) {
      throw new Error(`purchase_entitlements lookup failed: ${res.status}`);
    }
    const rows = await res.json();
    const purchasedHashes = new Set();
    rows.forEach((row) => {
      if (CORE1_PRODUCT_TYPES.has(row.product_type)) {
        purchasedHashes.add(row.diagnosis_code_hash);
      }
    });
    return purchasedHashes;
  }

  return async function handler(req, res) {
    // 環境ガード：Supabase へ接続する前に、環境・接続先を確かめる。
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, user: true });
    if (!guard.ok) {
      const incidentId = logEnvDenied('my-entitlements', guard);
      res.status(503).json({ error: 'service_unavailable', incident_id: incidentId });
      return;
    }

    const authHeader = (req.headers && req.headers.authorization) || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }

    try {
      const userId = await getUserIdFromAccessToken(guard, accessToken);
      if (!userId) {
        res.status(401).json({ error: 'not_authenticated' });
        return;
      }

      const codes = await fetchOwnDiagnosisCodes(guard, userId);
      if (codes.length === 0) {
        res.status(200).json({ purchased_by_version: {} });
        return;
      }

      const hashByKey = {};
      codes.forEach((entry) => {
        const key = `${entry.diagnosisVersion}:${entry.code}`;
        hashByKey[key] = hashDiagnosisCode(entry.reference);
      });
      const hashes = Object.values(hashByKey);

      const purchasedHashes = await fetchPurchasedHashes(guard, hashes);

      const purchasedByVersion = {};
      codes.forEach((entry) => {
        const key = `${entry.diagnosisVersion}:${entry.code}`;
        if (purchasedHashes.has(hashByKey[key])) {
          purchasedByVersion[key] = true;
        }
      });

      res.status(200).json({ purchased_by_version: purchasedByVersion });
    } catch (err) {
      console.error('my-entitlements error:', err && err.message);
      res.status(500).json({ error: 'lookup_failed' });
    }
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
