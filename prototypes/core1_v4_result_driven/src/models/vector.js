// vector.js — 派生モデル用の小さなベクトル演算（正本の式ではない派生モデル専用）。
'use strict';
function center(obj, axes) { const m = axes.reduce((a, k) => a + obj[k], 0) / axes.length; return axes.map((k) => obj[k] - m); }
function cosine(a, b) {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0)), nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return na === 0 || nb === 0 ? null : dot / (na * nb);
}
function assertVector(obj, axes, label) {
  axes.forEach((ax) => {
    const v = obj && obj[ax];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${label}: axis ${ax} is missing or not a finite number`);
  });
}
module.exports = { center, cosine, assertVector };
