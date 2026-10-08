// CORE1-HIDDEN-1.0.0 — 強度を外した「山と谷の配置」の近さ。
// 各領域（PERSONALITY 5 / STYLE 5 / VALUES 10）を個別に平均中心化し、centered cosine を 0..1 へ。
// ゼロベクトル時は 0.5。hidden_raw = 0.40P + 0.30S + 0.30V。
// 順位：丸め前 hidden_raw 降順 → 完全同率は P → S → V → canonical index。
// これは ETI 内部の形状類似モデルであり、心理学的に独立検証された尺度ではない。
'use strict';
const { center, cosine, assertVector } = require('./vector');

const HIDDEN_MODEL = Object.freeze({ version: 'CORE1-HIDDEN-1.0.0', weights: Object.freeze({ P: 0.40, S: 0.30, V: 0.30 }), zeroVectorShape: 0.5, topN: 10 });

function shapeSim(user, ch, axes) {
  const c = cosine(center(user, axes), center(ch, axes));
  return c === null ? HIDDEN_MODEL.zeroVectorShape : (c + 1) / 2;
}

function hiddenShape(user, characters, meta) {
  const PA = meta.personalityAxes, SA = meta.styleAxes, VA = meta.valueAxes, W = HIDDEN_MODEL.weights;
  assertVector(user.personality, PA, 'user.personality'); assertVector(user.style, SA, 'user.style'); assertVector(user.values, VA, 'user.values');
  const rows = characters.map((c, i) => {
    const Pshape = shapeSim(user.personality, c.personality, PA);
    const Sshape = shapeSim(user.style, c.style, SA);
    const Vshape = shapeSim(user.values, c.values, VA);
    const raw = W.P * Pshape + W.S * Sshape + W.V * Vshape;
    return { name: c.name, canonicalIndex: i, Pshape, Sshape, Vshape, raw, display: Math.round(raw * 100) };
  });
  rows.sort((a, b) => (b.raw - a.raw) || (b.Pshape - a.Pshape) || (b.Sshape - a.Sshape) || (b.Vshape - a.Vshape) || (a.canonicalIndex - b.canonicalIndex));
  return rows;
}

module.exports = { HIDDEN_MODEL, shapeSim, hiddenShape };
