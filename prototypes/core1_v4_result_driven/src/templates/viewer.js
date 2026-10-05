// 画面閲覧の補助（印刷・本文表示には不要。読み込めなくても全ページを読める）
// スマホ：ページ全体表示（画面幅にフィット）と拡大読書表示（A4原寸・横スクロール）を切り替える。
// ピンチズームは妨げない（viewportで拡大を禁止せず、touch-actionも指定しない）。
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var nav = document.querySelector('.viewer-nav');
  var openBtn = document.querySelector('.vn-open');
  var toc = document.querySelector('.toc-panel');
  var notice = document.querySelector('.mobile-notice');
  var pos = nav && nav.querySelector('.vn-pos');
  var modeBtn = nav && nav.querySelector('[data-nav="mode"]');
  var cur = 0;
  var store = { get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
                set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} } };

  function isSmall() { return Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth) < 840; }
  function fit() {
    var w = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    var scale = isSmall() ? Math.max(0.3, (w - 12) / 794) : 1;
    root.style.setProperty('--fit', scale.toFixed(4));
  }
  function setMode(m) {
    root.setAttribute('data-mode', m);
    if (modeBtn) modeBtn.textContent = m === 'fit' ? '拡大表示' : '全体表示';
    store.set('core1-mode', m);
    go(cur, true); placeFixed();
  }
  function current() {
    var mid = window.innerHeight / 3, best = 0;
    pages.forEach(function (p, i) { if (p.getBoundingClientRect().top <= mid) best = i; });
    return best;
  }
  function go(i, instant) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    var top = pages[i].getBoundingClientRect().top + window.pageYOffset - 6;
    window.scrollTo({ top: top, left: 0, behavior: instant ? 'auto' : 'smooth' });
    var wrap = document.querySelector('.pages'); if (wrap) wrap.scrollLeft = 0;
    // ページ移動で履歴を増やさない（ブラウザの「戻る」でレポートから出られるようにする）
    if (history.replaceState) history.replaceState(null, '', '#' + pages[i].id);
    cur = i; sync(true);
  }
  function sync(keep) {
    if (!keep) cur = current();
    if (pos) pos.textContent = String(cur + 1).padStart(2, '0') + ' / ' + pages.length;
  }
  function openToc(v) {
    if (!toc) return;
    toc.hidden = !v;
    if (v) { var a = toc.querySelector('a[href="#' + pages[cur].id + '"]'); if (a) a.focus(); }
  }
  function showNav(v) {
    if (nav) nav.hidden = !v;
    if (openBtn) openBtn.hidden = v;
    store.set('core1-nav', v ? '1' : '0');
  }
  // ピンチで拡大している時も、ナビを見えている範囲の下端に置く
  function placeFixed() {
    var vv = window.visualViewport;
    [nav, openBtn].forEach(function (el) {
      if (!el) return;
      if (!vv) return;
      var dx = vv.offsetLeft + vv.width / 2 - window.innerWidth / 2, dy = vv.offsetTop + vv.height - window.innerHeight;
      if (Math.abs(vv.scale - 1) < 0.01 && Math.abs(dx) < 1 && Math.abs(dy) < 1) { el.style.transform = ''; return; }
      var s = 1 / vv.scale;
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
        + ' translateX(-50%) scale(' + s + ')';
    });
  }

  fit();
  root.setAttribute('data-mode', store.get('core1-mode') || 'fit');
  if (modeBtn) modeBtn.textContent = root.getAttribute('data-mode') === 'fit' ? '拡大表示' : '全体表示';
  if (store.get('core1-nav') === '0') showNav(false);
  if (notice && isSmall() && !store.get('core1-notice')) notice.hidden = false;

  window.addEventListener('resize', function () { fit(); placeFixed(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeFixed);
    window.visualViewport.addEventListener('scroll', placeFixed);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-nav]');
    if (!a) return;
    var k = a.getAttribute('data-nav');
    if (k === 'toc-link') { openToc(false); e.preventDefault(); go(pages.findIndex(function (p) { return '#' + p.id === a.getAttribute('href'); })); return; }
    e.preventDefault();
    if (k === 'prev') go(cur - 1);
    else if (k === 'next') go(cur + 1);
    else if (k === 'toc') openToc(true);
    else if (k === 'toc-close') openToc(false);
    else if (k === 'mode') setMode(root.getAttribute('data-mode') === 'fit' ? 'read' : 'fit');
    else if (k === 'close') showNav(false);
    else if (k === 'open') showNav(true);
    else if (k === 'notice-ok') { notice.hidden = true; store.set('core1-notice', '1'); }
    else if (k === 'notice-read') { notice.hidden = true; store.set('core1-notice', '1'); setMode('read'); }
  });
  if (toc) toc.addEventListener('click', function (e) { if (e.target === toc) openToc(false); });
  window.addEventListener('scroll', function () { window.requestAnimationFrame(function () { sync(false); }); }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { openToc(false); if (notice) notice.hidden = true; return; }
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(cur + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1); }
  });
  var h = location.hash && pages.findIndex(function (p) { return '#' + p.id === location.hash; });
  if (h > 0) go(h, true); else sync(false);
})();
