// js/type-detail.js
// タイプ解説ページ（type-v2 テンプレート）の画面上の動き。計測（GA4）は送らない（type_diagnosis_cta_click は js/type-page.js）。
//   ・一覧へ戻る：読んでいた元素を sessionStorage に残す（トップの一覧が、戻った時にその元素を開く。リンクの #types-<元素> と同じ）
//   ・標準プロフィール・タイプ別レポートの欄（data-preview-only）は、デザイン確認用。本番ドメインでは表示しない
//   ・タイプ別レポートの購入：「購入へ進む」で POST /api/type-report?op=buy（送るのはタイプコードと購入操作の ID だけ。
//     金額・商品はサーバーが決める）→ Stripe の決済画面へ。同じ画面での連打・再送は同じ購入操作の ID（同じ注文・同じ決済画面）
(function () {
  'use strict';
  if (window.__edTypeDetail) return;
  window.__edTypeDetail = true;
  var PRODUCTION_HOST = 'element-diagnosis-five.vercel.app';
  var KEY = 'ed_types_open_v1';
  var EL = /^(pyro|hydro|cryo|electro|anemo|geo|dendro)$/;

  function remember(el) {
    if (!EL.test(el || '')) return;
    try { sessionStorage.setItem(KEY, el); } catch (e) { /* 保存できなくても一覧はリンクの #types- で開く */ }
  }
  function init() {
    var body = document.body;
    remember(body && body.getAttribute('data-element'));

    if (location.hostname !== PRODUCTION_HOST) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-preview-only]'), function (n) { n.hidden = false; });
    }

    var dlg = document.getElementById('reportConfirm');
    var open = document.querySelector('[data-report-open]');
    if (dlg && open) {
      open.addEventListener('click', function () {
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      });
      Array.prototype.forEach.call(dlg.querySelectorAll('[data-report-close]'), function (b) {
        b.addEventListener('click', function () { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); });
      });
      dlg.addEventListener('click', function (e) { if (e.target === dlg && typeof dlg.close === 'function') dlg.close(); });
      var buyBtn = dlg.querySelector('[data-report-buy]');
      var errBox = dlg.querySelector('[data-report-error]');
      if (buyBtn) buyBtn.addEventListener('click', function () { buy(buyBtn, errBox); });
    }
  }
  var ERRORS = {
    sales_closed: 'タイプ別レポートは現在お申し込みいただけません。',
    too_many_attempts: 'お申し込みが集中しています。少し時間をおいてお試しください。',
    purchase_completed: 'このお申し込みはお支払いが済んでいます。お支払いの後に表示されたリンクからお読みください。',
  };
  var attempt = null; // この画面での購入操作の ID（同じ画面での再送は同じ注文・同じ決済画面）
  function newAttempt() {
    var b = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function buy(btn, errBox) {
    var type = document.body && document.body.getAttribute('data-type-code');
    if (!/^(PY|HY|CR|EL|AN|GE|DE)(SW|CM|PL|CT|BW)$/.test(type || '')) return;
    if (!attempt) attempt = newAttempt();
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '決済画面を準備しています…';
    if (errBox) errBox.hidden = true;
    fetch('/api/type-report?op=buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ type: type, attempt: attempt, source: 'type_page' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (r) {
        var b = r.body || {};
        if (r.status === 200 && typeof b.checkoutUrl === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(b.checkoutUrl)) {
          location.assign(b.checkoutUrl);
          return;
        }
        // 期限切れ・別の注文と衝突：新しい購入操作でやり直せるようにする
        if (b.error === 'attempt_expired' || b.error === 'attempt_conflict') attempt = null;
        throw new Error(b.error || 'request_failed');
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = label;
        if (errBox) { errBox.textContent = ERRORS[e && e.message] || 'いまは決済画面を開けませんでした。少し時間をおいてお試しください。'; errBox.hidden = false; }
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
