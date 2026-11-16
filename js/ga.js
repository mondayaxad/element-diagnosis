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
  // 設問の回答（quiz_answers）：50問ずつの数字の列（各桁＝その設問の回答 1〜5、0＝未回答）。個人を特定する情報は含まない
  var ANSWER_KEY = /^ans_\d{3}_\d{3}$/;
  var ANSWER_VALUE = /^[0-5]{1,100}$/;
  function clean(params) {
    var out = {};
    if (!params || typeof params !== 'object') return out;
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (DROP_KEYS.test(k)) return;
      if (typeof v === 'string' && ANSWER_KEY.test(k)) {
        if (ANSWER_VALUE.test(v)) out[k] = v;
      } else if (typeof v === 'string') {
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
  var CATEGORY = { eti: '元素診断', jagan: '邪眼診断' };
  // 表の自身の項目だけを引く（constructor・toString など、継承された名前を商品として扱わない）
  function own(table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined; }
  function productInfo(id) {
    var info = own(PRODUCTS, id);
    if (info) return info;
    return /^(eti_(analysis|complete)_v1|eti_core1_legacy)$/.test(typeof id === 'string' ? id : '') ? ['eti', id] : undefined;
  }
  function commerceParams(name, params) {
    var p = clean(params);
    var cta = own(CTA_PRODUCTS, name);
    if (!COMMERCE_EVENT.test(name) && !cta) return p;
    // 旧版診断（legacy-v1）の購入ボタンは旧商品 core1（現行の解析レポートと分けて数える）
    if (cta && p.diagnosis_version === 'legacy-v1') cta = 'core1';
    var items = Array.isArray(p.items) ? p.items : [];
    // 各商品のカテゴリは、その商品自身の ID からだけ決める（ほかの商品・イベント全体の値で一括に付けない）
    var itemInfos = items.map(function (item) { return productInfo(item && item.item_id); });
    items.forEach(function (item, k) {
      if (item && itemInfos[k] && !item.item_category) item.item_category = CATEGORY[itemInfos[k][0]];
    });
    // イベント全体の商品：明示の値（product_id・product・offer）、無ければ1件だけの items、無ければ CTA の名前。
    //   明示の値どうし・items・diagnosis_type が食い違う時、未知の ID が混ざる時は、全体の分類を補わない（推測しない）
    var candidates = [];
    ['product_id', 'product', 'offer'].forEach(function (k) { if (p[k] !== undefined) candidates.push(productInfo(p[k])); });
    if (!candidates.length && items.length === 1) candidates.push(itemInfos[0]);
    if (!candidates.length && !items.length && cta) candidates.push(productInfo(cta));
    if (!candidates.length || candidates.some(function (c) { return !c; })) return p;
    var info = candidates[0];
    var agree = function (c) { return c && c[0] === info[0] && c[1] === info[1]; };
    if (!candidates.every(agree) || !itemInfos.every(agree)) return p;
    if (p.diagnosis_type !== undefined && p.diagnosis_type !== info[0]) return p;
    p.diagnosis_type = info[0];
    p.product_id = info[1];
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
  // コンテンツ グループ（GA4 の標準レポートで、元素診断・邪眼診断・共通ページを切り替えて見る）。
  //   jagan：邪眼のページ（/jagan・/jagan/…）と共有リンク（/j/…）／shared：マイページと規約類（両方の利用者が使う）／eti：それ以外（元素診断）
  function contentGroup(path) {
    var p = String(path || '/');
    if (/^\/jagan(\/|\.html$|$)/.test(p) || /^\/j\//.test(p)) return 'jagan';
    if (/^\/(mypage|privacy|terms|tokushoho)(\.html)?\/?$/.test(p)) return 'shared';
    return 'eti';
  }
  window.__edContentGroup = contentGroup;
  window.__edGaClean = clean;

  // ---- 分析用の共通の計測（window.EdAnalytics）。元素診断（eti）・邪眼診断（jagan）で同じ形 ----
  //   ・quiz_progress：回答が10%ごとの区切りを初めて越えた時（どこで離脱するか）
  //   ・完了時の所要時間（duration_min・duration_band）
  //   ・quiz_answers：全設問の回答（2026-11-17 0:00 JST 以降。プライバシーポリシー第8条の改定の施行日）
  //   ・purchase_cta_view：申込ボタンが画面に入った時（1ページ1回）
  //   ・report_section_view：有料レポートの各章が画面に入った時（1回）
  //   ・result_feedback：結果の納得度（1〜5）
  //   ・ユーザー単位の属性（diagnoses_done・is_member・is_purchaser）と、運営者の端末の印（traffic_type=internal）
  var ANSWERS_FROM = Date.parse('2026-11-17T00:00:00+09:00');
  function store(kind, fn) { try { return fn(window[kind]); } catch (e) { return null; } }
  function send(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) { /* 計測だけ */ } }
  var progressKey = function (d) { return 'ed_ga_quiz_' + d; };
  var EdAnalytics = {
    start: function (diagnosis) {
      store('sessionStorage', function (s) { s.setItem(progressKey(diagnosis), JSON.stringify({ at: Date.now(), step: 0 })); });
    },
    progress: function (diagnosis, answered, total) {
      if (!(total > 0)) return;
      var st = store('sessionStorage', function (s) { return JSON.parse(s.getItem(progressKey(diagnosis)) || 'null'); }) || { at: Date.now(), step: 0 };
      var step = Math.floor((answered / total) * 10);
      if (step >= 10 || step <= st.step) return;
      for (var k = st.step + 1; k <= step; k++) send('quiz_progress', { diagnosis_type: diagnosis, progress_pct: k * 10 });
      st.step = step;
      store('sessionStorage', function (s) { s.setItem(progressKey(diagnosis), JSON.stringify(st)); });
    },
    // 完了時に付ける所要時間（開始の記録が無い・長すぎる時は付けない）
    durationParams: function (diagnosis) {
      var st = store('sessionStorage', function (s) { return JSON.parse(s.getItem(progressKey(diagnosis)) || 'null'); });
      store('sessionStorage', function (s) { s.removeItem(progressKey(diagnosis)); });
      if (!st || !(st.at > 0)) return {};
      var min = Math.round((Date.now() - st.at) / 60000);
      if (!(min >= 0) || min > 240) return {};
      return { duration_min: min, duration_band: min < 5 ? 'under5' : min < 10 ? '5to10' : min < 20 ? '10to20' : 'over20' };
    },
    // 回答：order（設問 ID の並び。版ごとに固定）・answers（ID → 値）・toDigit（値 → 1〜5）
    answers: function (diagnosis, itemSet, order, answers, toDigit) {
      if (Date.now() < ANSWERS_FROM || !order || !order.length) return;
      var digits = order.map(function (id) {
        var d = answers && answers[id] !== undefined ? toDigit(answers[id]) : 0;
        return d >= 1 && d <= 5 ? String(d) : '0';
      }).join('');
      var p = { diagnosis_type: diagnosis, answer_set: String(itemSet || '').slice(0, 60), answer_count: order.length };
      for (var i = 0; i < digits.length; i += 50) {
        var a = i + 1, b = Math.min(i + 50, digits.length);
        p['ans_' + ('00' + a).slice(-3) + '_' + ('00' + b).slice(-3)] = digits.slice(i, b);
      }
      send('quiz_answers', p);
    },
    observeOnce: function (elements, name, paramsOf) {
      var els = Array.prototype.slice.call(elements || []).filter(Boolean);
      if (!els.length) return;
      var fire = function (el, i) { if (el.__edSeen) return; el.__edSeen = true; send(name, paramsOf(el, i)); };
      if (typeof IntersectionObserver !== 'function') return;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { fire(e.target, els.indexOf(e.target)); io.unobserve(e.target); } });
      }, { threshold: 0.5 });
      els.forEach(function (el) { io.observe(el); });
    },
    ctaView: function (elements, params) {
      EdAnalytics.observeOnce(elements, 'purchase_cta_view', function (el) {
        var out = {}; Object.keys(params || {}).forEach(function (k) { out[k] = params[k]; });
        var pid = el.getAttribute && el.getAttribute('data-ga-product');
        if (pid) out.product_id = pid;
        return out;
      });
    },
    sections: function (elements, params) {
      var total = Array.prototype.slice.call(elements || []).length;
      EdAnalytics.observeOnce(elements, 'report_section_view', function (el, i) {
        var out = {}; Object.keys(params || {}).forEach(function (k) { out[k] = params[k]; });
        out.section_index = i + 1; out.section_total = total;
        return out;
      });
    },
    feedback: function (diagnosis, fit) {
      if (!(fit >= 1 && fit <= 5)) return;
      send('result_feedback', { diagnosis_type: diagnosis, fit: fit });
    },
  };
  // 結果の納得度（任意・1〜5）。container の中に置く。どちらの診断も暗い背景のため、色は文字色（currentColor）の濃淡だけで描く
  EdAnalytics.mountFeedback = function (container, diagnosis) {
    if (!container || container.__edFit) return;
    container.__edFit = true;
    if (!document.getElementById('ed-fit-style')) {
      var st = document.createElement('style');
      st.id = 'ed-fit-style';
      st.textContent = '.ed-fit{border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:14px 14px 12px;margin:0 0 18px;text-align:center}'
        + '.ed-fit-q{margin:0 0 10px;font-size:13px;opacity:.9}'
        + '.ed-fit-row{display:flex;justify-content:center;gap:8px}'
        + '.ed-fit-row button{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}'
        + '.ed-fit-row button:hover,.ed-fit-row button:focus-visible{border-color:currentColor;outline:none}'
        + '.ed-fit-row button[aria-pressed="true"]{background:rgba(255,255,255,.18);border-color:currentColor}'
        + '.ed-fit-row button:disabled{cursor:default}'
        + '.ed-fit-labels{display:flex;justify-content:space-between;max-width:232px;margin:6px auto 0;font-size:10.5px;opacity:.65}'
        + '.ed-fit-thanks{margin:8px 0 0;font-size:12px;opacity:.75}';
      document.head.appendChild(st);
    }
    var box = document.createElement('div');
    box.className = 'ed-fit';
    box.innerHTML = '<p class="ed-fit-q">この結果は、どのくらいあなたに当てはまりましたか？</p>'
      + '<div class="ed-fit-row" role="group" aria-label="当てはまる度合い（1〜5）">'
      + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-fit="' + n + '" aria-pressed="false">' + n + '</button>'; }).join('')
      + '</div><div class="ed-fit-labels"><span>当てはまらない</span><span>とても当てはまる</span></div>'
      + '<p class="ed-fit-thanks" hidden>ご回答ありがとうございます。</p>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-fit]') : null;
      if (!b || b.disabled) return;
      var fit = Number(b.getAttribute('data-fit'));
      Array.prototype.forEach.call(box.querySelectorAll('button[data-fit]'), function (x) { x.disabled = true; x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      box.querySelector('.ed-fit-thanks').hidden = false;
      EdAnalytics.feedback(diagnosis, fit);
    });
    container.appendChild(box);
  };
  window.EdAnalytics = EdAnalytics;
  // ユーザー単位の属性（この端末に印を残し、毎回のページで送る）。個人を特定する情報は含まない
  function flag(k, v) { return store('localStorage', function (s) { if (v !== undefined) s.setItem(k, v); return s.getItem(k); }); }
  function userProps() {
    var eti = flag('ed_ga_done_eti') === '1', jagan = flag('ed_ga_done_jagan') === '1';
    var p = {};
    if (eti || jagan) p.diagnoses_done = eti && jagan ? 'both' : eti ? 'eti' : 'jagan';
    if (flag('ed_ga_member') === '1') p.is_member = 'yes';
    if (flag('ed_ga_purchaser') === '1') p.is_purchaser = 'yes';
    return p;
  }
  var USER_EVENTS = {
    quiz_complete: 'ed_ga_done_eti', jagan_complete: 'ed_ga_done_jagan',
    login_success: 'ed_ga_member', mypage_view: 'ed_ga_member', jagan_save_success: 'ed_ga_member',
    purchase: 'ed_ga_purchaser', purchase_client: 'ed_ga_purchaser',
  };
  // 運営者の端末の印：?ed_internal=1 で付け、?ed_internal=0 で外す（GA4 の「内部トラフィック」フィルタで除く）
  try {
    var iq = new URLSearchParams(location.search).get('ed_internal');
    if (iq === '1') flag('ed_internal', '1');
    if (iq === '0') store('localStorage', function (s) { s.removeItem('ed_internal'); });
  } catch (e) { /* そのまま */ }
  var internal = flag('ed_internal') === '1';
  window.dataLayer = window.dataLayer || [];
  if (location.hostname !== PRODUCTION_HOST) {
    if (typeof window.gtag !== 'function') window.gtag = function () {};
    return;
  }
  var push = function () { window.dataLayer.push(arguments); };
  window.gtag = function (kind, name, params) {
    if (kind === 'event' && Object.prototype.hasOwnProperty.call(USER_EVENTS, name) && flag(USER_EVENTS[name]) !== '1') {
      flag(USER_EVENTS[name], '1');
      push('set', 'user_properties', userProps());
    }
    if (kind === 'event') return push('event', name, commerceParams(name, params));
    return push.apply(null, arguments);
  };
  var m = /^(https?:\/\/[^/?#]+)/.exec(document.referrer || '');
  push('js', new Date());
  var utm = utmValues(location.search);
  var config = { page_location: location.origin + location.pathname + campaignQuery(utm), page_referrer: m ? m[1] + '/' : '', content_group: contentGroup(location.pathname) };
  if (internal) config.traffic_type = 'internal';
  var up = userProps();
  if (Object.keys(up).length) push('set', 'user_properties', up);
  var campaign = campaignParams(utm);
  Object.keys(campaign).forEach(function (k) { config[k] = campaign[k]; });
  push('config', MEASUREMENT_ID, config);
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);
})();
