// api/share.js
// Xでシェアされた時、クローラー（Xbot等）はJavaScriptを実行しないため、
// SPA（index.html）に直接リンクしても、動的な結果を反映したOGPは表示できない。
// そこで、シェア専用のこの軽量ページを経由させ、
// ①クローラーには「その人の結果」を反映したog:imageを見せ、
// ②人間のブラウザには、自動でindex.html（結果画面）へリダイレクトする。
//
// URLを短くするため、元素・武器・国家・キャラIndex・一致度の5値を、
// 1つの整数にビット単位で詰め込んだ「p」パラメータとして受け取る。
// 例: /api/share?code=xxxx&p=2tc5u
// （旧形式のel/w/nat/c/mも、後方互換のため引き続き読み取れる）

const PACK_ELEMENTS = ["炎","水","氷","雷","風","岩","草"];
const PACK_WEAPONS = ["片手剣","両手剣","長柄","法器","弓"];
const PACK_NATIONS = ["モンド","璃月","稲妻","スメール","フォンテーヌ","ナタ","スネージナヤ"];
function unpackShareParams(p) {
  const n = parseInt(p, 36);
  if (isNaN(n)) return null;
  const elI = (n >> 20) & 0x7;
  const wI = (n >> 17) & 0x7;
  const natI = (n >> 14) & 0x7;
  const cI = (n >> 7) & 0x7F;
  const mI = n & 0x7F;
  return {
    el: PACK_ELEMENTS[elI] || '',
    w: PACK_WEAPONS[wI] || '',
    nat: PACK_NATIONS[natI] || '',
    charIdx: cI,
    match: mI,
  };
}

const ELEMENT_NAME = { PY:"炎", HY:"水", CR:"氷", EL:"雷", AN:"風", GE:"岩", DE:"草" };
const WEAPON_NAME = { SW:"片手剣", CM:"両手剣", PL:"長柄", CT:"法器", BW:"弓" };
const NATION_NAME = { M:"モンド", L:"璃月", I:"稲妻", S:"スメール", F:"フォンテーヌ", N:"ナタ", Z:"スネージナヤ" };
const CHAR_NAMES = ["ディルック","マーヴィカ","嘉明","ディシア","辛炎","ベネット","胡桃","香菱","トーマ","シュヴルーズ","アルレッキーノ","ニコ","煙緋","クレー","リネ","アンバー","宵宮","ドゥリン","フリーナ","ニィロウ","神里綾人","行秋","タルタリヤ","夜蘭","シグウィン","モナ","珊瑚宮心海","ヌヴィレット","コロンビーナ","ムアラニ","バーバラ","アイノ","ダリア","キャンディス","オデット","神里綾華","スカーク","七七","レイラ","ガイア","申鶴","ロサリア","ミカ","エスコフィエ","ローエン","甘雨","ディオナ","アーロイ","リオセスリ","シャルロット","シトラリ","アリョーシャ","刻晴","クロリンデ","久岐忍","雷電将軍","セノ","イアンサ","フィッシュル","九条裟羅","オロルン","セトス","八重神子","リサ","ヴァレサ","レザー","北斗","ドリー","楓原万葉","ジン","リネット","ファルカ","早柚","ウェンティ","チャスカ","ファルザン","ヤフォダ","スクロース","放浪者","閑雲","藍硯","鹿野院平蔵","夢見月瑞希","イファ","プルーネ","鍾離","イルーガ","カチーナ","雲菫","ナヴィア","荒瀧一斗","ノエル","アルベド","茲白","千織","シロネン","ゴロー","リンネア","凝光","ナヒーダ","白朮","ラウマ","ネフェル","ティナリ","コレイ","アルハイゼン","綺良々","カーヴェ","キィニチ","エミリエ","ヨォーヨ","サンドローネ","魈","エウルア","重雲","フレミネ","フリンズ","イネファ"];

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const searchParams = url.searchParams;
  const origin = `https://${req.headers.host}`;
  const code = searchParams.get('code') || '';

  let el, w, nat, charIdx, match;
  const packed = searchParams.get('p');
  if (packed) {
    const unpacked = unpackShareParams(packed);
    el = unpacked ? unpacked.el : '';
    w = unpacked ? unpacked.w : '';
    nat = unpacked ? unpacked.nat : '';
    charIdx = unpacked ? unpacked.charIdx : null;
    match = unpacked ? unpacked.match : '';
  } else {
    // 旧形式（後方互換）
    el = ELEMENT_NAME[searchParams.get('el')] || '';
    w = WEAPON_NAME[searchParams.get('w')] || '';
    nat = NATION_NAME[searchParams.get('nat')] || '';
    charIdx = searchParams.get('c');
    match = searchParams.get('m') || '';
  }
  const charName = (charIdx !== null && CHAR_NAMES[Number(charIdx)]) ? CHAR_NAMES[Number(charIdx)] : '';

  const ogImageUrl = packed
    ? `${origin}/api/og-image?p=${encodeURIComponent(packed)}`
    : `${origin}/api/og-image?` + new URLSearchParams({ el: searchParams.get('el')||'', w: searchParams.get('w')||'', nat: searchParams.get('nat')||'', c: charIdx || '', m: match }).toString();
  const redirectUrl = `${origin}/?code=${encodeURIComponent(code)}`;
  const title = `元素診断 — 私の結果は【${el} × ${w} × ${nat}】`;
  const description = `最も近しいキャラクター：${charName}（${match}%一致）。あなたも元素診断で、自分だけの結果を見つけてみませんか。`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(ogImageUrl)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(redirectUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImageUrl)}">
<meta http-equiv="refresh" content="0;url=${esc(redirectUrl)}">
<script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</head>
<body>
  <p>結果ページへ移動しています… <a href="${esc(redirectUrl)}">移動しない場合はこちら</a></p>
</body>
</html>`;

  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
