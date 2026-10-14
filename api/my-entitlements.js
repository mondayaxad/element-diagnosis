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
//   ・¥2,000 の根拠（analysisSource）は、記録単位の新 Checkout の analysis 権（record_entitlements）だけ（旧購入は根拠にしない）。
//   ・ETI-2.0 の purchased_by_version は、本人の記録の権利（lib/purchase-state.js の analysisAccess）だけで決める
//     （complete_10・2026-10-14）。診断コードのハッシュの一致だけの旧購入は、同じ回答の別人の購入の場合があるため数えない。
//     element-v1 も同じ（本人に結び付け済みの旧購入だけ）。署名付きの旧リンク（メール・購入完了）での閲覧は変えない。
//   ・判定は lib/purchase-state.js（completeOffer：analysis_upgrade／direct_complete、completeBlocked：購入できない理由、
//     duplicateOf：同じ診断結果の表示の正本）。repurchaseBlocked は完全解析を購入済み（解析レポートだけの購入は含まない）。

const { requireServerEnv, requestHost, logEnvDenied } = require('../lib/server-env');
const PS = require('../lib/purchase-state');

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

  // ---- 完全解析（v2） ----
  // 記録ごとの状態は lib/purchase-state.js（決済・目標の選択・閲覧と同じ規則）。同じ本人・同じ診断結果の記録は1つの権利として扱い、
  // 表示の正本以外の記録には duplicateOf（正本の記録 ID）を付ける（マイページは正本だけを出す）。
  async function selectRows(conn, path) {
    const res = await fetchImpl(`${conn.supabaseUrl}/rest/v1/${path}`, { headers: conn.adminHeaders() });
    if (!res.ok) throw new Error(`complete lookup failed: ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('complete lookup failed');
    return rows;
  }

  async function withComplete(conn, userId, sessionRows, payload) {
    // Preview・Production だけ（環境不明では応答を従来と同じにする）。complete 系の表が無い（migration 適用前）時は completeLookup: failed
    if (conn.appEnv !== 'preview' && conn.appEnv !== 'production') return payload;
    try {
      const states = PS.computeStates(await PS.loadUserFacts((path) => selectRows(conn, path), userId));
      const records = {};
      Object.keys(states).forEach((id) => { records[id] = PS.publicRecordState(states[id]); });
      // 本人の記録の解析権（¥1,000・¥3,000・引き継いだゲスト購入・本人に結び付け済みの旧購入）だけ
      sessionRows.forEach((row) => {
        const rec = row && records[row.id];
        const a = PS.one(row.diagnosis_answers);
        if (rec && rec.analysisAccess && a && a.encoded_answers) {
          const version = row.diagnosis_version === 'ETI-2.0' ? 'ETI-2.0' : 'element-v1';
          payload.purchased_by_version[`${version}:${a.encoded_answers}`] = true;
        }
      });
      // 診断結果ごとの状態（結果ページで、ログイン中の本人の購入に合わせて「読む・見る・追加 ¥2,000」を出すため）。
      //   本人が保存している診断コードだけをキーにし、記録 ID・注文は含めない。同じ結果の記録が複数なら表示の正本の状態
      const resultStates = {};
      sessionRows.forEach((row) => {
        const rec = row && records[row.id];
        const a = PS.one(row.diagnosis_answers);
        if (!rec || rec.duplicateOf || !a || !a.encoded_answers || row.diagnosis_version !== 'ETI-2.0') return;
        resultStates[`ETI-2.0:${a.encoded_answers}`] = {
          analysisAccess: rec.analysisAccess, analysisPurchased: rec.analysisPurchased, legacyAnalysis: rec.legacyAnalysis,
          completeOffer: rec.completeOffer, completeBlocked: rec.completeBlocked, completeEntitlement: rec.completeEntitlement,
          completeStatus: rec.completeStatus, checkoutInProgress: rec.checkoutInProgress, completeViewBlocked: rec.completeViewBlocked,
        };
      });
      payload.result_states = resultStates;
      return Object.assign(payload, { completeLookup: 'ok', records });
    } catch (err) {
      console.error('my-entitlements complete lookup failed');
      return Object.assign(payload, { completeLookup: 'failed' });
    }
  }

  return async function handler(req, res) {
    // 本人ごとの購入権の情報：共有キャッシュにも、ブラウザの再検証（304）にも依存しない（成功・失敗とも）
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'private, no-store');
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
      await fetchOwnDiagnosisCodes(guard, userId, sessionRows);
      res.status(200).json(await withComplete(guard, userId, sessionRows, { purchased_by_version: {} }));
    } catch (err) {
      console.error('my-entitlements error:', err && err.message);
      res.status(500).json({ error: 'lookup_failed' });
    }
  };
}

module.exports = createHandler({ env: process.env, fetchImpl: (...args) => fetch(...args) });
module.exports.createHandler = createHandler;
