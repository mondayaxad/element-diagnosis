// js/sample-return.js
// 完全解析サンプル（complete-sample.html）の「申し込みに戻る」。
//   ・サンプルは診断結果ページ・解析レポートの申込欄から別のタブで開く。元のタブには、その記録の権利に合った申込
//     （¥3,000 または追加 ¥2,000。価格はサーバーが決める）が残っているため、このタブを閉じて戻す。
//   ・閉じられない（直接開いた・ブラウザが許さない）時は、入口（?from=result|report）に合わせて移動する：
//     解析レポートから → 購入完了ページ（この端末の購入から解析レポートを開き直せる）
//     診断結果から・不明 → この端末で最後に開いた診断結果の固有リンク（無ければトップ）
//   ・このスクリプトは通信しない。固有リンクの秘密値は URL のフラグメントにだけ置き、ログ・GA4 には出さない。
(function () {
  'use strict';
  var RESUME_RE = /^[A-Za-z0-9_-]{43}$/;
  function from() {
    var m = /(?:^|[?&])from=(result|report)(?:&|$)/.exec(location.search);
    return m ? m[1] : null;
  }
  function destination() {
    if (from() === 'report') return '/purchase-complete';
    var t = null;
    try { t = localStorage.getItem('ed_last_result_v1'); } catch (e) { t = null; }
    return t && RESUME_RE.test(t) ? '/result#r=' + t : '/';
  }
  function back(e) {
    e.preventDefault();
    var dest = destination();
    var leaving = false;
    window.addEventListener('pagehide', function () { leaving = true; }, { once: true });
    try { window.close(); } catch (err) { /* 閉じられない時は下で移動する */ }
    // 閉じられなかった時だけ移動する（閉じている途中・非表示になった時は移動しない）
    setTimeout(function () {
      if (leaving || window.closed || document.visibilityState === 'hidden') return;
      location.assign(dest);
    }, 1000);
  }
  document.querySelectorAll('[data-sample-return]').forEach(function (a) {
    a.setAttribute('href', destination());
    a.addEventListener('click', back);
  });
})();
