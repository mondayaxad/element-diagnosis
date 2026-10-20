// js/auth-providers.js
// ログイン方式の追加：既存の Google に加えて「X（OAuth 2.0）」と「メール（6桁OTP）」。
//
// ・Google ログインは既存の signInWithGoogle()（diagnosis-save.js）／signInWithGoogleV2()
//   （js/eti_v2_save.js）をそのまま使う。このファイルは Google の処理を持たない。
// ・X は Supabase の現行 provider 'x'（OAuth 2.0）。旧 'twitter'（OAuth 1.0a）は使わない。
//   復帰先は Google と同じ /mypage.html。復帰後の pending 保存は既存の onAuthStateChange
//   （diagnosis-save.js・js/eti_v2_save.js）が provider に関係なく行う。
// ・メールはパスワードなしの 6桁OTP。signInWithOtp でコードを送り、verifyOtp(type:'email') で
//   その場でログインする（ページ遷移なし）。Supabase のメールテンプレートに {{ .Token }} が必要。
// ・保存・RPC・購入権・DB には触れない。ログイン（auth）の開始と UI だけを担当する。
//
// 依存：diagnosis-save.js（supabaseClient）を先に読み込むこと。

const AUTH_OTP_LENGTH = 6;
const AUTH_OTP_RESEND_SEC = 60;

// ---- 使えるログイン方法（全画面の共通判定） ----
// Supabase の公開 Auth 設定（/auth/v1/settings。公開キーだけで読める）から、いま有効な方法を読む。
// Google・X は有効な時だけボタンを出す（無効な方法を押すと Supabase が 400 provider is not enabled を返すため）。
// 読めない・形が違う・時間内に返らない時は、安全側としてメールだけ。メールは常に出す（基本のログイン方法）。
// 設定の値（Client ID・Secret）は公開設定に含まれず、ここでも扱わない。
const AUTH_PROVIDERS_FALLBACK = Object.freeze({ email: true, google: false, x: false });
const AUTH_PROVIDERS_TIMEOUT_MS = 5000;
let authProvidersPromise = null;
let authProvidersState = null; // 読めた結果（読む前・読めない間は null）
function authEnabledProviders() {
  if (authProvidersPromise) return authProvidersPromise;
  authProvidersPromise = (async () => {
    try {
      const cfg = typeof publicSupabaseConfig !== 'undefined' ? publicSupabaseConfig : null;
      if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return AUTH_PROVIDERS_FALLBACK;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), AUTH_PROVIDERS_TIMEOUT_MS) : null;
      let res;
      try {
        res = await fetch(cfg.supabaseUrl + '/auth/v1/settings', { headers: { apikey: cfg.supabaseAnonKey }, signal: ctl ? ctl.signal : undefined });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!res || !res.ok) return AUTH_PROVIDERS_FALLBACK;
      const body = await res.json();
      const ext = body && body.external;
      if (!ext || typeof ext !== 'object') return AUTH_PROVIDERS_FALLBACK;
      // X は現行の provider 'x'（OAuth 2.0）だけ。旧 'twitter'（OAuth 1.0a）は使わない。
      // 公開設定に 'x' の項目が無い Supabase（GoTrue v2.197 など）では、ログイン開始の URL が
      // 移動（3xx）を返すかで判定する（無効なら 400 provider is not enabled）
      const x = Object.prototype.hasOwnProperty.call(ext, 'x') ? ext.x === true : await authProbeProvider(cfg, 'x');
      return Object.freeze({ email: true, google: ext.google === true, x: x });
    } catch (e) {
      return AUTH_PROVIDERS_FALLBACK;
    }
  })().then((v) => { authProvidersState = v; return v; });
  return authProvidersPromise;
}
// ログイン開始の URL を、画面を移動せずに問い合わせる。移動（opaqueredirect）なら有効、
// 400・通信の失敗・時間切れは無効（安全側）。外部の画面へは行かず、設定の値も読まない。
async function authProbeProvider(cfg, provider) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), AUTH_PROVIDERS_TIMEOUT_MS) : null;
  try {
    const res = await fetch(cfg.supabaseUrl + '/auth/v1/authorize?provider=' + encodeURIComponent(provider), {
      headers: { apikey: cfg.supabaseAnonKey }, redirect: 'manual', signal: ctl ? ctl.signal : undefined,
    });
    return !!res && (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400));
  } catch (e) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
// 同期の判定（読む前・読めない時は false＝出さない）
function authProviderEnabled(provider) {
  if (provider === 'email') return true;
  return !!(authProvidersState && authProvidersState[provider] === true);
}
// 有効な OAuth の方法の名前（案内の文に使う）
// アプリの中のブラウザ（LINE・Instagram・Facebook・X）：Google は埋め込みのブラウザでのログインを断る（disallowed_useragent）
function authInAppBrowser() {
  try { return /\bLine\/|Instagram|FBAN|FBAV|Twitter/i.test(navigator.userAgent || ''); } catch (e) { return false; }
}
function authOAuthLabels() {
  return [authProviderEnabled('google') ? 'Google' : null, authProviderEnabled('x') ? 'X' : null].filter(Boolean);
}
// 無効な方法でログイン・連携を始めない（ボタンを隠しても、別の入口から呼ばれた時の守り）
async function authEnsureProvider(provider) {
  const p = await authEnabledProviders();
  return p[provider] === true;
}
const AUTH_PROVIDER_DISABLED_ERROR = Object.freeze({ code: 'provider_disabled', message: 'provider is not enabled' });
if (typeof window !== 'undefined') authEnabledProviders();

async function signInWithX(redirectTo) {
  if (!(await authEnsureProvider('x'))) return { error: AUTH_PROVIDER_DISABLED_ERROR };
  return supabaseClient.auth.signInWithOAuth({
    provider: 'x',
    options: { redirectTo: redirectTo || window.location.origin + '/mypage.html' },
  });
}

// 6桁コードをメールで送る。初回のメールアドレスならこの時点でユーザーが作られる。
async function sendEmailOtp(email) {
  const { error } = await supabaseClient.auth.signInWithOtp({
    email: email,
    options: {
      shouldCreateUser: true,
      // テンプレートがリンク形式のままでも、リンクからマイページへ戻れるようにしておく
      emailRedirectTo: window.location.origin + '/mypage.html',
    },
  });
  return error || null;
}

async function verifyEmailOtp(email, token) {
  const { error } = await supabaseClient.auth.verifyOtp({ email: email, token: token, type: 'email' });
  return error || null;
}

function isValidEmailForOtp(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Supabase のエラーを利用者向けの文に変える（詳細はconsoleへ）
// 送信の失敗は、Supabase の送信上限（429）でもメール送信サービス側の上限・障害（5xx）でも
// 利用者には区別がつかず、しばらく復旧しないことがあるため、Google / X へ案内する。
function authEmailUnavailableMessage() {
  // ログインの部品（supabase-js）自体を読み込めなかった：混雑ではない。通信・拡張機能を確かめて読み込み直す
  if (typeof supabaseClient !== 'undefined' && supabaseClient && supabaseClient.unavailable) {
    return 'ログインの準備ができませんでした。通信や拡張機能（広告ブロックなど）をご確認のうえ、ページを読み込み直してください。';
  }
  const names = authOAuthLabels();
  return names.length
    ? `いまメールでのログインが混み合っています。${names.join(' または ')} でのログインをお試しください。`
    : 'いまメールでのログインが混み合っています。時間をおいて、もう一度お試しください。';
}
// 送信・確認の失敗の種類（第17節）。Supabase の error.code / status で分ける（文言の一致では判定しない）
//   request_limit：短い間の送り直し（同じアドレスへの再送の間隔）。しばらく待てば送れる
//   hourly_limit ：1時間あたりのメール送信の上限。1時間ほど待つか、Google / X
//   expired      ：コードの期限切れ・誤り（Supabase は両方を otp_expired で返す）
//   unavailable  ：それ以外の送信の失敗（メール送信サービスの障害など）
function authOtpErrorKind(error, phase) {
  const code = String((error && (error.code || error.error_code)) || '');
  const status = Number(error && error.status);
  if (phase === 'verify') return code === 'over_request_rate_limit' || status === 429 ? 'request_limit' : 'expired';
  if (code === 'over_email_send_rate_limit') return 'hourly_limit';
  if (code === 'over_request_rate_limit' || status === 429) return 'request_limit';
  return 'unavailable';
}
// 再送までの秒数（Supabase の文「…after 37 seconds」から。読めなければ既定の間隔）
function authOtpRetryAfter(error) {
  const m = /(\d+)\s*seconds?/.exec(String((error && error.message) || ''));
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n <= 3600 ? n : AUTH_OTP_RESEND_SEC;
}
function authErrorMessage(error, phase) {
  const kind = authOtpErrorKind(error, phase);
  if (kind === 'expired') return 'コードが正しくないか、有効期限が切れています。最新のメールに届いたコードを入力してください。';
  if (kind === 'request_limit') return phase === 'verify'
    ? '短い間に何度も確認しました。少し待ってから、もう一度お試しください。'
    : '短い間に何度も送信しました。少し待ってから、もう一度お試しください。届いているコードがあれば、そのまま入力できます。';
  if (kind === 'hourly_limit') {
    const names = authOAuthLabels();
    return 'メールの送信回数の上限に達しました。1時間ほど待ってから、もう一度お試しください。'
      + (names.length ? `すぐにログインする場合は ${names.join(' または ')} をお使いください。` : '')
      + '届いているコードがあれば、そのまま入力できます。';
  }
  return authEmailUnavailableMessage();
}

const AUTH_ICON_GOOGLE = '<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
const AUTH_ICON_X = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12z"/></svg>';
const AUTH_ICON_MAIL = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M3.5 5.5h17v13h-17z M3.5 6l8.5 7 8.5-7"/></svg>';

function injectAuthChoiceStyles() {
  if (document.getElementById('au-style')) return;
  const s = document.createElement('style');
  s.id = 'au-style';
  s.textContent = `
    .au { display: flex; flex-direction: column; gap: 10px; text-align: center; }
    .au-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; box-sizing: border-box;
      border-radius: 8px; padding: 13px; font-size: 13.5px; font-family: inherit; font-weight: 700; letter-spacing: .04em; cursor: pointer;
      border: 1px solid rgba(150,180,240,.22); background: rgba(16,24,48,.7); color: #dfe8f8; }
    .au-btn:hover { filter: brightness(1.1); }
    .au-btn[disabled] { cursor: default; opacity: .6; filter: none; }
    .au-btn:focus-visible { outline: 1px solid #8fb6e8; outline-offset: 3px; }
    .au-btn.au-google { background: #fff; color: #1f1f1f; border-color: #fff; }
    .au-btn.au-x { background: #000; color: #fff; border-color: rgba(255,255,255,.28); }
    .au-or { display: flex; align-items: center; gap: 12px; color: #6f7ea3; font-size: 11px; letter-spacing: .1em; margin: 4px 0; }
    .au-or::before, .au-or::after { content: ''; flex: 1; height: 1px; background: rgba(150,180,240,.16); }
    .au-row { display: flex; gap: 8px; }
    .au-input { flex: 1; min-width: 0; box-sizing: border-box; background: rgba(6,9,20,.8); border: 1px solid rgba(150,180,240,.22); border-radius: 8px;
      padding: 12px; color: #e6eefc; font-size: 16px; font-family: inherit; }
    .au-input:focus { outline: 1px solid #8fb6e8; }
    .au-input.au-code { text-align: center; letter-spacing: .5em; font-size: 18px; }
    .au-row .au-btn { width: auto; flex: none; padding: 12px 16px; }
    .au-note { font-size: 12px; line-height: 1.8; color: #9aa8c6; margin: 0; word-break: auto-phrase; }
    .au-msg { font-size: 12px; line-height: 1.7; color: #d6a8b8; min-height: 0; margin: 0; }
    .au-msg:empty { display: none; }
    .au-msg-info { color: #c9d6ee; font-size: 12.5px; margin-bottom: 4px; word-break: auto-phrase; }
    .au-sub { display: flex; justify-content: center; gap: 18px; }
    .au-link { background: none; border: 0; padding: 4px; color: #8aa3c8; font-size: 11.5px; font-family: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .au-link[disabled] { color: #56627e; cursor: default; text-decoration: none; }
  `;
  document.head.appendChild(s);
}

function escapeAuthHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 3方式のログイン選択を container に描く。
 * @param {HTMLElement} container
 * @param {object} h
 *   onGoogle()          … 既存の Google ログインを呼ぶ（呼び出し側で用意）
 *   onX()               … X ログイン開始。省略時は signInWithX()
 *   onEmailSignedIn()   … メールOTPでログインできた直後に呼ばれる
 *   onChoose(method)    … 方式を選んだ時点の通知（計測など。任意）
 *   googleButtonId      … Google ボタンに付ける id（既存の id を保つため。任意）
 */
function renderAuthChoices(container, h) {
  injectAuthChoiceStyles();
  const handlers = h || {};
  const choose = m => { if (typeof handlers.onChoose === 'function') handlers.onChoose(m); };

  // Google・X は、公開 Auth 設定で有効な時だけ出す（authEnabledProviders の共通判定）
  const providerButtonsHtml = () => (authProviderEnabled('google')
    ? `
        <button type="button" class="au-btn au-google" data-au="google"${handlers.googleButtonId ? ` id="${handlers.googleButtonId}"` : ''}>${AUTH_ICON_GOOGLE}Googleで続ける</button>`
        + (authInAppBrowser() ? '<p class="au-inapp" role="note" style="margin:6px 0 0;font-size:12px;line-height:1.7;color:#b9b2d6">アプリの中のブラウザでは、Google でログインできないことがあります。Safari などのブラウザで開くか、メールで続けてください。</p>' : '') : '')
    + (authProviderEnabled('x') ? `
        <button type="button" class="au-btn au-x" data-au="x">${AUTH_ICON_X}Xで続ける</button>` : '');
  let view = 'choices';
  let lastMessage = '';

  function wireProviderButtons() {
    const g = container.querySelector('[data-au="google"]');
    if (g) g.onclick = () => { choose('google'); handlers.onGoogle(); };
    const xb = container.querySelector('[data-au="x"]');
    if (xb) xb.onclick = async (ev) => {
      choose('x');
      ev.currentTarget.disabled = true;
      const { error } = await (handlers.onX ? handlers.onX() : signInWithX()) || {};
      if (error) {
        console.error('X sign-in error:', error);
        showChoices('Xでのログインを開始できませんでした。時間をおいて、もう一度お試しください。');
      }
    };
  }

  function showChoices(message) {
    view = 'choices';
    lastMessage = message || '';
    const providers = providerButtonsHtml();
    container.innerHTML = `
      <div class="au">${providers}
        ${providers ? '<div class="au-or">または</div>' : ''}
        <button type="button" class="au-btn" data-au="email">${AUTH_ICON_MAIL}メールで続ける</button>
        <p class="au-msg" role="alert">${message ? escapeAuthHtml(message) : ''}</p>
      </div>`;
    wireProviderButtons();
    container.querySelector('[data-au="email"]').onclick = () => { choose('email'); showEmailInput(''); };
  }

  // メール送信に失敗したとき：Google / X を前面に出す（メール欄に留めない）
  function showEmailUnavailable(email) {
    view = 'email-unavailable';
    container.innerHTML = `
      <div class="au" data-au-state="email-unavailable">
        <p class="au-msg au-msg-info" role="alert">${escapeAuthHtml(authEmailUnavailableMessage())}</p>${providerButtonsHtml()}
        <div class="au-sub"><button type="button" class="au-link" id="auRetryEmail">メールでもう一度試す</button></div>
      </div>`;
    wireProviderButtons();
    container.querySelector('#auRetryEmail').onclick = () => showEmailInput(email);
  }

  function showEmailInput(prefill, message) {
    view = 'email';
    container.innerHTML = `
      <div class="au">
        <p class="au-note">メールアドレスに、6桁の確認コードを送ります。<br>パスワードは使いません。</p>
        <div class="au-row">
          <input class="au-input" id="auEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${escapeAuthHtml(prefill)}" aria-label="メールアドレス">
          <button type="button" class="au-btn" id="auSend">コードを送る</button>
        </div>
        <p class="au-msg" role="alert">${message ? escapeAuthHtml(message) : ''}</p>
        <div class="au-sub"><button type="button" class="au-link" id="auBack">ほかの方法にする</button></div>
      </div>`;
    const input = container.querySelector('#auEmail');
    const send = container.querySelector('#auSend');
    const msg = container.querySelector('.au-msg');
    container.querySelector('#auBack').onclick = () => showChoices();
    const submit = async () => {
      const email = input.value.trim();
      if (!isValidEmailForOtp(email)) { msg.textContent = 'メールアドレスの形式を確かめてください。'; return; }
      send.disabled = true; send.textContent = '送信中…'; msg.textContent = '';
      const error = await sendEmailOtp(email);
      if (error) {
        console.error('email OTP send error:', error && error.code ? error.code : 'unknown');
        const kind = authOtpErrorKind(error, 'send');
        // 送信の上限：直前に送ったコードが届いている場合があるため、コードの入力へ進める（入力欄に留めない）
        if (kind === 'request_limit' || kind === 'hourly_limit') { showCodeInput(email, authErrorMessage(error, 'send'), authOtpRetryAfter(error)); return; }
        showEmailUnavailable(email);
        return;
      }
      showCodeInput(email);
    };
    send.onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') submit(); };
    input.focus();
  }

  // コードの入力（誤り・期限切れ・429 でもこの画面のまま。同じ入力では自動で送り直さない）
  function showCodeInput(email, firstMessage, waitSec) {
    view = 'code';
    container.innerHTML = `
      <div class="au">
        <p class="au-note"><b>${escapeAuthHtml(email)}</b> に<br>6桁の確認コードを送りました。</p>
        <div class="au-row">
          <input class="au-input au-code" id="auCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="${AUTH_OTP_LENGTH}" placeholder="000000" aria-label="確認コード">
          <button type="button" class="au-btn" id="auVerify">ログイン</button>
        </div>
        <p class="au-msg" role="alert">${firstMessage ? escapeAuthHtml(firstMessage) : ''}</p>
        <p class="au-note au-resend-wait" id="auResendWait" aria-live="polite"></p>
        <div class="au-sub">
          <button type="button" class="au-link" id="auResend" disabled>コードを再送する</button>
          <button type="button" class="au-link" id="auChange">メールアドレスを変える</button>
        </div>
      </div>`;
    const input = container.querySelector('#auCode');
    const verify = container.querySelector('#auVerify');
    const msg = container.querySelector('.au-msg');
    const resend = container.querySelector('#auResend');
    container.querySelector('#auChange').onclick = () => showEmailInput(email);

    const wait = container.querySelector('#auResendWait');
    // 再送までの残り時間（「あとN秒で再送できます」）。時刻で数える（タブが裏にあっても狂わない）
    let until = Date.now() + (waitSec || AUTH_OTP_RESEND_SEC) * 1000;
    let timer = null;
    const tick = () => {
      if (!container.contains(resend)) return;
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) { resend.disabled = false; wait.textContent = ''; return; }
      resend.disabled = true;
      wait.textContent = `あと${left}秒で再送できます`;
      timer = setTimeout(tick, 1000);
    };
    tick();
    resend.onclick = async () => {
      if (resend.disabled) return;
      resend.disabled = true; msg.textContent = '';
      const error = await sendEmailOtp(email);
      let next = AUTH_OTP_RESEND_SEC;
      if (error) {
        console.error('email OTP resend error:', error && error.code ? error.code : 'unknown');
        msg.textContent = authErrorMessage(error, 'send');
        next = authOtpRetryAfter(error);
      } else {
        msg.textContent = '新しいコードを送りました。最新のメールに届いたコードを入力してください。';
        lastTried = '';
      }
      if (timer) clearTimeout(timer);
      until = Date.now() + next * 1000; tick();
    };

    // 最後に確認したコード：失敗した同じコードは、入力が変わるまで自動では送り直さない（押した時は送る）
    let lastTried = '';
    const submit = async (auto) => {
      if (verify.disabled) return;
      const token = input.value.replace(/\D/g, '');
      if (token.length !== AUTH_OTP_LENGTH) { msg.textContent = `${AUTH_OTP_LENGTH}桁のコードを入力してください。`; return; }
      if (auto === true && token === lastTried) return;
      lastTried = token;
      verify.disabled = true; verify.textContent = '確認中…'; msg.textContent = '';
      const error = await verifyEmailOtp(email, token);
      if (error) {
        console.error('email OTP verify error:', error && error.code ? error.code : 'unknown');
        verify.disabled = false; verify.textContent = 'ログイン';
        msg.textContent = authErrorMessage(error, 'verify');
        if (container.contains(input)) { input.focus(); input.select(); }
        return;
      }
      if (typeof handlers.onEmailSignedIn === 'function') handlers.onEmailSignedIn();
    };
    verify.onclick = () => submit(false);
    input.oninput = () => { if (input.value.replace(/\D/g, '').length === AUTH_OTP_LENGTH) submit(true); };
    input.onkeydown = e => { if (e.key === 'Enter') submit(false); };
    input.focus();
  }

  showChoices();
  // 公開 Auth 設定を読めたら、選択の画面のまま描き直す（入力中のメール・コードの画面は変えない）
  if (!authProvidersState) {
    authEnabledProviders().then(() => {
      if (view === 'choices' && container.isConnected && container.querySelector('[data-au="email"]')) showChoices(lastMessage);
    });
  }
}

// ---- ログイン方法の連携（マイページ） ----
// ログイン中のアカウントに、別のログイン方法（Google / X）を追加する。同じ user_id のまま
// 次回からどちらでもログインできる。Supabase の「Manual linking」が有効である必要がある。
// 解除はログイン方法が2つ以上あるときだけ（最後の1つは外せない）。
const AUTH_LINKABLE_PROVIDERS = [
  { provider: 'google', label: 'Google' },
  { provider: 'x', label: 'X' },
];

// user.identities から、つながっているログイン方法を返す（X は旧名 twitter も X として扱う）
function authLinkedProviders(user) {
  const set = new Set();
  ((user && user.identities) || []).forEach(i => {
    const p = i && i.provider;
    if (!p) return;
    set.add(p === 'twitter' ? 'x' : p);
  });
  return set;
}

async function linkAuthProvider(provider) {
  if (!(await authEnsureProvider(provider))) return { error: AUTH_PROVIDER_DISABLED_ERROR };
  return supabaseClient.auth.linkIdentity({
    provider: provider,
    options: { redirectTo: window.location.origin + '/mypage.html' },
  });
}

// 連携の解除。最後の1つは外せない（ログインできなくなるため）。記録（user_id）はそのまま。
function authIdentityFor(user, provider) {
  return ((user && user.identities) || []).find(i => i && (i.provider === provider || (provider === 'x' && i.provider === 'twitter'))) || null;
}
function canUnlinkAuthProvider(user, provider) {
  const all = (user && user.identities) || [];
  return all.length >= 2 && !!authIdentityFor(user, provider);
}
async function unlinkAuthProvider(user, provider) {
  if (!canUnlinkAuthProvider(user, provider)) return { error: { code: 'single_identity_not_deletable' } };
  const { error } = await supabaseClient.auth.unlinkIdentity(authIdentityFor(user, provider));
  return { error: error || null };
}
function authUnlinkErrorMessage(err) {
  const code = (err && (err.code || err.error_code)) || '';
  const text = ((err && err.message) || '').toLowerCase();
  if (/single_identity_not_deletable|at least 2|only one/.test(code + ' ' + text)) {
    return 'ログイン方法が1つだけのときは解除できません。';
  }
  return 'ログイン方法を解除できませんでした。時間をおいて、もう一度お試しください。';
}

// OAuth から戻ったときの URL に付くエラー（例：連携しようとした X が別アカウントで使用中）を読み、
// URL からは取り除く。supabase-js が URL を処理する前に、読み込み時点で控えておく。
function readAuthReturnError() {
  try {
    const params = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const q = new URLSearchParams(window.location.search || '');
    const code = params.get('error_code') || q.get('error_code') || params.get('error') || q.get('error');
    if (!code) return null;
    const description = params.get('error_description') || q.get('error_description') || '';
    return { code: code, description: description };
  } catch (e) {
    return null;
  }
}
const AUTH_RETURN_ERROR = typeof window !== 'undefined' && window.location ? readAuthReturnError() : null;
// エラー付きで戻ってきた場合だけ、URL のエラー部分を消す（再読み込みで同じ案内が出続けないように）
if (AUTH_RETURN_ERROR && typeof history !== 'undefined' && history.replaceState) {
  try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* noop */ }
}

// OAuth から戻った時のエラーの案内は1回だけ出す（描き直すたびに同じ案内を出し続けない）
let authReturnErrorShown = false;
function takeAuthReturnError() {
  if (!AUTH_RETURN_ERROR || authReturnErrorShown) return null;
  authReturnErrorShown = true;
  return AUTH_RETURN_ERROR;
}
// ログイン（未ログインの画面）で戻った時のエラーの案内
function authSignInErrorMessage(err) {
  const code = (err && (err.code || err.error_code)) || '';
  const text = ((err && (err.description || err.message)) || '').toLowerCase();
  if (/access_denied/.test(code)) return 'ログインを中止しました。';
  if (/email/.test(text)) return 'このアカウントからメールアドレスを受け取れなかったため、ログインできませんでした。別の方法でお試しください。';
  return 'ログインできませんでした。時間をおいて、もう一度お試しいただくか、別の方法でお試しください。';
}
function authLinkErrorMessage(err) {
  const code = (err && (err.code || err.error_code)) || '';
  const text = ((err && (err.description || err.message)) || '').toLowerCase();
  if (/identity_already_exists|already linked|already exists/.test(code + ' ' + text)) {
    return 'このアカウントは、すでに別の記録で使われているため連携できませんでした。';
  }
  if (/manual_linking_disabled|manual linking/.test(code + ' ' + text)) {
    return 'ログイン方法の連携は、現在準備中です。';
  }
  if (/access_denied/.test(code)) return '連携を中止しました。';
  return 'ログイン方法を連携できませんでした。時間をおいて、もう一度お試しください。';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { signInWithX, sendEmailOtp, verifyEmailOtp, isValidEmailForOtp, authErrorMessage, authEmailUnavailableMessage,
    authEnabledProviders, authProviderEnabled, AUTH_PROVIDERS_FALLBACK,
    authLinkedProviders, authLinkErrorMessage, authSignInErrorMessage, takeAuthReturnError, AUTH_LINKABLE_PROVIDERS, canUnlinkAuthProvider, authUnlinkErrorMessage };
}
