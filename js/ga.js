// js/ga.js
// GA4 の読み込み（index・mypage・report・購入完了・固有リンク・完全解析のサンプル・タイプ別ページで共通）。
//   ・本番ドメインでだけ読み込む。Preview・ローカルでは gtag() は何もしない（本番の計測へ混ぜない）。
//   ・page_location は origin＋path と、許可した utm_* だけ（?token=・?code=・?status= などの問い合わせ文字列・# を送らない）。
//     同じ UTM の値を、config の campaign_*（campaign_source・campaign_medium・campaign_name・campaign_content・campaign_term）にも入れる。
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
  // 商品名・金額から推測しない。既存 ID は保持し、共通 product_id を追加する。
  var PRODUCTS = {
    analysis: ['eti', 'eti_analysis_v1'], complete: ['eti', 'eti_complete_v1'],
    analysis_1000: ['eti', 'eti_analysis_v1'], direct_complete: ['eti', 'eti_complete_v1'],
    core1: ['eti', 'eti_core1_legacy'],
    jagan_report: ['jagan', 'jagan_report_v1'], jagan_complete: ['jagan', 'jagan_complete_v1'],
    jagan_report_v1: ['jagan', 'jagan_report_v1'], jagan_complete_v1: ['jagan', 'jagan_complete_v1'],
  };
  var CTA_PRODUCTS = {
    unlock_all_click: 'analysis', lock_cta_click: 'analysis', analysis_checkout_click: 'analysis',
    complete_offer_click: 'complete', jagan_report_cta: 'jagan_report', jagan_complete_cta: 'jagan_complete',
  };
  var COMMERCE_EVENT = /^(purchase|refund|begin_checkout|checkout_start|checkout_session_created|checkout_redirect|checkout_failed|checkout_return|purchase_confirmed|purchase_cta_view)$/;
  function commerceParams(name, params) {
    var p = clean(params);
    if (!COMMERCE_EVENT.test(name) && !CTA_PRODUCTS[name]) return p;
    var id = p.product_id || p.product || p.offer || (p.items && p.items.length === 1 && p.items[0].item_id) || CTA_PRODUCTS[name];
    var info = PRODUCTS[id];
    if (!info && /^eti_(analysis|complete)_v1$|^eti_core1_legacy$/.test(id || '')) info = ['eti', id];
    if (info) {
      p.diagnosis_type = info[0];
      p.product_id = info[1];
      if (p.items) p.items.forEach(function (item) {
        if (!item.item_category) item.item_category = info[0] === 'eti' ? '元素診断' : '邪眼診断';
      });
    }
    return p;
  }
  // 流入元の UTM だけを GA4 へ渡す。2通りで渡す：
  //   ①page_location に、許可した utm_* だけを残す（GA4 は UTM を page_location の URL から読む）
  //   ②config の campaign_source・campaign_medium・campaign_name・campaign_content・campaign_term に、同じ値を入れる
  //      （GA4 の設定として文書化された項目。page_location の扱いに頼らず、流入元を確実に渡す）
  //   許可する名前は utm_source・utm_medium・utm_campaign・utm_content・utm_term だけ。値は英数字と . _ ~ - の64文字まで
  //   （メール・UUID・Stripe の ID・URL・診断コードに見える値は、イベントの値と同じ規則で落とす）。
  //   URL に無い・不正な値は、①②のどちらにも入れない。?code=・?token=・?view= などほかの問い合わせ文字列と # は、これまでどおり送らない。
  var UTM_TO_CAMPAIGN = {
    utm_source: 'campaign_source', utm_medium: 'campaign_medium', utm_campaign: 'campaign_name',
    utm_content: 'campaign_content', utm_term: 'campaign_term',
  };
  var UTM_KEYS = Object.keys(UTM_TO_CAMPAIGN);
  function utmValues(search) {
    var out = {};
    try {
      var q = new URLSearchParams(search || '');
      UTM_KEYS.forEach(function (k) {
        var v = q.get(k);
        if (v === null) return;
        v = String(v).trim();
        if (!/^[A-Za-z0-9._~-]{1,64}$/.test(v)) return;
        if (BAD_VALUE.some(function (re) { return re.test(v); })) return;
        out[k] = v;
      });
    } catch (e) { return {}; }
    return out;
  }
  function campaignQuery(utm) {
    var parts = UTM_KEYS.filter(function (k) { return utm[k] !== undefined; })
      .map(function (k) { return k + '=' + encodeURIComponent(utm[k]); });
    return parts.length ? '?' + parts.join('&') : '';
  }
  function campaignParams(utm) {
    var out = {};
    UTM_KEYS.forEach(function (k) { if (utm[k] !== undefined) out[UTM_TO_CAMPAIGN[k]] = utm[k]; });
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
    if (kind === 'event') return push('event', name, commerceParams(name, params));
    return push.apply(null, arguments);
  };
  var m = /^(https?:\/\/[^/?#]+)/.exec(document.referrer || '');
  push('js', new Date());
  var utm = utmValues(location.search);
  var config = { page_location: location.origin + location.pathname + campaignQuery(utm), page_referrer: m ? m[1] + '/' : '' };
  var campaign = campaignParams(utm);
  Object.keys(campaign).forEach(function (k) { config[k] = campaign[k]; });
  push('config', MEASUREMENT_ID, config);
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);
})();
