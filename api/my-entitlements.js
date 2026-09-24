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

const SUPABASE_URL = process.env.SUPABASE_URL;

function hashDiagnosisCode(diagnosisCode) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(diagnosisCode).digest('hex');
}

// アクセストークンを検証し、本人のuser_idを取得する（GoTrueの/auth/v1/userを使用。
// 新たなnpm依存を増やさず、verify.js/report-data.jsと同じ「素のfetch」スタイルに揃える）。
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

// 本人が保存している診断セッションから、encoded_answers（診断コード）一覧を取得する。
// service roleで検索するが、対象はuserIdで厳密に絞り込む（他人の行は対象にならない）。
async function fetchOwnDiagnosisCodes(userId) {
  const url =
    `${SUPABASE_URL}/rest/v1/diagnosis_sessions` +
    `?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=diagnosis_version,diagnosis_answers(encoded_answers)`;

  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`diagnosis_sessions lookup failed: ${res.status} ${body}`);
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

// product_type → CORE1閲覧権限を持つかどうか（report-data.jsのPRODUCT_PERMISSIONSと同じ考え方）。
// CORE2のみの購入はCORE1のロックを解除しない。
// 旧購入者へのv2無料配布方針は撤回済み。core1_v2_repassを新規権利として扱わない。
const CORE1_PRODUCT_TYPES = new Set(['core1', 'complete']);

async function fetchPurchasedHashes(hashes) {
  if (hashes.length === 0) return new Set();
  const url =
    `${SUPABASE_URL}/rest/v1/purchase_entitlements` +
    `?diagnosis_code_hash=in.(${hashes.join(',')})` +
    `&status=eq.active&select=diagnosis_code_hash,product_type`;

  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`purchase_entitlements lookup failed: ${res.status} ${body}`);
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

module.exports = async (req, res) => {
  if (!SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('my-entitlements error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    res.status(500).json({ error: 'server_configuration_error' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }

  try {
    const userId = await getUserIdFromAccessToken(accessToken);
    if (!userId) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }

    const codes = await fetchOwnDiagnosisCodes(userId);
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

    const purchasedHashes = await fetchPurchasedHashes(hashes);

    const purchasedByVersion = {};
    codes.forEach((entry) => {
      const key = `${entry.diagnosisVersion}:${entry.code}`;
      if (purchasedHashes.has(hashByKey[key])) {
        purchasedByVersion[key] = true;
      }
    });

    res.status(200).json({ purchased_by_version: purchasedByVersion });
  } catch (err) {
    console.error('my-entitlements error:', err);
    res.status(500).json({ error: 'lookup_failed' });
  }
};
