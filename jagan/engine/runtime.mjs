// jagan/engine/runtime.mjs — 画面・API・保存が使う結果の形（judge.mjs の計算結果に、順位・整数表示・版を付ける）。
//   ・計算は judge.mjs（仕様の runtime.mjs と同じ）。ここでは式を変えない。
//   ・人物の「一致度」は補正を足す前の近さ（match）。選定には固定補正を使う（人物の出現の偏りを抑えるため）。
//   ・同じ50回答は、結果ID・時刻・人数によらず同じ結果になる。
import { judge, rankTraits, ENGINE_VERSION } from './judge.mjs';

export { ENGINE_VERSION };
export const RESULT_SCHEMA_VERSION = 'jagan-result-2';
const EPS = 1e-8;

export function validateBundle(bundle) {
  if (!bundle || !bundle.items || !bundle.core || !bundle.characters || !bundle.product) throw new Error('missing_bundle');
  const { items, core, characters, product } = bundle;
  if (items.diagnosis_key !== 'jagan' || items.items.length !== 50 || items.traits.length !== 12) throw new Error('invalid_item_set');
  if (items.auxiliary_options.length || items.allow_skip || items.intro_screen) throw new Error('invalid_item_options');
  if (characters.characters.length !== 11) throw new Error('invalid_character_model');
  const ids = characters.characters.map((c) => c.id);
  if (new Set(ids).size !== 11 || !ids.includes('pierro') || !ids.includes('pantalone')) throw new Error('invalid_character_roster');
  for (const e of core.elements) if (Math.abs(Object.values(e.weights).reduce((s, x) => s + x, 0) - 1) > 1e-9) throw new Error('invalid_element_weights');
  if (product.sales_open && (!Number.isInteger(product.price) || product.price <= 0)) throw new Error('sales_require_valid_price');
  return true;
}

function ranked(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const first = rows.findIndex((r) => Math.abs(r.score - rows[i].score) < EPS);
    out.push({ ...rows[i], rank: first + 1, displayScore: Math.round(rows[i].score) });
  }
  return out;
}

export function computeDiagnosis(input, bundle) {
  validateBundle(bundle);
  if (!input || input.itemSetVersion !== bundle.items.item_set_version) throw new Error('item_set_version_mismatch');
  const j = judge(input.answers, bundle);
  const traitRanking = ranked(rankTraits(j.scores, bundle.items));
  const traits = Object.fromEntries(bundle.items.traits.map((t) => [t.id, { id: t.id, label: t.label, score: j.scores[t.id], displayScore: Math.round(j.scores[t.id]) }]));
  const elementRanking = ranked(j.elementRanking);
  const element = { status: j.element.id ? 'available' : 'undifferentiated', id: j.element.id, label: j.element.label, nearTie: Boolean(j.element.nearTie), tiedIds: j.element.tiedIds || [], top3: elementRanking.slice(0, 3).map((e) => e.id), ranking: elementRanking };
  const isou = { status: j.isou.id ? 'marked' : (j.isou.label === '未顕' ? 'unmarked' : 'composite'), id: j.isou.id, label: j.isou.label, nearTie: Boolean(j.isou.nearTie), tiedIds: j.isou.tiedIds || [] };
  const characterOrder = j.privateDiagnostics.characterRanking.map((c) => ({ id: c.id, name: c.name, rawSimilarity: c.score, displayScore: Math.round(c.score), agreement: c.agreement, coverage: c.coverage, usedAxes: c.usedAxes }));
  const character = j.character
    ? { status: 'available', id: j.character.id, name: j.character.name, title: j.character.title, tags: j.character.tags, region: j.character.region, match: j.character.match, rawSimilarity: j.character.rawSimilarity, usedAxes: j.character.usedAxes, rawGap: j.character.rawGap, agreement: characterOrder.find((c) => c.id === j.character.id).agreement, coverage: characterOrder.find((c) => c.id === j.character.id).coverage }
    : { status: 'insufficient', reason: 'mapped_profile_contrast_too_small' };
  return {
    schemaVersion: RESULT_SCHEMA_VERSION, diagnosisKey: 'jagan', stage: 'implementation_candidate', publicReleaseVerified: false,
    resultId: input.resultId ?? null,
    versions: { engine: ENGINE_VERSION, itemSet: bundle.items.item_set_version, scoring: bundle.core.version, interpretation: bundle.core.version, characterModel: bundle.characters.version },
    answers: Object.fromEntries(bundle.items.items.map((i) => [i.id, input.answers[i.id]])),
    traits, traitRanking, element, isou, character, characterOrder, mappedSpread: j.privateDiagnostics.mappedSpread,
    // 設定の値のみ。購入の可否は必ずサーバーが別に確かめる
    sales: { open: bundle.product.sales_open, price: bundle.product.price, currency: bundle.product.currency },
  };
}

// 人物の参照軸（作者が置いた対応）とあなたの得点の差。未対応の軸は中立値で補わず、比較に含めない
export function explainCharacter(result, bundle, characterId = result.character.id) {
  const c = bundle.characters.characters.find((x) => x.id === characterId);
  if (!c) return { status: 'unavailable', aligned: [], different: [], unknownAxes: [] };
  const rows = Object.entries(c.anchors).map(([axis, ref]) => ({ axis, userScore: result.traits[axis].score, referenceScore: ref, difference: Math.abs(result.traits[axis].score - ref) }));
  return {
    status: 'available', characterId, rows,
    aligned: rows.filter((x) => x.difference <= 15).sort((a, b) => a.difference - b.difference),
    different: rows.filter((x) => x.difference >= 20).sort((a, b) => b.difference - a.difference),
    unknownAxes: c.unknown_axes,
    caution: '比較先は作品解釈から作った部分的な参照です。未対応の特性は比較に含めていません。',
    thresholdMeaning: '15点・20点は説明を作るための設計値で、心理学上の基準ではありません。',
  };
}

// 公開してよい値の許可リスト。回答・12特性の得点・結果ID・所有者は含めない
export function publicSummary(result) {
  if (!result || result.character.status !== 'available') throw new Error('result_not_shareable');
  return {
    kind: 'jagan-public-summary-2',
    element: { id: result.element.id, label: result.element.label },
    isou: { id: result.isou.id, label: result.isou.label },
    character: { id: result.character.id, label: result.character.name, matchPercent: result.character.match },
    coreVersion: result.versions.interpretation, characterModelVersion: result.versions.characterModel,
  };
}

export function shareTextFromSummary(s, url) {
  return `邪眼診断をやってみました。\n私の結果は、【${s.element.label}×${s.isou.label}】\n\n最も近しいファトゥス：${s.character.label}（${s.character.matchPercent}%一致）\n\n${url}\n#邪眼診断 #原神`;
}

export function makeShareText(result, summaryUrl, siteOrigin) {
  const url = new URL(summaryUrl), origin = new URL(siteOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
    url.origin !== origin.origin || url.username || url.password || url.search || url.hash ||
    !/^\/jagan\/s\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname)) throw new Error('invalid_share_url');
  return shareTextFromSummary(publicSummary(result), url.href);
}
