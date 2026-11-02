// jagan/card.mjs — 「画像保存」の結果カード（押したときにブラウザで描く。公開要約と同じ値だけを使う）。
//   背景・人物の画像は使わない。失敗しても他の操作を止めない（呼び出し側が状態を表示する）。
const C = { bg: '#09070B', card: '#160D14', accent: '#A52A43', hi: '#C8405C', text: '#EFE5E8', sub: '#BDA9B0', line: '#5A2333' };
const SERIF = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';

function fitFont(ctx, text, max, size, weight = 700) {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${SERIF}`; s -= 2; } while (ctx.measureText(text).width > max && s > 20);
}

export function drawCard(canvas, s) {
  const W = 1200, H = 630;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  const g = ctx.createRadialGradient(W / 2, H * 0.38, 20, W / 2, H * 0.38, 700);
  g.addColorStop(0, '#3a0f1d'); g.addColorStop(1, C.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(22,13,20,0.85)'; ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(60, 60, W - 120, H - 120, 24) : ctx.rect(60, 60, W - 120, H - 120); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C.hi; ctx.font = `italic 30px "Snell Roundhand","Apple Chancery",cursive`;
  ctx.fillText('Delusion Diagnosis', W / 2, 120);
  ctx.fillStyle = C.sub; ctx.font = `400 28px ${SERIF}`; ctx.fillText('あなたの深淵', W / 2, 175);
  const head = `${s.element.label} × ${s.type.label}`;
  ctx.fillStyle = C.text; ctx.shadowColor = 'rgba(165,42,67,0.8)'; ctx.shadowBlur = 24;
  fitFont(ctx, head, 980, 88); ctx.fillText(head, W / 2, 268);
  ctx.shadowBlur = 0;
  const fat = `最も近しいファトゥス：${s.character.label}（${s.character.matchPercent}%一致）`;
  fitFont(ctx, fat, 980, 38, 400); ctx.fillText(fat, W / 2, 365);
  const ties = [s.element.hasExactTie ? '元素' : '', s.type.hasExactTie ? '型' : '', s.character.hasExactTie ? '人物' : ''].filter(Boolean);
  if (ties.length) { ctx.fillStyle = C.sub; ctx.font = `400 24px ${SERIF}`; ctx.fillText(`※${ties.join('・')}に同率候補があります`, W / 2, 420); }
  ctx.fillStyle = C.accent; ctx.fillRect(W / 2 - 180, 465, 360, 2);
  ctx.fillStyle = C.sub; ctx.font = `400 22px ${SERIF}`;
  ctx.fillText('邪眼診断｜作品解釈による独自の参照パターンとの近さ', W / 2, 510);
  return canvas;
}

export function cardBlob(summary) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = drawCard(document.createElement('canvas'), summary);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob_failed'))), 'image/png');
    } catch (e) { reject(e); }
  });
}
