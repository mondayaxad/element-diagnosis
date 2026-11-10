// api/jagan-og.mjs — 邪眼診断（DTI）の共有カード（OGP 1200×630）。
//   /api/jagan-og?e=HY&t=SEP&c=scaramouche&m=87&v=<呼び名の版>.<デザインの版>
//   値は公開要約から作った列挙値と整数だけ（共有ページが組み立てる）。回答・12特性の得点・結果ID は受け取らない。
//   名前・コード・呼び名は lib/jagan-og-params.mjs が許可された ID から解決する。未知の値は汎用カード（DTI の共通画像）。
//   フォントは同梱の部分集合（api/_jagan-og-font.mjs。scripts/build-jagan-og-font.mjs で作る）だけを使い、実行時に取りに行かない。
//   同じ URL は同じ画像（v に呼び名とデザインの版を含めるので、版を変えると別のキャッシュになる）。
import { ImageResponse } from '@vercel/og';
import { parseOg } from '../lib/jagan-og-params.mjs';
import { buildCardTree } from '../lib/jagan-og-card.mjs';
import { JAGAN_OG_SERIF_WOFF_BASE64, JAGAN_OG_SANS_WOFF_BASE64 } from './_jagan-og-font.mjs';

export const config = { runtime: 'edge' };

let fonts = null;
function loadFonts() {
  if (!fonts) {
    const dec = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
    fonts = [
      { name: 'JaganSerif', data: dec(JAGAN_OG_SERIF_WOFF_BASE64), weight: 700, style: 'normal' },
      { name: 'JaganSans', data: dec(JAGAN_OG_SANS_WOFF_BASE64), weight: 500, style: 'normal' },
    ];
  }
  return fonts;
}

export default async function handler(req) {
  const v = parseOg(new URL(req.url).searchParams);
  return new ImageResponse(buildCardTree(v), {
    width: 1200, height: 630, fonts: loadFonts(),
    headers: v
      ? { 'cache-control': 'public, immutable, no-transform, max-age=31536000, s-maxage=31536000' }
      : { 'cache-control': 'public, max-age=3600, s-maxage=86400' },
  });
}
