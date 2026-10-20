// js/sample-return.js
// 完全解析サンプル（complete-sample.html）の「元の画面に戻る」。
//   ・サンプルは診断結果・解析レポート・マイページから同じタブで開く。サイト内から来た時は履歴で戻る（申込欄の「元の画面に戻る」と同じ）。
//   ・サイトの外から来た・履歴が無い時は、入口（?from=result|report|mypage）に合わせて移動する：
//     解析レポートから → 購入完了ページ（この端末の購入から解析レポートを開き直せる）／マイページの解析レポートから → マイページ
//     診断結果から・不明 → この端末で最後に開いた診断結果の固有リンク（無ければトップ）
//   ・このスクリプトは通信しない。固有リンクの秘密値は URL のフラグメントにだけ置き、ログ・GA4 には出さない。
(function () {
  'use strict';
  var RESUME_RE = /^[A-Za-z0-9_-]{43}$/;
  // 入口（?from= または #from=。サンプルの申込欄が URL を書き換える前に、読み込んだ時点で読む）
  var FROM = (function () {
    var m = /(?:^|[?&])from=(result|report|mypage)(?:&|$)/.exec(location.search) || /(?:^#|&)from=(result|report|mypage)(?:&|$)/.exec(location.hash);
    return m ? m[1] : null;
  })();
  function from() { return FROM; }
  function destination() {
    if (from() === 'mypage') return '/mypage.html';
    if (from() === 'report') return '/purchase-complete';
    var t = null;
    try { t = localStorage.getItem('ed_last_result_v1'); } catch (e) { t = null; }
    return t && RESUME_RE.test(t) ? '/result#r=' + t : '/';
  }
  function fromThisSite() {
    return String(document.referrer || '').indexOf(location.origin + '/') === 0;
  }
  function back(e) {
    e.preventDefault();
    if (fromThisSite() && history.length > 1) { history.back(); return; }
    location.assign(destination());
  }
  document.querySelectorAll('[data-sample-return]').forEach(function (a) {
    a.setAttribute('href', destination());
    a.addEventListener('click', back);
    a.setAttribute('data-ready', '1');
  });
})();
