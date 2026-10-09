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
//
// v2（2026-10-07・後方互換）：Preview だけ、完全解析の状態を記録（diagnosis_session_id）ごとに追加で返す。
//   { purchased_by_version: {...}（従来どおり）, completeLookup: "ok"|"failed",
//     records: { "<diagnosis_session_id>": { completeEligible, ineligibleReason, mentorGoal, mentorGoalLocked,
//       checkoutInProgress, completeEntitlement, completeStatus, analysisSource, legacyPurchasePending, repurchaseBlocked } } }
//   ・完全解析の表の読み取りに失敗しても、従来の purchased_by_version は返す（completeLookup = "failed"・records なし）。
//   ・Production では完全解析の表を読まず、応答も従来と同じ（completeLookup・records を付けない）。
//   ・¥2,000 の根拠（analysisSource）は、本人の記録へ固定済みの旧購入権（complete_legacy_bindings）か、
//     記録単位の analysis 権（record_entitlements）だけ。診断コードのハッシュ一致だけの旧購入権は
//     legacyPurchasePending（既存の購入を確認中）として返し、根拠にしない。

const crypto = require('crypto');
const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const CE = require('../lib/complete-eligibility');

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
  async function fetchOwnDiagnosisCodes(conn, userId, rowsOut) {
    const url =
      `${conn.supabaseUrl}/rest/v1/diagnosis_sessions` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&select=id,diagnosis_version,diagnosis_answers(encoded_answers),` +
      `diagnosis_results(diagnosis_version,item_set_version,scoring_version,translation_model_version,` +
      `character_profile_version,mirror_model_version)`;

    const res = await fetchImpl(url, { headers: conn.adminHeaders() });
    if (!res.ok) {
      throw new Error(`diagnosis_sessions lookup failed: ${res.status}`);
    }
    const rows = await res.json();
    if (Array.isArray(rowsOut)) rowsOut.push(...rows);
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

  // ---- 完全解析（v2・Preview だけ） ----
  async function selectRows(conn, path) {
    const res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/${path}`, { headers: conn.adminHeaders() });
    if (!res.ok) throw new Error(`complete lookup failed: ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('complete lookup failed');
    return rows;
  }
  const one = (v) => (Array.isArray(v) ? (v[0] || null) : (v || null));
  const ENTITLEMENT_RANK = { active: 3, suspended: 2, revoked: 1 };

  async function buildCompleteRecords(conn, userId, sessionRows, purchasedHashes) {
    const uid = encodeURIComponent(userId);
    const [ents, goals, orders, reports, bindings] = await Promise.all([
      selectRows(conn, `record_entitlements?user_id=eq.${uid}&select=diagnosis_session_id,right_type,status`),
      selectRows(conn, `record_mentor_goals?user_id=eq.${uid}&select=diagnosis_session_id,goal_id,goal_catalog_version,selected_at,locked_at`),
      selectRows(conn, `complete_orders?user_id=eq.${uid}&select=diagnosis_session_id,status`),
      selectRows(conn, `complete_reports?user_id=eq.${uid}&select=diagnosis_session_id,status,created_at&order=created_at.desc`),
      selectRows(conn, `complete_legacy_bindings?user_id=eq.${uid}&select=diagnosis_session_id,legacy_entitlement_id`),
    ]);
    // 固定済みの旧購入権が今も有効か（無効になった旧購入権は根拠にしない）
    let activeBoundIds = new Set();
    const boundIds = [...new Set(bindings.map((b) => b.legacy_entitlement_id))].filter(CE.isUuid);
    if (boundIds.length) {
      const live = await selectRows(conn,
        `purchase_entitlements?id=in.(${boundIds.join(',')})&status=eq.active&product_type=in.(core1,complete)&select=id`);
      activeBoundIds = new Set(live.map((r) => r.id));
    }
    const by = (rows) => rows.reduce((m, r) => { (m[r.diagnosis_session_id] = m[r.diagnosis_session_id] || []).push(r); return m; }, {});
    const entsBy = by(ents), goalsBy = by(goals), ordersBy = by(orders), reportsBy = by(reports), bindBy = by(bindings);
    const records = {};
    sessionRows.forEach((row) => {
      if (!row || !row.id) return;
      const id = row.id;
      const e = entsBy[id] || [];
      const g = (goalsBy[id] || [])[0] || null;
      const st = (ordersBy[id] || []).map((o) => o.status);
      const rep = (reportsBy[id] || []).find((r) => r.status !== 'revoked') || (reportsBy[id] || [])[0] || null;
      const completeRows = e.filter((x) => x.right_type === 'complete').sort((a, b) => (ENTITLEMENT_RANK[b.status] || 0) - (ENTITLEMENT_RANK[a.status] || 0));
      const hasRecordAnalysis = e.some((x) => x.right_type === 'analysis' && x.status === 'active');
      const hasBoundLegacy = (bindBy[id] || []).some((b) => activeBoundIds.has(b.legacy_entitlement_id));
      const answers = one(row.diagnosis_answers);
      const hash = CE.legacyCodeHash(answers && answers.encoded_answers, row.diagnosis_version);
      const eligibility = CE.eligibilityOf(row.diagnosis_version, one(row.diagnosis_results));
      records[id] = {
        completeEligible: eligibility.eligible,
        ineligibleReason: eligibility.reason,
        mentorGoal: g && CE.isMentorGoalId(g.goal_id)
          ? { goalId: g.goal_id, goalCatalogVersion: g.goal_catalog_version, selectedAt: g.selected_at } : null,
        mentorGoalLocked: !!(g && g.locked_at),
        checkoutInProgress: st.some((s) => CE.CHECKOUT_IN_PROGRESS_STATUSES.includes(s)),
        completeEntitlement: completeRows.length ? completeRows[0].status : null,
        completeStatus: rep ? rep.status : 'none',
        analysisSource: hasRecordAnalysis ? 'record_entitlement' : (hasBoundLegacy ? 'legacy_purchase_entitlement' : null),
        legacyPurchasePending: !!(hash && purchasedHashes.has(hash) && !hasBoundLegacy),
        repurchaseBlocked: completeRows.length > 0 || st.some((s) => CE.REPURCHASE_BLOCKING_ORDER_STATUSES.includes(s)),
      };
    });
    return records;
  }

  async function withComplete(conn, userId, sessionRows, purchasedHashes, payload) {
    // Preview・Production だけ（環境不明では応答を従来と同じにする）。complete 系の表が無い（migration 適用前）時は completeLookup: failed
    if (conn.appEnv !== 'preview' && conn.appEnv !== 'production') return payload;
    try {
      const records = await buildCompleteRecords(conn, userId, sessionRows, purchasedHashes);
      // 記録単位の解析権（¥1,000・¥3,000・引き継いだゲスト購入）も「解析レポート購入済み」に数える（旧 ¥1,000 と同じ扱い）
      sessionRows.forEach((row) => {
        const rec = row && records[row.id];
        const a = one(row.diagnosis_answers);
        if (rec && rec.analysisSource === 'record_entitlement' && row.diagnosis_version === 'ETI-2.0' && a && a.encoded_answers) {
          payload.purchased_by_version[`ETI-2.0:${a.encoded_answers}`] = true;
        }
      });
      return Object.assign(payload, { completeLookup: 'ok', records });
    } catch (err) {
      console.error('my-entitlements complete lookup failed');
      return Object.assign(payload, { completeLookup: 'failed' });
    }
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

      const sessionRows = [];
      const codes = await fetchOwnDiagnosisCodes(guard, userId, sessionRows);
      if (codes.length === 0) {
        res.status(200).json(await withComplete(guard, userId, sessionRows, new Set(), { purchased_by_version: {} }));
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

      res.status(200).json(await withComplete(guard, userId, sessionRows, purchasedHashes, { purchased_by_version: purchasedByVersion }));
    } catch (err) {
      console.error('my-entitlements error:', err && err.message);
      res.status(500).json({ error: 'lookup_failed' });
    }
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
