// 共鳴診断｜人物像レポート（Phase C の C-1。販売 OFF）の試験：lib/resonance_report_v1.js
//   設計書 docs/eti-mini/phase_c/共鳴診断_PhaseC_設計指示書_v1.md §7「必須テスト」のうち、C-1 で確かめられるもの
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const R = require('../lib/resonance_report_v1.js');
const PROTO = require('../js/eti_v2_prototypes.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAP = require('../js/eti_mini_auto_map_v1.js');
const E = ['炎', '水', '氷', '雷', '風', '岩', '草'], W = ['片手剣', '両手剣', '長柄', '法器', '弓'];
const N = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
const ALL = []; for (const element of E) for (const weapon of W) for (const nation of N) ALL.push({ element, weapon, nation });
const PURCHASE = { orderId: '00000000-0000-4000-8000-000000000000', createdAt: '2026-11-07T00:00:00.000Z' };

function engine() {
  const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js'].map(read).join('\n;\n') + ';globalThis.__E = { ETIv2, ETI_V2_META };', ctx);
  return ctx.__E;
}

test('1. 280 回答すべてが固定割当表と同じ人物を返し、66名がそれぞれ 4〜5 回', () => {
  const n = {};
  for (const a of ALL) {
    const m = R.modelVectors(a);
    assert.equal(m.mirror, MAP.rows[`${a.element}|${a.weapon}|${a.nation}`]);
    n[m.mirror] = (n[m.mirror] || 0) + 1;
  }
  assert.equal(Object.keys(n).length, 66);
  for (const [k, v] of Object.entries(n)) assert.ok(v === 4 || v === 5, k);
  assert.throws(() => R.modelVectors({ element: '光', weapon: '弓', nation: 'モンド' }), /INVALID_ANSWERS/);
});

test('2. 代表モデルの 5/5/10 軸は正本（eti_v2_prototypes）から、人物は ETI-CHAR-2.1.0 から再現される。軸の並びは本家 ETI_V2_META と同じ', () => {
  const { ETI_V2_META } = engine();
  assert.deepEqual(Array.from(ETI_V2_META.personalityAxes), R.AXES.persona);
  assert.deepEqual(Array.from(ETI_V2_META.styleAxes), R.AXES.style);
  assert.deepEqual(Array.from(ETI_V2_META.valueAxes), R.AXES.values);
  for (const a of ALL) {
    const m = R.modelVectors(a), ch = CHARS.find((c) => c.name === m.mirror);
    assert.deepEqual(m.you.persona, PROTO.ELEMENT_PROTOTYPES_V2[a.element]);
    assert.deepEqual(m.you.style, PROTO.WEAPON_PROTOTYPES_V2[a.weapon]);
    assert.deepEqual(m.you.values, PROTO.NATION_PROTOTYPES_V2[a.nation]);
    assert.deepEqual(m.char, { persona: ch.personality, style: ch.style, values: ch.values });
  }
});

test('3. pSim・sSim は RMSE、vSim だけ平均中心化コサイン。本家 computeMirrorV2 と 280 件で一致し、零ベクトルは 0.5', () => {
  const { ETIv2, ETI_V2_META } = engine();
  for (const a of ALL) {
    const m = R.modelVectors(a), an = R.analyze(m);
    const ch = CHARS.find((c) => c.name === m.mirror);
    const [row] = ETIv2.computeMirrorV2({ personality: m.you.persona, style: m.you.style, values: m.you.values }, [ch], ETI_V2_META);
    assert.equal(an.sims.persona, row.pSim);
    assert.equal(an.sims.style, row.sSim);
    assert.equal(an.sims.values, row.vSim);
    assert.ok(Math.abs(an.mirrorRef * 100 - row.mirrorScoreRaw) < 1e-9);
  }
  const flat = Object.fromEntries(R.AXES.values.map((k) => [k, 50]));
  assert.equal(R._internal.vSimOf(flat, CHARS[0].values), 0.5);
  const [z] = ETIv2.computeMirrorV2({ personality: CHARS[0].personality, style: CHARS[0].style, values: flat }, [CHARS[0]], ETI_V2_META);
  assert.equal(z.vSim, 0.5);
});

test('4. 図は実際の値から描き、見本のダミー図とは別物。図に数字（目盛り・値）を出さない', () => {
  const html = read('resonance.html');
  const seen = new Set();
  for (const a of ALL) {
    const s = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
    const svg = R.renderFigures(s.figures);
    for (const [k, v] of Object.entries(svg)) {
      const texts = [...v.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
      for (const t of texts) assert.doesNotMatch(t, /[0-9０-９%％]/, `${k}: ${t}`);
      assert.doesNotMatch(v, /<title|data-value|aria-valuenow/);
      assert.ok(!html.includes(v));
    }
    seen.add(svg.persona + svg.style + svg.values);
    // 選んだ元素は距離 0 で先頭（設計書§3-4 の既知の性質）
    assert.equal(s.figures.symbols.elements[0].key, a.element);
    assert.equal(s.figures.symbols.elements[0].bar, 1);
  }
  assert.ok(seen.size > 200, String(seen.size)); // 人ごとに図が変わる（同じ代表モデル×同じ人物の組み合わせだけ同じ）
});

test('5. 非購入者は有料の本文・描画データを取れない：計算器は lib/（公開しない）にあり、公開ページ・公開 API から読まれていない', () => {
  const B = require('../scripts/build-public.js');
  const forb = read('scripts/build-public.js');
  assert.match(forb, /\^\(docs\|tests\|prototypes\|lib\|scripts\|api/);
  assert.ok(!B.PUBLIC_FILES.some((f) => /resonance_report/.test(f)));
  for (const f of B.PUBLIC_FILES.filter((x) => /\.(html|js)$/.test(x) && fs.existsSync(path.join(ROOT, x)))) assert.doesNotMatch(read(f), /resonance_report/, f);
  for (const f of fs.readdirSync(path.join(ROOT, 'api')).filter((x) => /\.(m?js)$/.test(x))) assert.doesNotMatch(read('api/' + f), /resonance_report/, f);
});

test('6. 販売 OFF：共鳴診断の購入ボタンは押せず、Checkout を作る API は無い', () => {
  const html = read('resonance.html');
  assert.ok(html.includes('<button type="button" class="cta buy" id="buyBtn" disabled>'));
  assert.doesNotMatch(html, /checkout|stripe|fetch\(/i);
  assert.ok(!fs.readdirSync(path.join(ROOT, 'api')).some((f) => /resonance/i.test(f)));
  assert.doesNotMatch(read('api/complete-checkout.js'), /resonance/);
});

test('7. スナップショット：同じ入力なら同じ内容。再閲覧の表示は保存済みスナップショットだけから作る。金額・商品は固定、個人情報を持たない', () => {
  const a = { element: '氷', weapon: '法器', nation: 'ナドクライ' };
  const s1 = R.buildSnapshot(a, PURCHASE, { allowMissing: true }), s2 = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
  assert.deepEqual(s1, s2);
  assert.equal(s1.schema_version, 'RESONANCE-REPORT-SNAPSHOT-2');
  assert.match(read('docs/sql/resonance_01_orders_reports_DRAFT_DO_NOT_RUN.sql'), /check \(schema_version = 'RESONANCE-REPORT-SNAPSHOT-2'\)/);
  assert.deepEqual(s1.input, a);
  assert.equal(s1.result.nation_display, 'ナド・クライ');
  assert.equal(s1.result.mirror_character, MAP.rows['氷|法器|ナドクライ']);
  assert.deepEqual(s1.purchase, { product_code: 'resonance_report_v1', amount_jpy: 500, currency: 'jpy', order_id: PURCHASE.orderId, created_at: PURCHASE.createdAt });
  assert.equal(s1.model.assignmentSha256, 'cf67efa6b5d3bbeaff67a2c36e69e45b266685b44df52dad4c8401714b5b4946');
  assert.match(s1.model.prototypeSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(s1), /email|mail|card|token|stripe|customer|name"\s*:\s*"(?!.)/i);
  // 表示は保存済みの値だけ：保存済みの図を書き換えると表示も変わる（その場で計算し直していない）
  const html1 = R.renderReportHtml(s1);
  const s3 = JSON.parse(JSON.stringify(s1)); s3.figures.persona.you = s3.figures.persona.you.map(() => 0); s3.text.persona = '保存済みの文';
  const html3 = R.renderReportHtml(s3);
  assert.notEqual(html1, html3);
  assert.ok(html3.includes('保存済みの文'));
  const src = R.renderReportHtml.toString() + R.renderFigures.toString();
  assert.doesNotMatch(src, /modelVectors|analyze\(|symbols\(|composeText|PROTO|CHARS/);
});

test('本文：辞書が無い所は〔未執筆〕で示して販売用には作れない。数値・一致率・「最も似る」などの言葉を出さない。章の順は人物名 → PERSONA → RESONANCE → …', () => {
  assert.throws(() => R.buildSnapshot({ element: '水', weapon: '法器', nation: 'フォンテーヌ' }, PURCHASE, { dict: R.DICT }), (e) => e.code === 'DICTIONARY_INCOMPLETE' && e.missing.length > 0);
  const families = new Set();
  for (const a of ALL) {
    const s = R.buildSnapshot(a, PURCHASE, { allowMissing: true, dict: R.DICT }); // 空の辞書（スキーマだけ）
    s.draft_missing.forEach((k) => families.add(k.split(':')[0]));
    const all = Object.values(s.text).map((t) => (Array.isArray(t) ? t.map((p) => p.label + p.body).join('') : t)).join('') + R.renderReportHtml(s).replace(/<svg[\s\S]*?<\/svg>/g, '');
    assert.doesNotMatch(all.replace(/〔未執筆：[^〕]*〕/g, '').split(R.DISCLAIMER).join(''), /[0-9０-９]+\s*(%|％|点|位)|一致率|類似度|最も似|最も近|一番|1位|１位|精密|測定した結果です|診断します/);
    assert.ok(all.includes(R.DISCLAIMER));
  }
  assert.deepEqual([...families].sort(), Object.keys(R.DICT).sort()); // 不足辞書の一覧＝辞書の全種類
  // 辞書がそろえば〔未執筆〕は消え、同じ辞書なら同じ文
  const dict = Object.fromEntries(Object.keys(R.DICT).map((k) => [k, new Proxy({}, { get: (_, key) => `［${k}/${String(key)}］` })]));
  const full = R.buildSnapshot({ element: '水', weapon: '法器', nation: 'フォンテーヌ' }, PURCHASE, { dict });
  assert.ok(!('draft_missing' in full));
  assert.doesNotMatch(JSON.stringify(full.text), /未執筆/);
  assert.deepEqual(full.text, R.buildSnapshot({ element: '水', weapon: '法器', nation: 'フォンテーヌ' }, PURCHASE, { dict }).text);
  const order = R.CHAPTERS.map((c) => c[1]);
  assert.deepEqual(order, ['PERSONA', 'RESONANCE', 'STYLE', 'VALUES', 'SYMBOLS', 'JOURNEY']);
});

test('監査ファイル（280件）は計算器と一致している（作り直し忘れの検出）', () => {
  const rows = JSON.parse(read('docs/eti-mini/phase_c/audit_280.json'));
  assert.equal(rows.length, 280);
  for (const r of rows) {
    const [element, weapon, nation] = r.key.split('|');
    const an = R.analyze(R.modelVectors({ element, weapon, nation }));
    assert.equal(r.flat, an.flat, r.key);
    assert.deepEqual(r.common, an.common, r.key);
    assert.equal(r.pSim, +an.sims.persona.toFixed(4));
  }
});

test('辞書の雛形（ChatGPT へ渡す dictionary_template_v2.json。C-1 レビュー後のスキーマ）は計算器の辞書と同じキーで、280件に要るキーがすべてある', () => {
  const t = JSON.parse(read('docs/eti-mini/phase_c/dictionary_template_v2.json'));
  const fams = Object.keys(t).filter((k) => !k.startsWith('_'));
  assert.deepEqual(fams.sort(), Object.keys(R.DICT).sort());
  const need = new Set();
  for (const a of ALL) R.buildSnapshot(a, PURCHASE, { allowMissing: true, dict: R.DICT }).draft_missing.forEach((k) => need.add(k));
  const have = new Set(fams.flatMap((f) => Object.keys(t[f]).map((k) => f + ':' + k)));
  assert.deepEqual([...need].sort(), [...have].sort());
  assert.equal(need.size, 300); // comboLine 280 → comboInteraction 35＋nationLens 8、characterModel 66 を追加
  assert.ok(!('comboLine' in t));
});

test('C-1 レビュー：RESONANCE は5区分（回答の人物像／登録モデル／共通／相違／解釈）で、割当を「似ているから」と説明しない', () => {
  for (const a of ALL) {
    const s = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
    assert.deepEqual(s.text.resonance.map((p) => p.part), ['answers', 'character', 'common', 'difference', 'reading']);
    assert.equal(s.text.resonance[1].label, `${s.result.mirror_character}の登録モデル`);
    assert.match(s.text.resonance[0].body, /アナタを測定したものではありません/);
    assert.match(s.text.resonance[1].body, /共鳴しうる人物として割り当てられています/);
    assert.doesNotMatch(JSON.stringify(s.text), /似ているから|最も似|類似度|1位/);
  }
  const html = R.renderReportHtml(R.buildSnapshot(ALL[0], PURCHASE, { allowMissing: true }));
  for (const lbl of ['回答から構成した人物像', '両者に共通する性質', '異なる性質', 'そこから考えられる解釈']) assert.ok(html.includes(`<h3>${lbl}</h3>`), lbl);
});

test('C-1 レビュー：VALUES は図も本文も平均中心化した相対優先度（同じ基準）。共通点は向きの同じ軸から選び、図には読み方を添える', () => {
  for (const a of ALL) {
    const m = R.modelVectors(a), s = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
    const cu = R._internal.center(m.you.values, R.AXES.values), cc = R._internal.center(m.char.values, R.AXES.values);
    assert.equal(s.figures.values.basis, 'centered');
    assert.deepEqual(s.figures.values.you, cu.map((x) => Math.round(x * 10) / 10));
    assert.deepEqual(s.figures.values.char, cc.map((x) => Math.round(x * 10) / 10));
    const an = R.analyze(m), i = R.AXES.values.indexOf(an.axes.values.near);
    const sameSignExists = R.AXES.values.some((_, k) => cu[k] !== 0 && Math.sign(cu[k]) === Math.sign(cc[k]));
    if (sameSignExists) assert.equal(Math.sign(cu[i]), Math.sign(cc[i]), a.element + a.weapon + a.nation);
  }
  const s0 = R.buildSnapshot(ALL[0], PURCHASE, { allowMissing: true });
  assert.ok(R.renderReportHtml(s0).includes(R.VALUES_READING));
  const svg = R.renderFigures(s0.figures).values;
  assert.match(svg, /← 控えめ/); assert.match(svg, /重視 →/);
});

test('C-1 レビュー：組み合わせ固有の上書き（comboOverride）は任意。あれば相互作用＋国家の読み方の代わりに使う', () => {
  const full = Object.fromEntries(Object.keys(R.DICT).map((k) => [k, new Proxy({}, { get: (_, key) => `［${k}/${String(key)}］` })]));
  const a = { element: '水', weapon: '法器', nation: 'フォンテーヌ' };
  const base = R.buildSnapshot(a, PURCHASE, { dict: full });
  assert.match(base.text.persona, /［comboInteraction\/水\|法器］［nationLens\/フォンテーヌ］$/);
  const over = R.buildSnapshot(a, PURCHASE, { dict: { ...full, comboOverride: { '水|法器|フォンテーヌ': '［上書き］' } } });
  assert.match(over.text.persona, /［上書き］$/);
  assert.doesNotMatch(over.text.persona, /comboInteraction/);
});

// ---------------------------------------------------------------- C-2：本文辞書 v2.2（レビュー版）
test('C-2：辞書 v2.2 は受け取ったファイルのまま lib/ に置き sha256 で固定。読むのは辞書本体だけで、300キーすべてに文がある', () => {
  const raw = fs.readFileSync(path.join(ROOT, R.DICTIONARY_FILE));
  assert.equal(require('crypto').createHash('sha256').update(raw).digest('hex'), R.DICTIONARY_SHA256);
  assert.equal(R.DICTIONARY_SHA256, '48fe1ace684f889265d3a5604ae32ce47a40cd7b3b76db743a11d6c17961dd46'); // ChatGPT の検証結果 new_dictionary_sha256
  assert.match(R.DICTIONARY_FILE, /^lib\//); // 公開しない場所
  assert.deepEqual(Object.keys(R.DICTIONARY).sort(), [...Object.keys(R.DICT), 'comboOverride'].sort()); // メタデータ（_about など）は読まない
  const t = JSON.parse(read('docs/eti-mini/phase_c/dictionary_template_v2.json'));
  for (const f of Object.keys(R.DICT)) for (const k of Object.keys(t[f])) assert.ok(typeof R.DICTIONARY[f][k] === 'string' && R.DICTIONARY[f][k].length > 0, f + ':' + k);
});

test('C-2：辞書 v2.2 で 280通りを組み立てると、未執筆・句読点の重なり・禁止語・同じ文の重複が無い', () => {
  const PUNCT = /。。|、。|。、|？。|\?。|！。|、、|「」|\s{2,}/;
  const FORB = /類似度|一致率|一致度|最も似|最も近|一番|1位|１位|[0-9０-９]+\s*(%|％|点|位)|精密|診断します/;
  let anata = 0;
  for (const a of ALL) {
    const s = R.buildSnapshot(a, PURCHASE);
    assert.ok(!('draft_missing' in s), JSON.stringify(a));
    const parts = Object.values(s.text).map((t) => (Array.isArray(t) ? t.map((p) => p.body).join('') : t));
    const all = parts.join('');
    assert.doesNotMatch(all, /未執筆/);
    assert.doesNotMatch(all, PUNCT, JSON.stringify(a));
    assert.doesNotMatch(all.split(R.DISCLAIMER).join(''), FORB, JSON.stringify(a));
    if (/あなた/.test(all)) anata++;
    const sents = all.split(/(?<=。)/).map((x) => x.trim()).filter(Boolean);
    assert.equal(new Set(sents).size, sents.length, '同じ文が2回：' + JSON.stringify(a));
  }
  // 「あなた」表記（サイトは「アナタ」）は ChatGPT へ返却済みの既知の3件（ウェンティ・八重神子・閑雲の characterReading）だけ
  const known = ['ウェンティ', '八重神子', '閑雲'];
  assert.deepEqual(Object.entries(R.DICTIONARY.characterReading).filter(([, v]) => /あなた/.test(v)).map(([k]) => k).sort(), known.sort());
  assert.ok(anata > 0);
});

test('C-2：登録モデルの説明（66名）が名指しする特徴・価値観は登録座標と合っている', () => {
  const TRAIT = { '新しい見方への関心': 'O', '段取りと責任への意識': 'C', '人に向かって働きかける活発さ': 'E', '相手への歩み寄り': 'A',
    '自分から方針を示す姿勢': 'AGY', '周囲との調整': 'REL', '引き受けた役割を継続する意識': 'ROL', '考えを整理して橋渡しする姿勢': 'REF', '自分の間合いを守る姿勢': 'AUT' };
  const VW = { '自分で選ぶこと': 'SD', '変化と刺激': 'ST', '身近な人への思いやり': 'BE', '公正さ': 'UN', '達成': 'AC', '節度': 'CO', '安定': 'SE', '楽しみ': 'HE', '影響力': 'PO', '伝統': 'TR' };
  assert.equal(Object.keys(R.DICTIONARY.characterModel).length, 66);
  for (const [n, t] of Object.entries(R.DICTIONARY.characterModel)) {
    const c = CHARS.find((x) => x.name === n);
    assert.ok(c, n);
    const m = t.match(/登録モデルでは、(.+?)が目立ち、価値観の中では「(.+?)」が相対的に前に出る/);
    assert.ok(m, n);
    const f = Object.keys(TRAIT).filter((p) => m[1].includes(p)).map((p) => TRAIT[p]);
    assert.equal(f.length, 2, n);
    const val = (ax) => (R.AXES.persona.includes(ax) ? c.personality[ax] : c.style[ax]);
    const pMax = Math.max(...R.AXES.persona.map((a) => c.personality[a])), sMax = Math.max(...R.AXES.style.map((a) => c.style[a]));
    const both = [...R.AXES.persona.map((a) => c.personality[a]), ...R.AXES.style.map((a) => c.style[a])].sort((x, y) => y - x);
    const ok = f.every((ax) => val(ax) === (R.AXES.persona.includes(ax) ? pMax : sMax)) || f.every((ax) => val(ax) >= both[1]);
    assert.ok(ok, n + ' ' + f.join('+'));
    const cv = R._internal.center(c.values, R.AXES.values);
    assert.equal(cv[R.AXES.values.indexOf(VW[m[2]])], Math.max(...cv), n + ' ' + m[2]);
  }
  // 国家の代表モデルの説明（nationPriority）が挙げる価値観は、その国家の相対優先度の上位
  const LBL = Object.fromEntries(Object.entries(R.LABEL).map(([k, v]) => [v, k]));
  for (const [n, t] of Object.entries(R.DICTIONARY.nationPriority)) {
    const labs = [...t.matchAll(/「(.+?)」/g)].map((x) => LBL[x[1]]);
    const cv = R._internal.center(PROTO.NATION_PROTOTYPES_V2[n], R.AXES.values);
    const th = cv.slice().sort((x, y) => y - x)[labs.length - 1];
    for (const ax of labs) assert.ok(cv[R.AXES.values.indexOf(ax)] >= th, n + ' ' + ax);
  }
});

test('C-2：行動・価値観の章は、共鳴の章で挙げた軸（同じ役割）を繰り返さない。価値観の共通点は向きの同じ軸から', () => {
  for (const a of ALL) {
    const m = R.modelVectors(a), an = R.analyze(m);
    for (const d of ['style', 'values']) {
      if (an.common.domain === d) assert.notEqual(an.chapter[d].near, an.common.axis, JSON.stringify(a));
      if (an.differ.domain === d) assert.notEqual(an.chapter[d].far, an.differ.axis, JSON.stringify(a));
    }
    const cu = R._internal.center(m.you.values, R.AXES.values), cc = R._internal.center(m.char.values, R.AXES.values);
    const i = R.AXES.values.indexOf(an.chapter.values.near);
    if (R.AXES.values.some((_, k) => cu[k] !== 0 && Math.sign(cu[k]) === Math.sign(cc[k]) && R.AXES.values[k] !== (an.common.domain === 'values' ? an.common.axis : null))) assert.equal(Math.sign(cu[i]), Math.sign(cc[i]), JSON.stringify(a));
  }
});

test('C-2：辞書 v2.2 はレビュー版。作ったスナップショットは販売用ではなく（REVIEW_NOT_FOR_SALE）、DB 草案も承認済みの文章しか保存できない', () => {
  const s = R.buildSnapshot(ALL[0], PURCHASE);
  assert.equal(s.model.dictionary_version, 'RESONANCE-TEXT-C2-2.2-REVIEW');
  assert.equal(s.model.dictionary_sha256, R.DICTIONARY_SHA256);
  assert.equal(s.model.dictionary_status, 'REVIEW_NOT_FOR_SALE');
  assert.deepEqual(R.APPROVED_DICTIONARY_SHA256, []);
  assert.match(read('docs/sql/resonance_01_orders_reports_DRAFT_DO_NOT_RUN.sql'), /check \(snapshot->'model'->>'dictionary_status' = 'APPROVED'\)/);
  assert.equal(R.buildSnapshot(ALL[0], PURCHASE, { dict: { ...R.DICTIONARY } }).model.dictionary_status, 'REVIEW_NOT_FOR_SALE'); // 別の辞書でも承認なしは販売用でない
});
