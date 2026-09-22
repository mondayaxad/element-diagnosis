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
const SUPABASE_URL = 'https://akivoobkqcnqvdumxtmg.supabase.co'; // release-c-preview専用：テスト用Supabaseプロジェクト
const SUPABASE_ANON_KEY = 'sb_publishable_ebFsEEouWTvJKOpk6ytYYQ_V0cOqtgl'; // release-c-preview専用：テスト用プロジェクトのpublishable key

// diagnosis_type / version は既存ロジックと結果の形が変わったときだけ上げる
const DIAGNOSIS_TYPE = 'element';
const DIAGNOSIS_VERSION = 'element-v1';
const SCORING_VERSION = 'element-score-v1';

// リリースA/Bで新設。キャラクターDB（CHARACTERS配列）の内容を変更したときだけ上げる。
const CHARACTER_DB_VERSION = 'char-db-v1';

const PENDING_KEY = 'pendingDiagnosis_v1';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// GA4への安全な送信ヘルパー。gtagが未定義のページ（GAタグ未設置）でも落ちないようにする
function trackEvent(name, params) {
  if (typeof gtag === 'function') gtag('event', name, params || {});
}

// 保存件数をGA4送信用の粗いバケットに丸める（個々の心理特性は一切送らない）
function savedCountBucket(n) {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 4) return '2_4';
  return '5_plus';
}

// ログイン済みユーザーが、この診断タイプで過去に1件でも保存済みかを軽量に判定する
// （repeat_diagnosis_start/completeの判定用。履歴の中身は取得しない）
async function hasPriorDiagnosis(diagnosisType) {
  const user = await getCurrentUser();
  if (!user) return false;
  const { count } = await supabaseClient
    .from('diagnosis_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('diagnosis_type', diagnosisType || DIAGNOSIS_TYPE);
  return (count || 0) > 0;
}

/* ============================================================
   Phase 7: 履歴取得
   汎用化（loadDiagnosisHistory）。元素専用関数にしない。
   ============================================================ */

const HISTORY_PAGE_SIZE = 20; // 1回の取得件数の上限（§9）

async function loadDiagnosisHistory(diagnosisType, limit) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'not_authenticated' };

  // 件数が増えても一度に全件取得しないよう上限を設ける。
  // hasMore判定のため、表示したい件数より1件多く取得する。
  const pageSize = limit || HISTORY_PAGE_SIZE;
  const { data, error } = await supabaseClient
    .from('diagnosis_sessions')
    .select('id, completed_at, diagnosis_version, diagnosis_results(primary_result, scores, character_matches, diagnosis_code), diagnosis_answers(encoded_answers)')
    .eq('user_id', user.id)
    .eq('diagnosis_type', diagnosisType)
    .order('completed_at', { ascending: false })
    .range(0, pageSize);

  if (error) return { ok: false, error, errorKind: classifyError(error) };

  const hasMore = (data || []).length > pageSize;
  if (hasMore) data.length = pageSize;

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
      purchased: false, // 後で /api/my-entitlements の結果に応じて true にする
    };
  });

  // 購入判定（修正指示書 §6）：
  // report_snapshots の存在は購入証跡として使わない（ブラウザからINSERT可能なため）。
  // 【訂正】purchase_entitlements・report_snapshots とも、クライアントからの直接
  // SELECTはRLSで拒否される（リリースA以降、公開ポリシーは一切無い）。
  // ログイン専用のサーバー処理（/api/my-entitlements）を経由し、本人の診断コードの
  // 購入状態だけを取得する。表示に使う実際の内容（Big Five・スコア・キャラクター）は、
  // 既にこの関数が取得している primaryResult/scores/characterMatches をそのまま使う
  // （report_snapshotsへ別途問い合わせる必要はない。保存時点で同じ内容が
  // diagnosis_results へ保存されているため）。
  const codes = sessions.map(s => s.encodedAnswers).filter(Boolean);
  if (codes.length > 0) {
    try {
      const { data: { session: authSession } } = await supabaseClient.auth.getSession();
      const accessToken = authSession && authSession.access_token;
      if (accessToken) {
        const res = await fetch('/api/my-entitlements', {
          headers: { 'Authorization': 'Bearer ' + accessToken },
        });
        if (res.ok) {
          const body = await res.json();
          const purchasedCodes = new Set(Object.keys(body.purchased || {}));
          sessions.forEach(s => {
            if (s.encodedAnswers && purchasedCodes.has(s.encodedAnswers)) {
              s.purchased = true;
            }
          });
        }
      }
    } catch (e) {
      console.error('entitlement check failed:', e);
      // 購入状態が確認できなくても、診断履歴自体の表示は継続する
      // （sessions各要素の purchased は未設定＝false 扱いのまま）
    }
  }

  return { ok: true, sessions, hasMore };
}

// 診断コードのSHA-256ハッシュ（16進）を返す。
// 生の診断コードを購入権限テーブルへ送らないための照合用。
async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

// メルマガ同意を「聞いたことがあるか」をDBで判定する。
// null = 未確認（チェックボックスを見せる）、true/false = 確認済み（見せない）
async function hasDecidedNewsletter() {
  const user = await getCurrentUser();
  if (!user) return false; // 未ログイン＝当然まだ聞いていない
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('newsletter_opted_in')
    .eq('id', user.id)
    .single();
  if (error) return false;
  return data.newsletter_opted_in !== null;
}

// 実際に選んだ結果（同意/非同意）をprofilesへ記録する
async function recordNewsletterDecision(userId, optedIn) {
  await supabaseClient
    .from('profiles')
    .update({ newsletter_opted_in: optedIn, newsletter_opted_in_at: new Date().toISOString() })
    .eq('id', userId);
}

/* ============================================================
   Phase 3: 認証
   ============================================================ */

async function signInWithGoogle() {
  trackEvent('auth_start', { auth_provider: 'google' });
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href.split('?')[0] }
  });
  if (error) {
    trackEvent('auth_error', { auth_provider: 'google', error_kind: 'auth' });
    console.error('Google sign-in error');
  }
}

async function sendEmailOtp(email) {
  trackEvent('auth_start', { auth_provider: 'email_otp' });
  const { error } = await supabaseClient.auth.signInWithOtp({
    email: email,
    options: { shouldCreateUser: true }
  });
  if (error) trackEvent('auth_error', { auth_provider: 'email_otp', error_kind: 'auth' });
  return error;
}

async function verifyEmailOtp(email, token) {
  const { error } = await supabaseClient.auth.verifyOtp({
    email: email,
    token: token,
    type: 'email'
  });
  if (error) trackEvent('auth_error', { auth_provider: 'email_otp', error_kind: 'auth' });
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

const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24時間で失効（§5-4）

function stashPendingDiagnosis(answers, results, encodedAnswers, newsletterOptIn) {
  const pending = {
    clientSessionId: crypto.randomUUID(),
    createdAt: Date.now(),
    diagnosisType: DIAGNOSIS_TYPE,
    diagnosisVersion: DIAGNOSIS_VERSION,
    scoringVersion: SCORING_VERSION,
    completedAt: new Date().toISOString(),
    answers: answers,
    encodedAnswers: encodedAnswers,
    results: results,
    // null = チェックボックスを見せていない（すでに聞いたことがある）。true/false = 今回答えた
    newsletterOptIn: (newsletterOptIn === true || newsletterOptIn === false) ? newsletterOptIn : null,
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
    if (!raw) return null;
    const pending = JSON.parse(raw);
    // 期限切れ（OAuthをキャンセルしたまま放置された等）は自動削除する。
    // 生の回答をlocalStorageへいつまでも残さないため（§5-4）。
    if (!pending.createdAt || (Date.now() - pending.createdAt) > PENDING_TTL_MS) {
      clearPendingDiagnosis();
      return null;
    }
    return pending;
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
    // CORE2「アナタの旅路」のデータ保存契約（§0-7）。
    // computeResults()が既に返している enneaSorted をそのまま保存する。
    ennea_sorted: results.enneaSorted,
    character_db_version: CHARACTER_DB_VERSION,
  };
}

// 3テーブル（sessions / answers / results）への保存を1トランザクションで行う（§5-1）。
// 成功条件は「3件すべての保存完了」。一部だけ成功した場合はDB側で全体がロールバックされる。
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
    p_diagnosis_code:    pending.diagnosisCode || null,
    // リリースA(004 v3)で追加された引数。省略すると常にNULLで保存され、
    // CORE2「アナタの旅路」のQUEST章に必要なennea_sortedが永久に欠落する。
    p_ennea_sorted:         pending.results.ennea_sorted || null,
    p_character_db_version: pending.results.character_db_version || null,
  });

  if (error) {
    // 【訂正】23505を一律「保存済みとして成功扱い」にしない。
    // 本番のsave_diagnosis_session（004 v3）は、client_session_idが重複しても
    // answers/resultsが両方揃っている冪等な再実行であれば、エラーを一切返さず
    // 正常終了する（この関数のerrorはnullになり、この分岐に来ない）。
    // ここで実際に23505が返るのは、以下のような「成功扱いにしてはいけない」
    // ケースに限られる：
    //   - client_session_id_conflict_other_user（別ユーザーとの衝突。
    //     SECURITY INVOKER配下のRLSにより通常は代わりにconflicting_session_not_foundになる）
    //   - その他、想定していないUNIQUE制約違反
    // そのため23505も含め、errorがあれば常に ok:false としてerrorKindで分類する。
    return { ok: false, error, errorKind: classifyError(error) };
  }
  return { ok: true };
}

// GA4へは生のエラー文を送らない。粗い分類だけを送る（§2-3）。
function classifyError(error) {
  if (!error) return 'unknown';
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  if (code === '28000' || msg.includes('jwt') || msg.includes('not_authenticated')) return 'auth';
  if (msg.includes('incomplete_existing_session')) return 'incomplete_existing_session';
  // client_session_id_conflict_other_user は SECURITY INVOKER + RLS の下では
  // 実際にはほぼ到達しない（diagnosis_sessionsのSELECTがauth.uid()=user_idの
  // 行しか見えないため、別ユーザーの行との衝突はconflicting_session_not_foundとして
  // 現れる）。どちらも同じ「安全側の失敗」として扱う。
  if (msg.includes('client_session_id_conflict_other_user')) return 'session_conflict';
  if (msg.includes('conflicting_session_not_found')) return 'session_conflict';
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'network';
  if (/^\d{5}$/.test(code)) return 'database';
  if (error.status && error.status >= 400) return 'api';
  return 'unknown';
}

// メルマガ同意があった場合にサーバー経由でKitへ登録する。
// メールアドレスはクライアントから送らない（§4-3）。
// サーバー側がアクセストークンを検証し、本人のメールアドレスだけを登録する。
// 失敗しても診断結果の保存自体には影響させない。
async function subscribeToNewsletter() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const accessToken = session && session.access_token;
    if (!accessToken) {
      trackEvent('newsletter_subscribe_error', { error_kind: 'auth' });
      return;
    }
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
      },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      // X認証等でメールアドレスが取得できず、登録が保留された場合
      if (body && body.ok === false) {
        trackEvent('newsletter_subscribe_error', { error_kind: 'email_unavailable' });
        return;
      }
      trackEvent('newsletter_subscribe_success');
    } else {
      trackEvent('newsletter_subscribe_error', {
        error_kind: res.status === 401 ? 'auth' : 'api',
      });
    }
  } catch (e) {
    trackEvent('newsletter_subscribe_error', { error_kind: 'network' });
    console.error('newsletter subscribe failed');
  }
}

/* ============================================================
   起動時：認証完了で戻ってきたらpending diagnosisを保存する
   ============================================================ */

supabaseClient.auth.onAuthStateChange(async (event, session) => {
  if (event !== 'SIGNED_IN') return;
  trackEvent('auth_success');
  const pending = readPendingDiagnosis();
  if (!pending) return;

  const result = await saveDiagnosisSession(pending);
  if (result.ok) {
    trackEvent('diagnosis_save_success');
    const optIn = pending.newsletterOptIn;
    clearPendingDiagnosis();
    updateSaveButtonUI('saved');
    if (optIn !== null) {
      const user = await getCurrentUser();
      if (user) {
        recordNewsletterDecision(user.id, optIn);
        trackEvent(optIn ? 'newsletter_opt_in' : 'newsletter_opt_out');
        if (optIn) await subscribeToNewsletter();
      }
    }
    // OAuthから戻った直後は保存できたことが分かりにくいため、
    // マイページへ送り届けて「保存しました」を表示する（§5-3）
    trackEvent('mypage_entry_click', { entry_point: 'save_success' });
    window.location.href = '/mypage.html?from=save';
  } else {
    // 保存失敗時もpendingは消さない。次回リトライできるようにする
    trackEvent('diagnosis_save_error', { error_kind: result.errorKind || 'unknown' });
    console.error('diagnosis save failed');
    updateSaveButtonUI('error');
    saveInFlight = false;
  }
});

/* ============================================================
   Phase 6: 結果画面のCTA
   renderResult()側から呼ぶ想定の3関数。
   ============================================================ */

// 保存処理が二重に走らないためのフラグ（§5-2）
let saveInFlight = false;

async function handleSaveResultClick(answers, results, encodedAnswers, diagnosisCode, newsletterOptIn) {
  // 【重要】getCurrentUser()を待つ前に、まずボタンを止める。
  // ここでawaitしてしまうと、その隙に連打され複数のclient_session_idが生成されうる（§5-2）。
  if (saveInFlight) return;
  saveInFlight = true;
  updateSaveButtonUI('saving');

  try {
    // 既にpendingがある場合はそれを再利用し、同一ブラウザから
    // 複数のclient_session_idが生成されないようにする（§5-2）
    let pending = readPendingDiagnosis();
    if (!pending) {
      stashPendingDiagnosis(answers, results, encodedAnswers, newsletterOptIn);
      pending = readPendingDiagnosis();
    }
    pending.diagnosisCode = diagnosisCode;
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

    const user = await getCurrentUser();

    if (user) {
      const result = await saveDiagnosisSession(pending);
      if (result.ok) {
        trackEvent('diagnosis_save_success');
        clearPendingDiagnosis();
        updateSaveButtonUI('saved');
        if (pending.newsletterOptIn !== null) {
          recordNewsletterDecision(user.id, pending.newsletterOptIn);
          trackEvent(pending.newsletterOptIn ? 'newsletter_opt_in' : 'newsletter_opt_out');
          if (pending.newsletterOptIn) subscribeToNewsletter();
        }
        // 成功時はボタンを戻さない（saved状態のまま固定）
      } else {
        trackEvent('diagnosis_save_error', { error_kind: result.errorKind || 'unknown' });
        updateSaveButtonUI('error');
        saveInFlight = false; // エラー時だけ再タップ可能に戻す（§5-2）
      }
    } else {
      // 未ログイン：その場でログイン方法を出す。
      // 認証後はonAuthStateChangeが自動保存し、mypageへ遷移する（§5-3）。
      renderSaveLoginChoice();
      saveInFlight = false;
    }
  } catch (e) {
    trackEvent('diagnosis_save_error', { error_kind: 'unknown' });
    updateSaveButtonUI('error');
    saveInFlight = false;
  }
}

// 保存ボタンの場所に、Google／メールの両方をその場で表示する
// （診断結果はすでにstashPendingDiagnosisで退避済みなので、
//   どちらでログインしても認証完了後に自動で保存される）
function renderSaveLoginChoice() {
  const area = document.getElementById('saveGateArea');
  if (!area) return;
  area.innerHTML = `
    <button id="saveGoogleBtn"
      style="width:100%;background:#fff;color:#1a1a2e;border:none;border-radius:8px;padding:12px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      Googleでログインして保存
    </button>
    <div id="saveGateMsg" style="font-size:11px;color:#7ab8e8;margin-top:8px;min-height:14px"></div>
  `;
  document.getElementById('saveGoogleBtn').onclick = () => signInWithGoogle();
}

// メール(OTP)ログインの関数自体は残す。独自ドメイン取得後、
// 上のrenderSaveLoginChoice()にメール欄のUIを戻せばすぐ再有効化できる。
// renderOtpCodeInput()は今UIから呼ばれていないが削除しない。

function renderOtpCodeInput(area, email) {
  area.innerHTML = `
    <div style="font-size:11px;color:#7ab8e8;margin-bottom:10px">${email} に6桁のコードを送りました。</div>
    <div style="display:flex;gap:6px">
      <input id="saveOtpInput" type="text" inputmode="numeric" maxlength="6" placeholder="123456"
        style="flex:1;background:#0a0916;border:1px solid #1e3448;border-radius:6px;padding:10px 12px;color:#e0dcf0;font-size:15px;letter-spacing:4px;text-align:center;font-family:inherit">
      <button id="saveOtpVerifyBtn"
        style="background:#7ab8e8;color:#0a0916;border:none;border-radius:6px;padding:10px 16px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">ログイン</button>
    </div>
    <div id="saveGateMsg" style="font-size:11px;color:#7ab8e8;margin-top:8px;min-height:14px"></div>
    <button id="saveOtpResendBtn"
      style="background:none;border:none;color:#4a6478;font-size:10.5px;text-decoration:underline;cursor:pointer;font-family:inherit;margin-top:4px;padding:0">コードを再送する</button>
  `;
  document.getElementById('saveOtpVerifyBtn').onclick = async () => {
    const token = document.getElementById('saveOtpInput').value.trim();
    const msg = document.getElementById('saveGateMsg');
    if (!token) { msg.textContent = 'コードを入力してください。'; return; }
    msg.textContent = '確認中…';
    const error = await verifyEmailOtp(email, token);
    if (error) {
      msg.textContent = 'コードが正しくないか、期限切れです。';
      return;
    }
    // 成功するとonAuthStateChangeが発火し、pending diagnosisが自動保存される
  };
  document.getElementById('saveOtpResendBtn').onclick = async () => {
    const msg = document.getElementById('saveGateMsg');
    msg.textContent = '再送中…';
    const error = await sendEmailOtp(email);
    msg.textContent = error ? '再送に失敗しました。' : '再送しました。';
  };
}

function updateSaveButtonUI(state) {
  const btn = document.getElementById('saveResultBtn');
  if (!btn) return;
  const labels = {
    idle_out: 'この結果を診断記録に保存する',
    idle_in: 'この結果を診断記録に保存する',
    saving: '保存中…',
    saved: '✓ 保存しました',
    error: '保存に失敗しました（再タップで再試行）',
  };
  btn.textContent = labels[state] || labels.idle_out;
  btn.disabled = (state === 'saving' || state === 'saved');

  // 保存成功時だけ、その場でマイページへの導線を1行足す（保存ボタン自体は置き換えない）
  if (state === 'saved') {
    const area = document.getElementById('saveGateArea') || btn.parentElement;
    if (area && !document.getElementById('mypageAfterSaveLink')) {
      const link = document.createElement('a');
      link.id = 'mypageAfterSaveLink';
      link.href = '/mypage.html';
      link.textContent = 'マイページで結果を見る →';
      link.style.cssText = 'display:block;text-align:center;margin-top:10px;color:#7ab8e8;font-size:11.5px;text-decoration:none;border-bottom:1px solid #7ab8e850;padding-bottom:2px;width:fit-content;margin-left:auto;margin-right:auto';
      link.onclick = function () {
        trackEvent('mypage_entry_click', { entry_point: 'save_success' });
      };
      area.appendChild(link);
    }
  }
}

/* ============================================================
   renderResult() への追加コード（参考。実際の index.html では
   既にこの形で組み込み済み。以下は最新の呼び出し形に修正済み）
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
       // 【訂正】buildResultPayload()の第5引数は topNat（国家）。
       // results.enneaWing ではない。newsletterOptIn も必ず渡すこと
       // （省略するとメルマガ同意があってもsubscribeToNewsletter()が呼ばれない）。
       var resultPayload = buildResultPayload(results, topEl, topW, et, topNat);
       handleSaveResultClick(answers, resultPayload, shortCode, applyData, newsletterOptIn);
     });
   })();
   </script>
   ============================================================ */
