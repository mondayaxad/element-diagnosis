/* ============================================================
   元素診断・診断結果保存基盤 v1
   Phase 3: Supabase Auth（Google OAuth メイン＋Email Magic Link併用）
   Phase 4: pending diagnosis（認証を跨いでも診断結果を失わない）
   Phase 5: diagnosis_session保存（保存機能そのもの）
   Phase 6: 結果画面への保存CTA

   使い方:
   1. index.html の </head> 直前に以下を追加:
        <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
        <script src="diagnosis-save.js"></script>
   2. 下の SUPABASE_URL / SUPABASE_ANON_KEY を実際の値に差し替える
      （anon keyはRLS前提で公開して問題ない。Service Role Keyは絶対に置かない）
   3. renderResult() 内、「— ここまでが無料診断の結果です —」の直前あたりに
      下部の「renderResultへの追加コード」をそのまま挿入する
   ============================================================ */

// ---- 設定（実際の値に差し替える） ----
const SUPABASE_URL = 'https://csoivksmieguzywgxbrs.supabase.co'; // ← 要確認・差し替え
const SUPABASE_ANON_KEY = 'sb_publishable_MsexE5hP9STHzDzXHZAVPA_ISfYVAOX';

// diagnosis_type / version は既存ロジックと結果の形が変わったときだけ上げる
const DIAGNOSIS_TYPE = 'element';
const DIAGNOSIS_VERSION = 'element-v1';
const SCORING_VERSION = 'element-score-v1';

const PENDING_KEY = 'pendingDiagnosis_v1';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================================================
   Phase 7: 履歴取得
   汎用化（loadDiagnosisHistory）。元素専用関数にしない。
   ============================================================ */

async function loadDiagnosisHistory(diagnosisType) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  const { data, error } = await supabaseClient
    .from('diagnosis_sessions')
    .select('id, completed_at, diagnosis_version, diagnosis_results(primary_result, scores, character_matches, diagnosis_code), diagnosis_answers(encoded_answers)')
    .eq('user_id', user.id)
    .eq('diagnosis_type', diagnosisType)
    .order('completed_at', { ascending: false });

  if (error) return { ok: false, error };

  const sessions = (data || []).map(row => {
    const r = Array.isArray(row.diagnosis_results) ? row.diagnosis_results[0] : row.diagnosis_results;
    const a = Array.isArray(row.diagnosis_answers) ? row.diagnosis_answers[0] : row.diagnosis_answers;
    return {
      id: row.id,
      completedAt: row.completed_at,
      diagnosisVersion: row.diagnosis_version,
      primaryResult: r ? r.primary_result : null,
      scores: r ? r.scores : null,
      characterMatches: r ? r.character_matches : null,
      diagnosisCode: r ? r.diagnosis_code : null,
      encodedAnswers: a ? a.encoded_answers : null,
    };
  });

  return { ok: true, sessions };
}

/* ============================================================
   Phase 3: 認証
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
   Phase 4: pending diagnosis
   認証へ飛ぶ直前の診断結果をlocalStorageへ一時保持し、
   認証完了後に自動でDB保存する。DB保存後は必ず削除する。
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
   Phase 5: 保存本体
   概念を一般化（saveDiagnosisSession）。元素診断専用関数にしない。
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
  };
}

// 戻り値: { ok: true } | { ok: false, error }
async function saveDiagnosisSession(pending) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  // 1) セッション行を作成（client_session_idのUNIQUE制約で重複保存を防ぐ）
  const { data: session, error: sessionErr } = await supabaseClient
    .from('diagnosis_sessions')
    .insert({
      user_id: user.id,
      diagnosis_type: pending.diagnosisType,
      diagnosis_version: pending.diagnosisVersion,
      scoring_version: pending.scoringVersion,
      client_session_id: pending.clientSessionId,
      completed_at: pending.completedAt,
    })
    .select()
    .single();

  if (sessionErr) {
    // 23505 = unique_violation。連打・リダイレクト再実行による重複はここで安全に無視する
    if (sessionErr.code === '23505') return { ok: true, duplicate: true };
    return { ok: false, error: sessionErr };
  }

  // 2) 回答・結果を保存
  const [{ error: ansErr }, { error: resErr }] = await Promise.all([
    supabaseClient.from('diagnosis_answers').insert({
      session_id: session.id,
      answers: pending.answers,
      encoded_answers: pending.encodedAnswers,
    }),
    supabaseClient.from('diagnosis_results').insert({
      session_id: session.id,
      ...pending.results,
      diagnosis_code: pending.encodedAnswers ? pending.diagnosisCode : null,
    }),
  ]);

  if (ansErr || resErr) return { ok: false, error: ansErr || resErr };
  return { ok: true };
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
   起動時：認証完了で戻ってきたらpending diagnosisを保存する
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
    // 保存失敗時もpendingは消さない。次回リトライできるようにする（指示書25章）
    console.error('diagnosis save failed:', result.error);
    updateSaveButtonUI('error');
  }
});

/* ============================================================
   Phase 6: 結果画面のCTA
   renderResult()側から呼ぶ想定の3関数。
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
   renderResult() への追加コード（そのまま挿入する）
   ------------------------------------------------------------
   挿入場所：「— ここまでが無料診断の結果です —」の直前

   <button id="saveResultBtn"
     style="width:100%;margin-bottom:14px;background:transparent;border:1px solid #4a3a68;
            color:#a888d8;border-radius:8px;padding:12px;font-size:13px;cursor:pointer;font-family:inherit">
     無料で結果を保存
   </button>
   <p style="color:#5a4d75;font-size:10.5px;text-align:center;margin:-8px 0 14px">
     保存すると、次回の診断結果と比較できるようになります。
   </p>

   <script>
   (async function () {
     var btn = document.getElementById('saveResultBtn');
     if (!btn) return;
     var user = await getCurrentUser();
     updateSaveButtonUI(user ? 'idle_in' : 'idle_out');
     btn.addEventListener('click', function () {
       handleSaveResultClick(answers, buildResultPayload(results, topEl, topW, et, results.enneaWing), shortCode, applyData);
     });
   })();
   </script>
   ============================================================ */
