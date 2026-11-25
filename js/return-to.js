// js/return-to.js — 邪眼診断から来た人を、邪眼診断へ戻す。
//   ・邪眼のページ（/jagan/…・/j/…）を開いたら、このタブに「邪眼から来た」印を残す。元素診断のトップ（/）を開いたら消す。
//   ・マイページ・規約・特商法・プライバシーなどの共通ページでは、印がある（または /mypage#jagan・邪眼のページからの移動）時だけ、
//     「← TOPへ戻る」と、元素診断のトップ（/）への案内を、邪眼診断（/jagan/）へ向ける。印は URL に出さない（このタブの sessionStorage だけ）。
(function () {
  'use strict';
  var KEY = 'ed_origin';
  var path = location.pathname;
  function setOrigin(v) { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* 保存できなくても表示は続ける */ } }
  function getOrigin() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  if (/^\/(jagan(\/|$)|j\/)/.test(path)) { setOrigin('jagan'); return; }
  if (path === '/' || path === '/index.html' || path === '/result') { setOrigin(null); return; }
  // 直前のページ（同じサイトのときだけ。パスの部分）
  var ref = String(document.referrer || '');
  ref = ref.indexOf(location.origin + '/') === 0 ? ref.slice(location.origin.length).split(/[?#]/)[0] : '';
  var fromJagan = getOrigin() === 'jagan' || location.hash === '#jagan' || /^\/(jagan(\/|$)|j\/)/.test(ref);
  if (!fromJagan) return;
  setOrigin('jagan');
  function retarget(root) {
    (root || document).querySelectorAll('a.top-link').forEach(function (a) {
      if (a.getAttribute('data-origin-set')) return;
      a.setAttribute('data-origin-set', '1');
      a.setAttribute('href', '/jagan/');
      a.textContent = '← 邪眼診断に戻る';
    });
  }
  function onReady() {
    retarget();
    // マイページの「診断を始める」など、後から描かれる元素診断のトップへの案内も、邪眼診断へ向ける
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href="/"]') : null;
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (a.closest('[data-keep-eti-link]')) return;
      e.preventDefault();
      location.assign('/jagan/');
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
})();
