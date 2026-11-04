// lib/jagan-og-params.mjs — 共有カード（api/jagan-og.mjs）の URL の値の検査と、表示名の解決。
//   e：邪眼元素の ID／t：異相の特性 ID（ANX など。表示コードは dti-types.json から）／c・m：人物の ID と一致度（人物保留なら無し）／v：版（キャッシュの鍵）
//   表示名・コード・呼び名は、許可された ID から dti-types.json と characters.json で解決する（URL の文字列をそのまま描かない）。
import { BUNDLE } from '../jagan/engine/data.mjs';

// カードの固定文言（フォントの部分集合を作るときにも使う）
export const OG_FIXED_TEXT = ['邪眼診断', 'MY RESULT', 'DTI', 'Delusion Type Indicator', '最も近しいファトゥス', '一致', '邪眼', '異相',
  'あなたの深淵', 'あなたの願いは、どんな深淵を映すのか。', '邪眼タイプ指標', '#邪眼診断'];

export function parseOg(searchParams) {
  const e = searchParams.get('e'), t = searchParams.get('t'), c = searchParams.get('c'), m = searchParams.get('m');
  const el = BUNDLE.core.elements.find((x) => x.id === e);
  const asp = BUNDLE.dti.aspects.find((x) => x.trait_id === t);
  if (!el || !asp) return null;
  const p = BUNDLE.dti.patterns.find((x) => x.element_id === el.id && x.trait_id === asp.trait_id);
  let character = null;
  if (c !== null || m !== null) {
    const ch = BUNDLE.characters.characters.find((x) => x.id === c);
    if (!ch || !/^\d{1,3}$/.test(m || '') || Number(m) > 100) return null;
    character = { id: ch.id, name: ch.name, match: Number(m) };
  }
  return { element: el.label, elementId: el.id, isou: asp.label, isouId: asp.trait_id, code: p.code, name: p.name, character };
}
