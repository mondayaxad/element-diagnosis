// lib/jagan-og-params.mjs — 共有カード（api/jagan-og.mjs）の URL の値の検査。列挙値と整数だけを受け付ける。
//   e：邪眼元素の ID（未分化は NONE）／t：異相（特性の ID。未顕は NONE、複合は MIX）／c：人物の ID／m：一致度（整数）
import { BUNDLE } from '../jagan/engine/data.mjs';

const ELEMENTS = Object.fromEntries(BUNDLE.core.elements.map((e) => [e.id, e.label]));
const TRAITS = Object.fromEntries(BUNDLE.items.traits.map((t) => [t.id, t.label]));
const CHARS = Object.fromEntries(BUNDLE.characters.characters.map((c) => [c.id, c.name]));

export function parseOg(searchParams) {
  const e = searchParams.get('e'), t = searchParams.get('t'), c = searchParams.get('c'), m = searchParams.get('m');
  if (!(e === 'NONE' || ELEMENTS[e]) || !(t === 'NONE' || t === 'MIX' || TRAITS[t]) || !CHARS[c] || !/^\d{1,3}$/.test(m || '') || Number(m) > 100) return null;
  return {
    element: e === 'NONE' ? '未分化' : ELEMENTS[e],
    isou: t === 'NONE' ? '未顕' : t === 'MIX' ? '複合' : TRAITS[t],
    character: CHARS[c], match: Number(m),
  };
}
