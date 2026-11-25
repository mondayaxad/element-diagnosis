// scripts/woff-cmap.js
// WOFF（1.0）フォントに収録された文字（Unicode のコードポイント）の一覧を返す。依存パッケージなし（Node の zlib だけ）。
//   OGP 画像の生成（scripts/build-ogp-type-cards.mjs）とテスト（tests/seo_type_meta.test.js）が、
//   「カードに出す文字がすべて同梱フォントにあるか」を確かめるのに使う（欠けると @vercel/og が外部から代替フォントを読みに行くため）。
'use strict';
const zlib = require('zlib');

function tables(buf) {
  if (buf.toString('ascii', 0, 4) !== 'wOFF') throw new Error('WOFF 1.0 ではありません');
  const n = buf.readUInt16BE(12);
  const out = {};
  for (let i = 0; i < n; i++) {
    const p = 44 + i * 20;
    const tag = buf.toString('ascii', p, p + 4);
    const off = buf.readUInt32BE(p + 4), comp = buf.readUInt32BE(p + 8), orig = buf.readUInt32BE(p + 12);
    const raw = buf.subarray(off, off + comp);
    out[tag] = comp < orig ? zlib.inflateSync(raw) : raw;
  }
  return out;
}

function codepoints(buf) {
  const cmap = tables(buf).cmap;
  if (!cmap) throw new Error('cmap がありません');
  const n = cmap.readUInt16BE(2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const p = 4 + i * 8;
    subs.push({ pid: cmap.readUInt16BE(p), eid: cmap.readUInt16BE(p + 2), off: cmap.readUInt32BE(p + 4) });
  }
  const set = new Set();
  for (const s of subs) {
    const t = cmap.subarray(s.off);
    const fmt = t.readUInt16BE(0);
    if (fmt === 12) {
      const groups = t.readUInt32BE(12);
      for (let g = 0; g < groups; g++) {
        const q = 16 + g * 12;
        const start = t.readUInt32BE(q), end = t.readUInt32BE(q + 4);
        for (let c = start; c <= end; c++) set.add(c);
      }
    } else if (fmt === 4) {
      const segX2 = t.readUInt16BE(6), seg = segX2 / 2;
      const endAt = 14, startAt = endAt + segX2 + 2, deltaAt = startAt + segX2, rangeAt = deltaAt + segX2;
      for (let i = 0; i < seg; i++) {
        const end = t.readUInt16BE(endAt + i * 2), start = t.readUInt16BE(startAt + i * 2);
        const delta = t.readInt16BE(deltaAt + i * 2), ro = t.readUInt16BE(rangeAt + i * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid;
          if (ro === 0) gid = (c + delta) & 0xffff;
          else {
            const gp = rangeAt + i * 2 + ro + (c - start) * 2;
            gid = t.readUInt16BE(gp);
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
          if (gid !== 0) set.add(c);
        }
      }
    }
  }
  return set;
}

// text の中で、フォントに無い文字（半角スペース・改行だけは除く。全角スペースなどは字形が要るので数える）
function missingChars(buf, text) {
  const cps = codepoints(buf);
  return [...new Set([...text])].filter((ch) => ch !== ' ' && ch !== '\n' && !cps.has(ch.codePointAt(0)));
}

module.exports = { codepoints, missingChars };
