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

// ---- 接続先の設定 ----
// Supabase の URL・公開キーはコードに書かない。各ページが先に読み込む /api/public-config?format=js が
// window.__ED_PUBLIC_CONFIG__ を設定する（Production は本番、release-c-preview の Preview は Preview 専用の
// Supabase）。設定が無い・形式が不正・ページのホストと環境名が食い違う場合は、別の接続先を試さず、
// 何もしない代用クライアント（unavailableSupabaseClient）を使う。ログイン・保存は
// 「現在ご利用いただけません」として失敗し、pending（localStorage）は消さない（復旧後に再開できる）。
const PRODUCTION_HOSTS = ['element-diagnosis-five.vercel.app'];
const SUPABASE_CONFIG_UNAVAILABLE = { code: 'config_unavailable', message: 'ログイン・保存は現在ご利用いただけません。' };

function readPublicSupabaseConfig() {
  const cfg = window.__ED_PUBLIC_CONFIG__;
  if (!cfg || typeof cfg !== 'object') return null;
  const { appEnv, supabaseUrl, supabaseAnonKey, projectRef } = cfg;
  if (appEnv !== 'production' && appEnv !== 'preview' && appEnv !== 'development') return null;
  if (typeof projectRef !== 'string' || !/^[a-z0-9]{20}$/.test(projectRef)) return null;
  if (supabaseUrl !== 'https://' + projectRef + '.supabase.co') return null;
  if (typeof supabaseAnonKey !== 'string' || !supabaseAnonKey || supabaseAnonKey.indexOf('sb_secret_') === 0) return null;
  // 本番ホストでは production の設定だけ、本番以外のホストでは production 以外の設定だけを使う。
  const host = (window.location && window.location.hostname) || '';
  const isProductionHost = PRODUCTION_HOSTS.indexOf(host) !== -1;
  if (isProductionHost !== (appEnv === 'production')) return null;
  return { appEnv: appEnv, supabaseUrl: supabaseUrl, supabaseAnonKey: supabaseAnonKey, projectRef: projectRef };
}

// 設定が使えないときの代用品。supabase-js と同じ呼び出し方で、常に config_unavailable のエラーを返す。
// トップレベルの onAuthStateChange 登録などが例外で止まらないようにする。
function createUnavailableSupabaseClient() {
  const fail = () => Promise.resolve({ data: { session: null, user: null }, error: SUPABASE_CONFIG_UNAVAILABLE });
  function queryBuilder() {
    const q = new Proxy({}, {
      get(_t, k) {
        if (k === 'then') {
          return (resolve, reject) => Promise.resolve({ data: null, error: SUPABASE_CONFIG_UNAVAILABLE }).then(resolve, reject);
        }
        return () => q;
      },
    });
    return q;
  }
  const auth = new Proxy({}, {
    get(_t, k) {
      if (k === 'onAuthStateChange') return () => ({ data: { subscription: { unsubscribe() {} } } });
      return fail;
    },
  });
  return {
    unavailable: true,
    from: queryBuilder,
    rpc: () => Promise.resolve({ data: null, error: SUPABASE_CONFIG_UNAVAILABLE }),
    auth: auth,
  };
}

const publicSupabaseConfig = readPublicSupabaseConfig();

// diagnosis_type / version は既存ロジックと結果の形が変わったときだけ上げる
const DIAGNOSIS_TYPE = 'element';
const DIAGNOSIS_VERSION = 'element-v1';
const SCORING_VERSION = 'element-score-v1';

// リリースBで新設。キャラクターDB（CHARACTERS配列）の内容を変更したときだけ上げる。
const CHARACTER_DB_VERSION = 'char-db-v1';

const PENDING_KEY = 'pendingDiagnosis_v1';

const supabaseClient = (publicSupabaseConfig && window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(publicSupabaseConfig.supabaseUrl, publicSupabaseConfig.supabaseAnonKey)
  : createUnavailableSupabaseClient();
if (supabaseClient.unavailable) console.error('supabase config unavailable');

// GA4が無いPreviewやmypageでも呼び出し元を落とさない。
function trackEvent(name, params) {
  if (typeof gtag === 'function') gtag('event', name, params || {});
}

/* ============================================================
   登録完了（利用規約・プライバシーポリシーへの同意とお知らせメール）2026-10-07
   - 新規か既存かは、認証の後に profiles.onboarding_status で判定する（メール入力前に存在確認はしない）。
     Google・X・メールOTP のどの経路でも、onAuthStateChange → runSignedInFlow() の同じ処理を通る。
   - required：登録完了モーダル（js/registration-onboarding.js）を表示し、同意したら
     RPC complete_registration_onboarding で記録する（日時・版はサーバー側で決まる）。
     「いいえ」はサインアウトする。診断の pending は消さず、次回ログイン時に再びモーダルを表示する。
   - completed／legacy_exempt：表示しない。既存ユーザー（legacy_exempt）の配信設定は変えない。
   - profiles を読めない・値が想定外・モーダルを出せない：登録済みとは扱わない（fail-closed。保存もしない）。
   - 順序：認証 → 判定 → 同意記録 → 診断の pending 保存 → /api/subscribe（Kit 同期）。
     Kit の失敗で登録・保存を失敗扱いにしない。再送は「24時間以上・3回まで」（サーバーも同じ条件で判定する）。
   メール案内専用のチェックボックスは設けない。配信内容は登録完了モーダルに明示する。
   ============================================================ */
const REGISTRATION_TERMS_VERSION = '2026-10-07';
const REGISTRATION_PRIVACY_VERSION = '2026-10-07';
const NEWSLETTER_CONSENT_VERSION = '2026-10-07-v1';
const NEWSLETTER_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NEWSLETTER_MAX_ATTEMPTS = 3;
const REGISTRATION_KNOWN_STATUSES = ['required', 'completed', 'legacy_exempt'];

// 旧仕様（結果画面の任意チェック）の一時保持は使わない。残っていれば消す。
try { localStorage.removeItem('pendingNewsletterConsent_v1'); } catch (e) { /* noop */ }

/* 端末ヒント（2026-10-07）：この端末で登録済み（completed／legacy_exempt）を DB で確認したことがある、という印だけ。
   - 値は '1' だけ。メールアドレス・user_id・トークン・同意日時・購入状態・診断内容は保存しない。
   - 診断完了ページで保存カードを早い位置に出すかどうか（表示位置）にだけ使う。
     認証・規約同意・保存許可の根拠にはしない。保存の前には必ずログインと onboarding_status を確認する。
   - ログアウトでは消さない（久しぶりに診断する登録済みユーザーにも早い位置の保存導線を出すため）。
   - 古い・別端末・プライベートブラウズ・ブラウザによる削除などで当てにならないことがある（best-effort）。 */
const REGISTRATION_KNOWN_HINT_KEY = 'ed_registration_known_v1';
function markRegistrationKnownDevice() {
  try { localStorage.setItem(REGISTRATION_KNOWN_HINT_KEY, '1'); } catch (e) { /* noop */ }
}
function hasRegistrationKnownHint() {
  try { return localStorage.getItem(REGISTRATION_KNOWN_HINT_KEY) === '1'; } catch (e) { return false; }
}

// 本人の登録状態を読む。読めない場合は null（＝登録済みとは扱わない）。
async function fetchRegistrationProfile(userId) {
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('onboarding_status, newsletter_sync_status, newsletter_sync_attempts, newsletter_sync_attempted_at')
      .eq('id', userId)
      .single();
    if (error || !data) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// 同意を記録する（RPC。二重に呼ばれても completed のまま同じ結果を返す）。
async function completeRegistrationOnboarding() {
  try {
    const { data, error } = await supabaseClient.rpc('complete_registration_onboarding', {
      p_terms_version: REGISTRATION_TERMS_VERSION,
      p_privacy_version: REGISTRATION_PRIVACY_VERSION,
      p_newsletter_consent_version: NEWSLETTER_CONSENT_VERSION,
    });
    if (error || !data || data.onboarding_status !== 'completed') return { ok: false, error: error || 'unexpected_result' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'exception' };
  }
}

// ページのスクリプト（js/registration-onboarding.js・js/eti_v2_save.js）がすべて読み込まれるまで待つ。
// 認証の通知は外部スクリプトの読み込みの合間に届くことがあり、待たないとモーダルや v2 保存を取りこぼす。
function whenDocumentReady() {
  if (typeof document === 'undefined' || !document.readyState || document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}

async function runRegistrationCheck() {
  await whenDocumentReady();
  const user = await getCurrentUser();
  if (!user) return { state: 'signed_out' };
  const profile = await fetchRegistrationProfile(user.id);
  if (!profile) return { state: 'error', reason: 'profile_unavailable' };
  const status = profile.onboarding_status;
  if (REGISTRATION_KNOWN_STATUSES.indexOf(status) === -1) return { state: 'error', reason: 'unexpected_status' };
  if (status !== 'required') {
    markRegistrationKnownDevice();
    return { state: 'ok', userId: user.id, profile: profile, justCompleted: false };
  }

  if (typeof window.showRegistrationOnboarding !== 'function') return { state: 'error', reason: 'ui_unavailable' };
  trackEvent('registration_onboarding_view');
  const choice = await window.showRegistrationOnboarding({ userId: user.id, onAccept: completeRegistrationOnboarding });
  if (choice === 'accepted') {
    // 同意の RPC が completed を返したときだけ accepted になる（js/registration-onboarding.js）
    markRegistrationKnownDevice();
    trackEvent('registration_onboarding_complete');
    return {
      state: 'ok',
      userId: user.id,
      justCompleted: true,
      profile: Object.assign({}, profile, { onboarding_status: 'completed', newsletter_sync_status: 'pending', newsletter_sync_attempts: 0 }),
    };
  }
  trackEvent('registration_onboarding_decline');
  await signOutUser();
  return { state: 'declined' };
}

// 同じページ内では1回だけ判定する（OAuth 復帰・再読込・同時の呼び出しでもモーダルは1つ）。
// ok 以外の結果は保持しない（次の呼び出しで判定し直す）。サインアウトで捨てる。
let registrationCheckPromise = null;
function ensureRegistrationComplete() {
  if (!registrationCheckPromise) {
    registrationCheckPromise = runRegistrationCheck().then(
      (r) => { if (r.state !== 'ok') registrationCheckPromise = null; return r; },
      () => { registrationCheckPromise = null; return { state: 'error', reason: 'exception' }; }
    );
  }
  return registrationCheckPromise;
}
function resetRegistrationCheck() {
  registrationCheckPromise = null;
}

// 登録状態を読むだけ（モーダルは開かない）。診断完了ページで保存カードの位置を決めるために使う。
//   { state: 'signed_out' } | { state: 'ok', status: 'required'|'completed'|'legacy_exempt' } | { state: 'error' }
// 保存の可否はここでは決めない（保存時に ensureRegistrationComplete() で改めて判定する）。
async function peekRegistrationStatus() {
  let user = null;
  try { user = await getCurrentUser(); } catch (e) { return { state: 'error', reason: 'auth_unavailable' }; }
  if (!user) return { state: 'signed_out' };
  const profile = await fetchRegistrationProfile(user.id);
  if (!profile) return { state: 'error', reason: 'profile_unavailable' };
  const status = profile.onboarding_status;
  if (REGISTRATION_KNOWN_STATUSES.indexOf(status) === -1) return { state: 'error', reason: 'unexpected_status' };
  if (status !== 'required') markRegistrationKnownDevice();
  return { state: 'ok', status: status };
}

// 認証の後の処理（登録完了の判定とモーダル）をページを開いた時点で行うか。
// 診断完了ページ（index.html）は window.ED_REGISTRATION_CHECK_ON_LOAD = 'pending_only' とし、
// 認証復帰後に保存する診断（pending）があるときだけ行う。それ以外は「保存」を押したときに判定する
// （登録完了前のユーザーへ、ページを開いただけで規約モーダルを出さない）。
function registrationCheckOnLoadIsPendingOnly() {
  return typeof window !== 'undefined' && window.ED_REGISTRATION_CHECK_ON_LOAD === 'pending_only';
}
function hasPendingDiagnosisToSave() {
  if (readPendingDiagnosis()) return true;
  // v2 の pending は js/eti_v2_save.js が期限・形式を確かめて読む（壊れた・期限切れは消える）
  if (typeof readPendingDiagnosisV2 === 'function') return !!readPendingDiagnosisV2();
  try { return !!localStorage.getItem('pendingDiagnosis_v2'); } catch (e) { return false; }
}

// Kit 同期を今行うか（サーバー /api/subscribe も同じ条件で判定する）。
//   登録完了（completed）の人だけ。legacy_exempt は対象外。
//   synced なら送らない。初回（試行0回）は送る。失敗後は前回から24時間以上・3回未満のときだけ。
function newsletterSyncDue(profile, now) {
  if (!profile || profile.onboarding_status !== 'completed') return false;
  if (profile.newsletter_sync_status === 'synced') return false;
  const attempts = Number(profile.newsletter_sync_attempts) || 0;
  if (attempts === 0) return true;
  if (attempts >= NEWSLETTER_MAX_ATTEMPTS) return false;
  const last = Date.parse(profile.newsletter_sync_attempted_at || '');
  if (!Number.isFinite(last)) return true;
  return (now - last) >= NEWSLETTER_RETRY_INTERVAL_MS;
}

async function syncNewsletterIfDue(profile) {
  if (!newsletterSyncDue(profile, Date.now())) return { skipped: 'not_due' };
  const synced = await subscribeToNewsletter();
  trackEvent(synced.ok ? 'newsletter_subscribe_success' : 'newsletter_subscribe_error', { consent_version: NEWSLETTER_CONSENT_VERSION });
  return synced;
}

// 旧 index-test.html（公開停止予定）向けの互換。結果画面でお知らせの選択を出さない。
async function hasDecidedNewsletter() {
  return true;
}

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
      // 保存時のMIRROR版（mypageで当時の版のキャラクター座標・選択規則で表示するため。読み取りのみ）
      mirrorModelVersion: isV2 && r ? r.mirror_model_version : null,
      characterProfileVersion: isV2 && r ? r.character_profile_version : null,
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
// APIは世代付きキー（element-v1:<code> / ETI-2.0:<code>）を返す。
// 同じコード文字列が偶然両世代で生成されても権利を相互利用しない。
async function attachPurchasedStatus(sessions) {
  const { data: { session: authSession } } = await supabaseClient.auth.getSession();
  const accessToken = authSession && authSession.access_token;
  if (!accessToken) return;

  const res = await fetch('/api/my-entitlements', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return;

  const body = await res.json();
  const purchasedKeys = new Set(Object.keys(body.purchased_by_version || {}));
  sessions.forEach(s => {
    const version = s.isV2 ? 'ETI-2.0' : 'element-v1';
    const key = s.encodedAnswers ? `${version}:${s.encodedAnswers}` : null;
    if (key && purchasedKeys.has(key)) {
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
    // 結果コードのクエリへ戻す必要はない。回答一式はpendingDiagnosis_v1へ
    // 退避済みなので、認証後は保存履歴を確認できるマイページへ戻す。
    options: { redirectTo: window.location.origin + '/mypage.html' }
  });
  if (error) console.error('Google sign-in error:', error);
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

function stashPendingDiagnosis(answers, results, encodedAnswers) {
  const pending = {
    clientSessionId: crypto.randomUUID(),
    diagnosisType: DIAGNOSIS_TYPE,
    diagnosisVersion: DIAGNOSIS_VERSION,
    scoringVersion: SCORING_VERSION,
    completedAt: new Date().toISOString(),
    answers: answers,
    encodedAnswers: encodedAnswers,
    results: results,
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
  // 登録完了（規約への同意）前のユーザーの保存は、DB 側でも拒否される
  if (msg.includes('onboarding_required')) return 'onboarding_required';
  if (msg.includes('incomplete_existing_session')) return 'incomplete_existing_session';
  // client_session_id_conflict_other_user は SECURITY INVOKER + RLS の下では
  // 実際にはほぼ到達しない（下記コメント参照）。conflicting_session_not_found と
  // 同じ「安全側の失敗」として同一のerrorKindにまとめる。
  if (msg.includes('client_session_id_conflict_other_user')) return 'session_conflict';
  if (msg.includes('conflicting_session_not_found')) return 'session_conflict';
  return 'unknown';
}

// 登録完了で同意を記録した本人だけを、サーバー経由でKitへ登録する。
// メールアドレスはブラウザから送らない。サーバーが認証トークンから本人のメールを取得し、
// DB上の同意（版・取得経路）と再送条件を確認してから送り、結果を newsletter_sync_status に記録する。
// 失敗しても登録・診断結果の保存には影響させない（画面に赤いエラーを出さない）。
async function subscribeToNewsletter() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const accessToken = session && session.access_token;
    if (!accessToken) return { ok: false, status: 401 };
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ consentVersion: NEWSLETTER_CONSENT_VERSION }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.error('newsletter subscribe failed');
    return { ok: false, status: 0 };
  }
}

/* ============================================================
   起動時：認証の後の処理（全経路共通）
   認証 → 登録完了の判定（必要ならモーダル）→ 診断の pending 保存（v1 → v2）→ Kit 同期
   ============================================================ */

let pendingSaveInFlight = false;

async function savePendingDiagnosisV1() {
  if (pendingSaveInFlight) return { skipped: 'in_flight' };
  const pending = readPendingDiagnosis();
  if (!pending) return { skipped: 'no_pending' };
  pendingSaveInFlight = true;
  try {
    const result = await saveDiagnosisSession(pending);
    if (result.ok) {
      clearPendingDiagnosis();
      updateSaveButtonUI('saved');
    } else {
      // 保存失敗時もpendingは消さない。次回リトライできるようにする
      console.error('diagnosis save failed:', result.errorKind);
      updateSaveButtonUI('error');
    }
    return result;
  } finally {
    pendingSaveInFlight = false;
  }
}

async function runSignedInFlow() {
  await whenDocumentReady();
  const reg = await ensureRegistrationComplete();
  if (typeof window.onRegistrationStateChange === 'function') window.onRegistrationStateChange(reg);
  if (reg.state !== 'ok') return reg; // 登録前・いいえ・確認不能：保存も Kit 同期もしない（pending は残す）

  let savedAny = false;
  const v1 = await savePendingDiagnosisV1();
  if (v1 && v1.ok) savedAny = true;
  if (typeof processPendingDiagnosisV2Once === 'function') {
    const v2 = await processPendingDiagnosisV2Once();
    if (v2 && v2.ok) savedAny = true;
  }
  // 保存の成否に関係なく、登録が済んでいれば Kit 同期（条件を満たす場合だけ。失敗しても登録・保存は成功のまま）
  await syncNewsletterIfDue(reg.profile).catch(() => {});
  // mypage.html上で認証復帰した場合、保存直後の履歴を同じ画面へ反映する。
  if (savedAny && typeof window.refreshMypageHistory === 'function') {
    await window.refreshMypageHistory();
  }
  return reg;
}

let signedInFlowRunning = null;
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    resetRegistrationCheck();
    return;
  }
  // OAuthから戻った時点で既にセッション復元済みの場合、Supabaseは
  // SIGNED_INではなくINITIAL_SESSIONを通知する。どちらでも同じ処理を通す。
  if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
  if (!session || signedInFlowRunning) return;
  // supabase-js の通知処理の中で auth の呼び出しを待たないよう、次のタスクで実行する
  signedInFlowRunning = new Promise((resolve) => setTimeout(resolve, 0))
    .then(whenDocumentReady)
    .then(() => {
      // 診断完了ページ：保存する pending が無ければ、ここでは判定もモーダルも行わない（保存を押したときに行う）
      if (registrationCheckOnLoadIsPendingOnly() && !hasPendingDiagnosisToSave()) return null;
      return runSignedInFlow();
    })
    .catch((e) => console.error('signed-in flow failed:', e && e.message))
    .finally(() => { signedInFlowRunning = null; });
});

/* ============================================================
   結果画面のCTA（本番のまま無変更）
   ============================================================ */

// 戻り値：保存の結果（{ ok, ... }）。登録完了前に止まった場合は { ok:false, registration:'declined'|'error' }。
// 未ログインで Google へ遷移した場合は undefined（ページ遷移するため）。
async function handleSaveResultClick(answers, results, encodedAnswers, diagnosisCode) {
  updateSaveButtonUI('saving');
  const user = await getCurrentUser();

  stashPendingDiagnosis(answers, results, encodedAnswers);
  const pending = readPendingDiagnosis();
  pending.diagnosisCode = diagnosisCode;
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  if (user) {
    // 登録完了（規約への同意）が済むまで保存しない。pending は残す
    const reg = await ensureRegistrationComplete();
    if (reg.state !== 'ok') {
      updateSaveButtonUI('error');
      return { ok: false, registration: reg.state };
    }
    const result = await saveDiagnosisSession(pending);
    if (result.ok) {
      clearPendingDiagnosis();
      updateSaveButtonUI('saved');
    } else {
      updateSaveButtonUI('error');
    }
    return result;
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
   results.enneaWing ではない。お知らせメールの同意は結果画面では扱わない
   （登録完了モーダルで記録する。runSignedInFlow() を参照）。

   var resultPayload = buildResultPayload(results, topEl, topW, et, topNat);
   handleSaveResultClick(
     answers,
     resultPayload,
     shortCode,
     applyData
   );
   ============================================================ */
