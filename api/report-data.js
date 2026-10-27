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
//  10. 閲覧のたびに、トークンの種類ごとの規則で DB の権利を確かめる（complete_08。D5・D6）。
//      再発行トークン（マイページ・ゲスト）は記録（sid）・本人（uid）を持ち、その記録の有効な解析権だけを見る
//      （同じ診断コードを持つ別の本人の権利は使わない）。旧購入は返金・取消・運営者の停止で読めなくなる。
//      DB を確かめられない時は 503（verify・再発行・固有リンクは、確かめずに表示しない）。
//      応答は Cache-Control: private, no-store
//  11. 旧購入者保護（S0・2026-10-21）：旧形式（legacy_floor）のトークンだけは、DB への接続・照合が一時的に失敗しても
//      現行の本番（main）と同じく表示する（DB の障害で旧購入者を締め出さない）。ただし：
//        ・DB に届いて「停止・取消（legacy_access_blocks）」や「返金済み（有効な行が無い）」を確かめられた時は表示しない
//        ・署名・期限・復号の失敗は従来どおり 403（DB の状態に関係なく表示しない）
//        ・verify（purchase 付き）・マイページ／ゲストの再発行・固有リンク（delivery）は従来どおり 503
//        ・「DB に届いて停止が無い」と「DB の障害で確かめられない」を legacyFacts の結果で分けて扱う
//      ログには理由の種類だけを出し、URL・トークン・診断コード・メール・利用者 ID は出さない
//
// 署名検証・有効期限確認の中核ロジックは本番版から変更していない。

const crypto = require('crypto');
const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const PS = require('../lib/purchase-state');

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// トークンの種類（権利の確認方法が違う）
//   mypage：マイページからの再発行（sid・uid 付き）。その本人の記録の解析権（lib/purchase-state.js と同じ規則）
//   guest：ゲスト購入の端末からの再発行（sid 付き）。未引き継ぎのゲスト記録の有効な解析権
//   verify：旧 ¥1,000 の決済完了（purchase ブロック付き・決済の確認の時に署名）。同じ診断コードの有効な旧購入
//   legacy_floor：旧形式（purchase も access_mode も無い）。旧購入が返金・取消・停止されていなければ読める
//   それ以外（access_mode が不明・sid の無い再発行トークン）は受け付けない
function tokenKind(data) {
  if (data.access_mode === 'mypage_entitlement_reissue') {
    return typeof data.sid === 'string' && UUID_RE.test(data.sid) && typeof data.uid === 'string' && UUID_RE.test(data.uid) ? 'mypage' : null;
  }
  // レポート固有リンク・マイページの登録（complete_13）：納品（did）と記録（sid）を持つ。閲覧のたびに納品と注文の状態を確かめる
  if (data.access_mode === 'delivery') {
    return typeof data.did === 'string' && UUID_RE.test(data.did) && typeof data.sid === 'string' && UUID_RE.test(data.sid) ? 'delivery' : null;
  }
  if (data.access_mode === 'guest_entitlement_reissue') {
    return typeof data.sid === 'string' && UUID_RE.test(data.sid) ? 'guest' : null;
  }
  if (data.access_mode !== undefined) return null;
  return data.purchase ? 'verify' : 'legacy_floor';
}

function setNoStore(res) {
  if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'private, no-store');
}

function createHandler({ env, fetchImpl }) {
  async function select(conn, path) {
    const res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/${path}`, { headers: conn.adminHeaders() });
    // 応答本文はログ・例外へ含めない（ステータスだけ）。
    if (!res.ok) throw new Error(`lookup failed: ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('lookup failed');
    return rows;
  }

  // 旧購入（purchase_entitlements）：診断コードのハッシュ単位。運営者が停止・取消したものは数えない（complete_08 §2）
  //   2つの照合を別々に扱い、DB に届いて分かった事実（rows・blocked）と、確かめられなかったこと（unconfirmed）を分ける。
  //   rows：旧購入の行（null＝照合できなかった）／blocked：true＝停止・取消を確認・false＝停止なしを確認・null＝照合できなかった
  async function legacyFacts(conn, hash) {
    const [rowsR, blockedR] = await Promise.allSettled([
      select(conn, `purchase_entitlements?diagnosis_code_hash=eq.${hash}&select=product_type,status`),
      PS.blockedLegacyHashes((path) => select(conn, path), [hash]),
    ]);
    const rows = rowsR.status === 'fulfilled' ? rowsR.value : null;
    const blocked = blockedR.status === 'fulfilled' ? blockedR.value.has(hash) : null;
    const permissions = new Set();
    if (rows && blocked === false) {
      for (const row of rows) {
        if (row.status !== 'active') continue;
        (PRODUCT_PERMISSIONS[row.product_type] || []).forEach((p) => permissions.add(p));
      }
    }
    const failed = [rowsR, blockedR].find((r) => r.status === 'rejected');
    return { rows, blocked, permissions, unconfirmed: rows === null || blocked === null, error: failed ? failed.reason : null };
  }

  // 記録の診断コードのハッシュがトークンの診断コードと一致すること（別の記録・別の結果へ流用させない）
  function sessionMatches(session, hash) {
    return !!session && PS.keyOf(session) === hash;
  }

  // 旧購入を診断コードのハッシュで読むのは、署名付きの旧リンク（verify・legacy_floor：決済の完了・発行の時に署名した、
  //   所有の根拠のあるリンク）だけ。マイページ・ゲストの再発行（mypage・guest）は、その本人の記録の権利だけで決める
  //   （同じ回答の別人の旧購入を数えない。complete_10・2026-10-14）
  async function permissionsFor(conn, kind, data, hash) {
    if (kind === 'verify' || kind === 'legacy_floor') return legacyPermissions(conn, kind, hash);
    if (kind === 'mypage') {
      const st = PS.computeStates(await PS.loadUserFacts((path) => select(conn, path), data.uid))[data.sid];
      const core = !!(st && st.analysisAccess && sessionMatches(st.record.session, hash));
      // レポート末尾の案内。この本人・この記録の権利からサーバーが決める（参照元・URL では決めない）：
      //   owned（完全解析を有効に持つ）／owned_inactive（購入済みだが停止・返金などで今は読めない）／analysis_upgrade（追加 ¥2,000）／
      //   legacy（旧バージョン）／suspended（確認中）／null（出さない）
      const complete = !core ? null
        : st.completeOwned ? (st.completeEntitlement === 'active' && !st.target.basisInactive ? 'owned' : 'owned_inactive')
        : st.completeOffer === 'analysis_upgrade' ? 'analysis_upgrade'
        : st.completeBlocked === 'legacy_purchase_not_eligible' ? 'legacy'
        : st.completeBlocked === 'rights_suspended' ? 'suspended' : null;
      return { core, journey: false, complete };
    }
    // guest：未引き継ぎ（user_id が無い）ゲスト記録の、有効な解析権
    if (kind === 'delivery') {
      const [dels, sessions] = await Promise.all([
        select(conn, `report_deliveries?id=eq.${data.did}&select=status,order_id,product,diagnosis_session_id`),
        select(conn, `diagnosis_sessions?id=eq.${data.sid}&select=id,user_id,diagnosis_version,diagnosis_answers(encoded_answers)`),
      ]);
      const d = dels[0];
      if (!d || d.status !== 'active' || d.product !== 'analysis' || d.diagnosis_session_id !== data.sid) return { core: false, journey: false };
      const orders = await select(conn, `complete_orders?id=eq.${d.order_id}&select=status`);
      return { core: !!(orders[0] && orders[0].status === 'paid' && sessionMatches(sessions[0], hash)), journey: false };
    }
    const [sessions, rights] = await Promise.all([
      select(conn, `diagnosis_sessions?id=eq.${data.sid}&select=id,user_id,diagnosis_version,diagnosis_answers(encoded_answers)`),
      select(conn, `record_entitlements?diagnosis_session_id=eq.${data.sid}&right_type=eq.analysis&status=eq.active&select=user_id`),
    ]);
    const s = sessions[0];
    return { core: !!(s && s.user_id == null && rights.some((r) => r.user_id == null) && sessionMatches(s, hash)), journey: false };
  }

  async function legacyPermissions(conn, kind, hash) {
    const legacy = await legacyFacts(conn, hash);
    // verify：DB の権利だけで決める。確かめられなければ 503（従来どおり）
    if (kind === 'verify') {
      if (legacy.unconfirmed) throw legacy.error || new Error('lookup failed');
      return { core: legacy.permissions.has('core_analysis_access'), journey: legacy.permissions.has('journey_report_access') };
    }
    // 署名付きの旧形式リンク（legacy_floor）：旧購入の行が無い時代の発行分もあるため、行が無ければ従来どおり読める。
    // 行があってどれも有効でない（返金・取消）、または運営者が停止・取消した場合は読めない（D6）。
    // DB に届いて確かめられた「停止・取消」「返金済み」は、もう一方の照合が失敗していても優先して止める。
    if (legacy.blocked === true) return { core: false, journey: false };
    const refunded = legacy.rows !== null && legacy.rows.length > 0 && !legacy.rows.some((r) => r.status === 'active');
    if (refunded) return { core: false, journey: false };
    if (legacy.unconfirmed) {
      // S0：DB の障害で確かめられない。現行 main と同じく、旧形式のリンクは CORE1 だけ表示する（DB 由来の権限は付けない）
      return { core: true, journey: false, unconfirmed: true };
    }
    return { core: true, journey: legacy.permissions.has('journey_report_access') };
  }

  return async function handler(req, res) {
    setNoStore(res);
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

    const kind = tokenKind(data);
    if (!kind) {
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

    // 閲覧のたびに DB で権利を確かめる（期限内のトークン・旧形式のリンクでも省かない。D6）。
    // 確かめられない時は表示しない（503。返金・停止後に読めてしまわないように）
    let perms;
    try {
      // v2は接頭辞を含めてハッシュ化されているため、表示用に接頭辞を外す前のreferenceを使う。
      perms = await permissionsFor(guard, kind, data, hashDiagnosisCode(diagnosisRef.reference));
    } catch (err) {
      console.error('report-data error: entitlement lookup failed', err && err.message);
      res.status(503).json({ error: 'temporarily_unavailable' });
      return;
    }

    if (!perms.core && !perms.journey) {
      res.status(403).json({ error: 'not_entitled' });
      return;
    }
    if (perms.unconfirmed) {
      // 理由の種類だけ（URL・トークン・診断コード・利用者 ID は出さない）
      console.error('report-data warning: legacy_floor served without DB confirmation (S0)');
    }

    const responseBody = {
      diagnosis_version: diagnosisRef.diagnosisVersion,
      entitlements: {
        core_analysis_access: perms.core,
        journey_report_access: perms.journey,
      },
      // GA4計測専用。閲覧権限には使わない。旧形式トークンではnull。
      purchase: data.purchase || null,
    };

    // 診断コード自体は、CORE1閲覧権限がある場合にのみレスポンスへ含める。
    // viewer：このリンクの発行元（guest＝ゲスト購入の端末・mypage＝マイページ・legacy＝旧形式）。
    //   レポート末尾の完全解析の案内を出し分けるためだけに使う（権利の判定には使わない。記録 ID・本人は返さない）
    if (perms.core) {
      responseBody.code = diagnosisRef.code;
      responseBody.viewer = kind === 'guest' ? 'guest' : kind === 'mypage' ? 'mypage' : kind === 'delivery' ? 'delivery' : 'legacy';
      if (kind === 'mypage') responseBody.complete = perms.complete || null;
    }

    res.status(200).json(responseBody);
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
module.exports.tokenKind = tokenKind;
