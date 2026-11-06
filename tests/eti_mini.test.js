// 元素診断 Mini（Phase A）の試験。docs/eti-mini/handoff_v1/README_Claude_実装指示書.md §7 の必須試験のうち、
// 購入・決済を含まない範囲（固定割当・入力検証・表示辞書・手動選択の未接続・本家との整合）を確かめる。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MAP_JSON = JSON.parse(read('docs/eti-mini/handoff_v1/data/eti_mini_758_5star_280_mapping.json'));
const CAND_JSON = JSON.parse(read('docs/eti-mini/handoff_v1/data/eti_mini_auto_candidates_v1.json'));
const CHARS = require('../js/characters118_v2_1.js');

// 共鳴診断のページ（resonance.html。旧 mini.html）が読み込む JS（この順）
const PAGE_SCRIPTS = ['js/characters118_v2_1.js', 'js/eti_mini_auto_map_v1.js', 'js/eti_v2_prototypes.js', 'js/eti_mini_choices_v1.js', 'js/eti_mini_core.js', 'js/eti_mini_share.js', 'js/resonance_candidates.js'];
// 試験用の読み込み：ページと同じ JS に、保存しておく 50:50 の結合エンジン（共鳴診断のページは読み込まない）を足したもの
const MINI_SCRIPTS = ['js/characters118_v2_1.js', 'js/eti_mini_auto_map_v1.js', 'js/eti_v2_prototypes.js', 'js/eti_mini_choices_v1.js', 'js/eti_mini_core.js', 'js/eti_mini_manual_v1.js'];
function loadMini({ withManual = true } = {}) {
  const ctx = {};
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  // classic script と同じく1つのスクリプトとして連結する（js/eti_v2_prototypes.js の const を他のファイルから参照できるように）
  const files = MINI_SCRIPTS.filter((f) => withManual || f !== 'js/eti_mini_manual_v1.js');
  vm.runInContext(files.map(read).join('\n;\n'), ctx, { filename: 'mini-scripts.js' });
  return ctx;
}
const ctx = loadMini();
const M = ctx.ETIMini;
const MAP = ctx.ETI_MINI_AUTO_MAP_V1;
const Q = ctx.ETI_MINI_CHOICES;
// vm の別のコンテキストで作ったオブジェクトは deepStrictEqual でプロトタイプが違うと判定されるので、値だけを比べる
const plain = (x) => JSON.parse(JSON.stringify(x));
const all280 = () => {
  const out = [];
  for (const element of M.ELEMENT_KEYS) for (const weapon of M.WEAPON_KEYS) for (const nation of M.NATION_KEYS) out.push({ element, weapon, nation });
  return out;
};

// index.html の const を、そのまま評価して取り出す（写しが本家とずれていないかの確認用）
function constFrom(file, name) {
  const text = read(file);
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*').exec(text);
  assert.ok(m, `${file} に ${name} がありません`);
  let i = m.index + m[0].length, depth = 0, j = i, str = null;
  for (; j < text.length; j++) {
    const ch = text[j];
    if (str) { if (ch === '\\') { j++; continue; } if (ch === str) str = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return vm.runInNewContext('(' + text.slice(i, j + 1) + ')');
}

test('公開用の割当データは正本 JSON から生成したものと一致する（sha256 固定）', () => {
  const B = require('../scripts/build-eti-mini-data.js');
  assert.equal(read(B.OUT), B.render());
  assert.equal(MAP.sourceSha256, B.MAP_SHA256);
  assert.equal(MAP.version, MAP_JSON.version);
  assert.equal(MAP.status, 'DESIGN_CANDIDATE_PENDING_FINAL_APPROVAL');
});

test('監査専用の値（internal_rank・internal_regret_pp）を公開データに含めない', () => {
  assert.deepEqual(Object.keys(MAP).sort(), ['candidateCount', 'candidateListSha256', 'candidates', 'rows', 'sourceSha256', 'status', 'version']);
  for (const v of Object.values(MAP.rows)) assert.equal(typeof v, 'string');
  const pub = read('js/eti_mini_auto_map_v1.js').split('\n').filter((l) => !l.startsWith('//')).join('\n');
  assert.doesNotMatch(pub, /internal_rank|internal_regret|regret|"rank"/);
});

test('280 通りすべてに結果があり、正本の割当と一致する', () => {
  const byKey = Object.fromEntries(MAP_JSON.rows.map((r) => [r.key, r.mirror_character]));
  const combos = all280();
  assert.equal(combos.length, 280);
  assert.equal(Object.keys(MAP.rows).length, 280);
  for (const a of combos) {
    const r = M.autoResult(a);
    assert.equal(r.character.name, byKey[`${a.element}|${a.weapon}|${a.nation}`]);
    assert.equal(r.character.selectedBy, 'auto');
    // 結果の ETI は回答のまま（キャラクターの属性へ寄せない）
    assert.deepEqual([r.element, r.weapon, r.nation], [a.element, a.weapon, a.nation]);
  }
});

test('自動候補：66名すべてが4〜5回（50名×4・16名×5）、候補外・除外対象なし、全員が座標DBに存在', () => {
  const counts = {};
  for (const a of all280()) { const n = M.autoResult(a).character.name; counts[n] = (counts[n] || 0) + 1; }
  const cand = new Set(CAND_JSON.candidate_names);
  assert.equal(cand.size, 66);
  assert.deepEqual(new Set(Object.keys(counts)), cand);
  const hist = {};
  Object.values(counts).forEach((c) => { hist[c] = (hist[c] || 0) + 1; });
  assert.deepEqual(hist, { 4: 50, 5: 16 });
  for (const ex of ['主人公', 'ドール', 'アーロイ']) assert.ok(!cand.has(ex));
  const db = new Set(CHARS.map((c) => c.name));
  for (const n of cand) assert.ok(db.has(n), `${n} が ETI-CHAR-2.1.0 にありません`);
  assert.deepEqual(plain(MAP.candidates), CAND_JSON.candidate_names);
});

test('同じ入力なら常に同じ結果（再抽選しない）', () => {
  for (const a of all280()) assert.deepEqual(plain(M.autoResult(a)), plain(M.autoResult({ ...a })));
  const again = loadMini().ETIMini;
  for (const a of all280()) assert.deepEqual(plain(again.autoResult(a)), plain(M.autoResult(a)));
});

test('未回答・辞書に無い値は結果を出さずに止める', () => {
  const ok = { element: '炎', weapon: '弓', nation: 'モンド' };
  const bad = [{}, null, { ...ok, element: null }, { ...ok, weapon: '大剣' }, { ...ok, nation: 'ナド・クライ' }, { ...ok, nation: 'カーンルイア' }, { element: 0, weapon: 1, nation: 2 }];
  for (const a of bad) assert.throws(() => M.autoResult(a), (e) => e.code === 'INVALID_ANSWERS');
});

test('割当表に無い key は明示的なエラー', () => {
  const c = loadMini();
  c.ETI_MINI_AUTO_MAP_V1 = { rows: {} };
  assert.throws(() => c.ETIMini.autoResult({ element: '炎', weapon: '弓', nation: 'モンド' }), (e) => e.code === 'AUTO_MAP_KEY_MISSING');
});

test('国家：内部キーは「ナドクライ」、画面表記は「ナド・クライ」、意味は「月光」', () => {
  const r = M.autoResult({ element: '水', weapon: '法器', nation: 'ナドクライ' });
  assert.equal(r.nation, 'ナドクライ');
  assert.equal(r.nationDisplay, 'ナド・クライ');
  assert.equal(r.words.nationMeaning, '月光');
  assert.equal(r.typeCode, 'HYCT-D');
  for (const n of M.NATION_KEYS.filter((x) => x !== 'ナドクライ')) assert.equal(M.displayNation(n), n);
});

test('35タイプ名・コード・国家コード・短い言葉は index.html の正本と一致する', () => {
  assert.deepEqual(plain(M.TYPE_NAME), plain(constFrom('index.html', 'TYPE_NAME')));
  assert.deepEqual(plain(M.ELEMENT_CODE), plain(constFrom('index.html', 'ELEMENT_CODE')));
  assert.deepEqual(plain(M.WEAPON_CODE), plain(constFrom('index.html', 'WEAPON_CODE')));
  assert.deepEqual(plain(M.NATION_CODE), plain(constFrom('index.html', 'NATION_CODE')));
  assert.deepEqual(plain(M.NATION_MEANING), plain(constFrom('index.html', 'NATION_MEANING')));
  const EL = constFrom('index.html', 'ELEMENTS'), W = constFrom('index.html', 'WEAPONS');
  for (const e of M.ELEMENT_KEYS) assert.equal(M.ELEMENT_KEYWORD[e], EL[e].keyword);
  for (const w of M.WEAPON_KEYS) assert.equal(M.WEAPON_STYLE[w], W[w].style);
  const names = new Set(), codes = new Set();
  for (const e of M.ELEMENT_KEYS) for (const w of M.WEAPON_KEYS) {
    const t = M.describeType(e, w, 'モンド');
    names.add(t.typeName); codes.add(t.typeCode4);
    assert.ok(fs.existsSync(path.join(ROOT, t.typePage.slice(1) + '.html')), `${t.typePage} が無い`);
  }
  assert.equal(names.size, 35); assert.equal(codes.size, 35);
  // 元素・武器・国家の並び（内部キー）は本家のプロトタイプ表と同じ集合
  const P = require('../js/eti_v2_prototypes.js');
  assert.deepEqual(plain(M.ELEMENT_KEYS), Object.keys(P.ELEMENT_PROTOTYPES_V2));
  assert.deepEqual(plain(M.WEAPON_KEYS), Object.keys(P.WEAPON_PROTOTYPES_V2));
  assert.deepEqual(plain(M.NATION_KEYS), Object.keys(P.NATION_PROTOTYPES_V2));
});

test('手動選択：結合式が差し込まれるまで結果を仮計算しない', () => {
  const c = loadMini({ withManual: false }).ETIMini;
  assert.equal(c.isManualSelectionReady(), false);
  const ch = CHARS.find((x) => x.name === 'ナヒーダ');
  assert.throws(() => c.manualResult({ element: '炎', weapon: '弓', nation: 'モンド' }, ch), (e) => e.code === 'MANUAL_SELECTION_NOT_CONFIGURED');
  // 入力の検証は結合より先に行う
  assert.throws(() => c.manualResult({}, ch), (e) => e.code === 'INVALID_ANSWERS');
  assert.throws(() => c.manualResult({ element: '炎', weapon: '弓', nation: 'モンド' }, null), (e) => e.code === 'INVALID_CHARACTER');
});

test('手動選択：差し込み口の形（試験用の仮の結合。本番の式ではない）', () => {
  const c = loadMini({ withManual: false }).ETIMini;
  c.setManualCombiner(({ answers }) => ({ ...answers, version: 'TEST-ONLY' }));
  const ch = CHARS.find((x) => x.name === 'ナヒーダ');
  const r = c.manualResult({ element: '炎', weapon: '弓', nation: 'モンド' }, ch);
  assert.equal(r.character.name, 'ナヒーダ');
  assert.equal(r.character.selectedBy, 'user');
  assert.equal(r.versions.manualCombiner, 'TEST-ONLY');
  c.setManualCombiner(() => ({ element: '炎', weapon: '弓', nation: 'モンド' }));
  assert.throws(() => c.manualResult({ element: '炎', weapon: '弓', nation: 'モンド' }, ch), (e) => e.code === 'MANUAL_COMBINER_INVALID');
  c.setManualCombiner(() => ({ element: '光', weapon: '弓', nation: 'モンド', version: 'x' }));
  assert.throws(() => c.manualResult({ element: '炎', weapon: '弓', nation: 'モンド' }, ch), (e) => e.code === 'INVALID_ANSWERS');
});

test('選択肢（正式版）：正本 JSON から生成、7・5・8、内部キー（本家の並び）、label・detail あり', () => {
  const B = require('../scripts/build-eti-mini-data.js');
  assert.equal(read(B.CHOICES_OUT), B.renderChoices());
  assert.equal(Q.version, 'ETI-MINI-CHOICES-1.0.0');
  const [q1, q2, q3] = Q.questions;
  assert.deepEqual(plain([q1.id, q2.id, q3.id]), ['element', 'weapon', 'nation']);
  assert.deepEqual(plain(q1.options.map((o) => o.key)), plain(M.ELEMENT_KEYS));
  assert.deepEqual(plain(q2.options.map((o) => o.key)), plain(M.WEAPON_KEYS));
  assert.deepEqual(plain(q3.options.map((o) => o.key)), plain(M.NATION_KEYS));
  for (const q of Q.questions) {
    assert.ok(q.title && q.helper);
    const labels = new Set();
    for (const o of q.options) { assert.ok(o.label && o.detail, `${q.id}/${o.key}`); labels.add(o.label); }
    assert.equal(labels.size, q.options.length, `${q.id} の見出しが重複`);
  }
});

test('選択肢の表示（共鳴診断）：見出し＋一文だけ（属性名を出さない）、固定の混ぜ順（本家の順でも乱数でもない）、回答は内部キー', () => {
  const html = read('resonance.html');
  assert.match(html, /answers\[q\.id\] = o\.key/); // 位置ではなく内部キーで保持
  assert.match(html, /t\.textContent = o\.label/);
  assert.match(html, /d\.textContent = o\.detail/);
  assert.match(html, /b\.appendChild\(t\); b\.appendChild\(d\);/);
  assert.doesNotMatch(html, /opt-name|displayNation\(o\.key\)|CATEGORY/); // 名前・区分は出さない
  assert.doesNotMatch(html, /Math\.random|shuffle/);
  const order = vm.runInNewContext('(' + /var FIXED_ORDER = (\{[\s\S]*?\});/.exec(html)[1] + ')');
  for (const [id, keys] of [['element', M.ELEMENT_KEYS], ['weapon', M.WEAPON_KEYS], ['nation', M.NATION_KEYS]]) {
    assert.deepEqual([...order[id]].sort(), plain(keys).sort(), id); // 内部キーをちょうど1回ずつ
    assert.notDeepEqual(Array.from(order[id]), plain(keys), id); // 本家の並びではない
  }
  assert.match(html, /FIXED_ORDER\[q\.id\]\.forEach/);
  // 選択肢の文言に属性名を含まない（正本 JSON の見出し・一文）。「アナタ」は国家名「ナタ」を文字列として含むので除いて照合
  const names = [...M.ELEMENT_KEYS, ...M.WEAPON_KEYS, ...M.NATION_KEYS, 'ナド・クライ'];
  for (const q of Q.questions) for (const o of q.options) for (const t of [o.label, o.detail]) for (const n of names) assert.ok(!t.replace(/アナタ/g, '').includes(n), `「${t}」に「${n}」`);
});

test('resonance.html：点数・一致率・順位を出さない／本家の CTA が最下部／人物は登録118名から', () => {
  const html = read('resonance.html');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.doesNotMatch(html, /mirrorScore|internal_rank|regret|一致率|一致度|スコア|％|%<\//);
  const cta = html.indexOf('元素診断で、もっと深く自分を知る');
  const report = html.indexOf('人物像レポート</h2>');
  assert.ok(cta > 0 && report > 0 && cta > report, '本家への案内は Mini のレポート案内より下');
  assert.match(html, /100問/);
  assert.match(html, /基本無料/);
  assert.match(html, /ETI_V2_CHARACTERS_2_1_0\.map/);
  assert.match(html, /QUESTION 0/); // 問いの見出しは中立な表記
  assert.doesNotMatch(html, /心理学的|測定された/);
  for (const f of PAGE_SCRIPTS) assert.ok(html.includes(`<script src="${f}"></script>`), f);
  // 50:50 の結合エンジンは保存するが、共鳴診断のページは読み込まない（選んだ人物で 758 を変えない）
  assert.doesNotMatch(html, /eti_mini_manual_v1\.js|manualResult|setManualCombiner/);
  // 旧版のキャラクター配列（index.html の CHARACTERS・2.0.1）を使わない
  assert.doesNotMatch(html, /characters118_v2\.js|ETI_V2_CHARACTERS\b(?!_2_1_0)/);
  assert.equal(CHARS.length, 118);
  // 購入の導線が無い（Phase A）
  assert.doesNotMatch(html, /checkout|stripe/i);
  // 呼ぶ API はシェア専用の /api/share（本家と同じ。リンクを作るだけ）だけ
  assert.deepEqual([...new Set(html.match(/\/api\/[a-z-]+/g) || [])], ['/api/share']);
});

test('配信：共鳴診断のページと JS は許可リストにあり、正本 JSON（docs）は配信しない', () => {
  const B = require('../scripts/build-public.js');
  for (const f of ['resonance.html', ...PAGE_SCRIPTS]) {
    assert.ok(B.PUBLIC_FILES.includes(f), f);
  }
  assert.ok(B.forbiddenIn(['docs/eti-mini/handoff_v1/data/eti_mini_758_5star_280_mapping.json']).length > 0);
});

test('resonance.html：本家と同じ夜の背景、1問ずつのページ送り（端末の戻るにも対応・動きを減らす設定に配慮）', () => {
  const html = read('resonance.html');
  assert.match(html, /\/assets\/backgrounds\/quiet-starry-lake\.jpg/);
  assert.match(html, /IM Fell English/);
  assert.match(html, /id="pCover"/);
  assert.match(html, /id="pQuestion"/);
  assert.match(html, /id="pChar"/);
  assert.match(html, /history\.pushState/);
  assert.match(html, /popstate/);
  assert.match(html, /prefers-reduced-motion/);
  const B = require('../scripts/build-public.js');
  assert.ok(B.PUBLIC_FILES.includes('assets/backgrounds/quiet-starry-lake.jpg'));
});
