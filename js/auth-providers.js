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

function signInWithX(redirectTo) {
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
function authErrorMessage(error, phase) {
  const code = (error && (error.code || error.error_code)) || '';
  const status = error && error.status;
  if (status === 429 || /rate_limit/.test(code)) return '送信が続いたため、少し時間をおいてからお試しください。';
  if (phase === 'verify') return 'コードが正しくないか、有効期限が切れています。';
  return '送信できませんでした。メールアドレスを確かめて、もう一度お試しください。';
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

  function showChoices(message) {
    container.innerHTML = `
      <div class="au">
        <button type="button" class="au-btn au-google" data-au="google"${handlers.googleButtonId ? ` id="${handlers.googleButtonId}"` : ''}>${AUTH_ICON_GOOGLE}Googleで続ける</button>
        <button type="button" class="au-btn au-x" data-au="x">${AUTH_ICON_X}Xで続ける</button>
        <div class="au-or">または</div>
        <button type="button" class="au-btn" data-au="email">${AUTH_ICON_MAIL}メールで続ける</button>
        <p class="au-msg" role="alert">${message ? escapeAuthHtml(message) : ''}</p>
      </div>`;
    container.querySelector('[data-au="google"]').onclick = () => { choose('google'); handlers.onGoogle(); };
    container.querySelector('[data-au="x"]').onclick = async (ev) => {
      choose('x');
      ev.currentTarget.disabled = true;
      const { error } = await (handlers.onX ? handlers.onX() : signInWithX()) || {};
      if (error) {
        console.error('X sign-in error:', error);
        showChoices('Xでのログインを開始できませんでした。時間をおいて、もう一度お試しください。');
      }
    };
    container.querySelector('[data-au="email"]').onclick = () => { choose('email'); showEmailInput(''); };
  }

  function showEmailInput(prefill, message) {
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
        console.error('email OTP send error:', error);
        send.disabled = false; send.textContent = 'コードを送る';
        msg.textContent = authErrorMessage(error, 'send');
        return;
      }
      showCodeInput(email);
    };
    send.onclick = submit;
    input.onkeydown = e => { if (e.key === 'Enter') submit(); };
    input.focus();
  }

  function showCodeInput(email) {
    container.innerHTML = `
      <div class="au">
        <p class="au-note"><b>${escapeAuthHtml(email)}</b> に<br>6桁の確認コードを送りました。</p>
        <div class="au-row">
          <input class="au-input au-code" id="auCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="${AUTH_OTP_LENGTH}" placeholder="000000" aria-label="確認コード">
          <button type="button" class="au-btn" id="auVerify">ログイン</button>
        </div>
        <p class="au-msg" role="alert"></p>
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

    let left = AUTH_OTP_RESEND_SEC;
    const tick = () => {
      if (!container.contains(resend)) return;
      if (left <= 0) { resend.disabled = false; resend.textContent = 'コードを再送する'; return; }
      resend.textContent = `コードを再送する（${left}秒）`; left -= 1; setTimeout(tick, 1000);
    };
    tick();
    resend.onclick = async () => {
      resend.disabled = true; msg.textContent = '';
      const error = await sendEmailOtp(email);
      if (error) { console.error('email OTP resend error:', error); msg.textContent = authErrorMessage(error, 'send'); }
      else msg.textContent = '';
      left = AUTH_OTP_RESEND_SEC; tick();
    };

    const submit = async () => {
      if (verify.disabled) return;
      const token = input.value.replace(/\D/g, '');
      if (token.length !== AUTH_OTP_LENGTH) { msg.textContent = `${AUTH_OTP_LENGTH}桁のコードを入力してください。`; return; }
      verify.disabled = true; verify.textContent = '確認中…'; msg.textContent = '';
      const error = await verifyEmailOtp(email, token);
      if (error) {
        console.error('email OTP verify error:', error);
        verify.disabled = false; verify.textContent = 'ログイン';
        msg.textContent = authErrorMessage(error, 'verify');
        return;
      }
      if (typeof handlers.onEmailSignedIn === 'function') handlers.onEmailSignedIn();
    };
    verify.onclick = submit;
    input.oninput = () => { if (input.value.replace(/\D/g, '').length === AUTH_OTP_LENGTH) submit(); };
    input.onkeydown = e => { if (e.key === 'Enter') submit(); };
    input.focus();
  }

  showChoices();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { signInWithX, sendEmailOtp, verifyEmailOtp, isValidEmailForOtp, authErrorMessage };
}
