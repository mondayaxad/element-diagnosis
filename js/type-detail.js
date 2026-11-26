// js/type-detail.js
// タイプ解説ページの画面上の動きと、Stripe へ進む時の決済開始計測。
//   ・一覧へ戻る：読んでいた元素を sessionStorage に残す（トップの一覧が、戻った時にその元素を開く。リンクの #types-<元素> と同じ）
//   ・標準プロフィール・タイプ別レポートの欄（data-preview-only）：Preview では常に表示。本番ドメインでは販売中（typeReportSalesOpen）の時だけ
//   ・タイプ別レポートの購入：「購入へ進む」で POST /api/type-report?op=buy（タイプコード・購入操作 ID・取得できた GA4 の参照を送る。
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

    // レポートの欄：Preview・ローカルは常に出す（デザイン確認）。本番ドメインは、販売中（/api/public-config の typeReportSalesOpen）の時だけ
    var reveal = function () { Array.prototype.forEach.call(document.querySelectorAll('[data-preview-only]'), function (n) { n.hidden = false; }); };
    if (location.hostname !== PRODUCTION_HOST) reveal();
    else {
      fetch('/api/public-config', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (c) { if (c && c.typeReportSalesOpen === true) reveal(); })
        .catch(function () { /* 取得できなければ出さない */ });
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
      if (buyBtn) {
        // 指が触れた・ポインターが乗った時点で決済画面の準備（POST op=buy）を始め、押した時の待ち時間を短くする。
        //   同じ購入操作の ID なので、何度呼ばれても注文・決済画面は1つ（サーバーの冪等性）
        buyBtn.addEventListener('pointerdown', function () { prepare(); }, { passive: true });
        buyBtn.addEventListener('click', function () { buy(buyBtn, errBox); });
      }
    }
  }
  var ERRORS = {
    sales_closed: 'タイプ別レポートは現在お申し込みいただけません。',
    too_many_attempts: 'お申し込みが集中しています。少し時間をおいてお試しください。',
    purchase_completed: 'このお申し込みはお支払いが済んでいます。お支払いの後に表示されたリンクからお読みください。',
  };
  var attempt = null; // この画面での購入操作の ID（同じ画面での再送は同じ注文・同じ決済画面）
  var gaRef = null;
  var productId = 'eti_type_report_v1';
  function newAttempt() {
    var b = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  var inflight = null; // 準備中の決済画面の要求（指が触れた時に始め、押した時に使う）
  function typeCode() {
    var type = document.body && document.body.getAttribute('data-type-code');
    return /^(PY|HY|CR|EL|AN|GE|DE)(SW|CM|PL|CT|BW)$/.test(type || '') ? type : null;
  }
  function prepare() {
    var type = typeCode();
    if (!type) return null;
    if (inflight) return inflight;
    if (!attempt) {
      attempt = newAttempt();
      try { gaRef = window.EdAnalytics && window.EdAnalytics.checkoutRef('type_page'); } catch (e) { gaRef = null; }
    }
    var body = { type: type, attempt: attempt, source: 'type_page' };
    if (gaRef) body.ga = gaRef;
    inflight = fetch('/api/type-report?op=buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; }); });
    // 失敗した時は、次に押した時に改めて要求する
    inflight.then(function (r) { if (!(r.status === 200 && r.body && typeof r.body.checkoutUrl === 'string')) inflight = null; }, function () { inflight = null; });
    return inflight;
  }
  function buy(btn, errBox) {
    var req = prepare();
    if (!req) return;
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '決済画面へ移動しています…';
    if (errBox) errBox.hidden = true;
    req.then(function (r) {
        var b = r.body || {};
        if (r.status === 200 && typeof b.checkoutUrl === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(b.checkoutUrl)) {
          if (Number.isInteger(b.amount) && b.amount > 0 && typeof window.gtag === 'function') {
            try {
              window.gtag('event', 'begin_checkout', {
                product_id: productId, type_code: typeCode(), source: 'type_page', currency: 'JPY', value: b.amount,
                items: [{ item_id: productId, item_name: 'タイプ別レポート', price: b.amount, quantity: 1 }],
              });
            } catch (e) { /* 計測できなくても決済に進む */ }
          }
          location.assign(b.checkoutUrl);
          return;
        }
        inflight = null;
        // 期限切れ・別の注文と衝突：新しい購入操作でやり直せるようにする
        if (b.error === 'attempt_expired' || b.error === 'attempt_conflict') attempt = null;
        throw new Error(b.error || 'request_failed');
      })
      .catch(function (e) {
        inflight = null;
        btn.disabled = false;
        btn.textContent = label;
        if (errBox) { errBox.textContent = ERRORS[e && e.message] || 'いまは決済画面を開けませんでした。少し時間をおいてお試しください。'; errBox.hidden = false; }
      });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
