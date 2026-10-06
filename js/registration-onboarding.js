// js/registration-onboarding.js
// 登録完了モーダル（新規ユーザーの初回認証後だけ）。2026-10-07
//
// ・表示するかどうかの判定と同意の記録は diagnosis-save.js（ensureRegistrationComplete）が行う。
//   このファイルは画面だけを担当する：window.showRegistrationOnboarding({ userId, onAccept })
//   → Promise<'accepted' | 'declined'>
// ・利用規約・プライバシーポリシーは必須の2項目。「下記の規約にすべて同意する」は2項目をまとめて切り替える。
// ・メール案内専用のチェックボックスは設けない。配信内容はボタンの直前に、読める大きさ・コントラストで明示する。
// ・規約のリンクは新しいタブで開く。チェックの状態は sessionStorage（ユーザーごと）に保持し、戻っても失わない。
// ・role="dialog"・aria-modal、フォーカスはモーダル内に閉じ込める。Esc では閉じない（誤操作でサインアウトしない）。
// ・同意ボタンは押した時点で無効化する（二重送信しない）。記録に失敗したらモーダル内でエラーを出し、再試行できる。

const REGISTRATION_ONBOARDING_DRAFT_PREFIX = 'registrationOnboardingDraft_v1:';
const REGISTRATION_NEWSLETTER_NOTICE = '登録した方には、診断結果の保存やアカウント管理に必要なご案内のほか、'
  + '元素診断のアップデート、新しい解析、関連する商品・企画などのお知らせをメールでお届けすることがあります。'
  + '配信はいつでも停止できます。';

function readRegistrationDraft(userId) {
  try {
    const raw = sessionStorage.getItem(REGISTRATION_ONBOARDING_DRAFT_PREFIX + userId);
    const d = raw ? JSON.parse(raw) : null;
    return { terms: !!(d && d.terms), privacy: !!(d && d.privacy) };
  } catch (e) {
    return { terms: false, privacy: false };
  }
}
function writeRegistrationDraft(userId, draft) {
  try { sessionStorage.setItem(REGISTRATION_ONBOARDING_DRAFT_PREFIX + userId, JSON.stringify(draft)); } catch (e) { /* noop */ }
}
function clearRegistrationDraft(userId) {
  try { sessionStorage.removeItem(REGISTRATION_ONBOARDING_DRAFT_PREFIX + userId); } catch (e) { /* noop */ }
}

function injectRegistrationOnboardingStyles() {
  if (document.getElementById('ro-style')) return;
  const s = document.createElement('style');
  s.id = 'ro-style';
  s.textContent = `
    .ro-overlay { position: fixed; inset: 0; z-index: 10000; background: rgba(4,6,14,.82); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
    .ro-dialog { width: 100%; max-width: 440px; max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
      background: #0f1730; border: 1px solid rgba(150,180,240,.28); border-radius: 12px; padding: 24px 20px 20px; color: #e6eefc;
      font-family: inherit; text-align: left; }
    .ro-title { font-size: 17px; font-weight: 700; letter-spacing: .04em; margin: 0 0 18px; line-height: 1.5; }
    .ro-title:focus { outline: none; }
    .ro-check { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 4px; font-size: 14px; line-height: 1.6; cursor: pointer; }
    .ro-check input { flex: none; width: 20px; height: 20px; margin: 0; accent-color: #6f98dc; cursor: pointer; }
    .ro-check input:focus-visible { outline: 2px solid #9cc4f0; outline-offset: 2px; }
    .ro-all { font-weight: 700; border-bottom: 1px solid rgba(150,180,240,.18); padding-bottom: 10px; margin-bottom: 4px; }
    .ro-check a { color: #9cc4f0; text-decoration: underline; text-underline-offset: 3px; }
    .ro-check a:focus-visible { outline: 2px solid #9cc4f0; outline-offset: 2px; }
    .ro-req { color: #f0c38a; font-size: 12.5px; margin-left: 2px; }
    .ro-notice { margin: 16px 0 0; padding: 12px 14px; background: rgba(150,180,240,.08); border-radius: 8px;
      font-size: 13.5px; line-height: 1.85; color: #dbe6fa; word-break: auto-phrase; }
    .ro-err { margin: 12px 0 0; font-size: 13px; line-height: 1.7; color: #f2b8c6; }
    .ro-err:empty { display: none; }
    .ro-actions { display: flex; gap: 10px; margin-top: 18px; }
    .ro-btn { flex: 1; min-height: 48px; border-radius: 8px; font-size: 14px; font-weight: 700; font-family: inherit; letter-spacing: .03em; cursor: pointer; padding: 10px 12px; }
    .ro-btn:focus-visible { outline: 2px solid #9cc4f0; outline-offset: 3px; }
    .ro-btn[disabled] { cursor: default; opacity: .5; }
    .ro-no { flex: 0 0 34%; background: transparent; color: #c9d6ee; border: 1px solid rgba(150,180,240,.35); }
    .ro-yes { background: #e8eefb; color: #0b1226; border: 1px solid #e8eefb; }
    @media (max-width: 360px) { .ro-actions { flex-direction: column-reverse; } .ro-no { flex: 1; } }
  `;
  document.head.appendChild(s);
}

let registrationOnboardingOpen = null;

function showRegistrationOnboarding(opts) {
  if (registrationOnboardingOpen) return registrationOnboardingOpen;
  const userId = (opts && opts.userId) || 'unknown';
  const onAccept = (opts && opts.onAccept) || (async () => ({ ok: false }));

  registrationOnboardingOpen = new Promise((resolve) => {
    injectRegistrationOnboardingStyles();
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.className = 'ro-overlay';
    overlay.innerHTML = `
      <div class="ro-dialog" role="dialog" aria-modal="true" aria-labelledby="roTitle" aria-describedby="roNotice">
        <h2 class="ro-title" id="roTitle" tabindex="-1">利用規約とプライバシーポリシー</h2>
        <label class="ro-check ro-all"><input type="checkbox" id="roAll">下記の規約にすべて同意する</label>
        <label class="ro-check"><input type="checkbox" id="roTerms"><span><a href="/terms.html" target="_blank" rel="noopener">利用規約</a><span class="ro-req">（必須）</span></span></label>
        <label class="ro-check"><input type="checkbox" id="roPrivacy"><span><a href="/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a><span class="ro-req">（必須）</span></span></label>
        <p class="ro-notice" id="roNotice">${REGISTRATION_NEWSLETTER_NOTICE}</p>
        <p class="ro-err" id="roErr" role="alert"></p>
        <div class="ro-actions">
          <button type="button" class="ro-btn ro-no" id="roNo">いいえ</button>
          <button type="button" class="ro-btn ro-yes" id="roYes" disabled>同意して登録を完了する</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const dialog = overlay.querySelector('.ro-dialog');
    const all = overlay.querySelector('#roAll');
    const terms = overlay.querySelector('#roTerms');
    const privacy = overlay.querySelector('#roPrivacy');
    const yes = overlay.querySelector('#roYes');
    const no = overlay.querySelector('#roNo');
    const err = overlay.querySelector('#roErr');
    let busy = false;

    const draft = readRegistrationDraft(userId);
    terms.checked = draft.terms;
    privacy.checked = draft.privacy;

    const sync = () => {
      const both = terms.checked && privacy.checked;
      all.checked = both;
      all.indeterminate = !both && (terms.checked || privacy.checked);
      yes.disabled = busy || !both;
      no.disabled = busy;
      writeRegistrationDraft(userId, { terms: terms.checked, privacy: privacy.checked });
    };
    all.onchange = () => { terms.checked = all.checked; privacy.checked = all.checked; sync(); };
    terms.onchange = sync;
    privacy.onchange = sync;
    sync();

    const close = (result) => {
      overlay.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      document.body.style.overflow = previousOverflow;
      registrationOnboardingOpen = null;
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
        try { previousFocus.focus(); } catch (e) { /* noop */ }
      }
      resolve(result);
    };

    no.onclick = () => {
      if (busy) return;
      close('declined');
    };
    yes.onclick = async () => {
      if (busy || !(terms.checked && privacy.checked)) return;
      busy = true;
      err.textContent = '';
      yes.setAttribute('aria-busy', 'true');
      yes.textContent = '登録しています…';
      sync();
      let res;
      try { res = await onAccept(); } catch (e) { res = { ok: false }; }
      if (res && res.ok) {
        clearRegistrationDraft(userId);
        close('accepted');
        return;
      }
      busy = false;
      yes.removeAttribute('aria-busy');
      yes.textContent = '同意して登録を完了する';
      err.textContent = '登録を完了できませんでした。通信状況を確かめて、もう一度お試しください。';
      sync();
      yes.focus();
    };

    // フォーカスをモーダル内に閉じ込める。Esc では閉じない。
    const focusables = () => Array.from(dialog.querySelectorAll('input, a[href], button')).filter((el) => !el.disabled);
    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !dialog.contains(active))) { e.preventDefault(); first.focus(); }
    }
    overlay.addEventListener('keydown', onKeydown, true);
    // フォーカスがモーダルの外（背景）へ出たら、モーダル内へ戻す
    document.addEventListener('focusin', function keepFocus(ev) {
      if (!document.contains(overlay)) { document.removeEventListener('focusin', keepFocus, true); return; }
      if (!overlay.contains(ev.target)) { const list = focusables(); if (list.length) list[0].focus(); }
    }, true);

    all.focus();
  });
  return registrationOnboardingOpen;
}

if (typeof window !== 'undefined') window.showRegistrationOnboarding = showRegistrationOnboarding;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { showRegistrationOnboarding, REGISTRATION_NEWSLETTER_NOTICE };
}
