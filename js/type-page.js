// js/type-page.js
// タイプ解説ページ（/type/<code>）の、診断への導線のクリックを GA4 に送る（type_diagnosis_cta_click）。
//   ・導線は <a data-type-cta="top|bottom|related" data-destination="eti_top|jagan_top">、ページの値は <body data-type-code data-element data-weapon-type>。
//   ・送る値はすべてページ固有の公開値（35タイプの区分・導線の位置・遷移先のラベル）。個人情報・診断結果・URL は送らない。
//   ・二重発火を防ぐ：リスナーは1ページに1回だけ登録し、同じ導線の1秒以内の再クリックは送らない。
//   ・遷移で送信が途切れないよう transport_type: 'beacon'。
//   ・gtag は js/ga.js が用意する（本番ドメインだけで送信。Preview・ローカルでは何もしない）。既存イベントには触れない。
(function () {
  'use strict';
  if (window.__edTypeCta) return;
  window.__edTypeCta = true;
  var POSITION = /^(top|bottom|related)$/;
  var DESTINATION = /^(eti_top|jagan_top)$/;
  var CODE = /^[A-Z]{4}$/;
  var KEY = /^[a-z]{2,10}$/;
  var last = typeof WeakMap === 'function' ? new WeakMap() : null;

  function params(a) {
    var b = document.body || {};
    var d = b.dataset || {};
    var p = {
      type_code: d.typeCode, element: d.element, weapon_type: d.weaponType,
      cta_position: a.getAttribute('data-type-cta'), destination: a.getAttribute('data-destination'),
    };
    if (!CODE.test(p.type_code || '') || !KEY.test(p.element || '') || !KEY.test(p.weapon_type || '')) return null;
    if (!POSITION.test(p.cta_position || '') || !DESTINATION.test(p.destination || '')) return null;
    p.transport_type = 'beacon';
    return p;
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[data-type-cta]') : null;
    if (!a) return;
    var now = Date.now();
    if (last) {
      var prev = last.get(a);
      if (prev && now - prev < 1000) return;
      last.set(a, now);
    }
    var p = params(a);
    if (!p || typeof window.gtag !== 'function') return;
    try { window.gtag('event', 'type_diagnosis_cta_click', p); } catch (err) { /* 計測だけ */ }
  });
})();
