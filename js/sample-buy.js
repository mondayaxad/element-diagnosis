// js/sample-buy.js
// サンプルページ（解析レポート・完全解析）の申込欄（complete_13）。
//   ・診断結果ページ・マイページから開いた時：URL のフラグメント（#c=<購入対象トークン>&from=result|mypage）の記録で申し込む。
//     URL からは消し、このタブの sessionStorage に残す（再読み込み・決済画面からの「戻る」でも同じ記録で申し込める）。
//   ・端末に残った別の診断結果（localStorage）は使わない（共有の端末で、別の人の記録を買わせない）。
//   ・完全解析のサンプル：完全解析の申込だけ。
//   ・解析レポートのサンプル：解析レポートの申込（主）を、レポート本文の「この先にあるもの」（完全解析の案内）の直前に置く。
//     完全解析は、その下で三つの人物像の図・説明と一緒に、控えめなボタンで案内する（[data-sample-lens-map]・[data-sample-complete-slot]）。
//   ・どれも無い時（購入の対象が無い）：申し込まない。まず元素診断を受ける案内だけ。
//   ・サンプルは記録を作らない・複製しない（購入の対象は元の記録だけ）。トークン・記録 ID・回答は URL のクエリ・GA4 に出さない。
(function () {
  'use strict';
  var B = window.EdBuy;
  var box = document.querySelector('[data-sample-buy]');
  if (!B || !box) return;
  var KEY = 'ed_sample_ctx';
  var CTX_TTL_MS = 12 * 3600 * 1000; // トークンの有効期限（24時間）より十分短く（受け取った時刻から数える）
  var context = B.readFragment('c');
  var fromRaw = B.readFragment('from');
  var savedAt = Date.now();
  if (!B.contextOk(context)) {
    context = null;
    // このタブの控えは、URL に何も無い時（再読み込み・決済画面から戻った時）だけ使う。
    //   新しく開いた（#from= はあるが #c= が無い＝購入の準備ができなかった）時は、前に見た別の記録を出さない
    if (location.hash && location.hash !== '#') { try { sessionStorage.removeItem(KEY); } catch (e) { /* noop */ } }
    else try {
      var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (saved && B.contextOk(saved.c) && Date.now() - saved.at < CTX_TTL_MS) { context = saved.c; fromRaw = saved.from; savedAt = saved.at; }
    } catch (e) { /* 読めない時は購入の対象なし */ }
  }
  var from = fromRaw === 'mypage' ? 'mypage' : fromRaw === 'report' ? 'report' : 'result';
  var subject = from === 'mypage' ? 'この記録' : 'この診断結果';
  var source = from === 'mypage' ? 'mypage_sample' : from === 'report' ? 'report_sample' : 'result_sample';
  var page = box.getAttribute('data-sample-buy') === 'complete' ? 'complete' : 'analysis';
  var slot = document.querySelector('[data-sample-complete-slot]');
  // 戻る：この画面の URL からトークンを外す（共有・ブックマークで他の人に渡らないように。このタブの中では保持する）
  if (B.readFragment('c')) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* そのまま */ } }

  function backHref() {
    if (from === 'mypage') return '/mypage.html';
    var link = from === 'report' ? B.rememberedLink() : null; // 解析レポートから：開いていたレポートの固有リンクへ
    return link ? '/report-link#t=' + link : '/';
  }
  // 申込のボタン（夜空の色。2段の文言）。sub：主の申込より控えめな見た目（完全解析を解析レポートのサンプルで案内する時）
  function skyBtn(product, main, sub, enabled, quiet) {
    return '<a class="sample-return ed-sky-btn' + (quiet ? ' is-quiet' : '') + '" href="#" data-buy="' + product + '"' + (enabled ? '' : ' aria-disabled="true"') + '>'
      + '<span class="ed-sky-main">' + B.esc(main) + '</span><span class="ed-sky-sub">' + B.esc(sub) + '</span></a>';
  }
  function completeSampleLink(c) {
    var href = B.sampleHref('complete', c, from);
    return '<a class="beyond-sample" href="' + B.esc(href) + '" data-sample-complete-link>'
      + '<span class="beyond-sample-icon" aria-hidden="true"></span><span class="beyond-sample-text"><b>完全解析のサンプルを読む</b>'
      + '<small>実際の46ページから、8ページをそのまま抜き出しています</small></span><span aria-hidden="true">→</span></a>';
  }

  // 解析レポートのサンプル：申込欄を「この先にあるもの」の直前へ。本文に三つの人物像の図を入れる
  var beyond = page === 'analysis' ? document.querySelector('.beyond-sec') : null;
  if (beyond && beyond.parentNode) beyond.parentNode.insertBefore(box, beyond);
  if (page === 'analysis') {
    var map = document.querySelector('[data-sample-lens-map]');
    if (map && window.EdLens) {
      var sec = map.closest('.sec');
      var color = sec ? getComputedStyle(sec).getPropertyValue('--el').trim() : '';
      map.innerHTML = window.EdLens.mapHtml({ color: color });
    }
  }
  function fillSlot(c) {
    if (page !== 'analysis' || !slot) return;
    slot.innerHTML = completeSampleLink(c)
      + (c ? '<div data-complete-offer></div>'
        : '<p class="beyond-notice">お申し込みには、あなた自身の診断結果が必要です。元素診断を受けると、結果のページから、その診断結果で完全解析をお申し込みいただけます。</p>');
  }

  // 元の画面へ：同じタブで開いたので履歴で戻る（履歴が無い時はマイページ・トップへ）
  box.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-sample-back]') : null;
    if (!a) return;
    e.preventDefault();
    var internal = false;
    internal = String(document.referrer || '').indexOf(location.origin + '/') === 0;
    if (internal && history.length > 1) history.back(); else location.assign(backHref());
  });
  function noContext() {
    fillSlot(null);
    box.innerHTML = '<h2>あなた自身の診断結果で読む</h2>'
      + '<p>お申し込みには、あなたの診断結果が必要です。まず元素診断を受けてください。診断が終わると、結果のページからこのサンプルへ進み、その診断結果でお申し込みいただけます。</p>'
      + '<a class="sample-return" href="/">まず元素診断を受ける</a>'
      + '<p class="sample-mypage">マイページに保存した記録から申し込む方：<a href="/mypage.html">マイページで記録を選ぶ</a></p>';
  }

  box.innerHTML = '<p>' + subject + 'を確かめています…</p>';
  if (!context) noContext();
  else {
    fillSlot(context);
    B.summary(context).then(function (r) {
      // 確かめられた時だけ、このタブに残す（受け取った時刻のまま）。期限切れ・見つからない時は消す（次に開いた時に残さない）
      try {
        if (r.ok) sessionStorage.setItem(KEY, JSON.stringify({ c: context, from: fromRaw, at: savedAt }));
        else sessionStorage.removeItem(KEY);
      } catch (e) { /* 保存できなくても続ける */ }
      render(r);
    });
  }

  function render(r) {
    if (!r.ok) {
      box.innerHTML = '<h2>' + subject + 'で読む</h2><p>' + B.esc(B.errorText(r.body && r.body.error)) + '</p>'
        + '<a class="sample-return" href="' + B.esc(backHref()) + '" data-sample-back>元の画面に戻る</a>';
      return;
    }
    var s = r.body.summary || {};
    var el = r.body.eligible || {};
    var open = B.salesOpen();
    var pend = open ? '' : '（準備中）';
    var offer = null;
    if (page === 'complete') {
      var facts = [
        s.diagnosedOn ? '診断日 ' + s.diagnosedOn : null,
        s.element ? '元素 ' + s.element : null, s.weapon ? '武器 ' + s.weapon : null,
        s.nation ? '国家 ' + s.nation : null, s.mirror ? 'MIRROR ' + s.mirror : null,
      ].filter(Boolean).map(B.esc).join('　');
      box.innerHTML = '<h2>' + subject + 'で読む</h2>'
        + (facts ? '<p data-sample-facts>' + facts + '</p>' : '')
        + '<div class="ed-sky-wrap">' + skyBtn('complete', 'まだ見えていない輪郭を読む', subject + 'の完全解析　全46ページ　¥3,000' + pend, open && el.complete) + '</div>'
        + '<p class="ca-guest-msg" data-buy-msg role="status"></p>'
        + '<p class="sample-mypage"><a href="' + B.esc(backHref()) + '" data-sample-back>元の画面に戻る</a></p>';
    } else {
      // 解析レポート（主）：情報は最小限（ボタンと戻る）。完全解析は、この下の「この先にあるもの」で控えめに
      box.innerHTML = '<div class="ed-sky-wrap">' + skyBtn('analysis', subject + 'で、解析レポートを読む', '¥1,000' + pend, open && el.analysis) + '</div>'
        + '<p class="ca-guest-msg" data-buy-msg role="status"></p>'
        + '<p class="sample-mypage"><a href="' + B.esc(backHref()) + '" data-sample-back>元の画面に戻る</a></p>';
      offer = slot ? slot.querySelector('[data-complete-offer]') : null;
      if (offer) {
        offer.innerHTML = '<div class="ed-sky-wrap">' + skyBtn('complete', 'まだ見えていない輪郭を読む', '完全解析　¥3,000' + pend, open && el.complete, true) + '</div>'
          + '<p class="ca-guest-msg" data-buy-msg role="status"></p>';
      }
    }
    [box, offer].forEach(function (root) {
      if (!root) return;
      var msg = root.querySelector('[data-buy-msg]');
      root.querySelectorAll('[data-buy]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (a.getAttribute('aria-disabled') === 'true' || a.getAttribute('data-busy')) return;
          a.setAttribute('data-busy', '1');
          msg.textContent = '';
          // マイページの記録から：支払いの後、マイページに登録して戻る
          B.start({ context: context, product: a.getAttribute('data-buy'), source: source, fromMypage: from === 'mypage' }).then(function (res) {
            if (res.ok) { a.setAttribute('data-busy', 'away'); return; }
            a.removeAttribute('data-busy');
            if (!res.silent) msg.textContent = B.errorText(res.error);
          });
        });
      });
    });
  }
  // 決済画面から「戻る」（bfcache から復元）・タブへの復帰：押したボタンを、もう一度押せる状態へ戻す
  function releaseBusy(onlyAway) {
    document.querySelectorAll('[data-buy][data-busy]').forEach(function (a) {
      if (!onlyAway || a.getAttribute('data-busy') === 'away') a.removeAttribute('data-busy');
    });
  }
  window.addEventListener('pageshow', function (e) { if (e.persisted) releaseBusy(false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') releaseBusy(true); });
})();
