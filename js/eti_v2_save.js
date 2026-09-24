// eti_v2_save.js
// ETI v2（新100問）専用の保存クライアント処理。
// 既存の diagnosis-save.js（legacy-v1用）の saveDiagnosisSession() / buildResultPayload() /
// handleSaveResultClick() は一切変更しない。
//
// 依存（このファイルより先に読み込むこと。同一ドキュメント内のclassic scriptとして
// トップレベル字句スコープを共有する前提）：
//   diagnosis-save.js（supabaseClient, getCurrentUser, classifyError, signInWithGoogle等）
//   eti_v2_engine.js（ETIv2 — 実際の計算はここでは行わず、既に計算済みのresultsを受け取る）

// v2結果一式から、RPC呼び出し用のpendingオブジェクトを組み立てる。
// buildResultPayload()（v1）に相当するv2版。
function buildPendingV2(answersV2, encodedAnswers, results, mirrorTop, clientSessionId) {
  return {
    diagnosisType: 'element',
    diagnosisVersion: 'ETI-2.0',
    itemSetVersion: 'ETI-ITEM-2.0.0',
    scoringVersion: 'ETI-SCORE-2.0.0',
    translationModelVersion: (typeof TRANSLATION_MODEL_VERSION !== 'undefined') ? TRANSLATION_MODEL_VERSION : 'ETI-TRANS-2.0.0',
    characterProfileVersion: 'ETI-CHAR-2.0.0',
    mirrorModelVersion: 'ETI-MIRROR-2.0.0',
    clientSessionId: clientSessionId,
    completedAt: new Date().toISOString(),
    answersV2: answersV2,
    encodedAnswers: encodedAnswers,
    results: results,
    mirrorSnapshot: mirrorTop,
    diagnosisCode: encodedAnswers, // v2では圧縮コード自体を診断コードとして扱う
  };
}

/* ============================================================
   pending diagnosis（v1のstashPendingDiagnosis/readPendingDiagnosis/
   clearPendingDiagnosisと同じ考え方。v1側は一切変更せず、v2専用の
   別キー・別関数として独立させる）
   ============================================================ */
const PENDING_KEY_V2 = 'pendingDiagnosis_v2';
// 【P1-5対応】未ログインで保存を試みた場合、100回答・結果がlocalStorageへ入る。
// OAuthを中断した利用者では残り続ける可能性があるため、寿命と検証を設ける
// （v1のpending仕様＝PENDING_KEY／別のキー・別の関数は一切変更しない）。
const PENDING_MAX_AGE_MS_V2 = 24 * 60 * 60 * 1000; // 24時間
const PENDING_REQUIRED_FIELDS_V2 = [
  'diagnosisType', 'diagnosisVersion', 'clientSessionId', 'answersV2', 'encodedAnswers', 'results',
];
const PENDING_KNOWN_DIAGNOSIS_VERSION_V2 = 'ETI-2.0';

function stashPendingDiagnosisV2(pending) {
  try {
    const withMeta = Object.assign({}, pending, { createdAt: Date.now() });
    localStorage.setItem(PENDING_KEY_V2, JSON.stringify(withMeta));
  } catch (e) {
    console.error('pending diagnosis v2 stash failed:', e);
  }
}

// 読み込み時に、壊れたJSON・必須項目欠落・未知version・期限切れ（24時間超）の
// いずれかであれば安全に削除してnullを返す。createdAtが無い（旧形式）場合も
// 安全側に倒して期限切れ扱いにする。
function readPendingDiagnosisV2() {
  let raw;
  try {
    raw = localStorage.getItem(PENDING_KEY_V2);
  } catch (e) {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    clearPendingDiagnosisV2(); // 壊れたJSON：安全に削除
    return null;
  }

  const hasAllFields = PENDING_REQUIRED_FIELDS_V2.every(f => parsed && parsed[f] !== undefined && parsed[f] !== null);
  if (!hasAllFields) {
    clearPendingDiagnosisV2(); // 必須項目欠落：安全に削除
    return null;
  }

  if (parsed.diagnosisVersion !== PENDING_KNOWN_DIAGNOSIS_VERSION_V2) {
    clearPendingDiagnosisV2(); // 未知version：別バージョンのpendingを誤送信しない
    return null;
  }

  const createdAt = parsed.createdAt;
  if (typeof createdAt !== 'number' || (Date.now() - createdAt) > PENDING_MAX_AGE_MS_V2) {
    clearPendingDiagnosisV2(); // 期限切れ（createdAt無しの旧形式も含む）
    return null;
  }

  return parsed;
}
function clearPendingDiagnosisV2() {
  localStorage.removeItem(PENDING_KEY_V2);
}


// v2専用のエラー分類。新設した idempotency_payload_mismatch だけをここで追加し、
// それ以外（auth/incomplete_existing_session/session_conflict等）は既存の
// classifyError()（diagnosis-save.js、legacy-v1と共通）にそのまま委譲する。
// classifyError() 自体は変更しない。
function classifyErrorV2(error) {
  if (!error) return 'unknown';
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('idempotency_payload_mismatch')) return 'idempotency_payload_mismatch';
  return classifyError(error);
}

// 3テーブルへの保存を1トランザクションで行う（save_diagnosis_session_v2）。
// エラー分類は上記classifyErrorV2()を使う（v2固有の1種類だけ追加し、残りは
// 既存のclassifyError()、legacy-v1と共通のエラーコード体系をそのまま使う）。
async function saveDiagnosisSessionV2(pending) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'not_authenticated', errorKind: 'auth' };

  const { error } = await supabaseClient.rpc('save_diagnosis_session_v2', {
    p_diagnosis_type: pending.diagnosisType,
    p_diagnosis_version: pending.diagnosisVersion,
    p_item_set_version: pending.itemSetVersion,
    p_scoring_version: pending.scoringVersion,
    p_translation_model_version: pending.translationModelVersion,
    p_character_profile_version: pending.characterProfileVersion,
    p_mirror_model_version: pending.mirrorModelVersion,
    p_client_session_id: pending.clientSessionId,
    p_completed_at: pending.completedAt,
    p_answers_v2: pending.answersV2,
    p_encoded_answers: pending.encodedAnswers,
    p_personality: pending.results.personality,
    p_style: pending.results.style,
    p_values: pending.results.values,
    p_values_centered: pending.results.valuesCentered,
    p_element_ranking: pending.results.elementRanking,
    p_weapon_ranking: pending.results.weaponRanking,
    p_nation_ranking: pending.results.nationRanking,
    p_mirror_snapshot: pending.mirrorSnapshot,
    p_diagnosis_code: pending.diagnosisCode,
  });

  if (error) {
    return { ok: false, error, errorKind: classifyErrorV2(error) };
  }
  return { ok: true };
}

// index.html（結果画面）から呼ぶ唯一の入口。v1のhandleSaveResultClick()と同じ構造：
// ログイン済みなら即保存、未ログインならpendingを保存してGoogleログインへ遷移し、
// 認証復帰後はonAuthStateChangeが自動で保存する。
// v2専用のGoogleログイン開始。v1のsignInWithGoogle()（redirectToが現在ページの
// クエリ無しURL）は一切変更しない。v2は「?dv=ETI-2.0」というクエリに依存した
// 状態を維持し続けるより、ログイン復帰先を最初から/mypage.htmlに固定する方が
// 堅牢なため、そちらへ直接戻す設計にする（推奨案として提示されたもの）。
// 復帰後は、mypage.html側でも読み込まれるeti_v2_save.jsのonAuthStateChangeが
// pendingDiagnosis_v2を検出して保存し、保存完了後はmypage自身の履歴表示に
// その結果がそのまま反映される。
function signInWithGoogleV2() {
  return supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/mypage.html' },
  });
}

async function handleSaveResultClickV2(answersV2, encodedAnswers, results, mirrorTop, clientSessionId) {
  updateSaveButtonUIV2('saving');
  const pending = buildPendingV2(answersV2, encodedAnswers, results, mirrorTop, clientSessionId);
  stashPendingDiagnosisV2(pending);

  const user = await getCurrentUser();
  if (user) {
    const result = await saveDiagnosisSessionV2(pending);
    if (result.ok) {
      clearPendingDiagnosisV2();
      updateSaveButtonUIV2('saved');
    } else {
      // 【維持】保存失敗時はpendingを消さない。次回リトライできるようにする。
      console.error('ETIv2 save failed:', result.errorKind, result.error);
      updateSaveButtonUIV2('error');
    }
    return result;
  } else {
    // 未ログイン：Googleへ遷移する（v2専用のsignInWithGoogleV2()。
    // 復帰先は/mypage.html固定）。保存は認証復帰後のonAuthStateChangeに委ねる。
    const { error } = await signInWithGoogleV2();
    if (error) {
      // 【4-4対応】OAuth開始自体が失敗した場合、ボタンが「保存中…」のまま
      // 固まらないようにする。pendingは残し、再タップで再試行できるようにする。
      console.error('Google sign-in error (v2):', error);
      updateSaveButtonUIV2('error');
      return { ok: false, error: 'oauth_start_failed', errorKind: 'auth', pendingStashed: true };
    }
    return { ok: false, error: 'not_authenticated', errorKind: 'auth', pendingStashed: true };
  }
}

function updateSaveButtonUIV2(state) {
  const btn = document.getElementById('saveResultBtnV2');
  if (!btn) return;
  const labels = {
    idle: '無料で結果を保存',
    saving: '保存中…',
    saved: '✓ 保存しました',
    error: '保存に失敗しました（再タップで再試行）',
  };
  if (labels[state]) btn.textContent = labels[state];
  btn.disabled = (state === 'saving' || state === 'saved');
}

// 起動時：Googleログインから戻ってきたら、v2のpendingがあれば自動保存する。
// v1側のonAuthStateChangeリスナー（diagnosis-save.js）とは別の、独立したリスナーとして登録する。
// 【重要】このリスナーはindex.html・mypage.htmlの両方で登録されうる。
// mypage.html側では、保存成功後にmypage自身の履歴表示を更新する必要があるため、
// mypage.html側が用意する再読み込みフック（window.refreshMypageHistory、存在すれば）
// を呼ぶ。mypage.htmlが読み込まれていない文脈（例：index.htmlに将来この
// リスナーだけが残るケース）では、このフックが無いため何もしない（安全側）。
//
// 【4-2対応】SIGNED_INだけに依存すると、次のケースを取りこぼす：
//   ・既にログイン済みの利用者がpendingを持ったままmypage.htmlへ来た場合
//     （supabase-jsはこの場合SIGNED_INではなくINITIAL_SESSIONを発火する）
//   ・SIGNED_INとINITIAL_SESSIONがほぼ同時に発火し、二重に保存処理が走る場合
// processPendingDiagnosisV2Once()を、SIGNED_IN・INITIAL_SESSIONの両方から、
// かつページ読み込み時点で既にセッションがあるかの確認からも呼べる、
// 単一の入口として切り出す。in-flight guardで多重発火を防ぐ。
let _pendingDiagnosisV2InFlight = false;

async function processPendingDiagnosisV2Once() {
  if (_pendingDiagnosisV2InFlight) return { ok: false, skipped: 'in_flight' };
  const pending = readPendingDiagnosisV2();
  if (!pending) return { ok: false, skipped: 'no_pending' };

  _pendingDiagnosisV2InFlight = true;
  try {
    const result = await saveDiagnosisSessionV2(pending);
    if (result.ok) {
      clearPendingDiagnosisV2();
      updateSaveButtonUIV2('saved');
      if (typeof window.refreshMypageHistory === 'function') {
        window.refreshMypageHistory();
      }
    }
    // 保存失敗時はpendingを消さない（次回リトライできるようにする。v1と同じ方針）。
    // RPC自体の冪等性（同一client_session_id・同一payloadなら同じsession_idを返す）に
    // 依存してよいが、クライアント側でも無意味な多重発火（同時に2回呼ばれる等）は
    // in-flight guardで避ける。
    return result;
  } finally {
    _pendingDiagnosisV2InFlight = false;
  }
}

if (typeof supabaseClient !== 'undefined') {
  supabaseClient.auth.onAuthStateChange(async (event) => {
    if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
    await processPendingDiagnosisV2Once();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildPendingV2, saveDiagnosisSessionV2, handleSaveResultClickV2, signInWithGoogleV2,
    stashPendingDiagnosisV2, readPendingDiagnosisV2, clearPendingDiagnosisV2,
    processPendingDiagnosisV2Once,
  };
}
