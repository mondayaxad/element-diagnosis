// js/lens-constellation.js（EdLens）
// 完全解析の三つの人物像（MIRROR・HIDDEN SHAPE・MENTOR）を示す図（元素診断の世界観の画像：宝石と星の軌跡）と、各視点の説明。
//   診断結果のページ・解析レポート（本物・サンプル）で共通に使う。外部への通信・計測はしない。
//   画像は同じサイトの assets/complete/（幅 840・1672 の2つ。画面の幅で選ぶ）。
(function (global) {
  'use strict';

  var LENSES = [
    { key: 'mirror', en: 'MIRROR', color: '#83b9da',
      head: 'いまのあなたに最も近い10名', body: '20軸の配置が、いまのあなたに最も近い人物たち。どこが重なり、どこが違うのかを一人ずつ読み解きます。' },
    { key: 'hidden', en: 'HIDDEN SHAPE', color: '#ac82d4',
      head: '表に出にくい一面に近い10名', body: '強さの順位ではなく、山と谷の「形」が近い人物たち。数値の高さだけでは見えなかった資質が、ここで輪郭を持ちます。' },
    { key: 'mentor', en: 'MENTOR', color: '#d3ad68',
      head: 'これから伸ばす方向に近い10名', body: '選んだ目標に向けて、核を失わずに広げるための振る舞いを借りられる人物たち。目標によって、顔ぶれが変わります。' },
  ];
  var IMG_ALT = 'あなたの元素の宝石から、MIRROR（水面に映るもう一つの宝石）・HIDDEN SHAPE（奥に潜む形）・MENTOR（先へ続く星の道）の三つの視点が伸びる図';

  function imageHtml() {
    return '<img class="edl-img" src="/assets/complete/lens-map-840.webp"'
      + ' srcset="/assets/complete/lens-map-840.webp 840w, /assets/complete/lens-map-1672.webp 1672w"'
      + ' sizes="(max-width: 600px) 100vw, 560px" width="1672" height="941" loading="lazy" decoding="async"'
      + ' alt="' + IMG_ALT + '">';
  }

  // 図と、三つの視点の説明（サイトの文体）
  function mapHtml() {
    injectStyles();
    return '<figure class="edl-map">'
      + imageHtml()
      + '<ol class="edl-legend">' + LENSES.map(function (l) {
        return '<li class="edl-item" style="--lc:' + l.color + '"><span class="edl-en">' + l.en + '</span>'
          + '<span class="edl-head">' + l.head + '</span><span class="edl-body">' + l.body + '</span></li>';
      }).join('') + '</ol>'
      + '<figcaption class="edl-cap">三つの視点、三十の人物像。<br>重なりと違いを一つずつ確かめ、<br>あなたの輪郭を、ひとつの記録へ結びます。</figcaption>'
      + '</figure>';
  }

  function injectStyles() {
    var d = global.document;
    if (!d || d.getElementById('edl-style')) return;
    var s = d.createElement('style');
    s.id = 'edl-style';
    s.textContent = [
      '.edl-map{margin:18px 0 0;padding:0}',
      '.edl-img{display:block;width:100%;max-width:560px;height:auto;aspect-ratio:1672/941;margin:0 auto;border-radius:10px;background:#070a16;',
      '  -webkit-mask-image:radial-gradient(130% 120% at 50% 50%,#000 72%,transparent 100%);mask-image:radial-gradient(130% 120% at 50% 50%,#000 72%,transparent 100%)}',
      '.edl-legend{list-style:none;margin:10px 0 0;padding:0}',
      '.edl-item{position:relative;padding:10px 0 10px 16px;border-top:1px solid rgba(160,150,200,.14);text-align:left}',
      '.edl-item::before{content:"";position:absolute;left:2px;top:15px;width:7px;height:7px;transform:rotate(45deg);background:var(--lc);box-shadow:0 0 8px var(--lc)}',
      '.edl-en{display:block;font-size:11px;letter-spacing:.2em;color:var(--lc)}',
      '.edl-head{display:block;margin-top:2px;font-size:13.5px;color:#e6e1f2;letter-spacing:.04em}',
      '.edl-body{display:block;margin-top:3px;font-size:12px;line-height:1.85;color:#a9a3bd}',
      '.edl-cap{margin:12px 0 0;font-size:12.5px;line-height:2;color:#cfc8e6;text-align:center;letter-spacing:.04em;word-break:auto-phrase}',
    ].join('\n');
    d.head.appendChild(s);
  }

  global.EdLens = { mapHtml: mapHtml, LENSES: LENSES };
})(typeof window !== 'undefined' ? window : this);
