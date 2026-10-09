// api/report-data.js（リリースC版）
// フロントエンド（report.html）から呼ばれる。
// トークンの署名・有効期限を検証し、正しければ診断コードと閲覧権限を返す。
//
// リリースCでの変更点（本番版との差分は release_c_report-data_diff.patch を参照）：
//   1. 旧形式トークン（purchaseブロックなし）は、引き続きCORE1閲覧を保証する
//      （legacy_floor。既存の署名付きリンクを持つ全ユーザーへの後方互換）
//   2. 新形式トークンのpurchaseブロックはGA4計測専用であり、権限には使わない
//      （権限はpurchase_entitlementsのみを正とする）
//   3. diagnosis_code_hashで purchase_entitlements を検索し、
//      有効な行から導出した権限と legacy_floor の和集合を entitlements として返す
//   4. purchase_entitlementsの検索に失敗しても、legacy_floorの保証だけは維持し
//      500を返さない（旧形式トークン保有者がDB障害で締め出されないようにする）。
//      DB由来の権限は確認できない場合は付与しない（安全側に倒す）
//   5. CORE1閲覧権限（core_analysis_access）が無い場合、レスポンスに
//      診断コード（code）自体を含めない。report.htmlの表示ゲートはUI上の
//      制御に過ぎず、このAPIを直接叩けば権限が無くてもcodeだけ取得できて
//      しまっていたため、権限が無いレスポンスにはentitlements/purchaseのみを含める
//   6. 新形式トークン（purchase/encを持つもの）は、診断コードを平文で持たない。
//      AES-256-GCMで暗号化された値（enc）を、このサーバーだけが持つ
//      REPORT_TOKEN_SECRETから導出した鍵で復号する。復号に失敗した場合は
//      無効なトークンとして扱う（403）
//   7. SUPABASE_URLを固定値ではなく環境変数から取得する。未設定の場合は
//      500エラーを返す（設定手順は release_c_supabase_env_setup.md を参照）
//
//   8. 環境ガード（lib/server-env.js）を、Supabase へ接続する前に通す。環境不明・Ref の取り違え・
//      設定不足のときは 503（legacy_floor の保証も含めて止める。別の接続先へは切り替えない）
//   9. トークンに環境名（env）があり、現在の環境と異なる場合は無効なトークンとして扱う（403）。
//      env を持たない旧形式トークンは従来どおり受け付ける（後方互換）
//
// 署名検証・有効期限確認の中核ロジックは本番版から変更していない。

const crypto = require('crypto');
const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');

// Supabaseプロジェクト自体のURLは秘密情報ではないが、Preview環境ではPreview専用の
// Supabaseプロジェクトへ向けるため、リクエストごとに環境ガードで検査した値だけを使う。

function verifyToken(secret, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (typeof sig !== 'string') return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  // タイミング攻撃対策：定数時間比較
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }

  if (!data.exp || Date.now() > data.exp) return null; // 期限切れ
  return data;
};

function hashDiagnosisCode(diagnosisCode) {
  return crypto.createHash('sha256').update(diagnosisCode).digest('hex');
}

// ------------------------------------------------------------
// 新形式トークンの診断コード復号（リリースC追加）
// /api/verify.js の encryptDiagnosisCode() と対になる。
// 導出方法（HKDF、info文字列）は両ファイルで一致させる必要がある。
// ------------------------------------------------------------
function deriveCodeEncryptionKey(secret) {
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, Buffer.alloc(0), 'report-token-code-encryption-v1', 32)
  );
}

function decryptDiagnosisCode(secret, enc) {
  const key = deriveCodeEncryptionKey(secret);
  const iv = Buffer.from(enc.iv, 'base64url');
  const tag = Buffer.from(enc.tag, 'base64url');
  const data = Buffer.from(enc.data, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// トークンのペイロード形式に応じて実際の診断コードを取り出す。
//   - 新形式（encを持つ）：復号する。復号失敗（改ざん・鍵不一致等）はnullを返す
//   - 旧形式（codeを平文で持つ）：そのまま返す（後方互換）
function resolveDiagnosisCode(secret, data) {
  if (data.enc) {
    try {
      return decryptDiagnosisCode(secret, data.enc);
    } catch (err) {
      console.error('report-data error: code decryption failed', err && err.name ? err.name : 'unknown');
      return null;
    }
  }
  return data.code || null;
}

// verify.jsと同じ世代判定。旧形式トークンには世代情報が無いため、
// 接頭辞が無い値は必ずlegacy-v1として扱う。
function parseDiagnosisReference(reference, tokenData) {
  if (typeof reference !== 'string' || !reference) return null;
  if (reference.startsWith('v2_')) {
    const code = reference.slice(3);
    return code ? { reference, code, diagnosisVersion: 'ETI-2.0' } : null;
  }
  const explicit = tokenData && tokenData.diagnosis_version;
  return {
    reference,
    code: reference,
    diagnosisVersion: explicit === 'ETI-2.0' ? 'ETI-2.0' : 'element-v1',
  };
}

// product_type → 権限フラグ の対応（購入・権限・価格対応表と同一）
const PRODUCT_PERMISSIONS = {
  core1: ['core_analysis_access'],
  core2: ['journey_report_access'],
  complete: ['core_analysis_access', 'journey_report_access'],
  core2_upgrade: ['journey_report_access'],
};

function createHandler({ env, fetchImpl }) {
  // service roleキーでpurchase_entitlementsを直接検索する（経路A：
  // クライアントへ生テーブルを公開せず、このサーバー処理だけが読む）。
  async function fetchDbPermissions(conn, diagnosisCodeHash) {
    const url =
      `${conn.supabaseUrl}/rest/v1/purchase_entitlements` +
      `?diagnosis_code_hash=eq.${encodeURIComponent(diagnosisCodeHash)}` +
      `&status=eq.active&select=product_type`;

    // 管理者アクセス（ヘッダーはキーの形式に合わせて lib/server-env.js が作る）
    const res = await fetchImpl(url, { headers: conn.adminHeaders() });

    if (!res.ok) {
      // 応答本文はログ・例外へ含めない（ステータスだけ）。
      throw new Error(`purchase_entitlements lookup failed: ${res.status}`);
    }

    const rows = await res.json();
    const permissions = new Set();
    for (const row of rows) {
      (PRODUCT_PERMISSIONS[row.product_type] || []).forEach((p) => permissions.add(p));
    }
    // 記録単位の解析権（解析レポート ¥1,000・完全解析セット ¥3,000。complete_07）。
    // 関数が無い環境（migration 適用前）では 404 になるため、旧 purchase_entitlements だけで判定する。
    if (!permissions.has('core_analysis_access')) {
      const rpc = await fetchImpl(`${conn.supabaseUrl}/rest/v1/rpc/complete_analysis_active_for_code_hash`, {
        method: 'POST',
        headers: { ...conn.adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_code_hash: diagnosisCodeHash }),
      });
      if (rpc.ok) {
        if ((await rpc.json()) === true) permissions.add('core_analysis_access');
      } else if (rpc.status !== 404) {
        throw new Error(`record entitlement lookup failed: ${rpc.status}`);
      }
    }
    return permissions;
  }

  return async function handler(req, res) {
    // 環境ガード：Supabase へ接続する前に、環境・接続先・署名鍵を確かめる。
    const guard = requireServerEnv(env, { host: requestHost(req), admin: true, reportSecret: true });
    if (!guard.ok) {
      const incidentId = logEnvDenied('report-data', guard);
      res.status(503).json({ error: 'service_unavailable', incident_id: incidentId });
      return;
    }
    const secret = env.REPORT_TOKEN_SECRET;

    const token = (req.query || {}).token;
    const data = verifyToken(secret, token);

    if (!data) {
      res.status(403).json({ error: 'invalid_or_expired_token' });
      return;
    }

    // 別環境で発行されたトークン（env が現在の環境と異なる）は受け付けない。
    // env を持たない旧形式トークンは後方互換のため従来どおり扱う。
    if (data.env !== undefined && data.env !== guard.appEnv) {
      res.status(403).json({ error: 'invalid_or_expired_token' });
      return;
    }

    // 新形式トークンは診断コードを復号する必要がある。復号に失敗した場合
    // （改ざん、鍵不一致等）は、署名検証は通っていても無効なトークンとして扱う。
    const diagnosisRef = parseDiagnosisReference(resolveDiagnosisCode(secret, data), data);
    if (!diagnosisRef) {
      res.status(403).json({ error: 'invalid_or_expired_token' });
      return;
    }

    // legacy_floor：purchaseブロックが無い（＝旧形式の）トークンは、
    // 署名検証に成功した時点でCORE1閲覧を保証する（後方互換）。
    // purchaseブロックがある新形式トークンは、それ自体からは権限を導出しない
    // （GA4計測専用のため）。
    const floor = new Set();
    // マイページからの再発行トークンはpurchaseブロックを持たないが、旧形式トークンではない。
    // legacy_floorを適用するとDB権利確認を迂回してしまうため、access_modeで明確に除外する。
    if (!data.purchase && data.access_mode !== 'mypage_entitlement_reissue') {
      floor.add('core_analysis_access');
    }

    // DB検索に失敗しても、legacy_floorの保証（旧形式トークン＝CORE1）だけは
    // 必ず維持する。DB由来の権限（新形式トークンの実際の購入内容）は
    // 確認できない場合、安全側に倒して付与しない（空集合のまま扱う）。
    // これにより、DB障害時に旧トークン保有者が一律500で締め出されることを防ぐ。
    let dbPermissions = new Set();
    let dbLookupFailed = false;
    try {
      // v2は接頭辞を含めてハッシュ化されているため、表示用に接頭辞を外す前の
      // referenceを使って購入権限を照合する。
      const hash = hashDiagnosisCode(diagnosisRef.reference);
      dbPermissions = await fetchDbPermissions(guard, hash);
    } catch (err) {
      console.error('report-data error: entitlement lookup failed (falling back to legacy_floor only)', err && err.message);
      dbLookupFailed = true;
    }

    const finalPermissions = new Set([...floor, ...dbPermissions]);

    const responseBody = {
      diagnosis_version: diagnosisRef.diagnosisVersion,
      entitlements: {
        core_analysis_access: finalPermissions.has('core_analysis_access'),
        journey_report_access: finalPermissions.has('journey_report_access'),
      },
      // GA4計測専用。閲覧権限には使わない。旧形式トークンではnull。
      purchase: data.purchase || null,
    };

    // 診断コード自体は、CORE1閲覧権限がある場合にのみレスポンスへ含める。
    // report.html の表示ゲートはUI上の制御に過ぎず、このAPIを直接叩けば
    // 権限が無くてもcodeだけは取得できてしまっていたため、
    // データそのものをサーバー側で絞る（権限が無ければcodeを返さない）。
    if (finalPermissions.has('core_analysis_access')) {
      responseBody.code = diagnosisRef.code;
    }

    if (dbLookupFailed) {
      // DB確認ができなかったことをクライアント側で識別できるようにする
      // （現状report.htmlはこのフィールドを見ないが、将来の商品別表示制御のために残す）。
      responseBody.degraded = true;
    }

    res.status(200).json(responseBody);
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
