// eti_mini_share.js — 元素診断 Mini のシェア用の短い符号（URL の m1 / s パラメータ）。
//
// 本家（index.html の packShareParams → /api/share → /api/og-image）と同じ仕組みで、表示する結果だけを1つの短い値に詰める。
//   値：結果の元素・武器・国家（内部キー）、表示するキャラクター（ETI-CHAR-2.1.0 の並び＝api/_og-data.mjs の CHAR_NAMES の番号）、
//       キャラクターを本人が選んだか（0 = 答えから自動、1 = 本人が選んだ）
//   一致率・点数は含めない（Mini では表示しない）。
//   混合基数（元素7×武器5×国家8×選び方2×キャラ118 = 66,080 通り）で整数にし、36進の小文字で表す。
//   範囲外・先頭の0・大文字は受け付けない（同じ結果は必ず同じ文字列＝正規形。画像の CDN キャッシュを1つにそろえる）。
// 同じ計算を api/_og-data.mjs（画像）・api/share.js（シェアページ）にも置いている。tests/eti_mini_share.test.js が全 66,080 通りで一致を確かめる。
(function (root) {
  'use strict';
  var ELEMENTS = ['炎', '水', '氷', '雷', '風', '岩', '草'];
  var WEAPONS = ['片手剣', '両手剣', '長柄', '法器', '弓'];
  var NATIONS = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
  var CHAR_COUNT = 118;
  var TOTAL = 7 * 5 * 8 * 2 * CHAR_COUNT;

  function pack(element, weapon, nation, charIndex, userPicked) {
    var e = ELEMENTS.indexOf(element), w = WEAPONS.indexOf(weapon), n = NATIONS.indexOf(nation);
    if (e < 0 || w < 0 || n < 0 || !(charIndex >= 0 && charIndex < CHAR_COUNT && charIndex % 1 === 0)) return null;
    return ((((e * 5 + w) * 8 + n) * 2 + (userPicked ? 1 : 0)) * CHAR_COUNT + charIndex).toString(36);
  }
  function unpack(s) {
    if (typeof s !== 'string' || !/^[0-9a-z]{1,4}$/.test(s)) return null;
    var v = parseInt(s, 36);
    if (!(v >= 0 && v < TOTAL) || v.toString(36) !== s) return null;
    var charIndex = v % CHAR_COUNT; v = (v - charIndex) / CHAR_COUNT;
    var picked = v % 2; v = (v - picked) / 2;
    var n = v % 8; v = (v - n) / 8;
    var w = v % 5; v = (v - w) / 5;
    return { element: ELEMENTS[v], weapon: WEAPONS[w], nation: NATIONS[n], charIndex: charIndex, userPicked: picked === 1 };
  }
  var api = { ELEMENTS: ELEMENTS, WEAPONS: WEAPONS, NATIONS: NATIONS, CHAR_COUNT: CHAR_COUNT, TOTAL: TOTAL, pack: pack, unpack: unpack };
  root.ETIMiniShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
