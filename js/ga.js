// js/ga.js
// GA4 の読み込み（購入完了ページなど、新しいページ用）。
//   ・本番ドメインでだけ読み込む。Preview・ローカルでは gtag() は何もしない（本番の計測へ混ぜない）。
//   ・page_location は origin＋path だけ（?token=・?status= などの問い合わせ文字列・# を送らない）。
//   ・page_referrer は origin だけ（Stripe の決済画面の URL＝Session ID を送らない）。
(function () {
  'use strict';
  var MEASUREMENT_ID = 'G-FDN7NYZW9D';
  var PRODUCTION_HOST = 'element-diagnosis-five.vercel.app';
  window.dataLayer = window.dataLayer || [];
  if (location.hostname !== PRODUCTION_HOST) {
    window.gtag = function () {};
    return;
  }
  window.gtag = function () { window.dataLayer.push(arguments); };
  var ref = '';
  var m = /^(https?:\/\/[^/?#]+)/.exec(document.referrer || '');
  ref = m ? m[1] + '/' : '';
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, { page_location: location.origin + location.pathname, page_referrer: ref });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);
})();
