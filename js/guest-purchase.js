// js/guest-purchase.js
// ゲスト購入（診断完了ページ）・購入完了ページ・解析レポートの「マイページに引き継ぐ」で共有する画面側の処理。
//   ・価格・権利はサーバーが決める。このファイルは offer（analysis／direct_complete／analysis_upgrade）と
//     診断コード（この端末で表示中の結果）と MENTOR 目標だけを送る。
//   ・引き継ぎ用の秘密値は HttpOnly の Cookie にだけあり、このファイルからは読めない・扱わない。
//   ・GA4 へは、イベント名と offer・金額・入口だけを送る（URL・診断コード・注文 ID・メール・Stripe の ID は送らない）。
(function (global) {
  'use strict';

  var API = '/api/complete-checkout?op=';
  var OFFERS = {
    analysis: { label: '解析レポート', price: 1000 },
    direct_complete: { label: '完全解析セット', price: 3000 },
    analysis_upgrade: { label: '完全解析（解析レポート購入者向け）', price: 2000 },
  };
  var CLAIM_INTENT_KEY = 'ed_claim_intent_v1';

  function yen(n) { return '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cfg() { return global.__ED_PUBLIC_CONFIG__ || null; }
  function salesOpen() { var c = cfg(); return !!(c && c.completeSalesOpen === true); }

  // GA4（送ってよい項目だけ）
  var SAFE_PARAMS = ['offer', 'value', 'currency', 'source', 'state', 'result', 'method', 'reason', 'goal_selected'];
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
    try {
      res = await fetch(API + op, { method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify(body || {}) });
    } catch (e) {
      return { ok: false, status: 0, body: { error: 'network' } };
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, body: data || {} };
  }

  function status(code) { return call('guest-status', code ? { code: code } : {}); }
  function goals() { return call('guest-goals', {}); }

  // Checkout を作り、同じタブで Stripe の決済画面へ移動する
  async function checkout(offer, code, goalId, source) {
    var info = OFFERS[offer];
    track('checkout_start', { offer: offer, value: info && info.price, currency: 'JPY', source: source });
    var body = { offer: offer, code: code };
    if (goalId) body.goal = goalId;
    var r = await call('guest-checkout', body);
    if (r.ok && r.body && typeof r.body.checkoutUrl === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(r.body.checkoutUrl)) {
      track('checkout_redirect', { offer: offer, value: info && info.price, currency: 'JPY', source: source });
      global.location.assign(r.body.checkoutUrl);
      return { ok: true };
    }
    track('checkout_failed', { offer: offer, reason: (r.body && r.body.error) || 'unknown', source: source });
    return { ok: false, error: (r.body && r.body.error) || 'unknown' };
  }

  var ERROR_TEXT = {
    sales_closed: '現在、お申し込みを受け付けていません（準備中）。',
    analysis_already_purchased: 'この結果の解析レポートは購入済みです。購入した端末、またはマイページからご覧いただけます。',
    upgrade_requires_analysis: 'この端末では、この結果の解析レポートの購入を確認できませんでした。',
    repurchase_not_allowed: 'この結果の完全解析は購入済みです。',
    checkout_in_progress: '決済の手続き中です。しばらくしてから、もう一度お試しください。',
    legacy_purchase_verification_required: '以前のご購入を確認しています。マイページからお試しください。',
    not_eligible: 'この結果は対象外です。',
    network: '通信できませんでした。電波の良い場所で、もう一度お試しください。',
  };
  function errorText(code) { return ERROR_TEXT[code] || 'お手続きを開始できませんでした。時間をおいて、もう一度お試しください。'; }

  // 引き継ぎ：ログイン方法の選択はマイページで行う（Google・X・メールのどれでも同じページへ戻る）。
  // 「引き継ぐ」を押した印だけを sessionStorage に残す（秘密値ではない。Cookie の秘密値はサーバーだけが読む）。
  function startClaim(source) {
    try { global.sessionStorage.setItem(CLAIM_INTENT_KEY, String(Date.now())); } catch (e) { /* 印が無くてもマイページで選べる */ }
    track('claim_start', { source: source });
    global.location.assign('/mypage.html');
  }
  function takeClaimIntent() {
    var v = null;
    try { v = global.sessionStorage.getItem(CLAIM_INTENT_KEY); global.sessionStorage.removeItem(CLAIM_INTENT_KEY); } catch (e) { v = null; }
    return !!(v && Date.now() - Number(v) < 60 * 60 * 1000);
  }
  async function claimAll(token, purchases) {
    var results = [];
    for (var i = 0; i < purchases.length; i++) {
      var p = purchases[i];
      if (!p.canClaim) continue;
      var r = await call('guest-claim', { ref: p.ref }, { token: token });
      results.push({ ok: r.ok, status: r.status, error: r.body && r.body.error, result: r.body && r.body.result });
      track(r.ok ? 'claim_success' : 'claim_failed', { method: 'cookie', reason: r.ok ? null : (r.body && r.body.error) });
    }
    return results;
  }
  async function recover(token) {
    var r = await call('guest-recover', {}, { token: token });
    track(r.ok ? 'claim_success' : 'claim_failed', { method: 'email_otp', reason: r.ok ? null : (r.body && r.body.error) });
    return r;
  }

  // 解析レポートの閲覧リンク・完全解析の閲覧リンク（押した時だけ発行し、同じタブで開く）
  async function openAnalysis(ref, source) {
    var r = await call('guest-report', { ref: ref });
    if (r.ok && r.body && typeof r.body.url === 'string' && r.body.url.indexOf('/report.html?token=') === 0) {
      track('analysis_report_open', { source: source });
      global.location.assign(r.body.url);
      return true;
    }
    return false;
  }
  async function openComplete(ref, source) {
    var r = await call('guest-view', { ref: ref });
    if (r.ok && r.body && typeof r.body.viewUrl === 'string' && r.body.viewUrl.indexOf('/api/complete-status?view=') === 0) {
      track('complete_view', { source: source });
      global.location.assign(r.body.viewUrl);
      return { ok: true };
    }
    return { ok: false, error: r.body && r.body.error };
  }

  // 完全解析の状態の表示名
  function completeLabel(p) {
    if (!p || !p.complete) return null;
    if (p.complete === 'suspended') return '一時停止中';
    if (p.complete === 'revoked') return '失効';
    switch (p.report) {
      case 'ready': return '閲覧できます';
      case 'failed': return '作成をやり直しています';
      case 'revoked': return '失効';
      case 'generating': return '作成中';
      default: return '作成を待っています';
    }
  }

  global.EdGuestPurchase = {
    OFFERS: OFFERS, yen: yen, esc: esc, salesOpen: salesOpen, track: track,
    status: status, goals: goals, checkout: checkout, errorText: errorText,
    startClaim: startClaim, takeClaimIntent: takeClaimIntent, claimAll: claimAll, recover: recover,
    openAnalysis: openAnalysis, openComplete: openComplete, completeLabel: completeLabel,
  };
})(typeof window !== 'undefined' ? window : this);
