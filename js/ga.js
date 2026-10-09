// js/ga.js
// GA4 の読み込み（index・mypage・report・購入完了ページで共通）。
//   ・本番ドメインでだけ読み込む。Preview・ローカルでは gtag() は何もしない（本番の計測へ混ぜない）。
//   ・page_location は origin＋path だけ（?token=・?code=・?status= などの問い合わせ文字列・# を送らない）。
//   ・page_referrer は origin だけ（Stripe の決済画面の URL＝Session ID を送らない）。
//   ・イベントの値は送る前に消毒する：記録 ID・user ID・セッション ID・メール・トークン・閲覧 URL・Storage のパス・
//     Stripe の ID・回答（診断コード）・自由記述を落とす（呼び出し側の誤りでも送らない二重の対策）。
(function () {
  'use strict';
  var MEASUREMENT_ID = 'G-FDN7NYZW9D';
  var PRODUCTION_HOST = 'element-diagnosis-five.vercel.app';
  var DROP_KEYS = /^(diagnosis_session_id|session_id|user_id|uid|email|token|view|view_url|url|link_url|storage_path|code|diagnosis_code|answers?|order_id|ref|checkout_session_id|payment_intent|claim.*|secret.*|text|message|comment)$/i;
  var BAD_VALUE = [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,   // UUID
    /[^\s@]+@[^\s@]+\.[^\s@]+/,                                        // メール
    /\b(cs|pi|ch|py|re|du|evt|cus|price|prod|sub|in)_(test|live)?_?[A-Za-z0-9]{8,}/, // Stripe の ID
    /https?:\/\//i, /[?&](token|view|code)=/i,                         // URL・閲覧リンク
    /^reports\//,                                                      // Storage のパス
    /^[0-9a-z]{40,}$/,                                                 // 診断コード（回答の符号）・長い識別子
  ];
  function clean(params) {
    var out = {};
    if (!params || typeof params !== 'object') return out;
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (DROP_KEYS.test(k)) return;
      if (typeof v === 'string') {
        if (v.length > 100 || BAD_VALUE.some(function (re) { return re.test(v); })) return;
        out[k] = v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v;
      } else if (k === 'items' && Array.isArray(v)) {
        out[k] = v.map(clean);
      }
    });
    return out;
  }
  window.__edGaClean = clean;
  window.dataLayer = window.dataLayer || [];
  if (location.hostname !== PRODUCTION_HOST) {
    if (typeof window.gtag !== 'function') window.gtag = function () {};
    return;
  }
  var push = function () { window.dataLayer.push(arguments); };
  window.gtag = function (kind, name, params) {
    if (kind === 'event') return push('event', name, clean(params));
    return push.apply(null, arguments);
  };
  var m = /^(https?:\/\/[^/?#]+)/.exec(document.referrer || '');
  push('js', new Date());
  push('config', MEASUREMENT_ID, { page_location: location.origin + location.pathname, page_referrer: m ? m[1] + '/' : '' });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);
})();
