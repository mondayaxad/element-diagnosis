// jagan/card.mjs — 「画像を保存」の結果画像（元素診断と同じ 1080×1080 の構成。押したときにブラウザで描く）。
//   暗い地に邪眼元素の色の光、「邪眼元素 × 異相」をそれぞれの色で、最も近しいファトゥスと一致度を大きく出す。
//   公開要約（publicSummary）の値だけを使う。背景・人物の画像は使わない。
import { ELEMENT_COLOR, NEUTRAL_COLOR, ISOU_COLOR } from './site-copy.mjs';

const SERIF = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
// 暗い地で沈みすぎず、元素診断より少し暗い色（黒を混ぜる）
const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');

export function cardColors(s) {
  const el = ELEMENT_COLOR[s.element.id] || NEUTRAL_COLOR;
  const isouKey = s.isou.id || (s.isou.label === '未顕' ? 'NONE' : 'MIX');
  return { el: shade(el.main, 0.92), elGlow: el.main, isou: shade(ISOU_COLOR[isouKey], 0.88) };
}

export function drawCard(canvas, s) {
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  const c = cardColors(s);
  ctx.fillStyle = '#09070B'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  g.addColorStop(0, `rgba(${rgb(c.elGlow)},0.26)`); g.addColorStop(1, 'rgba(9,7,11,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W / 2, H * 0.72, 0, W / 2, H * 0.72, W * 0.45);
  g2.addColorStop(0, 'rgba(165,42,67,0.14)'); g2.addColorStop(1, 'rgba(9,7,11,0)');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#6E3A4A'; ctx.font = `28px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  ctx.fillText('DELUSION DIAGNOSIS', W / 2, 180);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  // 「元素 × 異相」（それぞれの色。長い異相名は文字を小さく）
  const elText = s.element.label, isouText = s.isou.label;
  const isouSize = isouText.length >= 4 ? 84 : 100;
  ctx.font = `bold 130px ${SERIF}`; const elW = ctx.measureText(elText).width;
  ctx.font = `56px ${SERIF}`; const xW = ctx.measureText(' × ').width;
  ctx.font = `bold ${isouSize}px ${SERIF}`; const isW = ctx.measureText(isouText).width;
  const startX = W / 2 - (elW + xW + isW) / 2;
  ctx.textAlign = 'left';
  ctx.font = `bold 130px ${SERIF}`; ctx.fillStyle = c.el; ctx.fillText(elText, startX, 340);
  ctx.font = `56px ${SERIF}`; ctx.fillStyle = '#4A2232'; ctx.fillText(' × ', startX + elW, 340);
  ctx.font = `bold ${isouSize}px ${SERIF}`; ctx.fillStyle = c.isou; ctx.fillText(isouText, startX + elW + xW, 340);
  ctx.textAlign = 'center';

  ctx.strokeStyle = c.el; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W / 2 - 50, 430); ctx.lineTo(W / 2 + 50, 430); ctx.stroke();

  ctx.fillStyle = '#B0909B'; ctx.font = `26px ${SERIF}`;
  ctx.fillText('最も近しいファトゥス', W / 2, 500);
  ctx.fillStyle = c.el; ctx.font = `bold ${s.character.label.length >= 6 ? 76 : 88}px ${SERIF}`;
  ctx.fillText(s.character.label, W / 2, 610);
  ctx.fillStyle = c.isou; ctx.font = `bold 140px ${SERIF}`;
  ctx.fillText(`${s.character.matchPercent}%`, W / 2, 760);
  ctx.fillStyle = '#6E3A4A'; ctx.font = `24px ${SERIF}`;
  ctx.fillText('一 致', W / 2, 850);
  ctx.fillStyle = '#4A2232'; ctx.font = `22px ${SERIF}`;
  ctx.fillText('#邪眼診断　@mondayaxad', W / 2, 980);
  return canvas;
}

export function cardDataUrl(summary) {
  return drawCard(document.createElement('canvas'), summary).toDataURL('image/png');
}
