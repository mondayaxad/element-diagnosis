// js/nav-busy.js
// 別の画面（Stripe の決済画面・レポート・ログインの連携先）へ移動する間だけ、押したボタンを「移動しています…」にする。
// 戻る操作（bfcache から復元）・タブへの復帰・移動できなかった時は、元の表示・押せる状態へ戻す
// （iOS Safari などで「決済画面へ移動しています…」のまま押せなくなるのを防ぐ）。
//   hold(btn, label)：押した直後（通信中）。handoff(btn)：移動を始めた。release(btn)：元へ戻す（失敗した時）
(function (global) {
  'use strict';
  var STUCK_MS = 20000; // 移動を始めてもこの時間ページに残っていれば、移動できなかったものとして戻す

  function hold(btn, label) {
    if (!btn) return;
    if (!btn.hasAttribute('data-nav-busy')) btn.setAttribute('data-nav-label', btn.innerHTML); // 2段の文言（span）も保つ
    btn.setAttribute('data-nav-busy', 'pending');
    btn.disabled = true;
    if (label) btn.textContent = label;
  }
  function release(btn) {
    if (!btn || !btn.hasAttribute('data-nav-busy')) return;
    if (btn.hasAttribute('data-nav-label')) btn.innerHTML = btn.getAttribute('data-nav-label');
    btn.removeAttribute('data-nav-busy');
    btn.removeAttribute('data-nav-label');
    btn.disabled = false;
  }
  function handoff(btn) {
    if (!btn || !btn.hasAttribute('data-nav-busy')) return;
    btn.setAttribute('data-nav-busy', 'away');
    global.setTimeout(function () {
      if (btn.getAttribute('data-nav-busy') === 'away' && document.visibilityState === 'visible') release(btn);
    }, STUCK_MS);
  }
  // onlyAway：移動を始めたボタンだけ（通信中のボタンはそのまま）
  function releaseAll(onlyAway) {
    var list = document.querySelectorAll('[data-nav-busy]');
    for (var i = 0; i < list.length; i++) {
      if (!onlyAway || list[i].getAttribute('data-nav-busy') === 'away') release(list[i]);
    }
  }

  global.addEventListener('pageshow', function (e) { if (e.persisted) releaseAll(false); });
  global.addEventListener('popstate', function () { releaseAll(false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') releaseAll(true); });

  global.EdNavBusy = { hold: hold, handoff: handoff, release: release, releaseAll: releaseAll };
})(window);
