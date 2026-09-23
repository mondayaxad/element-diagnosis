/* ============================================================
   元素診断・診断結果保存基盤 v1（リリースB版：Vercel Preview上の保存基盤テスト用）

   【重要】このファイル単体を本番へ配置しても機能しない。
   現行本番index.htmlには保存UI（saveResultBtn等）・認証導線・
   buildResultPayload()/handleSaveResultClick()の呼び出しが存在しないため、
   このJSを読み込んでも呼び出されるコードがない。

   このファイルは「保存基盤（RPC・認証・pending diagnosis）が
   正しく動くか」をVercel Previewで検証するためのものであり、
   一般公開（本番index.htmlの差し替え）は別の作業として扱う。

   一般公開には、少なくとも次を互換性のある1セットとして用意する必要がある
   （このファイル単体の変更では足りない）：
     ・保存UIを含む index.html
     ・このファイルに対応する diagnosis-save.js
     ・mypage.html（現在は404）
     ・/api/subscribe
     ・Google認証設定
     ・プライバシーポリシーの更新（保存機能を公開する事実に合わせる）
   0921版index.htmlが前提にしている trackEvent / hasDecidedNewsletter /
   認証トークン付きsubscribeToNewsletter / 保存成功後のマイページ遷移とは
   まだ完全互換ではないため、それらと組み合わせる場合は個別に整合を確認すること。

   ベース：現在の本番ファイル（直接3回INSERT版）。
   本番からの変更点はこの3つのみ：
     1. CHARACTER_DB_VERSION 定数を新設
     2. buildResultPayload() に ennea_sorted / character_db_version を追加
     3. saveDiagnosisSession() を save_diagnosis_session RPC（v3）の呼び出しへ変更。
        RPCが冪等性・不完全保存を判定するようになったため、クライアント側で
        23505を一律成功扱いにする処理は削除した（エラーコードで個別に分岐する）。

   loadDiagnosisHistory() は本番のまま無変更。
   ============================================================ */

// ---- 設定（実際の値に差し替える） ----
const SUPABASE_URL = 'https://akivoobkqcnqvdumxtmg.supabase.co'; // release-c-preview専用：テスト用Supabaseプロジェクト
const SUPABASE_ANON_KEY = 'sb_publishable_ebFsEEouWTvJKOpk6ytYYQ_V0cOqtgl'; // release-c-preview専用：テスト用プロジェクトのpublishable key

// diagnosis_type / version は既存ロジックと結果の形が変わったときだけ上げる
const DIAGNOSIS_TYPE = 'element';
const DIAGNOSIS_VERSION = 'element-v1';
const SCORING_VERSION = 'element-score-v1';

// リリースBで新設。キャラクターDB（CHARACTERS配列）の内容を変更したときだけ上げる。
const CHARACTER_DB_VERSION = 'char-db-v1';

const PENDING_KEY = 'pendingDiagnosis_v1';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================================================
   履歴取得（本番のまま無変更）
   購入権限・report_snapshotsの参照は、マイページ専用権限API完成後に
   別途追加する（リリースE）。ここで先取りしない。
   ============================================================ */

async function loadDiagnosisHistory(diagnosisType) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  // 【修正】v1/v2両方のセッションを1回で取得できるよう、v2列
  // （item_set_version・v2_scores・v2_rankings・mirror_snapshot）もselectに追加する。
  // diagnosis_versionが無い（またはlegacy値の）行はv1、'ETI-2.0'の行はv2として、
  // 呼び出し側（mypage.html）でversion分岐して描画する。
  const { data, error } = await supabaseClient
    .from('diagnosis_sessions')
    .select(
      'id, completed_at, diagnosis_type, diagnosis_version, item_set_version, ' +
      'diagnosis_results(primary_result, scores, character_matches, diagnosis_code, ' +
      'item_set_version, scoring_version, translation_model_version, character_profile_version, ' +
      'mirror_model_version, v2_scores, v2_rankings, mirror_snapshot), ' +
      'diagnosis_answers(encoded_answers)'
    )
    .eq('user_id', user.id)
    .eq('diagnosis_type', diagnosisType)
    .order('completed_at', { ascending: false });

  if (error) return { ok: false, error };

  const sessions = (data || []).map(row => {
    const r = Array.isArray(row.diagnosis_results) ? row.diagnosis_results[0] : row.diagnosis_results;
    const a = Array.isArray(row.diagnosis_answers) ? row.diagnosis_answers[0] : row.diagnosis_answers;
    const isV2 = row.diagnosis_version === 'ETI-2.0';
    return {
      id: row.id,
      completedAt: row.completed_at,
      diagnosisVersion: row.diagnosis_version || 'legacy-v1',
      isV2: isV2,
      // v1正本（isV2がfalseの場合のみ意味を持つ。v2行ではlegacy互換の'{}'が入っているだけなので、
      // isV2がtrueの場合はこれらを一切参照してはならない）
      primaryResult: !isV2 && r ? r.primary_result : null,
      scores: !isV2 && r ? r.scores : null,
      characterMatches: !isV2 && r ? r.character_matches : null,
      // v2正本（isV2がtrueの場合のみ意味を持つ）
      v2Scores: isV2 && r ? r.v2_scores : null,
      v2Rankings: isV2 && r ? r.v2_rankings : null,
      mirrorSnapshot: isV2 && r ? r.mirror_snapshot : null,
      itemSetVersion: isV2 ? (row.item_set_version || (r && r.item_set_version)) : null,
      diagnosisCode: r ? r.diagnosis_code : null,
      encodedAnswers: a ? a.encoded_answers : null,
      purchased: false, // 後段でfetchPurchasedStatus()の結果を使って上書きする
    };
  });

  // 【修正】これまで呼ばれていなかった/api/my-entitlementsを実際に呼び、
  // sessionsへpurchasedフラグを反映する。以前はここが未接続で、
  // purchasedが常にundefined（＝常に未解放表示）になっていた。
  try {
    await attachPurchasedStatus(sessions);
  } catch (e) {
    console.error('entitlement check failed (mypage will show as unpurchased):', e);
    // 購入状態が確認できなくても、診断履歴自体の表示は継続する
  }

  return { ok: true, sessions };
}

// /api/my-entitlements を呼び、本人の診断コードの購入状態をsessionsへ反映する。
// my-entitlements.js側は、v1・v2どちらのencoded_answersも区別なく扱う設計のため
// （purchase_entitlements.diagnosis_code_hashは形式に依存しないハッシュ値）、
// ここでもv1/v2を区別せず、まとめて1回のAPI呼び出しで済ませる。
async function attachPurchasedStatus(sessions) {
  const { data: { session: authSession } } = await supabaseClient.auth.getSession();
  const accessToken = authSession && authSession.access_token;
  if (!accessToken) return;

  const res = await fetch('/api/my-entitlements', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return;

  const body = await res.json();
  const purchasedCodes = new Set(Object.keys(body.purchased || {}));
  sessions.forEach(s => {
    if (s.encodedAnswers && purchasedCodes.has(s.encodedAnswers)) {
      s.purchased = true;
    }
  });
}

/* ============================================================
   認証（本番のまま無変更）
   ============================================================ */

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('?')[0] }
  });
  if (error) console.error('Google sign-in error:', error);
}

async function signInWithMagicLink(email) {
  const { error } = await supabaseClient.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: window.location.href.split('?')[0] }
  });
  return error;
}

async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

async function signOutUser() {
  await supabaseClient.auth.signOut();
}

/* ============================================================
   pending diagnosis（本番のまま無変更）
   ============================================================ */

function stashPendingDiagnosis(answers, results, encodedAnswers, newsletterOptIn) {
  const pending = {
    clientSessionId: crypto.randomUUID(),
    diagnosisType: DIAGNOSIS_TYPE,
    diagnosisVersion: DIAGNOSIS_VERSION,
    scoringVersion: SCORING_VERSION,
    completedAt: new Date().toISOString(),
    answers: answers,
    encodedAnswers: encodedAnswers,
    results: results,
    newsletterOptIn: !!newsletterOptIn,
  };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (e) {
    console.error('pending diagnosis stash failed:', e);
  }
  return pending.clientSessionId;
}

function readPendingDiagnosis() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearPendingDiagnosis() {
  localStorage.removeItem(PENDING_KEY);
}

/* ============================================================
   保存本体（変更箇所）
   ============================================================ */

function buildResultPayload(results, topEl, topW, et, topNat) {
  // 保存するのは「後から再利用できる情報量」まで。
  // charMatchesはキャラの全プロフィールを複製せず、必要最小限に絞る。
  return {
    primary_result: {
      element: topEl,
      weapon: topW,
      nation: topNat,
      enneagram_type: et,
      enneagram_wing: results.enneaWing ? results.enneaWing.type : null,
    },
    scores: {
      big5: results.big5,
      elements: results.elementScores,
      weapons: results.weaponScores,
      nations: results.nationScores,
    },
    character_matches: results.charMatches.slice(0, 4).map(c => ({
      name: c.name, match: c.match, el: c.el, w: c.w, nation: c.nation, ennea: c.ennea
    })),
    // リリースBで追加（CORE2「アナタの旅路」のデータ保存契約）。
    // computeResults()が既に返している enneaSorted をそのまま保存する。
    ennea_sorted: results.enneaSorted,
    character_db_version: CHARACTER_DB_VERSION,
  };
}

// 変更点：直接3回INSERT → save_diagnosis_session RPC（v3）へ切替。
// RPC側が「新規保存」「冪等な再実行」「不完全な既存セッション」「他ユーザーとの衝突」を
// 区別して返すようになったため、クライアント側で23505を一律成功扱いにする処理は行わない。
// 戻り値: { ok: true } | { ok: false, error, errorKind }
async function saveDiagnosisSession(pending) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'not_authenticated', errorKind: 'auth' };

  const { error } = await supabaseClient.rpc('save_diagnosis_session', {
    p_diagnosis_type:    pending.diagnosisType,
    p_diagnosis_version: pending.diagnosisVersion,
    p_scoring_version:   pending.scoringVersion,
    p_client_session_id: pending.clientSessionId,
    p_completed_at:      pending.completedAt,
    p_answers:           pending.answers,
    p_encoded_answers:   pending.encodedAnswers,
    p_primary_result:    pending.results.primary_result,
    p_scores:            pending.results.scores,
    p_character_matches: pending.results.character_matches,
    p_diagnosis_code:    pending.encodedAnswers ? pending.diagnosisCode : null,
    p_ennea_sorted:         pending.results.ennea_sorted || null,
    p_character_db_version: pending.results.character_db_version || null,
  });

  if (error) {
    // RPCが返しうる個別のエラーを区別する。ここでは「成功扱いへ読み替える」ことはしない。
    //   incomplete_existing_session          … 同じclient_session_idの既存セッションに
    //                                           answers/resultsの一方が欠けている
    //                                           （旧・直接INSERT版時代の不完全保存の可能性）。
    //                                           利用者に再試行を促す（新しいclient_session_idで
    //                                           もう一度送るのではなく、原因調査が必要）
    //   conflicting_session_not_found         … client_session_idが衝突したが、
    //                                           呼び出し元からはその既存行が見えなかった場合。
    //                                           save_diagnosis_sessionはSECURITY INVOKERであり
    //                                           RLS（diagnosis_sessionsのSELECTはauth.uid()=user_id
    //                                           のみ許可）が適用されるため、別ユーザーの行との
    //                                           衝突は「見つからない」という形でここに現れる。
    //                                           実務上、別ユーザーとの衝突はこちらに到達する。
    //   client_session_id_conflict_other_user … RPC内に防御的に残しているコードパスだが、
    //                                           上記の理由により通常は到達しない
    //                                           （RLSが先に対象行を除外するため）。
    //                                           SECURITY DEFINERへは変更していない。
    //   not_authenticated                     … 未ログイン
    // これら以外は unknown として扱う。いずれも ok:false のまま返し、
    // 呼び出し側のUIでエラー表示・再試行導線につなげる。
    return { ok: false, error, errorKind: classifyError(error) };
  }
  // エラーが無ければ、新規保存・冪等な再実行のいずれであっても成功として扱ってよい
  // （RPCがどちらの場合も同じsession_idを一貫して返す設計のため、クライアント側で
  //   区別する必要がない）
  return { ok: true };
}

function classifyError(error) {
  if (!error) return 'unknown';
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('not_authenticated')) return 'auth';
  if (msg.includes('incomplete_existing_session')) return 'incomplete_existing_session';
  // client_session_id_conflict_other_user は SECURITY INVOKER + RLS の下では
  // 実際にはほぼ到達しない（下記コメント参照）。conflicting_session_not_found と
  // 同じ「安全側の失敗」として同一のerrorKindにまとめる。
  if (msg.includes('client_session_id_conflict_other_user')) return 'session_conflict';
  if (msg.includes('conflicting_session_not_found')) return 'session_conflict';
  return 'unknown';
}

// メルマガ同意があった場合にサーバー経由でKitへ登録する。
// 失敗しても診断結果の保存自体には影響させない（サイレントに諦める）。
async function subscribeToNewsletter(email) {
  if (!email) return;
  try {
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (e) {
    console.error('newsletter subscribe failed:', e);
  }
}

/* ============================================================
   起動時：認証完了で戻ってきたらpending diagnosisを保存する（本番のまま無変更）
   ============================================================ */

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (event !== 'SIGNED_IN') return;
  const pending = readPendingDiagnosis();
  if (!pending) return;

  const result = await saveDiagnosisSession(pending);
  if (result.ok) {
    clearPendingDiagnosis();
    updateSaveButtonUI('saved');
    if (pending.newsletterOptIn) {
      const user = await getCurrentUser();
      subscribeToNewsletter(user ? user.email : null);
    }
  } else {
    // 保存失敗時もpendingは消さない。次回リトライできるようにする
    console.error('diagnosis save failed:', result.error);
    updateSaveButtonUI('error');
  }
});

/* ============================================================
   結果画面のCTA（本番のまま無変更）
   ============================================================ */

async function handleSaveResultClick(answers, results, encodedAnswers, diagnosisCode, newsletterOptIn) {
  updateSaveButtonUI('saving');
  const user = await getCurrentUser();

  const pendingId = stashPendingDiagnosis(answers, results, encodedAnswers, newsletterOptIn);
  const pending = readPendingDiagnosis();
  pending.diagnosisCode = diagnosisCode;
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  if (user) {
    const result = await saveDiagnosisSession(pending);
    if (result.ok) {
      clearPendingDiagnosis();
      updateSaveButtonUI('saved');
      if (pending.newsletterOptIn) subscribeToNewsletter(user.email);
    } else {
      updateSaveButtonUI('error');
    }
  } else {
    // 未ログイン：Googleをメインに提示。認証完了後はonAuthStateChangeが自動保存する
    await signInWithGoogle();
    // ここでページ遷移するため、以降の処理は認証復帰後のonAuthStateChangeに委ねる
  }
}

function updateSaveButtonUI(state) {
  const btn = document.getElementById('saveResultBtn');
  if (!btn) return;
  const labels = {
    idle_out: '無料で結果を保存',
    idle_in: 'この結果を保存',
    saving: '保存中…',
    saved: '✓ 保存しました',
    error: '保存に失敗しました（再タップで再試行）',
  };
  btn.textContent = labels[state] || labels.idle_out;
  btn.disabled = (state === 'saving' || state === 'saved');
}

/* ============================================================
   呼び出し例（参考・保存UI組み込み時にそのまま使う想定）
   ------------------------------------------------------------
   現行本番index.htmlにはこの呼び出し自体が存在しない（本ファイル冒頭の
   注記の通り）。将来、保存UIを持つindex.html（一般公開版 or
   index_release-b.html）へ組み込む際の呼び出し形はこれに合わせること。

   buildResultPayload() の第5引数は topNat（国家）であり、
   results.enneaWing ではない。また handleSaveResultClick() は
   第5引数に newsletterOptIn を渡す必要がある（省略すると
   pending.newsletterOptIn が常に undefined になり、
   メルマガ同意があってもsubscribeToNewsletter()が呼ばれない）。

   var resultPayload = buildResultPayload(results, topEl, topW, et, topNat);
   handleSaveResultClick(
     answers,
     resultPayload,
     shortCode,
     applyData,
     newsletterOptIn
   );
   ============================================================ */
