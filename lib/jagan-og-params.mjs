// lib/jagan-og-params.mjs — 共有カード（api/jagan-og.mjs）の URL の値の検査。列挙値と整数だけを受け付ける。
import { BUNDLE } from '../jagan/engine/data.mjs';

const ELEMENTS = Object.fromEntries(BUNDLE.interpretation.elements.map((e) => [e.id, e.label]));
const TYPES = Object.fromEntries(BUNDLE.interpretation.types.map((t) => [t.id, t.label]));
const CHARS = Object.fromEntries(BUNDLE.characters.characters.map((c) => [c.id, c.name]));

export function parseOg(searchParams) {
  const e = searchParams.get('e'), t = searchParams.get('t'), c = searchParams.get('c'), m = searchParams.get('m');
  const x = Number(searchParams.get('x') || 0);
  if (!ELEMENTS[e] || !(t === 'NONE' || TYPES[t]) || !CHARS[c] || !/^\d{1,3}$/.test(m || '') || Number(m) > 100 || !(x >= 0 && x <= 7)) return null;
  return { element: ELEMENTS[e], type: t === 'NONE' ? '型の偏りなし' : TYPES[t], character: CHARS[c], match: Number(m), ties: x };
}

