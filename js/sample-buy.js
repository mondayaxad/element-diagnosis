// js/sample-buy.js
// サンプルページ（解析レポート・完全解析）の申込欄（complete_13）。
//   ・診断結果ページ・マイページから開いた時：URL のフラグメント（#c=<購入対象トークン>&from=result|mypage）の記録で申し込む。
//   ・完全解析のサンプル：完全解析の申込だけ。
//   ・解析レポートのサンプル：末尾の申込欄は解析レポートだけ。完全解析は、レポート本文の「この先にあるもの」の欄で、
//     三つの人物像の図・説明と一緒に案内する（[data-sample-lens-map]・[data-sample-complete-slot]）。
//   ・直接開いた時（購入の対象が無い）：申し込まない。まず元素診断を受ける案内だけ。
//   ・サンプルは記録を作らない・複製しない（購入の対象は元の記録だけ）。トークン・記録 ID・回答は URL のクエリ・GA4 に出さない。
(function () {
  'use strict';
  var B = window.EdBuy;
  var box = document.querySelector('[data-sample-buy]');
  if (!B || !box) return;
  // 購入対象トークンは、このタブの sessionStorage にも置く（URL からは消すため。決済画面から「戻る」・再読み込みでも同じ記録で申し込める）
  var KEY = 'ed_sample_ctx';
  var CTX_TTL_MS = 23 * 3600 * 1000; // トークンの有効期限（24時間）より短く
  var context = B.readFragment('c');
  var fromRaw = B.readFragment('from');
  if (B.contextOk(context)) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ c: context, from: fromRaw, at: Date.now() })); } catch (e) { /* 保存できなくても続ける */ }
  } else if (!context) {
    try {
      var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (saved && B.contextOk(saved.c) && Date.now() - saved.at < CTX_TTL_MS) { context = saved.c; fromRaw = saved.from; }
    } catch (e) { /* 読めない時は購入の対象なし */ }
  }
  var from = fromRaw === 'mypage' ? 'mypage' : 'result';
  var subject = from === 'mypage' ? 'この記録' : 'この診断結果';
  var source = from === 'mypage' ? 'mypage_sample' : 'result_sample';
  var page = box.getAttribute('data-sample-buy') === 'complete' ? 'complete' : 'analysis';
  var slot = document.querySelector('[data-sample-complete-slot]');
  var hasContext = B.contextOk(context);

  function backHref() { return from === 'mypage' ? '/mypage.html' : '/'; }
  // 申込のボタン（夜空に元素の光がさす色。2段の文言）
  function skyBtn(product, main, sub, enabled) {
    return '<a class="sample-return ed-sky-btn" href="#" data-buy="' + product + '"' + (enabled ? '' : ' aria-disabled="true"') + '>'
      + '<span class="ed-sky-main">' + B.esc(main) + '</span><span class="ed-sky-sub">' + B.esc(sub) + '</span></a>';
  }
  function completeSampleLink() {
    var href = B.sampleHref('complete', hasContext ? context : null, from);
    return '<a class="beyond-sample" href="' + B.esc(href) + '" data-sample-complete-link>'
      + '<span class="beyond-sample-icon" aria-hidden="true"></span><span class="beyond-sample-text"><b>完全解析のサンプルを読む</b>'
      + '<small>実際の46ページから、8ページをそのまま抜き出しています</small></span><span aria-hidden="true">→</span></a>';
  }
  // 解析レポートのサンプル：本文の「この先にあるもの」に、三つの人物像の図と完全解析の案内を入れる
  if (page === 'analysis') {
    var map = document.querySelector('[data-sample-lens-map]');
    if (map && window.EdLens) {
      var sec = map.closest('.sec');
      var color = sec ? getComputedStyle(sec).getPropertyValue('--el').trim() : '';
      map.innerHTML = window.EdLens.mapHtml({ color: color });
    }
    if (slot) {
      slot.innerHTML = '<p class="beyond-notice" data-sample-complete-note>' + B.esc(B.COMPLETE_NOTICE) + '</p>'
        + completeSampleLink()
        + (hasContext ? '<div data-complete-offer></div>'
          : '<p class="beyond-notice">お申し込みには、あなた自身の診断結果が必要です。元素診断を受けると、結果のページから、その診断結果で完全解析をお申し込みいただけます。</p>');
    }
  }

  // 元の画面へ：同じタブで開いたので履歴で戻る（履歴が無い時はマイページ・トップへ）
  box.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-sample-back]') : null;
    if (!a) return;
    e.preventDefault();
    if (history.length > 1) history.back(); else location.assign(backHref());
  });
  if (!hasContext) {
    box.innerHTML = '<h2>あなた自身の診断結果で読む</h2>'
      + '<p>お申し込みには、あなたの診断結果が必要です。まず元素診断を受けてください。診断が終わると、結果のページからこのサンプルへ進み、その診断結果でお申し込みいただけます。</p>'
      + '<a class="sample-return" href="/">まず元素診断を受ける</a>'
      + '<p class="sample-mypage">マイページに保存した記録から申し込む方：<a href="/mypage.html">マイページで記録を選ぶ</a></p>';
    return;
  }
  // 戻る：この画面の URL からトークンを外す（共有・ブックマークで他の人に渡らないように。このタブの中では保持する）
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* そのまま */ }

  box.innerHTML = '<p>' + subject + 'を確かめています…</p>';
  B.summary(context).then(function (r) {
    if (!r.ok) {
      box.innerHTML = '<h2>' + subject + 'で読む</h2><p>' + B.esc(B.errorText(r.body && r.body.error)) + '</p>'
        + '<a class="sample-return" href="' + B.esc(backHref()) + '" data-sample-back>元の画面に戻る</a>';
      return;
    }
    var s = r.body.summary || {};
    var el = r.body.eligible || {};
    var facts = [
      s.diagnosedOn ? '診断日 ' + s.diagnosedOn : null,
      s.element ? '元素 ' + s.element : null, s.weapon ? '武器 ' + s.weapon : null,
      s.nation ? '国家 ' + s.nation : null, s.mirror ? 'MIRROR ' + s.mirror : null,
    ].filter(Boolean).map(B.esc).join('　');
    var open = B.salesOpen();
    var pend = open ? '' : '（準備中）';
    var aBtn = skyBtn('analysis', subject + 'で、解析レポートを読む', '解析レポート　¥1,000' + pend, open && el.analysis);
    var bBtn = skyBtn('complete', 'まだ見えていない輪郭を読む', subject + 'の完全解析　全46ページ　¥3,000' + pend, open && el.complete);
    box.innerHTML = '<h2>' + subject + 'で読む</h2>'
      + (facts ? '<p data-sample-facts>' + facts + '</p>' : '')
      + (page === 'complete'
        ? '<div class="ed-sky-wrap">' + bBtn + '</div><p data-sample-complete-note>' + B.esc(B.COMPLETE_NOTICE) + '</p>'
        : '<div class="ed-sky-wrap">' + aBtn + '</div>'
          + (slot ? '<p class="sample-mypage">完全解析（別商品）は、レポートの「この先にあるもの」でご案内しています。</p>' : ''))
      + '<p class="ca-guest-msg" data-buy-msg role="status"></p>'
      + '<p class="sample-mypage"><a href="' + B.esc(backHref()) + '" data-sample-back>元の画面に戻る</a></p>';
    // 解析レポートのサンプル：完全解析の申込は本文の欄に置く
    var offer = slot && page === 'analysis' ? slot.querySelector('[data-complete-offer]') : null;
    if (offer) offer.innerHTML = '<div class="ed-sky-wrap">' + bBtn + '</div><p class="ca-guest-msg" data-buy-msg role="status"></p>';
    [box, offer].forEach(function (root) {
      if (!root) return;
      var msg = root.querySelector('[data-buy-msg]');
      root.querySelectorAll('[data-buy]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (a.getAttribute('aria-disabled') === 'true' || a.getAttribute('data-busy')) return;
          a.setAttribute('data-busy', '1');
          msg.textContent = '';
          B.start({ context: context, product: a.getAttribute('data-buy'), source: source }).then(function (res) {
            if (res.ok) { a.setAttribute('data-busy', 'away'); return; }
            a.removeAttribute('data-busy');
            if (!res.silent) msg.textContent = B.errorText(res.error);
          });
        });
      });
    });
  });
  // 決済画面から「戻る」（bfcache から復元）・タブへの復帰：押したボタンを、もう一度押せる状態へ戻す
  function releaseBusy(onlyAway) {
    document.querySelectorAll('[data-buy][data-busy]').forEach(function (a) {
      if (!onlyAway || a.getAttribute('data-busy') === 'away') a.removeAttribute('data-busy');
    });
  }
  window.addEventListener('pageshow', function (e) { if (e.persisted) releaseBusy(false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') releaseBusy(true); });
})();
