// lib/jagan-og-params.mjs — 共有カード（api/jagan-og.mjs）の URL の値の検査と、表示名の解決。
//   e：邪眼元素の ID／t：異相の特性 ID（ANX など。表示コードは dti-types.json から）／c・m：人物の ID と一致度（人物保留なら無し）／v：版（キャッシュの鍵）
//   表示名・コード・呼び名は、許可された ID から dti-types.json と characters.json で解決する（URL の文字列をそのまま描かない）。
import { BUNDLE } from '../jagan/engine/data.mjs';
import { parseShareKey, parseAnswerShareKey, computeDiagnosis, publicSummary } from '../jagan/engine/runtime.mjs';

// カードの固定文言（フォントの部分集合を作るときにも使う）
export const OG_FIXED_TEXT = ['邪眼診断', 'MY RESULT', 'DTI', 'Delusion Type Indicator', 'あなたのファトゥス', '一致', '邪眼', '異相',
  'あなたの深淵', 'あなたの願いは、どんな深淵を映すのか。', '邪眼タイプ指標', '#邪眼診断'];

export function parseOg(searchParams) {
  let e = searchParams.get('e'), t = searchParams.get('t'), c = searchParams.get('c'), m = searchParams.get('m');
  // 投稿用の短い形（k=）：DTIコード・人物・一致度・版を表から解決し、従来の値に置き換えて同じ検査を通す
  // 回答を載せた形（/j/<21文字>）：回答から結果を計算し、公開してよい値（邪眼・異相・人物・一致度）だけを使う
  const ak = searchParams.has('k') ? parseAnswerShareKey(searchParams.get('k')) : null;
  if (ak) {
    let s;
    try { s = publicSummary(computeDiagnosis({ answers: ak.answers, itemSetVersion: ak.itemSetVersion, resultId: null }, BUNDLE)); } catch { return null; }
    e = s.element.id; t = s.isou.id; c = s.character ? s.character.id : null; m = s.character ? String(s.character.matchPercent) : null;
  } else if (searchParams.has('k')) {
    const k = parseShareKey(searchParams.get('k'));
    const p = k && BUNDLE.dti.patterns.find((x) => x.code === k.code);
    if (!p) return null;
    e = p.element_id; t = p.trait_id; c = k.character ? k.character.id : null; m = k.character ? String(k.character.match) : null;
  }
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
