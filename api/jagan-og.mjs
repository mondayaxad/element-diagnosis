// api/jagan-og.mjs — 邪眼診断の共有カード（OGP 1200×630）。
//   /api/jagan-og?e=PY&t=SURGE&c=pierro&m=87&x=0
//   値は公開要約（publicSummary）から作った列挙値と整数だけ（共有ページが組み立てる）。回答・12スコア・ID は受け取らない。
//   未知の値は受け付けず、診断名だけの汎用カードにする。背景・人物の画像は使わない（文字と装飾だけ）。
//   フォントは Google Fonts から必要な文字だけを取得する（取れなければ既定のフォントで描く。画像の生成を止めない）。
import { ImageResponse } from '@vercel/og';
import { parseOg } from '../lib/jagan-og-params.mjs';

export const config = { runtime: 'edge' };

const h = (type, style, children) => ({ type, props: { style, children } });
const C = { bg: '#09070B', card: '#160D14', accent: '#A52A43', text: '#EFE5E8', sub: '#BDA9B0', line: '#5A2333' };
async function loadFont(text) {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@700&text=${encodeURIComponent(text)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
    })).text();
    const url = (css.match(/src:\s*url\(([^)]+)\)/) || [])[1];
    if (!url) return null;
    const r = await fetch(url);
    return r.ok ? await r.arrayBuffer() : null;
  } catch { return null; }
}

export default async function handler(req) {
  const v = parseOg(new URL(req.url).searchParams);
  const lines = v ? {
    kicker: 'あなたの深淵',
    headline: `${v.element} × ${v.isou}`,
    fatui: `最も近しいファトゥス：${v.character}（${v.match}%一致）`,
    note: '',
  } : { kicker: 'あなたの願いは、どんな深淵を映すのか。', headline: '邪眼診断', fatui: '', note: '' };
  const footer = '邪眼診断｜作品解釈による独自の参照パターンとの近さ';
  const noteText = lines.note ? `※${lines.note}に同率候補があります` : '';
  const font = await loadFont(`Delusion Diagnosis${lines.kicker}${lines.headline}${lines.fatui}${noteText}${footer}0123456789%×（）：・※`);

  const tree = h('div', {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: `radial-gradient(ellipse at 50% 38%, #3a0f1d 0%, ${C.bg} 62%)`, color: C.text, fontFamily: font ? 'JaganSerif' : 'serif',
  }, [
    h('div', {
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 1080, height: 510,
      border: `2px solid ${C.line}`, borderRadius: 24, background: 'rgba(22,13,20,0.82)', padding: '36px 48px',
      boxShadow: `0 0 60px rgba(165,42,67,0.35)`,
    }, [
      h('div', { fontSize: 30, color: C.accent, letterSpacing: 6, fontStyle: 'italic' }, 'Delusion Diagnosis'),
      h('div', { fontSize: 30, color: C.sub, marginTop: 18 }, lines.kicker),
      h('div', { fontSize: lines.headline.length > 10 ? 76 : 92, marginTop: 14, letterSpacing: 4 }, lines.headline),
      lines.fatui ? h('div', { fontSize: 38, marginTop: 26, color: C.text }, lines.fatui) : h('div', { display: 'flex' }, ''),
      noteText ? h('div', { fontSize: 24, marginTop: 14, color: C.sub }, noteText) : h('div', { display: 'flex' }, ''),
      h('div', { width: 360, height: 2, background: C.accent, marginTop: 30, opacity: 0.7 }, ''),
      h('div', { fontSize: 22, marginTop: 18, color: C.sub }, footer),
    ]),
  ]);
  return new ImageResponse(tree, {
    width: 1200, height: 630,
    fonts: font ? [{ name: 'JaganSerif', data: font, weight: 700, style: 'normal' }] : undefined,
    headers: { 'cache-control': 'public, max-age=86400, s-maxage=31536000, immutable' },
  });
}
