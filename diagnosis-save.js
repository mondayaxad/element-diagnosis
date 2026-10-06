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
   メール配信（Kit）の同意（2026-10-06 統合指示書 §10〜§13）
   - マイページ登録・診断保存だけでは Kit へ登録しない。明示的な同意（チェック）がある場合だけ。
   - 未チェックは false として記録する（未回答の null とは区別する）。
   - 順序：認証 → 診断保存 → 同意記録 → Kit同期。Kit の失敗で保存・登録を失敗扱いにしない。
   - 同意記録を確認できない場合（列が無い・型が違う・RLSで書けない等）は Kit へ送らない（fail-closed）。
   - 判断済み（true/false）のユーザーには再表示せず、保存のたびに Kit を呼ばない。
   - OAuth 往復中の選択は、診断の pending とは別キーで一時保持する。
   ============================================================ */
const NEWSLETTER_CONSENT_KEY = 'pendingNewsletterConsent_v1';
const NEWSLETTER_CONSENT_SOURCE = 'mypage_signup';
const NEWSLETTER_CONSENT_VERSION = '2026-10-06-v1';
const NEWSLETTER_CONSENT_TTL_MS = 24 * 60 * 60 * 1000;

// 判断済み（true または false が記録済み）なら、結果画面で毎回聞き直さない。
// 読めない・型が確認できない場合は「未判断」として扱う（表示はするが、記録できなければ送らない）。
async function hasDecidedNewsletter() {
  const user = await getCurrentUser();
  if (!user) return false;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('newsletter_opted_in')
    .eq('id', user.id)
    .single();
  if (error || !data) return false;
  return typeof data.newsletter_opted_in === 'boolean';
}

// 同意判断を profiles へ記録し、書き戻された値で記録できたことを確かめる。
// 戻り値 ok:true は「値・版が確かに保存された」場合だけ。それ以外は Kit へ送らない。
async function recordNewsletterDecision(userId, optedIn) {
  if (!userId || typeof optedIn !== 'boolean') return { ok: false, reason: 'invalid_input' };
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .update({
        newsletter_opted_in: optedIn,
        newsletter_opted_in_at: new Date().toISOString(),
        newsletter_consent_source: NEWSLETTER_CONSENT_SOURCE,
        newsletter_consent_version: NEWSLETTER_CONSENT_VERSION,
      })
      .eq('id', userId)
      .select('newsletter_opted_in, newsletter_consent_version')
      .single();
    if (error || !data) return { ok: false, reason: 'record_failed' };
    if (data.newsletter_opted_in !== optedIn || data.newsletter_consent_version !== NEWSLETTER_CONSENT_VERSION) {
      return { ok: false, reason: 'record_unverified' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'record_failed' };
  }
}

// 結果画面で選んだ値を一時保持する（null＝今回は聞いていない＝何もしない）。
function stashNewsletterConsent(optIn) {
  if (typeof optIn !== 'boolean') return;
  try {
    localStorage.setItem(NEWSLETTER_CONSENT_KEY, JSON.stringify({
      optIn, source: NEWSLETTER_CONSENT_SOURCE, version: NEWSLETTER_CONSENT_VERSION, createdAt: Date.now(),
    }));
  } catch (e) { /* 保存できなくても診断保存は続ける */ }
}
function readNewsletterConsent() {
  try {
    const raw = localStorage.getItem(NEWSLETTER_CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || typeof c.optIn !== 'boolean' || c.version !== NEWSLETTER_CONSENT_VERSION
      || !(Date.now() - Number(c.createdAt) < NEWSLETTER_CONSENT_TTL_MS)) {
      clearNewsletterConsent();
      return null;
    }
    return c;
  } catch (e) {
    clearNewsletterConsent();
    return null;
  }
}
function clearNewsletterConsent() {
  try { localStorage.removeItem(NEWSLETTER_CONSENT_KEY); } catch (e) { /* noop */ }
}

let newsletterConsentInFlight = false;
// 保存が済んだ後に呼ぶ。一時保持した選択を記録し、同意 true が確かに記録できた場合だけ Kit へ同期する。
// 一時保持（pendingNewsletterConsent_v1）は、DB記録と（同意 true の場合は）Kit同期が完了するまで消さない。
//   ・DB の読取失敗・型不正・書込失敗・書込確認失敗 → 保持したまま（Kit は呼ばない。次回再試行）
//   ・false を記録できた → 削除（Kit は呼ばない）
//   ・true を記録し Kit 同期に成功 → 削除／Kit 同期に失敗 → 保持（次回再試行。保存は成功のまま・赤いエラーなし）
//   ・DB が既に true で、保持も true → Kit 同期の再試行として扱う（成功で削除・失敗で保持）
//   ・DB が既に false、または保存済みの判断と保持中の選択が食い違う → DB を上書きせず、保持を破棄
async function processPendingNewsletterConsent() {
  if (newsletterConsentInFlight) return { skipped: 'in_flight' };
  // 最初の await より前に印を付ける（同時に呼ばれても Kit 同期を二重にしない）
  newsletterConsentInFlight = true;
  const ga = (name, extra) => trackEvent(name, Object.assign({ entry_point: NEWSLETTER_CONSENT_SOURCE, consent_version: NEWSLETTER_CONSENT_VERSION }, extra || {}));
  // Kit 同期：成功した時だけ保持を消す
  const syncToKit = async () => {
    const synced = await subscribeToNewsletter();
    ga(synced.ok ? 'newsletter_subscribe_success' : 'newsletter_subscribe_error');
    if (synced.ok) clearNewsletterConsent();
    return synced.ok;
  };
  try {
    const consent = readNewsletterConsent();
    if (!consent) return { skipped: 'no_consent' };
    // 診断の保存がまだ終わっていない間は待つ（認証 → 診断保存 → 同意記録 → Kit同期）
    const v2Pending = typeof readPendingDiagnosisV2 === 'function' ? readPendingDiagnosisV2() : null;
    if (readPendingDiagnosis() || v2Pending) return { skipped: 'save_pending' };
    const user = await getCurrentUser();
    if (!user) return { skipped: 'not_authenticated' };

    const { data: current, error: readError } = await supabaseClient
      .from('profiles')
      .select('newsletter_opted_in')
      .eq('id', user.id)
      .single();
    if (readError || !current) {
      ga('newsletter_subscribe_error', { reason: 'consent_unverifiable' });
      return { ok: false, reason: 'consent_unverifiable' }; // 保持したまま（次回再試行）
    }
    const decided = current.newsletter_opted_in;
    if (decided === true) {
      if (consent.optIn === true) {
        // 前回 DB 記録後に Kit 同期が失敗していた場合の再試行
        const ok = await syncToKit();
        return { ok: true, synced: ok, retried: true };
      }
      clearNewsletterConsent(); // 保存済みの判断と食い違う：上書きしない
      return { skipped: 'already_decided' };
    }
    if (decided === false) {
      clearNewsletterConsent(); // 以前の判断（停止）を、診断保存だけで変えない
      return { skipped: 'already_decided' };
    }
    if (decided !== null && decided !== undefined) {
      return { ok: false, reason: 'unexpected_type' }; // 型が確認できない：送らず保持
    }

    const recorded = await recordNewsletterDecision(user.id, consent.optIn);
    if (!recorded.ok) {
      ga('newsletter_subscribe_error', { reason: recorded.reason });
      return { ok: false, reason: recorded.reason }; // 保持したまま（次回再試行）
    }
    ga(consent.optIn ? 'newsletter_opt_in' : 'newsletter_opt_out');
    if (!consent.optIn) {
      clearNewsletterConsent();
      return { ok: true, synced: false };
    }
    const ok = await syncToKit();
    return { ok: true, synced: ok };
  } catch (e) {
    ga('newsletter_subscribe_error', { reason: 'exception' });
    return { ok: false, reason: 'exception' };
  } finally {
    newsletterConsentInFlight = false;
  }
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
    // null/undefinedは「すでに回答済みなので今回は聞いていない」。falseへ
    // 潰すと、以前の同意を再診断のたびに拒否へ上書きしてしまう。
    newsletterOptIn: newsletterOptIn == null ? null : !!newsletterOptIn,
  };
  // メール配信の選択は診断の pending とは別に一時保持し、保存完了後に processPendingNewsletterConsent() が扱う
  if (pending.newsletterOptIn !== null) stashNewsletterConsent(pending.newsletterOptIn);
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

// 同意が記録された本人だけを、サーバー経由でKitへ登録する。
// メールアドレスはブラウザから送らない。サーバーが認証トークンから本人のメールを取得し、
// DB上の同意 true を確認してから送る。失敗しても診断結果の保存には影響させない（画面に赤いエラーを出さない）。
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
   起動時：認証完了で戻ってきたらpending diagnosisを保存する（本番のまま無変更）
   ============================================================ */

let pendingSaveInFlight = false;
supabaseClient.auth.onAuthStateChange(async (event, session) => {
  // OAuthから戻った時点で既にセッション復元済みの場合、Supabaseは
  // SIGNED_INではなくINITIAL_SESSIONを通知する。どちらでもpendingを救済する。
  if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
  if (!session || pendingSaveInFlight) return;
  const pending = readPendingDiagnosis();
  if (!pending) return;

  pendingSaveInFlight = true;
  try {
    const result = await saveDiagnosisSession(pending);
    if (result.ok) {
      clearPendingDiagnosis();
      updateSaveButtonUI('saved');
      // 保存完了後に同意を記録し、同意 true を確認できた場合だけ Kit 同期（失敗しても保存は成功のまま）
      await processPendingNewsletterConsent().catch(() => {});
      // mypage.html上で認証復帰した場合、保存直後の履歴を同じ画面へ反映する。
      if (typeof window.refreshMypageHistory === 'function') {
        await window.refreshMypageHistory();
      }
    } else {
      // 保存失敗時もpendingは消さない。次回リトライできるようにする
      console.error('diagnosis save failed:', result.error);
      updateSaveButtonUI('error');
    }
  } finally {
    pendingSaveInFlight = false;
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
      await processPendingNewsletterConsent().catch(() => {});
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
