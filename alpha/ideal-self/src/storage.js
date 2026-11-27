// 「記憶の保存」に同意したときだけ、この端末のブラウザ内（localStorage）に保存する。サーバーには送らない。
const KEY = 'isa-alpha-phase1';

export function load() {
  try { const s = globalThis.localStorage && localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* 保存できない環境では何もしない */ }
}
