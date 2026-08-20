// api/share.js
// Xでシェアされた時、クローラー（Xbot等）はJavaScriptを実行しないため、
// SPA（index.html）に直接リンクしても、動的な結果を反映したOGPは表示できない。
// そこで、シェア専用のこの軽量ページを経由させ、
// ①クローラーには「その人の結果」を反映したog:imageを見せ、
// ②人間のブラウザには、自動でindex.html（結果画面）へリダイレクトする。
//
// 例: /api/share?code=xxxx&el=風&w=法器&nat=モンド&char=放浪者&match=73

export const config = { runtime: 'edge' };

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

export default async function handler(req) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code') || '';
  const el = searchParams.get('el') || '';
  const w = searchParams.get('w') || '';
  const nat = searchParams.get('nat') || '';
  const charName = searchParams.get('char') || '';
  const match = searchParams.get('match') || '';

  const ogImageUrl = `${origin}/api/og-image?` + new URLSearchParams({ el, w, nat, char: charName, match }).toString();
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

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
