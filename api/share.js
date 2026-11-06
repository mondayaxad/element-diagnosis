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
const PACK_NATIONS = ["モンド","璃月","稲妻","スメール","フォンテーヌ","ナタ","スネージナヤ","ナドクライ"];
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
const NATION_NAME = { M:"モンド", L:"璃月", I:"稲妻", S:"スメール", F:"フォンテーヌ", N:"ナタ", Z:"スネージナヤ", D:"ナドクライ" };
const CHAR_NAMES = ["ディルック","マーヴィカ","嘉明","ディシア","辛炎","ベネット","胡桃","香菱","トーマ","シュヴルーズ","アルレッキーノ","ニコ","煙緋","クレー","リネ","アンバー","宵宮","ドゥリン","フリーナ","ニィロウ","神里綾人","行秋","タルタリヤ","夜蘭","シグウィン","モナ","珊瑚宮心海","ヌヴィレット","コロンビーナ","ムアラニ","バーバラ","アイノ","ダリア","キャンディス","オデット","神里綾華","スカーク","七七","レイラ","ガイア","申鶴","ロサリア","ミカ","エスコフィエ","ローエン","甘雨","ディオナ","アーロイ","リオセスリ","シャルロット","シトラリ","アリョーシャ","刻晴","クロリンデ","久岐忍","雷電将軍","セノ","イアンサ","フィッシュル","九条裟羅","オロルン","セトス","八重神子","リサ","ヴァレサ","レザー","北斗","ドリー","楓原万葉","ジン","リネット","ファルカ","早柚","ウェンティ","チャスカ","ファルザン","ヤフォダ","スクロース","放浪者","閑雲","藍硯","鹿野院平蔵","夢見月瑞希","イファ","プルーネ","鍾離","イルーガ","カチーナ","雲菫","ナヴィア","荒瀧一斗","ノエル","アルベド","茲白","千織","シロネン","ゴロー","リンネア","凝光","ナヒーダ","白朮","ラウマ","ネフェル","ティナリ","コレイ","アルハイゼン","綺良々","カーヴェ","キィニチ","エミリエ","ヨォーヨ","サンドローネ","魈","エウルア","重雲","フレミネ","フリンズ","イネファ"];

// ---- 元素診断 Mini（m1）。js/eti_mini_share.js・api/_og-data.mjs と同じ符号（tests/eti_mini_share.test.js が全件で一致を確かめる） ----
const MINI_CHAR_COUNT = 118;
function unpackMiniShare(s) {
  if (typeof s !== 'string' || !/^[0-9a-z]{1,4}$/.test(s)) return null;
  let v = parseInt(s, 36);
  if (!(v >= 0 && v < 7 * 5 * 8 * 2 * MINI_CHAR_COUNT) || v.toString(36) !== s) return null;
  const charIdx = v % MINI_CHAR_COUNT; v = (v - charIdx) / MINI_CHAR_COUNT;
  const picked = v % 2; v = (v - picked) / 2;
  const n = v % 8; v = (v - n) / 8;
  const wi = v % 5; v = (v - wi) / 5;
  return { el: PACK_ELEMENTS[v], w: PACK_WEAPONS[wi], nat: PACK_NATIONS[n], charIdx, userPicked: picked === 1 };
}
const MINI_NATION_DISPLAY = { 'ナドクライ': 'ナド・クライ' };
// 共鳴診断（m2）：js/eti_mini_share.js の unpackResonance と同じ計算
function unpackResonanceShare(s) {
  if (typeof s !== 'string' || !/^[0-9a-z]{1,5}$/.test(s)) return null;
  let v = parseInt(s, 36);
  const C = MINI_CHAR_COUNT;
  if (!(v >= 0 && v < 280 * C * (C + 1)) || v.toString(36) !== s) return null;
  const self = v % (C + 1); v = (v - self) / (C + 1);
  const mirror = v % C; v = (v - mirror) / C;
  const n = v % 8; v = (v - n) / 8;
  const wi = v % 5; v = (v - wi) / 5;
  return { el: PACK_ELEMENTS[v], w: PACK_WEAPONS[wi], nat: PACK_NATIONS[n], mirrorIdx: mirror, selfIdx: self === C ? null : self };
}

// 旧 元素診断 Mini のシェアページ（m1）：クローラーには従来の画像、人には /resonance?s=（その結果の表示）へ移す
function miniSharePage(m1, origin) {
  const u = unpackMiniShare(m1);
  // 旧 Mini のリンク：共鳴診断のページ（/resonance）で、旧形式（s）のまま表示する
  const redirectUrl = u ? `${origin}/resonance?s=${m1}` : `${origin}/resonance`;
  const nation = u ? (MINI_NATION_DISPLAY[u.nat] || u.nat) : '';
  const charName = u ? (CHAR_NAMES[u.charIdx] || '') : '';
  const title = u ? `元素診断 Mini — 私の結果は【${u.el} × ${u.w} × ${nation}】` : '元素診断 Mini';
  const description = u
    ? `${u.userPicked ? '私のキャラクター' : '近しいキャラクター'}：${charName}。3つの問いで、あなたの元素・武器種・国家を見つけてみませんか。`
    : '3つの問いで、あなたの元素・武器種・国家を見つけてみませんか。';
  const ogImageUrl = u ? `${origin}/api/og-image?m1=${m1}` : `${origin}/assets/ogp/ogp-top-20261009.jpg`;
  return `<!DOCTYPE html>
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
}

// 共鳴診断のシェアページ（m2）：クローラーには2人表示の og:image、人は /resonance?r= へ
function resonanceSharePage(m2, origin) {
  const u = unpackResonanceShare(m2);
  const redirectUrl = u ? `${origin}/resonance?r=${m2}` : `${origin}/resonance`;
  const nation = u ? (MINI_NATION_DISPLAY[u.nat] || u.nat) : '';
  const mirror = u ? (CHAR_NAMES[u.mirrorIdx] || '') : '';
  const self = u && u.selfIdx !== null ? (CHAR_NAMES[u.selfIdx] || '') : '';
  const title = u ? `共鳴診断 — 私の結果は【${u.el} × ${u.w} × ${nation}】` : '共鳴診断';
  const lead = '3つの問いで、あなたの元素・武器種・国家と、あなたに共鳴する人物を見つけてみませんか。';
  const description = u ? `${self ? `私が選んだ人物：${self}／` : ''}回答に映る人物：${mirror}。${lead}` : lead;
  const ogImageUrl = u ? `${origin}/api/og-image?m2=${m2}` : `${origin}/assets/ogp/ogp-top-20261009.jpg`;
  return sharePageHtml(title, description, ogImageUrl, redirectUrl);
}

function sharePageHtml(title, description, ogImageUrl, redirectUrl) {
  return `<!DOCTYPE html>
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
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const searchParams = url.searchParams;
  const origin = `https://${req.headers.host}`;
  // 元素診断 Mini のシェア（本家と同じ /api/share を使い、m1 があれば Mini のページを返す）
  const resonanceParam = searchParams.get('m2');
  if (resonanceParam !== null) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send(resonanceSharePage(resonanceParam, origin));
    return;
  }
  const miniParam = searchParams.get('m1');
  if (miniParam !== null) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send(miniSharePage(miniParam, origin));
    return;
  }
  const code = searchParams.get('code') || '';
  // 明示的に許可する診断バージョンはETI-2.0だけ。
  // 値が無い場合は既存URL互換のlegacy-v1として扱う。
  const diagnosisVersion = searchParams.get('dv') === 'ETI-2.0' ? 'ETI-2.0' : null;

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
  const redirectParams = new URLSearchParams();
  if (diagnosisVersion) redirectParams.set('dv', diagnosisVersion);
  redirectParams.set('code', code);
  // ETI v2 の MIRROR 版（例 mv=2.1.0）をそのまま結果URLへ引き継ぐ。無い旧リンクは付けない（旧版として表示される）。
  const mirrorVersionParam = searchParams.get('mv');
  if (diagnosisVersion && mirrorVersionParam && /^\d+\.\d+\.\d+$/.test(mirrorVersionParam)) redirectParams.set('mv', mirrorVersionParam);
  const redirectUrl = `${origin}/?${redirectParams.toString()}`;
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
module.exports._unpackMiniShare = unpackMiniShare;
module.exports._unpackResonanceShare = unpackResonanceShare;
