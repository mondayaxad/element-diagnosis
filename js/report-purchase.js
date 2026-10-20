// js/report-purchase.js（EdBuy）
// 解析レポート ¥1,000・完全解析 ¥3,000 の申込と、レポート固有リンク・マイページへの登録を、全ての入口で共通に扱う（complete_13）。
//   ・入口（診断結果・サンプル・マイページの「レポート」・最新の結果・過去の記録・解析レポートの最下部）は、
//     購入対象トークン（どの記録の商品か）と商品だけを渡す。価格・権利・目標の固定はサーバーが決める。
//   ・source は GA4 の計測だけに使う（申込の処理には使わない）。
//   ・購入対象トークン・固有リンクの秘密値・記録 ID・診断コード・回答は、URL のクエリ・GA4・console に出さない。
//     サンプルへは URL のフラグメント（#c=）で渡し、固有リンクは #t= に置く（Referrer に載らない）。
//   ・完全解析は、MENTOR の目標を選んでから決済へ進む（全ての入口で同じ選択の画面）。
(function (global) {
  'use strict';

  var API = '/api/complete-checkout?op=';
  var PRODUCTS = {
    analysis: { label: '解析レポート', price: 1000 },
    complete: { label: '完全解析', price: 3000 },
  };
  var COMPLETE_NOTICE = '完全解析は、解析レポートとは異なる内容を扱う別商品です。解析レポートの本文は含まれません。';
  var SHARE_NOTICE = 'このレポートのリンクから、診断結果と購入内容をマイページに登録できます。リンクは登録後も有効で、別のアカウントにも何度でも登録できます。共有する場合はご注意ください。';
  var PDF_NOTICE = 'このレポートは、PDFとして端末に保存できます。端末変更やサービス終了に備え、購入後にPDFを保存してください。';
  var RETURN_KEY = 'ed_buy_return_v1';
  var REGISTER_KEY = 'ed_register_v1';
  var LINK_KEY = 'ed_report_link_v1';
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var CONTEXT_RE = /^[A-Za-z0-9_-]{60,200}$/;

  function yen(n) { return '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cfg() { return global.__ED_PUBLIC_CONFIG__ || null; }
  function salesOpen() { var c = cfg(); return !!(c && c.completeSalesOpen === true); }
  function session(fn) { try { return fn(global.sessionStorage); } catch (e) { return null; } }

  // GA4（送ってよい項目だけ。秘密値・記録 ID・コードは送らない）
  var SAFE_PARAMS = ['product', 'value', 'currency', 'source', 'state', 'result', 'reason'];
  function track(name, params) {
    if (typeof global.gtag !== 'function') return;
    var out = {};
    var p = params || {};
    SAFE_PARAMS.forEach(function (k) { if (p[k] !== undefined && p[k] !== null) out[k] = p[k]; });
    try { global.gtag('event', name, out); } catch (e) { /* 計測の失敗は画面に影響させない */ }
  }

  async function call(op, body, opts) {
    var o = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    var res;
    // 応答が無いまま待ち続けない（15秒で通信の失敗として扱い、各画面の「もう一度」へ）
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    try {
      res = await fetch(API + op, { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify(body || {}), referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      return { ok: false, status: 0, body: { error: 'network' } };
    } finally {
      if (timer) clearTimeout(timer);
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, body: data || {} };
  }

  function randomToken(bytes) {
    var c = global.crypto;
    if (!c || typeof c.getRandomValues !== 'function') return null;
    var b = new Uint8Array(bytes);
    c.getRandomValues(b);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return global.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function accountToken() {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient || supabaseClient.unavailable || !supabaseClient.auth) return null;
      var s = await supabaseClient.auth.getSession();
      return (s && s.data && s.data.session && s.data.session.access_token) || null;
    } catch (e) {
      return null;
    }
  }

  // ---- 購入対象トークン
  function contextFromResume(resume) {
    if (!TOKEN_RE.test(String(resume || ''))) return Promise.resolve({ ok: false, body: { error: 'record_not_found' } });
    return call('buy-context', { resume: resume });
  }
  async function contextFromRecord(recordId) {
    return call('buy-context', { record: recordId }, { token: await accountToken() });
  }
  function summary(context) { return call('buy-summary', { context: context }); }
  function contextOk(c) { return typeof c === 'string' && CONTEXT_RE.test(c); }

  // サンプルへ（購入対象トークンはフラグメントで渡す。from は戻り先の種類）
  function sampleHref(product, context, from) {
    var page = product === 'complete' ? '/complete-sample.html' : '/report_sample.html';
    var f = /^[a-z_]{1,20}$/.test(String(from || '')) ? from : 'result';
    return contextOk(context) ? page + '#c=' + context + '&from=' + f : page + '#from=' + f;
  }
  function readFragment(name) {
    var m = new RegExp('(?:^#|&)' + name + '=([^&]*)').exec(global.location.hash || '');
    return m ? m[1] : null;
  }

  // ---- 申込の結果の説明
  var ERROR_TEXT = {
    sales_closed: 'ただいま、お申し込みの準備を整えています。',
    context_expired: 'この診断結果を確かめられませんでした。元の画面からもう一度お進みください。',
    record_not_found: 'この診断記録を確かめられませんでした。元の画面からもう一度お進みください。',
    not_eligible: 'この診断結果では、このレポートをお作りできません（最新版の100問の結果が対象です）。',
    mentor_goal_required: 'MENTOR の目標を選んでください。',
    offer_retired: 'この商品は現在お申し込みいただけません。',
    purchase_completed: 'お支払いは完了しています。レポートのリンク（または Stripe から届いた請求書のメール）からお開きください。',
    too_many_attempts: 'お申し込みの回数が多いため、少し時間をおいてからお試しください。',
    network: '通信できませんでした。電波の良い場所で、もう一度お試しください。',
  };
  function errorText(code) { return ERROR_TEXT[code] || 'お手続きを開始できませんでした。時間をおいて、もう一度お試しください。'; }

  // ---- 完全解析の目標の選択（全ての入口で同じ画面）
  var goalsCache = null;
  function loadGoals() {
    if (!goalsCache) goalsCache = call('guest-goals', {}).then(function (r) { if (!r.ok) goalsCache = null; return r; });
    return goalsCache;
  }
  function closeDialog(el) { if (el && el.parentNode) el.parentNode.removeChild(el); try { global.document.body.style.overflow = ''; } catch (e) { /* noop */ } }
  // 目標の選択は同時に1つだけ（二度押し・Enter の連打で重ねて開かない。開いている間の呼び出しは同じ結果を待つ）
  var openDialog = null;
  function goalDialog() {
    if (openDialog) return openDialog;
    var trigger = global.document.activeElement;
    openDialog = new Promise(function (resolveRaw) {
      function resolve(v) {
        openDialog = null;
        global.document.removeEventListener('keydown', onKey, true);
        try { if (trigger && trigger.focus) trigger.focus(); } catch (e) { /* noop */ }
        resolveRaw(v);
      }
      // Escape：読み込み中・読み込めなかった時も、ダイアログの外にフォーカスがある時も閉じる
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); closeDialog(wrap); resolve(null); } }
      var d = global.document;
      var wrap = d.createElement('div');
      wrap.className = 'edb-dialog';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-labelledby', 'edbGoalTitle');
      wrap.innerHTML = '<div class="edb-panel"><h2 id="edbGoalTitle" class="edb-title">完全解析 ' + yen(PRODUCTS.complete.price) + '</h2>'
        + '<div data-edb-goals><p class="edb-note">目標の一覧を読み込んでいます…</p></div>'
        + '<p class="edb-msg" role="alert"></p>'
        + '<div class="edb-actions"><button type="button" class="edb-btn" data-edb-go disabled>目標を選んで決済へ（' + yen(PRODUCTS.complete.price) + '）</button>'
        + '<button type="button" class="edb-link" data-edb-cancel>やめる</button></div></div>';
      d.body.appendChild(wrap);
      try { d.body.style.overflow = 'hidden'; } catch (e) { /* noop */ }
      var go = wrap.querySelector('[data-edb-go]');
      var msg = wrap.querySelector('.edb-msg');
      wrap.querySelector('[data-edb-cancel]').onclick = function () { closeDialog(wrap); resolve(null); };
      d.addEventListener('keydown', onKey, true);
      wrap.setAttribute('tabindex', '-1');
      try { wrap.focus(); } catch (e) { /* noop */ }
      loadGoals().then(function (r) {
        var goals = (r.ok && r.body && r.body.catalog && r.body.catalog.goals) || [];
        var box = wrap.querySelector('[data-edb-goals]');
        if (!goals.length) { box.innerHTML = '<p class="edb-note">目標の一覧を読み込めませんでした。時間をおいて、もう一度お試しください。</p>'; return; }
        box.innerHTML = '<fieldset class="edb-goals"><legend>MENTOR の目標を1つ選んでください（お支払いの後は変えられません）</legend>'
          + goals.map(function (g) {
            return '<label class="edb-goal"><input type="radio" name="edb-goal" value="' + esc(g.goalId) + '"><span><b>' + esc(g.label) + '</b><span>' + esc(g.description || '') + '</span></span></label>';
          }).join('') + '</fieldset>';
        box.querySelectorAll('input[name="edb-goal"]').forEach(function (i) { i.onchange = function () { go.disabled = false; msg.textContent = ''; }; });
        var first = box.querySelector('input'); if (first) first.focus();
      });
      go.onclick = function () {
        var picked = wrap.querySelector('input[name="edb-goal"]:checked');
        if (!picked) { msg.textContent = errorText('mentor_goal_required'); return; }
        closeDialog(wrap);
        resolve(picked.value);
      };
    });
    return openDialog;
  }

  // ---- 申込（全ての入口で共通）。成功すると同じタブで Stripe の決済画面へ移動する
  //   attempt：この購入操作の識別子（同じ操作の再試行は同じ値。サーバーは同じ注文・同じ決済画面を返す）
  // 申込は同時に1つだけ（どの入口のボタンでも、二度押しで注文を2つ作らない）
  var starting = null;
  function start(opts) {
    if (starting) return starting.then(function () { return { ok: false, error: 'in_progress', silent: true }; });
    starting = startOnce(opts).then(function (r) { starting = null; return r; }, function (e) { starting = null; throw e; });
    return starting;
  }
  async function startOnce(opts) {
    var o = opts || {};
    clearBuyFromMypage(); // 前の申込の印を残さない
    var info = PRODUCTS[o.product];
    if (!info) return { ok: false, error: 'invalid_request' };
    if (!contextOk(o.context)) return { ok: false, error: 'context_expired' };
    if (!salesOpen()) return { ok: false, error: 'sales_closed' };
    var goal = null;
    if (o.product === 'complete') {
      goal = o.goal || await goalDialog();
      if (!goal) return { ok: false, error: 'cancelled', silent: true };
    }
    track('checkout_start', { product: o.product, value: info.price, currency: 'JPY', source: o.source });
    var attempt = randomToken(18);
    if (!attempt) return { ok: false, error: 'unknown' };
    var body = { context: o.context, product: o.product, attempt: attempt };
    if (goal) body.goal = goal;
    if (/^[a-z_]{1,32}$/.test(String(o.source || ''))) body.source = o.source;
    var r = await call('buy', body);
    // 通信の失敗は同じ購入操作のまま1回だけ再送する（二重の注文にならない）
    if (!r.ok && r.status === 0) r = await call('buy', body);
    if (!r.ok && (r.body.error === 'attempt_reused' || r.body.error === 'attempt_expired')) {
      body.attempt = randomToken(18);
      r = await call('buy', body);
    }
    if (r.ok && r.body && typeof r.body.checkoutUrl === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(r.body.checkoutUrl)) {
      track('checkout_redirect', { product: o.product, value: info.price, currency: 'JPY', source: o.source });
      session(function (s) { s.setItem(RETURN_KEY, global.location.pathname + global.location.search + global.location.hash); });
      // マイページから申し込んだ時だけ、決済画面へ移る直前に印を付ける（ほかの入口・失敗した申込には残さない）
      if (o.fromMypage) markBuyFromMypage(r.body.linkRef);
      global.location.assign(r.body.checkoutUrl);
      return { ok: true };
    }
    var err = (r.body && r.body.error) || 'unknown';
    track('checkout_failed', { product: o.product, reason: err, source: o.source });
    return { ok: false, error: err };
  }
  // 決済を中止して戻った時の戻り先（この端末で申込を始めた画面）
  function returnPath() {
    var p = session(function (s) { return s.getItem(RETURN_KEY); });
    return typeof p === 'string' && /^\/[^/]/.test(p) ? p : '/';
  }

  // ---- レポート固有リンク
  function linkUrl(token) { return global.location.origin + '/report-link#t=' + token; }
  function rememberLink(token) { if (TOKEN_RE.test(String(token || ''))) session(function (s) { s.setItem(LINK_KEY, token); }); }
  function rememberedLink() { var t = session(function (s) { return s.getItem(LINK_KEY); }); return TOKEN_RE.test(String(t || '')) ? t : null; }
  function openLink(token, open) { return call('link-open', { token: token, open: !!open }); }
  // マイページへの登録：秘密値はこのタブの sessionStorage にだけ置き、マイページ（ログインの後も含む）で登録する
  function startRegister(token, source, opts) {
    if (!TOKEN_RE.test(String(token || ''))) return false;
    var saved = session(function (s) { s.setItem(REGISTER_KEY, JSON.stringify({ t: token, at: Date.now() })); return true; });
    track('report_register_start', { source: source });
    // このタブに控えを置けない設定（Safari のプライベートなど）：マイページの URL の # で渡す（マイページはすぐに消す）
    if (!(opts && opts.stay)) global.location.assign(saved ? '/mypage.html' : '/mypage.html#reg=' + token);
    return true;
  }
  function takeRegisterIntent() {
    var raw = session(function (s) { var v = s.getItem(REGISTER_KEY); s.removeItem(REGISTER_KEY); return v; });
    try {
      var v = JSON.parse(raw || 'null');
      return v && TOKEN_RE.test(String(v.t || '')) && Date.now() - Number(v.at) < 2 * 60 * 60 * 1000 ? v.t : null;
    } catch (e) { return null; }
  }
  // マイページから申し込んだ印（このタブ）：支払いの後、レポートの入口がこのマイページへの登録に進む
  var BUY_MYPAGE_KEY = 'ed_buy_from_mypage_v1';
  //   印は、この購入の固有リンクの目印（サーバーが返すハッシュの先頭）と組。戻ってきた固有リンクが同じ時だけ登録に進む
  function markBuyFromMypage(ref) {
    if (!/^[0-9a-f]{16}$/.test(String(ref || ''))) return;
    session(function (s) { s.setItem(BUY_MYPAGE_KEY, JSON.stringify({ at: Date.now(), ref: ref })); });
  }
  function clearBuyFromMypage() { session(function (s) { s.removeItem(BUY_MYPAGE_KEY); }); }
  async function takeBuyFromMypage(token) {
    var raw = session(function (s) { var x = s.getItem(BUY_MYPAGE_KEY); s.removeItem(BUY_MYPAGE_KEY); return x; });
    var v = null;
    try { v = JSON.parse(raw || 'null'); } catch (e) { v = null; }
    if (!v || !v.ref || Date.now() - Number(v.at) > 2 * 60 * 60 * 1000) return false;
    try {
      var buf = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
      var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      return hex.slice(0, 16) === v.ref;
    } catch (e) { return false; }
  }
  // 登録の予定（期限内のものだけ）。期限切れは消す
  function peekRegisterIntent() { return registerIntentAt() !== null; }
  function peekRegisterToken() {
    if (registerIntentAt() === null) return null;
    try { var v = JSON.parse(session(function (s) { return s.getItem(REGISTER_KEY); }) || 'null'); return v && TOKEN_RE.test(String(v.t || '')) ? v.t : null; } catch (e) { return null; }
  }
  function registerIntentAt() {
    var raw = session(function (s) { return s.getItem(REGISTER_KEY); });
    try {
      var v = JSON.parse(raw || 'null');
      if (v && TOKEN_RE.test(String(v.t || '')) && Date.now() - Number(v.at) < 2 * 60 * 60 * 1000) return Number(v.at);
    } catch (e) { /* 下で消す */ }
    if (raw) session(function (s) { s.removeItem(REGISTER_KEY); });
    return null;
  }
  async function register(token) { return call('link-register', { token: token }, { token: await accountToken() }); }
  async function copyText(text) {
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) { await global.navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* 下の方法へ */ }
    try {
      var d = global.document;
      var ta = d.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      d.body.appendChild(ta); ta.select();
      var ok = d.execCommand('copy');
      d.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  // ---- マイページ
  async function myReports() { return call('my-reports', {}, { token: await accountToken() }); }
  async function myOpen(delivery) { return call('my-report-open', { delivery: delivery }, { token: await accountToken() }); }
  async function myRegenerate(delivery) { return call('my-report-regenerate', { delivery: delivery }, { token: await accountToken() }); }

  // 共通の見た目（ダイアログ・ボタン）。ページの配色に合わせて控えめに
  function injectStyles() {
    var d = global.document;
    if (!d || d.getElementById('edb-style')) return;
    var s = d.createElement('style');
    s.id = 'edb-style';
    s.textContent = [
      '.edb-dialog{position:fixed;inset:0;z-index:2000;background:rgba(4,6,14,.78);display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box}',
      '@media (min-width:640px){.edb-dialog{align-items:center}}',
      '.edb-panel{width:100%;max-width:520px;max-height:calc(100vh - 32px);overflow:auto;background:#0f1424;border:1px solid rgba(150,180,240,.22);border-radius:12px;padding:18px 16px;color:#dfe8f8;box-sizing:border-box}',
      '.edb-title{margin:0 0 8px;font-size:16px;letter-spacing:.06em}',
      '.edb-note{margin:0 0 12px;font-size:12.5px;line-height:1.8;color:#b9c4dc}',
      '.edb-goals{border:0;margin:0 0 8px;padding:0}.edb-goals legend{font-size:12.5px;margin:0 0 8px;color:#dfe8f8;line-height:1.7}',
      '.edb-goal{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid rgba(150,180,240,.18);border-radius:8px;margin:0 0 8px;font-size:12.5px;line-height:1.7;cursor:pointer}',
      '.edb-goal span span{display:block;color:#9aa8c6;font-size:11.5px}',
      '.edb-msg{min-height:0;margin:0 0 8px;font-size:12px;color:#e3b0c0}.edb-msg:empty{display:none}',
      '.edb-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.edb-btn{min-height:44px;padding:0 18px;border-radius:8px;border:0;color:#fff;font:inherit;font-size:13px;letter-spacing:.04em;cursor:pointer;background:linear-gradient(120deg,#5b78c8 0%,#8a5fc0 50%,#c9a860 100%)}',
      '.edb-btn[disabled]{opacity:.55;cursor:default}',
      '.edb-link{background:none;border:0;color:#8aa3c8;font:inherit;font-size:12.5px;text-decoration:underline;cursor:pointer;padding:8px}',
    ].join('\n');
    d.head.appendChild(s);
  }
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', injectStyles);
    else injectStyles();
  }

  global.EdBuy = {
    PRODUCTS: PRODUCTS, COMPLETE_NOTICE: COMPLETE_NOTICE, SHARE_NOTICE: SHARE_NOTICE, PDF_NOTICE: PDF_NOTICE,
    yen: yen, esc: esc, salesOpen: salesOpen, track: track, call: call, errorText: errorText,
    contextFromResume: contextFromResume, contextFromRecord: contextFromRecord, summary: summary, contextOk: contextOk,
    sampleHref: sampleHref, readFragment: readFragment, start: start, returnPath: returnPath, goalDialog: goalDialog,
    linkUrl: linkUrl, rememberLink: rememberLink, rememberedLink: rememberedLink, openLink: openLink,
    startRegister: startRegister, takeRegisterIntent: takeRegisterIntent, peekRegisterIntent: peekRegisterIntent, peekRegisterToken: peekRegisterToken, registerIntentAt: registerIntentAt, markBuyFromMypage: markBuyFromMypage, clearBuyFromMypage: clearBuyFromMypage, takeBuyFromMypage: takeBuyFromMypage, register: register,
    copyText: copyText, myReports: myReports, myOpen: myOpen, myRegenerate: myRegenerate, accountToken: accountToken,
  };
})(typeof window !== 'undefined' ? window : this);
