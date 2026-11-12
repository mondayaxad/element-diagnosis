// jagan/analytics.mjs — GA4 の「診断の傾向」イベント（元素診断の diagnosis_profile と同じ考え方）。
//   診断を最後まで終えた時（新しい結果だけ・保存した結果の再表示では送らない）に、結果の要約を1つのイベントで送る。
//   12特性の得点は10点刻みに丸める（回答・正確な得点へは戻せない）。回答・結果 ID・共有 URL は送らない。
//   パラメータ名は元素診断のもの（element など）と分ける（同じ名前に違う意味の値を混ぜない）。
export const PROFILE_EVENT = 'jagan_profile';
export const TRAIT_PARAM = (id) => `jt_${id}`; // 例：jt_SEP（依存）
const band = (v) => Math.max(0, Math.min(100, Math.round(Number(v) / 10) * 10));
export function profileParams(result) {
  if (!result || !result.traits || !result.element || !result.isou || !result.dti) return null;
  const p = {
    diagnosis_type: 'jagan',
    jagan_element: result.element.label,   // 邪眼（炎・水 など）
    jagan_isou: result.isou.label,         // 異相（依存・猜疑 など）
    jagan_dti: result.dti.code,            // DTI（HYDP など・84通り）
    jagan_fatui: result.character && result.character.status === 'available' ? result.character.name : '保留',
    fatui_match: result.character && result.character.status === 'available' ? band(result.character.match) : -1,
  };
  for (const [id, t] of Object.entries(result.traits)) p[TRAIT_PARAM(id)] = band(t.score);
  return p;
}
