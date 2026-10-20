// js/lens-constellation.js（EdLens）
// 完全解析の三つの人物像（MIRROR・HIDDEN SHAPE・MENTOR）を、元素診断の世界観（宝石の惑星と星の軌道）で示す図。
//   中心にあなたの元素の宝石、その周りを三つの軌道が巡り、それぞれの軌道に10の星（人物像）が並ぶ。
//   診断結果のページ・解析レポートのサンプルで共通に使う。外部への通信・計測はしない。
(function (global) {
  'use strict';

  var LENSES = [
    { key: 'mirror', en: 'MIRROR', color: '#83b9da', rx: 66, ry: 30, tilt: -8, start: 200, span: 300, label: [14, 26, 'start'], anchor: 1,
      head: 'いまのあなたに最も近い10名', body: '20軸の配置が、いまのあなたに最も近い人物たち。どこが重なり、どこが違うのかを一人ずつ読み解きます。' },
    { key: 'hidden', en: 'HIDDEN SHAPE', color: '#ac82d4', rx: 104, ry: 50, tilt: -8, start: 140, span: 310, label: [326, 26, 'end'], anchor: 5,
      head: '表に出にくい一面に近い10名', body: '強さの順位ではなく、山と谷の「形」が近い人物たち。数値の高さだけでは見えなかった資質が、ここで輪郭を持ちます。' },
    { key: 'mentor', en: 'MENTOR', color: '#d3ad68', rx: 142, ry: 70, tilt: -8, start: 95, span: 320, label: [326, 284, 'end'], anchor: 9,
      head: 'これから伸ばす方向に近い10名', body: '選んだ目標に向けて、核を失わずに広げるための振る舞いを借りられる人物たち。目標によって、顔ぶれが変わります。' },
  ];

  // 星の位置（決まった並び。毎回同じ図になる）
  function starPoints(l) {
    var pts = [];
    var t = l.tilt * Math.PI / 180;
    for (var i = 0; i < 10; i++) {
      var a = (l.start + (l.span / 9) * i + ((i * 37) % 11) - 5) * Math.PI / 180;
      var x = l.rx * Math.cos(a), y = l.ry * Math.sin(a);
      pts.push([170 + x * Math.cos(t) - y * Math.sin(t), 150 + x * Math.sin(t) + y * Math.cos(t)]);
    }
    return pts;
  }
  function sparkle(x, y, r, color, k) {
    var s = r * 0.32;
    return '<g class="edl-star" style="--d:' + k + '">'
      + '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (r * 1.9).toFixed(1) + '" fill="' + color + '" opacity=".16"/>'
      + '<path d="M' + x.toFixed(1) + ' ' + (y - r).toFixed(1) + 'L' + (x + s).toFixed(1) + ' ' + (y - s).toFixed(1) + 'L' + (x + r).toFixed(1) + ' ' + y.toFixed(1)
      + 'L' + (x + s).toFixed(1) + ' ' + (y + s).toFixed(1) + 'L' + x.toFixed(1) + ' ' + (y + r).toFixed(1) + 'L' + (x - s).toFixed(1) + ' ' + (y + s).toFixed(1)
      + 'L' + (x - r).toFixed(1) + ' ' + y.toFixed(1) + 'L' + (x - s).toFixed(1) + ' ' + (y - s).toFixed(1) + 'Z" fill="' + color + '"/></g>';
  }

  function svgHtml(color) {
    var el = /^#[0-9a-fA-F]{3,8}$/.test(String(color || '')) ? color : '#9fc4e8';
    var uid = 'edl' + Math.random().toString(36).slice(2, 8);
    var orbits = LENSES.map(function (l, li) {
      var pts = starPoints(l);
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
      var stars = pts.map(function (p, i) { return sparkle(p[0], p[1], i % 3 === 0 ? 4.2 : 3.2, l.color, li * 10 + i); }).join('');
      // 名前は図の外側に置き、細い線でその軌道の星へ結ぶ（星図の注記のように。文字を星に重ねない）
      var to = pts[l.anchor], lx = l.label[0], ly = l.label[1];
      var lineY = ly > 150 ? ly - 12 : ly + 5;
      var label = '<path d="M' + lx + ' ' + lineY + 'L' + (l.label[2] === 'end' ? lx - 6 : lx + 6) + ' ' + lineY + 'L' + to[0].toFixed(1) + ' ' + to[1].toFixed(1) + '" fill="none" stroke="' + l.color + '" stroke-opacity=".45" stroke-width=".6"/>'
        + '<text x="' + lx + '" y="' + ly + '" text-anchor="' + l.label[2] + '" fill="' + l.color + '" font-size="9.5" letter-spacing="1.8">' + l.en + '</text>'
        + '<text x="' + lx + '" y="' + (ly + (ly > 150 ? -16 : 12)) + '" text-anchor="' + l.label[2] + '" fill="#cfc8e6" font-size="8" letter-spacing="1" opacity=".8">10名</text>';
      return '<g class="edl-orbit edl-' + l.key + '">'
        + '<ellipse cx="170" cy="150" rx="' + l.rx + '" ry="' + l.ry + '" transform="rotate(' + l.tilt + ' 170 150)" fill="none" stroke="' + l.color + '" stroke-opacity=".28" stroke-width=".8" stroke-dasharray="1.5 4"/>'
        + '<path d="' + line + '" fill="none" stroke="' + l.color + '" stroke-opacity=".38" stroke-width=".7"/>'
        + stars + label
        + '</g>';
    }).join('');
    // 背景の小さな星（固定の位置）
    var dust = '';
    for (var i = 0; i < 26; i++) {
      var x = (i * 73) % 340, y = (i * 41 + 17) % 300;
      dust += '<circle cx="' + x + '" cy="' + y + '" r="' + (i % 4 === 0 ? 0.9 : 0.5) + '" fill="#e8e2ff" opacity="' + (0.18 + (i % 5) * 0.06).toFixed(2) + '"/>';
    }
    return '<svg class="edl-svg" viewBox="0 0 340 300" role="img" aria-label="あなたの元素を中心に、MIRROR・HIDDEN SHAPE・MENTOR の三つの軌道に、それぞれ10の人物像が並ぶ図">'
      + '<defs><radialGradient id="' + uid + 'g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="' + el + '" stop-opacity=".38"/><stop offset="100%" stop-color="' + el + '" stop-opacity="0"/></radialGradient>'
      + '<linearGradient id="' + uid + 'p" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity=".9"/><stop offset="45%" stop-color="' + el + '"/><stop offset="100%" stop-color="' + el + '" stop-opacity=".55"/></linearGradient></defs>'
      + dust
      + '<circle cx="170" cy="150" r="54" fill="url(#' + uid + 'g)"/>'
      + orbits
      + '<g transform="translate(152 128)" stroke="#ffffffa0" stroke-width=".6" stroke-linejoin="round">'
      + '<ellipse cx="18" cy="22" rx="27" ry="8" fill="none" stroke="' + el + '" stroke-width="1.1" opacity=".55" transform="rotate(-18 18 22)"/>'
      + '<polygon points="18,4 26,14 18,18 10,14" fill="url(#' + uid + 'p)"/>'
      + '<polygon points="10,14 18,18 16,34 5,24" fill="' + el + '" opacity=".88"/>'
      + '<polygon points="26,14 18,18 20,34 31,24" fill="' + el + '" opacity=".72"/>'
      + '<polygon points="16,34 20,34 18,40" fill="' + el + '" opacity=".6"/>'
      + '</g>'
      + '</svg>';
  }

  // 図と、三つの視点の説明（サイトの文体）
  function mapHtml(opts) {
    var o = opts || {};
    injectStyles();
    return '<figure class="edl-map">'
      + svgHtml(o.color)
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
      '.edl-svg{display:block;width:100%;max-width:420px;height:auto;margin:0 auto;font-family:inherit}',
      '.edl-star{animation:edl-tw 4.8s ease-in-out infinite;animation-delay:calc(var(--d) * -0.37s)}',
      '@keyframes edl-tw{0%,100%{opacity:1}50%{opacity:.55}}',
      '@media (prefers-reduced-motion: reduce){.edl-star{animation:none}}',
      '.edl-legend{list-style:none;margin:6px 0 0;padding:0}',
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
