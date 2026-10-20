// js/sample-buy.js
// サンプルページ（解析レポート・完全解析）の申込欄（complete_13）。
//   ・診断結果ページ・マイページから開いた時：URL のフラグメント（#c=<購入対象トークン>&from=result|mypage）の記録で申し込む。
//     記録の概要（日付・元素・武器・国家・MIRROR）を示し、「この診断結果で（この記録で）…を作成する」の2つの導線を出す。
//   ・直接開いた時（購入の対象が無い）：申し込まない。まず元素診断を受ける案内だけ。
//   ・サンプルは記録を作らない・複製しない（購入の対象は元の記録だけ）。トークン・記録 ID・回答は URL のクエリ・GA4 に出さない。
(function () {
  'use strict';
  var B = window.EdBuy;
  var box = document.querySelector('[data-sample-buy]');
  if (!B || !box) return;
  var context = B.readFragment('c');
  var from = B.readFragment('from') === 'mypage' ? 'mypage' : 'result';
  var subject = from === 'mypage' ? 'この記録' : 'この診断結果';
  var source = from === 'mypage' ? 'mypage_sample' : 'result_sample';

  function backHref() { return from === 'mypage' ? '/mypage.html' : '/'; }
  // 元の画面へ：同じタブで開いたので履歴で戻る（履歴が無い時はマイページ・トップへ）
  box.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-sample-back]') : null;
    if (!a) return;
    e.preventDefault();
    if (history.length > 1) history.back(); else location.assign(backHref());
  });
  if (!B.contextOk(context)) {
    box.innerHTML = '<h2>あなた自身の診断結果で読む</h2>'
      + '<p>お申し込みには、あなたの診断結果が必要です。まず元素診断を受けてください。診断が終わると、結果のページからこのサンプルへ進み、その診断結果でお申し込みいただけます。</p>'
      + '<a class="sample-return" href="/">まず元素診断を受ける</a>'
      + '<p class="sample-mypage">マイページに保存した記録から申し込む方：<a href="/mypage.html">マイページで記録を選ぶ</a></p>';
    return;
  }
  // 戻る：この画面の URL からトークンを外す（共有・ブックマークで他の人に渡らないように。このタブの中では保持する）
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* そのまま */ }

  box.innerHTML = '<p>' + subject + 'を確認しています…</p>';
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
    function btn(product) {
      var info = B.PRODUCTS[product];
      var ok = open && (product === 'complete' ? el.complete : el.analysis);
      var label = subject + 'で' + info.label + 'を作成する ' + B.yen(info.price);
      return '<a class="sample-return" href="#" data-buy="' + product + '"' + (ok ? '' : ' aria-disabled="true" style="opacity:.55;pointer-events:none"') + '>'
        + B.esc(label) + (open ? '' : '（準備中）') + '</a>';
    }
    box.innerHTML = '<h2>' + subject + 'で読む</h2>'
      + (facts ? '<p data-sample-facts>' + facts + '</p>' : '')
      + '<div style="display:grid;gap:10px;justify-items:center">' + btn('analysis') + btn('complete') + '</div>'
      + '<p data-sample-complete-note>' + B.esc(B.COMPLETE_NOTICE) + '</p>'
      + '<p class="ca-guest-msg" data-buy-msg role="status"></p>'
      + '<p class="sample-mypage"><a href="' + B.esc(backHref()) + '" data-sample-back>元の画面に戻る</a></p>';
    var msg = box.querySelector('[data-buy-msg]');
    box.querySelectorAll('[data-buy]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (a.getAttribute('aria-disabled') === 'true' || a.getAttribute('data-busy')) return;
        a.setAttribute('data-busy', '1');
        msg.textContent = '';
        B.start({ context: context, product: a.getAttribute('data-buy'), source: source }).then(function (res) {
          if (res.ok) return;
          a.removeAttribute('data-busy');
          if (!res.silent) msg.textContent = B.errorText(res.error);
        });
      });
    });
  });
})();
