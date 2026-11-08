// jagan/engine/runtime.mjs — 画面・API・保存が使う結果の形（DTI：邪眼元素×異相＝4文字コードと漢字三文字の呼び名）。
//   ・12特性の得点・人物の選定（固定の均等補正・保留条件）は judge.mjs（基礎 v0.3 の runtime と同じ計算）。
//   ・異相・邪眼元素は dti.mjs の規則で必ず一つずつ選ぶ（基礎 v0.3 の「未顕・複合・未分化」は使わない。2026-11-04 指示書）。
//   ・人物の「一致度」は補正を足す前の近さ（match）。一覧（characterOrder）も一致度の順。DTI のコード・呼び名は人物判定に使わない。
//   ・同じ50回答は、結果ID・時刻・人数・キー順によらず同じ結果になる。
import { judge, rankTraits, ENGINE_VERSION as JUDGE_VERSION } from './judge.mjs';
import { selectIsou, orderElements, dtiPattern } from './dti.mjs';

export const ENGINE_VERSION = 'jagan-engine-3.0.0-dti';
export { JUDGE_VERSION };
export const RESULT_SCHEMA_VERSION = 'jagan-result-3';
export const PUBLIC_SUMMARY_KIND = 'jagan-public-summary-3';
const EPS = 1e-8;

export function validateBundle(bundle) {
  if (!bundle || !bundle.items || !bundle.core || !bundle.characters || !bundle.product || !bundle.dti) throw new Error('missing_bundle');
  const { items, core, characters, product, dti } = bundle;
  if (items.diagnosis_key !== 'jagan' || items.items.length !== 50 || items.traits.length !== 12) throw new Error('invalid_item_set');
  if (items.auxiliary_options.length || items.allow_skip || items.intro_screen) throw new Error('invalid_item_options');
  if (characters.characters.length !== 11) throw new Error('invalid_character_model');
  const ids = characters.characters.map((c) => c.id);
  if (new Set(ids).size !== 11 || !ids.includes('pierro') || !ids.includes('pantalone')) throw new Error('invalid_character_roster');
  for (const e of core.elements) if (Math.abs(Object.values(e.weights).reduce((s, x) => s + x, 0) - 1) > 1e-9) throw new Error('invalid_element_weights');
  if (dti.patterns.length !== core.elements.length * items.traits.length) throw new Error('invalid_dti_patterns');
  if (product.sales_open && (!Number.isInteger(product.price) || product.price <= 0)) throw new Error('sales_require_valid_price');
  return true;
}

function ranked(rows) {
  return rows.map((r, i) => ({ ...r, rank: rows.findIndex((x) => Math.abs(x.score - r.score) < EPS) + 1, displayScore: Math.round(r.score) }));
}

export function computeDiagnosis(input, bundle) {
  validateBundle(bundle);
  if (!input || input.itemSetVersion !== bundle.items.item_set_version) throw new Error('item_set_version_mismatch');
  const j = judge(input.answers, bundle); // 回答の検査（50問すべて 1〜5 の整数）もここで行う
  const answers = Object.fromEntries(bundle.items.items.map((i) => [i.id, input.answers[i.id]]));
  const traitRanking = ranked(rankTraits(j.scores, bundle.items));
  const traits = Object.fromEntries(bundle.items.traits.map((t) => [t.id, { id: t.id, label: t.label, score: j.scores[t.id], displayScore: Math.round(j.scores[t.id]) }]));

  // 邪眼元素（必ず一つ）
  const elementRanking = orderElements(j.elementRanking, answers, bundle.items).map((e) => ({ ...e, displayScore: Math.round(e.score) }));
  const top = elementRanking[0];
  const element = { status: 'available', id: top.id, label: top.label, tieBreak: top.tied ? 'hash' : 'unique', top3: elementRanking.slice(0, 3).map((e) => e.id), ranking: elementRanking };

  // 異相（必ず一つ）
  const sel = selectIsou(answers, bundle.items);
  const aspect = bundle.dti.aspects.find((a) => a.trait_id === sel.id);
  const isou = { status: 'marked', id: sel.id, code: aspect.code, label: aspect.label, tieBreak: sel.tieBreak };

  const p = dtiPattern(bundle.dti, element.id, isou.id);
  const dti = { code: p.code, name: p.name, elementCode: p.element_id, aspectCode: p.aspect_code, namingVersion: bundle.dti.version };

  // 表示用の人物の並び（0.5.0）：表示する一致度（補正前の近さ）の高い順。丸め前の値で並べ、同点は ID 順。
  //   均等化の補正は「あなたのファトゥス」1名の選定にだけ使い、この並びには混ぜない（selected で示す）。
  const characterOrder = j.privateDiagnostics.characterRanking
    .map((c) => ({ id: c.id, name: c.name, rawSimilarity: c.score, displayScore: Math.round(c.score), agreement: c.agreement, coverage: c.coverage, usedAxes: c.usedAxes, selected: !!(j.character && j.character.id === c.id) }))
    .sort((a, b) => b.rawSimilarity - a.rawSimilarity || a.id.localeCompare(b.id));
  const winner = j.character && characterOrder.find((c) => c.id === j.character.id);
  const character = j.character
    ? { status: 'available', id: j.character.id, name: j.character.name, title: j.character.title, tags: j.character.tags, region: j.character.region, match: j.character.match, rawSimilarity: j.character.rawSimilarity, usedAxes: j.character.usedAxes, rawGap: j.character.rawGap, agreement: winner.agreement, coverage: winner.coverage }
    : { status: 'insufficient', reason: 'mapped_profile_contrast_too_small' };

  return {
    schemaVersion: RESULT_SCHEMA_VERSION, diagnosisKey: 'jagan', system: 'DTI', stage: 'implementation_candidate', publicReleaseVerified: false,
    resultId: input.resultId ?? null,
    versions: { engine: ENGINE_VERSION, judge: JUDGE_VERSION, itemSet: bundle.items.item_set_version, scoring: bundle.core.version, interpretation: bundle.core.version, characterModel: bundle.characters.version, naming: bundle.dti.version },
    answers, traits, traitRanking, element, isou, dti, character, characterOrder, mappedSpread: j.privateDiagnostics.mappedSpread,
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
  };
}

// 公開してよい値の許可リスト。回答・12特性の得点・結果ID・所有者は含めない。人物を保留した結果も共有できる（人物は null）
export function publicSummary(result) {
  if (!result || result.schemaVersion !== RESULT_SCHEMA_VERSION) throw new Error('result_not_shareable');
  const ch = result.character.status === 'available' ? { id: result.character.id, label: result.character.name, matchPercent: result.character.match } : null;
  return {
    kind: PUBLIC_SUMMARY_KIND,
    element: { id: result.element.id, label: result.element.label },
    isou: { id: result.isou.id, code: result.isou.code, label: result.isou.label },
    dti: { code: result.dti.code, name: result.dti.name },
    character: ch,
    namingVersion: result.versions.naming, coreVersion: result.versions.interpretation, characterModelVersion: result.versions.characterModel,
  };
}

// 共有の URL（元素診断の共有と同じく、公開してよい結果だけを URL に載せる。DB に頼らずに OGP が出る）
//   /jagan/share?e=<邪眼元素ID>&t=<異相の特性ID>&c=<人物ID>&m=<一致度>&v=<呼び名の版>.<デザインの版>
//   回答・12特性の得点・結果ID は載せない。人物を保留した結果は c・m を付けない。
export const SHARE_PATH = '/jagan/share';
export const OG_DESIGN_VERSION = 'dti-og-2';
export function shareQuery(s) {
  const p = new URLSearchParams();
  p.set('e', s.element.id);
  p.set('t', s.isou.id);
  if (s.character) { p.set('c', s.character.id); p.set('m', String(s.character.matchPercent)); }
  p.set('v', `${s.namingVersion}.${OG_DESIGN_VERSION}`);
  return p.toString();
}
export function shareUrl(origin, s) { return `${origin}${SHARE_PATH}?${shareQuery(s)}`; }

// X の共有文（元素診断の共有文と同じ形）。人物を保留した結果は人物の行と人物のハッシュタグを省く
export function shareTextFromSummary(s, url) {
  const head = `私の結果は【${s.element.label} × ${s.isou.label}】`;
  const fat = s.character ? `\n最も近しいファトゥス：${s.character.label}（${s.character.matchPercent}%一致）` : '';
  const tags = ['#邪眼診断', `#${s.dti.code}`, ...(s.character ? [`#${s.character.label}`] : [])].join(' ');
  return `邪眼診断をやってみました。\n\n${head}${fat}\n\n${url}\n\n${tags}`;
}

export function makeShareText(result, summaryUrl, siteOrigin) {
  const url = new URL(summaryUrl), origin = new URL(siteOrigin);
  const s = publicSummary(result);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
    url.origin !== origin.origin || url.username || url.password || url.hash) throw new Error('invalid_share_url');
  const stateless = url.pathname === SHARE_PATH && url.search === `?${shareQuery(s)}`;
  const stored = /^\/jagan\/s\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname) && !url.search;
  if (!stateless && !stored) throw new Error('invalid_share_url');
  return shareTextFromSummary(s, url.href);
}
