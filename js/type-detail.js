// js/type-detail.js
// タイプ解説ページ（type-v2 テンプレート）の画面上の動き。計測（GA4）は送らない（type_diagnosis_cta_click は js/type-page.js）。
//   ・一覧へ戻る：読んでいた元素を sessionStorage に残す（トップの一覧が、戻った時にその元素を開く。リンクの #types-<元素> と同じ）
//   ・標準プロフィール・タイプ別レポートの欄（data-preview-only）は、デザイン確認用。本番ドメインでは表示しない
//   ・タイプ別レポートの購入確認はデモ：決済・外部への通信はしない
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
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
